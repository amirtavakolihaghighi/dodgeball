"""The game's rules: every number the host can change from the lobby.

Each rule has a name, a plain-language description, an allowed range and a preview (an
animated diagram in the rules editor, drawn by static/js/previews.js). Defaults come from
config.py. A Rules object holds one complete set of values, read as attributes
(rules.WALK_SPEED). Edits from browsers go through Rules.update(), which ignores unknown keys,
rejects wrong types and clamps numbers to their range, so no value can break the server.

A rule set also holds each player's own settings (Rules.players: who -> {key: value}), for the
rules that may differ per player (Param.who). Rules.for_player(who) is the set that player plays
by: everyone's values with theirs on top. Own settings follow a player's identity, not their name
(two people may share a name): see clean_key.
"""
from __future__ import annotations

import hashlib
import math
import re
from dataclasses import asdict, dataclass

import config as C
from bots import NAMES as BOT_NAMES
from config import ActionSpec

ACTION_KINDS = ("dodge", "catch", "deflect")
SKILLS = ("easy", "normal", "hard")
COLOR = re.compile(r"#[0-9a-fA-F]{6}")
MAX_CUSTOM_PLAYERS = 64     # players and bots with their own settings, at most
NAME_LENGTH = 32            # the longest player name (sim.py cleans names the same way; main.js NAME_LENGTH)


def _clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def clean_name(name):
    """A player's name as the game stores it: printable, trimmed, at most NAME_LENGTH long."""
    return "".join(ch for ch in str(name or "") if ch.isprintable()).strip()[:NAME_LENGTH]


# Who own settings belong to (a "key"):
#   u + 10 hex    a person: from their browser's secret code (identity_key), so it follows them
#                 through renames and reloads, and nobody gets it by taking their name;
#   b:<id>        a bot: a built-in one by its name (b:ace is "Bot Ace"), or one the host made;
#   n:<name>      a name nobody has claimed yet: own settings from an older file or saved_rules.json
#                 (which went by name), or a test's player. The first person to join with that name
#                 takes them over (Rules.claim).
PERSON_KEY = re.compile(r"u[0-9a-f]{10}")
BOT_KEY = re.compile(r"b:[a-z0-9][a-z0-9-]{0,39}")
BUILTIN_BOTS = {f"Bot {n}": f"b:{n.lower()}" for n in BOT_NAMES}     # how older files named the built-in bots


def identity_key(code):
    """A person's key from the secret code their browser keeps: others see the key, never the code."""
    return "u" + hashlib.sha256(str(code).encode()).hexdigest()[:10]


def clean_key(raw):
    """An untrusted key (or, the old way, a name) -> a key, or "" if it's neither. A bare name is
    read as older files meant it: a built-in bot's name is that bot, any other waits for a person."""
    if not isinstance(raw, str):
        return ""
    if PERSON_KEY.fullmatch(raw) or BOT_KEY.fullmatch(raw):
        return raw
    named = raw.startswith("n:")
    name = clean_name(raw[2:] if named else raw)
    if not name:
        return ""
    return BUILTIN_BOTS[name] if name in BUILTIN_BOTS and not named else f"n:{name}"


def key_label(key, labels=None):
    """How a key reads in messages: the name last seen with it."""
    if labels and labels.get(key):
        return labels[key]
    if key.startswith("n:"):
        return key[2:]
    if key.startswith("b:"):
        return next((name for name, k in BUILTIN_BOTS.items() if k == key), key[2:])
    return key


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
    kind: str = "float"     # float | int | bool | choice | color ("#rrggbb")
    choices: tuple = ()
    preview: str = ""       # which animated diagram explains it (static/js/previews.js)
    sub: str = ""           # sub-heading inside the group
    who: str = ""           # who may have their own value: "" nobody (the same for everyone), "all", "people", "bots"
    team: int = -1          # a rule about one team only (0 RED, 1 BLUE); -1 = both
    labels: tuple = ()      # how each of `choices` reads in the editor (default: the choice, capitalised)

    def clean(self, raw):
        """An untrusted value from a browser -> a valid value for this rule, or None."""
        if self.kind == "bool":
            return raw if isinstance(raw, bool) else None
        if self.kind == "choice":
            return raw if isinstance(raw, str) and raw in self.choices else None
        if self.kind == "color":
            return raw.lower() if isinstance(raw, str) and COLOR.fullmatch(raw) else None
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not math.isfinite(raw):
            return None
        value = _clamp(raw, self.lo, self.hi)
        return int(round(value)) if self.kind == "int" else round(float(value), 4)


GROUPS = [
    ("throw", "Throwing", "How throws charge, how fast they fly and what they cost."),
    ("damage", "Damage & health", "How much a hit hurts, and how much it takes to go down."),
    ("teamhp", "Team health", "One shared health bar per team instead of everyone's own: the team falls together. "
     "Cash buys health for the bar (R)."),
    ("flight", "Ball flight", "How balls fly through the air."),
    ("ricochet", "Ricochets", "Bounces off the floor and the side walls (the end walls always stop balls)."),
    ("assist", "Aim assist", "The gentle bend toward an enemy near your crosshair."),
    ("dodge", "Dodge", "Space / Shift: a dash you can't be hit during."),
    ("catch", "Catch", "Right mouse / F: the ball becomes yours."),
    ("deflect", "Deflect & rallies", "E: sends the ball straight back, faster every time."),
    ("stamina", "Stamina", "The Souls-style pool every action spends."),
    ("move", "Movement", "How fast players get around."),
    ("body", "Bodies & hitboxes", "How big players and balls are for hits."),
    ("colors", "Ball colours", "Each team's balls, in two shades: people's, and bots'. A deflected ball shows its rally "
     "colour instead (cyan, magenta, red, white), so keep these clear of those."),
    ("court", "Court", "The arena's size grows with the biggest team."),
    ("cash", "Cash & revives", "Cash comes from good play and buys revives (R) for fallen teammates. With team health "
     "on, nobody is down alone, so R buys health for the team instead."),
    ("rounds", "Rounds & match", "Round timing and how a match is won."),
    ("bots", "Bots", "Computer players that fill the teams."),
    ("network", "Network (advanced)", "How the game hides Wi-Fi delay, and how fairly it judges presses and dodges. Change these "
     "to experiment with lag. (The other change from the lag study, ricochet homing, is under Ricochets: Curve kept after "
     "a bounce.)"),
]
GROUP_TITLES = dict((g, title) for g, title, _ in GROUPS)

PARAMS: list[Param] = []


def _add(group, preview, key, label, desc, lo, hi, step, unit="", kind="float", choices=(), sub="", who="", team=-1,
         labels=()):
    PARAMS.append(Param(key, group, label, desc, lo, hi, step, unit, kind, choices, preview, sub, who, team, labels))


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
    ("power_min", "Weakest throw", "How hard a bot throws, as a share of a full charge: each throw is somewhere between "
     "this...", 0, 1, 0.05, "×"),
    ("power_max", "Strongest throw", "...and this (both 1: every throw at full power). It never throws harder than its "
     "stamina allows.", 0, 1, 0.05, "×"),
    ("stance", "Where it stands", "Where in its half a bot moves about: −1 at the back, 0 anywhere, 1 near the centre "
     "line.", -1, 1, 0.1, ""),
    ("sidestep", "Walks out of slow balls", "Chance that a bot just walks out of the way of a slow ball (under 20 m/s) "
     "instead of dodging, catching or deflecting it.", 0, 1, 0.05, "×"),
)


def _still_rules(g, prefix, sub, who, desc, time_desc, extra_desc, percent_desc):
    """Standing still and regeneration: a player's own (HEALTH_REGEN_STILL_...) or the team bar's
    (TEAM_REGEN_STILL_...), as Rules.regen_speed reads them."""
    team = prefix.startswith("TEAM")
    _add(g, "regen", f"{prefix}_STILL", "Standing still", desc, 0, 1, 1, kind="choice",
         choices=("faster", "only", "off"), labels=("Makes it faster", "Is needed for it", "Doesn't matter"), sub=sub,
         who=who)
    _add(g, "regen", f"{prefix}_STILL_TIME", "Standing still for", time_desc, 0, 10, 0.1, "s", sub=sub, who=who)
    each = ", for each teammate standing still" if team else ""
    _add(g, "regen", f"{prefix}_STILL_BOOST", "Faster by",
         f"Extra health per second: standing still adds a fixed amount to the speed{each}. A percentage: it makes "
         f"the speed that much faster{each}.", 0, 1, 1, kind="choice", choices=("extra", "percent"), labels=("Extra health per second", "A percentage"),
         sub=sub, who=who)
    _add(g, "regen", f"{prefix}_STILL_EXTRA", "Extra per teammate standing still" if team else "Extra while standing still",
         "With extra health per second: " + extra_desc[0].lower() + extra_desc[1:], 0, 50, 0.1, "HP per s", sub=sub,
         who=who)
    _add(g, "regen", f"{prefix}_STILL_PERCENT", "Percentage per teammate standing still" if team
         else "Percentage while standing still", "With a percentage: " + percent_desc[0].lower() + percent_desc[1:],
         0, 1000, 5, "%", "int", sub=sub, who=who)


def _define():
    """Every rule, in the order the editor lists them. `who`: who may have their own value (see
    Param.who); a rule without it is the same for everyone."""
    g = "throw"
    _add(g, "throw", "CHARGE_TIME", "Charge time",
         "How long you hold the mouse button for a full-power throw. Longer: big throws take longer to wind up "
         "and are easier to see coming. Shorter: full-power throws come out almost at once.", 0.1, 3.0, 0.05, "s",
         who="all")
    _add(g, "throw", "THROW_SPEED_MIN", "Tap speed",
         "Speed of a quick tap throw (no charge). Speed is what deals damage, so this sets how weak the quickest "
         "throws are.", 2, 60, 0.5, "m/s", who="all")
    _add(g, "throw", "THROW_SPEED_MAX", "Full-charge speed",
         "Speed of a fully charged throw. Faster balls hit harder and leave less time to react: at 34 m/s a ball "
         "crosses a 14 m gap in about 0.4 s.", 2, 60, 0.5, "m/s", who="all")
    _add(g, "throw", "THROW_COST_MIN", "Tap stamina cost",
         "Stamina a quick tap costs. The cost grows with the charge up to the full-charge cost.", 0, 100, 1,
         "stamina", "int", who="all")
    _add(g, "throw", "THROW_COST_MAX", "Full-charge stamina cost",
         "Stamina a fully charged throw costs. With too little stamina you throw as hard as your stamina allows.",
         0, 100, 1, "stamina", "int", who="all")
    _add(g, "cooldown", "THROW_COOLDOWN", "New ball after",
         "After you throw, a new ball appears in your hand after this long. Shorter: more balls in the air, "
         "more pressure.", 0.1, 10, 0.1, "s", who="all")

    g = "damage"
    _add(g, "damage", "DAMAGE_MIN", "Damage at tap speed",
         "Damage when a ball hits at tap speed or slower.", 0, 200, 1, "HP", who="all")
    _add(g, "damage", "DAMAGE_PER_SPEED", "Extra damage per m/s",
         "Each m/s faster than tap speed adds this much damage. This is what makes charging worth it: by default "
         "a full-power throw does about 45.", 0, 10, 0.05, "HP per m/s", who="all")
    _add(g, "damage", "DAMAGE_MAX", "Damage cap",
         "No hit deals more than this, however fast the ball is (deflect rallies get very fast).", 1, 300, 1, "HP",
         who="all")
    _add(g, "damage", "MAX_HP", "Health",
         "Health everyone starts a round with. At 0 you're knocked out. More health: longer rounds. With team "
         "health on (and the bar added up), this is what each player brings to their team's bar.",
         10, 500, 5, "HP", "int", who="all")
    sub = "Health regeneration"
    _add(g, "regen", "HEALTH_REGEN", "Health regeneration",
         "On: your health comes back by itself, a little at a time, once nobody has hit you for a while, up to a "
         "limit. Off: health only comes back with a revive (or the next round). With team health on, this does "
         "nothing: the team's bar has its own regeneration, under Team health.", 0, 1, 1, kind="bool", sub=sub,
         who="all")
    _add(g, "regen", "HEALTH_REGEN_RATE", "Regeneration speed",
         "Health regained per second while regenerating.", 0.1, 50, 0.1, "HP per s", sub=sub, who="all")
    _add(g, "regen", "HEALTH_REGEN_DELAY", "Pause after a hit",
         "Regeneration starts this long after your last hit (or after you come back in), and every hit starts the "
         "pause again. 0 = no pause: health keeps coming back even under fire.", 0, 30, 0.5, "s", sub=sub, who="all")
    _add(g, "regen", "HEALTH_REGEN_CAP_MODE", "Regenerates up to",
         "A share of full health: regeneration stops at that share (below), so more health means more comes back. "
         "A fixed amount: it stops at that much health, whatever your full health. Either way it never takes "
         "health away: above the limit, nothing happens.", 0, 1, 1, kind="choice", choices=("share", "amount"),
         labels=("A share of full health", "A fixed amount"), sub=sub, who="all")
    _add(g, "regen", "HEALTH_REGEN_CAP_SHARE", "Share",
         "With a share: regeneration stops at this share of full health. 100% = all the way back.", 1, 100, 1, "%",
         "int", sub=sub, who="all")
    _add(g, "regen", "HEALTH_REGEN_CAP_AMOUNT", "Amount",
         "With a fixed amount: regeneration stops at this much health (never above full health).", 1, 500, 1, "HP",
         "int", sub=sub, who="all")
    _still_rules(g, "HEALTH_REGEN", sub, "all",
                 "Faster: standing still for a moment (set below) regenerates faster than moving. Needed: health "
                 "only comes back while you stand still. Doesn't matter: the same speed either way. Standing still "
                 "means not walking: turning, throwing and defending are fine, and a dodge's dash doesn't count as "
                 "moving, even with a direction held, as long as you let go before the dash ends.",
                 "How long you have to stand still before it counts. Walking (not dodging) starts it over.",
                 "What standing still adds to the speed: 2 + 4 = 6 per second.",
                 "How much faster standing still makes it: +200% = three times as fast.")

    g = "teamhp"
    _add(g, "teamhp", "TEAM_HEALTH", "Team health",
         "On: each team shares one health bar. Every hit on anyone drains it, nobody is knocked out alone, and "
         "when it's empty the whole team falls at once and loses the round. Nobody is ever down alone, so there are "
         "no revives: R spends cash on health for the bar instead. When time runs out, the team with more of its "
         "bar left wins. Off: everyone has their own health.", 0, 1, 1, kind="bool")
    _add(g, "teamhp", "TEAM_HEALTH_SIZE", "Team bar size",
         "Added up: each player brings their own health to the bar (3 players with 100 = 300), so a bigger team has "
         "a bigger bar, as it has more health today; someone joining mid-round brings their share, and a player "
         "given extra health in their own settings adds it. Fixed: every team gets the same bar (set below), "
         "whatever its size.", 0, 1, 1, kind="choice", choices=("sum", "fixed"),
         labels=("Everyone's health added up", "A fixed size"))
    _add(g, "teamhp", "TEAM_HEALTH_FIXED", "Fixed bar",
         "With a fixed bar size: the health each team's bar holds, whatever the team's size.", 10, 3000, 10, "HP",
         "int")
    _add(g, "teamhp", "TEAM_HEAL_MODE", "R buys",
         "A pack: each press of R adds a fixed amount of health to the bar, for a price that rises with every pack "
         "the team buys that round (like revives, whose flat price made rounds endless in tests). All your cash: a "
         "press turns all your cash (or the team's pot) into health at a fixed rate, up to a full bar.",
         0, 1, 1, kind="choice", choices=("pack", "cash"), labels=("A pack per press", "All your cash"))
    _add(g, "teamhp", "TEAM_HEAL_AMOUNT", "Health per pack",
         "With packs: how much health one press of R adds to the team's bar.", 1, 500, 1, "HP", "int",
         sub="A pack per press")
    _add(g, "teamhp", "TEAM_HEAL_COST", "First pack price",
         "With packs: what a team's first pack costs in a round...", 0, 2000, 5, "cash", "int", sub="A pack per press")
    _add(g, "teamhp", "TEAM_HEAL_COST_STEP", "Pack price increase",
         "...and every further pack that round costs this much more. Prices start over every round. 0 = a flat "
         "price, which can make rounds drag on.", 0, 1000, 5, "cash", "int", sub="A pack per press")
    _add(g, "teamhp", "TEAM_HEAL_PER_CASH", "Health per cash",
         "With all your cash: how much health each cash buys. A press spends only what the bar is missing. At 1, "
         "cash came in about as fast as damage and bot rounds ran to the time limit; 0.5 keeps them as long as "
         "without team health.", 0.05, 5, 0.05, "HP", sub="All your cash")
    sub = "Bar regeneration"
    _add(g, "regen", "TEAM_REGEN", "Bar regeneration",
         "On: the team's bar fills back up by itself, a little at a time, once nobody on the team has been hit for a "
         "while, up to a limit. Off: only health bought with R fills it.", 0, 1, 1, kind="bool", sub=sub)
    _add(g, "regen", "TEAM_REGEN_RATE", "Regeneration speed",
         "Health the bar regains per second while regenerating, for the whole team (however many are on it).",
         0.1, 100, 0.1, "HP per s", sub=sub)
    _add(g, "regen", "TEAM_REGEN_DELAY", "Pause after a hit",
         "Regeneration starts this long after anyone on the team was last hit, and every hit on any of them starts "
         "the pause again. 0 = no pause.", 0, 30, 0.5, "s", sub=sub)
    _add(g, "regen", "TEAM_REGEN_CAP_MODE", "Regenerates up to",
         "A share of the bar: regeneration stops at that share (below), so a bigger bar regains more. A fixed "
         "amount: it stops at that much health, whatever the bar's size. Either way it never takes health away.",
         0, 1, 1, kind="choice", choices=("share", "amount"), labels=("A share of the bar", "A fixed amount"), sub=sub)
    _add(g, "regen", "TEAM_REGEN_CAP_SHARE", "Share",
         "With a share: regeneration stops at this share of the bar. 100% = all the way back.", 1, 100, 1, "%", "int",
         sub=sub)
    _add(g, "regen", "TEAM_REGEN_CAP_AMOUNT", "Amount",
         "With a fixed amount: regeneration stops at this much health (never above the bar's size).", 1, 3000, 10,
         "HP", "int", sub=sub)
    _still_rules(g, "TEAM_REGEN", sub, "",
                 "Faster: each teammate standing still for a moment (set below) makes the bar regenerate faster. "
                 "Needed: the bar only regenerates while at least one of them stands still. Doesn't matter: the same "
                 "speed either way. Standing still means not walking; a dodge's dash doesn't count as moving.",
                 "How long a teammate has to stand still before they count. Walking (not dodging) starts it over.",
                 "What each teammate standing still adds to the bar's speed: 5 + 3 × 4 = 17 per second with three.",
                 "How much faster each teammate standing still makes it: +50% each, so three = +150%.")

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
         "0 = no aim assist.", 0, 45, 0.5, "°", who="all")
    _add(g, "assist", "DEFLECT_ASSIST_CONE_DEG", "Deflect assist angle",
         "The same for deflects. They're split-second reactions, so they get a wider angle.", 0, 60, 0.5, "°",
         who="all")
    _add(g, "assist", "ASSIST_SLACK_DEG", "Highlighted-target bonus",
         "Extra angle for the enemy your screen marked with the gold diamond, so the assist goes where you saw "
         "it point.", 0, 15, 0.5, "°", who="all")
    _add(g, "assist", "ASSIST_TURN_RATE_DEG", "Assist bend strength",
         "How fast a full-power ball bends toward its target. Low: it only fixes small aim errors and players can "
         "juke it. High: close to homing. Slower balls bend less (see Slow-ball curve).", 0, 360, 5, "°/s",
         who="all")
    _add(g, "curve", "SLOW_BALL_CURVE", "Slow-ball curve",
         "How much a slow (tap) throw curves compared with a full-power one, over the same distance. 1 = the "
         "same; 0.5 = half; 0 = tap throws fly dead straight. Throws in between scale smoothly, and so does a ball "
         "that has slowed down (after a bounce, say). This also covers ricochet curves.", 0, 1, 0.05, "×",
         who="all")
    _add(g, "assist", "ASSIST_RANGE", "Assist range",
         "Enemies farther away than this never get aim assist or ricochet seeking.", 0, 80, 1, "m", who="all")

    for kind, verb in (("dodge", "dodged"), ("catch", "caught"), ("deflect", "deflected")):
        K = kind.upper()
        _add(kind, "defence", f"{K}_COST", "Stamina cost", f"Stamina paid when you press {kind}.", 0, 100, 1,
             "stamina", "int", who="all")
        _add(kind, "defence", f"{K}_PERFECT_COST", f"Perfect-{kind} cost",
             f"What a perfectly timed {kind} ends up costing; the rest is refunded. Can't exceed the normal cost.",
             0, 100, 1, "stamina", "int", who="all")
        window = {"dodge": ("Invulnerable time", "How long after the press you can't be hit. Any ball reaching "
                            "you in this time is dodged."),
                  "catch": ("Catch window", "How long your hands stay ready after the press. A ball arriving in "
                            "this time is caught and becomes yours."),
                  "deflect": ("Deflect window", "How long a deflect stays active after the press. Tighter than "
                              "catch on purpose: deflecting is the skill move.")}[kind]
        _add(kind, "defence", f"{K}_WINDOW", window[0], window[1], 0.03, 1.0, 0.01, "s", who="all")
        _add(kind, "defence", f"{K}_PERFECT", "Perfect zone",
             f"A ball arriving within this long after the press is {verb} perfectly: cheaper, extra cash and a "
             "gold flash. Must fit inside the window.", 0, 1.0, 0.01, "s", who="all")
        _add(kind, "defence", f"{K}_RECOVERY", "Recovery",
             "After the window you can't act again for this long, so mashing is punished." + (
                 "" if kind == "dodge" else f" A successful {kind} frees you at once."), 0, 2, 0.01, "s", who="all")
        if kind == "dodge":
            _add(kind, "dash", "DODGE_DASH_TIME", "Dash duration", "How long the dodge's dash moves you.",
                 0.05, 0.6, 0.01, "s", who="all")
            _add(kind, "dash", "DODGE_DASH_SPEED", "Dash speed",
                 "How fast the dash moves you. Distance = speed × duration (about 3 m by default).", 0, 30, 0.5, "m/s",
                 who="all")
        elif kind == "catch":
            _add(kind, "reach", "CATCH_REACH", "Catch & deflect reach",
                 "Catches and deflects reach this far beyond your body, so they're a little easier than not getting "
                 "hit.", 0, 1.5, 0.05, "m", who="all")
        else:
            _add(kind, "rally", "DEFLECT_SPEEDUP", "Rally speed-up",
                 "Each deflect sends the ball back this many times faster (1.15 = 15% faster).", 1.0, 1.6, 0.01, "×",
                 who="all")
            _add(kind, "rally", "BALL_SPEED_CAP", "Rally speed cap",
                 "Deflected balls never fly faster than this.", 5, 100, 1, "m/s", who="all")

    g = "stamina"
    _add(g, "stamina", "MAX_STAMINA", "Stamina",
         "Everyone's stamina pool. Throws, dodges, catches and deflects all spend it.", 10, 300, 5, "", "int",
         who="all")
    _add(g, "stamina", "STAMINA_REGEN", "Regeneration", "Stamina regained per second while resting.",
         0, 200, 1, "per s", who="all")
    _add(g, "stamina", "STAMINA_REGEN_DELAY", "Regeneration delay",
         "Regeneration pauses this long after any spend (Souls-style). It also pauses while charging a throw or "
         "while a defence is active.", 0, 5, 0.05, "s", who="all")

    g = "move"
    _add(g, "move", "WALK_SPEED", "Run speed", "Normal movement speed.", 1, 15, 0.25, "m/s", who="all")
    _add(g, "move", "CHARGE_WALK_SPEED", "Speed while charging", "Movement speed while winding up a throw.",
         0, 15, 0.25, "m/s", who="all")
    _add(g, "move", "DEFEND_WALK_SPEED", "Speed while catching or deflecting",
         "Movement speed while a catch or deflect is active.", 0, 15, 0.25, "m/s", who="all")

    g = "body"
    _add(g, "reach", "PLAYER_RADIUS", "Body hit radius",
         "How wide each player's hit zone is (a capsule from the shins to the head). Bigger: easier to hit and "
         "easier to catch with.", 0.15, 1.0, 0.01, "m")
    _add(g, "reach", "BALL_RADIUS", "Ball radius", "How big the ball is, for hits and on screen.",
         0.08, 0.5, 0.01, "m")
    _add(g, "reach", "CHEST_HEIGHT", "Aim height", "The height on a player that aim assist and bots aim at.",
         0.5, 1.8, 0.05, "m")

    g = "colors"
    for team, name in ((0, "RED"), (1, "BLUE")):
        _add(g, "colors", f"BALL_COLOR_{name}", "People's balls",
             f"The colour of the balls {name}'s people throw and hold.", 0, 1, 1, kind="color", sub=name,
             who="people", team=team)
        _add(g, "colors", f"BALL_COLOR_{name}_BOTS", "Bots' balls",
             f"The colour of {name}'s bots' balls: by default a paler shade of the people's, so you can tell who "
             "threw it.", 0, 1, 1, kind="color", sub=name, who="bots", team=team)

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
            ("CASH_KO", "Knockout bonus", "Extra cash when your hit knocks them out (with team health: the hit that "
             "empties their bar)."),
            ("CASH_CATCH", "Catch", "Cash for a catch."),
            ("CASH_PERFECT_CATCH", "Perfect catch", "Cash for a perfectly timed catch (instead of the normal amount)."),
            ("CASH_DEFLECT", "Deflect", "Cash for a deflect."),
            ("CASH_PERFECT_DEFLECT", "Perfect deflect", "Cash for a perfectly timed deflect."),
            ("CASH_PERFECT_DODGE", "Perfect dodge", "Cash for a perfectly timed dodge (normal dodges pay nothing)."),
            ("CASH_RALLY_BONUS", "Rally bonus", "Extra cash per deflection already on a ball you catch or deflect.")):
        _add(g, "cash", key, label, desc, 0, 200, 1, "cash", "int", who="all")
    _add(g, "cash", "REVIVE_COST", "First revive price",
         "Cash to revive a fallen teammate (R). This is the price of a team's first revive in a round...",
         0, 2000, 5, "cash", "int")
    _add(g, "cash", "REVIVE_COST_STEP", "Revive price increase",
         "...and every further revive that round costs this much more. Prices start over every round. 0 = a flat "
         "price, which can make rounds drag on forever.", 0, 1000, 5, "cash", "int")
    _add(g, "cash", "REVIVE_HP", "Revived health", "Health a revived player comes back with.", 1, 500, 1, "HP", "int",
         who="all")
    _add(g, "duration", "REVIVE_INVULN", "Revive protection", "A revived player can't be hit for this long.",
         0, 10, 0.1, "s", who="all")
    _add(g, "cash", "CASH_RESETS_EACH_ROUND", "Cash resets each round",
         "On: everyone starts each round with no cash. Off: cash carries over from round to round, while revive "
         "prices still start over every round. Either way a new match starts everyone at 0.", 0, 1, 1, kind="bool")
    _add(g, "cash", "TEAM_CASH", "Shared team cash",
         "On: all cash anyone earns goes into one pot per team, and any teammate can spend it on revives (or, with "
         "team health, on health). Off: everyone keeps and spends their own.", 0, 1, 1, kind="bool")

    g = "rounds"
    _add(g, "rounds", "MATCH_ROUNDS_TO_WIN", "Rounds to win the match",
         "The first team to win this many rounds wins the match, and everyone returns to the lobby. "
         "0 = endless rounds until the host ends the match.", 0, 15, 1, "", "int")
    _add(g, "rounds", "ROUND_TIME_LIMIT", "Round time limit",
         "When time runs out, the team with more players standing wins the round (then the one with more "
         "total health; with team health, the one with more of its bar left).", 20, 900, 10, "s")
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
         kind="choice", choices=SKILLS, who="bots")
    _add(g, "bots", "BOT_STAMINA_RESERVE", "Stamina bots keep for defence",
         "Bots only throw while they'd still have this much stamina left to defend with.", 0, 100, 1, "stamina",
         who="bots")
    _add(g, "bots", "BOT_STAND_TO_REGEN", "Bots stand still to regenerate",
         "On: while standing still would bring its health (with team health, its team's bar) back faster or at all, "
         "a bot below the regeneration limit stops wandering. It still throws, catches, deflects and dodges, and is "
         "easier to hit meanwhile. Off: bots keep moving.", 0, 1, 1, kind="bool", who="bots")
    for skill in SKILLS:
        for field, label, desc, lo, hi, step, unit in BOT_FIELDS:
            _add(g, "bots", f"BOT_{skill.upper()}_{field.upper()}", label, desc, lo, hi, step, unit,
                 sub=f"{skill.title()} bots", who="bots")

    g = "network"
    _add(g, "network", "INTERP_DELAY", "View delay",
         "Everyone's screen shows the world this far in the past, as a cushion for Wi-Fi that delivers updates "
         "late. When an update comes later than the cushion, the other players and the balls freeze for a moment, "
         "then jump. Bigger: fewer of those stutters, but everything you see is a little older (presses are still "
         "judged fairly). Smaller: fresher but jumpier. Keep it above about two update intervals.",
         0.03, 0.3, 0.005, "s", who="people")
    _add(g, "network", "MAX_LAG_COMP", "Lag compensation limit",
         "Dodge, catch and deflect presses are judged against what the player's screen showed, up to this far "
         "back. Keep it at least 0.1 s above the View delay: every screen already runs that far behind, plus the "
         "Wi-Fi's own delay (often 0.05–0.15 s more on uneven Wi-Fi), and a press that takes longer than this to "
         "arrive counts a little later than it was made. Higher: fairer for laggy players, but others see balls "
         "hang on them a little longer.",
         0, 0.5, 0.01, "s", who="people")
    _add(g, "defence", "PRESS_GRACE", "Press grace",
         "Dodge, catch and deflect presses count as if made this much earlier. Your screen is drawn a moment before "
         "your finger hits the key (a frame, plus the monitor's own delay), so a press that looked perfect can land "
         "a hair late: \"I pressed exactly as it touched me and still got hit\". 0.02 s is one or two frames. "
         "0 = judged exactly; higher = more forgiving for everyone (not bots).", 0, 0.1, 0.005, "s", who="people")
    _add(g, "sidestep", "SIDESTEP_COMP", "Sidestep compensation",
         "Stepping out of a ball's way is judged by what your own screen showed, like presses are. Your screen "
         "runs about 0.1 s behind the server, which at full speed is 2–3 m of ball. On: if you had already moved "
         "clear on your screen when the ball got there, it misses you (the thrower may see it pass through you). "
         "Off: the server's latest idea of where you are decides, so a ball can hit you after you dodged it on "
         "screen.", 0, 1, 1, kind="bool", who="people")
    _add(g, "defence", "LOCKOUT_SCALE", "Lockout after a missed press",
         "After a dodge, catch or deflect that meets no ball, you can't press another one until its window and its "
         "recovery are over (about half a second). This scales that lockout: 1 = normal; 0.5 = half; 0 = none: "
         "you can press again at once, and the new press takes over from the one still active (each press still "
         "costs stamina). A successful catch or deflect frees you at once anyway.", 0, 1.5, 0.05, "×", who="all")
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
                 ("DAMAGE_MIN", "DAMAGE_MAX")] + [(f"BOT_{s.upper()}_{lo}", f"BOT_{s.upper()}_{hi}")
                                                  for s in SKILLS for lo, hi in (("GAP_MIN", "GAP_MAX"),
                                                                                 ("POWER_MIN", "POWER_MAX"))]


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


TEAM_TITLES = ("RED", "BLUE")
BUILTIN_IDS = frozenset(n.lower() for n in BOT_NAMES)
BOT_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,39}")
# The rules a bot flag may set: those a bot may have its own value for, except a team's colours, and
# of the bot-skill numbers only the normal profile's (they stand for whatever skill the bot plays at).
FLAG_RULES = frozenset(p.key for p in PARAMS if p.who in ("all", "bots") and p.team < 0 and not (
    p.key.startswith(("BOT_EASY_", "BOT_HARD_"))))


def _copy_flag(flag):
    return {"name": flag["name"], "desc": flag.get("desc", ""), "values": dict(flag.get("values", {}))}


def _new_id(name, taken):
    """An id for a new bot or flag, from its name: "alex", then "alex-2"..."""
    base = re.sub(r"[^a-z0-9]+", "-", clean_name(name).lower()).strip("-")[:30] or "bot"
    out, n = base, 1
    while out in taken:
        n += 1
        out = f"{base}-{n}"
    return out


def _flag_values(raw):
    """A flag's values from untrusted input (FLAG_RULES only, each cleaned like any rule)."""
    out = {}
    if isinstance(raw, dict):
        for rule, value in list(raw.items())[:len(PARAMS)]:
            if rule in FLAG_RULES:
                v = BY_KEY[rule].clean(value)
                if v is not None:
                    out[rule] = v
    return out


class Rules:
    """One complete set of rule values, read as attributes: rules.WALK_SPEED. It also holds:
    - players: each player's own settings (key -> {rule: value}), for the rules that may differ per
      player, and labels (key -> the name last seen with it), for showing whose they are;
    - the bots: roster (the host's own bots, and flags given to built-in ones), flags (named bundles
      of own settings a bot can carry) and lineup (each team's bots in order; BOTS_RED / BOTS_BLUE
      are its lengths)."""

    def __init__(self, values=None, players=None, labels=None, bots=None):
        self.__dict__.update(DEFAULTS)
        self.players = {}
        self.labels = {}
        self.roster = {}
        self.flags = {fid: _copy_flag(f) for fid, f in C.BOT_FLAGS.items()}
        self.lineup = [[], []]
        self._own = {}          # key -> the Rules that player plays by, built when first asked for
        self._derive()
        self._fit_lineup()
        if values:
            self.update(values)
        if players:
            self.set_players(players, labels)
        if bots:
            self.set_bots(bots)

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
        self._fit_lineup()
        self._own.clear()
        return [k for k, v in self.values().items() if v != before[k]]

    # ---- players' own settings

    def update_player(self, who, values):
        """Apply untrusted edits to one player's own settings (who: their key, or the old way a
        name): {rule: value}, or {rule: None} for everyone's value again. Only rules that may differ
        per player count, and a value equal to everyone's is no own setting. Returns what changed,
        as (key, rule) pairs."""
        key = clean_key(who)
        if not key or not isinstance(values, dict):
            return []
        before = self.players.get(key, {})
        own = dict(before)
        for rule, raw in list(values.items())[:len(PARAMS)]:
            param = BY_KEY.get(rule) if isinstance(rule, str) else None
            if param is None or not param.who:
                continue
            value = None if raw is None else param.clean(raw)
            if raw is None or value == getattr(self, rule):
                own.pop(rule, None)
            elif value is not None:
                own[rule] = value
        if own == before or (own and key not in self.players and len(self.players) >= MAX_CUSTOM_PLAYERS):
            return []
        if own:
            self.players[key] = own
        else:
            self.players.pop(key, None)
            self.labels.pop(key, None)
        self._own.pop(key, None)
        return [(key, k) for k in sorted(set(own) | set(before)) if own.get(k) != before.get(k)]

    def set_player(self, who, values):
        """Replace one player's own settings, e.g. with a profile from a file."""
        key = clean_key(who)
        edits = dict.fromkeys(self.players.get(key, {}))
        if isinstance(values, dict):
            edits.update(values)
        return self.update_player(key, edits)

    def set_players(self, players, labels=None):
        """Replace every player's own settings (untrusted: {key or name: {rule: value}}), and the
        names they were last seen with."""
        before = self.copy()
        self.players, self.labels, self._own = {}, {}, {}
        labels = labels if isinstance(labels, dict) else {}
        if isinstance(players, dict):
            for who, values in list(players.items())[:MAX_CUSTOM_PLAYERS]:
                if self.update_player(who, values) and isinstance(labels.get(who), str) and clean_name(labels[who]):
                    self.labels[clean_key(who)] = clean_name(labels[who])
        return self.player_differences(before)

    def claim(self, key, name):
        """A person joined (or renamed themselves) as `name`: own settings waiting under that name
        (from an older file) become theirs, if they have none of their own. Returns True if so."""
        waiting = f"n:{clean_name(name)}"
        if key in self.players or waiting not in self.players or key == waiting:
            return False
        self.players[key] = self.players.pop(waiting)
        self.labels[key] = clean_name(name)
        self._own.pop(waiting, None)
        return True

    def label(self, key, name):
        """Remember the name a player with own settings goes by. Returns True if it changed."""
        name = clean_name(name)
        if key not in self.players or not name or self.labels.get(key) == name:
            return False
        self.labels[key] = name
        return True

    def for_player(self, who):
        """The rules a player (key, or the old way a name) plays by: everyone's values with their own
        settings on top (a bot's flags first), ordered pairs and caps kept, their own value winning.
        Without own settings, this very set."""
        key = who if who in self.players or who in self._own else clean_key(who)
        own = self.own_of(key)
        if not own:
            return self
        mine = self._own.get(key)
        if mine is None:
            mine = Rules(self.values())
            mine.__dict__.update(own)
            mine._fix(set(own))
            mine._derive()
            self._own[key] = mine
        return mine

    def own_of(self, key):
        """What a player plays by on top of everyone's values: a bot's flags (in order, later ones
        winning; their bot-skill numbers land on the profile the bot plays at), then their own
        settings. rules_ui.js ownOf() does the same."""
        own = self.players.get(key, {})
        entry = self.roster.get(key[2:]) if key.startswith("b:") else None
        if not entry or not entry.get("flags"):
            return own
        merged = {}
        for fid in entry["flags"]:
            merged.update(self.flags.get(fid, {}).get("values", {}))
        skill = own.get("BOT_SKILL", merged.get("BOT_SKILL", self.BOT_SKILL)).upper()
        out = {}
        for rule, value in merged.items():
            if rule.startswith("BOT_NORMAL_"):
                rule = f"BOT_{skill}_" + rule[len("BOT_NORMAL_"):]
            if value != getattr(self, rule):
                out[rule] = value
        out.update(own)
        return out

    # ---- bots: the roster, flags and each team's lineup

    @staticmethod
    def builtin_bots(team):
        """The built-in bots that fill a team's slots, in order: RED's Ace, Comet, Echo...; BLUE's
        Blitz, Dash, Flick... (every other name). Their ids are their names in lower case."""
        return [n.lower() for n in BOT_NAMES[team::2]]

    def bot_name(self, bid):
        """A bot's name in the game: a built-in one is "Bot Ace"; the host's own, the name they gave."""
        entry = self.roster.get(bid) or {}
        if entry.get("name"):
            return entry["name"]
        builtin = next((n for n in BOT_NAMES if n.lower() == bid), None)
        return f"Bot {builtin}" if builtin else bid

    def bot_exists(self, bid):
        return bid in BUILTIN_IDS or bool((self.roster.get(bid) or {}).get("name"))

    def _fit_lineup(self):
        """Each team's lineup holds exactly BOTS_RED / BOTS_BLUE bots: fewer drops the last ones,
        more brings in the next built-in bots nobody uses (the team's own first, then the other's)."""
        lineup = [[b for b in team if self.bot_exists(b)] for team in self.lineup]
        for t in (0, 1):
            seen = set(lineup[1 - t]) if t == 1 else set()
            lineup[t] = [b for i, b in enumerate(lineup[t]) if b not in seen and b not in lineup[t][:i]]
        for t in (0, 1):
            want = self.bots_for(t)
            del lineup[t][want:]
        for t in (0, 1):
            want = self.bots_for(t)
            used = set(lineup[0]) | set(lineup[1])
            spare = [b for b in self.builtin_bots(t) + self.builtin_bots(1 - t) if b not in used]
            lineup[t] += spare[:want - len(lineup[t])]
        self.lineup = lineup

    def _set_counts(self):
        self.BOTS_RED, self.BOTS_BLUE = len(self.lineup[0]), len(self.lineup[1])

    def bot_change(self, op):
        """The host's edits to the bots (untrusted {"do": ..., ...}). Returns what changed (labels
        for the messages), or []:
        - add {team, bot?}: a bot joins a team (`bot`: which; without it, the next free built-in one);
        - remove {bot}: it leaves its team;   - move {bot}: to the other team;
        - make {name, team?}: a new bot of the host's own (joining `team` if given);
        - edit {bot, name?, flags?}: rename the host's own bot, or set any bot's flags (a list);
        - delete {bot}: one of the host's own bots, gone (its own settings too);
        - flag {flag?, name, desc, values}: a new flag, or changes to one;  - unflag {flag}: delete it."""
        if not isinstance(op, dict):
            return []
        do, bid = op.get("do"), op.get("bot")
        bid = bid if isinstance(bid, str) and self.bot_exists(bid) else None
        team = op.get("team") if op.get("team") in (0, 1) and not isinstance(op.get("team"), bool) else None
        where = next((t for t in (0, 1) if bid in self.lineup[t]), None)
        changed = []
        if do == "add" and team is not None and len(self.lineup[team]) < C.BOTS_PER_TEAM_MAX:
            if bid is None:
                used = set(self.lineup[0]) | set(self.lineup[1])
                bid = next((b for b in self.builtin_bots(team) + self.builtin_bots(1 - team) if b not in used), None)
            if bid is not None and where != team:
                if where is not None:
                    self.lineup[where].remove(bid)
                self.lineup[team].append(bid)
                changed = [f"{TEAM_TITLES[team]} bots"]
        elif do == "remove" and where is not None:
            self.lineup[where].remove(bid)
            changed = [f"{TEAM_TITLES[where]} bots"]
        elif do == "move" and where is not None and len(self.lineup[1 - where]) < C.BOTS_PER_TEAM_MAX:
            self.lineup[where].remove(bid)
            self.lineup[1 - where].append(bid)
            changed = ["RED bots", "BLUE bots"]
        elif do == "make":
            name = clean_name(op.get("name"))
            if name and sum(b not in BUILTIN_IDS for b in self.roster) < C.BOT_ROSTER_MAX:
                new = _new_id(name, set(self.roster) | BUILTIN_IDS)
                self.roster[new] = {"name": name, "flags": []}
                changed = [f"a new bot, {name}"]
                if team is not None and len(self.lineup[team]) < C.BOTS_PER_TEAM_MAX:
                    self.lineup[team].append(new)
        elif do == "edit" and bid is not None:
            entry = dict(self.roster.get(bid) or {"flags": []})
            name = clean_name(op.get("name")) if isinstance(op.get("name"), str) else None
            if name and bid not in BUILTIN_IDS and name != entry.get("name"):
                entry["name"] = name
                changed.append(f"{name}'s name")
            if isinstance(op.get("flags"), list):
                flags = list(dict.fromkeys(f for f in op["flags"] if isinstance(f, str) and f in self.flags))[:8]
                if flags != entry.get("flags", []):
                    entry["flags"] = flags
                    changed.append(f"{self.bot_name(bid)}'s flags")
            if changed:
                if bid in BUILTIN_IDS and not entry.get("flags"):
                    self.roster.pop(bid, None)          # a built-in bot back to plain: nothing to keep
                else:
                    self.roster[bid] = entry
        elif do == "delete" and bid is not None and bid not in BUILTIN_IDS:
            changed = [f"{self.bot_name(bid)} deleted"]
            del self.roster[bid]
            self.players.pop(f"b:{bid}", None)
            for t in (0, 1):
                if bid in self.lineup[t]:
                    self.lineup[t].remove(bid)
        elif do == "flag":
            fid = op.get("flag") if isinstance(op.get("flag"), str) and op.get("flag") in self.flags else None
            name = clean_name(op.get("name")) or (self.flags[fid]["name"] if fid else "")
            if name and (fid or len(self.flags) < C.BOT_FLAG_MAX):
                flag = {"name": name, "desc": str(op.get("desc") or "")[:200].strip(),
                        "values": _flag_values(op.get("values"))}
                fid = fid or _new_id(name, set(self.flags))
                if flag != self.flags.get(fid):
                    changed = [f"the flag {name}"]
                    self.flags[fid] = flag
        elif do == "unflag" and op.get("flag") in self.flags:
            changed = [f"the flag {self.flags[op['flag']]['name']} deleted"]
            del self.flags[op["flag"]]
            for entry in self.roster.values():
                if op["flag"] in entry.get("flags", []):
                    entry["flags"] = [f for f in entry["flags"] if f != op["flag"]]
            self.roster = {b: e for b, e in self.roster.items() if b not in BUILTIN_IDS or e.get("flags")}
        if changed:
            self._set_counts()
            self._own.clear()
        return changed

    def bots_data(self):
        """The bots as files and the browsers see them."""
        return {"roster": {b: {"name": e.get("name"), "flags": list(e.get("flags", []))} for b, e in self.roster.items()},
                "flags": {f: _copy_flag(v) for f, v in self.flags.items()},
                "lineup": [list(t) for t in self.lineup]}

    def set_bots(self, data):
        """Replace the roster, the flags and the lineups (untrusted, from a file or saved_rules.json;
        anything missing keeps the defaults: the built-in flags, no own bots, the counts' lineups)."""
        if not isinstance(data, dict):
            return
        if isinstance(data.get("flags"), dict):
            self.flags = {}
            for fid, f in list(data["flags"].items())[:C.BOT_FLAG_MAX]:
                if isinstance(fid, str) and BOT_ID.fullmatch(fid) and isinstance(f, dict) and clean_name(f.get("name")):
                    self.flags[fid] = {"name": clean_name(f["name"]), "desc": str(f.get("desc") or "")[:200].strip(),
                                       "values": _flag_values(f.get("values"))}
        self.roster = {}
        if isinstance(data.get("roster"), dict):
            for bid, e in list(data["roster"].items())[:C.BOT_ROSTER_MAX + len(BUILTIN_IDS)]:
                if not isinstance(bid, str) or not BOT_ID.fullmatch(bid) or not isinstance(e, dict):
                    continue
                flags = ([f for f in e.get("flags", []) if isinstance(f, str) and f in self.flags][:8]
                         if isinstance(e.get("flags"), list) else [])
                name = clean_name(e.get("name"))
                if bid in BUILTIN_IDS and flags:
                    self.roster[bid] = {"flags": flags}
                elif bid not in BUILTIN_IDS and name:
                    self.roster[bid] = {"name": name, "flags": flags}
        if isinstance(data.get("lineup"), list) and len(data["lineup"]) == 2:
            self.lineup = [[b for b in team if isinstance(b, str) and self.bot_exists(b)][:C.BOTS_PER_TEAM_MAX]
                           if isinstance(team, list) else [] for team in data["lineup"]]
            self._set_counts()
        self._fit_lineup()
        self._own.clear()

    def replace(self, values, players, labels=None, bots=None):
        """Become the set a file describes: its rules (any it leaves out go back to their default),
        its players' own settings and its bots. Returns what changed: rule keys, then (key, rule)
        pairs, then "bots" if the bots changed."""
        before = self.copy()
        self.__dict__.update(DEFAULTS)
        self.roster, self.flags = {}, {fid: _copy_flag(f) for fid, f in C.BOT_FLAGS.items()}
        self.lineup = [[], []]
        self.update(values if isinstance(values, dict) else {})
        self.set_players(players, labels)
        self.set_bots(bots)
        return (self.differences(before) + self.player_differences(before)
                + (["bots"] if self.bots_differ(before) else []))

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
        twin = Rules(self.values())
        twin.players = {key: dict(own) for key, own in self.players.items()}
        twin.labels = dict(self.labels)
        twin.roster = {b: {**e, "flags": list(e.get("flags", []))} for b, e in self.roster.items()}
        twin.flags = {f: _copy_flag(v) for f, v in self.flags.items()}
        twin.lineup = [list(t) for t in self.lineup]
        return twin

    def differences(self, other=None):
        """Keys whose value differs from `other` (default: the default rules)."""
        base = other.values() if other is not None else DEFAULTS
        return [k for k, v in self.values().items() if v != base[k]]

    def player_differences(self, other=None):
        """(key, rule) of each player's own setting that differs from `other`'s (default: none)."""
        theirs = other.players if other is not None else {}
        out = []
        for key in sorted(set(self.players) | set(theirs)):
            mine, them = self.players.get(key, {}), theirs.get(key, {})
            out += [(key, k) for k in sorted(set(mine) | set(them)) if mine.get(k) != them.get(k)]
        return out

    def bots_differ(self, other):
        """The roster, the flags or a team's bots differ from `other`'s."""
        return self.bots_data() != other.bots_data()

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
        """The numbers each browser needs for its HUD, its own movement and its previews (for_player's
        set: a player with their own settings moves, throws and defends by those). The ball colours
        come with the rules themselves, since each ball takes its thrower's."""
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
            "teamHealth": self.TEAM_HEALTH,
            "teamHeal": {"mode": self.TEAM_HEAL_MODE, "amount": self.TEAM_HEAL_AMOUNT, "perCash": self.TEAM_HEAL_PER_CASH},
            # where regeneration stops, and when standing still matters (hud.js: the bars' markers, the hint)
            "regen": {"on": self.HEALTH_REGEN, "mode": self.HEALTH_REGEN_CAP_MODE, "share": self.HEALTH_REGEN_CAP_SHARE,
                      "amount": self.HEALTH_REGEN_CAP_AMOUNT, "delay": self.HEALTH_REGEN_DELAY,
                      "still": self.HEALTH_REGEN_STILL, "stillTime": self.HEALTH_REGEN_STILL_TIME},
            "teamRegen": {"on": self.TEAM_REGEN, "mode": self.TEAM_REGEN_CAP_MODE, "share": self.TEAM_REGEN_CAP_SHARE,
                          "amount": self.TEAM_REGEN_CAP_AMOUNT, "delay": self.TEAM_REGEN_DELAY,
                          "still": self.TEAM_REGEN_STILL, "stillTime": self.TEAM_REGEN_STILL_TIME},
        }

    def bots_for(self, team):
        return self.BOTS_BLUE if team == 1 else self.BOTS_RED

    def regen_limit(self, full, team=False):
        """Where health regeneration stops for a pool of `full` health (a player's, or with `team` a
        team's bar): a share of it, or a fixed amount, never above it. hud.js regenLimit is its twin."""
        if team:
            mode, share, amount = self.TEAM_REGEN_CAP_MODE, self.TEAM_REGEN_CAP_SHARE, self.TEAM_REGEN_CAP_AMOUNT
        else:
            mode, share, amount = self.HEALTH_REGEN_CAP_MODE, self.HEALTH_REGEN_CAP_SHARE, self.HEALTH_REGEN_CAP_AMOUNT
        return full * share / 100 if mode == "share" else min(float(amount), full)

    def regen_speed(self, standing, team=False):
        """Health regained per second: a player's (`standing` 1 once they've stood still long enough,
        else 0) or a team's bar (`standing`: how many of its players have). Faster for standing still,
        or (when standing still is needed) nothing without it. previews.js regenRun is its twin."""
        if team:
            base, still, boost = self.TEAM_REGEN_RATE, self.TEAM_REGEN_STILL, self.TEAM_REGEN_STILL_BOOST
            extra, percent = self.TEAM_REGEN_STILL_EXTRA, self.TEAM_REGEN_STILL_PERCENT
        else:
            base, still, boost = self.HEALTH_REGEN_RATE, self.HEALTH_REGEN_STILL, self.HEALTH_REGEN_STILL_BOOST
            extra, percent = self.HEALTH_REGEN_STILL_EXTRA, self.HEALTH_REGEN_STILL_PERCENT
        if still == "off":
            return base
        if not standing:
            return 0.0 if still == "only" else base
        return base + extra * standing if boost == "extra" else base * (1 + percent / 100 * standing)

    def curve_share(self, speed):
        """How hard a ball at `speed` bends, as a share of a full-power ball's turn rate (per second).
        Per metre travelled, a full-power ball bends the most and a tap-speed one SLOW_BALL_CURVE as
        much, scaling in between; faster balls (rallies) bend like full-power ones per metre."""
        lo, hi = self.THROW_SPEED_MIN, self.THROW_SPEED_MAX
        f = _clamp((speed - lo) / (hi - lo), 0.0, 1.0) if hi > lo else 1.0
        return (self.SLOW_BALL_CURVE + (1.0 - self.SLOW_BALL_CURVE) * f) * speed / max(hi, 1e-6)
