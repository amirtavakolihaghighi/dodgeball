"""Rule tests for the simulation. Run with:  python tests/test_sim.py   (or pytest)"""
import json
import math
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bots  # noqa: E402
import config as C  # noqa: E402
from sim import Game, damage_for, throw_speed  # noqa: E402

DT = 1 / 120


def start_duel(distance=10.0, defenders=1):
    """Red attacker vs blue defender(s), standing `distance` apart, round already in play."""
    g = Game(seed=7)
    g.bot_fill = 0
    t = 100.0
    a = g.add_player("A", 0, t)
    ds = [g.add_player(f"D{i}", 1, t) for i in range(defenders)]
    while g.state != "play":
        g.tick(t, t + DT)
        t += DT
    a.x, a.z = -distance / 2, 0.0
    for i, d in enumerate(ds):
        d.x, d.z = distance / 2, i * 3.0
    for p in [a, *ds]:
        p.prev_x, p.prev_z = p.x, p.z
    g.events.clear()
    return g, a, ds, t


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
    assert abs(hit[0]["dmg"] - damage_for(throw_speed(1.0))) <= 1     # gravity nudges the speed a little
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
    assert abs(deflect[0]["speed"] - throw_speed(1.0) * C.DEFLECT_SPEEDUP) < 0.5
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
                    tti, miss = bots.time_to_impact(ball, p)
                    if tti is not None and tti <= 0.04 and miss < 1 and now >= p.action_end:
                        g.start_action(p, "deflect", now, now)

    run(g, t, 4.0, each_tick)
    speeds = [e["speed"] for e in events(g, "deflect")]
    assert len(speeds) >= 6, speeds
    assert abs(speeds[0] - throw_speed(1.0) * C.DEFLECT_SPEEDUP) < 0.5
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


# ---------------------------------------------------------------- network fairness

def _late_press(view_time_offset, arrive_after_contact=0.04):
    """The press arrives after the server saw contact; `view_time_offset` is when (relative to
    contact) the player pressed, in the timeline their screen was showing."""
    tc = contact_time()
    g, a, (d,), t = start_duel()
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
    g = _late_press(view_time_offset=+0.02)
    assert not events(g, "catch") and len(events(g, "hit")) == 1


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
    assert hit[0]["speed"] < throw_speed(1.0)    # the bounce cost speed, so it hit softer


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
        tti, miss = bots.time_to_impact(ball, d)
        if ball.state == "live" and ball.team != d.team and tti is not None and tti <= 0.04 and now >= d.action_end:
            seen["before_deflect"] = ball.bounces
            g.start_action(d, "deflect", now, now)

    run(g, t, 1.5, each_tick)
    assert events(g, "bounce") and events(g, "deflect"), [e["k"] for e in g.events]
    assert seen == {"before_deflect": 1, "after_deflect": 0}, seen


# ---------------------------------------------------------------- court, KO, rounds, revive

def test_court_grows_with_players_and_only_shrinks_between_rounds():
    g = Game(seed=5)
    g.bot_fill = 0
    t = 1.0
    a = g.add_player("A", 0, t)
    b = g.add_player("B", 1, t)
    small = (g.half_length, g.half_width)
    extra = [g.add_player(f"X{i}", 0, t) for i in range(3)]
    assert g.half_width > small[1] and g.half_length > small[0]
    big = (g.half_length, g.half_width)
    t = run(g, t, C.COUNTDOWN_TIME + 0.1)
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


def test_bots_fill_teams_and_leave_when_humans_leave():
    g = Game(seed=3)
    g.bot_fill = 3
    t = 10.0
    human = g.add_player("Me", 0, t)
    assert sum(p.bot for p in g.players.values() if p.team == 0) == 2
    assert sum(p.bot for p in g.players.values() if p.team == 1) == 3
    g.score = [3, 2]
    g.remove_player(human.id, t)
    g.tick(t, t + DT)
    assert not g.players and g.state == "wait" and g.score == [0, 0]   # a fresh match next time


def test_more_bots_join_mid_round_fewer_wait_for_the_next():
    g = Game(seed=4)
    g.bot_fill = 2
    t = 1.0
    g.add_player("Me", 0, t)
    t = run(g, t, C.COUNTDOWN_TIME + 0.1)
    width = g.half_width
    assert g.state == "play" and len(g.players) == 4
    g.handle(next(p.id for p in g.players.values() if not p.bot), {"t": "cfg", "fill": 4}, t)
    assert len(g.players) == 8 and g.half_width > width     # joined now, court grew now
    g.handle(next(p.id for p in g.players.values() if not p.bot), {"t": "cfg", "fill": 1}, t)
    assert len(g.players) == 8                              # removal waits for the next round


def test_bot_only_match_plays_full_rounds():
    g = Game(seed=11)
    g.bots_play_alone = True
    g.bot_fill = 3
    g._balance_bots(0.0)
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
