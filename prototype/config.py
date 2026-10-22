"""Every gameplay number lives here so balance can be tuned without touching code.

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
# toward the enemy closest to its new heading. The next contact ends it, and the end walls
# behind each team always stop it.
MAX_RICOCHETS = 1           # per throw; a deflect gives the ball a fresh one
RICOCHET_NORMAL_KEEP = 0.75     # share of speed kept straight off the surface...
RICOCHET_TANGENT_KEEP = 0.85    # ...and along it
RICOCHET_MIN_SPEED = 9.0        # slower than this after the bounce: it just drops
RICOCHET_CONE_DEG = 35
RICOCHET_TURN_RATE_DEG = 150

# --- Light aim assist ----------------------------------------------------------
# The ball flies where you aim. If an enemy is within the cone, it bends gently toward them.
ASSIST_CONE_DEG = 10
DEFLECT_ASSIST_CONE_DEG = 20   # deflects are reactions, so they get a wider cone
ASSIST_SLACK_DEG = 4           # extra tolerance for the target the client highlighted
ASSIST_TURN_RATE_DEG = 45      # degrees/second of bending: juking still beats slow balls
ASSIST_RANGE = 40


# --- Defensive actions ---------------------------------------------------------
@dataclass(frozen=True)
class ActionSpec:
    cost: float          # stamina paid on press
    perfect_cost: float  # what it ends up costing when perfectly timed (the rest is refunded)
    window: float        # how long the action stays active after the press
    perfect: float       # "last moment": the ball arrives within this long after the press
    recovery: float      # lockout after the window, so mashing is punished


DODGE = ActionSpec(cost=25, perfect_cost=10, window=0.32, perfect=0.12, recovery=0.15)
CATCH = ActionSpec(cost=20, perfect_cost=8, window=0.30, perfect=0.10, recovery=0.25)
DEFLECT = ActionSpec(cost=30, perfect_cost=12, window=0.18, perfect=0.06, recovery=0.30)

DODGE_DASH_TIME = 0.22
DODGE_DASH_SPEED = 14.0
CATCH_REACH = 0.35          # catch/deflect reach this far beyond your body

DEFLECT_SPEEDUP = 1.15      # every deflect makes the ball this much faster...
BALL_SPEED_CAP = 50.0       # ...up to this

# --- Network fairness ----------------------------------------------------------
# Browsers draw the world INTERP_DELAY in the past for smoothness and tell the server which
# moment they were looking at when a button was pressed. The server judges timing against
# that moment (up to MAX_LAG_COMP back), so parries feel the same on Wi-Fi as on the host.
INTERP_DELAY = 0.08
MAX_LAG_COMP = 0.25

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
CASH_RESETS_EACH_ROUND = True

# --- Rounds ------------------------------------------------------------------
COUNTDOWN_TIME = 3.0
ROUND_TIME_LIMIT = 180.0    # then the team with more players standing wins
ROUND_OVER_TIME = 4.0

# --- Bots --------------------------------------------------------------------
BOT_FILL = 2                # teams are topped up with bots to this many players (0 = no bots)
BOT_FILL_MAX = 6
BOT_SKILL = "normal"        # easy | normal | hard
