"""Every gameplay number's default lives here so balance can be tuned without touching code.

The host can change most of them live from the lobby (rules.py lists which, with their names,
descriptions and allowed ranges); these are the values a fresh lobby starts from.
Units: seconds, metres, metres/second. Stamina and HP are plain points.
"""
from dataclasses import dataclass

TICK_RATE = 60          # server simulation steps per second
SNAPSHOT_RATE = 30      # world updates sent to browsers per second

# --- Court -------------------------------------------------------------------
# x runs between the teams (RED lives at negative x, BLUE at positive x), z is sideways.
# The court is sized for the biggest team: every extra player adds width and a little length.
# It grows the moment someone joins and only shrinks between rounds.
COURT_HALF_LENGTH_BASE = 12.0
COURT_HALF_LENGTH_PER_PLAYER = 0.5
COURT_HALF_WIDTH_BASE = 3.5
COURT_HALF_WIDTH_PER_PLAYER = 1.75   # 2 per team -> 14 m wide, 4 -> 21 m, 6 -> 28 m
CENTER_GAP = 1.0        # nobody may stand closer than this to the centre line
SPAWN_FRACTION = 0.7    # teams line up this far back in their half

PLAYER_RADIUS = 0.42    # hit capsule radius (generous on purpose)
BALL_RADIUS = 0.2
CHEST_HEIGHT = 1.15     # where aim assist and bots aim

# --- Movement ----------------------------------------------------------------
WALK_SPEED = 6.0
CHARGE_WALK_SPEED = 4.0     # while winding up a throw
DEFEND_WALK_SPEED = 2.5     # while a catch / deflect is active

# --- Health & stamina --------------------------------------------------------
MAX_HP = 100
MAX_STAMINA = 100
STAMINA_REGEN = 30.0        # per second
STAMINA_REGEN_DELAY = 0.6   # regen pauses this long after any stamina spend

# --- Throwing ----------------------------------------------------------------
# Holding longer throws faster, and speed is what deals damage.
THROW_COOLDOWN = 1.6        # after throwing, a new ball appears in your hand after this long
CHARGE_TIME = 0.9           # hold time for a full-power throw
THROW_SPEED_MIN = 12.0      # quick tap
THROW_SPEED_MAX = 34.0      # full charge
THROW_COST_MIN = 6          # stamina for a quick tap...
THROW_COST_MAX = 34         # ...up to this for a full charge

DAMAGE_MIN = 15             # damage of a 12 m/s ball...
DAMAGE_PER_SPEED = 1.35     # ...plus this per extra m/s: a full-power throw does ~45
DAMAGE_MAX = 60

GRAVITY = 6.0               # m/s^2, lighter than real (9.8) so arcs stay readable. 0 = straight throws
BALL_LIFETIME = 6.0

# --- Ricochets -----------------------------------------------------------------
# A ball that hits the floor or a side wall bounces once (losing some speed), then curves
# toward the enemy closest to its new heading, but less than before the bounce: bank shots
# are about the angle, direct throws get the most curve. The next contact ends it, and the
# end walls behind each team always stop it.
MAX_RICOCHETS = 1           # per throw; a deflect gives the ball a fresh one
RICOCHET_NORMAL_KEEP = 0.75     # share of speed kept straight off the surface...
RICOCHET_TANGENT_KEEP = 0.85    # ...and along it
RICOCHET_MIN_SPEED = 9.0        # slower than this after the bounce: it just drops
RICOCHET_CONE_DEG = 35
RICOCHET_CURVE_KEEP = 0.5       # share of its curve a ball keeps after each bounce

# --- Light aim assist ----------------------------------------------------------
# The ball flies where you aim. If an enemy is within the cone, it bends gently toward them.
ASSIST_CONE_DEG = 10
DEFLECT_ASSIST_CONE_DEG = 20   # deflects are reactions, so they get a wider cone
ASSIST_SLACK_DEG = 4           # extra tolerance for the target the client highlighted
ASSIST_TURN_RATE_DEG = 45      # degrees/second of bending at full-charge speed
SLOW_BALL_CURVE = 0.5          # a tap-speed ball curves this much as a full-power one, per metre
ASSIST_RANGE = 40


# --- Defensive actions ---------------------------------------------------------
@dataclass(frozen=True)
class ActionSpec:
    cost: float          # stamina paid on press
    perfect_cost: float  # what it ends up costing when perfectly timed (the rest is refunded)
    window: float        # how long the action stays active after the press
    perfect: float       # "last moment": the ball arrives within this long after the press
    recovery: float      # lockout after the window, so mashing is punished


DODGE_COST, DODGE_PERFECT_COST = 25, 10
DODGE_WINDOW, DODGE_PERFECT, DODGE_RECOVERY = 0.32, 0.12, 0.15
CATCH_COST, CATCH_PERFECT_COST = 20, 8
CATCH_WINDOW, CATCH_PERFECT, CATCH_RECOVERY = 0.30, 0.10, 0.25
DEFLECT_COST, DEFLECT_PERFECT_COST = 30, 12
DEFLECT_WINDOW, DEFLECT_PERFECT, DEFLECT_RECOVERY = 0.18, 0.06, 0.30

DODGE = ActionSpec(DODGE_COST, DODGE_PERFECT_COST, DODGE_WINDOW, DODGE_PERFECT, DODGE_RECOVERY)
CATCH = ActionSpec(CATCH_COST, CATCH_PERFECT_COST, CATCH_WINDOW, CATCH_PERFECT, CATCH_RECOVERY)
DEFLECT = ActionSpec(DEFLECT_COST, DEFLECT_PERFECT_COST, DEFLECT_WINDOW, DEFLECT_PERFECT, DEFLECT_RECOVERY)

DODGE_DASH_TIME = 0.22
DODGE_DASH_SPEED = 14.0
CATCH_REACH = 0.35          # catch/deflect reach this far beyond your body

DEFLECT_SPEEDUP = 1.15      # every deflect makes the ball this much faster...
BALL_SPEED_CAP = 50.0       # ...up to this

# --- Network fairness ----------------------------------------------------------
# Browsers draw the world INTERP_DELAY in the past for smoothness and tell the server which
# moment they were looking at when a button was pressed. The server judges timing against
# that moment (up to MAX_LAG_COMP back), so parries feel the same on Wi-Fi as on the host.
INTERP_DELAY = 0.10         # 0.08 until the office logs: a bigger cushion, fewer one-frame stops
MAX_LAG_COMP = 0.25
PRESS_GRACE = 0.02          # presses count this much earlier: the screen is a frame or two behind the finger
SIDESTEP_COMP = True        # stepping out of a ball's way is judged by the player's own screen
LOCKOUT_SCALE = 1.0         # share of window + recovery before another defence can be pressed

# --- Cash & revives ------------------------------------------------------------
CASH_HIT = 10
CASH_KO = 20                # bonus on top of the hit
CASH_CATCH = 5
CASH_PERFECT_CATCH = 12
CASH_DEFLECT = 8
CASH_PERFECT_DEFLECT = 15
CASH_PERFECT_DODGE = 8
CASH_RALLY_BONUS = 3        # per deflection already on the ball you catch/deflect
REVIVE_COST = 80            # the first revive a team buys in a round...
REVIVE_COST_STEP = 40       # ...and each further one that round costs this much more
REVIVE_HP = 50
REVIVE_INVULN = 2.0
CASH_RESETS_EACH_ROUND = True    # off: cash carries over (revive prices still start over each round)
TEAM_CASH = False           # on: one pot per team that anyone on it earns into and revives from

# --- Rounds & match ------------------------------------------------------------
COUNTDOWN_TIME = 3.0
MATCH_START_EXTRA = 2.0     # the first countdown of a match is this much longer (time to click in)
ROUND_TIME_LIMIT = 180.0    # then the team with more players standing wins
ROUND_OVER_TIME = 4.0
MATCH_ROUNDS_TO_WIN = 0     # first team to win this many rounds wins the match; 0 = endless
WARMUP_RESPAWN = 2.0        # in the lobby (and while waiting for players), the downed stand up after this

# --- Bots --------------------------------------------------------------------
BOTS_RED = 1                # bots on each team: the host sets them, nothing balances them
BOTS_BLUE = 2
BOTS_PER_TEAM_MAX = 12
BOT_SKILL = "normal"        # easy | normal | hard
BOT_STAMINA_RESERVE = 30    # bots keep this much stamina for defending before they throw
# react: chance to attempt a defence at all; sd: timing spread (s); aim: aim error (deg);
# gap_min/gap_max: extra pause between throws (s); mix_*: preference for each defence;
# bank: chance a throw is a ricochet off the floor or a side wall
BOT_PROFILES = {
    "easy": dict(react=0.55, sd=0.09, aim=7.0, gap_min=1.6, gap_max=3.4,
                 mix_dodge=0.5, mix_catch=0.45, mix_deflect=0.05, bank=0.05),
    "normal": dict(react=0.8, sd=0.055, aim=3.5, gap_min=0.8, gap_max=2.2,
                   mix_dodge=0.4, mix_catch=0.4, mix_deflect=0.2, bank=0.15),
    "hard": dict(react=0.93, sd=0.03, aim=1.8, gap_min=0.3, gap_max=1.2,
                 mix_dodge=0.3, mix_catch=0.4, mix_deflect=0.3, bank=0.25),
}
