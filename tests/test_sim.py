"""Rule tests for the simulation. Run with:  python tests/test_sim.py   (or pytest)"""
import json
import math
import random
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bots  # noqa: E402
import config as C  # noqa: E402
import rules as rules_mod  # noqa: E402
from rules import DEFAULTS, PARAMS, Rules  # noqa: E402
from sim import WATCHING, Ball, Game  # noqa: E402

DT = 1 / 120
R = Rules()                 # the default rules, for expected values


def start_duel(distance=10.0, defenders=1, rules=None):
    """Red attacker vs blue defender(s), standing `distance` apart, round already in play."""
    g = Game(seed=7, rules=Rules(rules) if rules else None)
    g.bots_each = 0
    t = 100.0
    a = g.add_player("A", 0, t)
    ds = [g.add_player(f"D{i}", 1, t) for i in range(defenders)]
    t = play_now(g, t)
    a.x, a.z = -distance / 2, 0.0
    for i, d in enumerate(ds):
        d.x, d.z = distance / 2, i * 3.0
    for p in [a, *ds]:
        p.prev_x, p.prev_z = p.x, p.z
    g.events.clear()
    return g, a, ds, t


def play_now(g, t):
    """Host presses Start in the lobby; run until the first round is live."""
    g.start_match(t)
    while g.state != "play":
        g.tick(t, t + DT)
        t += DT
    return t


def aim_at(p, target):
    p.aim = (target.x, C.CHEST_HEIGHT, target.z)
    p.aim_target = target.id


def throw(g, a, target, t, power=1.0):
    aim_at(a, target)
    g.start_charge(a, t, t)
    return g.throw(a, t + power * C.CHARGE_TIME, t + power * C.CHARGE_TIME)


def run(g, t, seconds, each_tick=None):
    end = t + seconds
    while t < end:
        if each_tick:
            each_tick(t)
        g.tick(t, t + DT)
        t += DT
    return t


def events(g, kind):
    return [e for e in g.events if e["k"] == kind]


def contact_time(power=1.0, distance=10.0):
    """When an undefended throw touches the defender (the dry run every timing test uses)."""
    g, a, (d,), t = start_duel(distance)
    throw(g, a, d, t, power)
    run(g, t + power * C.CHARGE_TIME, 2.0)
    return events(g, "hit")[0]["t"]


def exchange(kind, lead, power=1.0, distance=10.0, setup=None):
    """Defender presses `kind` so that the ball arrives `lead` seconds after the press.
    Sets g.stamina_after: the defender's stamina right after a successful defence."""
    tc = contact_time(power, distance)
    g, a, (d,), t = start_duel(distance)
    if setup:
        setup(g, a, d)
    aim_at(d, a)
    throw(g, a, d, t, power)
    t += power * C.CHARGE_TIME
    press = tc - lead
    pressed, g.stamina_after = [], None

    def each_tick(now):
        if not pressed and now >= press:
            pressed.append(g.start_action(d, kind, now, press))
        if g.stamina_after is None and any(e["k"] in ("catch", "deflect", "dodge") for e in g.events):
            g.stamina_after = d.stamina

    run(g, t, 2.0, each_tick)
    return g, a, d


# ---------------------------------------------------------------- basic throwing & hits

def test_undefended_throw_hits_and_pays_the_thrower():
    g, a, (d,), t = start_duel()
    ball = throw(g, a, d, t, power=1.0)
    assert ball is not None and ball.target == d.id
    run(g, t + C.CHARGE_TIME, 2.0)
    hit = events(g, "hit")
    assert len(hit) == 1 and hit[0]["p"] == d.id and hit[0]["by"] == a.id
    assert abs(hit[0]["dmg"] - R.damage_for(R.throw_speed(1.0))) <= 1     # gravity nudges the speed a little
    assert d.hp == C.MAX_HP - hit[0]["dmg"]
    assert a.cash == C.CASH_HIT and a.stats["hits"] == 1


def test_harder_throws_hit_much_harder():
    dmg = []
    for power in (0.0, 1.0):
        g, a, (d,), t = start_duel()
        throw(g, a, d, t, power)
        run(g, t + power * C.CHARGE_TIME, 2.5)
        dmg.append(events(g, "hit")[0]["dmg"])
    assert dmg[1] - dmg[0] >= 25, dmg


def test_slow_throws_arc_but_land_where_aimed():
    g, a, (d,), t = start_duel(distance=12.0)
    ball = throw(g, a, d, t, power=0.0)
    hand_y, peak = ball.y, [ball.y]

    def track(now):
        if ball.state == "live":
            peak[0] = max(peak[0], ball.y)

    run(g, t, 2.5, track)
    assert peak[0] > hand_y + 0.4, peak     # a visible arc...
    assert events(g, "hit")                 # ...that still lands on the target


def test_throw_cost_scales_with_charge_and_is_capped_by_stamina():
    g, a, (d,), t = start_duel()
    throw(g, a, d, t, power=0.0)
    assert a.stamina == C.MAX_STAMINA - C.THROW_COST_MIN
    g2, a2, (d2,), t2 = start_duel()
    throw(g2, a2, d2, t2, power=1.0)
    assert a2.stamina == C.MAX_STAMINA - C.THROW_COST_MAX
    g3, a3, (d3,), t3 = start_duel()
    a3.stamina = 20     # full charge wanted, only enough for a medium throw
    ball = throw(g3, a3, d3, t3, power=1.0)
    assert ball is not None and a3.stamina == 0
    assert C.THROW_SPEED_MIN < ball.speed < C.THROW_SPEED_MAX
    g4, a4, (d4,), t4 = start_duel()
    a4.stamina = C.THROW_COST_MIN - 1
    assert throw(g4, a4, d4, t4) is None and events(g4, "deny")[0]["why"] == "stamina"


def test_cooldown_gives_a_new_ball():
    g, a, (d,), t = start_duel()
    throw(g, a, d, t, power=0.0)
    assert not a.has_ball
    assert throw(g, a, d, t + 0.1, power=0.0) is None
    run(g, t, C.THROW_COOLDOWN + 0.05)
    assert a.has_ball


# ---------------------------------------------------------------- catch

def test_catch_normal_timing():
    g, a, d = exchange("catch", lead=0.2)
    catch = events(g, "catch")
    assert len(catch) == 1 and not catch[0]["perfect"]
    assert d.hp == C.MAX_HP and d.has_ball and d.cash == C.CASH_CATCH
    assert not events(g, "hit")


def test_catch_at_the_last_moment_is_perfect_and_cheaper():
    g, a, d = exchange("catch", lead=0.04)
    catch = events(g, "catch")
    assert len(catch) == 1 and catch[0]["perfect"]
    assert d.cash == C.CASH_PERFECT_CATCH
    assert g.stamina_after == C.MAX_STAMINA - C.CATCH.perfect_cost
    g2, a2, d2 = exchange("catch", lead=0.2)
    assert g2.stamina_after == C.MAX_STAMINA - C.CATCH.cost


def test_catch_too_early_gets_you_hit():
    g, a, d = exchange("catch", lead=C.CATCH.window + 0.1)
    assert not events(g, "catch") and len(events(g, "hit")) == 1


# ---------------------------------------------------------------- deflect & rallies

def test_deflect_sends_the_ball_back_faster():
    g, a, d = exchange("deflect", lead=0.1)
    deflect = events(g, "deflect")
    assert len(deflect) == 1 and deflect[0]["rally"] == 1
    assert abs(deflect[0]["speed"] - R.throw_speed(1.0) * C.DEFLECT_SPEEDUP) < 0.5
    hits = events(g, "hit")     # the attacker did not defend, so the return hits them
    assert len(hits) == 1 and hits[0]["p"] == a.id and hits[0]["by"] == d.id and hits[0]["rally"] == 1
    assert d.hp == C.MAX_HP and d.stats["deflects"] == 1


def test_deflect_perfect():
    g, a, d = exchange("deflect", lead=0.03)
    assert events(g, "deflect")[0]["perfect"]


def test_deflect_window_is_tighter_than_catch():
    lead = (C.DEFLECT.window + C.CATCH.window) / 2     # fine for a catch, too early for a deflect
    g, a, d = exchange("deflect", lead=lead)
    assert not events(g, "deflect") and events(g, "hit")[0]["p"] == d.id
    g2, a2, d2 = exchange("catch", lead=lead)
    assert events(g2, "catch")


def test_rally_speeds_up_until_the_cap():
    g, a, (d,), t = start_duel(distance=14.0)
    aim_at(a, d)
    aim_at(d, a)
    throw(g, a, d, t, power=1.0)
    t += C.CHARGE_TIME

    def each_tick(now):
        for p in (a, d):
            p.stamina = C.MAX_STAMINA       # this test is about speed, not stamina
            for ball in g.balls.values():
                if ball.state == "live" and ball.team != p.team:
                    tti, miss = bots.time_to_impact(ball, p, g.rules)
                    if tti is not None and tti <= 0.04 and miss < 1 and now >= p.action_end:
                        g.start_action(p, "deflect", now, now)

    run(g, t, 4.0, each_tick)
    speeds = [e["speed"] for e in events(g, "deflect")]
    assert len(speeds) >= 6, speeds
    assert abs(speeds[0] - R.throw_speed(1.0) * C.DEFLECT_SPEEDUP) < 0.5
    assert all(b >= a_ for a_, b in zip(speeds, speeds[1:]))
    assert speeds[-1] == C.BALL_SPEED_CAP
    assert [e["rally"] for e in events(g, "deflect")] == list(range(1, len(speeds) + 1))


# ---------------------------------------------------------------- dodge

def test_perfect_dodge_lets_the_ball_pass_and_refunds_stamina():
    g, a, d = exchange("dodge", lead=0.06)
    dodge = events(g, "dodge")
    assert len(dodge) == 1 and dodge[0]["perfect"]
    assert d.hp == C.MAX_HP and not events(g, "hit")
    assert d.cash == C.CASH_PERFECT_DODGE
    assert g.stamina_after == C.MAX_STAMINA - C.DODGE.perfect_cost


def test_early_dodge_is_wasted():
    g, a, d = exchange("dodge", lead=C.DODGE.window + 0.1)
    assert not events(g, "dodge") and len(events(g, "hit")) == 1


# ---------------------------------------------------------------- why a hit got through

def _volley(gap, kind="deflect"):
    """Two attackers throw at one defender, `gap` s apart. The defender meets the first ball with
    `kind` just before it arrives, and does nothing about the second."""
    g = Game(seed=7)
    g.bots_each = 0
    t = 100.0
    a1, a2, d = g.add_player("A1", 0, t), g.add_player("A2", 0, t), g.add_player("D", 1, t)
    t = play_now(g, t)
    for p, (x, z) in ((a1, (-5.0, -1.0)), (a2, (-5.0, 1.0)), (d, (5.0, 0.0))):
        p.x, p.z = p.prev_x, p.prev_z = x, z
    for p, target in ((a1, d), (a2, d), (d, a1)):
        aim_at(p, target)
    g.events.clear()
    g.start_charge(a1, t, t)
    g.start_charge(a2, t, t)
    t += C.CHARGE_TIME
    g.throw(a1, t, t)
    released, pressed = [], []

    def each_tick(now):
        if not released and now >= t + gap:
            released.append(g.throw(a2, now, now))
        for ball in list(g.balls.values()):
            if not pressed and ball.state == "live" and ball.team != d.team:
                tti, miss = bots.time_to_impact(ball, d, g.rules)
                if tti is not None and tti <= 0.05 and miss < 1:
                    pressed.append(g.start_action(d, kind, now, now))

    run(g, t, 2.0, each_tick)
    return g, [e for e in events(g, "hit") if e["p"] == d.id]


def test_a_hit_after_a_press_that_ended_too_early_says_by_how_much():
    g, a, d = exchange("deflect", lead=C.DEFLECT.window + 0.1)     # its window ended 0.1 s before the ball came
    hit = events(g, "hit")
    assert len(hit) == 1 and abs(hit[0]["early"] - 0.1) < 0.011 and "second" not in hit[0]
    g, a, d = exchange("dodge", lead=C.DODGE.window + 0.3)
    assert abs(events(g, "hit")[0]["early"] - 0.3) < 0.011
    g, a, d = exchange("catch", lead=C.CATCH.window + 0.7)          # long before: not about this ball
    assert "early" not in events(g, "hit")[0]


def test_a_second_ball_right_after_a_defence_is_marked():
    g, hits = _volley(gap=0.15)
    assert len(events(g, "deflect")) == 1
    assert len(hits) == 1 and hits[0].get("second") and "early" not in hits[0]
    g, hits = _volley(gap=0.45, kind="dodge")       # the dash is over when the second ball comes...
    assert len(events(g, "dodge")) == 1             # ...and it met a ball, so it wasn't "too early"
    assert len(hits) == 1 and hits[0].get("second") and "early" not in hits[0]
    g, hits = _volley(gap=1.0)                      # long after: just a hit
    assert len(hits) == 1 and "second" not in hits[0] and "early" not in hits[0]


def test_an_ordinary_hit_has_no_mark():
    g, a, (d,), t = start_duel()
    throw(g, a, d, t)
    run(g, t + C.CHARGE_TIME, 2.0)
    hit = events(g, "hit")
    assert len(hit) == 1 and "early" not in hit[0] and "second" not in hit[0]


# ---------------------------------------------------------------- network fairness

def _late_press(view_time_offset, arrive_after_contact=0.04, rules=None):
    """The press arrives after the server saw contact; `view_time_offset` is when (relative to
    contact) the player pressed, in the timeline their screen was showing."""
    tc = contact_time()
    g, a, (d,), t = start_duel(rules=rules)
    d.view_lag = 0.1
    throw(g, a, d, t)
    t += C.CHARGE_TIME
    done = []

    def each_tick(now):
        if not done and now >= tc + arrive_after_contact:
            done.append(True)
            g.handle(d.id, {"t": "act", "a": "catch", "wt": tc + view_time_offset}, now)

    run(g, t, 2.0, each_tick)
    return g


def test_press_that_was_in_time_on_screen_counts_even_if_it_arrives_late():
    g = _late_press(view_time_offset=-0.05)
    assert len(events(g, "catch")) == 1 and not events(g, "hit")


def test_press_after_the_ball_arrived_on_screen_is_a_hit():
    g = _late_press(view_time_offset=C.PRESS_GRACE + 0.03)
    assert not events(g, "catch") and len(events(g, "hit")) == 1


def test_press_grace_forgives_a_press_a_hair_late():
    g = _late_press(view_time_offset=C.PRESS_GRACE * 0.75)        # a hair after contact on screen
    caught = events(g, "catch")
    assert len(caught) == 1 and caught[0].get("graced") and not events(g, "hit")
    g = _late_press(view_time_offset=C.PRESS_GRACE * 0.75, rules={"PRESS_GRACE": 0})
    assert not events(g, "catch") and len(events(g, "hit")) == 1     # judged exactly: too late


def _sidestep(rules=None, moved_before=0.06, screen_behind=0.12):
    """The defender steps 1.5 m aside `moved_before` s before the ball reaches them on their own
    screen (negative: after). Their reports reach the server `screen_behind` s after the moment
    their screen showed, so the server still has them in the ball's path at contact."""
    tc = contact_time()
    g, a, (d,), t = start_duel(rules=rules)
    throw(g, a, d, t)
    t += C.CHARGE_TIME
    home = (d.x, d.z)
    last = [t - 1]

    def report(now):
        if now - last[0] >= 1 / 30:
            last[0] = now
            wt = now - screen_behind
            z = home[1] + (1.5 if wt >= tc - moved_before else 0.0)
            g.handle(d.id, {"t": "in", "x": home[0], "z": z, "yaw": d.yaw, "pitch": 0, "wt": wt, "tp": d.tp}, now)

    run(g, t, 2.0, report)
    return g, d


def test_sidestep_compensation_judges_dodging_by_moving_on_the_players_screen():
    g, d = _sidestep()                                   # clear on their screen, not yet on the server's
    assert not events(g, "hit") and [e["p"] for e in events(g, "sidestep")] == [d.id]
    g, d = _sidestep(rules={"SIDESTEP_COMP": False})     # off: the server's stale position decides
    hit = events(g, "hit")
    assert len(hit) == 1 and hit[0]["gap"] > 0 and not events(g, "sidestep")    # the log shows they were clear
    g, d = _sidestep(moved_before=-0.1)                  # moved only after the ball got there: still a hit
    hit = events(g, "hit")
    assert len(hit) == 1 and hit[0]["gap"] < 0 and not events(g, "sidestep")


def test_lockout_after_a_missed_press_can_be_shortened_or_removed():
    g, a, (d,), t = start_duel()
    g.start_action(d, "catch", t, t)
    assert g.start_action(d, "deflect", t + 0.05, t + 0.05) is None and events(g, "deny")[0]["why"] == "busy"
    g, a, (d,), t = start_duel(rules={"LOCKOUT_SCALE": 0})
    g.start_action(d, "catch", t, t)
    assert g.start_action(d, "deflect", t + 0.05, t + 0.05) and d.action == "deflect" and not events(g, "deny")
    # A short lockout never cuts the window itself: a ball arriving late in it is still caught.
    g, a, d = exchange("catch", lead=C.CATCH_WINDOW - 0.04,
                       setup=lambda g, a, d: setattr(g.rules, "LOCKOUT_SCALE", 0.1))
    assert len(events(g, "catch")) == 1 and not events(g, "hit")


def test_lag_compensation_is_bounded():
    g, a, (d,), t = start_duel()
    g.handle(d.id, {"t": "act", "a": "catch", "wt": t - 10}, t)
    assert d.action_start == t - C.MAX_LAG_COMP


def test_no_stamina_no_defence():
    def tired(g, a, d):
        d.stamina = C.CATCH.cost - 1
        d.last_spend = 1e9      # and no regen before the ball arrives
    g, a, d = exchange("catch", lead=0.1, setup=tired)
    assert events(g, "deny")[0]["why"] == "stamina" and len(events(g, "hit")) == 1


# ---------------------------------------------------------------- aim assist

def _throw_with_aim_offset(degrees, power=1.0, distance=12.0, defender_vz=0.0, reaction=0.2):
    """Does the throw hit? The defender may start walking sideways `reaction` s after release."""
    g, a, (d,), t = start_duel(distance)
    hand = g._hand(a)
    dx, dz = d.x - hand[0], d.z - hand[2]
    ang = math.atan2(dz, dx) + math.radians(degrees)
    dist = math.hypot(dx, dz)
    a.aim = (hand[0] + math.cos(ang) * dist, C.CHEST_HEIGHT, hand[2] + math.sin(ang) * dist)
    a.aim_target = None
    g.start_charge(a, t, t)
    g.throw(a, t + power * C.CHARGE_TIME, t + power * C.CHARGE_TIME)
    t += power * C.CHARGE_TIME
    released = t

    def walk(now):
        if now >= released + reaction:
            d.x, d.z = g.clamp_to_half(d.team, d.x, d.z + defender_vz * DT)

    run(g, t, 2.0, walk if defender_vz else None)
    return bool(events(g, "hit"))


def test_assist_corrects_small_aim_errors_only():
    assert _throw_with_aim_offset(6)
    assert not _throw_with_aim_offset(25)


def test_juking_beats_a_slow_throw_but_not_a_fast_one():
    assert not _throw_with_aim_offset(0, power=0.0, defender_vz=C.WALK_SPEED)
    assert _throw_with_aim_offset(0, power=1.0, distance=8.0, defender_vz=C.WALK_SPEED)


# ---------------------------------------------------------------- ricochets

def _bank_throw(g, a, aim, t, power=1.0):
    a.aim, a.aim_target = aim, None
    g.start_charge(a, t, t)
    ball = g.throw(a, t + power * C.CHARGE_TIME, t + power * C.CHARGE_TIME)
    return ball, t + power * C.CHARGE_TIME


def test_floor_ricochet_curves_into_an_enemy():
    g, a, (d,), t = start_duel(distance=12.0)
    hand = g._hand(a)
    floor = (hand[0] + (d.x - hand[0]) * 0.55, 0.0, hand[2] + (d.z - hand[2]) * 0.55)
    ball, t = _bank_throw(g, a, floor, t)
    assert ball.target is None          # aiming at the floor short of them: no throw-time assist
    run(g, t, 2.0)
    bounce, hit = events(g, "bounce"), events(g, "hit")
    assert len(bounce) == 1 and bounce[0]["y"] <= C.BALL_RADIUS + 0.01
    assert len(hit) == 1 and hit[0]["p"] == d.id
    assert hit[0]["speed"] < R.throw_speed(1.0)    # the bounce cost speed, so it hit softer


def test_wall_ricochet_bank_shot():
    g, a, (d,), t = start_duel(distance=12.0)
    hand = g._hand(a)
    wall = g.half_width
    f = (wall - hand[2]) / ((2 * wall - d.z) - hand[2])     # line to the target's mirror image
    ball, t = _bank_throw(g, a, (hand[0] + (d.x - hand[0]) * f, C.CHEST_HEIGHT, wall), t)
    run(g, t, 2.0)
    bounce, hit = events(g, "bounce"), events(g, "hit")
    assert len(bounce) == 1 and abs(abs(bounce[0]["z"]) - (wall - C.BALL_RADIUS)) < 0.01
    assert len(hit) == 1 and hit[0]["p"] == d.id


def test_only_one_ricochet_per_throw():
    g, a, (d,), t = start_duel(distance=12.0)
    ball, t = _bank_throw(g, a, (a.x - 4.0, 0.0, a.z), t)    # into our own floor, nobody ahead
    run(g, t, 3.0)
    assert len(events(g, "bounce")) == 1 and not events(g, "hit")
    assert ball.id not in g.balls or g.balls[ball.id].state == "dead"


def test_deflect_gives_a_fresh_ricochet():
    g, a, (d,), t = start_duel(distance=12.0)
    aim_at(d, a)
    hand = g._hand(a)
    ball, t = _bank_throw(g, a, (hand[0] + (d.x - hand[0]) * 0.55, 0.0, hand[2] + (d.z - hand[2]) * 0.55), t)
    seen = {}

    def each_tick(now):
        if "after_deflect" not in seen and events(g, "deflect"):
            seen["after_deflect"] = ball.bounces
        tti, miss = bots.time_to_impact(ball, d, g.rules)
        if ball.state == "live" and ball.team != d.team and tti is not None and tti <= 0.04 and now >= d.action_end:
            seen["before_deflect"] = ball.bounces
            g.start_action(d, "deflect", now, now)

    run(g, t, 1.5, each_tick)
    assert events(g, "bounce") and events(g, "deflect"), [e["k"] for e in g.events]
    assert seen == {"before_deflect": 1, "after_deflect": 0}, seen


def _bend_over(values, speed, metres=4.0, off_deg=20.0):
    """Degrees a ball at `speed`, aimed `off_deg` off an enemy, turns toward them per `metres`."""
    g = Game(seed=1, rules=Rules({"GRAVITY": 0, **values}))
    g.bots_each = 0
    t = 0.0
    a, d = g.add_player("A", 0, t), g.add_player("D", 1, t)
    t = play_now(g, t)
    a.x, a.z, d.x, d.z = -10.0, 0.0, 10.0, 0.0
    off = math.radians(off_deg)
    ball = Ball(id=999, owner=a.id, team=0, x=-8.0, y=C.CHEST_HEIGHT, z=0.0, vx=speed * math.cos(off), vy=0.0,
                vz=speed * math.sin(off), born=t, curve=math.radians(g.rules.ASSIST_TURN_RATE_DEG), target=d.id)
    g.balls[ball.id] = ball
    start = math.atan2(ball.vz, ball.vx)
    travelled = 0.0
    while travelled < metres:
        x, z = ball.x, ball.z
        g._fly(ball, t, DT)
        t += DT
        travelled += math.hypot(ball.x - x, ball.z - z)
    return math.degrees(start - math.atan2(ball.vz, ball.vx)) * metres / travelled


def test_slow_balls_curve_less_than_fast_ones():
    full = _bend_over({}, C.THROW_SPEED_MAX)
    half = _bend_over({}, R.throw_speed(0.5))
    tap = _bend_over({}, C.THROW_SPEED_MIN)
    assert full > 2.0 and full > half > tap > 0             # per metre: the slower, the straighter
    assert abs(tap / full - C.SLOW_BALL_CURVE) < 0.05, (tap, full)
    assert _bend_over({"SLOW_BALL_CURVE": 0}, C.THROW_SPEED_MIN) < 0.01    # 0: taps fly dead straight
    same = _bend_over({"SLOW_BALL_CURVE": 1}, C.THROW_SPEED_MIN)
    assert abs(same / full - 1) < 0.05                       # 1: every ball bends the same per metre
    assert abs(_bend_over({}, C.BALL_SPEED_CAP) / full - 1) < 0.05     # rally balls: like full power


def test_a_bounce_takes_curve_away():
    def bank(keep):
        g = Game(seed=7, rules=Rules({"RICOCHET_CURVE_KEEP": keep}))
        g.bots_each = 0
        t = 100.0
        a, d = g.add_player("A", 0, t), g.add_player("D", 1, t)
        t = play_now(g, t)
        a.x, a.z, d.x, d.z = -6.0, 0.0, 6.0, 2.0          # off to the side of the bounce line
        hand = g._hand(a)
        ball, t = _bank_throw(g, a, (hand[0] + (6.0 - hand[0]) * 0.5, 0.0, hand[2]), t)
        headings = []

        def each_tick(now):
            if ball.bounces and ball.state == "live":
                headings.append(math.atan2(ball.vz, ball.vx))

        run(g, t, 1.0, each_tick)
        assert events(g, "bounce") and headings
        return ball, max(headings) - min(headings)

    full = math.radians(C.ASSIST_TURN_RATE_DEG)
    ball, turned = bank(C.RICOCHET_CURVE_KEEP)
    assert abs(ball.curve - full * C.RICOCHET_CURVE_KEEP) < 1e-9 and turned > 0.01   # bends, but less
    ball, turned = bank(0.0)
    assert ball.curve == 0 and turned < 1e-9                  # 0: the ricochet flies straight


# ---------------------------------------------------------------- court, KO, rounds, revive

def test_court_grows_with_players_and_only_shrinks_between_rounds():
    g = Game(seed=5)
    g.bots_each = 0
    t = 1.0
    a = g.add_player("A", 0, t)
    b = g.add_player("B", 1, t)
    small = (g.half_length, g.half_width)
    extra = [g.add_player(f"X{i}", 0, t) for i in range(3)]
    assert g.half_width > small[1] and g.half_length > small[0]
    big = (g.half_length, g.half_width)
    t = play_now(g, t)
    assert g.state == "play" and (g.half_length, g.half_width) == big
    for p in extra:
        g.remove_player(p.id, t)
    assert (g.half_length, g.half_width) == big     # no squeezing mid-round
    b.alive = False
    t = run(g, t, C.ROUND_OVER_TIME + 0.2)
    assert g.state == "count" and (g.half_length, g.half_width) == small
    assert abs(a.z) < small[1] and abs(b.z) < small[1]

def test_players_cannot_cross_the_centre_line():
    g, a, (d,), t = start_duel()
    g.handle(a.id, {"t": "in", "x": 5.0, "z": 99.0, "tp": a.tp, "wt": t}, t)
    assert a.x == -C.CENTER_GAP and a.z == g.half_width - C.PLAYER_RADIUS
    g.handle(a.id, {"t": "in", "x": -3.0, "z": 0.0, "tp": a.tp - 1, "wt": t}, t)
    assert a.x == -C.CENTER_GAP     # stale input from before a teleport is ignored


def test_knockout_revive_and_round_end():
    g, a, (d1, d2), t = start_duel(defenders=2)
    d1.hp = 5
    throw(g, a, d1, t)
    t = run(g, t + C.CHARGE_TIME, 2.0)
    assert not d1.alive and g.state == "play" and events(g, "hit")[0]["ko"]
    assert a.cash == C.CASH_HIT + C.CASH_KO
    d2.cash = C.REVIVE_COST - 1
    assert g.revive(d2, t) is None
    d2.cash = C.REVIVE_COST
    assert g.revive(d2, t) is d1
    assert d1.alive and d1.hp == C.REVIVE_HP and d2.cash == 0 and t < d1.invuln_until
    assert g.revive_cost(1) == C.REVIVE_COST + C.REVIVE_COST_STEP     # the next one costs more
    for p in (d1, d2):
        p.alive = False
    t = run(g, t, 0.1)
    assert g.state == "over" and g.score == [1, 0] and g.last_winner == 0
    t = run(g, t, C.ROUND_OVER_TIME + 0.1)
    assert g.state == "count" and g.round_no == 2 and all(p.alive for p in (a, d1, d2))


def test_the_host_sets_each_teams_bots_and_nothing_balances_them():
    g, host, (guest,), t = lobby()
    bots_on = lambda team: sum(p.bot for p in g.players.values() if p.team == team)   # noqa: E731
    say(g, host, t, t="rules", set={"BOTS_RED": 4, "BOTS_BLUE": 99})
    assert (bots_on(0), bots_on(1)) == (4, C.BOTS_PER_TEAM_MAX)       # any number, up to the cap
    say(g, host, t, t="rules", set={"BOTS_BLUE": 0})
    late = g.add_player("Late", None, t)             # people coming and going move no bots
    g.remove_player(guest.id, t)
    assert (bots_on(0), bots_on(1)) == (4, 0) and late.team == 1
    t = play_now(g, t)
    say(g, host, t, t="rules", set={"BOTS_BLUE": 3})  # mid-match: from the next round
    assert bots_on(1) == 0 and g.next_rules.BOTS_BLUE == 3
    for p in g.players.values():
        p.alive = p.team == 1                          # RED is out: the round ends
    t = run(g, t, C.ROUND_OVER_TIME + 0.2)
    assert g.state == "count" and (bots_on(0), bots_on(1)) == (4, 3)
    g.score = [3, 2]
    for p in (host, late):                           # the last person leaves: bots go too
        g.remove_player(p.id, t)
    g.tick(t, t + DT)
    assert not g.players and g.state == "lobby" and g.score == [0, 0]   # a fresh lobby next time


def test_bot_only_match_plays_full_rounds():
    g = Game(seed=11)
    g.bots_play_alone = True
    g.bots_each = 3
    g._sync_bots(0.0)
    g.start_match(0.0)
    t = 0.0
    for _ in range(int(300 / (1 / 60))):
        g.tick(t, t + 1 / 60)
        t += 1 / 60
        if len(g.events) > 5000:
            g.events = g.events[-1000:]
        if g.round_no >= 4:
            break
    assert g.round_no >= 3, f"only reached round {g.round_no} (score {g.score})"
    assert sum(g.score) >= 2
    totals = {k: sum(p.stats[k] for p in g.players.values()) for k in ("hits", "catches", "deflects")}
    assert all(v > 0 for v in totals.values()), totals
    json.dumps(g.snapshot(t))


# ---------------------------------------------------------------- lobby & host controls

def lobby(fill=0, guests=1):
    """A fresh server: the host (red) and some guests, still in the lobby."""
    g = Game(seed=21)
    g.bots_each = fill
    t = 50.0
    host = g.add_player("Host", 0, t, host=True)
    others = [g.add_player(f"Guest{i}", None, t) for i in range(guests)]
    g.events.clear()
    return g, host, others, t


def say(game, sender, now, **msg):
    game.handle(sender.id, msg, now)


def test_the_server_starts_in_the_lobby_and_only_the_host_starts_the_match():
    g, host, (guest,), t = lobby()
    assert g.state == "lobby"
    t = run(g, t, 10.0)
    assert g.state == "lobby"                       # nothing starts by itself
    say(g, guest, t, t="start")
    assert g.state == "lobby" and events(g, "deny")[0]["why"] == "host"
    g.score = [4, 1]
    say(g, host, t, t="start")
    assert g.state == "count" and g.score == [0, 0] and events(g, "match")[0]["s"] == "start"
    assert abs(g.state_until - t - (C.COUNTDOWN_TIME + C.MATCH_START_EXTRA)) < 1e-9     # time to click in
    t = run(g, t, g.state_until - t + 0.05)
    assert g.state == "play"


def test_guests_cannot_change_rules_bots_teams_or_the_match():
    g, host, (guest, other), t = lobby(guests=2)
    say(g, guest, t, t="rules", set={"GRAVITY": 0, "BOTS_RED": 4})
    say(g, guest, t, t="rules", reset=True)
    say(g, guest, t, t="move", p=other.id)
    say(g, guest, t, t="shuffle")
    teams = {p.id: p.team for p in g.players.values()}
    assert g.rules.GRAVITY == C.GRAVITY and g.rules.BOTS_RED == 0 and g.rules_version == 0
    say(g, host, t, t="start")
    say(g, guest, t, t="end")
    assert g.state == "count" and {p.id: p.team for p in g.players.values()} == teams
    assert [e["why"] for e in events(g, "deny")] == ["host"] * 5


def test_rule_changes_in_the_lobby_apply_at_once():
    g, host, _, t = lobby()
    say(g, host, t, t="rules", set={"GRAVITY": 9.5, "MAX_HP": 150, "BOTS_RED": 3})
    assert g.rules.GRAVITY == 9.5 and g.next_rules is None and g.rules_version == 1
    assert host.hp == 150                           # warm-up feels the change right away
    assert [sum(p.bot for p in g.players.values() if p.team == k) for k in (0, 1)] == [3, 0]
    e = events(g, "rules")[0]
    assert e["n"] == 3 and not e["next"] and "Gravity" in e["names"]


def test_rule_changes_mid_match_apply_from_the_next_round():
    g, host, (guest,), t = lobby()
    t = play_now(g, t)
    say(g, host, t, t="rules", set={"GRAVITY": 0, "THROW_SPEED_MAX": 20})
    assert g.rules.GRAVITY == C.GRAVITY and g.next_rules.GRAVITY == 0     # not yet
    assert events(g, "rules")[0]["next"] and g.snapshot(t)["r"]["pend"] == 2
    say(g, host, t, t="rules", set={"MAX_HP": 120})                      # adds to the pending set
    assert sorted(g.pending_changes()) == ["GRAVITY", "MAX_HP", "THROW_SPEED_MAX"]
    guest.alive = False                                                  # the round ends...
    t = run(g, t, 0.1)
    assert g.state == "over" and g.rules.GRAVITY == C.GRAVITY
    t = run(g, t, C.ROUND_OVER_TIME + 0.1)                               # ...the next one starts
    assert g.state == "count" and g.rules.GRAVITY == 0 and g.rules.THROW_SPEED_MAX == 20
    assert g.next_rules is None and host.hp == 120 and guest.hp == 120
    # and the new numbers are the ones the game plays by
    t = run(g, t, g.state_until - t + 0.05)
    aim_at(host, guest)
    g.start_charge(host, t, t)
    ball = g.throw(host, t + 1.0, t + 1.0)
    assert abs(ball.speed - 20) < 1e-6


def test_host_can_discard_pending_changes_and_reset_everything():
    g, host, _, t = lobby()
    say(g, host, t, t="rules", set={"GRAVITY": 2})
    t = play_now(g, t)
    say(g, host, t, t="rules", set={"WALK_SPEED": 9})
    assert g.pending_changes() == ["WALK_SPEED"]
    say(g, host, t, t="rules", discard=True)
    assert g.next_rules is None and g.rules.GRAVITY == 2
    say(g, host, t, t="rules", reset=True)
    assert sorted(g.pending_changes()) == ["BOTS_BLUE", "BOTS_RED", "GRAVITY"] and g.next_rules.values() == DEFAULTS


def test_rules_are_validated_and_clamped():
    r = Rules()
    changed = r.update({"GRAVITY": "fast", "NOT_A_RULE": 3, "MAX_HP": True, "WALK_SPEED": float("nan"),
                        "CHARGE_TIME": -5, "BALL_LIFETIME": 1e9, "MAX_RICOCHETS": 2.6, "BOT_SKILL": "godlike",
                        "CASH_RESETS_EACH_ROUND": 0, ("tuple",): 1})
    assert sorted(changed) == ["BALL_LIFETIME", "CHARGE_TIME", "MAX_RICOCHETS"]
    assert r.CHARGE_TIME == rules_mod.BY_KEY["CHARGE_TIME"].lo and r.BALL_LIFETIME == rules_mod.BY_KEY["BALL_LIFETIME"].hi
    assert r.MAX_RICOCHETS == 3 and r.GRAVITY == C.GRAVITY and r.BOT_SKILL == C.BOT_SKILL
    # Pairs stay in order (the edited one wins); a perfect zone can't outgrow its window.
    r.update({"THROW_SPEED_MIN": 40})
    assert r.THROW_SPEED_MAX == 40
    r.update({"THROW_SPEED_MAX": 10})
    assert r.THROW_SPEED_MIN == 10
    r.update({"CATCH_PERFECT": 0.9, "DODGE_WINDOW": 0.05, "DEFLECT_PERFECT_COST": 99})
    assert r.CATCH_PERFECT == r.CATCH_WINDOW and r.DODGE_PERFECT == 0.05 and r.DEFLECT_PERFECT_COST == r.DEFLECT_COST
    assert r.actions["dodge"].window == 0.05        # the derived specs follow


def test_changed_rules_change_the_game():
    """A few rules checked end to end: the editor's numbers are what the game plays by."""
    def duel_with(**values):
        g = Game(seed=7, rules=Rules(values))
        g.bots_each = 0
        t = 100.0
        a, d = g.add_player("A", 0, t), g.add_player("D", 1, t)
        t = play_now(g, t)
        a.x, a.z, d.x, d.z = -10.0, 0.0, 10.0, 0.0
        a.prev_x, d.prev_x = a.x, d.x
        g.events.clear()
        return g, a, d, t

    # A catch pressed 0.45 s early fails with the default 0.30 s window, works with a 0.6 s one.
    tc = contact_time(distance=20.0)
    for window, caught in ((C.CATCH_WINDOW, False), (0.6, True)):
        g, a, d, t = duel_with(CATCH_WINDOW=window)
        throw(g, a, d, t)
        pressed = []
        run(g, t + C.CHARGE_TIME, 2.0, lambda now: pressed or now < tc - 0.45 or pressed.append(
            g.start_action(d, "catch", now, now)))
        assert bool(events(g, "catch")) == caught, window
    # No gravity: a throw at chest height flies dead straight.
    g, a, d, t = duel_with(GRAVITY=0)
    ball = throw(g, a, d, t, power=0.0)
    assert abs(ball.vy - ball.speed * (C.CHEST_HEIGHT - ball.y) / math.dist((ball.x, ball.y, ball.z), (d.x, C.CHEST_HEIGHT, d.z))) < 1e-6
    # Damage formula and health.
    g, a, d, t = duel_with(DAMAGE_MIN=70, DAMAGE_MAX=80, MAX_HP=150)
    assert d.hp == 150
    throw(g, a, d, t, power=0.0)
    run(g, t, 2.0)
    assert events(g, "hit")[0]["dmg"] == 70 and d.hp == 80


def test_every_rule_is_used_by_the_game():
    """No decorative settings: every rule the editor lists is read by the game somewhere."""
    root = Path(__file__).resolve().parent.parent
    code = "".join((root / f).read_text(encoding="utf-8") for f in ("sim.py", "bots.py", "server.py"))
    client = rules_mod.Rules.for_client.__code__.co_names + rules_mod.Rules.throw_cost.__code__.co_names \
        + rules_mod.Rules.throw_speed.__code__.co_names + rules_mod.Rules.damage_for.__code__.co_names         + rules_mod.Rules.curve_share.__code__.co_names + rules_mod.Rules.bots_for.__code__.co_names
    spec_fields = {"COST": ".cost", "PERFECT_COST": ".perfect_cost", "WINDOW": ".window", "PERFECT": ".perfect",
                   "RECOVERY": ".recovery"}
    unused = []
    for p in PARAMS:
        k = p.key
        kind, _, field = k.partition("_")
        if kind in ("DODGE", "CATCH", "DEFLECT") and field in spec_fields:
            ok = spec_fields[field] in code
        elif p.sub:                                                   # per-skill bot numbers
            ok = f'prof["{k.split("_", 2)[2].lower()}"]' in code
        else:
            ok = f".{k}" in code or k in client
        if not ok:
            unused.append(k)
    assert not unused, unused


def test_random_rules_never_break_a_match():
    """Fuzz: matches with random rule values (often at the extremes), changed mid-match too."""
    for seed in range(20):
        rng = random.Random(seed)

        def random_values(share=1.0):
            out = {}
            for p in PARAMS:
                if rng.random() > share:
                    continue
                if p.kind == "bool":
                    out[p.key] = rng.random() < 0.5
                elif p.kind == "choice":
                    out[p.key] = rng.choice(p.choices)
                else:
                    pick = rng.random()
                    v = p.lo if pick < 0.15 else p.hi if pick < 0.3 else rng.uniform(p.lo, p.hi)
                    out[p.key] = round(v) if p.kind == "int" else v
            out["BOTS_RED"], out["BOTS_BLUE"] = rng.randint(1, 4), rng.randint(1, 4)
            return out

        g = Game(seed=seed, rules=Rules(random_values()))
        g.bots_play_alone = True
        g._sync_bots(0.0)
        g.start_match(0.0)
        t = 0.0
        for i in range(int(25 / (1 / 60))):
            g.tick(t, t + 1 / 60)
            t += 1 / 60
            if i % 300 == 150:
                g.set_rules(random_values(0.3), t)      # the host fiddles mid-match
            if g.state == "lobby":
                g.start_match(t)
            if i % 60 == 0:
                json.dumps(g.snapshot(t), allow_nan=False)
            if len(g.events) > 2000:
                g.events.clear()
        for p in g.players.values():
            assert math.isfinite(p.x) and math.isfinite(p.z) and math.isfinite(p.hp), (seed, p)


def test_match_ends_when_a_team_reaches_the_rounds_to_win():
    g = Game(seed=12, rules=Rules({"MATCH_ROUNDS_TO_WIN": 2, "BOTS_RED": 2, "BOTS_BLUE": 2}))
    g.bots_play_alone = True
    g._sync_bots(0.0)
    g.start_match(0.0)
    t, seen = 0.0, []
    while t < 600 and not events(g, "match")[1:]:
        g.tick(t, t + 1 / 60)
        t += 1 / 60
        seen += [e for e in g.events if e["k"] == "round" and e["s"] == "over"]
        g.events[:] = [e for e in g.events if e["k"] == "match"]
    end = events(g, "match")[-1]
    winner = end["w"]
    assert g.state == "lobby" and winner in (0, 1) and end["score"][winner] == 2
    assert g.match_result == [winner, *end["score"]] and seen[-1].get("m") == winner
    assert all(p.alive and p.hp == g.rules.MAX_HP for p in g.players.values())


def test_host_can_end_the_match_and_everyone_returns_to_the_lobby():
    g, host, (guest,), t = lobby()
    t = play_now(g, t)
    aim_at(host, guest)
    throw(g, host, guest, t)
    say(g, host, t, t="move", p=guest.id)           # mid-match: waits for the next round...
    assert guest.next_team == 0 and guest.team == 1
    say(g, host, t + 0.5, t="end")
    assert g.state == "lobby" and not g.balls and g.match_result == [None, 0, 0]
    assert guest.team == 0 and guest.next_team is None  # ...or for the lobby, whichever comes first
    assert events(g, "match")[-1]["s"] == "end"


def test_host_moves_and_shuffles_players():
    g, host, (a, b, c), t = lobby(guests=3)
    team = a.team
    say(g, host, t, t="move", p=a.id)
    assert a.team == 1 - team and a.next_team is None   # lobby: at once
    say(g, host, t, t="shuffle")
    counts = [sum(p.team == k for p in g.players.values() if not p.bot) for k in (0, 1)]
    assert counts == [2, 2]
    t = play_now(g, t)
    before = b.team
    say(g, host, t, t="move", p=b.id)
    assert b.team == before and b.next_team == 1 - before
    assert g.snapshot(t)["p"][[q[0] for q in g.snapshot(t)["p"]].index(b.id)][10] & 64     # shown as switching
    say(g, host, t, t="move", p=b.id)                    # again: cancelled
    assert b.next_team is None


def test_a_player_who_reconnects_keeps_their_team():
    g, host, (alice,), t = lobby()
    old = alice.team
    say(g, host, t, t="move", p=alice.id)
    g.remove_player(alice.id, t)
    back = g.add_player("Guest0", None, t)
    assert back.team == 1 - old


def test_the_host_can_watch_instead_of_playing():
    g, host, (guest,), t = lobby()
    say(g, guest, t, t="spectate", on=True)
    assert guest.team in (0, 1) and events(g, "deny")[0]["why"] == "host"     # only the host
    say(g, host, t, t="spectate", on=True)                  # in the lobby: at once
    assert host.team == WATCHING and not host.alive and events(g, "spectate")[0]["now"]
    say(g, host, t, t="rules", set={"BOTS_RED": 2})         # watching, the host still runs the lobby
    t = run(g, t, C.WARMUP_RESPAWN + 0.5)
    assert not host.alive                                    # nobody stands them back up
    t = play_now(g, t)
    t = run(g, t, 20.0)                                      # bots and the guest play on
    assert not [e for e in events(g, "hit") if e["p"] == host.id]
    entry = next(q for q in g.snapshot(t)["p"] if q[0] == host.id)
    assert entry[2] == WATCHING and not entry[10] & 1
    say(g, host, t, t="spectate", on=False)                  # mid-match: back from the next round...
    assert host.team == WATCHING and host.next_team == 0
    say(g, host, t, t="spectate", on=True)                   # ...unless they change their mind
    assert host.next_team is None
    say(g, host, t, t="spectate", on=False)
    n = g.round_no
    for p in g.players.values():
        if p.team == 1:
            p.alive = False
    while not (g.state == "count" and g.round_no > n):
        t = run(g, t, 0.1)
    assert host.team == 0 and host.alive and host.next_team is None


def test_shared_team_cash():
    g = Game(seed=7, rules=Rules({"TEAM_CASH": True, "REVIVE_COST": C.CASH_HIT, "REVIVE_COST_STEP": 0}))
    g.bots_each = 0
    t = 100.0
    a1, a2, d = g.add_player("A1", 0, t), g.add_player("A2", 0, t), g.add_player("D", 1, t)
    t = play_now(g, t)
    a1.x, a1.z, a2.x, a2.z, d.x, d.z = -6.0, -2.0, -6.0, 3.0, 6.0, 0.0
    throw(g, a1, d, t)
    t = run(g, t + C.CHARGE_TIME, 1.5)
    assert events(g, "hit") and g.team_cash[0] == C.CASH_HIT and a1.cash == 0
    assert g.cash_of(a2) == C.CASH_HIT                       # anyone on the team can spend it
    a1.alive, a1.down_since = False, t
    assert g.revive(a2, t) is a1 and g.team_cash[0] == 0
    entry = next(q for q in g.snapshot(t)["p"] if q[0] == a2.id)
    assert entry[9] == 0                                     # everyone's HUD shows the pot
    g.end_match(t)
    g.team_cash[0] = 15                                      # switched off: the pot is shared out...
    g.set_rules({"TEAM_CASH": False}, t)
    assert (a1.cash, a2.cash, g.team_cash[0]) == (8, 7, 0)
    g.set_rules({"TEAM_CASH": True}, t)                     # ...and on: it goes back in
    assert (a1.cash, a2.cash, g.team_cash[0]) == (0, 0, 15)


def test_cash_can_carry_over_while_revive_prices_start_over():
    g = Game(seed=7, rules=Rules({"CASH_RESETS_EACH_ROUND": False}))
    g.bots_each = 0
    t = 100.0
    a, d1, d2 = g.add_player("A", 0, t), g.add_player("D1", 1, t), g.add_player("D2", 1, t)
    a.cash = 40
    t = play_now(g, t)
    assert a.cash == 0                                       # a new match starts everyone at 0
    d1.cash = 500
    d2.alive, d2.down_since = False, t
    assert g.revive(d1, t) is d2
    assert g.revive_cost(1) == C.REVIVE_COST + C.REVIVE_COST_STEP
    n = g.round_no
    a.alive = False
    while not (g.state == "count" and g.round_no > n):
        t = run(g, t, 0.1)
    assert d1.cash == 500 - C.REVIVE_COST                    # the cash carried over...
    assert g.revive_cost(1) == C.REVIVE_COST                 # ...the price started over


def run_all():
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ok    {name}")
        except Exception:
            failed += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if run_all() else 0)
