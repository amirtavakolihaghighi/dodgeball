"""The game's rules: every number the host can change from the lobby.

Each rule has a name, a plain-language description, an allowed range and a preview (an
animated diagram in the rules editor, drawn by static/js/previews.js). Defaults come from
config.py. A Rules object holds one complete set of values, read as attributes
(rules.WALK_SPEED). Edits from browsers go through Rules.update(), which ignores unknown keys,
rejects wrong types and clamps numbers to their range, so no value can break the server.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import config as C
from config import ActionSpec

ACTION_KINDS = ("dodge", "catch", "deflect")
SKILLS = ("easy", "normal", "hard")


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


@dataclass(frozen=True)
class Param:
    key: str            # attribute name, the same as in config.py
    group: str
    label: str
    desc: str
    lo: float = 0.0
    hi: float = 1.0
    step: float = 0.01
    unit: str = ""
    kind: str = "float"     # float | int | bool | choice
    choices: tuple = ()
    preview: str = ""       # which animated diagram explains it (static/js/previews.js)
    sub: str = ""           # sub-heading inside the group

    def clean(self, raw):
        """An untrusted value from a browser -> a valid value for this rule, or None."""
        if self.kind == "bool":
            return raw if isinstance(raw, bool) else None
        if self.kind == "choice":
            return raw if isinstance(raw, str) and raw in self.choices else None
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
            return None
        value = _clamp(raw, self.lo, self.hi)
        return int(round(value)) if self.kind == "int" else round(float(value), 4)


GROUPS = [
    ("throw", "Throwing", "How throws charge, how fast they fly and what they cost."),
    ("damage", "Damage & health", "How much a hit hurts, and how much it takes to go down."),
    ("flight", "Ball flight", "How balls fly through the air."),
    ("ricochet", "Ricochets", "Bounces off the floor and the side walls (the end walls always stop balls)."),
    ("assist", "Aim assist", "The gentle bend toward an enemy near your crosshair."),
    ("dodge", "Dodge", "Space / Shift: a dash you can't be hit during."),
    ("catch", "Catch", "Right mouse / F: the ball becomes yours."),
    ("deflect", "Deflect & rallies", "E: sends the ball straight back, faster every time."),
    ("stamina", "Stamina", "The Souls-style pool every action spends."),
    ("move", "Movement", "How fast players get around."),
    ("body", "Bodies & hitboxes", "How big players and balls are for hits."),
    ("court", "Court", "The arena's size grows with the biggest team."),
    ("cash", "Cash & revives", "Cash comes from good play and buys revives (R) for fallen teammates."),
    ("rounds", "Rounds & match", "Round timing and how a match is won."),
    ("bots", "Bots", "Computer players that fill the teams."),
    ("network", "Network (advanced)", "How the game hides Wi-Fi delay, and how fairly it judges presses and dodges. Change these "
     "to experiment with lag. (The other change from the lag study, ricochet homing, is under Ricochets: Curve kept after "
     "a bounce.)"),
]
GROUP_TITLES = dict((g, title) for g, title, _ in GROUPS)

PARAMS: list[Param] = []


def _add(group, preview, key, label, desc, lo, hi, step, unit="", kind="float", choices=(), sub=""):
    PARAMS.append(Param(key, group, label, desc, lo, hi, step, unit, kind, choices, preview, sub))


# Per-skill bot numbers: (field, label, description, lo, hi, step, unit)
BOT_FIELDS = (
    ("react", "Reacts to", "Share of incoming balls a bot tries to defend against at all.", 0, 1, 0.01, "×"),
    ("sd", "Timing spread", "How far off the ideal moment bots press, typically. Lower = sharper timing, more "
     "perfects.", 0, 0.3, 0.005, "s"),
    ("aim", "Aim error", "Typical aim error of a bot's throw.", 0, 30, 0.1, "°"),
    ("gap_min", "Pause between throws (shortest)", "Extra wait between a bot's throws, on top of the new-ball "
     "time: at least this long...", 0, 10, 0.1, "s"),
    ("gap_max", "Pause between throws (longest)", "...and at most this long.", 0, 10, 0.1, "s"),
    ("mix_dodge", "Prefers dodge", "How much a bot favours dodging over the other defences (relative weight).",
     0, 1, 0.05, ""),
    ("mix_catch", "Prefers catch", "How much a bot favours catching (relative weight).", 0, 1, 0.05, ""),
    ("mix_deflect", "Prefers deflect", "How much a bot favours deflecting (relative weight).", 0, 1, 0.05, ""),
    ("bank", "Bank-shot chance", "Share of a bot's throws aimed off the floor or a side wall.", 0, 1, 0.01, "×"),
)


def _define():
    """Every rule, in the order the editor lists them."""
    g = "throw"
    _add(g, "throw", "CHARGE_TIME", "Charge time",
         "How long you hold the mouse button for a full-power throw. Longer: big throws take longer to wind up "
         "and are easier to see coming. Shorter: full-power throws come out almost at once.", 0.1, 3.0, 0.05, "s")
    _add(g, "throw", "THROW_SPEED_MIN", "Tap speed",
         "Speed of a quick tap throw (no charge). Speed is what deals damage, so this sets how weak the quickest "
         "throws are.", 2, 60, 0.5, "m/s")
    _add(g, "throw", "THROW_SPEED_MAX", "Full-charge speed",
         "Speed of a fully charged throw. Faster balls hit harder and leave less time to react: at 34 m/s a ball "
         "crosses a 14 m gap in about 0.4 s.", 2, 60, 0.5, "m/s")
    _add(g, "throw", "THROW_COST_MIN", "Tap stamina cost",
         "Stamina a quick tap costs. The cost grows with the charge up to the full-charge cost.", 0, 100, 1,
         "stamina", "int")
    _add(g, "throw", "THROW_COST_MAX", "Full-charge stamina cost",
         "Stamina a fully charged throw costs. With too little stamina you throw as hard as your stamina allows.",
         0, 100, 1, "stamina", "int")
    _add(g, "cooldown", "THROW_COOLDOWN", "New ball after",
         "After you throw, a new ball appears in your hand after this long. Shorter: more balls in the air, "
         "more pressure.", 0.1, 10, 0.1, "s")

    g = "damage"
    _add(g, "damage", "DAMAGE_MIN", "Damage at tap speed",
         "Damage when a ball hits at tap speed or slower.", 0, 200, 1, "HP")
    _add(g, "damage", "DAMAGE_PER_SPEED", "Extra damage per m/s",
         "Each m/s faster than tap speed adds this much damage. This is what makes charging worth it: by default "
         "a full-power throw does about 45.", 0, 10, 0.05, "HP per m/s")
    _add(g, "damage", "DAMAGE_MAX", "Damage cap",
         "No hit deals more than this, however fast the ball is (deflect rallies get very fast).", 1, 300, 1, "HP")
    _add(g, "damage", "MAX_HP", "Health",
         "Health everyone starts a round with. At 0 you're knocked out. More health: longer rounds.",
         10, 500, 5, "HP", "int")

    g = "flight"
    _add(g, "arc", "GRAVITY", "Gravity",
         "Pulls balls down into arcs. 0 = dead-straight throws; real life is 9.8. Balls still land where the "
         "crosshair points, so slow throws simply lob higher.", 0, 25, 0.5, "m/s²")
    _add(g, "duration", "BALL_LIFETIME", "Ball lifetime",
         "A ball that hasn't hit anything disappears after this long.", 1, 20, 0.5, "s")

    g = "ricochet"
    _add(g, "ricochet", "MAX_RICOCHETS", "Bounces per throw",
         "How many times a ball may ricochet off the floor or a side wall; the next contact stops it. A deflect "
         "gives the ball a fresh set. 0 = no ricochets at all.", 0, 3, 1, "", "int")
    _add(g, "ricochet", "RICOCHET_NORMAL_KEEP", "Bounce-off speed kept",
         "Share of its speed a ball keeps straight off the surface. 1 = perfectly springy; lower = the ball comes "
         "off flatter.", 0, 1, 0.05, "×")
    _add(g, "ricochet", "RICOCHET_TANGENT_KEEP", "Along-surface speed kept",
         "Share of its speed a ball keeps along the surface. Lower = the bounce brakes the ball more, so "
         "ricochets hit softer.", 0, 1, 0.05, "×")
    _add(g, "ricochet", "RICOCHET_MIN_SPEED", "Minimum bounce speed",
         "A ball slower than this after bouncing just drops dead instead of ricocheting.", 0, 40, 0.5, "m/s")
    _add(g, "ricochetTop", "RICOCHET_CONE_DEG", "Ricochet seek angle",
         "After a bounce the ball curves toward the enemy closest to its new heading, if one is within this "
         "angle. 0 = ricochets fly straight.", 0, 90, 1, "°")
    _add(g, "ricochetTop", "RICOCHET_CURVE_KEEP", "Curve kept after a bounce",
         "A bounce takes curve away: afterwards the ball bends toward that enemy only this share as hard as a "
         "ball that never bounced. 0.5 = half; 0 = ricochets fly straight; 1 = no loss. Each further bounce "
         "cuts it again. Low values make bank shots about the angle, not homing.", 0, 1, 0.05, "×")

    g = "assist"
    _add(g, "assist", "ASSIST_CONE_DEG", "Throw assist angle",
         "If an enemy is within this angle of your crosshair when you throw, the ball bends gently toward them. "
         "0 = no aim assist.", 0, 45, 0.5, "°")
    _add(g, "assist", "DEFLECT_ASSIST_CONE_DEG", "Deflect assist angle",
         "The same for deflects. They're split-second reactions, so they get a wider angle.", 0, 60, 0.5, "°")
    _add(g, "assist", "ASSIST_SLACK_DEG", "Highlighted-target bonus",
         "Extra angle for the enemy your screen marked with the gold diamond, so the assist goes where you saw "
         "it point.", 0, 15, 0.5, "°")
    _add(g, "assist", "ASSIST_TURN_RATE_DEG", "Assist bend strength",
         "How fast a full-power ball bends toward its target. Low: it only fixes small aim errors and players can "
         "juke it. High: close to homing. Slower balls bend less (see Slow-ball curve).", 0, 360, 5, "°/s")
    _add(g, "curve", "SLOW_BALL_CURVE", "Slow-ball curve",
         "How much a slow (tap) throw curves compared with a full-power one, over the same distance. 1 = the "
         "same; 0.5 = half; 0 = tap throws fly dead straight. Throws in between scale smoothly, and so does a ball "
         "that has slowed down (after a bounce, say). This also covers ricochet curves.", 0, 1, 0.05, "×")
    _add(g, "assist", "ASSIST_RANGE", "Assist range",
         "Enemies farther away than this never get aim assist or ricochet seeking.", 0, 80, 1, "m")

    for kind, verb in (("dodge", "dodged"), ("catch", "caught"), ("deflect", "deflected")):
        K = kind.upper()
        _add(kind, "defence", f"{K}_COST", "Stamina cost", f"Stamina paid when you press {kind}.", 0, 100, 1,
             "stamina", "int")
        _add(kind, "defence", f"{K}_PERFECT_COST", f"Perfect-{kind} cost",
             f"What a perfectly timed {kind} ends up costing; the rest is refunded. Can't exceed the normal cost.",
             0, 100, 1, "stamina", "int")
        window = {"dodge": ("Invulnerable time", "How long after the press you can't be hit. Any ball reaching "
                            "you in this time is dodged."),
                  "catch": ("Catch window", "How long your hands stay ready after the press. A ball arriving in "
                            "this time is caught and becomes yours."),
                  "deflect": ("Deflect window", "How long a deflect stays active after the press. Tighter than "
                              "catch on purpose: deflecting is the skill move.")}[kind]
        _add(kind, "defence", f"{K}_WINDOW", window[0], window[1], 0.03, 1.0, 0.01, "s")
        _add(kind, "defence", f"{K}_PERFECT", "Perfect zone",
             f"A ball arriving within this long after the press is {verb} perfectly: cheaper, extra cash and a "
             "gold flash. Must fit inside the window.", 0, 1.0, 0.01, "s")
        _add(kind, "defence", f"{K}_RECOVERY", "Recovery",
             "After the window you can't act again for this long, so mashing is punished." + (
                 "" if kind == "dodge" else f" A successful {kind} frees you at once."), 0, 2, 0.01, "s")
        if kind == "dodge":
            _add(kind, "dash", "DODGE_DASH_TIME", "Dash duration", "How long the dodge's dash moves you.",
                 0.05, 0.6, 0.01, "s")
            _add(kind, "dash", "DODGE_DASH_SPEED", "Dash speed",
                 "How fast the dash moves you. Distance = speed × duration (about 3 m by default).", 0, 30, 0.5, "m/s")
        elif kind == "catch":
            _add(kind, "reach", "CATCH_REACH", "Catch & deflect reach",
                 "Catches and deflects reach this far beyond your body, so they're a little easier than not getting "
                 "hit.", 0, 1.5, 0.05, "m")
        else:
            _add(kind, "rally", "DEFLECT_SPEEDUP", "Rally speed-up",
                 "Each deflect sends the ball back this many times faster (1.15 = 15% faster).", 1.0, 1.6, 0.01, "×")
            _add(kind, "rally", "BALL_SPEED_CAP", "Rally speed cap",
                 "Deflected balls never fly faster than this.", 5, 100, 1, "m/s")

    g = "stamina"
    _add(g, "stamina", "MAX_STAMINA", "Stamina",
         "Everyone's stamina pool. Throws, dodges, catches and deflects all spend it.", 10, 300, 5, "", "int")
    _add(g, "stamina", "STAMINA_REGEN", "Regeneration", "Stamina regained per second while resting.",
         0, 200, 1, "per s")
    _add(g, "stamina", "STAMINA_REGEN_DELAY", "Regeneration delay",
         "Regeneration pauses this long after any spend (Souls-style). It also pauses while charging a throw or "
         "while a defence is active.", 0, 5, 0.05, "s")

    g = "move"
    _add(g, "move", "WALK_SPEED", "Run speed", "Normal movement speed.", 1, 15, 0.25, "m/s")
    _add(g, "move", "CHARGE_WALK_SPEED", "Speed while charging", "Movement speed while winding up a throw.",
         0, 15, 0.25, "m/s")
    _add(g, "move", "DEFEND_WALK_SPEED", "Speed while catching or deflecting",
         "Movement speed while a catch or deflect is active.", 0, 15, 0.25, "m/s")

    g = "body"
    _add(g, "reach", "PLAYER_RADIUS", "Body hit radius",
         "How wide each player's hit zone is (a capsule from the shins to the head). Bigger: easier to hit and "
         "easier to catch with.", 0.15, 1.0, 0.01, "m")
    _add(g, "reach", "BALL_RADIUS", "Ball radius", "How big the ball is, for hits and on screen.",
         0.08, 0.5, 0.01, "m")
    _add(g, "reach", "CHEST_HEIGHT", "Aim height", "The height on a player that aim assist and bots aim at.",
         0.5, 1.8, 0.05, "m")

    g = "court"
    _add(g, "court", "COURT_HALF_LENGTH_BASE", "Half-length",
         "Distance from the centre line to each end wall, before adding players. The court is sized for the "
         "biggest team.", 5, 40, 0.5, "m")
    _add(g, "court", "COURT_HALF_LENGTH_PER_PLAYER", "Extra length per player",
         "Each player in the biggest team pushes both end walls back by this much.", 0, 5, 0.1, "m")
    _add(g, "court", "COURT_HALF_WIDTH_BASE", "Half-width",
         "Distance from the middle to each side wall, before adding players.", 2, 40, 0.5, "m")
    _add(g, "court", "COURT_HALF_WIDTH_PER_PLAYER", "Extra width per player",
         "Each player in the biggest team pushes both side walls out by this much.", 0, 5, 0.05, "m")
    _add(g, "court", "CENTER_GAP", "Centre no-go strip",
         "Nobody may stand closer than this to the centre line, so there are no point-blank throws.", 0, 5, 0.1, "m")
    _add(g, "court", "SPAWN_FRACTION", "Line-up depth",
         "Where teams line up at the start of a round, as a share of their half's depth.", 0.2, 0.95, 0.05, "×")

    g = "cash"
    for key, label, desc in (
            ("CASH_HIT", "Hit", "Cash for hitting an enemy."),
            ("CASH_KO", "Knockout bonus", "Extra cash when your hit knocks them out."),
            ("CASH_CATCH", "Catch", "Cash for a catch."),
            ("CASH_PERFECT_CATCH", "Perfect catch", "Cash for a perfectly timed catch (instead of the normal amount)."),
            ("CASH_DEFLECT", "Deflect", "Cash for a deflect."),
            ("CASH_PERFECT_DEFLECT", "Perfect deflect", "Cash for a perfectly timed deflect."),
            ("CASH_PERFECT_DODGE", "Perfect dodge", "Cash for a perfectly timed dodge (normal dodges pay nothing)."),
            ("CASH_RALLY_BONUS", "Rally bonus", "Extra cash per deflection already on a ball you catch or deflect.")):
        _add(g, "cash", key, label, desc, 0, 200, 1, "cash", "int")
    _add(g, "cash", "REVIVE_COST", "First revive price",
         "Cash to revive a fallen teammate (R). This is the price of a team's first revive in a round...",
         0, 2000, 5, "cash", "int")
    _add(g, "cash", "REVIVE_COST_STEP", "Revive price increase",
         "...and every further revive that round costs this much more. Prices start over every round. 0 = a flat "
         "price, which can make rounds drag on forever.", 0, 1000, 5, "cash", "int")
    _add(g, "cash", "REVIVE_HP", "Revived health", "Health a revived player comes back with.", 1, 500, 1, "HP", "int")
    _add(g, "duration", "REVIVE_INVULN", "Revive protection", "A revived player can't be hit for this long.",
         0, 10, 0.1, "s")
    _add(g, "cash", "CASH_RESETS_EACH_ROUND", "Cash resets each round",
         "On: everyone starts each round with no cash. Off: cash carries over from round to round, while revive "
         "prices still start over every round. Either way a new match starts everyone at 0.", 0, 1, 1, kind="bool")
    _add(g, "cash", "TEAM_CASH", "Shared team cash",
         "On: all cash anyone earns goes into one pot per team, and any teammate can spend it on revives. "
         "Off: everyone keeps and spends their own.", 0, 1, 1, kind="bool")

    g = "rounds"
    _add(g, "rounds", "MATCH_ROUNDS_TO_WIN", "Rounds to win the match",
         "The first team to win this many rounds wins the match, and everyone returns to the lobby. "
         "0 = endless rounds until the host ends the match.", 0, 15, 1, "", "int")
    _add(g, "rounds", "ROUND_TIME_LIMIT", "Round time limit",
         "When time runs out, the team with more players standing wins the round (then the one with more "
         "total health).", 20, 900, 10, "s")
    _add(g, "rounds", "COUNTDOWN_TIME", "Countdown",
         "The countdown before each round. You can move but not throw or defend.", 1, 10, 0.5, "s")
    _add(g, "rounds", "MATCH_START_EXTRA", "Extra countdown at match start",
         "The first countdown of a match is this much longer, so everyone has time to click into the game.",
         0, 10, 0.5, "s")
    _add(g, "rounds", "ROUND_OVER_TIME", "Between rounds",
         "How long the round result shows before the next countdown.", 1, 15, 0.5, "s")
    _add(g, "duration", "WARMUP_RESPAWN", "Warm-up respawn",
         "In the lobby's warm-up (and while waiting for players), knocked-out players stand back up after this "
         "long.", 0.5, 10, 0.5, "s")

    g = "bots"
    for key, team in (("BOTS_RED", "RED"), ("BOTS_BLUE", "BLUE")):
        _add(g, "bots", key, f"{team} bots",
             f"How many bots play for {team}, whoever else is on the team. Nothing adds, removes or balances them "
             f"but the host (max {C.BOTS_PER_TEAM_MAX}).", 0, C.BOTS_PER_TEAM_MAX, 1, "bots", "int")
    _add(g, "bots", "BOT_SKILL", "Bot skill", "Which of the skill profiles below the bots use.", 0, 1, 1,
         kind="choice", choices=SKILLS)
    _add(g, "bots", "BOT_STAMINA_RESERVE", "Stamina bots keep for defence",
         "Bots only throw while they'd still have this much stamina left to defend with.", 0, 100, 1, "stamina")
    for skill in SKILLS:
        for field, label, desc, lo, hi, step, unit in BOT_FIELDS:
            _add(g, "bots", f"BOT_{skill.upper()}_{field.upper()}", label, desc, lo, hi, step, unit,
                 sub=f"{skill.title()} bots")

    g = "network"
    _add(g, "network", "INTERP_DELAY", "View delay",
         "Everyone's screen shows the world this far in the past, as a cushion for Wi-Fi that delivers updates "
         "late. When an update comes later than the cushion, the other players and the balls freeze for a moment, "
         "then jump. Bigger: fewer of those stutters, but everything you see is a little older (presses are still "
         "judged fairly). Smaller: fresher but jumpier. Keep it above about two update intervals.",
         0.03, 0.3, 0.005, "s")
    _add(g, "network", "MAX_LAG_COMP", "Lag compensation limit",
         "Dodge, catch and deflect presses are judged against what the player's screen showed, up to this far "
         "back. Higher: fairer for laggy players, but others see balls hang on them a little longer.",
         0, 0.5, 0.01, "s")
    _add(g, "defence", "PRESS_GRACE", "Press grace",
         "Dodge, catch and deflect presses count as if made this much earlier. Your screen is drawn a moment before "
         "your finger hits the key (a frame, plus the monitor's own delay), so a press that looked perfect can land "
         "a hair late: \"I pressed exactly as it touched me and still got hit\". 0.02 s is one or two frames. "
         "0 = judged exactly; higher = more forgiving for everyone (not bots).", 0, 0.1, 0.005, "s")
    _add(g, "sidestep", "SIDESTEP_COMP", "Sidestep compensation",
         "Stepping out of a ball's way is judged by what your own screen showed, like presses are. Your screen "
         "runs about 0.1 s behind the server, which at full speed is 2–3 m of ball. On: if you had already moved "
         "clear on your screen when the ball got there, it misses you (the thrower may see it pass through you). "
         "Off: the server's latest idea of where you are decides, so a ball can hit you after you dodged it on "
         "screen.", 0, 1, 1, kind="bool")
    _add(g, "defence", "LOCKOUT_SCALE", "Lockout after a missed press",
         "After a dodge, catch or deflect that meets no ball, you can't press another one until its window and its "
         "recovery are over (about half a second). This scales that lockout: 1 = normal; 0.5 = half; 0 = none: "
         "you can press again at once, and the new press takes over from the one still active (each press still "
         "costs stamina). A successful catch or deflect frees you at once anyway.", 0, 1.5, 0.05, "×")
    _add(g, "network", "SNAPSHOT_RATE", "World updates per second",
         "How often the server sends the world to each browser.", 10, 60, 1, "per s", "int")
    _add(g, "network", "TICK_RATE", "Server steps per second",
         "How often the server updates the game. Balls move in fine sub-steps either way.", 30, 120, 1, "per s", "int")


_define()

BY_KEY = {p.key: p for p in PARAMS}
_LABEL_COUNT = {}
for _param in PARAMS:
    _LABEL_COUNT[_param.label] = _LABEL_COUNT.get(_param.label, 0) + 1
del _param


def _default(key):
    if key.startswith("BOT_") and key.split("_")[1].lower() in SKILLS:
        skill = key.split("_")[1].lower()
        return C.BOT_PROFILES[skill][key[len("BOT_") + len(skill) + 1:].lower()]
    return getattr(C, key)


DEFAULTS = {p.key: BY_KEY[p.key].clean(_default(p.key)) for p in PARAMS}

# Pairs that must stay in order. When an edit breaks the order, the edited one wins.
ORDERED_PAIRS = [("THROW_SPEED_MIN", "THROW_SPEED_MAX"), ("THROW_COST_MIN", "THROW_COST_MAX"),
                 ("DAMAGE_MIN", "DAMAGE_MAX")] + [(f"BOT_{s.upper()}_GAP_MIN", f"BOT_{s.upper()}_GAP_MAX")
                                                  for s in SKILLS]


# Each of these may not exceed the other: the perfect zone fits in the window, a perfect costs no more.
CAPPED_BY = [[f"{k.upper()}_{a}", f"{k.upper()}_{b}"] for k in ACTION_KINDS
             for a, b in (("PERFECT", "WINDOW"), ("PERFECT_COST", "COST"))]


def display_name(key):
    """A rule's name for messages: its label, prefixed with its section when the label repeats."""
    p = BY_KEY[key]
    if _LABEL_COUNT[p.label] == 1:
        return p.label
    return f"{p.sub or GROUP_TITLES[p.group]}: {p.label}"


def schema():
    """Everything the rules editor in the browser needs to list and explain the rules."""
    return {"groups": [{"id": gid, "title": title, "blurb": blurb} for gid, title, blurb in GROUPS],
            "params": [asdict(p) for p in PARAMS], "pairs": ORDERED_PAIRS, "caps": CAPPED_BY}


class Rules:
    """One complete set of rule values, read as attributes: rules.WALK_SPEED."""

    def __init__(self, values=None):
        self.__dict__.update(DEFAULTS)
        self._derive()
        if values:
            self.update(values)

    def update(self, values):
        """Apply untrusted {key: value} edits: unknown keys and wrong types are ignored, numbers are
        clamped to their range and ordered pairs are kept in order. Returns the keys that changed."""
        if not isinstance(values, dict):
            return []
        before = self.values()
        edited = set()
        for key, raw in values.items():
            param = BY_KEY.get(key) if isinstance(key, str) else None
            value = param.clean(raw) if param else None
            if value is not None:
                setattr(self, key, value)
                edited.add(key)
        self._fix(edited)
        self._derive()
        return [k for k, v in self.values().items() if v != before[k]]

    def _fix(self, edited):
        v = self.__dict__
        for lo, hi in ORDERED_PAIRS:
            if v[lo] > v[hi]:
                if hi in edited and lo not in edited:
                    v[lo] = v[hi]
                else:
                    v[hi] = v[lo]
        for key, cap in CAPPED_BY:
            v[key] = min(v[key], v[cap])

    def _derive(self):
        self.actions = {kind: ActionSpec(*(getattr(self, f"{kind.upper()}_{f}")
                                           for f in ("COST", "PERFECT_COST", "WINDOW", "PERFECT", "RECOVERY")))
                        for kind in ACTION_KINDS}

    def values(self):
        return {p.key: getattr(self, p.key) for p in PARAMS}

    def copy(self):
        return Rules(self.values())

    def differences(self, other=None):
        """Keys whose value differs from `other` (default: the default rules)."""
        base = other.values() if other is not None else DEFAULTS
        return [k for k, v in self.values().items() if v != base[k]]

    # ---- formulas shared by the game and the bots

    def throw_cost(self, power):
        return self.THROW_COST_MIN + (self.THROW_COST_MAX - self.THROW_COST_MIN) * power

    def throw_speed(self, power):
        return self.THROW_SPEED_MIN + (self.THROW_SPEED_MAX - self.THROW_SPEED_MIN) * power

    def damage_for(self, speed):
        return _clamp(self.DAMAGE_MIN + (speed - self.THROW_SPEED_MIN) * self.DAMAGE_PER_SPEED,
                      self.DAMAGE_MIN, self.DAMAGE_MAX)

    def bot_profile(self, skill):
        s = (skill if skill in SKILLS else "normal").upper()
        return {f[0]: getattr(self, f"BOT_{s}_{f[0].upper()}") for f in BOT_FIELDS}

    def for_client(self):
        """The numbers each browser needs for its HUD, its own movement and its previews."""
        return {
            "centerGap": self.CENTER_GAP,      # the court's size itself arrives with every snapshot
            "gravity": self.GRAVITY,
            "ricochet": {"normalKeep": self.RICOCHET_NORMAL_KEEP, "tangentKeep": self.RICOCHET_TANGENT_KEEP,
                         "minSpeed": self.RICOCHET_MIN_SPEED, "max": self.MAX_RICOCHETS},
            "damage": {"min": self.DAMAGE_MIN, "perSpeed": self.DAMAGE_PER_SPEED, "max": self.DAMAGE_MAX},
            "playerRadius": self.PLAYER_RADIUS, "ballRadius": self.BALL_RADIUS, "chestHeight": self.CHEST_HEIGHT,
            "walk": self.WALK_SPEED, "chargeWalk": self.CHARGE_WALK_SPEED, "defendWalk": self.DEFEND_WALK_SPEED,
            "maxHp": self.MAX_HP, "maxStamina": self.MAX_STAMINA,
            "chargeTime": self.CHARGE_TIME, "throwCost": [self.THROW_COST_MIN, self.THROW_COST_MAX],
            "throwSpeed": [self.THROW_SPEED_MIN, self.THROW_SPEED_MAX], "cooldown": self.THROW_COOLDOWN,
            "actions": {kind: asdict(spec) for kind, spec in self.actions.items()},
            "dash": {"time": self.DODGE_DASH_TIME, "speed": self.DODGE_DASH_SPEED},
            "assistCone": self.ASSIST_CONE_DEG, "deflectCone": self.DEFLECT_ASSIST_CONE_DEG,
            "assistRange": self.ASSIST_RANGE, "reviveCost": self.REVIVE_COST, "interpDelay": self.INTERP_DELAY,
            "teamCash": self.TEAM_CASH, "botsMax": C.BOTS_PER_TEAM_MAX,
            "pressGrace": self.PRESS_GRACE, "sidestepComp": self.SIDESTEP_COMP, "lockoutScale": self.LOCKOUT_SCALE,
        }

    def bots_for(self, team):
        return self.BOTS_BLUE if team == 1 else self.BOTS_RED

    def curve_share(self, speed):
        """How hard a ball at `speed` bends, as a share of a full-power ball's turn rate (per second).
        Per metre travelled, a full-power ball bends the most and a tap-speed one SLOW_BALL_CURVE as
        much, scaling in between; faster balls (rallies) bend like full-power ones per metre."""
        lo, hi = self.THROW_SPEED_MIN, self.THROW_SPEED_MAX
        f = _clamp((speed - lo) / (hi - lo), 0.0, 1.0) if hi > lo else 1.0
        return (self.SLOW_BALL_CURVE + (1.0 - self.SLOW_BALL_CURVE) * f) * speed / max(hi, 1e-6)
