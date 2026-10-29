"""Authoritative game rules: players, balls, defensive timing, rounds and the lobby.

Plain synchronous Python driven by explicit timestamps, so the server loop and the tests
run it exactly the same way. Nothing in here touches the network.

Every number comes from self.rules (rules.py), which the host can change from the lobby:
in the lobby a change applies at once, during a match it waits for the next round. A player
plays by p.rules: the same set, or (with their own settings) theirs on top of it.
States: lobby (warm-up, the host sets things up) -> count -> play -> over -> count ...
until a team wins the match or the host ends it (back to the lobby). "wait" = a match is on
but one team is empty: free play until both teams have someone again.

Coordinates: y is up, RED lives at negative x, BLUE at positive x. A yaw of 0 faces +z;
forward(yaw) = (sin yaw, cos yaw) and the player's right is (-cos yaw, sin yaw).
"""
from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field

import bots
from rules import Rules, clean_name, display_name

ACTION_CODE = {"dodge": 1, "catch": 2, "deflect": 3}
BALL_STATE_CODE = {"live": 0, "pending": 1, "dead": 2}
TEAM_NAMES = ("RED", "BLUE")
WATCHING = -1                        # the team of a player who spectates instead of playing (the host)
STAT_KEYS = ("hits", "kos", "catches", "deflects", "perfects", "outs")
HOST_ONLY = {"rules", "start", "end", "move", "shuffle", "spectate"}
FREE_PLAY = ("lobby", "wait")        # no round running: warm-up, the downed stand back up

CAPSULE_Y0, CAPSULE_Y1 = 0.25, 1.45   # hit capsule = this vertical segment + PLAYER_RADIUS
HAND_UP, HAND_FWD, HAND_RIGHT = 1.45, 0.3, 0.32
DEAD_GRAVITY = 18.0                   # dead balls drop quickly out of the way
DEAD_BALL_TIME = 1.6
RECENT_TEAMS_KEPT = 64
# Why a ball got through, for the hit popup. Labels only: they never change who gets hit.
TOO_EARLY_WITHIN = 0.5               # their last press had ended at most this long before the ball came
SECOND_BALL_WITHIN = 0.5             # they had stopped another ball at most this long before
# Standing still (health regeneration): staying within this of where you stopped isn't walking, and a
# report up to DASH_REPORT_GRACE after a dodge's dash ended still carries the end of the dash.
STILL_EPSILON = 0.02
DASH_REPORT_GRACE = 0.06


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


def launch_velocity(frm, to, speed, gravity, reach_max=True):
    """Velocity that carries a ball from `frm` through `to` at `speed`, on the flatter of the
    two gravity arcs. Out of reach: the longest (45 degree) throw if `reach_max`, else None."""
    dx, dy, dz = to[0] - frm[0], to[1] - frm[1], to[2] - frm[2]
    d = math.hypot(dx, dz)
    g = gravity
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


def _int(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _vec3(value):
    if isinstance(value, (list, tuple)) and len(value) == 3:
        v = tuple(_num(c, math.nan) for c in value)
        if all(math.isfinite(c) for c in v):
            return v
    return None


def _clean_name(name, fallback):
    return clean_name(name) or fallback


@dataclass
class Player:
    id: int
    name: str
    team: int                       # 0 RED, 1 BLUE, WATCHING
    bot: bool = False
    host: bool = False              # may set up the lobby: rules, bots, teams, start/end
    x: float = 0.0
    z: float = 0.0
    yaw: float = 0.0
    pitch: float = 0.0
    vx: float = 0.0                 # smoothed velocity, used by bots to lead their throws
    vz: float = 0.0
    prev_x: float = 0.0
    prev_z: float = 0.0
    hp: float = 0.0
    stamina: float = 0.0
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
    action_end: float = -99.0       # the action is over: window + recovery
    lockout_end: float = -99.0      # another defence (or a throw) may start: window + recovery, x LOCKOUT_SCALE
    perfect_paid: bool = False
    press_end: float = -99.0        # when their latest press's window ended (view timeline), kept after it
    press_met: bool = False         # that press dodged, caught or deflected a ball
    defended_at: float = -99.0      # when they last dodged, caught or deflected a ball
    dash_dir: tuple = (0.0, 0.0)
    dodge_from: tuple = (0.0, 0.0)  # where a dodge started: a ball reaching it was dodged
    last_spend: float = -99.0
    hurt_at: float = -99.0          # when they were last hit (or came back in): health regeneration waits after it
    still_since: float = 0.0        # when they last walked (server clock): standing still since then...
    still_x: float = 0.0            # ...where they stopped
    still_z: float = 0.0
    dash_until: float = -99.0       # when their latest dodge's dash ended (their own timeline, like action_start)
    invuln_until: float = 0.0
    aim: tuple | None = None        # world point under the player's crosshair
    aim_target: int | None = None   # enemy their client highlighted for aim assist
    view_lag: float = 0.1           # how far behind the server this player's screen is
    tp: int = 0                     # bumped on server teleports (spawn, revive)
    next_team: int | None = None    # the host moved them; applies when the next round starts
    stats: dict = field(default_factory=lambda: dict.fromkeys(STAT_KEYS, 0))
    seen: deque = field(default_factory=lambda: deque(maxlen=48))   # (view time, x, z): where they were on their own screen
    brain: object = None
    rules: Rules | None = None      # the rules they play by: everyone's, or theirs on top (Game._refresh_rules)
    slot: int = -1                  # a bot's place on its team (0 = first): it gives the bot its name


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
    curve: float                    # how hard aim assist / ricochet seeking bends it: rad/s at full-charge
                                    # speed (rules.curve_share scales it to the ball's speed)
    target: int | None = None       # aim-assist target (None = flies free)
    rally: int = 0                  # deflections so far
    bounces: int = 0                # floor/wall ricochets since the last throw or deflect
    state: str = "live"             # live | pending | dead
    ignore: set = field(default_factory=set)   # players it already passed through
    pending_pid: int | None = None
    contact_t: float = 0.0
    deadline: float = 0.0
    dead_since: float = 0.0
    rules: Rules | None = None      # its thrower's (or deflector's) rules: how hard it hits and curves

    @property
    def speed(self):
        return math.sqrt(self.vx * self.vx + self.vy * self.vy + self.vz * self.vz)


class Game:
    def __init__(self, seed=None, rules=None):
        self.rng = random.Random(seed)
        self.rules = rules or Rules()
        self.next_rules = None          # changed mid-match: becomes self.rules when the next round starts
        self.rules_version = 0          # bumped on every change, so the server re-sends the rules
        self.players: dict[int, Player] = {}
        self.balls: dict[int, Ball] = {}
        self.events: list[dict] = []
        self._next_id = 1
        self.state = "lobby"            # lobby | count | play | over | wait
        self.state_until = 0.0
        self.round_no = 0
        self.round_started = 0.0
        self.score = [0, 0]
        self.last_winner = None
        self.match_winner = None        # set when a round decides the match
        self.match_result = None        # [winner (None = ended by the host), red, blue] of the last match
        self.team_revives = [0, 0]      # revives bought this round, per team (prices escalate)
        self.team_cash = [0, 0]         # each team's pot, used while TEAM_CASH is on
        self.team_hp = [0.0, 0.0]       # each team's shared health bar, used while TEAM_HEALTH is on...
        self.team_hp_max = [0.0, 0.0]   # ...and how much it holds
        self.team_heals = [0, 0]        # health packs bought this round, per team (prices escalate)
        self.team_hurt_at = [-99.0, -99.0]  # when anyone on each team was last hit: the bar's regeneration waits
        self.recent_teams: dict[str, int] = {}     # name -> team, so a reconnecting player keeps theirs
        self.bots_play_alone = False    # tests let bots play without humans
        self.half_length, self.half_width = self._court_size(1)

    # Bot settings are rules like any other; these keep tests short.
    @property
    def bots_each(self):
        return self.rules.BOTS_RED, self.rules.BOTS_BLUE

    @bots_each.setter
    def bots_each(self, value):
        """The same number of bots on both teams."""
        self.rules.BOTS_RED = self.rules.BOTS_BLUE = value

    @property
    def bot_skill(self):
        return self.rules.BOT_SKILL

    # ------------------------------------------------------------------ court

    def _court_size(self, team_size):
        R = self.rules
        n = max(1, team_size)
        return (R.COURT_HALF_LENGTH_BASE + R.COURT_HALF_LENGTH_PER_PLAYER * n,
                R.COURT_HALF_WIDTH_BASE + R.COURT_HALF_WIDTH_PER_PLAYER * n)

    def _fit_court(self, shrink):
        """Size the court for the biggest team. It grows at once, but only shrinks when allowed
        (between rounds), so nobody gets squeezed by a wall mid-round."""
        biggest = max(sum(p.team == t for p in self.players.values()) for t in (0, 1))
        length, width = self._court_size(biggest)
        if not shrink:
            length, width = max(length, self.half_length), max(width, self.half_width)
        self.half_length, self.half_width = length, width

    def clamp_to_half(self, team, x, z):
        r, gap = self.rules.PLAYER_RADIUS, self.rules.CENTER_GAP
        if team == 0:
            x = clamp(x, -self.half_length + r, -gap)
        else:
            x = clamp(x, gap, self.half_length - r)
        return x, clamp(z, -self.half_width + r, self.half_width - r)

    # ------------------------------------------------------------------ players

    def add_player(self, name, team, now, bot=False, host=False, slot=-1):
        pid = self._new_id()
        name = _clean_name(name, f"Player {pid}")
        if team not in (0, 1) or isinstance(team, bool):
            team = None if bot else self.recent_teams.get(name)
            if team is None:
                team = self._auto_team()
        p = Player(id=pid, name=name, team=team, bot=bot, host=host, slot=slot)
        p.rules = self.rules.for_player(name)       # their own settings, if the host gave them any
        p.hp, p.stamina = p.rules.MAX_HP, p.rules.MAX_STAMINA
        if bot:
            p.brain = bots.Brain()
        self.players[pid] = p
        self._fit_court(shrink=False)
        self._spawn(p, now)
        self._resize_team_health()      # with the bar added up, they bring their share
        if not bot:
            self._remember_team(p)
            self._event(now, "join", p=pid, name=p.name, team=team)
            self._sync_bots(now)        # the first person in brings the host's bots along
        return p

    def remove_player(self, pid, now):
        p = self.players.pop(pid, None)
        if p is not None and not p.bot:
            self._remember_team(p)
            self._event(now, "leave", p=pid, name=p.name)
        self._fit_court(shrink=self.state in FREE_PLAY)
        self._resize_team_health()

    def _remember_team(self, p):
        team = p.team if p.next_team is None else p.next_team
        if team == WATCHING:
            return          # keep the team they had, to come back to
        self.recent_teams.pop(p.name, None)
        self.recent_teams[p.name] = team
        while len(self.recent_teams) > RECENT_TEAMS_KEPT:
            self.recent_teams.pop(next(iter(self.recent_teams)))

    def _auto_team(self):
        def load(team):
            members = [p for p in self.players.values() if p.team == team]
            return sum(not p.bot for p in members), len(members), team
        return min((0, 1), key=load)

    def _spawn(self, p, now, slot=None, count=1):
        side = -1.0 if p.team == 0 else 1.0
        depth = self.half_length * self.rules.SPAWN_FRACTION
        if slot is None:
            x = side * self.rng.uniform(depth - 2.0, depth + 1.5)
            z = self.rng.uniform(-self.half_width + 1.5, self.half_width - 1.5)
        else:
            spacing = min(2.5, max(0.0, 2 * self.half_width - 3) / max(1, count - 1))
            x, z = side * depth, (slot - (count - 1) / 2) * spacing
        p.x, p.z = self.clamp_to_half(p.team, x, z)
        p.prev_x, p.prev_z, p.vx, p.vz = p.x, p.z, 0.0, 0.0
        p.still_x, p.still_z = p.x, p.z
        p.yaw, p.pitch = (math.pi / 2 if p.team == 0 else -math.pi / 2), 0.0   # face the enemy
        p.has_ball, p.ball_ready_at = True, now
        p.charging = False
        p.action, p.action_end, p.lockout_end = None, -99.0, -99.0
        p.press_end, p.press_met, p.defended_at = -99.0, False, -99.0
        p.hurt_at = now                 # (re)spawning, or revived: regeneration waits its pause first
        p.still_since = now             # and standing still counts from here
        p.seen.clear()
        p.tp += 1

    # ------------------------------------------------------------------ input

    def handle(self, pid, msg, now):
        """Apply one message from a player's browser."""
        p = self.players.get(pid)
        kind = msg.get("t")
        if p is None or not isinstance(kind, str):
            return
        if kind in HOST_ONLY and not p.host:
            return self._deny(p, now, "host")
        wt = self._view_time(p, msg, now)
        if kind == "in":
            self._on_input(p, msg, now, wt)
        elif kind == "charge":
            self.start_charge(p, now, wt)
        elif kind == "throw":
            self._read_aim(p, msg)
            self.throw(p, now, wt)
        elif kind == "cancel":
            p.charging = False
        elif kind == "act" and isinstance(msg.get("a"), str) and msg["a"] in ACTION_CODE:
            self._read_aim(p, msg)
            self.start_action(p, msg["a"], now, wt, self._dash_dir(msg.get("dir")))
        elif kind == "revive":          # R: revive a teammate (with team health: buy health for the bar)
            if self.rules.TEAM_HEALTH:
                self.heal(p, now)
            else:
                self.revive(p, now)
        elif kind == "rules":
            self._host_rules(msg, now)
        elif kind == "start":
            self.start_match(now)
        elif kind == "end":
            self.end_match(now)
        elif kind == "move":
            self.move_player(self.players.get(_int(msg.get("p"))), now)
        elif kind == "shuffle":
            self.shuffle_teams(now)
        elif kind == "spectate":
            self.spectate(p, msg.get("on") is True, now)

    @staticmethod
    def _view_time(p, msg, now):
        # The moment the player was looking at when they pressed (clients render in the
        # past). Bounded, so a client can never claim more than MAX_LAG_COMP of leniency.
        return clamp(_num(msg.get("wt"), now), now - p.rules.MAX_LAG_COMP, now)

    def _on_input(self, p, msg, now, wt):
        p.view_lag += ((now - wt) - p.view_lag) * 0.1
        self._read_aim(p, msg)
        # Each browser moves its own player (instant response); the server keeps it legal.
        # Anything sent before the client noticed a teleport (spawn, revive) is stale.
        if p.alive and msg.get("tp") == p.tp:
            p.x, p.z = self.clamp_to_half(p.team, _num(msg.get("x"), p.x), _num(msg.get("z"), p.z))
            self._track_still(p, now, wt > p.dash_until + DASH_REPORT_GRACE)
            p.yaw = _num(msg.get("yaw"), p.yaw)
            p.pitch = clamp(_num(msg.get("pitch"), p.pitch), -1.5, 1.5)
            if not p.seen or wt >= p.seen[-1][0]:
                p.seen.append((wt, p.x, p.z))     # for sidestep compensation

    @staticmethod
    def _read_aim(p, msg):
        aim = _vec3(msg.get("aim"))
        if aim is not None:
            p.aim = aim
        p.aim_target = _int(msg.get("tg"))

    @staticmethod
    def _dash_dir(value):
        if isinstance(value, (list, tuple)) and len(value) == 2:
            x, z = _num(value[0], 0.0), _num(value[1], 0.0)
            length = math.hypot(x, z)
            if length > 1e-6:
                return x / length, z / length
        return None

    def _combat_open(self):
        return self.state in ("lobby", "wait", "play")

    # ------------------------------------------------------------------ throwing

    def start_charge(self, p, now, wt):
        if p.alive and self._combat_open() and p.has_ball and not p.charging and now >= p.lockout_end:
            p.charging = True
            p.charge_start = wt
            p.charge_started_at = now

    def throw(self, p, now, wt):
        R = p.rules
        if not p.alive or not self._combat_open():
            return self._deny(p, now, "round")
        if not p.has_ball:
            return self._deny(p, now, "noball")
        if now < p.lockout_end:
            return self._deny(p, now, "busy")
        held = clamp(wt - p.charge_start, 0.0, R.CHARGE_TIME) if p.charging else 0.0
        p.charging = False
        power = held / R.CHARGE_TIME
        if p.stamina < R.throw_cost(power):
            # Throw as hard as the remaining stamina allows.
            span = R.THROW_COST_MAX - R.THROW_COST_MIN
            power = (p.stamina - R.THROW_COST_MIN) / span if span > 0 else -1.0
            if power < 0:
                return self._deny(p, now, "stamina")
        self._spend(p, R.throw_cost(power), now)
        p.has_ball = False
        p.ball_ready_at = now + R.THROW_COOLDOWN
        hand = self._hand(p)
        speed = R.throw_speed(power)
        vel, straight = self._aimed_velocity(p, hand, speed)
        b = Ball(id=self._new_id(), owner=p.id, team=p.team, x=hand[0], y=hand[1], z=hand[2],
                 vx=vel[0], vy=vel[1], vz=vel[2], born=now, curve=math.radians(R.ASSIST_TURN_RATE_DEG),
                 target=self._assist_target(p, hand, straight, R.ASSIST_CONE_DEG), rules=R)
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
        vel = launch_velocity(hand, aim, speed, self.rules.GRAVITY) or tuple(c * speed for c in straight)
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
        R = p.rules
        best, best_ang = None, cone
        for e in self.players.values():
            if not e.alive or e.team == p.team:
                continue
            to = norm3(e.x - hand[0], R.CHEST_HEIGHT - hand[1], e.z - hand[2])
            if to is None or math.hypot(e.x - hand[0], e.z - hand[2]) > R.ASSIST_RANGE:
                continue
            ang = angle_deg(d, to)
            if e.id == p.aim_target:
                ang -= R.ASSIST_SLACK_DEG   # favour the enemy the player saw highlighted
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
        spec = p.rules.actions[kind]
        if not p.alive or not self._combat_open():
            return self._deny(p, now, "round")
        if now < p.lockout_end:
            return self._deny(p, now, "busy")
        if p.stamina < spec.cost:
            return self._deny(p, now, "stamina")
        self._spend(p, spec.cost, now)
        p.charging = False
        p.action = kind
        p.action_start = now if p.bot else wt
        p.action_end = p.action_start + spec.window + spec.recovery
        # The lockout may end before the window does (LOCKOUT_SCALE < 1): a new press then takes over.
        p.lockout_end = p.action_start + (spec.window + spec.recovery) * p.rules.LOCKOUT_SCALE
        p.perfect_paid = False
        p.press_end, p.press_met = p.action_start + spec.window, False
        if kind == "dodge":
            fx, fz = forward(p.yaw)
            p.dash_dir = dash_dir or (-fx, -fz)
            p.dodge_from = (p.x, p.z)
            p.dash_until = p.action_start + p.rules.DODGE_DASH_TIME
        self._check_pending(now)    # a ball may already be waiting on this very input
        return True

    def _action_at(self, p, t):
        """The defensive action that was active at time `t`, if any. A person's press counts from
        PRESS_GRACE before it: their screen was drawn a moment before their finger moved."""
        if p.action is None:
            return None
        grace = 0.0 if p.bot else p.rules.PRESS_GRACE
        if p.action_start - grace <= t <= p.action_start + p.rules.actions[p.action].window:
            return p.action
        return None

    @staticmethod
    def _graced(p, t):
        """For the event: the defence counted only because of the press grace."""
        return {"graced": True} if t < p.action_start else {}

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
        lag_comp = p.rules.MAX_LAG_COMP
        b.deadline = t if p.bot else t + clamp(p.view_lag + 0.03, min(0.05, lag_comp + 0.03), lag_comp + 0.03)
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
            elif self._stepped_clear(b, p, now):
                self._let_through(b, p, now)
            elif now >= b.deadline:
                b.state = "live"
                self._hit(b, p, b.contact_t, now)

    def _screen_position(self, p, t, final):
        """Where `p` was on their own screen when it showed the world at time `t`, from their
        input reports. None while no report from that moment has arrived yet (unless `final`:
        then the latest report). Bots and players with no reports: None."""
        seen = p.seen
        if not seen:
            return None
        if seen[-1][0] < t:
            return seen[-1][1:] if final else None
        prev = None
        for wt, x, z in seen:
            if wt >= t:
                if prev is None or wt <= prev[0]:
                    return x, z
                k = (t - prev[0]) / (wt - prev[0])
                return prev[1] + (x - prev[1]) * k, prev[2] + (z - prev[2]) * k
            prev = (wt, x, z)
        return None

    def _screen_gap(self, b, p, t, final):
        """How far the waiting ball `b` was from `p`'s body on their own screen at contact time `t`
        (negative: touching), or None if not known."""
        pos = self._screen_position(p, t, final)
        if pos is None:
            return None
        return self._capsule_dist(b, *pos) - (self.rules.PLAYER_RADIUS + self.rules.BALL_RADIUS)

    def _stepped_clear(self, b, p, now):
        """Sidestep compensation: on their own screen the player had already moved out of the
        ball's way when it got there (their reports from that moment have arrived)."""
        if p.bot or not p.rules.SIDESTEP_COMP:
            return False
        gap = self._screen_gap(b, p, b.contact_t, final=now >= b.deadline)
        return gap is not None and gap > 0

    def _let_through(self, b, p, now):
        """The ball flies on past a player who sidestepped it on their screen, from where it would
        be by now (it waited at the contact point for their report)."""
        b.state = "live"
        b.ignore.add(p.id)
        self._event(b.contact_t, "sidestep", p=p.id, b=b.id)
        if now > b.contact_t:
            self._fly(b, b.contact_t, now - b.contact_t)

    def _dodged(self, b, p, t):
        R = p.rules
        b.ignore.add(p.id)
        if b.target == p.id:
            b.target = None
        spec = R.actions["dodge"]
        perfect = t - p.action_start <= spec.perfect and not p.perfect_paid
        cash = R.CASH_PERFECT_DODGE if perfect else 0
        if perfect:
            p.perfect_paid = True
            self._refund(p, spec.cost - spec.perfect_cost)
            self._earn(p, cash)
            p.stats["perfects"] += 1
        p.press_met, p.defended_at = True, t
        self._event(t, "dodge", p=p.id, perfect=perfect, cash=cash, **self._graced(p, t))

    def _caught(self, b, p, t):
        R = p.rules
        spec = R.actions["catch"]
        perfect = t - p.action_start <= spec.perfect
        if perfect:
            self._refund(p, spec.cost - spec.perfect_cost)
        cash = (R.CASH_PERFECT_CATCH if perfect else R.CASH_CATCH) + R.CASH_RALLY_BONUS * b.rally
        self._earn(p, cash)
        p.stats["catches"] += 1
        p.stats["perfects"] += perfect
        p.has_ball = True                   # the caught ball is yours: throw it right away
        graced = self._graced(p, t)
        p.action, p.action_end, p.lockout_end = None, t, t     # hands are free again immediately
        self.balls.pop(b.id, None)
        p.press_met, p.defended_at = True, t
        self._event(t, "catch", p=p.id, by=b.owner, perfect=perfect, rally=b.rally, cash=cash, **graced)

    def _deflected(self, b, p, t):
        R = p.rules
        spec = R.actions["deflect"]
        perfect = t - p.action_start <= spec.perfect
        if perfect:
            self._refund(p, spec.cost - spec.perfect_cost)
        cash = (R.CASH_PERFECT_DEFLECT if perfect else R.CASH_DEFLECT) + R.CASH_RALLY_BONUS * b.rally
        self._earn(p, cash)
        p.stats["deflects"] += 1
        p.stats["perfects"] += perfect
        thrower = self.players.get(b.owner)
        # Nobody aimed (e.g. a bot without a plan): send it straight back at the thrower.
        fallback = (thrower.x, R.CHEST_HEIGHT, thrower.z) if thrower else None
        hand = self._hand(p)
        speed = min(b.speed * R.DEFLECT_SPEEDUP, R.BALL_SPEED_CAP)
        vel, straight = self._aimed_velocity(p, hand, speed, fallback)
        b.x, b.y, b.z = hand
        b.vx, b.vy, b.vz = vel
        b.team, b.owner, b.rules = p.team, p.id, R
        b.rally += 1
        b.bounces = 0
        b.curve = math.radians(R.ASSIST_TURN_RATE_DEG)
        b.target = self._assist_target(p, hand, straight, R.DEFLECT_ASSIST_CONE_DEG)
        b.ignore = set()
        b.born = t
        b.state = "live"
        graced = self._graced(p, t)
        p.action, p.action_end, p.lockout_end = None, t, t
        p.press_met, p.defended_at = True, t
        self._event(t, "deflect", p=p.id, perfect=perfect, rally=b.rally, cash=cash, speed=round(speed, 1), **graced)

    def _hit(self, b, p, t, now):
        speed = b.speed
        dmg = round((b.rules or self.rules).damage_for(speed))    # the thrower's damage numbers
        shared = self.rules.TEAM_HEALTH and p.team in (0, 1)
        if shared:      # team health: it comes off the team's bar, and an empty bar takes everyone down
            self.team_hp[p.team] = max(0.0, self.team_hp[p.team] - dmg)
            self.team_hurt_at[p.team] = t
            ko = self.team_hp[p.team] <= 0
        else:
            p.hp = max(0.0, p.hp - dmg)
            p.hurt_at = t
            ko = p.hp <= 0
        fallen = []
        if ko:          # with team health the whole team goes down together
            fallen = [q for q in self.players.values() if q.team == p.team and q.alive] if shared else [p]
        owner = self.players.get(b.owner)
        earned = 0
        if owner is not None and owner.team != p.team:
            earned = owner.rules.CASH_HIT + (owner.rules.CASH_KO if ko else 0)
            self._earn(owner, earned)
            owner.stats["hits"] += 1
            owner.stats["kos"] += len(fallen)
        for q in fallen:
            self._knock_out(q, now)
        bank = b.bounces > 0
        gap = None if p.bot else self._screen_gap(b, p, t, final=True)    # for the log: clear on their screen?
        why = {}
        if not p.press_met and 0 < t - p.press_end <= TOO_EARLY_WITHIN:
            why["early"] = round(max(t - p.press_end, 0.01), 2)     # their press had just ended
        elif 0 <= t - p.defended_at <= SECOND_BALL_WITHIN:
            why["second"] = True      # right behind a ball they stopped: a catch or deflect stops only one
        self._kill(b, t, (-b.vx * 0.2, 2.5, -b.vz * 0.2))     # bounce off the body
        self._event(t, "hit", p=p.id, by=b.owner, b=b.id, dmg=dmg, ko=ko, rally=b.rally, cash=earned,
                    speed=round(speed, 1), bank=bank, **why, **({} if gap is None else {"gap": round(gap, 2)}),
                    **({"bar": True} if shared else {}))

    @staticmethod
    def _knock_out(p, now):
        p.alive = False
        p.down_since = now
        p.charging = False
        p.action = None
        p.stats["outs"] += 1

    # ------------------------------------------------------------------ revive, and team health

    def revive(self, p, now):
        if not p.alive or self.state != "play":
            return self._deny(p, now, "round")
        fallen = [q for q in self.players.values() if q.team == p.team and not q.alive]
        if not fallen:
            return self._deny(p, now, "nobody")
        cost = self.revive_cost(p.team)
        if self.cash_of(p) < cost:
            return self._deny(p, now, "cash")
        q = min(fallen, key=lambda q: q.down_since)
        self._earn(p, -cost)
        self.team_revives[p.team] += 1
        R = q.rules                         # how a revive treats them: their own settings
        q.alive, q.hp, q.stamina = True, min(R.REVIVE_HP, R.MAX_HP), R.MAX_STAMINA
        q.invuln_until = now + R.REVIVE_INVULN
        self._spawn(q, now)
        self._event(now, "revive", p=q.id, by=p.id, cost=cost)
        return q

    def revive_cost(self, team):
        return self.rules.REVIVE_COST + self.rules.REVIVE_COST_STEP * self.team_revives[team]

    def heal(self, p, now):
        """Team health: R spends cash on health for the team's bar, a pack at a time (at a price
        that rises with each pack the team buys in a round) or all the cash it takes, up to a full
        bar. Returns the health bought, or None."""
        R = self.rules
        if not p.alive or self.state != "play" or p.team not in (0, 1):
            return self._deny(p, now, "round")
        team = p.team
        missing = self.team_hp_max[team] - self.team_hp[team]
        if missing < 0.5:
            return self._deny(p, now, "full")
        cash = self.cash_of(p)
        if R.TEAM_HEAL_MODE == "pack":
            cost = self.heal_cost(team)
            if cash < cost:
                return self._deny(p, now, "cash")
            amount = min(R.TEAM_HEAL_AMOUNT, missing)
            self.team_heals[team] += 1
        else:
            cost = min(cash, math.ceil(missing / R.TEAM_HEAL_PER_CASH - 1e-9))    # only what the bar is missing
            if cost <= 0:
                return self._deny(p, now, "cash")
            amount = min(missing, cost * R.TEAM_HEAL_PER_CASH)
        self._earn(p, -cost)
        self.team_hp[team] += amount
        self._event(now, "heal", p=p.id, team=team, hp=round(amount), cost=cost)
        return amount

    def heal_cost(self, team):
        """What a team's next health pack costs this round."""
        return self.rules.TEAM_HEAL_COST + self.rules.TEAM_HEAL_COST_STEP * self.team_heals[team]

    def health_share(self, p):
        """How much health `p` has left, 0-1: their own, or with team health their team's bar."""
        if self.rules.TEAM_HEALTH and p.team in (0, 1):
            return self.team_hp[p.team] / self.team_hp_max[p.team] if self.team_hp_max[p.team] > 0 else 0.0
        return p.hp / p.rules.MAX_HP

    def _team_health_size(self, team):
        R = self.rules
        if R.TEAM_HEALTH_SIZE == "fixed":
            return float(R.TEAM_HEALTH_FIXED)
        return float(sum(p.rules.MAX_HP for p in self.players.values() if p.team == team))

    def _fill_team_health(self, team=None):
        """Each team's bar (or one team's) full, at the size the rules give it."""
        for t in (0, 1) if team is None else (team,):
            self.team_hp_max[t] = self.team_hp[t] = self._team_health_size(t)

    def _resize_team_health(self):
        """Someone joined or left a team. With the bar added up it changes size: a newcomer brings
        their health with them, and a leaver takes their share of what's left (the bar stays as
        full as it was, so leaving never heals a team)."""
        for t in (0, 1):
            size, old = self._team_health_size(t), self.team_hp_max[t]
            if size > old:
                self.team_hp[t] += size - old
            elif size < old:
                self.team_hp[t] *= size / old
            self.team_hp_max[t] = size

    def cash_of(self, p):
        """What `p` can spend: their own cash, or their team's pot with shared team cash."""
        if self.rules.TEAM_CASH and p.team in (0, 1):
            return self.team_cash[p.team]
        return p.cash

    def _earn(self, p, amount):
        """Cash in (or, negative, out): into the team's pot with shared team cash, else theirs."""
        if self.rules.TEAM_CASH and p.team in (0, 1):
            self.team_cash[p.team] += amount
        else:
            p.cash += amount

    def _regroup_cash(self, shared):
        """Shared team cash was switched on (everyone's cash goes into the pot) or off (the pot is
        shared out evenly), so no cash appears or vanishes."""
        for team in (0, 1):
            members = sorted((p for p in self.players.values() if p.team == team), key=lambda p: p.id)
            if shared:
                self.team_cash[team] += sum(p.cash for p in members)
                for p in members:
                    p.cash = 0
            elif members:
                share, extra = divmod(self.team_cash[team], len(members))
                for i, p in enumerate(members):
                    p.cash += share + (i < extra)
                self.team_cash[team] = 0

    # ------------------------------------------------------------------ the host's lobby controls

    def start_match(self, now):
        """Lobby -> the first countdown. Scores start from zero."""
        if self.state != "lobby":
            return
        self.score, self.round_no, self.last_winner = [0, 0], 0, None
        self.match_winner = self.match_result = None
        for p in self.players.values():
            p.cash = 0                  # warm-up cash doesn't count
        self.team_cash = [0, 0]
        self._event(now, "match", s="start")
        self._start_countdown(now)

    def end_match(self, now, winner=None):
        """Back to the lobby, because the host ended the match or a team won it (`winner`)."""
        if self.state == "lobby":
            return
        self.match_result = [winner, *self.score]
        self.state, self.match_winner = "lobby", None
        self.balls.clear()
        self._apply_team_moves()
        if self.next_rules is not None:
            self._activate(self.next_rules)
        self._sync_bots(now)
        self._line_up(now)
        self._event(now, "match", s="end", w=winner, score=list(self.score))

    def set_rules(self, values, now):
        """The host's rule edits. In free play (lobby, waiting) they apply at once; during a
        match they wait for the next round. Returns the keys that changed."""
        return self._change_rules(lambda target: target.update(values), now)

    def set_player_rules(self, name, values, now, replace=False):
        """The host's edits to one player's (or bot's) own settings, {key: value or None for
        everyone's value}; `replace`: these become all of their own settings. When they apply:
        like any rule change. Returns what changed, as (name, key) pairs."""
        if replace:
            return self._change_rules(lambda target: target.set_player(name, values), now)
        return self._change_rules(lambda target: target.update_player(name, values), now)

    def import_rules(self, data, now):
        """The host loaded a settings file: its rules (any it leaves out go back to their default)
        and every player's own settings replace the current ones."""
        if not isinstance(data, dict):
            return []
        return self._change_rules(lambda target: target.replace(data.get("rules"), data.get("players")), now)

    def _change_rules(self, edit, now):
        """Apply `edit` (it changes a copy of the rules and returns what changed: rule keys and
        (name, key) pairs for players' own settings): at once in free play, else next round."""
        target = (self.next_rules or self.rules).copy()
        changed = edit(target)
        if not changed:
            return changed
        later = self.state not in FREE_PLAY
        if later:
            same = not target.differences(self.rules) and not target.player_differences(self.rules)
            self.next_rules = None if same else target
            self.rules_version += 1
        else:
            self._activate(target)
            for p in self.players.values():     # warm-up: everyone feels the new numbers right away
                p.hp, p.stamina = p.rules.MAX_HP, p.rules.MAX_STAMINA
            self._fill_team_health()
            self._sync_bots(now)
        self._event(now, "rules", n=len(changed), names=[self._change_name(c) for c in changed[:3]], next=later)
        return changed

    @staticmethod
    def _change_name(change):
        """A rule key, or a (player, key) pair of their own settings, as messages name it."""
        if isinstance(change, tuple):
            return f"{change[0]} › {display_name(change[1])}"
        return display_name(change)

    def _host_rules(self, msg, now):
        if msg.get("discard"):
            if self.next_rules is not None:
                self.next_rules = None
                self.rules_version += 1
                self._event(now, "rules", n=0, names=[], next=False, discard=True)
            return
        if isinstance(msg.get("player"), str):          # one player's (or bot's) own settings
            values = msg.get("replace") if isinstance(msg.get("replace"), dict) else msg.get("set")
            self.set_player_rules(msg["player"], values, now, replace=isinstance(msg.get("replace"), dict))
        elif isinstance(msg.get("import"), dict):       # a settings file: the whole setup
            self.import_rules(msg["import"], now)
        elif msg.get("reset"):                          # everything back to the defaults, players' own settings too
            self._change_rules(lambda target: target.replace({}, {}), now)
        else:
            self.set_rules(msg.get("set"), now)

    def _activate(self, rules):
        shared_before = self.rules.TEAM_CASH
        self.rules, self.next_rules = rules, None
        self.rules_version += 1
        for p in self.players.values():
            p.rules = rules.for_player(p.name)
        if rules.TEAM_CASH != shared_before:
            self._regroup_cash(rules.TEAM_CASH)

    def pending_changes(self):
        """What waits for the next round: rule keys, and "name: KEY" for players' own settings."""
        if self.next_rules is None:
            return []
        return self.next_rules.differences(self.rules) + [f"{name}: {key}" for name, key in
                                                         self.next_rules.player_differences(self.rules)]

    def move_player(self, p, now):
        """Put a human on the other team: at once in free play, otherwise from the next round
        (moving them again before then cancels the move)."""
        if p is None or p.bot:
            return
        if p.next_team is not None:
            p.next_team = None
            self._remember_team(p)
            self._event(now, "team", p=p.id, team=p.team, now=False, cancel=True)
            return
        if p.team == WATCHING:
            return
        team = 1 - p.team
        self._assign(p, team, now)
        self._event(now, "team", p=p.id, team=team, now=self.state in FREE_PLAY)

    def shuffle_teams(self, now):
        """Deal the players into two random, even teams (at once in free play, else next round).
        Bots stay where the host put them; whoever watches keeps watching."""
        humans = sorted((p for p in self.players.values()
                         if not p.bot and WATCHING not in (p.team, p.next_team)), key=lambda p: p.id)
        self.rng.shuffle(humans)
        first = self.rng.randrange(2)
        for i, p in enumerate(humans):
            self._assign(p, (first + i) % 2, now)
        self._event(now, "shuffle", now=self.state in FREE_PLAY)

    def spectate(self, p, on, now):
        """The host watches the game instead of playing, or comes back to the team they had (or
        the one with fewer people). At once in free play, otherwise from the next round; asking
        again before then cancels it, like a team move."""
        if p is None or p.bot:
            return
        if on:
            team = WATCHING
        elif p.team == WATCHING:
            team = self.recent_teams.get(p.name)
            if team not in (0, 1):
                team = self._auto_team()
        else:
            team = p.team       # playing already (a pending switch to watching gets cancelled)
        if team == (p.team if p.next_team is None else p.next_team):
            return
        self._assign(p, team, now)
        self._event(now, "spectate", p=p.id, on=on, now=self.state in FREE_PLAY)

    def _assign(self, p, team, now):
        """Put `p` on `team` (or WATCHING): at once in free play, else from the next round."""
        if self.state in FREE_PLAY:
            if team != p.team:
                p.team, p.next_team = team, None
                if team == WATCHING:
                    self._stand_down(p)
                else:
                    p.alive, p.hp, p.stamina = True, p.rules.MAX_HP, p.rules.MAX_STAMINA
                    self._spawn(p, now)
                self._resize_team_health()
        else:
            p.next_team = team if team != p.team else None
        self._remember_team(p)
        self._fit_court(shrink=self.state in FREE_PLAY)

    def _apply_team_moves(self):
        """Between rounds: the moves the host asked for during the round happen now."""
        for p in self.players.values():
            if p.next_team is not None:
                p.team, p.next_team = p.next_team, None
                if p.team == WATCHING:
                    self._stand_down(p)

    @staticmethod
    def _stand_down(p):
        """Out of the game to watch: not on a team, never hit, never revived."""
        p.alive, p.charging, p.action = False, False, None

    def _sync_bots(self, now):
        """Each team gets exactly the bots the host set (none while no person is here). Nothing
        else adds, removes or balances them. A team's bots fill its first slots, and each slot has
        its own name, so a bot with its own settings is the same bot whenever its slot is filled."""
        present = self.bots_play_alone or any(not p.bot for p in self.players.values())
        for t in (0, 1):
            wanted = self.rules.bots_for(t) if present else 0
            team_bots = [p for p in self.players.values() if p.bot and p.team == t]
            for extra in [p for p in team_bots if p.slot >= wanted]:
                del self.players[extra.id]
            filled = {p.slot for p in team_bots}
            for slot in range(wanted):
                if slot not in filled:
                    self.add_player(self.bot_name(t, slot), t, now, bot=True, slot=slot)
        self._fit_court(shrink=self.state in FREE_PLAY)
        self._resize_team_health()

    @staticmethod
    def bot_name(team, slot):
        """RED's bots are Ace, Comet, Echo...; BLUE's Blitz, Dash, Flick... (every other name)."""
        names = bots.NAMES[team::2]
        return f"Bot {names[slot]}" if slot < len(names) else f"Bot {TEAM_NAMES[team].title()} {slot + 1}"

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
        self._regen_team_health(t1, dt)
        for b in list(self.balls.values()):
            if b.state == "live":
                self._fly(b, t0, dt)
            elif b.state == "dead":
                self._fall(b, t1, dt)
        self._check_pending(t1)
        self._update_round(t1)

    def _update_player(self, p, now, dt):
        R = p.rules
        k = min(1.0, dt * 8)    # humans report positions at ~30 Hz, so smooth the deltas
        p.vx += ((p.x - p.prev_x) / dt - p.vx) * k
        p.vz += ((p.z - p.prev_z) / dt - p.vz) * k
        if p.bot:                       # (people's steps are seen as their reports arrive)
            self._track_still(p, now, now - dt > p.dash_until)
        p.prev_x, p.prev_z = p.x, p.z
        if not p.alive:
            return
        if not p.has_ball and now >= p.ball_ready_at:
            p.has_ball = True
        if p.charging and now - p.charge_started_at > R.CHARGE_TIME + 3.0:
            p.charging = False      # the release never arrived (e.g. the tab lost focus)
        if p.action is not None and now > p.action_end:
            p.action = None
        defending = p.action is not None and now <= p.action_start + R.actions[p.action].window
        if p.bot and p.action == "dodge" and now < p.action_start + R.DODGE_DASH_TIME:
            step = R.DODGE_DASH_SPEED * dt   # humans dash on their own client
            p.x, p.z = self.clamp_to_half(p.team, p.x + p.dash_dir[0] * step, p.z + p.dash_dir[1] * step)
        if not p.charging and not defending and now - p.last_spend >= R.STAMINA_REGEN_DELAY:
            p.stamina = min(R.MAX_STAMINA, p.stamina + R.STAMINA_REGEN * dt)
        if (R.HEALTH_REGEN and not self.rules.TEAM_HEALTH and self._combat_open()
                and now - p.hurt_at >= R.HEALTH_REGEN_DELAY):
            limit = R.regen_limit(R.MAX_HP)         # it never takes health away above the limit
            if p.hp < limit:
                standing = now - p.still_since >= R.HEALTH_REGEN_STILL_TIME
                p.hp = min(limit, p.hp + R.regen_speed(1 if standing else 0) * dt)

    @staticmethod
    def _track_still(p, now, walking):
        """Standing still, for health regeneration: moving away from where they stopped is walking
        (`walking` False: the move was a dodge's dash, which doesn't count) and starts it over."""
        if math.hypot(p.x - p.still_x, p.z - p.still_z) > STILL_EPSILON:
            if walking:
                p.still_since = now
            p.still_x, p.still_z = p.x, p.z

    def _regen_team_health(self, now, dt):
        """Team health: each bar fills back up by itself once nobody on the team has been hit for a
        while, up to its limit. A team that fell stays down (the warm-up stands it up with a full bar)."""
        R = self.rules
        if not (R.TEAM_HEALTH and R.TEAM_REGEN and self._combat_open()):
            return
        for t in (0, 1):
            if self.team_hp[t] <= 0 or now - self.team_hurt_at[t] < R.TEAM_REGEN_DELAY:
                continue
            limit = R.regen_limit(self.team_hp_max[t], team=True)
            if self.team_hp[t] < limit:
                standing = sum(1 for p in self.players.values()
                               if p.team == t and p.alive and now - p.still_since >= R.TEAM_REGEN_STILL_TIME)
                self.team_hp[t] = min(limit, self.team_hp[t] + R.regen_speed(standing, team=True) * dt)

    def _fly(self, b, t0, dt):
        R = self.rules
        if b.target is not None:
            self._bend(b, dt)
        # Sub-step so fast balls can't tunnel through players, and contact times are precise.
        steps = max(1, math.ceil(b.speed * dt / 0.15))
        h = dt / steps
        hit_r = R.PLAYER_RADIUS + R.BALL_RADIUS
        for i in range(1, steps + 1):
            b.vy -= R.GRAVITY * h
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
                reach = p.rules.CATCH_REACH if kind in ("catch", "deflect") else 0.0
                touching = self._capsule_dist(b, p.x, p.z) <= hit_r + reach
                if not touching and kind == "dodge":
                    # Dashing clean out of the way counts too: the ball hits your afterimage.
                    touching = self._capsule_dist(b, *p.dodge_from) <= hit_r
                if touching and self._contact(b, p, t):
                    return
        if t0 + dt - b.born > R.BALL_LIFETIME:
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
        want = launch_velocity((b.x, b.y, b.z), (t.x, self.rules.CHEST_HEIGHT, t.z), speed, self.rules.GRAVITY,
                               reach_max=False)
        if want is None:
            return                  # out of reach at this speed: it just flies on
        cur = (b.vx / speed, b.vy / speed, b.vz / speed)
        turn = b.curve * (b.rules or self.rules).curve_share(speed) * dt     # slower balls bend less
        new = rotate_toward(cur, (want[0] / speed, want[1] / speed, want[2] / speed), turn)
        b.vx, b.vy, b.vz = new[0] * speed, new[1] * speed, new[2] * speed

    @staticmethod
    def _capsule_dist(b, x, z):
        cy = clamp(b.y, CAPSULE_Y0, CAPSULE_Y1)
        return math.sqrt((b.x - x) ** 2 + (b.y - cy) ** 2 + (b.z - z) ** 2)

    def _hit_world(self, b, t):
        """Floor, side wall or end wall contact. The first floor/side-wall contact ricochets (if
        the ball is still fast enough) and curves toward an enemy ahead, though less than before
        the bounce. End walls (behind each team) just stop it, so nobody gets hit from behind by
        a ball they never saw."""
        R = self.rules
        r = R.BALL_RADIUS
        hx, hz = self.half_length - r, self.half_width - r
        kn, kt = R.RICOCHET_NORMAL_KEEP, R.RICOCHET_TANGENT_KEEP
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
        if b.bounces < R.MAX_RICOCHETS and b.speed >= R.RICOCHET_MIN_SPEED:
            b.bounces += 1
            b.target = self._ricochet_target(b)
            b.curve *= R.RICOCHET_CURVE_KEEP
            self._event(t, "bounce", b=b.id, x=round(b.x, 2), y=round(b.y, 2), z=round(b.z, 2))
        else:
            self._kill(b, t)
        return True

    def _ricochet_target(self, b):
        """After a bounce: the enemy closest to the ball's new heading, within the ricochet cone."""
        hv = math.hypot(b.vx, b.vz)
        if hv < 1e-6:
            return None
        best, best_ang = None, self.rules.RICOCHET_CONE_DEG
        reach = (b.rules or self.rules).ASSIST_RANGE        # the thrower's
        for e in self.players.values():
            if not e.alive or e.team == b.team or e.id in b.ignore:
                continue
            dx, dz = e.x - b.x, e.z - b.z
            d = math.hypot(dx, dz)
            if d < 0.5 or d > reach:
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
        r = self.rules.BALL_RADIUS
        b.vy -= DEAD_GRAVITY * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.z += b.vz * dt
        if b.y < r:
            b.y, b.vy, b.vx, b.vz = r, abs(b.vy) * 0.45, b.vx * 0.7, b.vz * 0.7
        hx, hz = self.half_length - r, self.half_width - r
        if abs(b.x) > hx:
            b.x, b.vx = math.copysign(hx, b.x), -b.vx * 0.5
        if abs(b.z) > hz:
            b.z, b.vz = math.copysign(hz, b.z), -b.vz * 0.5

    # ------------------------------------------------------------------ rounds

    def _update_round(self, now):
        R = self.rules
        if not self.bots_play_alone and not any(not p.bot for p in self.players.values()):
            if self.players or self.state != "lobby":   # nobody human left: back to a fresh lobby
                self.players.clear()
                self.balls.clear()
                self.state = "lobby"
                self.round_no, self.score, self.last_winner = 0, [0, 0], None
                self.match_winner = self.match_result = None
                if self.next_rules is not None:
                    self._activate(self.next_rules)
                self._fit_court(shrink=True)
            return
        ready = all(any(p.team == t for p in self.players.values()) for t in (0, 1))
        if self.state in FREE_PLAY:
            if self.state == "wait" and ready:
                self._start_countdown(now)
                return
            for p in self.players.values():     # warm-up: nobody stays down (except who's watching)
                if not p.alive and p.team != WATCHING and now - p.down_since > R.WARMUP_RESPAWN:
                    p.alive, p.hp, p.stamina = True, p.rules.MAX_HP, p.rules.MAX_STAMINA
                    self._spawn(p, now)
                    if R.TEAM_HEALTH and self.team_hp[p.team] <= 0:     # a team that fell together: a full bar
                        self._fill_team_health(p.team)
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
            elif now - self.round_started >= R.ROUND_TIME_LIMIT:
                if R.TEAM_HEALTH:       # everyone is still standing: more of the bar left wins
                    key = [self.team_hp[t] / self.team_hp_max[t] if self.team_hp_max[t] > 0 else 0.0 for t in (0, 1)]
                else:
                    hp = [sum(p.hp for p in self.players.values() if p.team == t and p.alive) for t in (0, 1)]
                    key = [(alive[t], hp[t]) for t in (0, 1)]
                self._end_round(-1 if key[0] == key[1] else (0 if key[0] > key[1] else 1), now)
        elif self.state == "over" and now >= self.state_until:
            if self.match_winner is not None:
                self.end_match(now, self.match_winner)
            else:
                self._start_countdown(now)

    def _start_countdown(self, now):
        if self.next_rules is not None:
            self._activate(self.next_rules)     # "applies from the next round": this is it
        self._apply_team_moves()
        self._sync_bots(now)
        if not all(any(p.team == t for p in self.players.values()) for t in (0, 1)):
            self.state = "wait"
            return
        self._fit_court(shrink=True)
        first = self.round_no == 0
        self.round_no += 1
        self.balls.clear()
        self.team_revives = [0, 0]
        self.team_heals = [0, 0]
        self._line_up(now)
        R = self.rules
        self.state = "count"
        self.state_until = now + R.COUNTDOWN_TIME + (R.MATCH_START_EXTRA if first else 0.0)
        self._event(now, "round", s="count", n=self.round_no)

    def _line_up(self, now):
        """Everyone back on their feet, fresh, in a line on their side."""
        R = self.rules
        if R.CASH_RESETS_EACH_ROUND:
            self.team_cash = [0, 0]
        for team in (0, 1):
            members = sorted((p for p in self.players.values() if p.team == team), key=lambda p: p.id)
            for slot, p in enumerate(members):
                p.alive, p.hp, p.stamina, p.invuln_until = True, p.rules.MAX_HP, p.rules.MAX_STAMINA, 0.0
                if R.CASH_RESETS_EACH_ROUND:
                    p.cash = 0
                if p.brain is not None:
                    p.brain.reset()
                self._spawn(p, now, slot, len(members))
        self._fill_team_health()

    def _end_round(self, winner, now):
        R = self.rules
        if winner in (0, 1):
            self.score[winner] += 1
        self.last_winner = winner
        decided = winner in (0, 1) and R.MATCH_ROUNDS_TO_WIN > 0 and self.score[winner] >= R.MATCH_ROUNDS_TO_WIN
        self.match_winner = winner if decided else None
        self.state, self.state_until = "over", now + R.ROUND_OVER_TIME
        for b in self.balls.values():
            if b.state != "dead":
                self._kill(b, now)
        for p in self.players.values():
            p.charging = False
        self._event(now, "round", s="over", n=self.round_no, w=winner, **({"m": winner} if decided else {}))

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
        p.stamina = min(p.rules.MAX_STAMINA, p.stamina + amount)

    def snapshot(self, now):
        """Compact world state for the browsers (arrays instead of objects to keep it small)."""
        R = self.rules
        players = []
        for p in self.players.values():
            flags = (p.alive | p.charging << 1 | p.has_ball << 2 | p.bot << 3 | (now < p.invuln_until) << 4
                     | p.host << 5 | (p.next_team is not None) << 6)
            acting = p.action is not None and now <= p.action_end
            players.append([
                p.id, p.name, p.team, round(p.x, 2), round(p.z, 2), round(p.yaw, 3), round(p.pitch, 3),
                round(p.hp), round(p.stamina, 1), self.cash_of(p), flags,
                ACTION_CODE[p.action] if acting else 0,
                round(now - p.action_start, 3) if acting else 0,
                round(max(0.0, p.ball_ready_at - now), 2),
                p.tp,
                round(clamp((now - p.charge_started_at) / p.rules.CHARGE_TIME, 0.0, 1.0), 2) if p.charging else 0,
                [p.stats[k] for k in STAT_KEYS],
                p.next_team,                # where the host's move takes them next round (WATCHING = spectating)
            ])
        balls = []
        for b in self.balls.values():
            v = (0.0, 0.0, 0.0) if b.state == "pending" else (b.vx, b.vy, b.vz)
            balls.append([b.id, round(b.x, 2), round(b.y, 2), round(b.z, 2),
                          round(v[0], 2), round(v[1], 2), round(v[2], 2),
                          b.rally, b.team, b.target or 0, BALL_STATE_CODE[b.state], b.owner])
        if self.state == "play":
            left = R.ROUND_TIME_LIMIT - (now - self.round_started)
        elif self.state in ("count", "over"):
            left = self.state_until - now
        else:
            left = 0.0
        events, self.events = self.events, []
        if R.TEAM_HEALTH:   # what R costs each team: the next health pack (0: all your cash)
            price = [self.heal_cost(t) if R.TEAM_HEAL_MODE == "pack" else 0 for t in (0, 1)]
        else:
            price = [self.revive_cost(0), self.revive_cost(1)]
        return {
            "t": "s", "st": round(now, 4),
            "r": {"s": self.state, "n": self.round_no, "left": round(max(0.0, left), 1), "score": self.score,
                  "w": self.last_winner, "bots": [R.BOTS_RED, R.BOTS_BLUE], "skill": R.BOT_SKILL,
                  "rc": price,
                  "court": [round(self.half_length, 2), round(self.half_width, 2)],
                  "win": R.MATCH_ROUNDS_TO_WIN, "res": self.match_result, "pend": len(self.pending_changes()),
                  "rv": self.rules_version,
                  # team health: each team's bar, [health, size]
                  "th": [[round(self.team_hp[t]), round(self.team_hp_max[t])] for t in (0, 1)] if R.TEAM_HEALTH else None},
            "p": players, "b": balls, "e": events,
        }
