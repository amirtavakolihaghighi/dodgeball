"""Authoritative game rules: players, balls, defensive timing and rounds.

Plain synchronous Python driven by explicit timestamps, so the server loop and the tests
run it exactly the same way. Nothing in here touches the network.

Coordinates: y is up, RED lives at negative x, BLUE at positive x. A yaw of 0 faces +z;
forward(yaw) = (sin yaw, cos yaw) and the player's right is (-cos yaw, sin yaw).
"""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import bots
import config as C

ACTIONS = {"dodge": C.DODGE, "catch": C.CATCH, "deflect": C.DEFLECT}
ACTION_CODE = {"dodge": 1, "catch": 2, "deflect": 3}
BALL_STATE_CODE = {"live": 0, "pending": 1, "dead": 2}
TEAM_NAMES = ("RED", "BLUE")
STAT_KEYS = ("hits", "kos", "catches", "deflects", "perfects", "outs")

CAPSULE_Y0, CAPSULE_Y1 = 0.25, 1.45   # hit capsule = this vertical segment + PLAYER_RADIUS
HAND_UP, HAND_FWD, HAND_RIGHT = 1.45, 0.3, 0.32
DEAD_GRAVITY = 18.0                   # dead balls drop quickly out of the way
DEAD_BALL_TIME = 1.6


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def norm3(x, y, z):
    length = math.sqrt(x * x + y * y + z * z)
    if length < 1e-9:
        return None
    return (x / length, y / length, z / length)


def angle_deg(a, b):
    return math.degrees(math.acos(clamp(a[0] * b[0] + a[1] * b[1] + a[2] * b[2], -1.0, 1.0)))


def rotate_toward(cur, want, max_rad):
    """Turn unit vector `cur` toward unit vector `want` by at most `max_rad` radians."""
    ang = math.acos(clamp(cur[0] * want[0] + cur[1] * want[1] + cur[2] * want[2], -1.0, 1.0))
    if ang <= max_rad:
        return want
    s = math.sin(ang)
    if s < 1e-6:
        return cur
    a, b = math.sin(ang - max_rad) / s, math.sin(max_rad) / s
    return norm3(cur[0] * a + want[0] * b, cur[1] * a + want[1] * b, cur[2] * a + want[2] * b) or cur


def forward(yaw):
    return math.sin(yaw), math.cos(yaw)


def throw_cost(power):
    return C.THROW_COST_MIN + (C.THROW_COST_MAX - C.THROW_COST_MIN) * power


def throw_speed(power):
    return C.THROW_SPEED_MIN + (C.THROW_SPEED_MAX - C.THROW_SPEED_MIN) * power


def damage_for(speed):
    return clamp(C.DAMAGE_MIN + (speed - C.THROW_SPEED_MIN) * C.DAMAGE_PER_SPEED, C.DAMAGE_MIN, C.DAMAGE_MAX)


def launch_velocity(frm, to, speed, reach_max=True):
    """Velocity that carries a ball from `frm` through `to` at `speed`, on the flatter of the
    two gravity arcs. Out of reach: the longest (45 degree) throw if `reach_max`, else None."""
    dx, dy, dz = to[0] - frm[0], to[1] - frm[1], to[2] - frm[2]
    d = math.hypot(dx, dz)
    g = C.GRAVITY
    if g <= 0 or d < 0.3:
        n = norm3(dx, dy, dz)
        return (n[0] * speed, n[1] * speed, n[2] * speed) if n else None
    s2 = speed * speed
    disc = s2 * s2 - g * (g * d * d + 2 * dy * s2)
    if disc < 0:
        if not reach_max:
            return None
        theta = math.pi / 4
    else:
        theta = math.atan2(s2 - math.sqrt(disc), g * d)
    h = math.cos(theta) * speed / d
    return (dx * h, math.sin(theta) * speed, dz * h)


def _num(value, default):
    """Untrusted JSON number -> finite float, else `default`."""
    if isinstance(value, bool):
        return default
    try:
        f = float(value)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _vec3(value):
    if isinstance(value, (list, tuple)) and len(value) == 3:
        v = tuple(_num(c, math.nan) for c in value)
        if all(math.isfinite(c) for c in v):
            return v
    return None


def _clean_name(name, fallback):
    name = "".join(ch for ch in str(name or "") if ch.isprintable()).strip()[:16]
    return name or fallback


@dataclass
class Player:
    id: int
    name: str
    team: int
    bot: bool = False
    x: float = 0.0
    z: float = 0.0
    yaw: float = 0.0
    pitch: float = 0.0
    vx: float = 0.0                 # smoothed velocity, used by bots to lead their throws
    vz: float = 0.0
    prev_x: float = 0.0
    prev_z: float = 0.0
    hp: float = C.MAX_HP
    stamina: float = C.MAX_STAMINA
    cash: int = 0
    alive: bool = True
    down_since: float = 0.0
    has_ball: bool = True
    ball_ready_at: float = 0.0
    charging: bool = False
    charge_start: float = 0.0       # in the player's view timeline, like action_start
    charge_started_at: float = 0.0  # server clock
    action: str | None = None
    action_start: float = -99.0     # the moment of the press, as the player saw the world
    action_end: float = -99.0       # busy until: window + recovery
    perfect_paid: bool = False
    dash_dir: tuple = (0.0, 0.0)
    dodge_from: tuple = (0.0, 0.0)  # where a dodge started: a ball reaching it was dodged
    last_spend: float = -99.0
    invuln_until: float = 0.0
    aim: tuple | None = None        # world point under the player's crosshair
    aim_target: int | None = None   # enemy their client highlighted for aim assist
    view_lag: float = 0.1           # how far behind the server this player's screen is
    tp: int = 0                     # bumped on server teleports (spawn, revive)
    next_team: int | None = None
    stats: dict = field(default_factory=lambda: dict.fromkeys(STAT_KEYS, 0))
    brain: object = None


@dataclass
class Ball:
    id: int
    owner: int
    team: int
    x: float
    y: float
    z: float
    vx: float                       # velocity, m/s (gravity pulls vy down)
    vy: float
    vz: float
    born: float
    target: int | None = None       # aim-assist target (None = flies free)
    turn_rate: float = math.radians(C.ASSIST_TURN_RATE_DEG)
    rally: int = 0                  # deflections so far
    bounces: int = 0                # floor/wall ricochets since the last throw or deflect
    state: str = "live"             # live | pending | dead
    ignore: set = field(default_factory=set)   # players it already passed through
    pending_pid: int | None = None
    contact_t: float = 0.0
    deadline: float = 0.0
    dead_since: float = 0.0

    @property
    def speed(self):
        return math.sqrt(self.vx * self.vx + self.vy * self.vy + self.vz * self.vz)


class Game:
    def __init__(self, seed=None):
        self.rng = random.Random(seed)
        self.players: dict[int, Player] = {}
        self.balls: dict[int, Ball] = {}
        self.events: list[dict] = []
        self._next_id = 1
        self.state = "wait"             # wait | count | play | over
        self.state_until = 0.0
        self.round_no = 0
        self.round_started = 0.0
        self.score = [0, 0]
        self.last_winner = None
        self.team_revives = [0, 0]      # revives bought this round, per team (prices escalate)
        self.bot_fill = C.BOT_FILL
        self.bot_skill = C.BOT_SKILL
        self.bots_play_alone = False    # tests let bots play without humans
        self.half_length, self.half_width = self._court_size(1)

    # ------------------------------------------------------------------ court

    @staticmethod
    def _court_size(team_size):
        n = max(1, team_size)
        return (C.COURT_HALF_LENGTH_BASE + C.COURT_HALF_LENGTH_PER_PLAYER * n,
                C.COURT_HALF_WIDTH_BASE + C.COURT_HALF_WIDTH_PER_PLAYER * n)

    def _fit_court(self, shrink):
        """Size the court for the biggest team. It grows at once, but only shrinks when allowed
        (between rounds), so nobody gets squeezed by a wall mid-round."""
        biggest = max(sum(p.team == t for p in self.players.values()) for t in (0, 1))
        length, width = self._court_size(biggest)
        if not shrink:
            length, width = max(length, self.half_length), max(width, self.half_width)
        self.half_length, self.half_width = length, width

    def clamp_to_half(self, team, x, z):
        r = C.PLAYER_RADIUS
        if team == 0:
            x = clamp(x, -self.half_length + r, -C.CENTER_GAP)
        else:
            x = clamp(x, C.CENTER_GAP, self.half_length - r)
        return x, clamp(z, -self.half_width + r, self.half_width - r)

    # ------------------------------------------------------------------ players

    def add_player(self, name, team, now, bot=False):
        pid = self._new_id()
        if team not in (0, 1) or isinstance(team, bool):
            team = self._auto_team()
        p = Player(id=pid, name=_clean_name(name, f"Player {pid}"), team=team, bot=bot)
        if bot:
            p.brain = bots.Brain()
        self.players[pid] = p
        self._fit_court(shrink=False)
        self._spawn(p, now)
        if not bot:
            self._event(now, "join", p=pid, name=p.name, team=team)
            if self.state == "wait":
                self._balance_bots(now)
        return p

    def remove_player(self, pid, now):
        p = self.players.pop(pid, None)
        if p is not None and not p.bot:
            self._event(now, "leave", p=pid, name=p.name)
        self._fit_court(shrink=self.state == "wait")

    def _auto_team(self):
        def load(team):
            members = [p for p in self.players.values() if p.team == team]
            return sum(not p.bot for p in members), len(members), team
        return min((0, 1), key=load)

    def _spawn(self, p, now, slot=None, count=1):
        side = -1.0 if p.team == 0 else 1.0
        depth = self.half_length * C.SPAWN_FRACTION
        if slot is None:
            x = side * self.rng.uniform(depth - 2.0, depth + 1.5)
            z = self.rng.uniform(-self.half_width + 1.5, self.half_width - 1.5)
        else:
            spacing = min(2.5, (2 * self.half_width - 3) / max(1, count - 1))
            x, z = side * depth, (slot - (count - 1) / 2) * spacing
        p.x, p.z = self.clamp_to_half(p.team, x, z)
        p.prev_x, p.prev_z, p.vx, p.vz = p.x, p.z, 0.0, 0.0
        p.yaw, p.pitch = (math.pi / 2 if p.team == 0 else -math.pi / 2), 0.0   # face the enemy
        p.has_ball, p.ball_ready_at = True, now
        p.charging = False
        p.action, p.action_end = None, -99.0
        p.tp += 1

    # ------------------------------------------------------------------ input

    def handle(self, pid, msg, now):
        """Apply one message from a player's browser."""
        p = self.players.get(pid)
        if p is None:
            return
        kind = msg.get("t")
        wt = self._view_time(msg, now)
        if kind == "in":
            self._on_input(p, msg, now, wt)
        elif kind == "charge":
            self.start_charge(p, now, wt)
        elif kind == "throw":
            self._read_aim(p, msg)
            self.throw(p, now, wt)
        elif kind == "cancel":
            p.charging = False
        elif kind == "act" and msg.get("a") in ACTIONS:
            self._read_aim(p, msg)
            self.start_action(p, msg["a"], now, wt, self._dash_dir(msg.get("dir")))
        elif kind == "revive":
            self.revive(p, now)
        elif kind == "team":
            self._request_team(p, msg.get("team"), now)
        elif kind == "cfg":
            self._configure(msg, now)

    @staticmethod
    def _view_time(msg, now):
        # The moment the player was looking at when they pressed (clients render in the
        # past). Bounded, so a client can never claim more than MAX_LAG_COMP of leniency.
        return clamp(_num(msg.get("wt"), now), now - C.MAX_LAG_COMP, now)

    def _on_input(self, p, msg, now, wt):
        p.view_lag += ((now - wt) - p.view_lag) * 0.1
        self._read_aim(p, msg)
        # Each browser moves its own player (instant response); the server keeps it legal.
        # Anything sent before the client noticed a teleport (spawn, revive) is stale.
        if p.alive and msg.get("tp") == p.tp:
            p.x, p.z = self.clamp_to_half(p.team, _num(msg.get("x"), p.x), _num(msg.get("z"), p.z))
            p.yaw = _num(msg.get("yaw"), p.yaw)
            p.pitch = clamp(_num(msg.get("pitch"), p.pitch), -1.5, 1.5)

    @staticmethod
    def _read_aim(p, msg):
        aim = _vec3(msg.get("aim"))
        if aim is not None:
            p.aim = aim
        tg = msg.get("tg")
        p.aim_target = tg if isinstance(tg, int) and not isinstance(tg, bool) else None

    @staticmethod
    def _dash_dir(value):
        if isinstance(value, (list, tuple)) and len(value) == 2:
            x, z = _num(value[0], 0.0), _num(value[1], 0.0)
            length = math.hypot(x, z)
            if length > 1e-6:
                return x / length, z / length
        return None

    def _combat_open(self):
        return self.state in ("wait", "play")

    # ------------------------------------------------------------------ throwing

    def start_charge(self, p, now, wt):
        if p.alive and self._combat_open() and p.has_ball and not p.charging and now >= p.action_end:
            p.charging = True
            p.charge_start = wt
            p.charge_started_at = now

    def throw(self, p, now, wt):
        if not p.alive or not self._combat_open():
            return self._deny(p, now, "round")
        if not p.has_ball:
            return self._deny(p, now, "noball")
        if now < p.action_end:
            return self._deny(p, now, "busy")
        held = clamp(wt - p.charge_start, 0.0, C.CHARGE_TIME) if p.charging else 0.0
        p.charging = False
        power = held / C.CHARGE_TIME
        if p.stamina < throw_cost(power):
            # Throw as hard as the remaining stamina allows.
            power = (p.stamina - C.THROW_COST_MIN) / (C.THROW_COST_MAX - C.THROW_COST_MIN)
            if power < 0:
                return self._deny(p, now, "stamina")
        self._spend(p, throw_cost(power), now)
        p.has_ball = False
        p.ball_ready_at = now + C.THROW_COOLDOWN
        hand = self._hand(p)
        speed = throw_speed(power)
        vel, straight = self._aimed_velocity(p, hand, speed)
        b = Ball(id=self._new_id(), owner=p.id, team=p.team, x=hand[0], y=hand[1], z=hand[2],
                 vx=vel[0], vy=vel[1], vz=vel[2], born=now,
                 target=self._assist_target(p, hand, straight, C.ASSIST_CONE_DEG))
        self.balls[b.id] = b
        self._event(now, "throw", p=p.id, b=b.id, power=round(power, 2), speed=round(speed, 1))
        return b

    def _aimed_velocity(self, p, hand, speed, fallback=None):
        """Launch velocity whose arc passes through the player's aim point, and the straight
        line to that point (what the player sees as 'aiming at someone')."""
        aim = p.aim or fallback
        if aim is None:
            f = self._facing(p)
            aim = (hand[0] + f[0] * 20, hand[1] + f[1] * 20, hand[2] + f[2] * 20)
        straight = norm3(aim[0] - hand[0], aim[1] - hand[1], aim[2] - hand[2]) or self._facing(p)
        vel = launch_velocity(hand, aim, speed) or tuple(c * speed for c in straight)
        return vel, straight

    @staticmethod
    def _hand(p):
        fx, fz = forward(p.yaw)
        return (p.x + fx * HAND_FWD - fz * HAND_RIGHT, HAND_UP, p.z + fz * HAND_FWD + fx * HAND_RIGHT)

    @staticmethod
    def _facing(p):
        cp = math.cos(p.pitch)
        return (math.sin(p.yaw) * cp, math.sin(p.pitch), math.cos(p.yaw) * cp)

    def _assist_target(self, p, hand, d, cone):
        """The enemy closest to the throw direction, if within `cone` degrees."""
        best, best_ang = None, cone
        for e in self.players.values():
            if not e.alive or e.team == p.team:
                continue
            to = norm3(e.x - hand[0], C.CHEST_HEIGHT - hand[1], e.z - hand[2])
            if to is None or math.hypot(e.x - hand[0], e.z - hand[2]) > C.ASSIST_RANGE:
                continue
            ang = angle_deg(d, to)
            if e.id == p.aim_target:
                ang -= C.ASSIST_SLACK_DEG   # favour the enemy the player saw highlighted
            if ang <= best_ang:
                best, best_ang = e.id, ang
        if best is not None and p.aim is not None and self._is_bank_shot(p.aim, hand, self.players[best]):
            return None     # aiming at the floor or a wall short of them: let the ricochet work
        return best

    def _is_bank_shot(self, aim, hand, enemy):
        r = 0.35
        on_surface = (aim[1] < r or abs(aim[0]) > self.half_length - r or abs(aim[2]) > self.half_width - r)
        closer = math.hypot(aim[0] - hand[0], aim[2] - hand[2]) < math.hypot(enemy.x - hand[0], enemy.z - hand[2]) - 1.0
        return on_surface and closer

    # ------------------------------------------------------------------ defence

    def start_action(self, p, kind, now, wt, dash_dir=None):
        spec = ACTIONS[kind]
        if not p.alive or not self._combat_open():
            return self._deny(p, now, "round")
        if now < p.action_end:
            return self._deny(p, now, "busy")
        if p.stamina < spec.cost:
            return self._deny(p, now, "stamina")
        self._spend(p, spec.cost, now)
        p.charging = False
        p.action = kind
        p.action_start = now if p.bot else wt
        p.action_end = p.action_start + spec.window + spec.recovery
        p.perfect_paid = False
        if kind == "dodge":
            fx, fz = forward(p.yaw)
            p.dash_dir = dash_dir or (-fx, -fz)
            p.dodge_from = (p.x, p.z)
        self._check_pending(now)    # a ball may already be waiting on this very input
        return True

    @staticmethod
    def _action_at(p, t):
        """The defensive action that was active at time `t`, if any."""
        if p.action is not None and p.action_start <= t <= p.action_start + ACTIONS[p.action].window:
            return p.action
        return None

    def _contact(self, b, p, t):
        """Ball `b` touched player `p` at time `t`. Returns True if the ball stops this tick."""
        if t < p.invuln_until:
            b.ignore.add(p.id)
            return False
        kind = self._action_at(p, t)
        if kind:
            return self._defend(b, p, kind, t)
        # Nothing active. The player's button press may still be in flight over Wi-Fi, so
        # hold the ball at the contact point briefly before calling it a hit.
        b.state = "pending"
        b.pending_pid = p.id
        b.contact_t = t
        b.deadline = t if p.bot else t + clamp(p.view_lag + 0.03, 0.05, C.MAX_LAG_COMP + 0.03)
        return True

    def _defend(self, b, p, kind, t):
        if kind == "dodge":
            self._dodged(b, p, t)
            return False
        if kind == "catch":
            self._caught(b, p, t)
        else:
            self._deflected(b, p, t)
        return True

    def _check_pending(self, now):
        for b in list(self.balls.values()):
            if b.state != "pending":
                continue
            p = self.players.get(b.pending_pid)
            if p is None or not p.alive:
                b.state = "live"            # whoever it touched is gone: it flies on
                b.ignore.add(b.pending_pid)
                continue
            kind = self._action_at(p, b.contact_t)
            if kind:
                b.state = "live"
                self._defend(b, p, kind, b.contact_t)
            elif now >= b.deadline:
                b.state = "live"
                self._hit(b, p, b.contact_t, now)

    def _dodged(self, b, p, t):
        b.ignore.add(p.id)
        if b.target == p.id:
            b.target = None
        perfect = t - p.action_start <= C.DODGE.perfect and not p.perfect_paid
        cash = C.CASH_PERFECT_DODGE if perfect else 0
        if perfect:
            p.perfect_paid = True
            self._refund(p, C.DODGE.cost - C.DODGE.perfect_cost)
            p.cash += cash
            p.stats["perfects"] += 1
        self._event(t, "dodge", p=p.id, perfect=perfect, cash=cash)

    def _caught(self, b, p, t):
        perfect = t - p.action_start <= C.CATCH.perfect
        if perfect:
            self._refund(p, C.CATCH.cost - C.CATCH.perfect_cost)
        cash = (C.CASH_PERFECT_CATCH if perfect else C.CASH_CATCH) + C.CASH_RALLY_BONUS * b.rally
        p.cash += cash
        p.stats["catches"] += 1
        p.stats["perfects"] += perfect
        p.has_ball = True                   # the caught ball is yours: throw it right away
        p.action, p.action_end = None, t    # hands are free again immediately
        self.balls.pop(b.id, None)
        self._event(t, "catch", p=p.id, by=b.owner, perfect=perfect, rally=b.rally, cash=cash)

    def _deflected(self, b, p, t):
        perfect = t - p.action_start <= C.DEFLECT.perfect
        if perfect:
            self._refund(p, C.DEFLECT.cost - C.DEFLECT.perfect_cost)
        cash = (C.CASH_PERFECT_DEFLECT if perfect else C.CASH_DEFLECT) + C.CASH_RALLY_BONUS * b.rally
        p.cash += cash
        p.stats["deflects"] += 1
        p.stats["perfects"] += perfect
        thrower = self.players.get(b.owner)
        # Nobody aimed (e.g. a bot without a plan): send it straight back at the thrower.
        fallback = (thrower.x, C.CHEST_HEIGHT, thrower.z) if thrower else None
        hand = self._hand(p)
        speed = min(b.speed * C.DEFLECT_SPEEDUP, C.BALL_SPEED_CAP)
        vel, straight = self._aimed_velocity(p, hand, speed, fallback)
        b.x, b.y, b.z = hand
        b.vx, b.vy, b.vz = vel
        b.team, b.owner = p.team, p.id
        b.rally += 1
        b.bounces = 0
        b.turn_rate = math.radians(C.ASSIST_TURN_RATE_DEG)
        b.target = self._assist_target(p, hand, straight, C.DEFLECT_ASSIST_CONE_DEG)
        b.ignore = set()
        b.born = t
        b.state = "live"
        p.action, p.action_end = None, t
        self._event(t, "deflect", p=p.id, perfect=perfect, rally=b.rally, cash=cash, speed=round(speed, 1))

    def _hit(self, b, p, t, now):
        speed = b.speed
        dmg = round(damage_for(speed))
        p.hp = max(0.0, p.hp - dmg)
        ko = p.hp <= 0
        owner = self.players.get(b.owner)
        earned = 0
        if owner is not None and owner.team != p.team:
            earned = C.CASH_HIT + (C.CASH_KO if ko else 0)
            owner.cash += earned
            owner.stats["hits"] += 1
            owner.stats["kos"] += ko
        if ko:
            p.alive = False
            p.down_since = now
            p.charging = False
            p.action = None
            p.stats["outs"] += 1
        bank = b.bounces > 0
        self._kill(b, t, (-b.vx * 0.2, 2.5, -b.vz * 0.2))     # bounce off the body
        self._event(t, "hit", p=p.id, by=b.owner, b=b.id, dmg=dmg, ko=ko, rally=b.rally, cash=earned,
                    speed=round(speed, 1), bank=bank)

    # ------------------------------------------------------------------ revive / team / settings

    def revive(self, p, now):
        if not p.alive or self.state != "play":
            return self._deny(p, now, "round")
        fallen = [q for q in self.players.values() if q.team == p.team and not q.alive]
        if not fallen:
            return self._deny(p, now, "nobody")
        cost = self.revive_cost(p.team)
        if p.cash < cost:
            return self._deny(p, now, "cash")
        q = min(fallen, key=lambda q: q.down_since)
        p.cash -= cost
        self.team_revives[p.team] += 1
        q.alive, q.hp, q.stamina = True, C.REVIVE_HP, C.MAX_STAMINA
        q.invuln_until = now + C.REVIVE_INVULN
        self._spawn(q, now)
        self._event(now, "revive", p=q.id, by=p.id, cost=cost)
        return q

    def revive_cost(self, team):
        return C.REVIVE_COST + C.REVIVE_COST_STEP * self.team_revives[team]

    def _request_team(self, p, team, now):
        if team not in (0, 1) or isinstance(team, bool) or team == p.team:
            return
        if self.state == "wait":
            p.team, p.next_team = team, None
            p.alive, p.hp = True, C.MAX_HP
            self._spawn(p, now)
            self._balance_bots(now)
            self._event(now, "team", p=p.id, team=team, now=True)
        else:
            p.next_team = team
            self._event(now, "team", p=p.id, team=team, now=False)

    def _configure(self, msg, now):
        fill = msg.get("fill")
        if isinstance(fill, int) and not isinstance(fill, bool) and 0 <= fill <= C.BOT_FILL_MAX:
            self.bot_fill = fill
        if msg.get("skill") in bots.PROFILES:
            self.bot_skill = msg["skill"]
        # More bots join right away (like a mid-round human); fewer only from the next round.
        self._balance_bots(now, remove=self.state == "wait")
        self._event(now, "cfg", fill=self.bot_fill, skill=self.bot_skill)

    def _balance_bots(self, now, remove=True):
        """Top teams up with bots to `bot_fill` players (or to the bigger human team)."""
        humans = [sum(not p.bot for p in self.players.values() if p.team == t) for t in (0, 1)]
        size = 0
        if self.bot_fill > 0 and (sum(humans) > 0 or self.bots_play_alone):
            size = max(self.bot_fill, *humans)
        for t in (0, 1):
            team_bots = [p for p in self.players.values() if p.bot and p.team == t]
            surplus = len(team_bots) - max(0, size - humans[t])
            if surplus > 0 and not remove:
                continue
            for extra in sorted(team_bots, key=lambda p: (p.alive, -p.id))[:max(0, surplus)]:
                del self.players[extra.id]
            for _ in range(-surplus):
                self.add_player(self._bot_name(), t, now, bot=True)
        self._fit_court(shrink=self.state == "wait")

    def _bot_name(self):
        taken = {p.name for p in self.players.values()}
        for n in bots.NAMES:
            if f"Bot {n}" not in taken:
                return f"Bot {n}"
        return f"Bot {self._next_id}"

    # ------------------------------------------------------------------ simulation

    def tick(self, t0, t1):
        """Advance the world from t0 to t1 (server clock, seconds)."""
        dt = t1 - t0
        if dt <= 0:
            return
        for p in list(self.players.values()):
            if p.bot:
                bots.update(self, p, t0, dt)
            self._update_player(p, t1, dt)
        for b in list(self.balls.values()):
            if b.state == "live":
                self._fly(b, t0, dt)
            elif b.state == "dead":
                self._fall(b, t1, dt)
        self._check_pending(t1)
        self._update_round(t1)

    def _update_player(self, p, now, dt):
        k = min(1.0, dt * 8)    # humans report positions at ~30 Hz, so smooth the deltas
        p.vx += ((p.x - p.prev_x) / dt - p.vx) * k
        p.vz += ((p.z - p.prev_z) / dt - p.vz) * k
        p.prev_x, p.prev_z = p.x, p.z
        if not p.alive:
            return
        if not p.has_ball and now >= p.ball_ready_at:
            p.has_ball = True
        if p.charging and now - p.charge_started_at > C.CHARGE_TIME + 3.0:
            p.charging = False      # the release never arrived (e.g. the tab lost focus)
        if p.action is not None and now > p.action_end:
            p.action = None
        defending = p.action is not None and now <= p.action_start + ACTIONS[p.action].window
        if p.bot and p.action == "dodge" and now < p.action_start + C.DODGE_DASH_TIME:
            step = C.DODGE_DASH_SPEED * dt   # humans dash on their own client
            p.x, p.z = self.clamp_to_half(p.team, p.x + p.dash_dir[0] * step, p.z + p.dash_dir[1] * step)
        if not p.charging and not defending and now - p.last_spend >= C.STAMINA_REGEN_DELAY:
            p.stamina = min(C.MAX_STAMINA, p.stamina + C.STAMINA_REGEN * dt)

    def _fly(self, b, t0, dt):
        if b.target is not None:
            self._bend(b, dt)
        # Sub-step so fast balls can't tunnel through players, and contact times are precise.
        steps = max(1, math.ceil(b.speed * dt / 0.15))
        h = dt / steps
        for i in range(1, steps + 1):
            b.vy -= C.GRAVITY * h
            b.x += b.vx * h
            b.y += b.vy * h
            b.z += b.vz * h
            t = t0 + h * i
            if self._hit_world(b, t):
                return
            for p in list(self.players.values()):
                if not p.alive or p.team == b.team or p.id in b.ignore:
                    continue
                kind = self._action_at(p, t)
                reach = C.CATCH_REACH if kind in ("catch", "deflect") else 0.0
                touching = self._capsule_dist(b, p.x, p.z) <= C.PLAYER_RADIUS + C.BALL_RADIUS + reach
                if not touching and kind == "dodge":
                    # Dashing clean out of the way counts too: the ball hits your afterimage.
                    touching = self._capsule_dist(b, *p.dodge_from) <= C.PLAYER_RADIUS + C.BALL_RADIUS
                if touching and self._contact(b, p, t):
                    return
        if t0 + dt - b.born > C.BALL_LIFETIME:
            self._kill(b, t0 + dt)

    def _bend(self, b, dt):
        """Aim assist: steer toward the arc that would hit the target, until the ball goes past."""
        t = self.players.get(b.target)
        if t is None or not t.alive or t.id in b.ignore:
            b.target = None
            return
        to_x, to_z = t.x - b.x, t.z - b.z
        hd, hv = math.hypot(to_x, to_z), math.hypot(b.vx, b.vz)
        if hd < 1e-6 or hv < 1e-6:
            return
        if (to_x * b.vx + to_z * b.vz) / (hd * hv) < 0.3:
            b.target = None         # it went wide or past: the assist lets go
            return
        speed = b.speed
        want = launch_velocity((b.x, b.y, b.z), (t.x, C.CHEST_HEIGHT, t.z), speed, reach_max=False)
        if want is None:
            return                  # out of reach at this speed: it just flies on
        cur = (b.vx / speed, b.vy / speed, b.vz / speed)
        new = rotate_toward(cur, (want[0] / speed, want[1] / speed, want[2] / speed), b.turn_rate * dt)
        b.vx, b.vy, b.vz = new[0] * speed, new[1] * speed, new[2] * speed

    @staticmethod
    def _capsule_dist(b, x, z):
        cy = clamp(b.y, CAPSULE_Y0, CAPSULE_Y1)
        return math.sqrt((b.x - x) ** 2 + (b.y - cy) ** 2 + (b.z - z) ** 2)

    def _hit_world(self, b, t):
        """Floor, side wall or end wall contact. The first floor/side-wall contact ricochets (if
        the ball is still fast enough) and curves toward an enemy ahead. End walls (behind each
        team) just stop it, so nobody gets hit from behind by a ball they never saw."""
        r = C.BALL_RADIUS
        hx, hz = self.half_length - r, self.half_width - r
        kn, kt = C.RICOCHET_NORMAL_KEEP, C.RICOCHET_TANGENT_KEEP
        if b.y > 14.0:
            self._kill(b, t)
            return True
        if abs(b.x) > hx:
            b.x = math.copysign(hx, b.x)
            self._kill(b, t, (-b.vx * 0.25, b.vy * 0.5, b.vz * 0.5))
            return True
        if b.y <= r:
            b.y = r
            b.vx, b.vy, b.vz = b.vx * kt, -b.vy * kn, b.vz * kt
        elif abs(b.z) > hz:
            b.z = math.copysign(hz, b.z)
            b.vx, b.vy, b.vz = b.vx * kt, b.vy * kt, -b.vz * kn
        else:
            return False
        if b.bounces < C.MAX_RICOCHETS and b.speed >= C.RICOCHET_MIN_SPEED:
            b.bounces += 1
            b.target = self._ricochet_target(b)
            b.turn_rate = math.radians(C.RICOCHET_TURN_RATE_DEG)
            self._event(t, "bounce", b=b.id, x=round(b.x, 2), y=round(b.y, 2), z=round(b.z, 2))
        else:
            self._kill(b, t)
        return True

    def _ricochet_target(self, b):
        """After a bounce: the enemy closest to the ball's new heading, within the ricochet cone."""
        hv = math.hypot(b.vx, b.vz)
        if hv < 1e-6:
            return None
        best, best_ang = None, C.RICOCHET_CONE_DEG
        for e in self.players.values():
            if not e.alive or e.team == b.team or e.id in b.ignore:
                continue
            dx, dz = e.x - b.x, e.z - b.z
            d = math.hypot(dx, dz)
            if d < 0.5 or d > C.ASSIST_RANGE:
                continue
            ang = math.degrees(math.acos(clamp((dx * b.vx + dz * b.vz) / (d * hv), -1.0, 1.0)))
            if ang <= best_ang:
                best, best_ang = e.id, ang
        return best

    def _kill(self, b, t, vel=None):
        b.state = "dead"
        b.dead_since = t
        b.target = None
        b.vx, b.vy, b.vz = vel if vel is not None else (b.vx * 0.5, b.vy * 0.5, b.vz * 0.5)

    def _fall(self, b, now, dt):
        if now - b.dead_since > DEAD_BALL_TIME:
            del self.balls[b.id]
            return
        b.vy -= DEAD_GRAVITY * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.z += b.vz * dt
        if b.y < C.BALL_RADIUS:
            b.y, b.vy, b.vx, b.vz = C.BALL_RADIUS, abs(b.vy) * 0.45, b.vx * 0.7, b.vz * 0.7
        hx, hz = self.half_length - C.BALL_RADIUS, self.half_width - C.BALL_RADIUS
        if abs(b.x) > hx:
            b.x, b.vx = math.copysign(hx, b.x), -b.vx * 0.5
        if abs(b.z) > hz:
            b.z, b.vz = math.copysign(hz, b.z), -b.vz * 0.5

    # ------------------------------------------------------------------ rounds

    def _update_round(self, now):
        if not self.bots_play_alone and not any(not p.bot for p in self.players.values()):
            if self.players or self.state != "wait":    # nobody human left: reset the match and idle
                self.players.clear()
                self.balls.clear()
                self.state = "wait"
                self.round_no, self.score, self.last_winner = 0, [0, 0], None
                self._fit_court(shrink=True)
            return
        ready = all(any(p.team == t for p in self.players.values()) for t in (0, 1))
        if self.state == "wait":
            if ready:
                self._start_countdown(now)
            else:
                for p in self.players.values():     # free play: nobody stays down
                    if not p.alive and now - p.down_since > 2.0:
                        p.alive, p.hp = True, C.MAX_HP
                        self._spawn(p, now)
        elif not ready:
            self.state = "wait"
            self._event(now, "round", s="wait", n=self.round_no)
        elif self.state == "count":
            if now >= self.state_until:
                self.state, self.round_started = "play", now
                self._event(now, "round", s="play", n=self.round_no)
        elif self.state == "play":
            alive = [sum(p.alive for p in self.players.values() if p.team == t) for t in (0, 1)]
            if 0 in alive:
                self._end_round(-1 if alive[0] == alive[1] else alive.index(max(alive)), now)
            elif now - self.round_started >= C.ROUND_TIME_LIMIT:
                hp = [sum(p.hp for p in self.players.values() if p.team == t and p.alive) for t in (0, 1)]
                key = [(alive[t], hp[t]) for t in (0, 1)]
                self._end_round(-1 if key[0] == key[1] else (0 if key[0] > key[1] else 1), now)
        elif self.state == "over" and now >= self.state_until:
            self._start_countdown(now)

    def _start_countdown(self, now):
        for p in self.players.values():
            if p.next_team is not None:
                p.team, p.next_team = p.next_team, None
        self._balance_bots(now)
        if not all(any(p.team == t for p in self.players.values()) for t in (0, 1)):
            self.state = "wait"
            return
        self._fit_court(shrink=True)
        self.round_no += 1
        self.balls.clear()
        self.team_revives = [0, 0]
        for team in (0, 1):
            members = sorted((p for p in self.players.values() if p.team == team), key=lambda p: p.id)
            for slot, p in enumerate(members):
                p.alive, p.hp, p.stamina, p.invuln_until = True, C.MAX_HP, C.MAX_STAMINA, 0.0
                if C.CASH_RESETS_EACH_ROUND:
                    p.cash = 0
                if p.brain is not None:
                    p.brain.reset()
                self._spawn(p, now, slot, len(members))
        self.state, self.state_until = "count", now + C.COUNTDOWN_TIME
        self._event(now, "round", s="count", n=self.round_no)

    def _end_round(self, winner, now):
        if winner in (0, 1):
            self.score[winner] += 1
        self.last_winner = winner
        self.state, self.state_until = "over", now + C.ROUND_OVER_TIME
        for b in self.balls.values():
            if b.state != "dead":
                self._kill(b, now)
        for p in self.players.values():
            p.charging = False
        self._event(now, "round", s="over", n=self.round_no, w=winner)

    # ------------------------------------------------------------------ helpers & output

    def _new_id(self):
        self._next_id += 1
        return self._next_id - 1

    def _event(self, t, kind, **data):
        self.events.append({"k": kind, "t": round(t, 4), **data})

    def _deny(self, p, now, why):
        if not p.bot:
            self._event(now, "deny", p=p.id, why=why)
        return None

    @staticmethod
    def _spend(p, amount, now):
        p.stamina = max(0.0, p.stamina - amount)
        p.last_spend = now

    @staticmethod
    def _refund(p, amount):
        p.stamina = min(C.MAX_STAMINA, p.stamina + amount)

    def snapshot(self, now):
        """Compact world state for the browsers (arrays instead of objects to keep it small)."""
        players = []
        for p in self.players.values():
            flags = p.alive | p.charging << 1 | p.has_ball << 2 | p.bot << 3 | (now < p.invuln_until) << 4
            acting = p.action is not None and now <= p.action_end
            players.append([
                p.id, p.name, p.team, round(p.x, 2), round(p.z, 2), round(p.yaw, 3), round(p.pitch, 3),
                round(p.hp), round(p.stamina, 1), p.cash, flags,
                ACTION_CODE[p.action] if acting else 0,
                round(now - p.action_start, 3) if acting else 0,
                round(max(0.0, p.ball_ready_at - now), 2),
                p.tp,
                round(clamp((now - p.charge_started_at) / C.CHARGE_TIME, 0.0, 1.0), 2) if p.charging else 0,
                [p.stats[k] for k in STAT_KEYS],
            ])
        balls = []
        for b in self.balls.values():
            v = (0.0, 0.0, 0.0) if b.state == "pending" else (b.vx, b.vy, b.vz)
            balls.append([b.id, round(b.x, 2), round(b.y, 2), round(b.z, 2),
                          round(v[0], 2), round(v[1], 2), round(v[2], 2),
                          b.rally, b.team, b.target or 0, BALL_STATE_CODE[b.state], b.owner])
        if self.state == "play":
            left = C.ROUND_TIME_LIMIT - (now - self.round_started)
        elif self.state in ("count", "over"):
            left = self.state_until - now
        else:
            left = 0.0
        events, self.events = self.events, []
        return {
            "t": "s", "st": round(now, 4),
            "r": {"s": self.state, "n": self.round_no, "left": round(max(0.0, left), 1), "score": self.score,
                  "w": self.last_winner, "fill": self.bot_fill, "skill": self.bot_skill,
                  "rc": [self.revive_cost(0), self.revive_cost(1)],
                  "court": [round(self.half_length, 2), round(self.half_width, 2)]},
            "p": players, "b": balls, "e": events,
        }
