// Animated previews for the rules editor. Each one shows what a rule does, computed with the
// same formulas and arc maths the game uses (physics.js), so what you see is what you get.
// Most run two lanes side by side in real time, the default rules next to this lobby's (or
// the host's unapplied draft), so a change shows as a difference between the lanes. The rest
// are charts that draw both: default dashed and grey, this lobby solid and gold.
import { launchVelocity, curveShare } from './physics.js';

const HAND = 1.45;               // throwing-hand height (sim.HAND_UP)
const CAPSULE = [0.25, 1.45];    // the hit capsule's vertical segment (sim.CAPSULE_Y0 / Y1)
const COL = {
  bg: '#0b1222', grid: 'rgba(255,255,255,0.06)', line: 'rgba(255,255,255,0.18)', text: '#eef2fb', dim: '#8792ab',
  gold: '#ffc940', good: '#5dff9b', bad: '#ff6b6b', red: '#ff4d5e', blue: '#3fa9ff', ball: '#ffd23f',
};
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const DEG = Math.PI / 180;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const throwSpeed = (R, power) => R.THROW_SPEED_MIN + (R.THROW_SPEED_MAX - R.THROW_SPEED_MIN) * power;
const throwCost = (R, power) => R.THROW_COST_MIN + (R.THROW_COST_MAX - R.THROW_COST_MIN) * power;
const damageFor = (R, speed) => clamp(R.DAMAGE_MIN + (speed - R.THROW_SPEED_MIN) * R.DAMAGE_PER_SPEED, R.DAMAGE_MIN, R.DAMAGE_MAX);
const r1 = (v) => (Math.round(v * 10) / 10).toString();
const r2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

// Simulations are cheap but run every frame for two lanes, so remember recent results.
const cache = new Map();
function memo(key, fn) {
  if (!cache.has(key)) {
    if (cache.size > 300) cache.clear();
    cache.set(key, fn());
  }
  return cache.get(key);
}
const keyOf = (R, keys) => keys.map((k) => R[k]).join('|');

// ---------------------------------------------------------------- drawing helpers

function txt(ctx, s, x, y, o = {}) {
  ctx.font = `${o.weight ?? 600} ${o.size ?? 12}px ${FONT}`;
  ctx.fillStyle = o.color ?? COL.text;
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.base ?? 'alphabetic';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

/** A line of text in which the parts tied to the focused rule stand out. parts: [[text, keys?]]. */
function readout(ctx, parts, x, y, env, size = 12) {
  let cx = x;
  for (const [s, keys] of parts) {
    const hot = keys && keys.includes(env.focus);
    const color = hot ? (env.mine ? COL.gold : COL.text) : env.mine ? '#d5dbe8' : COL.dim;
    cx += txt(ctx, s, cx, y, { color, size, weight: hot ? 800 : 500 });
  }
  return cx;
}

function line(ctx, x1, y1, x2, y2, color, width = 1.5, dash = null) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function circle(ctx, x, y, r, fill, stroke = null, width = 1.5) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function rect(ctx, x, y, w, h, fill, stroke = null, width = 1) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.strokeRect(x, y, w, h);
  }
}

function wedge(ctx, x, y, r, a0, a1, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, a0, a1);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function path(ctx, pts, color, width = 1.5, dash = null) {
  if (pts.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash || []);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function ball(ctx, x, y, r, color = COL.ball) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  g.addColorStop(0, `${color}aa`);
  g.addColorStop(1, `${color}00`);
  circle(ctx, x, y, r * 3, g);
  circle(ctx, x, y, r, color);
}

/** Side-view stick figure standing at `x` on `ground`, `s` pixels per metre. */
function figure(ctx, x, ground, s, color, { dir = 1, down = false, alpha = 1, arms = 'down' } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.lineCap = 'round';
  if (down) {
    ctx.beginPath();
    ctx.moveTo(x - 0.8 * s, ground - 0.1 * s);
    ctx.lineTo(x + 0.6 * s, ground - 0.1 * s);
    ctx.stroke();
    circle(ctx, x + 0.78 * s, ground - 0.14 * s, 0.15 * s, color);
    ctx.restore();
    return;
  }
  const hip = ground - 0.95 * s;
  const shoulder = ground - 1.42 * s;
  ctx.beginPath();
  ctx.moveTo(x - 0.17 * s, ground);
  ctx.lineTo(x, hip);
  ctx.lineTo(x + 0.17 * s, ground);
  ctx.moveTo(x, hip);
  ctx.lineTo(x, shoulder);
  if (arms === 'up') {          // winding up: throwing arm cocked back
    ctx.moveTo(x, shoulder);
    ctx.lineTo(x - dir * 0.3 * s, shoulder - 0.35 * s);
  } else if (arms === 'out') {  // catching / throwing forward
    ctx.moveTo(x, shoulder);
    ctx.lineTo(x + dir * 0.55 * s, shoulder - 0.05 * s);
  } else {
    ctx.moveTo(x, shoulder);
    ctx.lineTo(x + dir * 0.18 * s, shoulder + 0.5 * s);
  }
  ctx.stroke();
  circle(ctx, x, ground - 1.62 * s, 0.17 * s, color);
  ctx.restore();
}

/** Metres to pixels for a side view: x from -0.6 to D + 0.6, y from 0 to `top`, centred.
 *  Lanes are wide and short, so distances may be stretched up to 1.5x (heights stay true;
 *  the readouts give the exact numbers). `s` is the height scale, used for bodies and balls. */
function sideMap(box, D, top) {
  const T = 26;
  const B = 28;
  const s = (box.h - T - B) / top;
  const sxs = Math.min((box.w - 40) / (D + 1.2), s * 1.5);
  const x0 = (box.w - (D + 1.2) * sxs) / 2 + 0.6 * sxs;
  const ground = box.h - B;
  return { s, ground, sx: (x) => x0 + x * sxs, sy: (y) => ground - y * s };
}

/** Metres to pixels for a top view (x right, z up), fitted and centred. */
function topMap(box, x0, x1, z0, z1, bottom = 34) {
  const T = 24;
  const s = Math.min((box.w - 24) / (x1 - x0), (box.h - T - bottom) / (z1 - z0));
  const ox = (box.w - s * (x1 - x0)) / 2;
  const oy = T + (box.h - T - bottom - s * (z1 - z0)) / 2;
  return { s, sx: (x) => ox + (x - x0) * s, sy: (z) => oy + (z1 - z) * s };
}

function groundLine(ctx, m, x0, x1) {
  line(ctx, m.sx(x0), m.ground, m.sx(x1), m.ground, COL.line, 2);
}

function powerBar(ctx, x, y, w, k, color) {
  rect(ctx, x, y, w, 6, 'rgba(255,255,255,0.12)');
  rect(ctx, x, y, w * clamp(k, 0, 1), 6, color);
}

// ---------------------------------------------------------------- shared simulations

/** A ball flying in side view (x forward, y up) at a target capsule standing at x = D.
 *  With `bounces`, the floor ricochets it like the game does (_hit_world + _bend). */
function simulateSide(R, from, vel, D, bounces = false) {
  let [x, y] = from;
  let [vx, vy] = vel;
  const dt = 1 / 240;
  const hitR = R.PLAYER_RADIUS + R.BALL_RADIUS;
  const pts = [[0, x, y]];
  let t = 0;
  let end = 'miss';
  let bounce = null;
  let seek = 0;
  while (t < 4) {
    if (seek) {                                   // bend toward the target's chest, as _bend does
      const speed = Math.hypot(vx, vy);
      const want = D - x > 0.05 ? launchVelocity([x, y, 0], [D, R.CHEST_HEIGHT, 0], speed, R.GRAVITY, false) : null;
      if (want) {
        const cur = Math.atan2(vy, vx);
        let diff = Math.atan2(want[1], want[0]) - cur;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const turn = seek * curveShare(R, speed) * dt;
        const a = cur + clamp(diff, -turn, turn);
        vx = Math.cos(a) * speed;
        vy = Math.sin(a) * speed;
      }
    }
    vy -= R.GRAVITY * dt;
    x += vx * dt;
    y += vy * dt;
    t += dt;
    if (y <= R.BALL_RADIUS) {
      y = R.BALL_RADIUS;
      pts.push([t, x, y]);
      if (!bounces) {
        end = 'short';
        break;
      }
      const before = Math.hypot(vx, vy);
      vx *= R.RICOCHET_TANGENT_KEEP;
      vy = -vy * R.RICOCHET_NORMAL_KEEP;
      const after = Math.hypot(vx, vy);
      const may = !bounce && R.MAX_RICOCHETS >= 1;
      bounce = { t, x, y, before, after, ok: may && after >= R.RICOCHET_MIN_SPEED };
      if (!bounce.ok) {
        end = R.MAX_RICOCHETS < 1 ? 'stopped' : 'dropped';
        break;
      }
      if (D - x >= 0.5 && D - x <= R.ASSIST_RANGE) seek = R.ASSIST_TURN_RATE_DEG * R.RICOCHET_CURVE_KEEP * DEG;
      continue;
    }
    pts.push([t, x, y]);
    if (Math.hypot(x - D, y - clamp(y, ...CAPSULE)) <= hitR) {
      end = 'hit';
      break;
    }
    if (x > D + 1.5 || y > 12) break;
  }
  return { pts, end, flight: t, bounce, impact: Math.hypot(vx, vy) };
}

/** A throw at `power` from the hand at a target 14 m away, aimed at its chest. */
function shot(R, power, D = 14) {
  return memo(`shot|${power}|${D}|${keyOf(R, ['THROW_SPEED_MIN', 'THROW_SPEED_MAX', 'GRAVITY', 'CHEST_HEIGHT', 'PLAYER_RADIUS', 'BALL_RADIUS'])}`, () => {
    const speed = throwSpeed(R, power);
    const v = launchVelocity([0, HAND, 0], [D, R.CHEST_HEIGHT, 0], speed, R.GRAVITY);
    const sim = simulateSide(R, [0, HAND], [v[0], v[1]], D);
    return { ...sim, speed, power, peak: Math.max(...sim.pts.map((p) => p[2])) };
  });
}

/** Where a simulated ball is `k` seconds after release. */
function at(sim, k) {
  const pts = sim.pts;
  if (k >= sim.flight) return { x: pts[pts.length - 1][1], y: pts[pts.length - 1][2], done: true };
  let i = Math.min(pts.length - 1, Math.floor(k * 240));
  while (i > 0 && pts[i][0] > k) i--;
  return { x: pts[i][1], y: pts[i][2], done: false };
}

/** Draws a shot `t` seconds into the scene: trail, ball, and what happened at the end. */
function drawShot(ctx, m, sim, release, t, R, env, label) {
  if (t < release) return;
  const k = t - release;
  const p = at(sim, k);
  const trail = sim.pts.filter((q) => q[0] <= k && q[0] >= k - 0.35).map((q) => [m.sx(q[1]), m.sy(q[2])]);
  path(ctx, trail, env.mine ? 'rgba(255,210,63,0.55)' : 'rgba(150,160,180,0.45)', 2.5);
  const after = k - sim.flight;
  if (!p.done || after < 0.25) ball(ctx, m.sx(p.x), m.sy(p.y), Math.max(3, R.BALL_RADIUS * m.s), env.mine ? COL.ball : '#b9c0cf');
  if (p.done && after < 0.9) {
    const msg = sim.end === 'hit' ? label : sim.end === 'short' ? 'falls short' : sim.end === 'dropped' ? 'drops' : '';
    if (msg) txt(ctx, msg, m.sx(p.x), m.sy(p.y) - 14 - after * 16, { color: sim.end === 'hit' ? COL.bad : COL.dim, size: 13, weight: 800, align: 'center' });
  }
}

// ---------------------------------------------------------------- the scenes
// Each scene: {title, caption, lanes: 'rows' | 'cols' | undefined, period(A, B), prepare(A, B),
// lane(ctx, box, t, R, env)} for two-lane scenes, or draw(ctx, box, t, A, B, env) for charts.

const SCENES = {};

SCENES.throw = {
  title: 'Throwing',
  caption: 'A quick tap, then a full charge, at someone 14 m away, in real time. Speed is what deals damage.',
  lanes: 'rows',
  timeline(R) {
    const tap = shot(R, 0);
    const chargeAt = 0.3 + tap.flight + 0.6;
    const full = shot(R, 1);
    return { tap, full, chargeAt, release: chargeAt + R.CHARGE_TIME, end: chargeAt + R.CHARGE_TIME + full.flight + 1.0 };
  },
  prepare(A, B) {
    return { top: Math.max(2.4, ...[A, B].flatMap((R) => [shot(R, 0).peak, shot(R, 1).peak])) + 0.3 };
  },
  period(A, B) {
    return Math.max(this.timeline(A).end, this.timeline(B).end);
  },
  lane(ctx, box, t, R, env) {
    const D = 14;
    const m = sideMap(box, D, env.shared.top);
    const tl = this.timeline(R);
    groundLine(ctx, m, -0.6, D + 0.6);
    const charging = t >= tl.chargeAt && t < tl.release;
    figure(ctx, m.sx(-0.3), m.ground, m.s, env.mine ? COL.red : COL.dim, { arms: charging ? 'up' : 'out' });
    figure(ctx, m.sx(D), m.ground, m.s, env.mine ? COL.blue : COL.dim, { dir: -1 });
    if (t < 0.3 || (t > 0.3 + tl.tap.flight && t < tl.release)) {
      ball(ctx, m.sx(0), m.sy(charging ? HAND + 0.3 : HAND), Math.max(3, R.BALL_RADIUS * m.s), env.mine ? COL.ball : '#b9c0cf');
    }
    if (charging) {
      powerBar(ctx, m.sx(-0.3) - 22, m.sy(2.3), 44, (t - tl.chargeAt) / R.CHARGE_TIME, env.mine ? COL.gold : COL.dim);
    }
    const tapDmg = Math.round(damageFor(R, tl.tap.impact));
    const fullDmg = Math.round(damageFor(R, tl.full.impact));
    drawShot(ctx, m, tl.tap, 0.3, t, R, env, `−${tapDmg}`);
    drawShot(ctx, m, tl.full, tl.release, t, R, env, `−${fullDmg}`);
    readout(ctx, [
      ['Tap: '], [`${r1(throwSpeed(R, 0))} m/s`, ['THROW_SPEED_MIN']], [' → '], [`${tapDmg} dmg`, ['DAMAGE_MIN', 'DAMAGE_PER_SPEED']],
      [', '], [`${Math.round(throwCost(R, 0))} stamina`, ['THROW_COST_MIN']],
      ['     Full charge: hold '], [`${r1(R.CHARGE_TIME)} s`, ['CHARGE_TIME']], [' → '], [`${r1(throwSpeed(R, 1))} m/s`, ['THROW_SPEED_MAX']],
      [' → '], [`${fullDmg} dmg`, ['DAMAGE_MAX', 'DAMAGE_PER_SPEED']], [', '], [`${Math.round(throwCost(R, 1))} stamina`, ['THROW_COST_MAX']],
    ], 12, box.h - 9, env);
  },
};

SCENES.arc = {
  title: 'Gravity and arcs',
  caption: 'A tap, a half charge and a full charge at the same target 14 m away. Every throw lands where you aim; slower ones lob higher.',
  lanes: 'rows',
  prepare(A, B) {
    return { top: Math.max(2.4, ...[A, B].flatMap((R) => [0, 0.5, 1].map((p) => shot(R, p).peak))) + 0.3 };
  },
  period(A, B) {
    return 0.3 + Math.max(...[A, B].flatMap((R) => [0, 0.5, 1].map((p) => shot(R, p).flight))) + 1.2;
  },
  lane(ctx, box, t, R, env) {
    const D = 14;
    const m = sideMap(box, D, env.shared.top);
    groundLine(ctx, m, -0.6, D + 0.6);
    figure(ctx, m.sx(-0.3), m.ground, m.s, env.mine ? COL.red : COL.dim, { arms: 'out' });
    figure(ctx, m.sx(D), m.ground, m.s, env.mine ? COL.blue : COL.dim, { dir: -1 });
    const names = ['tap', 'half', 'full'];
    [0, 0.5, 1].forEach((power, i) => {
      const s = shot(R, power);
      path(ctx, s.pts.map((q) => [m.sx(q[1]), m.sy(q[2])]), env.mine ? 'rgba(255,210,63,0.28)' : 'rgba(150,160,180,0.25)', 1.5, [3, 4]);
      const top = s.pts.reduce((a, q) => (q[2] > a[2] ? q : a));
      if (top[2] > HAND + 0.15) txt(ctx, `${names[i]} ↑${r1(top[2] - HAND)} m`, m.sx(top[1]), m.sy(top[2]) - 6, { size: 10, color: env.mine ? '#e9d79c' : COL.dim, align: 'center' });
      drawShot(ctx, m, s, 0.3, t, R, env, '');
    });
    const tap = shot(R, 0);
    const parts = R.GRAVITY <= 0
      ? [['Gravity '], ['0', ['GRAVITY']], [': every throw flies dead straight.']]
      : [['Gravity '], [`${r1(R.GRAVITY)} m/s²`, ['GRAVITY']], [`: a tap peaks ${r1(tap.peak - HAND)} m above the hand`],
        [tap.end === 'short' ? ' and can\'t reach 14 m: it falls short.'
          : shot(R, 1).peak - HAND < 0.2 ? '; a full throw flies almost flat.' : `, a full throw ${r1(shot(R, 1).peak - HAND)} m.`]];
    readout(ctx, parts, 12, box.h - 9, env);
  },
};

SCENES.ricochet = {
  title: 'Floor ricochet',
  caption: 'A full-power throw aimed at the floor halfway to an enemy: it bounces, loses speed, then curves toward them.',
  lanes: 'rows',
  sim(R) {
    return memo(`bank|${keyOf(R, ['THROW_SPEED_MIN', 'THROW_SPEED_MAX', 'GRAVITY', 'CHEST_HEIGHT', 'PLAYER_RADIUS', 'BALL_RADIUS', 'RICOCHET_NORMAL_KEEP',
      'RICOCHET_TANGENT_KEEP', 'RICOCHET_MIN_SPEED', 'RICOCHET_CURVE_KEEP', 'ASSIST_TURN_RATE_DEG', 'SLOW_BALL_CURVE', 'MAX_RICOCHETS',
      'ASSIST_RANGE'])}`, () => {
      const v = launchVelocity([0, HAND, 0], [6, 0, 0], R.THROW_SPEED_MAX, R.GRAVITY);
      return simulateSide(R, [0, HAND], [v[0], v[1]], 14, true);
    });
  },
  prepare(A, B) {
    return { top: Math.max(2.4, ...[A, B].map((R) => Math.max(...this.sim(R).pts.map((q) => q[2])))) + 0.3 };
  },
  period(A, B) {
    return 0.3 + Math.max(this.sim(A).flight, this.sim(B).flight) + 1.3;
  },
  lane(ctx, box, t, R, env) {
    const D = 14;
    const m = sideMap(box, D, env.shared.top);
    groundLine(ctx, m, -0.6, D + 0.6);
    figure(ctx, m.sx(-0.3), m.ground, m.s, env.mine ? COL.red : COL.dim, { arms: 'out' });
    figure(ctx, m.sx(D), m.ground, m.s, env.mine ? COL.blue : COL.dim, { dir: -1 });
    const sim = this.sim(R);
    const b = sim.bounce;
    if (b && t - 0.3 >= b.t) {
      const k = t - 0.3 - b.t;
      if (k < 0.6) circle(ctx, m.sx(b.x), m.ground, 4 + k * 30, null, `rgba(255,255,255,${0.8 - k * 1.3})`, 2);
      txt(ctx, `${r1(b.before)} → ${r1(b.after)} m/s`, m.sx(b.x), m.ground - 8 - Math.max(0, R.BALL_RADIUS * m.s), { size: 11, color: env.mine ? COL.gold : COL.dim, align: 'center' });
    }
    drawShot(ctx, m, sim, 0.3, t, R, env, `ricochet −${Math.round(damageFor(R, sim.impact))}`);
    let parts;
    if (sim.end === 'stopped') parts = [['Bounces per throw: '], ['0', ['MAX_RICOCHETS']], [': the floor just stops the ball.']];
    else if (sim.end === 'dropped') {
      parts = [['After the bounce it\'s at '], [`${r1(b.after)} m/s`, ['RICOCHET_NORMAL_KEEP', 'RICOCHET_TANGENT_KEEP']], [', under the '],
        [`${r1(R.RICOCHET_MIN_SPEED)} m/s`, ['RICOCHET_MIN_SPEED']], [' minimum: it drops dead.']];
    } else {
      parts = [['Keeps '], [`${Math.round(R.RICOCHET_NORMAL_KEEP * 100)}%`, ['RICOCHET_NORMAL_KEEP']], [' off the floor and '],
        [`${Math.round(R.RICOCHET_TANGENT_KEEP * 100)}%`, ['RICOCHET_TANGENT_KEEP']], [' along it, then curves toward the enemy '],
        [`${r2(R.RICOCHET_CURVE_KEEP)}×`, ['RICOCHET_CURVE_KEEP']], [' as hard as a direct throw. '],
        [`${R.MAX_RICOCHETS} bounce${R.MAX_RICOCHETS === 1 ? '' : 's'} allowed`, ['MAX_RICOCHETS']], [sim.end === 'hit' ? '.' : ': this one misses.']];
    }
    readout(ctx, parts, 12, box.h - 9, env);
  },
};

/** Top view of a bank shot off the side wall, curving toward an enemy (the game's wall ricochet). */
function wallShot(R) {
  return memo(`wall|${keyOf(R, ['THROW_SPEED_MIN', 'THROW_SPEED_MAX', 'PLAYER_RADIUS', 'BALL_RADIUS', 'RICOCHET_NORMAL_KEEP', 'RICOCHET_TANGENT_KEEP',
    'RICOCHET_MIN_SPEED', 'RICOCHET_CURVE_KEEP', 'ASSIST_TURN_RATE_DEG', 'SLOW_BALL_CURVE', 'RICOCHET_CONE_DEG', 'MAX_RICOCHETS',
    'ASSIST_RANGE'])}`, () => {
    const W = 7;
    const enemy = [13, 1];
    let [x, z] = [1, -4];
    const aim = [7, W];
    const len = Math.hypot(aim[0] - x, aim[1] - z);
    let vx = ((aim[0] - x) / len) * R.THROW_SPEED_MAX;
    let vz = ((aim[1] - z) / len) * R.THROW_SPEED_MAX;
    const pts = [[0, x, z]];
    const dt = 1 / 240;
    let t = 0;
    let bounce = null;
    let seek = 0;
    let end = 'miss';
    while (t < 2) {
      if (seek) {
        const ex = enemy[0] - x;
        const ez = enemy[1] - z;
        const speed = Math.hypot(vx, vz);
        if ((ex * vx + ez * vz) / (Math.hypot(ex, ez) * speed) < 0.3) seek = 0;     // went past: let go
        else {
          const cur = Math.atan2(vz, vx);
          let diff = Math.atan2(ez, ex) - cur;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const turn = seek * curveShare(R, speed) * dt;
          const a = cur + clamp(diff, -turn, turn);
          vx = Math.cos(a) * speed;
          vz = Math.sin(a) * speed;
        }
      }
      x += vx * dt;
      z += vz * dt;
      t += dt;
      if (!bounce && z >= W - R.BALL_RADIUS) {
        z = W - R.BALL_RADIUS;
        vx *= R.RICOCHET_TANGENT_KEEP;
        vz = -vz * R.RICOCHET_NORMAL_KEEP;
        const speed = Math.hypot(vx, vz);
        const ex = enemy[0] - x;
        const ez = enemy[1] - z;
        const angle = Math.acos(clamp((ex * vx + ez * vz) / (Math.hypot(ex, ez) * speed), -1, 1)) / DEG;
        const ok = R.MAX_RICOCHETS >= 1 && speed >= R.RICOCHET_MIN_SPEED;
        bounce = { t, x, z, heading: Math.atan2(vz, vx), angle, ok, seeks: ok && angle <= R.RICOCHET_CONE_DEG && Math.hypot(ex, ez) <= R.ASSIST_RANGE };
        pts.push([t, x, z]);
        if (!ok) {
          end = 'dropped';
          break;
        }
        if (bounce.seeks) seek = R.ASSIST_TURN_RATE_DEG * R.RICOCHET_CURVE_KEEP * DEG;
        continue;
      }
      pts.push([t, x, z]);
      if (Math.hypot(x - enemy[0], z - enemy[1]) <= R.PLAYER_RADIUS + R.BALL_RADIUS) {
        end = 'hit';
        break;
      }
      if (x > 16 || z < -W) break;
    }
    return { pts, end, bounce, flight: t, enemy, W };
  });
}

SCENES.ricochetTop = {
  title: 'Wall ricochet, seen from above',
  caption: 'A full-power bank shot off the side wall. After the bounce, an enemy inside the seek angle pulls the ball toward them.',
  lanes: 'cols',
  period(A, B) {
    return 0.3 + Math.max(wallShot(A).flight, wallShot(B).flight) + 1.2;
  },
  lane(ctx, box, t, R, env) {
    const sim = wallShot(R);
    const m = topMap(box, 0, 16, -sim.W, sim.W);
    rect(ctx, m.sx(0), m.sy(sim.W), 16 * m.s, 2 * sim.W * m.s, 'rgba(255,255,255,0.025)');
    line(ctx, m.sx(0), m.sy(sim.W), m.sx(16), m.sy(sim.W), '#9fe8ff', 3);
    txt(ctx, 'side wall', m.sx(15.6), m.sy(sim.W) + 13, { size: 10, color: COL.dim, align: 'right' });
    line(ctx, m.sx(8), m.sy(sim.W), m.sx(8), m.sy(-sim.W), COL.line, 1, [4, 4]);
    const b = sim.bounce;
    if (b) {
      const reach = 9 * m.s;
      wedge(ctx, m.sx(b.x), m.sy(b.z), reach, -b.heading - R.RICOCHET_CONE_DEG * DEG, -b.heading + R.RICOCHET_CONE_DEG * DEG,
        env.mine ? 'rgba(255,201,64,0.13)' : 'rgba(150,160,180,0.12)');
    }
    circle(ctx, m.sx(1), m.sy(-4), 0.42 * m.s, env.mine ? COL.red : COL.dim);
    circle(ctx, m.sx(sim.enemy[0]), m.sy(sim.enemy[1]), R.PLAYER_RADIUS * m.s, env.mine ? COL.blue : COL.dim);
    const k = t - 0.3;
    if (k >= 0) {
      const p = at(sim, k);
      path(ctx, sim.pts.filter((q) => q[0] <= k).map((q) => [m.sx(q[1]), m.sy(q[2])]), env.mine ? 'rgba(255,210,63,0.6)' : 'rgba(150,160,180,0.5)', 2);
      if (!p.done || k - sim.flight < 0.3) ball(ctx, m.sx(p.x), m.sy(p.y), Math.max(3, R.BALL_RADIUS * m.s), env.mine ? COL.ball : '#b9c0cf');
      if (p.done && sim.end === 'hit' && k - sim.flight < 0.9) txt(ctx, 'hit', m.sx(p.x), m.sy(p.y) - 12, { color: COL.bad, size: 13, weight: 800, align: 'center' });
    }
    const parts = !b ? [['No bounce.']]
      : !b.ok ? [['Too slow after the bounce (or 0 bounces allowed): it drops.', ['RICOCHET_MIN_SPEED', 'MAX_RICOCHETS']]]
        : b.seeks ? [['Enemy '], [`${Math.round(b.angle)}°`, []], [' off, inside the '], [`${Math.round(R.RICOCHET_CONE_DEG)}°`, ['RICOCHET_CONE_DEG']],
          [' seek angle: curves '], [`${r2(R.RICOCHET_CURVE_KEEP)}×`, ['RICOCHET_CURVE_KEEP']], [' as hard as a direct throw']]
          : [['Enemy '], [`${Math.round(b.angle)}°`, []], [' off, outside the '], [`${Math.round(R.RICOCHET_CONE_DEG)}°`, ['RICOCHET_CONE_DEG']], [' seek angle: flies straight']];
    readout(ctx, parts, 10, box.h - 10, env, 11);
  },
};

/** Top view of an aimed throw with aim assist (the game's _assist_target + _bend). */
function assistShot(R, deflect) {
  return memo(`assist|${deflect}|${keyOf(R, ['THROW_SPEED_MIN', 'THROW_SPEED_MAX', 'PLAYER_RADIUS', 'BALL_RADIUS', 'ASSIST_CONE_DEG',
    'DEFLECT_ASSIST_CONE_DEG', 'ASSIST_SLACK_DEG', 'ASSIST_TURN_RATE_DEG', 'SLOW_BALL_CURVE', 'ASSIST_RANGE'])}`, () => {
    const D = 14;
    const off = deflect ? 15 : 7;           // how far off the crosshair is from the enemy
    const cone = deflect ? R.DEFLECT_ASSIST_CONE_DEG : R.ASSIST_CONE_DEG;
    const assisted = off - R.ASSIST_SLACK_DEG <= cone && D <= R.ASSIST_RANGE;
    const speed = R.THROW_SPEED_MAX;
    let vx = Math.cos(off * DEG) * speed;
    let vz = Math.sin(off * DEG) * speed;
    let [x, z] = [0, 0];
    let turn = assisted ? R.ASSIST_TURN_RATE_DEG * DEG * curveShare(R, speed) : 0;
    const pts = [[0, x, z]];
    const dt = 1 / 240;
    let t = 0;
    let end = 'miss';
    while (t < 1.5) {
      if (turn) {
        const ex = D - x;
        const ez = -z;
        if ((ex * vx + ez * vz) / (Math.hypot(ex, ez) * speed) < 0.3) turn = 0;
        else {
          const cur = Math.atan2(vz, vx);
          let diff = Math.atan2(ez, ex) - cur;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const a = cur + clamp(diff, -turn * dt, turn * dt);
          vx = Math.cos(a) * speed;
          vz = Math.sin(a) * speed;
        }
      }
      x += vx * dt;
      z += vz * dt;
      t += dt;
      pts.push([t, x, z]);
      if (Math.hypot(x - D, z) <= R.PLAYER_RADIUS + R.BALL_RADIUS) {
        end = 'hit';
        break;
      }
      if (x > D + 2 || Math.abs(z) > 5) break;
    }
    return { pts, end, flight: t, off, cone, assisted, D };
  });
}

SCENES.assist = {
  title: 'Aim assist, seen from above',
  caption: 'A full-power throw aimed a few degrees off an enemy 14 m away (dashed: where the crosshair points). Inside the assist angle, the ball bends in.',
  lanes: 'cols',
  period(A, B) {
    return 0.3 + Math.max(assistShot(A, false).flight, assistShot(B, false).flight, assistShot(A, true).flight, assistShot(B, true).flight) + 1.2;
  },
  lane(ctx, box, t, R, env) {
    const deflect = env.focus === 'DEFLECT_ASSIST_CONE_DEG';
    const sim = assistShot(R, deflect);
    const m = topMap(box, -0.8, 15.5, -4.2, 4.2);
    const o = [m.sx(0), m.sy(0)];
    const reach = 15.2 * m.s;
    const cone = sim.cone * DEG;
    const slack = (sim.cone + R.ASSIST_SLACK_DEG) * DEG;
    wedge(ctx, o[0], o[1], reach, -slack, slack, env.mine ? 'rgba(255,201,64,0.07)' : 'rgba(150,160,180,0.06)');
    wedge(ctx, o[0], o[1], reach, -cone, cone, env.mine ? 'rgba(255,201,64,0.16)' : 'rgba(150,160,180,0.14)');
    if (R.ASSIST_RANGE < 15.2) {
      ctx.beginPath();
      ctx.arc(o[0], o[1], R.ASSIST_RANGE * m.s, -0.6, 0.6);
      ctx.strokeStyle = COL.bad;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const aimEnd = [m.sx(15.2 * Math.cos(sim.off * DEG)), m.sy(15.2 * Math.sin(sim.off * DEG))];
    line(ctx, o[0], o[1], aimEnd[0], aimEnd[1], COL.text, 1, [5, 4]);
    circle(ctx, o[0], o[1], 0.42 * m.s, env.mine ? COL.red : COL.dim);
    circle(ctx, m.sx(sim.D), m.sy(0), R.PLAYER_RADIUS * m.s, env.mine ? COL.blue : COL.dim);
    const k = t - 0.3;
    if (k >= 0) {
      const p = at(sim, k);
      path(ctx, sim.pts.filter((q) => q[0] <= k).map((q) => [m.sx(q[1]), m.sy(q[2])]), env.mine ? 'rgba(255,210,63,0.6)' : 'rgba(150,160,180,0.5)', 2);
      if (!p.done || k - sim.flight < 0.3) ball(ctx, m.sx(p.x), m.sy(p.y), Math.max(3, R.BALL_RADIUS * m.s), env.mine ? COL.ball : '#b9c0cf');
      if (p.done && k - sim.flight < 0.9) txt(ctx, sim.end === 'hit' ? 'hit' : 'miss', m.sx(p.x), m.sy(p.y) - 12, { color: sim.end === 'hit' ? COL.bad : COL.dim, size: 13, weight: 800, align: 'center' });
    }
    const coneKey = deflect ? 'DEFLECT_ASSIST_CONE_DEG' : 'ASSIST_CONE_DEG';
    const parts = [[`${deflect ? 'Deflect' : 'Throw'} aimed ${sim.off}° off; assist angle `], [`${r1(sim.cone)}°`, [coneKey]], [' + '],
      [`${r1(R.ASSIST_SLACK_DEG)}°`, ['ASSIST_SLACK_DEG']], [sim.assisted ? ': bends ' : R.ASSIST_RANGE < sim.D ? ': out of ' : ': no assist'],
      ...(sim.assisted ? [[`${Math.round(R.ASSIST_TURN_RATE_DEG)}°/s`, ['ASSIST_TURN_RATE_DEG']]]
        : R.ASSIST_RANGE < sim.D ? [[`${Math.round(R.ASSIST_RANGE)} m range`, ['ASSIST_RANGE']]] : [])];
    readout(ctx, parts, 10, box.h - 10, env, 11);
  },
};

/** Top view: a throw at `power` aimed `off` degrees beside an enemy 14 m away, bent by the aim
 *  assist the way _bend does it: slower balls bend less per metre (curveShare). */
function curveShot(R, power, off) {
  return memo(`curve|${power}|${off}|${keyOf(R, ['THROW_SPEED_MIN', 'THROW_SPEED_MAX', 'PLAYER_RADIUS', 'BALL_RADIUS',
    'ASSIST_TURN_RATE_DEG', 'SLOW_BALL_CURVE'])}`, () => {
    const D = 14;
    const speed = throwSpeed(R, power);
    let vx = Math.cos(off * DEG) * speed;
    let vz = Math.sin(off * DEG) * speed;
    let [x, z] = [0, 0];
    let turn = off > 0 ? R.ASSIST_TURN_RATE_DEG * DEG * curveShare(R, speed) : 0;
    const pts = [[0, x, z]];
    const dt = 1 / 240;
    let t = 0;
    let end = 'miss';
    while (t < 3) {
      if (turn) {
        const ex = D - x;
        const ez = -z;
        if ((ex * vx + ez * vz) / (Math.hypot(ex, ez) * speed) < 0.3) turn = 0;
        else {
          const cur = Math.atan2(vz, vx);
          let diff = Math.atan2(ez, ex) - cur;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const a = cur + clamp(diff, -turn * dt, turn * dt);
          vx = Math.cos(a) * speed;
          vz = Math.sin(a) * speed;
        }
      }
      x += vx * dt;
      z += vz * dt;
      t += dt;
      pts.push([t, x, z]);
      if (Math.hypot(x - D, z) <= R.PLAYER_RADIUS + R.BALL_RADIUS) {
        end = 'hit';
        break;
      }
      if (x > D + 2 || Math.abs(z) > 5) break;
    }
    return { pts, end, flight: t, speed, D, bent: off - Math.atan2(vz, vx) / DEG };
  });
}

SCENES.curve = {
  title: 'Slow balls curve less',
  caption: 'A tap and a full-power throw, both aimed a few degrees beside an enemy 14 m away, inside the assist angle. The aim assist bends each toward them; the slow one bends less.',
  lanes: 'cols',
  prepare(A, B) {
    // The same miss for both lanes, small enough that both lobbies' assist angles cover it.
    const cover = Math.min(...[A, B].map((R) => R.ASSIST_CONE_DEG + R.ASSIST_SLACK_DEG));
    return { off: Math.round(Math.max(0, Math.min(9, cover - 0.5))) };
  },
  period(A, B, env) {
    const off = this.prepare(A, B).off;
    return 0.3 + Math.max(...[A, B].flatMap((R) => [curveShot(R, 0, off).flight, curveShot(R, 1, off).flight])) + 1.2;
  },
  lane(ctx, box, t, R, env) {
    const off = env.shared.off;
    const tap = curveShot(R, 0, off);
    const full = curveShot(R, 1, off);
    const m = topMap(box, -0.8, 15.5, -4.2, 4.2);
    const o = [m.sx(0), m.sy(0)];
    line(ctx, o[0], o[1], m.sx(15.2 * Math.cos(off * DEG)), m.sy(15.2 * Math.sin(off * DEG)), COL.text, 1, [5, 4]);
    circle(ctx, o[0], o[1], 0.42 * m.s, env.mine ? COL.red : COL.dim);
    circle(ctx, m.sx(tap.D), m.sy(0), R.PLAYER_RADIUS * m.s, env.mine ? COL.blue : COL.dim);
    const k = t - 0.3;
    [[tap, 'tap', 'rgba(159,232,255,0.65)', '#9fe8ff'], [full, 'full', env.mine ? 'rgba(255,210,63,0.6)' : 'rgba(150,160,180,0.5)', env.mine ? COL.ball : '#b9c0cf']]
      .forEach(([sim, name, trail, color]) => {
        path(ctx, sim.pts.map((q) => [m.sx(q[1]), m.sy(q[2])]), trail, 1, [2, 4]);
        if (k < 0) return;
        const p = at(sim, k);
        path(ctx, sim.pts.filter((q) => q[0] <= k).map((q) => [m.sx(q[1]), m.sy(q[2])]), trail, 2);
        if (!p.done || k - sim.flight < 0.3) ball(ctx, m.sx(p.x), m.sy(p.y), Math.max(3, R.BALL_RADIUS * m.s), color);
        if (!p.done) txt(ctx, name, m.sx(p.x), m.sy(p.y) - 9, { size: 10, color: COL.dim, align: 'center' });
        else if (k - sim.flight < 0.9) txt(ctx, sim.end === 'hit' ? 'hit' : 'miss', m.sx(p.x), m.sy(p.y) - 12, { color: sim.end === 'hit' ? COL.bad : COL.dim, size: 12, weight: 800, align: 'center' });
      });
    const parts = off <= 0 ? [['No aim assist here, so nothing bends.', ['ASSIST_CONE_DEG']]]
      : [[`${off}° off: tap `], [`bends ${r1(tap.bent)}°`, ['SLOW_BALL_CURVE']], [' · full power '],
        [`bends ${r1(full.bent)}°`, ['ASSIST_TURN_RATE_DEG']], [' · slow-ball curve '], [`${r2(R.SLOW_BALL_CURVE)}×`, ['SLOW_BALL_CURVE']]];
    readout(ctx, parts, 10, box.h - 10, env, 11);
  },
};

const ARRIVALS = [-0.012, 0.04, 0.11, 0.2, 0.31, 0.45];     // when test balls reach the defender, after the press

SCENES.defence = {
  title: 'Timing window',
  caption: 'You press at 0. Balls arriving at different moments around the press, at ¼ speed: inside the window you\'re safe; the first part is perfect. The grace counts a ball that got there a hair before your press; the marker shows when you can press again after a miss.',
  lanes: 'rows',
  kind(env) {
    const k = env.focus.split('_')[0];
    return ['DODGE', 'CATCH', 'DEFLECT'].includes(k) ? k : 'CATCH';
  },
  prepare(A, B, env) {
    const K = this.kind(env);
    return {
      span: Math.max(0.55, ...[A, B].map((R) => (R[`${K}_WINDOW`] + R[`${K}_RECOVERY`]) * Math.max(1, R.LOCKOUT_SCALE) + 0.08)),
      pre: Math.max(0.05, ...[A, B].map((R) => R.PRESS_GRACE + 0.03)),
    };
  },
  period(A, B, env) {
    return this.prepare(A, B, env).span * 4 + 1.2;
  },
  lane(ctx, box, t, R, env) {
    const K = this.kind(env);
    const verb = { DODGE: 'DODGED', CATCH: 'CAUGHT', DEFLECT: 'DEFLECTED' }[K];
    const win = R[`${K}_WINDOW`];
    const perf = R[`${K}_PERFECT`];
    const rec = R[`${K}_RECOVERY`];
    const grace = R.PRESS_GRACE;
    const lock = (win + rec) * R.LOCKOUT_SCALE;
    const { span, pre } = env.shared;
    const x0 = 64;
    const x1 = box.w - 16;
    const sx = (s) => x0 + ((s + pre) / (span + pre)) * (x1 - x0);
    const y = box.h * 0.56;
    if (grace > 0) rect(ctx, sx(-grace), y - 7, sx(0) - sx(-grace), 14, 'rgba(255,201,64,0.4)');
    rect(ctx, sx(0), y - 7, sx(perf) - sx(0), 14, 'rgba(255,201,64,0.85)');
    rect(ctx, sx(perf), y - 7, sx(win) - sx(perf), 14, 'rgba(93,255,155,0.55)');
    rect(ctx, sx(win), y - 7, sx(win + rec) - sx(win), 14, 'rgba(255,107,107,0.28)');
    txt(ctx, 'press', sx(0), y + 22, { size: 10, color: COL.dim, align: 'center' });
    line(ctx, sx(0), y - 12, sx(0), y + 12, COL.text, 2);
    if (perf > 0.02) txt(ctx, 'perfect', (sx(0) + sx(perf)) / 2, y + 22, { size: 10, color: COL.gold, align: 'center' });
    txt(ctx, K === 'DODGE' ? "can't be hit" : 'window', (sx(perf) + sx(win)) / 2, y + 22, { size: 10, color: COL.good, align: 'center' });
    if (rec > 0.03) txt(ctx, 'recovery', (sx(win) + sx(win + rec)) / 2, y + 22, { size: 10, color: COL.bad, align: 'center' });
    const lockHot = env.focus === 'LOCKOUT_SCALE';
    line(ctx, sx(lock), y - 10, sx(lock), y + 10, lockHot ? COL.gold : COL.text, lockHot ? 3 : 2, [3, 2]);    // can press again (the top line says when)
    const now = t / 4 - pre;      // quarter speed, starting just before the press
    if (now <= span) line(ctx, sx(now), y - 18, sx(now), y + 12, 'rgba(255,255,255,0.6)', 1.5);
    for (const a of ARRIVALS) {
      if (a > span || a < -pre || now < a) continue;
      const outcome = a < -grace ? 'HIT' : a <= perf ? 'PERFECT' : a <= win ? verb : 'HIT';
      const color = outcome === 'PERFECT' ? COL.gold : outcome === 'HIT' ? COL.bad : COL.good;
      ball(ctx, sx(a), y - 16, 4, color);
      txt(ctx, outcome, sx(a), y - 26, { size: 10, weight: 800, color, align: 'center' });
    }
    txt(ctx, `${(span).toFixed(2)} s`, x1, y + 22, { size: 10, color: COL.dim, align: 'right' });
    readout(ctx, [['Press grace '], [`${grace.toFixed(3)} s`, ['PRESS_GRACE']], [' before the press · after a miss you can press again after '],
      [`${lock.toFixed(2)} s`, ['LOCKOUT_SCALE']], [` (lockout ×${R.LOCKOUT_SCALE.toFixed(2)})`, ['LOCKOUT_SCALE']]], 12, 30, env, 11);
    readout(ctx, [
      ['Costs '], [`${R[`${K}_COST`]} stamina`, [`${K}_COST`]], [' ('], [`${R[`${K}_PERFECT_COST`]} if perfect`, [`${K}_PERFECT_COST`]],
      ['). Window '], [`${win.toFixed(2)} s`, [`${K}_WINDOW`]], [', perfect zone '], [`${perf.toFixed(2)} s`, [`${K}_PERFECT`]],
      [', recovery '], [`${rec.toFixed(2)} s`, [`${K}_RECOVERY`]], ['.'],
    ], 12, box.h - 9, env);
  },
};

/** A player steps out of a ball's way, seen from above. The server only learns where they are
 *  about 0.1 s after their screen (the view delay plus the trip up), so its idea of them lags. */
function sidestepShot(R) {
  return memo(`side|${keyOf(R, ['THROW_SPEED_MAX', 'PLAYER_RADIUS', 'BALL_RADIUS', 'WALK_SPEED', 'INTERP_DELAY'])}`, () => {
    const D = 12;
    const arrive = D / R.THROW_SPEED_MAX;          // when the ball reaches them
    const step = arrive - 0.2;                      // they start walking aside 0.2 s before (on their screen)
    const behind = R.INTERP_DELAY + 0.03;           // server time minus their screen's time
    const at = (tt) => Math.max(0, tt - step) * R.WALK_SPEED;   // their sideways offset at screen time tt
    const reach = R.PLAYER_RADIUS + R.BALL_RADIUS;
    return { D, arrive, step, behind, at, reach, screen: at(arrive), server: at(arrive - behind) };
  });
}

SCENES.sidestep = {
  title: 'Stepping out of the way',
  caption: 'A full-power ball at someone 12 m away, who walks aside 0.2 s before it gets there. Solid: where they are on their own screen. Ghost: where the server thinks they are, about 0.1 s behind. Shown at ¼ speed.',
  lanes: 'cols',
  period(A, B) {
    return Math.max(sidestepShot(A).arrive, sidestepShot(B).arrive) * 4 + 1.6;
  },
  lane(ctx, box, t, R, env) {
    const sim = sidestepShot(R);
    const m = topMap(box, -1, sim.D + 1.5, -1.2, 2.2);
    const k = Math.min(t / 4, sim.arrive);         // game time, quarter speed, stops at arrival
    const reached = t / 4 >= sim.arrive;
    const screenZ = sim.at(k);
    const serverZ = sim.at(k - sim.behind);
    line(ctx, m.sx(0), m.sy(0), m.sx(sim.D), m.sy(0), COL.line, 1, [5, 4]);
    circle(ctx, m.sx(sim.D), m.sy(serverZ), R.PLAYER_RADIUS * m.s, null, env.mine ? 'rgba(63,169,255,0.6)' : 'rgba(150,160,180,0.5)', 1.5);
    circle(ctx, m.sx(sim.D), m.sy(screenZ), R.PLAYER_RADIUS * m.s, env.mine ? COL.blue : COL.dim);
    txt(ctx, 'server', m.sx(sim.D) + R.PLAYER_RADIUS * m.s + 4, m.sy(serverZ) + 4, { size: 10, color: COL.dim });
    ball(ctx, m.sx((k / sim.arrive) * sim.D), m.sy(0), Math.max(3, R.BALL_RADIUS * m.s), env.mine ? COL.ball : '#b9c0cf');
    const clearOnScreen = sim.screen > sim.reach;
    const serverHit = sim.server <= sim.reach;
    const hit = R.SIDESTEP_COMP ? !clearOnScreen : serverHit;
    if (reached) txt(ctx, hit ? 'HIT' : 'MISSED YOU', m.sx(sim.D), m.sy(screenZ) - R.PLAYER_RADIUS * m.s - 8, { size: 13, weight: 800, color: hit ? COL.bad : COL.good, align: 'center' });
    readout(ctx, [['Your screen: '], [`${r1(Math.max(0, sim.screen - sim.reach))} m clear`, []], [' · server: '],
      [serverHit ? 'in the way' : 'clear', ['INTERP_DELAY']], [' · compensation '], [R.SIDESTEP_COMP ? 'on' : 'off', ['SIDESTEP_COMP']]], 10, box.h - 10, env, 11);
  },
};

SCENES.dash = {
  title: 'The dodge dash, seen from above',
  caption: 'A ball comes in; the dodge dashes you sideways (shown at ⅓ speed). The ball passes through the afterimage you leave behind.',
  lanes: 'cols',
  period: () => 3.2,
  lane(ctx, box, t, R, env) {
    const m = topMap(box, -6.5, 3.5, -1.5, 4.8);
    const slow = t / 3;                  // seconds of game time
    const press = 0.25;
    const dash = clamp(slow - press, 0, R.DODGE_DASH_TIME);
    const dist = R.DODGE_DASH_SPEED * R.DODGE_DASH_TIME;
    const z = R.DODGE_DASH_SPEED * dash;
    if (slow >= press) circle(ctx, m.sx(0), m.sy(0), 0.42 * m.s, 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.35)', 1);
    line(ctx, m.sx(0), m.sy(0), m.sx(0), m.sy(dist), COL.line, 1, [4, 4]);
    txt(ctx, `${r1(dist)} m`, m.sx(0) + 10, m.sy(dist / 2), { size: 12, weight: 800, color: env.mine ? COL.gold : COL.dim });
    circle(ctx, m.sx(0), m.sy(z), 0.42 * m.s, env.mine ? COL.blue : COL.dim);
    const bx = -6 + slow * 18;
    if (bx < 3.5) ball(ctx, m.sx(bx), m.sy(0), Math.max(3, R.BALL_RADIUS * m.s), env.mine ? COL.ball : '#b9c0cf');
    if (slow > 0.34 && slow < 0.6) txt(ctx, 'dodged', m.sx(0), m.sy(0) + 22, { size: 12, weight: 800, color: COL.good, align: 'center' });
    readout(ctx, [['Dash '], [`${R.DODGE_DASH_TIME.toFixed(2)} s`, ['DODGE_DASH_TIME']], [' at '], [`${r1(R.DODGE_DASH_SPEED)} m/s`, ['DODGE_DASH_SPEED']],
      [` = ${r1(dist)} m sideways`]], 10, box.h - 10, env, 11);
  },
};

SCENES.reach = {
  title: 'Bodies and reach',
  caption: 'Side view of a player. A ball touching the inner outline hits; a catch or deflect already grabs it at the outer one. The marker is where assist and bots aim.',
  lanes: 'cols',
  period: () => 3,
  prepare(A, B) {
    return { top: Math.max(2.3, ...[A, B].map((R) => CAPSULE[1] + R.PLAYER_RADIUS + R.CATCH_REACH + 0.15)) };
  },
  lane(ctx, box, t, R, env) {
    const top = env.shared.top;
    const s = Math.min((box.h - 50) / top, (box.w - 40) / 4.2);
    const ground = box.h - 28;
    const cx = box.w * 0.34;
    const sx = (x) => cx + x * s;
    const sy = (y) => ground - y * s;
    line(ctx, 10, ground, box.w - 10, ground, COL.line, 2);
    figure(ctx, cx, ground, s, env.mine ? COL.blue : COL.dim, { dir: 1, arms: 'out' });
    const pr = R.PLAYER_RADIUS;
    const reach = pr + R.CATCH_REACH;
    ctx.lineWidth = 1.5;
    for (const [rad, color, dash] of [[pr, env.mine ? COL.gold : COL.text, []], [reach, env.mine ? 'rgba(93,255,155,0.8)' : 'rgba(93,255,155,0.5)', [5, 4]]]) {
      ctx.strokeStyle = color;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.arc(sx(0), sy(CAPSULE[1]), rad * s, Math.PI, 0);
      ctx.lineTo(sx(rad), sy(CAPSULE[0]));
      ctx.arc(sx(0), sy(CAPSULE[0]), rad * s, 0, Math.PI);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }
    line(ctx, sx(-0.5), sy(R.CHEST_HEIGHT), sx(0.5), sy(R.CHEST_HEIGHT), COL.bad, 2);
    txt(ctx, 'aim height', sx(-0.55), sy(R.CHEST_HEIGHT) + 4, { size: 10, color: COL.bad, align: 'right' });
    const stopAt = reach + R.BALL_RADIUS;
    const k = (t % 3) / 3;
    const bx = Math.max(stopAt, 4 - k * 8);
    ball(ctx, sx(bx), sy(R.CHEST_HEIGHT), Math.max(3, R.BALL_RADIUS * s), env.mine ? COL.ball : '#b9c0cf');
    if (bx === stopAt) txt(ctx, 'caught here', sx(bx), sy(R.CHEST_HEIGHT) - R.BALL_RADIUS * s - 8, { size: 11, weight: 800, color: COL.good, align: 'center' });
    readout(ctx, [['Body '], [`${R.PLAYER_RADIUS.toFixed(2)} m`, ['PLAYER_RADIUS']], [', ball '], [`${R.BALL_RADIUS.toFixed(2)} m`, ['BALL_RADIUS']],
      [', reach +'], [`${R.CATCH_REACH.toFixed(2)} m`, ['CATCH_REACH']], [', aim '], [`${R.CHEST_HEIGHT.toFixed(2)} m`, ['CHEST_HEIGHT']]], 10, box.h - 9, env, 11);
  },
};

SCENES.move = {
  title: 'Movement',
  caption: 'Three players start together and move for 2 seconds: running, winding up a throw, and holding a catch or deflect.',
  lanes: 'rows',
  period: () => 3,
  prepare(A, B) {
    return { far: Math.max(A.WALK_SPEED, B.WALK_SPEED, A.CHARGE_WALK_SPEED, B.CHARGE_WALK_SPEED, A.DEFEND_WALK_SPEED, B.DEFEND_WALK_SPEED) * 2 };
  },
  lane(ctx, box, t, R, env) {
    const k = Math.min(t, 2);
    const x0 = 96;
    const x1 = box.w - 70;
    const sx = (m) => x0 + (m / env.shared.far) * (x1 - x0);
    const rows = [['running', 'WALK_SPEED'], ['charging', 'CHARGE_WALK_SPEED'], ['catching', 'DEFEND_WALK_SPEED']];
    rows.forEach(([name, key], i) => {
      const y = 30 + i * ((box.h - 40) / 3);
      const hot = env.focus === key;
      txt(ctx, name, 14, y + 4, { size: 11, color: hot ? (env.mine ? COL.gold : COL.text) : COL.dim, weight: hot ? 800 : 500 });
      line(ctx, x0, y, x1, y, COL.grid, 1);
      for (let m = 0; m <= env.shared.far; m += 2) line(ctx, sx(m), y - 3, sx(m), y + 3, COL.line, 1);
      circle(ctx, sx(R[key] * k), y, 6, hot && env.mine ? COL.gold : env.mine ? '#d5dbe8' : COL.dim);
      txt(ctx, `${r1(R[key])} m/s`, sx(R[key] * k) + 12, y + 4, { size: 11, color: hot && env.mine ? COL.gold : COL.dim, weight: hot ? 800 : 500 });
    });
  },
};

SCENES.stamina = {
  title: 'Stamina',
  caption: 'Stamina over 8 seconds: a full-power throw, then a catch, then rest. Regeneration waits for the delay after each spend.',
  draw(ctx, box, t, A, B, env) {
    const curve = (R) => memo(`st|${keyOf(R, ['MAX_STAMINA', 'STAMINA_REGEN', 'STAMINA_REGEN_DELAY', 'THROW_COST_MAX', 'CATCH_COST', 'CHARGE_TIME'])}`, () => {
      const pts = [];
      let st = R.MAX_STAMINA;
      let last = -99;
      const spends = [[0.5 + R.CHARGE_TIME, R.THROW_COST_MAX], [1.2 + R.CHARGE_TIME, R.CATCH_COST]];
      let full = null;
      for (let s = 0; s <= 8; s += 0.02) {
        for (const sp of spends) {
          if (Math.abs(s - sp[0]) < 0.01) {
            st = Math.max(0, st - sp[1]);
            last = s;
          }
        }
        const charging = s >= 0.5 && s < 0.5 + R.CHARGE_TIME;
        if (!charging && s - last >= R.STAMINA_REGEN_DELAY) st = Math.min(R.MAX_STAMINA, st + R.STAMINA_REGEN * 0.02);
        if (full === null && s > spends[1][0] && st >= R.MAX_STAMINA) full = s - spends[1][0];
        pts.push([s, st]);
      }
      return { pts, full };
    });
    const top = Math.max(A.MAX_STAMINA, B.MAX_STAMINA) * 1.08;
    const x0 = 46;
    const x1 = box.w - 16;
    const y0 = box.h - 40;
    const y1 = 30;
    const sx = (s) => x0 + (s / 8) * (x1 - x0);
    const sy = (v) => y0 - (v / top) * (y0 - y1);
    for (let s = 0; s <= 8; s++) {
      line(ctx, sx(s), y0, sx(s), y1, COL.grid, 1);
      txt(ctx, `${s}s`, sx(s), y0 + 14, { size: 10, color: COL.dim, align: 'center' });
    }
    txt(ctx, String(Math.round(top / 1.08)), x0 - 6, sy(top / 1.08) + 4, { size: 10, color: COL.dim, align: 'right' });
    line(ctx, x0, y0, x1, y0, COL.line, 1.5);
    const a = curve(A);
    const b = curve(B);
    path(ctx, a.pts.map(([s, v]) => [sx(s), sy(v)]), COL.dim, 2, [5, 4]);
    path(ctx, b.pts.map(([s, v]) => [sx(s), sy(v)]), COL.gold, 2.5);
    const now = (t % 9);
    if (now <= 8) {
      const v = b.pts[Math.min(b.pts.length - 1, Math.round(now / 0.02))][1];
      line(ctx, sx(now), y0, sx(now), y1, 'rgba(255,255,255,0.3)', 1);
      circle(ctx, sx(now), sy(v), 5, COL.gold);
    }
    txt(ctx, 'throw', sx(0.5 + B.CHARGE_TIME), y1 - 6, { size: 10, color: COL.dim, align: 'center' });
    txt(ctx, 'catch', sx(1.2 + B.CHARGE_TIME), y1 - 6, { size: 10, color: COL.dim, align: 'center' });
    const env2 = { ...env, mine: true };
    readout(ctx, [['This lobby: pool '], [`${B.MAX_STAMINA}`, ['MAX_STAMINA']], [', regains '], [`${r1(B.STAMINA_REGEN)}/s`, ['STAMINA_REGEN']],
      [' after '], [`${B.STAMINA_REGEN_DELAY.toFixed(2)} s`, ['STAMINA_REGEN_DELAY']], [b.full !== null ? `; full again ${r1(b.full)} s after the catch` : '; not full again within 8 s'],
      ['   (default: dashed)']], 12, box.h - 9, env2);
  },
};

SCENES.damage = {
  title: 'Damage',
  caption: 'Damage by ball speed, with a tap and a full charge marked. Fast deflect rallies hit the cap.',
  draw(ctx, box, t, A, B, env) {
    const xmax = Math.max(60, A.BALL_SPEED_CAP, B.BALL_SPEED_CAP, A.THROW_SPEED_MAX, B.THROW_SPEED_MAX);
    const ymax = Math.max(A.DAMAGE_MAX, B.DAMAGE_MAX) * 1.12;
    const x0 = 44;
    const x1 = box.w * 0.62;
    const y0 = box.h - 34;
    const y1 = 22;
    const sx = (v) => x0 + (v / xmax) * (x1 - x0);
    const sy = (d) => y0 - (d / ymax) * (y0 - y1);
    for (let v = 0; v <= xmax; v += 10) {
      line(ctx, sx(v), y0, sx(v), y1, COL.grid, 1);
      txt(ctx, `${v}`, sx(v), y0 + 13, { size: 10, color: COL.dim, align: 'center' });
    }
    txt(ctx, 'm/s', x1 + 4, y0 + 13, { size: 10, color: COL.dim });
    for (const d of [0, Math.round(ymax / 2), Math.round(ymax / 1.12)]) txt(ctx, `${d}`, x0 - 6, sy(d) + 4, { size: 10, color: COL.dim, align: 'right' });
    line(ctx, x0, y0, x1, y0, COL.line, 1.5);
    const curve = (R) => Array.from({ length: 121 }, (_, i) => [sx((i / 120) * xmax), sy(damageFor(R, (i / 120) * xmax))]);
    path(ctx, curve(A), COL.dim, 2, [5, 4]);
    path(ctx, curve(B), COL.gold, 2.5);
    for (const [R, color] of [[A, COL.dim], [B, COL.gold]]) {
      for (const p of [0, 1]) circle(ctx, sx(throwSpeed(R, p)), sy(damageFor(R, throwSpeed(R, p))), 4, color);
    }
    const k = (Math.sin(t * 1.4) + 1) / 2;
    const v = throwSpeed(B, k);
    circle(ctx, sx(v), sy(damageFor(B, v)), 6, null, COL.text, 2);
    const hits = (R, p) => Math.ceil(R.MAX_HP / Math.max(1, Math.round(damageFor(R, throwSpeed(R, p)))));
    let y = 44;
    for (const [R, mine, label] of [[A, false, 'DEFAULT'], [B, true, 'THIS LOBBY']]) {
      const e = { ...env, mine };
      const cx = x1 + 34;
      txt(ctx, label, cx, y, { size: 10, weight: 800, color: mine ? COL.gold : COL.dim });
      readout(ctx, [['Tap '], [`${Math.round(damageFor(R, throwSpeed(R, 0)))} dmg`, ['DAMAGE_MIN']], [` (${hits(R, 0)} hits to knock out)`]], cx, y + 17, e);
      readout(ctx, [['Full '], [`${Math.round(damageFor(R, throwSpeed(R, 1)))} dmg`, ['DAMAGE_PER_SPEED']], [` (${hits(R, 1)} hits)`]], cx, y + 34, e);
      readout(ctx, [['Cap '], [`${Math.round(R.DAMAGE_MAX)}`, ['DAMAGE_MAX']], [' · health '], [`${R.MAX_HP}`, ['MAX_HP']]], cx, y + 51, e);
      y += 76;
    }
  },
};

SCENES.rally = {
  title: 'Deflect rallies',
  caption: 'A full-power throw deflected back and forth: each deflect speeds it up until the cap. Damage on top of each bar.',
  draw(ctx, box, t, A, B, env) {
    const series = (R) => {
      const out = [R.THROW_SPEED_MAX];
      for (let i = 0; i < 8; i++) out.push(Math.min(out[out.length - 1] * R.DEFLECT_SPEEDUP, R.BALL_SPEED_CAP));
      return out;
    };
    const a = series(A);
    const b = series(B);
    const top = Math.max(...a, ...b) * 1.15;
    const x0 = 44;
    const x1 = box.w - 16;
    const y0 = box.h - 36;
    const y1 = 22;
    const n = a.length;
    const bw = (x1 - x0) / n;
    const grow = Math.min(1, (t % 4) / 2.2);
    for (let i = 0; i < n; i++) {
      const shown = clamp(grow * n - i, 0, 1);
      const x = x0 + i * bw;
      const ha = (a[i] / top) * (y0 - y1);
      const hb = (b[i] / top) * (y0 - y1) * shown;
      rect(ctx, x + bw * 0.12, y0 - ha, bw * 0.34, ha, 'rgba(140,150,170,0.45)');
      rect(ctx, x + bw * 0.5, y0 - hb, bw * 0.34, hb, COL.gold);
      if (shown >= 1) txt(ctx, `${Math.round(damageFor(B, b[i]))}`, x + bw * 0.67, y0 - hb - 5, { size: 10, color: COL.gold, align: 'center' });
      txt(ctx, i ? `×${i}` : 'throw', x + bw / 2, y0 + 13, { size: 10, color: COL.dim, align: 'center' });
    }
    const capY = y0 - (B.BALL_SPEED_CAP / top) * (y0 - y1);
    line(ctx, x0, capY, x1, capY, COL.bad, 1, [4, 4]);
    txt(ctx, `cap ${Math.round(B.BALL_SPEED_CAP)} m/s`, x0 - 40, capY - 4, { size: 10, color: COL.bad });
    const hitsCap = b.findIndex((v) => v >= B.BALL_SPEED_CAP);
    readout(ctx, [['This lobby: each deflect ×'], [`${B.DEFLECT_SPEEDUP.toFixed(2)}`, ['DEFLECT_SPEEDUP']],
      [hitsCap > 0 ? `, reaching the ${Math.round(B.BALL_SPEED_CAP)} m/s cap after ${hitsCap} deflect${hitsCap === 1 ? '' : 's'}` : ''],
      ['   (grey: default, gold: this lobby)']], 12, 16, { ...env, mine: true });
  },
};

SCENES.court = {
  title: 'Court size',
  caption: 'The court from above, sized for the biggest team (cycling through 2, 4 and 6 per team). Dashed: default size. Light lines: where teams line up.',
  draw(ctx, box, t, A, B, env) {
    const n = [2, 4, 6][Math.floor(t / 1.6) % 3];
    const size = (R) => [R.COURT_HALF_LENGTH_BASE + R.COURT_HALF_LENGTH_PER_PLAYER * n, R.COURT_HALF_WIDTH_BASE + R.COURT_HALF_WIDTH_PER_PLAYER * n];
    const [la, wa] = size(A);
    const [lb, wb] = size(B);
    const L = Math.max(la, lb);
    const W = Math.max(wa, wb);
    const area = { w: box.w * 0.62, h: box.h };
    const m = topMap(area, -L, L, -W, W, 16);
    rect(ctx, m.sx(-lb), m.sy(wb), 2 * lb * m.s, 2 * wb * m.s, 'rgba(255,255,255,0.03)');
    rect(ctx, m.sx(-lb), m.sy(wb), lb * m.s, 2 * wb * m.s, 'rgba(255,77,94,0.10)');
    rect(ctx, m.sx(0), m.sy(wb), lb * m.s, 2 * wb * m.s, 'rgba(63,169,255,0.10)');
    rect(ctx, m.sx(-B.CENTER_GAP), m.sy(wb), 2 * B.CENTER_GAP * m.s, 2 * wb * m.s, 'rgba(0,0,0,0.45)');
    ctx.setLineDash([5, 4]);
    rect(ctx, m.sx(-la), m.sy(wa), 2 * la * m.s, 2 * wa * m.s, null, COL.dim, 1.5);
    ctx.setLineDash([]);
    rect(ctx, m.sx(-lb), m.sy(wb), 2 * lb * m.s, 2 * wb * m.s, null, COL.gold, 2);
    line(ctx, m.sx(0), m.sy(wb), m.sx(0), m.sy(-wb), COL.text, 1.5);
    for (const side of [-1, 1]) {
      const x = side * lb * B.SPAWN_FRACTION;
      line(ctx, m.sx(x), m.sy(wb), m.sx(x), m.sy(-wb), 'rgba(255,255,255,0.35)', 1, [2, 3]);
      for (let i = 0; i < n; i++) {
        const spacing = Math.min(2.5, Math.max(0, 2 * wb - 3) / Math.max(1, n - 1));
        circle(ctx, m.sx(x), m.sy((i - (n - 1) / 2) * spacing), Math.max(2.5, 0.42 * m.s), side < 0 ? COL.red : COL.blue);
      }
    }
    const cx = area.w + 18;
    txt(ctx, `${n} PER TEAM`, cx, 30, { size: 11, weight: 800, color: COL.text });
    const e = { ...env, mine: true };
    readout(ctx, [['This lobby: '], [`${r1(2 * lb)} × ${r1(2 * wb)} m`, ['COURT_HALF_LENGTH_BASE', 'COURT_HALF_LENGTH_PER_PLAYER', 'COURT_HALF_WIDTH_BASE', 'COURT_HALF_WIDTH_PER_PLAYER']]], cx, 52, e);
    readout(ctx, [[`Default: ${r1(2 * la)} × ${r1(2 * wa)} m`]], cx, 70, { ...env, mine: false });
    readout(ctx, [['No-go strip: '], [`${r1(B.CENTER_GAP)} m`, ['CENTER_GAP']], [' each side']], cx, 96, e);
    readout(ctx, [['Line-up at '], [`${Math.round(B.SPAWN_FRACTION * 100)}%`, ['SPAWN_FRACTION']], [' of each half']], cx, 114, e);
    const sizes = [1, 2, 4, 6, 8].map((k) => `${k}: ${r1(2 * (B.COURT_HALF_LENGTH_BASE + B.COURT_HALF_LENGTH_PER_PLAYER * k))}×${r1(2 * (B.COURT_HALF_WIDTH_BASE + B.COURT_HALF_WIDTH_PER_PLAYER * k))}`);
    txt(ctx, 'Per team size (m):', cx, 142, { size: 11, color: COL.dim });
    sizes.forEach((s, i) => txt(ctx, s, cx, 158 + i * 15, { size: 11, color: '#d5dbe8' }));
  },
};

SCENES.cash = {
  title: 'Cash and revives',
  caption: 'What each play earns (bars), and what revives cost a team within one round. Grey: default, gold: this lobby.',
  draw(ctx, box, t, A, B, env) {
    const rows = [['Hit', 'CASH_HIT'], ['Knockout bonus', 'CASH_KO'], ['Catch', 'CASH_CATCH'], ['Perfect catch', 'CASH_PERFECT_CATCH'],
      ['Deflect', 'CASH_DEFLECT'], ['Perfect deflect', 'CASH_PERFECT_DEFLECT'], ['Perfect dodge', 'CASH_PERFECT_DODGE'], ['Rally bonus (each)', 'CASH_RALLY_BONUS']];
    const top = Math.max(1, ...rows.flatMap(([, k]) => [A[k], B[k]]));
    const x0 = 128;
    const x1 = box.w * 0.55;
    const rowH = (box.h - 24) / rows.length;
    rows.forEach(([name, key], i) => {
      const y = 14 + i * rowH;
      const hot = env.focus === key;
      txt(ctx, name, x0 - 8, y + rowH * 0.62, { size: 11, align: 'right', color: hot ? COL.gold : COL.dim, weight: hot ? 800 : 500 });
      rect(ctx, x0, y + rowH * 0.18, ((x1 - x0) * A[key]) / top, rowH * 0.22, 'rgba(140,150,170,0.5)');
      rect(ctx, x0, y + rowH * 0.44, ((x1 - x0) * B[key]) / top, rowH * 0.36, hot ? COL.gold : 'rgba(255,201,64,0.75)');
      txt(ctx, String(B[key]), x0 + ((x1 - x0) * B[key]) / top + 5, y + rowH * 0.74, { size: 10, color: COL.gold });
    });
    const cx = x1 + 40;
    const reviveKeys = ['REVIVE_COST', 'REVIVE_COST_STEP'];
    txt(ctx, 'REVIVE PRICES IN A ROUND', cx, 26, { size: 10, weight: 800, color: COL.text });
    const prices = (R) => [0, 1, 2, 3].map((k) => R.REVIVE_COST + R.REVIVE_COST_STEP * k);
    const pa = prices(A);
    const pb = prices(B);
    const ptop = Math.max(1, ...pa, ...pb);
    const bw = (box.w - cx - 20) / 4;
    const by = box.h - 90;
    pb.forEach((p, i) => {
      const x = cx + i * bw;
      const ha = ((by - 44) * pa[i]) / ptop;
      const hb = ((by - 44) * p) / ptop;
      rect(ctx, x + bw * 0.1, by - ha, bw * 0.3, ha, 'rgba(140,150,170,0.5)');
      rect(ctx, x + bw * 0.42, by - hb, bw * 0.38, hb, reviveKeys.includes(env.focus) ? COL.gold : 'rgba(255,201,64,0.75)');
      txt(ctx, String(p), x + bw * 0.61, by - hb - 4, { size: 10, color: COL.gold, align: 'center' });
      txt(ctx, ['1st', '2nd', '3rd', '4th'][i], x + bw / 2, by + 13, { size: 10, color: COL.dim, align: 'center' });
    });
    const e = { ...env, mine: true };
    const hits = B.CASH_HIT > 0 ? Math.ceil(B.REVIVE_COST / B.CASH_HIT) : '∞';
    readout(ctx, [['First revive ≈ '], [`${hits} hits`, ['REVIVE_COST', 'CASH_HIT']]], cx, by + 32, e, 11);
    readout(ctx, [['Comes back with '], [`${Math.min(B.REVIVE_HP, B.MAX_HP)} HP`, ['REVIVE_HP']], [', protected '], [`${r1(B.REVIVE_INVULN)} s`, ['REVIVE_INVULN']]], cx, by + 48, e, 11);
    readout(ctx, [['Cash '], [B.CASH_RESETS_EACH_ROUND ? 'resets every round' : 'carries over between rounds (prices don\'t)', ['CASH_RESETS_EACH_ROUND']]], cx, by + 64, e, 11);
    readout(ctx, [['Cash is '], [B.TEAM_CASH ? 'one pot per team: anyone can revive with it' : 'everyone\'s own', ['TEAM_CASH']]], cx, by + 80, e, 11);
  },
};

SCENES.rounds = {
  title: 'Rounds and the match',
  caption: 'One round from start to finish (segments not to scale: the round itself is much longer), and how many round wins take the match.',
  lanes: 'rows',
  period: () => 5,
  lane(ctx, box, t, R, env) {
    const segs = [['countdown', R.COUNTDOWN_TIME, ['COUNTDOWN_TIME', 'MATCH_START_EXTRA'], 'rgba(255,201,64,0.55)'],
      ['round: up to', R.ROUND_TIME_LIMIT, ['ROUND_TIME_LIMIT'], 'rgba(93,255,155,0.45)'], ['result', R.ROUND_OVER_TIME, ['ROUND_OVER_TIME'], 'rgba(63,169,255,0.45)']];
    const weights = segs.map((s) => Math.sqrt(s[1]) + 3);     // + 3: every label fits
    const total = weights.reduce((a, b) => a + b, 0);
    const x0 = 14;
    const x1 = box.w * 0.62;
    const y = box.h * 0.45;
    let x = x0;
    segs.forEach(([name, secs, keys, color], i) => {
      const w = ((x1 - x0) * weights[i]) / total;
      rect(ctx, x, y - 12, w - 3, 24, color);
      const hot = keys.includes(env.focus);
      txt(ctx, `${name} ${secs >= 60 ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')}` : `${r1(secs)} s`}`, x + 6, y + 4,
        { size: 11, weight: hot ? 800 : 600, color: hot && env.mine ? '#1a1300' : '#0b1222' });
      x += w;
    });
    const play = Math.min(1, (t % 5) / 4);
    line(ctx, x0 + play * (x1 - x0), y - 18, x0 + play * (x1 - x0), y + 18, 'rgba(255,255,255,0.7)', 1.5);
    if (R.MATCH_START_EXTRA > 0) txt(ctx, `+${r1(R.MATCH_START_EXTRA)} s before a match's first round`, x0, y + 32, { size: 10, color: env.focus === 'MATCH_START_EXTRA' ? COL.gold : COL.dim });
    const cx = x1 + 26;
    const win = R.MATCH_ROUNDS_TO_WIN;
    const hot = env.focus === 'MATCH_ROUNDS_TO_WIN';
    txt(ctx, win ? `First to ${win} round wins` : 'Endless: the host ends the match', cx, y - 14, { size: 12, weight: hot ? 800 : 600, color: hot && env.mine ? COL.gold : env.mine ? COL.text : COL.dim });
    for (let i = 0; i < Math.min(win, 15); i++) circle(ctx, cx + 8 + i * 16, y + 8, 5, i < Math.ceil(play * win) ? COL.gold : 'rgba(255,255,255,0.15)');
    if (env.focus === 'WARMUP_RESPAWN') txt(ctx, `Warm-up: back on your feet after ${r1(R.WARMUP_RESPAWN)} s`, cx, y + 34, { size: 11, color: env.mine ? COL.gold : COL.dim, weight: 800 });
  },
};

SCENES.duration = {
  title: 'Duration',
  caption: 'How long it lasts, in real time.',
  lanes: 'rows',
  prepare(A, B, env) {
    return { span: Math.max(1, A[env.focus], B[env.focus]) * 1.15 };
  },
  period(A, B, env) {
    return this.prepare(A, B, env).span + 1;
  },
  lane(ctx, box, t, R, env) {
    const v = R[env.focus];
    const span = env.shared.span;
    const x0 = 16;
    const x1 = box.w - 20;
    const sx = (s) => x0 + (s / span) * (x1 - x0);
    const y = box.h * 0.55;
    rect(ctx, x0, y - 8, x1 - x0, 16, 'rgba(255,255,255,0.05)');
    rect(ctx, x0, y - 8, sx(v) - x0, 16, env.mine ? 'rgba(255,201,64,0.7)' : 'rgba(140,150,170,0.5)');
    for (let s = 0; s <= span; s += span > 12 ? 2 : 1) txt(ctx, `${s}s`, sx(s), y + 22, { size: 10, color: COL.dim, align: 'center' });
    const now = Math.min(t, span);
    line(ctx, sx(now), y - 14, sx(now), y + 12, 'rgba(255,255,255,0.75)', 1.5);
    const what = { BALL_LIFETIME: now < v ? 'ball still flying' : 'ball gone', REVIVE_INVULN: now < v ? 'protected' : 'can be hit again',
      WARMUP_RESPAWN: now < v ? 'knocked out' : 'back up' }[env.focus] ?? '';
    txt(ctx, what, sx(now) + 8, y - 14, { size: 11, weight: 800, color: now < v ? (env.mine ? COL.gold : COL.text) : COL.dim });
    readout(ctx, [[`${r1(v)} s`, [env.focus]]], x0, 34, env, 13);
  },
};

SCENES.cooldown = {
  title: 'Ball cooldown',
  caption: 'Throwing taps as fast as possible for 8 seconds: after each throw, the next ball takes this long to appear.',
  lanes: 'rows',
  period: () => 9,
  lane(ctx, box, t, R, env) {
    const x0 = 16;
    const x1 = box.w - 16;
    const sx = (s) => x0 + (s / 8) * (x1 - x0);
    const y = box.h * 0.55;
    line(ctx, x0, y, x1, y, COL.line, 1.5);
    for (let s = 0; s <= 8; s++) txt(ctx, `${s}s`, sx(s), y + 20, { size: 10, color: COL.dim, align: 'center' });
    const throws = [];
    for (let s = 0; s <= 8; s += R.THROW_COOLDOWN) throws.push(s);
    const now = Math.min(t, 8);
    for (const s of throws) {
      if (s > now) break;
      const end = Math.min(s + R.THROW_COOLDOWN, now, 8);
      rect(ctx, sx(s), y - 6, sx(end) - sx(s) - 2, 12, env.mine ? 'rgba(255,201,64,0.45)' : 'rgba(140,150,170,0.4)');
      ball(ctx, sx(s), y, 5, env.mine ? COL.ball : '#b9c0cf');
    }
    line(ctx, sx(now), y - 14, sx(now), y + 10, 'rgba(255,255,255,0.75)', 1.5);
    readout(ctx, [['New ball '], [`${r1(R.THROW_COOLDOWN)} s`, ['THROW_COOLDOWN']], [` after each throw: at most ${throws.length} throws in 8 s`]], x0, 34, env, 12);
  },
};

const BOT_FIELD = (key) => (key.match(/^BOT_(EASY|NORMAL|HARD)_(.+)$/) || [])[2]?.toLowerCase();

SCENES.bots = {
  title: 'Bots',
  caption: 'What the bot numbers do, for the profile being edited.',
  lanes: 'rows',
  period: () => 4,
  lane(ctx, box, t, R, env) {
    const k = env.focus;
    const m = k.match(/^BOT_(EASY|NORMAL|HARD)_/);
    const skill = m ? m[1].toLowerCase() : R.BOT_SKILL;
    const S = skill.toUpperCase();
    const prof = (f) => R[`BOT_${S}_${f}`];
    const field = BOT_FIELD(k);
    const y = box.h * 0.5;
    if (k === 'BOTS_RED' || k === 'BOTS_BLUE') {
      const counts = [R.BOTS_RED, R.BOTS_BLUE];
      const say = (n) => (n ? `${n} bot${n === 1 ? '' : 's'}` : 'no bots');
      readout(ctx, [['RED: '], [say(counts[0]), ['BOTS_RED']], ['   BLUE: '], [say(counts[1]), ['BOTS_BLUE']],
        ['   (plus the people on each team)']], 16, 34, env, 12);
      [0, 1].forEach((team) => {
        const n = counts[team];
        const step = Math.min(24, (box.w / 2 - 50) / Math.max(1, n));
        for (let i = 0; i < n; i++) circle(ctx, 30 + team * (box.w / 2) + i * step, y + 10, Math.min(9, step / 2 - 1), 'rgba(255,255,255,0.2)', team ? COL.blue : COL.red, 2);
        if (!n) txt(ctx, '—', 30 + team * (box.w / 2), y + 14, { size: 12, color: COL.dim });
      });
      return;
    }
    if (k === 'BOT_SKILL' || k === 'BOT_STAMINA_RESERVE') {
      readout(ctx, [['Bots use the '], [`${skill}`, ['BOT_SKILL']], [` profile: defend ${Math.round(prof('REACT') * 100)}% of balls, timing ±${Math.round(prof('SD') * 1000)} ms, aim ±${r1(prof('AIM'))}°, `],
        [`${Math.round(prof('BANK') * 100)}% bank shots`]], 16, 34, env, 12);
      readout(ctx, [['They throw only with '], [`${Math.round(R.BOT_STAMINA_RESERVE)} stamina`, ['BOT_STAMINA_RESERVE']], [' left over for defending']], 16, 56, env, 12);
      return;
    }
    if (field === 'react' || field === 'bank') {
      const share = prof(field.toUpperCase());
      const n = 20;
      for (let i = 0; i < n; i++) {
        const on = i < Math.round(share * n);
        circle(ctx, 22 + i * 22, y + 8, 7, on ? (env.mine ? COL.gold : COL.text) : 'rgba(255,255,255,0.12)');
      }
      readout(ctx, [[field === 'react' ? 'Tries to defend ' : 'Bank shots: '], [`${Math.round(share * 100)}%`, [k]], [field === 'react' ? ' of incoming balls' : ' of throws']], 16, 30, env, 12);
      return;
    }
    if (field === 'sd') {
      const sd = Math.max(0.001, prof('SD'));
      const lead = Math.min(0.15, R.CATCH_WINDOW * 0.5);
      const x0 = 30;
      const x1 = box.w - 20;
      const span = 0.5;
      const sx = (s) => x0 + ((s + 0.1) / (span + 0.1)) * (x1 - x0);
      rect(ctx, sx(0), y + 6, sx(R.CATCH_PERFECT) - sx(0), 10, 'rgba(255,201,64,0.7)');
      rect(ctx, sx(R.CATCH_PERFECT), y + 6, sx(R.CATCH_WINDOW) - sx(R.CATCH_PERFECT), 10, 'rgba(93,255,155,0.45)');
      const pts = [];
      for (let i = 0; i <= 120; i++) {
        const s = -0.1 + (i / 120) * (span + 0.1);
        pts.push([sx(s), y + 4 - 34 * Math.exp(-((s - lead) ** 2) / (2 * sd * sd))]);
      }
      path(ctx, pts, env.mine ? COL.gold : COL.dim, 2);
      const erf = (x) => {
        const s = Math.sign(x);
        const a = Math.abs(x);
        const u = 1 / (1 + 0.3275911 * a);
        return s * (1 - (((((1.061405429 * u - 1.453152027) * u) + 1.421413741) * u - 0.284496736) * u + 0.254829592) * u * Math.exp(-a * a));
      };
      const cdf = (x) => 0.5 * (1 + erf((x - lead) / (sd * Math.SQRT2)));
      const inWin = cdf(R.CATCH_WINDOW) - cdf(0);
      readout(ctx, [['Timing spread '], [`±${Math.round(sd * 1000)} ms`, [k]], [`: ${Math.round(inWin * 100)}% of catches land in the window, ${Math.round((cdf(R.CATCH_PERFECT) - cdf(0)) * 100)}% perfect`]], 16, 26, env, 12);
      return;
    }
    if (field === 'aim') {
      const dist = 14;
      const spread = dist * Math.tan(prof('AIM') * DEG);
      const s = Math.min(16, (box.h - 50) / 4.5);
      const cx = box.w * 0.3;
      const cy = y + 10;
      circle(ctx, cx, cy, R.PLAYER_RADIUS * s * 1.6, null, COL.blue, 2);
      let rng = 7;
      const rand = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
      let hits = 0;
      for (let i = 0; i < 40; i++) {
        const gx = Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand()) * spread;
        const gy = Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand()) * spread * 0.5;
        if (Math.hypot(gx, gy) < R.PLAYER_RADIUS + R.BALL_RADIUS) hits++;
        circle(ctx, cx + gx * s * 1.6, cy + gy * s * 1.6, 2.5, env.mine ? COL.gold : COL.dim);
      }
      readout(ctx, [['Aim error '], [`±${r1(prof('AIM'))}°`, [k]], [`: at 14 m, ${Math.round((hits / 40) * 100)}% would hit without aim assist`]], box.w * 0.48, y + 14, env, 12);
      return;
    }
    if (field === 'gap_min' || field === 'gap_max') {
      const lo = prof('GAP_MIN');
      const hi = prof('GAP_MAX');
      const x0 = 16;
      const x1 = box.w - 20;
      const span = Math.max(6, R.THROW_COOLDOWN + hi + 1);
      const sx = (s) => x0 + (s / span) * (x1 - x0);
      rect(ctx, sx(0), y, sx(R.THROW_COOLDOWN) - sx(0), 12, 'rgba(140,150,170,0.45)');
      rect(ctx, sx(R.THROW_COOLDOWN + lo), y, Math.max(2, sx(R.THROW_COOLDOWN + hi) - sx(R.THROW_COOLDOWN + lo)), 12, env.mine ? 'rgba(255,201,64,0.7)' : 'rgba(140,150,170,0.7)');
      txt(ctx, 'new ball', sx(R.THROW_COOLDOWN / 2), y + 26, { size: 10, color: COL.dim, align: 'center' });
      readout(ctx, [['Next throw '], [`${r1(lo)}`, [`BOT_${S}_GAP_MIN`]], ['–'], [`${r1(hi)} s`, [`BOT_${S}_GAP_MAX`]], [' after the new ball appears']], 16, 30, env, 12);
      return;
    }
    // mix_*: preference between the three defences
    const w = [prof('MIX_DODGE'), prof('MIX_CATCH'), prof('MIX_DEFLECT')];
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const names = ['dodge', 'catch', 'deflect'];
    const colors = ['#6fd0ff', '#5dff9b', '#ff4bd8'];
    let x = 16;
    const total = box.w - 40;
    w.forEach((v, i) => {
      const width = (total * v) / sum;
      if (width > 0) {
        rect(ctx, x, y, width - 2, 16, colors[i]);
        if (width > 50) txt(ctx, `${names[i]} ${Math.round((v / sum) * 100)}%`, x + 6, y + 12, { size: 11, weight: 800, color: '#0b1222' });
      }
      x += width;
    });
    readout(ctx, [['When a bot defends, it picks: '], ...names.map((n, i) => [`${n} ${Math.round((w[i] / sum) * 100)}%${i < 2 ? ', ' : ''}`, [`BOT_${S}_MIX_${n.toUpperCase()}`]])], 16, 30, env, 12);
  },
};

SCENES.network = {
  title: 'Network smoothing',
  caption: 'The last half second, as one browser sees it: snapshots arrive (ticks), the screen shows the world a little in the past, and presses are judged against that.',
  lanes: 'rows',
  period: () => 2,
  lane(ctx, box, t, R, env) {
    const x0 = 20;
    const x1 = box.w - 70;
    const span = 0.5;
    const sx = (s) => x1 - (s / span) * (x1 - x0);     // s = seconds before "now"
    const y = box.h * 0.52;
    line(ctx, x0, y, x1, y, COL.line, 1.5);
    txt(ctx, 'now', x1, y + 22, { size: 10, color: COL.text, align: 'center' });
    rect(ctx, sx(R.MAX_LAG_COMP), y - 20, sx(0) - sx(R.MAX_LAG_COMP), 6, 'rgba(93,255,155,0.35)');
    txt(ctx, 'presses count up to here', sx(R.MAX_LAG_COMP), y - 24, { size: 10, color: env.focus === 'MAX_LAG_COMP' ? COL.gold : COL.dim });
    const interval = 1 / R.SNAPSHOT_RATE;
    const phase = (t % interval);
    for (let s = phase; s <= span; s += interval) line(ctx, sx(s), y - 8, sx(s), y + 8, env.mine ? 'rgba(255,255,255,0.75)' : COL.dim, 2);
    const tick = 1 / R.TICK_RATE;
    for (let s = (t % tick); s <= span; s += tick) line(ctx, sx(s), y + 10, sx(s), y + 13, 'rgba(255,255,255,0.25)', 1);
    line(ctx, sx(R.INTERP_DELAY), y - 14, sx(R.INTERP_DELAY), y + 14, env.mine ? COL.gold : COL.text, 3);
    txt(ctx, 'on screen', sx(R.INTERP_DELAY), y + 26, { size: 10, color: env.mine ? COL.gold : COL.text, align: 'center' });
    const margin = R.INTERP_DELAY - interval;
    const warn = margin < 0.02;
    readout(ctx, [['Screen '], [`${Math.round(R.INTERP_DELAY * 1000)} ms`, ['INTERP_DELAY']], [' behind; '], [`${R.SNAPSHOT_RATE}`, ['SNAPSHOT_RATE']],
      [' updates/s; a late update is tolerated up to '], [`${Math.round(Math.max(0, margin) * 1000)}–${Math.round(R.INTERP_DELAY * 1000)} ms`, ['INTERP_DELAY', 'SNAPSHOT_RATE']],
      [warn ? ' (too tight: motion will stutter)' : ''], ['; lag comp '], [`${Math.round(R.MAX_LAG_COMP * 1000)} ms`, ['MAX_LAG_COMP']]], 12, box.h - 9, env, 11);
  },
};

// ---------------------------------------------------------------- the canvas

export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sceneId = null;
    this.running = false;
    this.t0 = performance.now();
  }

  /** Shows `sceneId` for the rule `focus`, comparing defaults A with this lobby's values B. */
  show(sceneId, focus, A, B, labelB) {
    if (sceneId !== this.sceneId || (sceneId === 'defence' && focus.split('_')[0] !== this.focus?.split('_')[0])) this.t0 = performance.now();
    this.sceneId = sceneId;
    this.focus = focus;
    this.A = A;
    this.B = B;
    this.labelB = labelB;
    const scene = SCENES[sceneId] || SCENES.duration;
    return { title: scene.title, caption: scene.caption };
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      try {
        this.draw();
      } catch (e) {
        console.error('preview', e);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }

  draw() {
    const c = this.canvas;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h || !this.A) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, w, h);
    const S = SCENES[this.sceneId] || SCENES.duration;
    const t = (performance.now() - this.t0) / 1000;
    const env = { focus: this.focus };
    if (!S.lanes) {
      S.draw(ctx, { w, h }, t, this.A, this.B, env);
      return;
    }
    env.shared = S.prepare ? S.prepare(this.A, this.B, env) : {};
    const tt = t % (S.period ? S.period(this.A, this.B, env) : 4);
    const cols = S.lanes === 'cols';
    const lw = cols ? (w - 1) / 2 : w;
    const lh = cols ? h : (h - 1) / 2;
    [[this.A, 'DEFAULT', false], [this.B, this.labelB, true]].forEach(([R, label, mine], i) => {
      const ox = cols ? i * (lw + 1) : 0;
      const oy = cols ? 0 : i * (lh + 1);
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, lw, lh);
      ctx.clip();
      ctx.translate(ox, oy);
      if (mine) rect(ctx, 0, 0, lw, lh, 'rgba(255,201,64,0.03)');
      S.lane(ctx, { w: lw, h: lh }, tt, R, { ...env, mine });
      ctx.restore();
      txt(ctx, label, ox + 10, oy + 15, { size: 10, weight: 800, color: mine ? COL.gold : COL.dim });
    });
    if (cols) line(ctx, lw + 0.5, 0, lw + 0.5, h, 'rgba(255,255,255,0.12)', 1);
    else line(ctx, 0, lh + 0.5, w, lh + 0.5, 'rgba(255,255,255,0.12)', 1);
  }
}
