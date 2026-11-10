// The moves page's scenes (moves.html): each row of docs/ANIMATIONS.md that is a move, as a short
// script of what a player does: keys held, presses, a charge and its release, a ball arriving, a
// hit, a revive, a round's end. ScenePlayer turns a script into the player's state one step at a
// time, the way the game does for your own player (main.js moveLocal, tryAction, playerStates), so
// the game's own figure (world.js Stickman, athlete.js) moves exactly as it does in a match.
//
// Times are seconds from the scene's start. The timings (the dash, each defence's window and
// recovery, the charge, the speeds) are the rules', and the scenes are written from them, so they
// stretch with the rules the way the moves do.
import { hash, MADE, MOVE_TIMES, MIN_STRIDE, dodgeKind, WINS, ACROBATICS } from './athlete.js';

export const DT = 1 / 120;      // the page's step: every moment it shows is a whole number of these

// The rules' defaults (config.py), for a page opened before the game has shared its own.
export const DEFAULT_TIMING = {
  dash: { time: 0.22, speed: 14 }, chargeTime: 0.9,
  actions: { dodge: { window: 0.32, recovery: 0.15 }, catch: { window: 0.3, recovery: 0.25 }, deflect: { window: 0.18, recovery: 0.3 } },
  walk: 6, chargeWalk: 4, defendWalk: 2.5, cooldown: 1.6, throwSpeed: [12, 34],
};

const ACT = { dodge: 1, catch: 2, deflect: 3 };
const OWN_PRESS = 0.4;          // main.js playerStates: your own press shows this long
const BALL_COLORS = ['#ff8a2a', '#4f6dff'];      // each team's people's balls (config.py BALL_COLOR_RED, _BLUE)
const THROWER = [12, 4.5];      // an incoming ball is thrown from this far in front and to the right
                                // (the other half): off to one side, so it never flies through the front camera
const BALL_SPEED = 18;          // m/s, unless a scene says otherwise
const HAND = { fwd: 0.3, right: 0.32, up: 1.45 };  // where a thrown ball leaves the player: sim.py HAND_*
const CENTRE = 7;               // the middle of each half (the court the page builds: 13 x 7, a 1 m gap)
const FREEZE = { hit: 0.085, ko: 0.15 };           // main.js onEvent: the impact freeze
const GRAVITY = 9.8;            // a dead ball falling after a hit (only the picture)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const span = (T, kind) => T.actions[kind].window + T.actions[kind].recovery;
const win = (T, kind) => T.actions[kind].window;
const EPS = 1e-9;

// ------------------------------------------------------------------ what a script says

/** Keys held from t0 to t1: f forwards (W +1, S -1), r to the right (D +1, A -1). o.speed: a speed
 *  other than the rules'; o.world: along where the scene started facing, whatever the aim. */
const hold = (t0, t1, f, r, o = {}) => ({ k: 'keys', t0, t1, f, r, ...o });
/** The aim turning from `from` to `to` degrees (+ to the right of where the scene started facing). */
const aim = (t0, t1, from, to) => ({ k: 'aim', t0, t1, from, to });
/** A dodge, catch or deflect pressed. A dodge goes the way f and r say (both 0: no direction held,
 *  so the game dashes you to the right); without them, the way the keys held then say. */
const press = (t, kind, f = null, r = null) => ({ k: 'press', t, kind, f, r });
/** Holding throw from t0, let go at t1 (a press or a knockout before then cancels it). */
const charge = (t0, t1, style = 'over', release = true) => ({ k: 'charge', t0, t1, style, release });
/** A ball arriving at t: 'deflect' or 'catch' (meeting that defence), 'hit', 'ko', or 'pass' (it
 *  misses: a dodge; o.at: where the player was then). o.speed m/s; o.flinch: which flinch a hit plays. */
const ballIn = (t, outcome, o = {}) => ({ k: 'ball', t, outcome, ...o });
/** A perfect dodge confirmed at t: one of the acrobatics (null: whatever it is; going back, a backflip). */
const perfect = (t, kind = null) => ({ k: 'perfect', t, kind });
/** Knocked out with no ball (team health: the team's bar ran out). */
const down = (t) => ({ k: 'down', t });
/** Revived (placed: put back somewhere else too, as at a round's start). */
const revive = (t, placed = false) => ({ k: 'revive', t, placed });
/** The round's state from t: 'lobby', 'count', 'play' or 'over' (w: who won, -1 a draw; n: its number). */
const roundAt = (t, s, w = null, n = null) => ({ k: 'round', t, s, w, n });
/** A ball in hand from t (or gone). */
const ball = (t, has = true) => ({ k: 'hasBall', t, has });
/** Protected after a revive (the body flickers). */
const protect = (t0, t1) => ({ k: 'invuln', t0, t1 });

const ALWAYS = 99;              // "until the scene ends"

// A few kinds of scene, written once.
const run = (C, speed, f, r) => {      // running at a steady speed: whole cycles, so the loop is seamless
  const stride = C.stride(speed);
  const n = Math.max(2, Math.round(1.5 * speed / stride));
  return { length: n * stride / speed, pre: 1, items: [hold(-1, ALWAYS, f, r, { speed })] };
};
const windup = (T, style) => ({ length: 0.2 + T.chargeTime + 0.6, hasBall: true, items: [charge(0.2, ALWAYS, style, false)] });
const release = (T, style) => ({ length: 0.9, pre: T.chargeTime + 0.4, hasBall: true, items: [charge(-T.chargeTime - 0.2, 0, style)] });
const defence = (T, kind, at) => ({ length: 0.3 + span(T, kind) + 0.45, items: [press(0.3, kind), ballIn(0.3 + win(T, kind) * at, kind)] });
const dash = (T, f, r) => ({ length: 0.3 + span(T, 'dodge') + 0.5, items: [press(0.3, 'dodge', f, r)] });
const acro = (f, r, kind) => ({ length: 1.3, items: [press(0.3, 'dodge', f, r), perfect(0.4, kind), ballIn(0.4, 'pass', { at: 0.3 })] });
const ko = (speed) => ({ length: 3.4, items: [ballIn(0.4, 'ko', { speed })] });
const lyingFirst = { pre: 3.2, ko: ballIn(-3, 'ko', { speed: 12 }) };       // knocked out before the scene starts
/** A round number whose end makes this player celebrate with WINS[k] (athlete.js picks by it). */
const roundFor = (id, k) => {
  for (let n = 1; n < 200; n++) if (hash(id * 31 + n) % WINS.length === k) return n;
  return 1;
};

const S = (id, name, does, make) => ({ id, name, does, make });

/** The sections of docs/ANIMATIONS.md (the page's list without it: a copy of the game without the docs). */
export const SECTIONS = {
  A: 'Standing and moving', B: 'Carrying the ball', C: 'Throwing (the right arm)', D: 'The left arm: guard, parry, catch',
  E: 'Dodges (the dash)', F: 'Perfect dodges', G: 'Getting hit and knocked out', H: 'Getting up', I: "A round's end",
  J: 'One move into another', K: 'Other',
};

/** Every move that can be played, by its row in docs/ANIMATIONS.md. make(T, C, X): the scene at
 *  these timings (T), with what the clips measure (C), for this player (X: { team, id }). */
export const SCENES = [
  // A. Standing and moving
  S('A1', 'Idle', 'Standing still in the lobby.', (T, C) => ({ length: C.dur.idle, pre: 0, round: 'lobby' })),
  S('A2', 'Guard stance', 'Standing still during play.', (T, C) => ({ length: C.dur.guard, pre: 0 })),
  S('A3', 'Jog', 'Running forwards at 2.5 m/s, as fast as you go while catching or deflecting.', (T, C) => run(C, 2.5, 1, 0)),
  S('A4', 'Sprint', 'Running forwards at the run speed.', (T, C) => run(C, T.walk, 1, 0)),
  S('A5', 'Starting and stopping', 'Standing, then W held for 1.5 s, then standing.', () => ({ length: 2.8, items: [hold(0.3, 1.8, 1, 0)] })),
  S('A6', 'Strafing right', 'Only D held, at the run speed.', (T, C) => run(C, T.walk, 0, 1)),
  S('A7', 'Strafing left', 'Only A held, at the run speed.', (T, C) => run(C, T.walk, 0, -1)),
  S('A8', 'Forward diagonals', 'W+D, then W+A.', () => ({ length: 3, pre: 1, items: [hold(-1, 1.5, 1, 1), hold(1.5, ALWAYS, 1, -1)] })),
  S('A9', 'Backpedal', 'Only S held, at the run speed.', (T, C) => run(C, T.walk, -1, 0)),
  S('A10', 'Backward diagonals', 'S+D, then S+A.', () => ({ length: 3, pre: 1, items: [hold(-1, 1.5, -1, 1), hold(1.5, ALWAYS, -1, -1)] })),
  S('A11', 'Forward run ↔ backpedal', 'At 4 m/s: D, then S+D (135° from the aim), D again, then W+D.',
    () => ({ length: 3.6, pre: 1, items: [hold(-1, 0.9, 0, 1, { speed: 4 }), hold(0.9, 1.8, -1, 1, { speed: 4 }), hold(1.8, 2.7, 0, 1, { speed: 4 }), hold(2.7, ALWAYS, 1, 1, { speed: 4 })] })),
  S('A12', 'Changing direction while running', 'D, then A.', () => ({ length: 2.4, pre: 1, items: [hold(-1, 1.2, 0, 1), hold(1.2, ALWAYS, 0, -1)] })),
  S('A13', 'Turning on the spot', 'Standing; the aim turns 90° right, round to 90° left, and back.',
    () => ({ length: 4.7, items: [aim(0.3, 1.3, 0, 90), aim(1.6, 3.1, 90, -90), aim(3.4, 4.4, -90, 0)] })),
  S('A14', 'Running one way, aiming another', 'Running the same way across the court at 3 m/s while the aim turns 75° right, round to 75° left, and back.',
    () => ({ length: 4, pre: 0.6, items: [hold(-0.6, ALWAYS, 1, 0, { speed: 3, world: true }), aim(0, 1.2, 0, 75), aim(1.2, 2.8, 75, -75), aim(2.8, 4, -75, 0)] })),

  // B. Carrying the ball
  S('B1', 'Holding the ball', 'Standing with a ball, then running forwards with it.', () => ({ length: 3.2, hasBall: true, items: [hold(1, 2.6, 1, 0)] })),
  S('B2', 'A ball arrives', 'Standing without a ball; a new one arrives at 0.40 s.', () => ({ length: 1.2, items: [ball(0.4)] })),
  S('B3', 'The ball in whole-body moves', 'With a ball: a dash right, a dash left that is a perfect corkscrew, then a hit.',
    () => ({ length: 3.4, hasBall: true, items: [press(0.3, 'dodge', 0, 1), press(1.3, 'dodge', 0, -1), perfect(1.4, 'corkscrew'), ballIn(1.4, 'pass', { at: 1.3 }), ballIn(2.5, 'hit', { flinch: 'flinch_chest' })] })),

  // C. Throwing (the right arm)
  S('C1', 'Which throw', 'Three throws, one of each style: overhead, side-arm, underarm. (A new ball comes sooner than in a match.)', (T) => {
    const c = T.chargeTime;
    const a = 0.2;
    const b = a + c + 0.7;
    const d = b + c + 0.7;
    return { length: d + c + 0.7, hasBall: true, items: [charge(a, a + c, 'over'), ball(a + c + 0.55), charge(b, b + c, 'side'), ball(b + c + 0.55), charge(d, d + c, 'under')] };
  }),
  S('C2', 'Overhead wind-up', 'Holding throw from 0.20 s: the charge fills, then stays full.', (T) => windup(T, 'over')),
  S('C3', 'Overhead release', 'Fully charged, let go at 0.', (T) => release(T, 'over')),
  S('C4', 'Side-arm wind-up', 'Holding throw from 0.20 s: the charge fills, then stays full.', (T) => windup(T, 'side')),
  S('C5', 'Side-arm release', 'Fully charged, let go at 0.', (T) => release(T, 'side')),
  S('C6', 'Underarm wind-up', 'Holding throw from 0.20 s: the charge fills, then stays full.', (T) => windup(T, 'under')),
  S('C7', 'Underarm release', 'Fully charged, let go at 0.', (T) => release(T, 'under')),
  S('C8', 'Throwing while running', 'D held all along; an overhead throw charged from 0.20 s and let go.',
    (T) => ({ length: 0.2 + T.chargeTime + 1.2, pre: 1, hasBall: true, items: [hold(-1, ALWAYS, 0, 1), charge(0.2, 0.2 + T.chargeTime, 'over')] })),
  S('C9', 'A quick throw', 'Let go after a third of the charge: overhead, then side-arm.', (T) => {
    const q = T.chargeTime / 3;
    return { length: 2.4, hasBall: true, items: [charge(0.2, 0.2 + q, 'over'), ball(1.2), charge(1.4, 1.4 + q, 'side')] };
  }),
  S('C10', 'A charge cancelled by a defence', 'Charging, then a deflect; charging, then a catch; charging, then a dash right.', (T) => {
    const pa = 0.8;
    const b = pa + span(T, 'deflect') + 0.4;
    const pb = b + 0.6;
    const c = pb + span(T, 'catch') + 0.4;
    const pc = c + 0.6;
    return {
      length: pc + span(T, 'dodge') + 0.5, hasBall: true,
      items: [charge(0.2, ALWAYS, 'over', false), press(pa, 'deflect'), charge(b, ALWAYS, 'over', false), press(pb, 'catch'), charge(c, ALWAYS, 'over', false), press(pc, 'dodge', 0, 1)],
    };
  }),
  S('C11', 'The ball glows', 'Holding throw from 0.20 s: the ball in hand glows brighter as the charge fills.', (T) => windup(T, 'over')),

  // D. The left arm: guard, parry, catch
  S('D1', 'Guard while charging', 'An overhead throw, then an underarm one.', (T) => {
    const c = T.chargeTime;
    const b = 0.2 + c + 0.7;
    return { length: b + c + 0.6, hasBall: true, items: [charge(0.2, 0.2 + c, 'over'), ball(0.2 + c + 0.55), charge(b, b + c, 'under')] };
  }),
  S('D2', 'Deflect: the backhand parry', 'Standing in the guard; deflect pressed at 0.30 s; a ball meets it halfway through the window.', (T) => defence(T, 'deflect', 0.5)),
  S('D3', 'Deflect mid-charge', 'Charging an overhead throw; deflect pressed at 0.80 s; a ball meets it halfway through the window.',
    (T) => ({ length: 0.8 + span(T, 'deflect') + 0.5, hasBall: true, items: [charge(0.2, ALWAYS, 'over', false), press(0.8, 'deflect'), ballIn(0.8 + win(T, 'deflect') / 2, 'deflect')] })),
  S('D4', 'A deflect that meets the ball', 'Two deflects: a ball meets the first at the very start of its window, the second at the very end.', (T) => {
    const b = 0.3 + span(T, 'deflect') + 0.5;
    return { length: b + span(T, 'deflect') + 0.45, items: [press(0.3, 'deflect'), ballIn(0.32, 'deflect'), press(b, 'deflect'), ballIn(b + win(T, 'deflect') - 0.02, 'deflect')] };
  }),
  S('D5', 'Catch: the palm blast', 'Standing in the guard; catch pressed at 0.30 s, meeting no ball: the whole move.', (T) => ({ length: 0.3 + span(T, 'catch') + 0.45, items: [press(0.3, 'catch')] })),
  S('D6', 'Catch mid-charge', 'Charging an overhead throw; catch pressed at 0.80 s, meeting no ball.',
    (T) => ({ length: 0.8 + span(T, 'catch') + 0.45, hasBall: true, items: [charge(0.2, ALWAYS, 'over', false), press(0.8, 'catch')] })),
  S('D7', 'The caught ball', 'A catch meets a ball halfway through its window; that ball is thrown; a second catch, with a wind-up started right after it.', (T) => {
    const w = win(T, 'catch');
    const ta = 0.3 + w / 2;
    const r = ta + 0.9;
    const b = r + 0.8;
    const tb = b + w / 2;
    return { length: tb + 1, items: [press(0.3, 'catch'), ballIn(ta, 'catch'), charge(ta + 0.5, r, 'over'), press(b, 'catch'), ballIn(tb, 'catch'), charge(tb + 0.12, ALWAYS, 'over', false)] };
  }),
  S('D8', 'A defence that misses', 'Catch pressed at 0.30 s; the ball comes 0.1 s after the window and hits.',
    (T) => ({ length: 0.3 + win(T, 'catch') + 1.3, items: [press(0.3, 'catch'), ballIn(0.3 + win(T, 'catch') + 0.1, 'hit', { flinch: 'flinch_chest' })] })),
  S('D9', 'Pressing again', 'Deflect, and deflect again the moment it ends; then the same with catch.', (T) => {
    const b = 0.3 + span(T, 'deflect') + 0.02;
    const c = b + span(T, 'deflect') + 0.5;
    const d = c + span(T, 'catch') + 0.02;
    return { length: d + span(T, 'catch') + 0.45, items: [press(0.3, 'deflect'), press(b, 'deflect'), press(c, 'catch'), press(d, 'catch')] };
  }),

  // E. Dodges (the dash)
  S('E1', 'Which dodge', 'Dashes right, left, forwards and back, then one with no direction held (the game dashes you to the right).', (T) => {
    const s = span(T, 'dodge') + 0.55;
    return { length: 0.3 + 5 * s, items: [press(0.3, 'dodge', 0, 1), press(0.3 + s, 'dodge', 0, -1), press(0.3 + 2 * s, 'dodge', 1, 0), press(0.3 + 3 * s, 'dodge', -1, 0), press(0.3 + 4 * s, 'dodge', 0, 0)] };
  }),
  S('E2', 'Dash right', 'Standing in the guard; dodge pressed at 0.30 s with D held.', (T) => dash(T, 0, 1)),
  S('E3', 'Dash left', 'Standing in the guard; dodge pressed at 0.30 s with A held.', (T) => dash(T, 0, -1)),
  S('E4', 'Dash forward', 'Standing in the guard; dodge pressed at 0.30 s with W held.', (T) => dash(T, 1, 0)),
  S('E5', 'Dash back', 'Standing in the guard; dodge pressed at 0.30 s with S held.', (T) => dash(T, -1, 0)),
  S('E6', "The dash's trail", 'A dash right, then one left (no trail on Low).', (T) => {
    const s = span(T, 'dodge') + 0.5;
    return { length: 0.3 + 2 * s, items: [press(0.3, 'dodge', 0, 1), press(0.3 + s, 'dodge', 0, -1)] };
  }),
  S('E7', 'Dashing with the ball or while charging', 'Charging, then a dash right (the charge is cancelled); then a dash left carrying the ball.', (T) => {
    const b = 0.8 + span(T, 'dodge') + 0.6;
    return { length: b + span(T, 'dodge') + 0.5, hasBall: true, items: [charge(0.2, ALWAYS, 'over', false), press(0.8, 'dodge', 0, 1), press(b, 'dodge', 0, -1)] };
  }),
  S('E8', 'The end of a dash', 'A dash right, then standing; then a dash right with D held on, running after it.', (T) => {
    const b = 0.3 + span(T, 'dodge') + 0.6;
    return { length: b + span(T, 'dodge') + 0.8, items: [press(0.3, 'dodge', 0, 1), hold(b - 0.25, ALWAYS, 0, 1), press(b, 'dodge', 0, 1)] };
  }),

  // F. Perfect dodges
  S('F1', 'Which acrobatic', 'Four dashes, each a perfect dodge 0.1 s in: a corkscrew, a side flip, a butterfly twist, and a backflip (dashing back).', () => {
    const P = (t, f, r, kind) => [press(t, 'dodge', f, r), perfect(t + 0.1, kind), ballIn(t + 0.1, 'pass', { at: t })];
    return { length: 4.3, items: [P(0.3, 0, 1, 'corkscrew'), P(1.3, 0, -1, 'sideflip'), P(2.3, 0, 1, 'butterfly'), P(3.3, -1, 0, null)] };
  }),
  S('F2', 'Corkscrew', 'A dash right, a perfect dodge 0.1 s in.', () => acro(0, 1, 'corkscrew')),
  S('F3', 'Aerial side flip', 'A dash right, a perfect dodge 0.1 s in.', () => acro(0, 1, 'sideflip')),
  S('F4', 'Butterfly twist', 'A dash right, a perfect dodge 0.1 s in.', () => acro(0, 1, 'butterfly')),
  S('F5', 'Backflip', 'A dash back, a perfect dodge 0.1 s in.', () => acro(-1, 0, null)),

  // G. Getting hit and knocked out
  S('G1', 'Impact freeze', 'A ball hits at 0.40 s.', () => ({ length: 1.2, items: [ballIn(0.4, 'hit', { flinch: 'flinch_chest' })] })),
  S('G2', 'Flinch', 'Two hits: the chest recoils, then the head.', () => ({ length: 2.2, items: [ballIn(0.4, 'hit', { flinch: 'flinch_chest' }), ballIn(1.4, 'hit', { flinch: 'flinch_head' })] })),
  S('G3', 'Knockout: falling back', 'Knocked out at 0.40 s by a ball at 12 m/s.', () => ko(12)),
  S('G4', 'Knockout: thrown off the feet', 'Knocked out at 0.40 s by a ball at 20 m/s.', () => ko(20)),
  S('G5', 'Knockout: tumbling', 'Knocked out at 0.40 s by a ball at 28 m/s.', () => ko(28)),
  S('G6', 'Lying down', 'Lying after a knockout (by a ball at 20 m/s), until the body fades out.', () => ({ length: 2.2, pre: 1.6, items: [ballIn(-1.2, 'ko', { speed: 20 })] })),
  S('G7', 'Knocked out by team health', "The team's bar runs out at 0.40 s: down with no ball.", () => ({ length: 3.4, items: [down(0.4)] })),
  S('G8', 'Hit during another move', 'Hit while running right, hit while charging, then knocked out in the middle of a dash.',
    () => ({ length: 4.6, hasBall: true, items: [hold(-0.5, 1.1, 0, 1), ballIn(0.5, 'hit', { flinch: 'flinch_chest' }), charge(1.4, ALWAYS, 'over', false), ballIn(1.9, 'hit', { flinch: 'flinch_head' }), press(2.8, 'dodge', 0, 1), ballIn(2.92, 'ko', { speed: 20 })] })),

  // H. Getting up
  S('H1', 'Revived', 'Lying (knocked out before the scene starts); revived at 0.30 s, standing still.',
    () => ({ length: 0.3 + MOVE_TIMES.GETUP + 0.6, pre: lyingFirst.pre, items: [lyingFirst.ko, revive(0.3)] })),
  S('H2', "Back up at a round's start", 'Lying when the round ends; the next one starts at 0.30 s: put back in place, and up.',
    (T, C, X) => ({ length: 0.3 + MOVE_TIMES.GETUP + 0.6, pre: lyingFirst.pre, items: [lyingFirst.ko, roundAt(-2, 'over', 1 - X.team), roundAt(0.3, 'count'), revive(0.3, true)] })),
  S('H3', 'Flickering while protected', 'Revived at 0.30 s and protected for 2 s.', () => ({ length: 2.8, pre: lyingFirst.pre, items: [lyingFirst.ko, revive(0.3), protect(0.3, 2.3)] })),

  // I. A round's end
  S('I1', 'Winners celebrate', 'Your team wins three rounds in a row: each time one of the three celebrations.', (T, C, X) => {
    const n = WINS.map((_, k) => roundFor(X.id, k));
    return { length: 8.8, items: [roundAt(0.3, 'over', X.team, n[0]), roundAt(2.8, 'count'), roundAt(3.3, 'over', X.team, n[1]), roundAt(5.8, 'count'), roundAt(6.3, 'over', X.team, n[2])] };
  }),
  S('I2', 'Losers kneel', 'Your team loses the round at 0.30 s.', (T, C, X) => ({ length: 3, items: [roundAt(0.3, 'over', 1 - X.team)] })),
  S('I3', 'A draw', 'The round ends in a draw at 0.30 s.', () => ({ length: 2, items: [roundAt(0.3, 'over', -1)] })),
  S('I4', 'Moving during the end', 'Your team wins at 0.30 s; D held from 2.0 to 3.0 s, then standing again.', (T, C, X) => ({ length: 4.2, items: [roundAt(0.3, 'over', X.team), hold(2, 3, 0, 1)] })),

  // J. One move into another
  S('J1', 'Idle ↔ guard', 'The lobby; a countdown at 1.2 s; play at 2.4 s; a drawn round ends at 3.4 s; the lobby at 4.6 s.',
    () => ({ length: 5.6, round: 'lobby', items: [roundAt(1.2, 'count'), roundAt(2.4, 'play'), roundAt(3.4, 'over', -1), roundAt(4.6, 'lobby')] })),
  S('J2', 'Holding the ball → wind-up', 'Standing with a ball; holding throw from 0.60 s.', () => ({ length: 2, hasBall: true, items: [charge(0.6, ALWAYS, 'over', false)] })),
  S('J3', 'Release → empty hand → a new ball', 'An overhead throw let go at 0.30 s; the new ball comes after the cooldown.',
    (T) => ({ length: 0.3 + T.cooldown + 0.6, pre: T.chargeTime + 0.4, hasBall: true, items: [charge(0.1 - T.chargeTime, 0.3, 'over')] })),
  S('J4', 'Guard → parry', 'Charging (the forearm guarding the face); deflect pressed at 0.80 s.',
    (T) => ({ length: 0.8 + span(T, 'deflect') + 0.5, hasBall: true, items: [charge(0.2, ALWAYS, 'over', false), press(0.8, 'deflect')] })),
  S('J5', 'Guard → catch', 'Charging (the forearm guarding the face); catch pressed at 0.80 s.',
    (T) => ({ length: 0.8 + span(T, 'catch') + 0.5, hasBall: true, items: [charge(0.2, ALWAYS, 'over', false), press(0.8, 'catch')] })),
  S('J6', 'Catch → caught ball → holding it', 'A catch meets a ball halfway through its window; then holding it.',
    (T) => ({ length: 2, items: [press(0.3, 'catch'), ballIn(0.3 + win(T, 'catch') / 2, 'catch')] })),
  S('J7', 'Anything → dash → back', 'A dash right standing, one while running forwards, and one while charging.',
    () => ({ length: 4.8, hasBall: true, items: [press(0.3, 'dodge', 0, 1), hold(1.2, 2.8, 1, 0), press(1.8, 'dodge', 0, 1), charge(3.2, ALWAYS, 'over', false), press(3.9, 'dodge', 0, -1)] })),
  S('J8', 'Dash → perfect dodge', 'A dash right, a perfect dodge 0.1 s in (a corkscrew).', () => acro(0, 1, 'corkscrew')),
  S('J9', 'Anything → flinch', 'Hit standing, hit while running right, hit while charging.',
    () => ({ length: 4, hasBall: true, items: [ballIn(0.4, 'hit', { flinch: 'flinch_chest' }), hold(1, 2.2, 0, 1), ballIn(1.6, 'hit', { flinch: 'flinch_head' }), charge(2.6, ALWAYS, 'over', false), ballIn(3.2, 'hit', { flinch: 'flinch_chest' })] })),
  S('J10', 'Anything → knockout → lying → fading', 'Running right; knocked out at 0.80 s by a ball at 20 m/s; lying; fading out.',
    () => ({ length: 4, pre: 1, items: [hold(-1, 0.8, 0, 1), ballIn(0.8, 'ko', { speed: 20 })] })),
  S('J11', 'Lying → getting up → stance', 'Revived at 0.30 s, standing still; knocked out again; revived at 4.0 s with D held at once.',
    () => ({ length: 5.6, pre: lyingFirst.pre, items: [lyingFirst.ko, revive(0.3), ballIn(2.2, 'ko', { speed: 12 }), revive(4), hold(4.05, ALWAYS, 0, 1)] })),
  S('J12', "Play → round's end → next round", 'Your team wins at 0.50 s; the countdown at 3.0 s; play at 4.5 s.',
    (T, C, X) => ({ length: 5, items: [roundAt(0.5, 'over', X.team), roundAt(3, 'count'), roundAt(4.5, 'play')] })),
  S('J13', 'Strafing right → left', 'D, then A.', () => ({ length: 2.4, pre: 1, items: [hold(-1, 1.2, 0, 1), hold(1.2, ALWAYS, 0, -1)] })),
  S('J14', 'Running forward → backpedalling', 'W, then S.', () => ({ length: 2.4, pre: 1, items: [hold(-1, 1.2, 1, 0), hold(1.2, ALWAYS, -1, 0)] })),
];

/** What the clips measure, for the scenes (the loops' lengths, the throw's moments). */
export function clipInfo(template) {
  const get = (name) => template?.clips.get(name);
  const jog = get('jog');
  const sprint = get('sprint');
  const thr = get('throw');
  return {
    dur: { idle: get('idle')?.duration ?? 3.1, guard: get('guard')?.duration ?? 1.7 },
    // athlete.js run(): metres a cycle at this speed
    stride: (speed) => Math.max(MIN_STRIDE, lerp(jog?.stride || 4, sprint?.stride || 4, smooth(3, 5.5, speed))),
    throw: thr && thr.cock !== undefined ? { cock: thr.cock, release: thr.release, duration: thr.duration } : null,
  };
}

// ------------------------------------------------------------------ playing a script

const by = (key) => (a, b) => a[key] - b[key];
const unique = (times) => [...new Set(times.map((t) => +t.toFixed(4)))].sort((a, b) => a - b);
/** The key moments of a move made here: every time any of its tracks has a key. */
const keyTimes = (...tracks) => unique(tracks.filter(Boolean).flatMap((keys) => keys.map(([u]) => u)));

/** One scene, played: the player's state at each step, the game's events, the round, the balls in
 *  the air, and the moments to mark on the timeline. */
export class ScenePlayer {
  /** T: the timings; C: clipInfo(); X: { team, id } */
  constructor(scene, T, C, X) {
    this.scene = scene;
    this.T = T;
    this.X = X;
    const m = scene.make(T, C, X);
    this.length = Math.round(m.length / DT) * DT;
    this.preSteps = Math.ceil((m.pre ?? 0.6) / DT - EPS);
    this.lastStep = Math.round(m.length / DT);
    this.round0 = { s: m.round ?? 'play' };
    this.ball0 = m.hasBall ?? false;
    this.base = X.team === 1 ? -Math.PI / 2 : Math.PI / 2;     // facing the other half
    const items = (m.items || []).flat(3);
    this.keys = items.filter((i) => i.k === 'keys');
    this.aims = items.filter((i) => i.k === 'aim').sort(by('t0'));
    this.shields = items.filter((i) => i.k === 'invuln');
    this.status = [];             // { t, alive } and { t, hasBall }, in order
    this.events = [];             // what the game's events do to the figure: { t, type, ... }
    this.rounds = [];             // { t, round }
    // the presses, each dodge with the way it goes (from the aim and the keys at that moment)
    this.presses = items.filter((i) => i.k === 'press').sort(by('t')).map((p) => {
      const keys = p.f === null ? this.keysAt(p.t) : { f: p.f, r: p.r };
      const q = { ...p, f: keys?.f ?? 0, r: keys?.r ?? 0 };
      if (p.kind === 'dodge') {
        const y = this.yawAt(p.t);
        const sy = Math.sin(y);
        const cy = Math.cos(y);
        let dx = sy * q.f - cy * q.r;
        let dz = cy * q.f + sy * q.r;
        if (!q.f && !q.r) {          // no direction held: the game sidesteps to the right (main.js dodgeDirection)
          dx = -cy;
          dz = sy;
        }
        const len = Math.hypot(dx, dz) || 1;
        q.dir = [dx / len, dz / len];
        q.dodge = q.f || q.r ? dodgeKind(q.f, q.r) : 'right';
      }
      return q;
    });
    // the charges: each ends where it's let go, or where a press or a knockout cancels it
    const stops = items.filter((i) => i.k === 'press' || i.k === 'down' || (i.k === 'ball' && i.outcome === 'ko')).map((i) => i.t);
    this.charges = items.filter((i) => i.k === 'charge').sort(by('t0')).map((c) => {
      const end = Math.min(c.t1, ...stops.filter((t) => t > c.t0 + EPS));
      return { ...c, end, thrown: c.release && end === c.t1 };
    });
    for (const c of this.charges) {
      this.events.push({ t: c.t0, type: 'style', style: c.style });
      if (!c.thrown) continue;
      this.events.push({ t: c.end, type: 'throw' });
      this.status.push({ t: c.end, hasBall: false }, { t: c.end + T.cooldown, hasBall: true, comes: true });
    }
    for (const i of items) {
      if (i.k === 'ball') {
        if (i.outcome === 'catch') this.status.push({ t: i.t, hasBall: true });
        if (i.outcome === 'ko') this.status.push({ t: i.t, alive: false });
      } else if (i.k === 'down') this.status.push({ t: i.t, alive: false });
      else if (i.k === 'revive') this.status.push({ t: i.t, alive: true, placed: i.placed });
      else if (i.k === 'hasBall') this.status.push({ t: i.t, hasBall: i.has });
      else if (i.k === 'perfect') this.events.push({ t: i.t, type: 'perfect', seed: i.kind ? ACROBATICS.indexOf(i.kind) : 0 });
      else if (i.k === 'round') {
        const n = i.n ?? this.rounds.filter((r) => r.round.s === 'over').length + 1;
        this.rounds.push({ t: i.t, round: { s: i.s, w: i.w, n } });
        if (i.s === 'over') this.events.push({ t: i.t, type: 'cheer', amount: 1 });
      }
    }
    this.status.sort(by('t'));
    this.rounds.sort(by('t'));
    // where the player goes, so the scene can be centred in their half, and the balls aimed
    this.start = { x: 0, z: 0 };
    this.track = this.record();
    const shown = this.track.filter((p) => p.n >= 0 && p.n <= this.lastStep);
    const xs = shown.map((p) => p.x);
    const zs = shown.map((p) => p.z);
    const centre = X.team === 1 ? CENTRE : -CENTRE;
    this.start = { x: centre - (Math.min(...xs) + Math.max(...xs)) / 2, z: -(Math.min(...zs) + Math.max(...zs)) / 2 };
    for (const p of this.track) {
      p.x += this.start.x;
      p.z += this.start.z;
    }
    this.flights = [];
    for (const i of items) if (i.k === 'ball') this.addBall(i);
    for (const c of this.charges) if (c.thrown) this.addThrow(c);
    this.events.sort(by('t'));
    this.marks = this.makeMarks(items, C);
    this.reset();
  }

  /** The keys held at t (the latest-starting of those held then), or null. */
  keysAt(t) {
    let k = null;
    for (const h of this.keys) if (t >= h.t0 - EPS && t < h.t1 - EPS && (!k || h.t0 >= k.t0)) k = h;
    return k;
  }

  /** Where the player aims at t (radians, as the game's yaw: facing along (sin, cos), right is less). */
  yawAt(t) {
    let off = 0;
    for (const a of this.aims) {
      if (t < a.t0) break;
      off = t >= a.t1 ? a.to : lerp(a.from, a.to, smooth(a.t0, a.t1, t));
    }
    return this.base - (off * Math.PI) / 180;
  }

  /** The last status of a kind (alive, hasBall) at t. */
  statusAt(t, key, first) {
    let v = first;
    for (const s of this.status) {
      if (s.t > t + EPS) break;
      if (s[key] !== undefined) v = s[key];
    }
    return v;
  }

  pressAt(t) {
    let p = null;
    for (const q of this.presses) {
      if (q.t > t + EPS) break;
      if (this.statusAt(q.t, 'alive', true)) p = q;
    }
    return p;
  }

  chargeAt(t) {
    for (const c of this.charges) if (t >= c.t0 - EPS && t < c.end - EPS && this.statusAt(t, 'alive', true)) return c;
    return null;
  }

  roundAt(t) {
    let r = this.round0;
    for (const e of this.rounds) {
      if (e.t > t + EPS) break;
      r = e.round;
    }
    return r;
  }

  /** Back to the scene's first step (before its start: the pre-roll that settles the pose). */
  reset() {
    this.n = -this.preSteps;
    this.x = this.start.x;
    this.z = this.start.z;
  }

  get t() {
    return this.n * DT;
  }

  /** The player's state now (as main.js playerStates gives it for your own player). */
  state() {
    const t = this.t;
    const p = this.pressAt(t);
    const c = this.chargeAt(t);
    const actAge = p ? t - p.t : 9;
    return {
      id: this.X.id, team: this.X.team, isMe: true, x: this.x, z: this.z, yaw: this.yawAt(t), alive: this.statusAt(t, 'alive', true),
      charging: !!c, charge: c ? clamp((t - c.t0) / this.T.chargeTime, 0, 1) : 0,
      act: p && actAge < OWN_PRESS ? ACT[p.kind] : 0, actAge,
      hasBall: this.statusAt(t, 'hasBall', this.ball0), invuln: this.shields.some((s) => t >= s.t0 && t < s.t1),
      ballColor: BALL_COLORS[this.X.team] ?? BALL_COLORS[0],
    };
  }

  /** One step on: the player moves as the game moves you (main.js moveLocal). Returns the new state. */
  next() {
    this.n++;
    const t = this.t;
    const T = this.T;
    for (const s of this.status) {           // put back somewhere else (a round's start): a jump, not a run
      if (s.placed && s.t > t - DT + EPS && s.t <= t + EPS) {
        const y = this.yawAt(t);
        this.x -= Math.sin(y) * 3.5;
        this.z -= Math.cos(y) * 3.5;
      }
    }
    if (this.statusAt(t, 'alive', true)) {
      const p = this.pressAt(t);
      const c = this.chargeAt(t);
      const k = this.keysAt(t);
      let vx = 0;
      let vz = 0;
      if (k) {
        const y = k.world ? this.base : this.yawAt(t);
        const sy = Math.sin(y);
        const cy = Math.cos(y);
        vx = sy * k.f - cy * k.r;
        vz = cy * k.f + sy * k.r;
        let speed = k.speed ?? T.walk;
        if (k.speed === undefined) {
          if (c) speed = T.chargeWalk;
          else if (p && p.kind !== 'dodge' && t < p.t + win(T, p.kind)) speed = T.defendWalk;
        }
        const len = Math.hypot(vx, vz);
        if (len > 0) {
          vx = (vx / len) * speed;
          vz = (vz / len) * speed;
        }
      }
      if (p && p.kind === 'dodge' && t < p.t + T.dash.time - EPS) {
        vx = p.dir[0] * T.dash.speed;
        vz = p.dir[1] * T.dash.speed;
      }
      this.x += vx * DT;
      this.z += vz * DT;
    }
    return this.state();
  }

  /** The game's events in the last step (after t0, up to t): what they do to the figure. */
  eventsIn(t0, t) {
    return this.events.filter((e) => e.t > t0 + EPS && e.t <= t + EPS);
  }

  /** Every step's place, from the scene's own start (to centre it in the half, and to aim the balls). */
  record() {
    this.reset();
    const out = [{ n: this.n, x: this.x, z: this.z }];
    while (this.n < this.lastStep + 1) {
      this.next();
      out.push({ n: this.n, x: this.x, z: this.z });
    }
    return out;
  }

  /** Where the player was at t (the recorded track). */
  posAt(t) {
    const i = clamp(Math.round(t / DT) + this.preSteps, 0, this.track.length - 1);
    return this.track[i];
  }

  /** A ball coming at the player from the other half, arriving at item.t, then deflected back,
   *  caught, bouncing off a hit, or flying past a dodge. */
  addBall(item) {
    const ta = item.t;
    const when = item.at ?? ta;
    const P = this.posAt(when);
    const y = this.yawAt(when);
    const fwd = [Math.sin(y), Math.cos(y)];
    const left = [Math.cos(y), -Math.sin(y)];
    const v = item.speed ?? BALL_SPEED;
    const meet = {
      catch: [P.x + fwd[0] * 0.6 + left[0] * 0.16, 1.33, P.z + fwd[1] * 0.6 + left[1] * 0.16],
      deflect: [P.x + fwd[0] * 0.45, 1.3, P.z + fwd[1] * 0.45],
    }[item.outcome] ?? [P.x + fwd[0] * 0.15, 1.25, P.z + fwd[1] * 0.15];
    const from = [P.x + fwd[0] * THROWER[0] - left[0] * THROWER[1], 1.45, P.z + fwd[1] * THROWER[0] - left[1] * THROWER[1]];
    const d = Math.hypot(meet[0] - from[0], meet[1] - from[1], meet[2] - from[2]);
    const dir = [(meet[0] - from[0]) / d, (meet[1] - from[1]) / d, (meet[2] - from[2]) / d];
    const t0 = ta - d / v;
    const colour = BALL_COLORS[1 - this.X.team] ?? BALL_COLORS[1];
    const id = this.flights.length + 1;
    const at = (p, vel, state = 0, rally = 0) => ({
      id, pos: { x: p[0], y: p[1], z: p[2] }, vx: vel[0], vy: vel[1], vz: vel[2], state, rally, color: colour,
    });
    // a hit's ball bounces off and falls, dead (worked out once, a step at a time)
    let fall = null;
    if (item.outcome === 'hit' || item.outcome === 'ko') {
      fall = [];
      const p = [...meet];
      const vel = [-dir[0] * v * 0.25, 2.5, -dir[2] * v * 0.25];
      for (let k = 0; k < 1.6 / DT; k++) {
        vel[1] -= GRAVITY * DT;
        for (let j = 0; j < 3; j++) p[j] += vel[j] * DT;
        if (p[1] < 0.2) {
          p[1] = 0.2;
          vel[1] = Math.abs(vel[1]) * 0.45;
          vel[0] *= 0.7;
          vel[2] *= 0.7;
        }
        fall.push(at(p, vel, 2));
      }
      this.events.push({ t: ta, type: 'hit', ko: item.outcome === 'ko', speed: v, from: { x: from[0], z: from[2] }, flinch: item.flinch });
    } else if (item.outcome === 'catch') this.events.push({ t: ta, type: 'catch' });
    else if (item.outcome === 'deflect') this.events.push({ t: ta, type: 'deflect' });
    this.flights.push((t) => {
      if (t < t0) return null;
      if (t <= ta) {
        const k = (t - t0) * v;
        return at([from[0] + dir[0] * k, from[1] + dir[1] * k, from[2] + dir[2] * k], [dir[0] * v, dir[1] * v, dir[2] * v]);
      }
      const after = t - ta;
      if (item.outcome === 'deflect' && after < 0.7) {       // straight back, faster, in the first rally's colour
        const k = after * v * 1.4;
        return at([meet[0] - dir[0] * k, meet[1] + after * 1.2, meet[2] - dir[2] * k], [-dir[0] * v * 1.4, 1.2, -dir[2] * v * 1.4], 1, 1);
      }
      if (item.outcome === 'pass' && after < 0.8) {
        const k = after * v;
        return at([meet[0] + dir[0] * k, meet[1] + dir[1] * k, meet[2] + dir[2] * k], [dir[0] * v, dir[1] * v, dir[2] * v]);
      }
      if (fall && after < 1.6) return fall[Math.min(fall.length - 1, Math.floor(after / DT))];
      return null;
    });
  }

  /** A thrown ball leaving from where the game lets it go (sim.py HAND_*), along the aim. */
  addThrow(c) {
    const tr = c.end;
    const P = this.posAt(tr);
    const y = this.yawAt(tr);
    const fwd = [Math.sin(y), Math.cos(y)];
    const right = [-Math.cos(y), Math.sin(y)];
    const power = clamp((tr - c.t0) / this.T.chargeTime, 0, 1);
    const v = lerp(this.T.throwSpeed?.[0] ?? 12, this.T.throwSpeed?.[1] ?? 34, power);
    const from = [P.x + fwd[0] * HAND.fwd + right[0] * HAND.right, HAND.up, P.z + fwd[1] * HAND.fwd + right[1] * HAND.right];
    const id = this.flights.length + 1;
    const colour = BALL_COLORS[this.X.team] ?? BALL_COLORS[0];
    this.flights.push((t) => {
      if (t < tr || t > tr + 0.8) return null;
      const k = (t - tr) * v;
      return { id, pos: { x: from[0] + fwd[0] * k, y: from[1] + (t - tr) * 0.6, z: from[2] + fwd[1] * k }, vx: fwd[0] * v, vy: 0.6, vz: fwd[1] * v, state: 0, rally: 0, color: colour };
    });
  }

  /** The balls in the air at t (world.js syncBalls). */
  ballsAt(t) {
    const out = [];
    for (const f of this.flights) {
      const b = f(t);
      if (b) out.push(b);
    }
    return out;
  }

  /** What the timeline marks: events (with a label), spans (window, recovery, dash...), and the key
   *  moments of the moves made here (athlete.js MADE: the ones the editor will move). */
  makeMarks(items, C) {
    const T = this.T;
    const events = [];
    const bands = [];
    const keys = [];
    const ev = (t, label) => events.push({ t, label });
    const band = (t0, t1, label, cls) => bands.push({ t0, t1, label, cls });
    const key = (t, label) => keys.push({ t, label });
    for (const p of this.presses) {
      const s = span(T, p.kind);
      if (p.kind === 'dodge') {
        ev(p.t, `dodge (${p.dodge})`);
        band(p.t, p.t + T.dash.time, 'dash', 'dash');
        band(p.t + T.dash.time, p.t + s, 'landing', 'after');
        const D = p.dodge === 'forward' ? MADE.DASH_FORWARD : p.dodge === 'back' ? MADE.DASH_BACK : MADE.DASH_SIDE;
        const dash = Math.max(0.05, T.dash.time);
        for (const ph of keyTimes(D.hips, D.lead, D.trail, D.L, D.R, D.bend)) {
          if (ph > 0 && ph < 2) key(p.t + (ph <= 1 ? ph * dash : dash + (ph - 1) * Math.max(0.05, s - dash)), `${p.dodge} dash: a key moment`);
        }
      } else {
        ev(p.t, p.kind);
        band(p.t, p.t + win(T, p.kind), 'window', 'window');
        band(p.t + win(T, p.kind), p.t + s, 'recovery', 'after');
        if (p.kind === 'deflect') {
          const P = MADE.PARRY_L;
          for (const u of keyTimes(P.hand, P.fingers, P.palm, P.chest)) if (u > 0 && u < 1) key(p.t + u * s, 'the parry: a key moment');
        }
      }
    }
    for (const c of this.charges) {
      ev(c.t0, `charge (${c.style})`);
      band(c.t0, c.end, 'charging', 'charge');
      if (c.t0 + T.chargeTime < c.end) ev(c.t0 + T.chargeTime, 'full');
      const style = MADE.THROWS[c.style];
      if (style) {
        for (const u of keyTimes(style.wind, style.turnWind, style.bendWind)) if (u > 0 && u < 1 && c.t0 + u * T.chargeTime < c.end) key(c.t0 + u * T.chargeTime, `${c.style} wind-up: a key moment`);
      }
      if (!c.thrown) continue;
      ev(c.end, 'release');
      band(c.end, c.end + MOVE_TIMES.RELEASE, 'release', 'release');
      if (style) {
        for (const u of keyTimes(style.release, style.turnRelease, style.bendRelease)) if (u > 0 && u < 1) key(c.end + u * MOVE_TIMES.RELEASE, `${c.style} release: a key moment`);
      } else if (C.throw) {           // the overhead clip: where its arm comes through
        const { cock, release: let_go, duration } = C.throw;
        const u = (let_go - cock) / (Math.min(duration, let_go + MOVE_TIMES.FOLLOW) - cock);
        if (u > 0 && u < 1) ev(c.end + u * MOVE_TIMES.RELEASE, 'the arm comes through');
      }
      ev(c.end + T.cooldown, 'new ball');
    }
    for (const i of items) {
      if (i.k === 'ball') {
        const what = { deflect: 'deflected', catch: 'caught', hit: 'hits', ko: 'knocks out', pass: 'misses' }[i.outcome];
        ev(i.t, `the ball ${what}`);
        if (i.outcome === 'hit' || i.outcome === 'ko') band(i.t, i.t + (i.outcome === 'ko' ? FREEZE.ko : FREEZE.hit), 'freeze', 'freeze');
        if (i.outcome === 'catch') band(i.t, i.t + MOVE_TIMES.CAUGHT, 'in the left palm', 'caught');
      } else if (i.k === 'perfect') {
        ev(i.t, 'perfect dodge');
        band(i.t, i.t + MOVE_TIMES.ACRO_TIME, 'acrobatic', 'acro');
      } else if (i.k === 'revive') {
        ev(i.t, 'revived');
        band(i.t, i.t + MOVE_TIMES.GETUP, 'getting up', 'getup');
      } else if (i.k === 'down') ev(i.t, 'the team is out');
      else if (i.k === 'hasBall') ev(i.t, i.has ? 'a ball arrives' : 'no ball');
      else if (i.k === 'invuln') band(i.t0, i.t1, 'protected', 'shield');
      else if (i.k === 'keys' && i.t0 > -EPS) ev(i.t0, `holding ${keyName(i)}`);
      else if (i.k === 'aim') band(i.t0, i.t1, 'turning', 'aim');
      else if (i.k === 'round') {
        const r = i.w === null ? '' : i.w === -1 ? ' (a draw)' : i.w === this.X.team ? ' (you win)' : ' (you lose)';
        ev(i.t, { lobby: 'the lobby', count: 'countdown', play: 'play', over: `round over${r}` }[i.s]);
      }
    }
    for (const k of this.keys) if (k.t1 < ALWAYS && k.t1 > 0 && !this.keys.some((o) => Math.abs(o.t0 - k.t1) < EPS)) ev(k.t1, 'keys let go');
    const inside = (t) => t > -EPS && t < this.length + EPS;
    return {
      events: events.filter((e) => inside(e.t)).sort(by('t')),
      bands: bands.filter((b) => b.t1 > 0 && b.t0 < this.length).map((b) => ({ ...b, t0: Math.max(0, b.t0), t1: Math.min(this.length, b.t1) })),
      keys: keys.filter((k) => inside(k.t)).sort(by('t')),
    };
  }
}

const keyName = (k) => {
  const f = k.f > 0 ? 'W' : k.f < 0 ? 'S' : '';
  const r = k.r > 0 ? 'D' : k.r < 0 ? 'A' : '';
  return [f, r].filter(Boolean).join('+') || 'nothing';
};
