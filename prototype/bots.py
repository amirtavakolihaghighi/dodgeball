"""Server-side bots.

They wander their half, throw at enemies with some aim error, and react to incoming balls
with human-like, imperfect timing, so one person can play and tune the game alone.
"""
from __future__ import annotations

import math

import config as C

SPECS = {"dodge": C.DODGE, "catch": C.CATCH, "deflect": C.DEFLECT}
PROFILES = {
    # react: chance to attempt a defence at all; sd: timing spread (s); aim: aim error (deg);
    # gap: extra pause between throws (s); mix: preference for (dodge, catch, deflect);
    # bank: chance a throw is a ricochet off the floor or a side wall
    "easy": dict(react=0.55, sd=0.09, aim=7.0, gap=(1.6, 3.4), mix=(0.5, 0.45, 0.05), bank=0.05),
    "normal": dict(react=0.8, sd=0.055, aim=3.5, gap=(0.8, 2.2), mix=(0.4, 0.4, 0.2), bank=0.15),
    "hard": dict(react=0.93, sd=0.03, aim=1.8, gap=(0.3, 1.2), mix=(0.3, 0.4, 0.3), bank=0.25),
}
# When bots like to press, as "the ball arrives this long after the press": inside each
# window, close to its perfect zone. The random spread makes them early/late sometimes.
IDEAL_LEAD = {"dodge": 0.15, "catch": 0.15, "deflect": 0.09}
NAMES = ["Ace", "Blitz", "Comet", "Dash", "Echo", "Flick", "Gale", "Hex", "Ion", "Jinx", "Kite", "Lux"]
STAMINA_RESERVE = 30    # bots keep this much for defending before they throw


class Brain:
    def __init__(self):
        self.reset()

    def reset(self):
        self.goal = None
        self.goal_until = 0.0
        self.next_throw = 0.0
        self.release_at = None
        self.throw_target = None
        self.plans = {}         # (ball id, rally) -> [action or None, lead, done]
        self.revive_at = None


def update(game, p, now, dt):
    brain = p.brain
    if not p.alive:
        brain.plans.clear()
        brain.release_at = None
        return
    prof = PROFILES.get(game.bot_skill, PROFILES["normal"])
    threat = _defend(game, p, brain, prof, now)
    _throw(game, p, brain, prof, now, threat)
    _walk(game, p, brain, now, dt)
    _revive(game, p, brain, now)


def time_to_impact(ball, p):
    """Estimate: seconds until `ball` touches `p`, and how close it passes (horizontally)."""
    vx, vz = ball.vx, ball.vz
    vv = vx * vx + vz * vz
    if vv < 1e-6:
        return None, None
    rx, rz = p.x - ball.x, p.z - ball.z
    t = (rx * vx + rz * vz) / vv
    if t < 0:
        return None, None
    miss = math.hypot(rx - vx * t, rz - vz * t)
    height = ball.y + ball.vy * t - 0.5 * C.GRAVITY * t * t
    if height < -0.2 or height > 2.1:
        miss = 99.0     # flies over us or into the floor first
    reach = C.PLAYER_RADIUS + C.BALL_RADIUS
    if miss < reach:
        t -= math.sqrt(reach * reach - miss * miss) / math.sqrt(vv)
    return max(0.0, t), miss


def _defend(game, p, brain, prof, now):
    soonest = None
    for ball in game.balls.values():
        if ball.state != "live" or ball.team == p.team or p.id in ball.ignore:
            continue
        tti, miss = time_to_impact(ball, p)
        if tti is None or tti > 1.2:
            continue
        if ball.target != p.id and miss > C.PLAYER_RADIUS + C.BALL_RADIUS + 0.25:
            continue
        soonest = tti if soonest is None else min(soonest, tti)
        key = (ball.id, ball.rally)     # a deflected ball coming back is a new threat
        plan = brain.plans.get(key)
        if plan is None:
            plan = brain.plans[key] = _plan(game, p, brain, ball, prof, tti, now)
        if plan[0] and not plan[2] and tti <= plan[1]:
            plan[2] = True
            _act(game, p, plan[0], ball, now, prof)
    for key in [k for k in brain.plans if k[0] not in game.balls or game.balls[k[0]].rally != k[1]]:
        del brain.plans[key]
    return soonest


def _plan(game, p, brain, ball, prof, tti, now):
    rng = game.rng
    if rng.random() > prof["react"]:
        return [None, 0.0, True]            # didn't react in time
    if ball.speed < 20 and tti > 0.55 and rng.random() < 0.35:
        _sidestep(game, p, brain, ball, now)    # slow ball: just walk out of the way
        return [None, 0.0, True]
    options = [(k, w) for k, w in zip(SPECS, prof["mix"]) if w > 0 and p.stamina >= SPECS[k].cost]
    if not options:
        return [None, 0.0, True]            # too tired to defend
    kind = rng.choices([k for k, _ in options], [w for _, w in options])[0]
    return [kind, rng.gauss(IDEAL_LEAD[kind], prof["sd"]), False]


def _act(game, p, kind, ball, now, prof):
    dash = None
    if kind == "deflect":
        target = game.players.get(ball.owner)
        if target is None or not target.alive or target.team == p.team:
            target = _pick_target(game, p)
        if target is not None:
            p.aim = _aim_point(game, p, target, ball.speed * C.DEFLECT_SPEEDUP, prof)
            p.aim_target = target.id
    elif kind == "dodge":
        px, pz = -ball.vz, ball.vx          # sideways to the ball, toward the roomier side
        length = math.hypot(px, pz) or 1.0
        px, pz = px / length, pz / length
        if abs(p.z + pz * 3) > game.half_width - 1:
            px, pz = -px, -pz
        dash = (px, pz)
    game.start_action(p, kind, now, now, dash)


def _throw(game, p, brain, prof, now, threat):
    rng = game.rng
    if brain.release_at is not None:
        if not p.charging:                  # interrupted by a defence or the round ending
            brain.release_at = None
        elif now >= brain.release_at:
            target = game.players.get(brain.throw_target)
            if target is None or not target.alive or target.team == p.team:
                target = _pick_target(game, p)
            if target is not None:
                power = min(1.0, (now - p.charge_start) / C.CHARGE_TIME)
                speed = C.THROW_SPEED_MIN + (C.THROW_SPEED_MAX - C.THROW_SPEED_MIN) * power
                bank = _bank_point(game, p, target) if rng.random() < prof["bank"] else None
                p.aim = bank or _aim_point(game, p, target, speed, prof)
                p.aim_target = None if bank else target.id
            else:
                p.aim, p.aim_target = None, None
            game.throw(p, now, now)
            brain.release_at = None
            brain.next_throw = now + C.THROW_COOLDOWN + rng.uniform(*prof["gap"])
        return
    if game.state != "play" or not p.has_ball or now < brain.next_throw or now < p.action_end:
        return
    if threat is not None and threat < 0.7:
        return                              # deal with the incoming ball first
    if p.stamina < C.THROW_COST_MIN + STAMINA_RESERVE:
        return
    target = _pick_target(game, p)
    if target is None:
        return
    spare = (p.stamina - STAMINA_RESERVE - C.THROW_COST_MIN) / (C.THROW_COST_MAX - C.THROW_COST_MIN)
    power = rng.uniform(0.15, 1.0) * min(1.0, spare)
    game.start_charge(p, now, now)
    brain.release_at = now + power * C.CHARGE_TIME
    brain.throw_target = target.id


def _pick_target(game, p):
    enemies = [e for e in game.players.values() if e.alive and e.team != p.team]
    if not enemies:
        return None
    weights = []
    for e in enemies:
        w = 1.0 / (1.0 + math.hypot(e.x - p.x, e.z - p.z) / 10.0)
        if e.stamina < 40:
            w *= 1.6        # tired players can't defend
        if e.hp < 40:
            w *= 1.3
        weights.append(w)
    return game.rng.choices(enemies, weights)[0]


def _aim_point(game, p, target, speed, prof):
    rng = game.rng
    dist = math.hypot(target.x - p.x, target.z - p.z)
    flight = dist / max(speed, 1.0)
    lead = rng.uniform(0.4, 1.0)            # bots don't lead perfectly either
    spread = dist * math.tan(math.radians(prof["aim"]))
    return (target.x + target.vx * flight * lead + rng.gauss(0.0, spread),
            C.CHEST_HEIGHT + rng.gauss(0.0, spread * 0.5),
            target.z + target.vz * flight * lead + rng.gauss(0.0, spread))


def _bank_point(game, p, target):
    """Somewhere on the floor or a side wall that ricochets a throw into `target`, or None."""
    rng = game.rng
    if rng.random() < 0.6:                  # off the floor, part-way to them
        f = rng.uniform(0.45, 0.7)
        return (p.x + (target.x - p.x) * f, 0.0, p.z + (target.z - p.z) * f)
    # Off the nearer side wall: aim at the target's mirror image behind that wall.
    wall = game.half_width if p.z + target.z > 0 else -game.half_width
    mirror_z = 2 * wall - target.z
    if abs(mirror_z - p.z) < 1e-6:
        return None
    f = (wall - p.z) / (mirror_z - p.z)
    if not 0.2 < f < 0.8:
        return None
    return (p.x + (target.x - p.x) * f, C.CHEST_HEIGHT, wall)


def _walk(game, p, brain, now, dt):
    if p.action == "dodge" and now < p.action_start + C.DODGE_DASH_TIME:
        return                              # the dash is moving us
    rng = game.rng
    side = -1.0 if p.team == 0 else 1.0
    goal = brain.goal
    if goal is None or now >= brain.goal_until or math.hypot(goal[0] - p.x, goal[1] - p.z) < 0.3:
        goal = brain.goal = (side * rng.uniform(C.CENTER_GAP + 2.0, game.half_length - 1.5),
                             rng.uniform(-game.half_width + 1.2, game.half_width - 1.2))
        brain.goal_until = now + rng.uniform(1.5, 4.0)
    speed = C.WALK_SPEED * 0.8
    if p.charging:
        speed = C.CHARGE_WALK_SPEED
    elif p.action in ("catch", "deflect"):
        speed = C.DEFEND_WALK_SPEED
    dx, dz = goal[0] - p.x, goal[1] - p.z
    d = math.hypot(dx, dz)
    if d > 1e-3:
        step = min(d, speed * dt)
        p.x, p.z = game.clamp_to_half(p.team, p.x + dx / d * step, p.z + dz / d * step)
    look = game.players.get(brain.throw_target) if p.charging else None
    if look is None:
        enemies = [e for e in game.players.values() if e.alive and e.team != p.team]
        look = min(enemies, key=lambda e: math.hypot(e.x - p.x, e.z - p.z), default=None)
    if look is not None:
        p.yaw = math.atan2(look.x - p.x, look.z - p.z)


def _sidestep(game, p, brain, ball, now):
    px, pz = -ball.vz, ball.vx
    length = math.hypot(px, pz) or 1.0
    sign = 1.0 if game.rng.random() < 0.5 else -1.0
    brain.goal = game.clamp_to_half(p.team, p.x + px / length * 3 * sign, p.z + pz / length * 3 * sign)
    brain.goal_until = now + 1.2


def _revive(game, p, brain, now):
    can = (game.state == "play" and p.cash >= game.revive_cost(p.team)
           and any(q.team == p.team and not q.alive for q in game.players.values()))
    if not can:
        brain.revive_at = None
    elif brain.revive_at is None:
        brain.revive_at = now + game.rng.uniform(0.8, 2.5)
    elif now >= brain.revive_at:
        game.revive(p, now)
        brain.revive_at = None
