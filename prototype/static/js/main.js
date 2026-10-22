// Game client: joins the server, moves the local player, aims, and draws everything.
//
// The server owns all the rules (balls, hits, stamina, timing). This browser only moves its
// own player (so movement feels instant), shows the world slightly in the past for
// smoothness, and tells the server which moment was on screen whenever a button is pressed.
import { Net } from './net.js';
import { Input } from './input.js';
import { World } from './world.js';
import { Hud, TEAM, TEAM_CLASS } from './hud.js';
import { Sfx } from './sfx.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const clock = () => performance.now() / 1000;
const ACT_CODE = { dodge: 1, catch: 2, deflect: 3 };
const DENY = {
  stamina: 'Not enough stamina', busy: 'Still recovering', noball: 'No ball yet',
  cash: 'Not enough cash', nobody: 'Nobody to revive', round: 'Not now',
};
// Must match sim.py (HAND_FWD, HAND_RIGHT, HAND_UP): balls leave from the right hand.
const HAND_FWD = 0.3;
const HAND_RIGHT = 0.32;
const HAND_UP = 1.45;

const canvas = $('view');
const net = new Net();
const input = new Input(canvas);
const world = new World(canvas);
const hud = new Hud();
const sfx = new Sfx();

const settings = { sens: 1, volume: 0.6, ring: true };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('dp.settings') || '{}'));
} catch { /* private mode etc: defaults are fine */ }
const saveSettings = () => {
  try { localStorage.setItem('dp.settings', JSON.stringify(settings)); } catch { /* ignore */ }
};
sfx.setVolume(settings.volume);

let cfg = null;
let myId = null;
let myTeam = 0;
let myName = '';
let me = null;          // my entry in the newest snapshot
let view = null;        // the interpolated world on screen
let viewTime = 0;
let threat = null;
let scoresHeld = false;
let lastCount = -1;
let fps = 60;
const aim = { point: null, tg: null, ang: 99 };
const warned = new Set();
const local = {
  x: 0, z: 0, yaw: Math.PI / 2, pitch: 0, tp: -1,
  action: null, actionAt: -9, busyUntil: 0, dashUntil: 0, dashDir: [0, 0],
  charging: false, chargeAt: 0, throwAt: -9, lastSend: 0, handled: null,
};

world.buildCourt(13, 7, 1);

// ------------------------------------------------------------------ join & menu

let chosenTeam = -1;
let saved = null;
try { saved = JSON.parse(sessionStorage.getItem('dp.join') || 'null'); } catch { /* ignore */ }
$('nameInput').value = saved?.name || `Player-${100 + Math.floor(Math.random() * 900)}`;
chosenTeam = saved?.team ?? -1;
const teamButtons = [...document.querySelectorAll('.teams button')];
const markTeam = () => teamButtons.forEach((b) => b.classList.toggle('on', Number(b.dataset.team) === chosenTeam));
teamButtons.forEach((b) => b.addEventListener('click', () => { chosenTeam = Number(b.dataset.team); markTeam(); }));
markTeam();
$('playBtn').addEventListener('click', join);
$('nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && join());
if (saved?.joined) join();     // a reloaded tab rejoins as the same name/team (sessionStorage is per tab)

function join() {
  myName = $('nameInput').value.trim().slice(0, 16) || 'Player';
  try {
    sessionStorage.setItem('dp.join', JSON.stringify({ name: myName, team: chosenTeam, joined: true }));
  } catch { /* ignore */ }
  $('join').hidden = true;
  sfx.unlock();
  net.connect(myName, chosenTeam === -1 ? null : chosenTeam);
  showMenu('Click to play');
}

net.on('welcome', (m) => {
  myId = m.id;
  cfg = m.cfg;
  net.interpDelay = cfg.interpDelay;
  net.gravity = cfg.gravity;
  hud.show(true);
  const box = $('joinInfo');
  const h = document.createElement('h3');
  h.textContent = 'Others on the same Wi-Fi open';
  box.replaceChildren(h);
  for (const url of cfg.joinUrls.length ? cfg.joinUrls : [location.origin]) {
    const code = document.createElement('code');
    code.textContent = url;
    box.append(code, ' ');
  }
});
net.on('close', () => {
  $('disconnected').hidden = false;
  document.exitPointerLock?.();
});
$('reconnectBtn').addEventListener('click', () => location.reload());

function showMenu(title) {
  $('overlayTitle').textContent = title;
  $('overlay').hidden = false;
}
$('resumeBtn').addEventListener('click', () => {
  sfx.unlock();
  input.lock();
});
input.onLockChange = (locked) => {
  $('overlay').hidden = locked;
  if (!locked && myId !== null) showMenu('Paused');
};

$('sensInput').value = settings.sens;
$('volInput').value = settings.volume;
$('ringInput').checked = settings.ring;
$('sensInput').addEventListener('input', (e) => { settings.sens = Number(e.target.value); saveSettings(); });
$('volInput').addEventListener('input', (e) => { settings.volume = Number(e.target.value); sfx.setVolume(settings.volume); saveSettings(); });
$('ringInput').addEventListener('change', (e) => { settings.ring = e.target.checked; saveSettings(); });
// Rapid clicks must count from the value already asked for, not the not-yet-updated snapshot.
let fillWanted = null;
const changeFill = (step) => {
  fillWanted = clamp((fillWanted ?? net.latest?.r.fill ?? 2) + step, 0, cfg?.botFillMax ?? 6);
  net.send({ t: 'cfg', fill: fillWanted });
};
$('fillMinus').addEventListener('click', () => changeFill(-1));
$('fillPlus').addEventListener('click', () => changeFill(1));
$('skillSelect').addEventListener('change', (e) => net.send({ t: 'cfg', skill: e.target.value }));
$('teamBtn').addEventListener('click', () => net.send({ t: 'team', team: 1 - myTeam }));

// ------------------------------------------------------------------ actions

input.onPress = (a) => {
  if (a === 'scores') { scoresHeld = true; return; }
  if (a === 'ring') {
    settings.ring = !settings.ring;
    $('ringInput').checked = settings.ring;
    saveSettings();
    hud.popup(`Timing ring ${settings.ring ? 'on' : 'off'}`, 'dim');
    return;
  }
  if (!me || !cfg || !me.alive) return;
  if (a === 'throw') startCharge();
  else if (a === 'revive') net.send({ t: 'revive' });
  else tryAction(a);
};
input.onRelease = (a) => {
  if (a === 'scores') scoresHeld = false;
  else if (a === 'throw') releaseThrow();
};
input.onCancel = () => {
  if (local.charging) {
    local.charging = false;
    net.send({ t: 'cancel' });
  }
};

const combatOpen = () => ['wait', 'play'].includes(net.latest?.r.s);
// The newest snapshot can lag a throw by a few frames; don't show a ball we just threw.
const hasBall = () => !!me && me.hasBall && clock() - local.throwAt > 0.35;
const throwCost = (power) => cfg.throwCost[0] + (cfg.throwCost[1] - cfg.throwCost[0]) * power;
const throwSpeed = (power) => cfg.throwSpeed[0] + (cfg.throwSpeed[1] - cfg.throwSpeed[0]) * power;
const damageFor = (speed) => Math.round(clamp(cfg.damage.min + (speed - cfg.throwSpeed[0]) * cfg.damage.perSpeed, cfg.damage.min, cfg.damage.max));

// The court grows with the biggest team; its current size arrives with every snapshot.
let courtKey = '';
function court() {
  const c = net.latest?.r.court;
  return c ? { L: c[0], W: c[1] } : { L: 13, W: 7 };
}
function syncCourt() {
  const { L, W } = court();
  const key = `${L}x${W}`;
  if (key !== courtKey) {
    courtKey = key;
    world.buildCourt(L, W, cfg.centerGap);
  }
}

function chargePower(t = clock()) {
  const held = clamp((t - local.chargeAt) / cfg.chargeTime, 0, 1);
  const [lo, hi] = cfg.throwCost;
  return Math.min(held, clamp((me.stamina - lo) / (hi - lo), 0, 1));   // stamina caps the power
}

function denied(text) {
  hud.popup(text, 'dim');
  sfx.deny();
}

function startCharge() {
  const t = clock();
  if (!combatOpen() || t < local.busyUntil) return;
  if (!hasBall()) return denied(`No ball yet (${me.cooldown.toFixed(1)}s)`);
  if (me.stamina < cfg.throwCost[0]) {
    hud.flashStamina();
    return denied(DENY.stamina);
  }
  local.charging = true;
  local.chargeAt = t;
  net.send({ t: 'charge', wt: round(net.viewTime(), 4) });
}

function releaseThrow() {
  if (!local.charging) return;
  const power = chargePower();
  local.charging = false;
  local.throwAt = clock();
  net.send({ t: 'throw', wt: round(net.viewTime(), 4), aim: aim.point, tg: aim.tg });
  world.man(myId)?.playThrow();
  sfx.throw(power);
}

function tryAction(kind) {
  const t = clock();
  if (!combatOpen() || t < local.busyUntil) return;
  const spec = cfg.actions[kind];
  if (me.stamina < spec.cost) {
    hud.flashStamina();
    return denied(DENY.stamina);
  }
  local.action = kind;
  local.actionAt = t;
  local.busyUntil = t + spec.window + spec.recovery;
  local.charging = false;     // the server cancels the wind-up too
  // The ring moves on to the next ball right away, so a second ball close behind is visible.
  if (threat) local.handled = { id: threat.b.id, rally: threat.b.rally, until: t + spec.window + 0.1, arrive: t + threat.tti };
  let dir = null;
  if (kind === 'dodge') {
    local.dashDir = dodgeDirection();
    local.dashUntil = t + cfg.dash.time;
    dir = local.dashDir.map((v) => round(v, 3));
  }
  net.send({ t: 'act', a: kind, wt: round(net.viewTime(), 4), dir, aim: aim.point, tg: aim.tg });
}

function dodgeDirection() {
  const { f, r } = input.axis();
  const sy = Math.sin(local.yaw);
  const cy = Math.cos(local.yaw);
  let dx = sy * f - cy * r;
  let dz = cy * f + sy * r;
  if (!f && !r) {
    // No direction held: sidestep, away from the incoming ball's line if there is one.
    dx = -cy;
    dz = sy;
    if (threat) {
      const b = threat.b;
      const len = Math.hypot(b.vx, b.vz) || 1;
      const px = -b.vz / len;
      const pz = b.vx / len;
      const side = (local.x - b.pos.x) * px + (local.z - b.pos.z) * pz;
      const sign = Math.abs(side) > 0.05 ? Math.sign(side) : (local.z > 0 ? -Math.sign(pz) || 1 : Math.sign(pz) || 1);
      dx = px * sign;
      dz = pz * sign;
    }
  }
  const len = Math.hypot(dx, dz) || 1;
  return [dx / len, dz / len];
}

// ------------------------------------------------------------------ local player & camera

function clampToHalf(team, x, z) {
  const { L, W } = court();
  const g = cfg.centerGap;
  const r = cfg.playerRadius;
  x = team === 0 ? clamp(x, -L + r, -g) : clamp(x, g, L - r);
  return [x, clamp(z, -W + r, W - r)];
}

function syncSelf() {
  if (me.tp !== local.tp) {     // the server placed us (spawn, round start, revive)
    local.tp = me.tp;
    local.x = me.x;
    local.z = me.z;
    local.yaw = me.yaw;
    local.pitch = 0;
    local.dashUntil = 0;
    local.busyUntil = 0;
    local.charging = false;
  }
  if (me.team !== myTeam || !document.title.startsWith(myName)) {
    myTeam = me.team;
    hud.setIdentity(myName, myTeam);
    document.title = `${myName} · ${TEAM[myTeam]} | Dodge & Parry`;
  }
}

function moveLocal(dt, t) {
  const [mx, my] = input.takeMouse();
  const k = 0.0022 * settings.sens;
  local.yaw -= mx * k;
  local.pitch = clamp(local.pitch - my * k, -1.0, 1.1);
  if (!me.alive) return;
  const { f, r } = input.axis();
  const sy = Math.sin(local.yaw);
  const cy = Math.cos(local.yaw);
  let vx = sy * f - cy * r;
  let vz = cy * f + sy * r;
  const len = Math.hypot(vx, vz);
  let speed = cfg.walk;
  if (local.charging) speed = cfg.chargeWalk;
  else if (local.action && local.action !== 'dodge' && t < local.actionAt + cfg.actions[local.action].window) speed = cfg.defendWalk;
  if (len > 0) {
    vx = (vx / len) * speed;
    vz = (vz / len) * speed;
  }
  if (t < local.dashUntil) {
    vx = local.dashDir[0] * cfg.dash.speed;
    vz = local.dashDir[1] * cfg.dash.speed;
  }
  [local.x, local.z] = clampToHalf(myTeam, local.x + vx * dt, local.z + vz * dt);
}

function placeCamera() {
  const cam = world.camera;
  if (me && me.alive) {
    // Over the right shoulder, like Fortnite: the crosshair is the aim.
    const cp = Math.cos(local.pitch);
    const dx = Math.sin(local.yaw) * cp;
    const dy = Math.sin(local.pitch);
    const dz = Math.cos(local.yaw) * cp;
    const px = local.x - Math.cos(local.yaw) * 0.75;
    const pz = local.z + Math.sin(local.yaw) * 0.75;
    const py = 1.75;
    const dist = 4.4;
    cam.position.set(px - dx * dist, Math.max(0.3, py - dy * dist + 0.55), pz - dz * dist);
    cam.lookAt(px + dx * 20, py + dy * 20, pz + dz * 20);
  } else {
    // Joining or knocked out: orbit above the court (the mouse turns it).
    const radius = 8 + court().L * 1.05;
    cam.position.set(-Math.sin(local.yaw) * radius, radius * 0.55, -Math.cos(local.yaw) * radius);
    cam.lookAt(0, 0, 0);
  }
}

function handPos() {
  const fx = Math.sin(local.yaw);
  const fz = Math.cos(local.yaw);
  return [local.x + fx * HAND_FWD - fz * HAND_RIGHT, HAND_UP, local.z + fz * HAND_FWD + fx * HAND_RIGHT];
}

function rayCylinder(o, d, cx, cz, r, h) {
  const ox = o.x - cx;
  const oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t <= 0) return null;
  const y = o.y + d.y * t;
  return y >= 0 && y <= h ? t : null;
}

/** What the crosshair is on (the ball flies there), and the enemy the aim assist would bend toward. */
function computeAim() {
  const { o, d } = world.cameraRay();
  let best = 60;
  for (const p of view.players.values()) {
    if (!p.alive || p.team === myTeam) continue;
    const t = rayCylinder(o, d, p.x, p.z, cfg.playerRadius, 1.95);
    if (t !== null && t < best) best = t;
  }
  if (d.y < -1e-4) best = Math.min(best, -o.y / d.y);
  // Where the ray leaves the court through a wall. Works even when the camera itself is
  // outside the court (standing near your back wall puts it behind the glass).
  const { L, W } = court();
  const exits = [];
  if (Math.abs(d.x) > 1e-6) exits.push(((d.x > 0 ? L : -L) - o.x) / d.x);
  if (Math.abs(d.z) > 1e-6) exits.push(((d.z > 0 ? W : -W) - o.z) / d.z);
  const wall = Math.min(...exits);
  if (wall > 0) best = Math.min(best, wall);
  let px = o.x + d.x * best;
  let py = o.y + d.y * best;
  let pz = o.z + d.z * best;
  const h = handPos();
  if ((px - h[0]) * Math.sin(local.yaw) + (pz - h[2]) * Math.cos(local.yaw) < 1.5) {
    // The crosshair is on something between the camera and us: never throw backwards.
    px = h[0] + d.x * 20;
    py = h[1] + d.y * 20;
    pz = h[2] + d.z * 20;
  }
  aim.point = [round(px, 2), round(py, 2), round(pz, 2)];
  let dx = px - h[0];
  let dy = py - h[1];
  let dz = pz - h[2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl;
  dy /= dl;
  dz /= dl;
  aim.tg = null;
  aim.ang = 99;
  for (const p of view.players.values()) {
    if (!p.alive || p.team === myTeam) continue;
    const ex = p.x - h[0];
    const ey = cfg.chestHeight - h[1];
    const ez = p.z - h[2];
    if (Math.hypot(ex, ez) > cfg.assistRange) continue;
    const el = Math.hypot(ex, ey, ez) || 1;
    const ang = (Math.acos(clamp((ex * dx + ey * dy + ez * dz) / el, -1, 1)) * 180) / Math.PI;
    if (ang < aim.ang) {
      aim.ang = ang;
      aim.tg = p.id;
    }
  }
  if (aim.ang > cfg.deflectCone) aim.tg = null;
}

/** Same arc maths as the server (sim.launch_velocity): the flatter arc through `to`. */
function launchVelocity(from, to, speed) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dz);
  const g = cfg.gravity;
  if (g <= 0 || d < 0.3) {
    const l = Math.hypot(dx, dy, dz) || 1;
    return [(dx / l) * speed, (dy / l) * speed, (dz / l) * speed];
  }
  const s2 = speed * speed;
  const disc = s2 * s2 - g * (g * d * d + 2 * dy * s2);
  const theta = disc < 0 ? Math.PI / 4 : Math.atan2(s2 - Math.sqrt(disc), g * d);
  const h = (Math.cos(theta) * speed) / d;
  return [dx * h, Math.sin(theta) * speed, dz * h];
}

function touchesEnemy(x, y, z) {
  const R = cfg.playerRadius + cfg.ballRadius;
  for (const p of view.players.values()) {
    if (p.alive && p.team !== myTeam && Math.hypot(x - p.x, y - clamp(y, 0.25, 1.45), z - p.z) <= R) return true;
  }
  return false;
}

/** Dotted preview of the throw being charged: its arc, up to a hit, and the first ricochet. */
function previewPath(speed) {
  const { L, W } = court();
  const r = cfg.ballRadius;
  const { normalKeep: kn, tangentKeep: kt, minSpeed } = cfg.ricochet;
  let [x, y, z] = handPos();
  let [vx, vy, vz] = launchVelocity([x, y, z], aim.point, speed);
  const pts = [];
  let bounce = null;
  let after = 0;
  for (let i = 0; i < 160; i++) {
    const dt = 0.02;
    vy -= cfg.gravity * dt;
    x += vx * dt;
    y += vy * dt;
    z += vz * dt;
    if (Math.abs(x) > L - r) break;                 // end walls stop the ball
    let floor = null;
    if (y <= r) {
      y = r;
      floor = true;
    } else if (Math.abs(z) > W - r) {
      z = Math.sign(z) * (W - r);
      floor = false;
    }
    if (floor !== null) {
      if (bounce) break;
      [vx, vy, vz] = floor ? [vx * kt, -vy * kn, vz * kt] : [vx * kt, vy * kt, -vz * kn];
      pts.push([x, y, z]);
      if (Math.hypot(vx, vy, vz) < minSpeed) break;
      bounce = { pos: [x, y, z], floor };
      continue;
    }
    pts.push([x, y, z]);
    if (touchesEnemy(x, y, z) || (bounce && ++after > 10)) break;
  }
  return { pts, bounce };
}

/** Aiming at the floor or a wall short of the target means a ricochet, not aim assist. */
function isBankShot(target) {
  const h = handPos();
  const [ax, ay, az] = aim.point;
  const { L, W } = court();
  const onSurface = ay < 0.35 || Math.abs(ax) > L - 0.35 || Math.abs(az) > W - 0.35;
  return onSurface && Math.hypot(ax - h[0], az - h[2]) < Math.hypot(target.x - h[0], target.z - h[2]) - 1;
}

/** Balls as drawn. Near me they are shifted onto my present position: the server judged them
 *  against where it last knew me, and that offset is what this browser is ahead by. */
function displayBalls(viewMe) {
  const out = [];
  const shift = viewMe && viewMe.alive && me?.alive;
  const ox = shift ? local.x - viewMe.x : 0;
  const oz = shift ? local.z - viewMe.z : 0;
  for (const b of view.balls.values()) {
    let { x, z } = b;
    if (shift) {
      const w = Math.max(0, 1 - Math.hypot(b.x - viewMe.x, b.z - viewMe.z) / 4);
      x += ox * w;
      z += oz * w;
    }
    b.pos = { x, y: b.y, z };
    out.push(b);
  }
  return out;
}

/** The enemy ball that will reach me soonest, if one is coming. */
function findThreat() {
  let best = null;
  const R = cfg.playerRadius + cfg.ballRadius;
  const h = local.handled;
  for (const b of view.balls.values()) {
    if (b.state !== 0 || b.team === myTeam) continue;
    if (h && b.id === h.id && b.rally === h.rally && clock() < h.until) continue;   // already answered
    const vv = b.vx * b.vx + b.vz * b.vz;
    if (vv < 1) continue;
    const rx = local.x - b.pos.x;
    const rz = local.z - b.pos.z;
    let t = (rx * b.vx + rz * b.vz) / vv;
    if (t < 0) continue;
    const miss = Math.hypot(rx - b.vx * t, rz - b.vz * t);
    const y = b.pos.y + b.vy * t - 0.5 * cfg.gravity * t * t;
    // A ball curving toward me is coming even if its current arc would pass over or short.
    // A ball curving toward someone else may still swing into me, so it gets a wide margin;
    // one flying free only counts if it would really hit (a near miss shouldn't bait a press).
    const margin = b.target ? 0.6 : 0.15;
    if (b.target !== myId && (y < -0.2 || y > 2.1 || miss > R + margin)) continue;
    if (miss < R) t -= Math.sqrt(R * R - miss * miss) / Math.sqrt(vv);
    t = Math.max(0, t);
    if (t < 1.2 && (!best || t < best.tti)) best = { b, tti: t };
  }
  return best;
}

function showThreat() {
  if (!threat || !me?.alive) return hud.setThreat(null);
  const { b, tti } = threat;
  const key = `${b.id}:${b.rally}`;
  if (!warned.has(key) && tti < 0.9) {
    warned.add(key);
    sfx.warn();
    if (warned.size > 60) warned.clear();
  }
  if (!settings.ring) return hud.setThreat(b.rally ? { radius: 0, level: '', arrow: null, text: `RALLY ×${b.rally}` } : null);
  const radius = 26 + Math.min(tti, 1.2) * 150;
  const s = world.project(b.pos.x, b.pos.y, b.pos.z);
  let arrow = null;
  if (!s || Math.hypot(s.x - innerWidth / 2, s.y - innerHeight / 2) > radius) {
    const ux = b.pos.x - local.x;
    const uz = b.pos.z - local.z;
    const fwd = ux * Math.sin(local.yaw) + uz * Math.cos(local.yaw);
    const right = -ux * Math.cos(local.yaw) + uz * Math.sin(local.yaw);
    arrow = Math.atan2(right, fwd);
  }
  hud.setThreat({
    radius, arrow,
    level: tti <= 0.1 ? 'now' : tti <= 0.3 ? 'near' : '',
    text: b.rally ? `RALLY ×${b.rally}` : '',
  });
}

function sendInput(t) {
  if (t - local.lastSend < 1 / 30) return;
  local.lastSend = t;
  net.send({
    t: 'in', x: round(local.x, 2), z: round(local.z, 2), yaw: round(local.yaw, 3), pitch: round(local.pitch, 3),
    wt: round(viewTime, 4), tp: local.tp, aim: aim.point, tg: aim.tg,
  });
}

// ------------------------------------------------------------------ events from the server

const nameOf = (id) => net.latest?.players.get(id)?.name ?? '?';
const who = (id) => [nameOf(id), TEAM_CLASS[net.latest?.players.get(id)?.team ?? 0]];

function posOf(id) {
  if (id === myId && me?.alive) return { x: local.x, z: local.z };
  const p = view?.players.get(id) ?? net.latest?.players.get(id);
  return p ? { x: p.x, z: p.z } : null;
}

function volumeFor(id) {
  const p = posOf(id);
  return p ? clamp(1 - Math.hypot(p.x - local.x, p.z - local.z) / 30, 0.25, 1) : 0.5;
}

function onEvent(e) {
  const mine = e.p === myId;
  const pos = posOf(e.p);
  switch (e.k) {
    case 'throw':
      if (!mine) {
        world.man(e.p)?.playThrow();
        sfx.throw(e.power, volumeFor(e.p) * 0.6);
      }
      break;
    case 'hit':
      world.man(e.p)?.flinch();
      if (pos) world.burst(pos.x, 1.2, pos.z, 0xffffff, 1.8);
      if (mine) {
        hud.damage();
        hud.popup(e.ko ? `KNOCKED OUT  −${e.dmg}` : `−${e.dmg} HP`, 'bad');
        sfx.hit();
        if (e.ko) sfx.ko();
      } else if (e.by === myId) {
        hud.popup(`${e.bank ? 'RICOCHET ' : ''}${e.ko ? 'KNOCKOUT' : 'HIT'}  +${e.cash}`, 'good');
        sfx.hit(0.8);
      } else sfx.hit(volumeFor(e.p) * 0.5);
      hud.feed([
        who(e.by), [e.ko ? ' knocked out ' : ' hit '], who(e.p), [`  ${Math.round(e.speed)} m/s, ${e.dmg} dmg`],
        [e.bank ? '  ricochet!' : '', 'gold'], [e.rally ? `  rally ×${e.rally}` : '', 'gold'],
      ]);
      break;
    case 'bounce':
      world.spark(e.x, e.y, e.z, 0xffffff, e.y < 0.5);
      sfx.ricochet(clamp(1 - Math.hypot(e.x - local.x, e.z - local.z) / 30, 0.2, 1));
      break;
    case 'catch':
      // Your own catches/deflects get the popup and gold flash; a ring at the camera would blind you.
      if (pos && !mine) e.perfect ? world.ring(pos.x, 1.3, pos.z, 0xffc940) : world.burst(pos.x, 1.3, pos.z, 0x5dff9b);
      if (mine) {
        local.busyUntil = 0;
        hud.popup(`${e.perfect ? 'PERFECT CATCH' : 'CATCH'}  +${e.cash}`, e.perfect ? 'perfect' : 'good');
        if (e.perfect) hud.perfect();
      }
      sfx.catch(e.perfect && mine, mine ? 1 : volumeFor(e.p) * 0.5);
      if (e.perfect || e.rally) hud.feed([who(e.p), [e.perfect ? ' perfectly caught ' : ' caught '], who(e.by), ["'s ball"]]);
      break;
    case 'deflect':
      if (pos && !mine) world.ring(pos.x, 1.3, pos.z, e.perfect ? 0xffc940 : 0x6ff3ff);
      if (mine) {
        local.busyUntil = 0;
        hud.popup(`${e.perfect ? 'PERFECT ' : ''}DEFLECT ×${e.rally}  +${e.cash}`, e.perfect ? 'perfect' : 'good');
        if (e.perfect) hud.perfect();
      }
      sfx.deflect(e.rally, e.perfect && mine, mine ? 1 : volumeFor(e.p) * 0.6);
      if (e.rally >= 2) hud.feed([who(e.p), [` deflected: rally ×${e.rally}, ${e.speed} m/s`, 'gold']]);
      break;
    case 'dodge':
      if (e.perfect) world.man(e.p)?.perfectDodge();
      if (mine) {
        hud.popup(e.perfect ? `PERFECT DODGE  +${e.cash}` : 'DODGED', e.perfect ? 'perfect' : 'dim');
        if (e.perfect) hud.perfect();
        sfx.dodge(e.perfect);
      }
      break;
    case 'revive':
      hud.feed([who(e.by), [' revived '], who(e.p)]);
      if (mine) hud.popup('REVIVED', 'good');
      if (mine || e.by === myId) sfx.revive();
      break;
    case 'deny':
      if (mine) denied(DENY[e.why] || 'Not now');
      break;
    case 'round':
      if (e.s === 'play') {
        hud.banner('FIGHT!', '', '', 900);
        sfx.beep(true);
      } else if (e.s === 'over') {
        hud.banner(e.w === -1 ? 'DRAW' : `${TEAM[e.w]} WINS`, `Round ${e.n}`, e.w === -1 ? '' : TEAM_CLASS[e.w], 3500);
      } else if (e.s === 'wait') hud.banner('Waiting for players', 'One team is empty', '', 2500);
      break;
    case 'join':
      hud.feed([[e.name, TEAM_CLASS[e.team]], [' joined']]);
      break;
    case 'leave':
      hud.feed([[e.name], [' left']]);
      break;
    case 'team':
      if (mine) hud.popup(e.now ? `You're on ${TEAM[e.team]}` : `Switching to ${TEAM[e.team]} next round`, 'dim');
      break;
    case 'cfg':
      hud.feed([[`Bots fill teams to ${e.fill} (${e.skill})`, 'gold']]);
      break;
  }
}

// ------------------------------------------------------------------ frame loop

function playerStates(t) {
  const out = [];
  for (const p of view.players.values()) {
    if (p.id === myId && me) {
      const actAge = t - local.actionAt;
      out.push({
        id: p.id, team: me.team, isMe: true, x: local.x, z: local.z, yaw: local.yaw, alive: me.alive,
        charging: local.charging, charge: local.charging ? chargePower(t) : 0,
        act: local.action && actAge < 0.4 ? ACT_CODE[local.action] : 0, actAge,
        hasBall: hasBall(), invuln: me.invuln,
      });
    } else {
      out.push({
        id: p.id, team: p.team, isMe: false, x: p.x, z: p.z, yaw: p.yaw, alive: p.alive,
        charging: p.charging, charge: p.charge, act: p.act, actAge: p.actAge, hasBall: p.hasBall, invuln: p.invuln,
      });
    }
  }
  return out;
}

function updateHud(t) {
  const r = net.latest.r;
  const players = net.latest.players;
  hud.setRound(r, players, myId);
  if (r.s === 'count') {
    const n = Math.ceil(r.left);
    if (n !== lastCount && n > 0) {
      lastCount = n;
      hud.banner(String(n), `Round ${r.n}`, '', 1000);
      sfx.beep(false);
    }
  } else lastCount = -1;
  hud.showScores(scoresHeld, players, myId);
  hud.setNet(`${Math.round(net.rtt)} ms · ${Math.round(fps)} fps`);
  if (fillWanted === r.fill) fillWanted = null;
  if (!$('overlay').hidden) {
    $('fillValue').textContent = fillWanted ?? r.fill;
    if ($('skillSelect').value !== r.skill) $('skillSelect').value = r.skill;
  }
  if (!me) return;

  const power = local.charging ? chargePower(t) : 0;
  hud.setVitals(me, cfg, local.charging ? throwCost(power) : 0);
  hud.setThrow({
    alive: me.alive, charging: local.charging, power, cost: throwCost(power),
    speed: throwSpeed(power), damage: damageFor(throwSpeed(power)),
    hasBall: hasBall(), cooldown: Math.max(0, me.cooldown), cooldownMax: cfg.cooldown,
  });
  const reviveCost = r.rc?.[myTeam] ?? cfg.reviveCost;
  const fallen = [...players.values()].some((p) => p.team === myTeam && !p.alive);
  const active = local.action && t < local.actionAt + cfg.actions[local.action].window ? local.action : null;
  hud.setActions(me, cfg, reviveCost, me.alive && fallen && me.cash >= reviveCost && r.s === 'play', active);

  const tags = [];
  for (const p of view.players.values()) {
    if (p.id === myId || !p.alive) continue;
    const s = world.project(p.x, 2.2, p.z);
    if (s && s.onScreen) tags.push({ id: p.id, name: p.name, team: p.team, x: s.x, y: s.y, hp: p.hp, stamina: p.stamina });
  }
  hud.setTags(tags);

  let marker = null;
  let kind = '';
  const target = aim.tg !== null && view.players.get(aim.tg);
  if (me.alive && target) {
    if ((local.charging || hasBall()) && aim.ang <= cfg.assistCone && !isBankShot(target)) kind = 'throw';
    else if (threat && aim.ang <= cfg.deflectCone) kind = 'deflect';
    if (kind) marker = world.project(target.x, 1.2, target.z);
  }
  hud.setAssist(marker, kind);
  showThreat();
  hud.setDead(me.alive || r.s !== 'play' ? null : `You're out. A teammate can revive you (${reviveCost} cash). Move the mouse to look around.`);
}

let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const tMs = performance.now();
  const dt = Math.min(0.1, (tMs - last) / 1000);
  last = tMs;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  const t = tMs / 1000;
  hud.tick();
  if (!cfg || !net.latest) {
    local.yaw += dt * 0.05;      // slow orbit behind the join screen
    placeCamera();
    world.render();
    return;
  }
  syncCourt();
  viewTime = net.viewTime();
  view = net.sample(viewTime);
  me = net.latest.players.get(myId) || null;
  if (me) {
    syncSelf();
    moveLocal(dt, t);
    // A catch/deflect frees your hands the moment it lands (the server does the same), so a
    // second ball right behind the first can be answered before the confirmation arrives.
    const h = local.handled;
    if (h && h.arrive && (local.action === 'catch' || local.action === 'deflect') && t >= h.arrive) {
      if (h.arrive <= local.actionAt + cfg.actions[local.action].window) local.busyUntil = Math.min(local.busyUntil, t);
      h.arrive = null;
    }
    // Holding the throw button while the ball is on cooldown starts the wind-up once it's ready.
    if (input.buttons.has('throw') && me.alive && !local.charging && hasBall() && t >= local.busyUntil
        && combatOpen() && me.stamina >= cfg.throwCost[0]) startCharge();
  } else input.takeMouse();
  placeCamera();
  const balls = displayBalls(view.players.get(myId));
  if (me && me.alive) {
    computeAim();
    threat = findThreat();
  } else {
    threat = null;
    aim.tg = null;
  }
  if (me && me.alive && local.charging && aim.point) {
    const { pts, bounce } = previewPath(throwSpeed(chargePower(t)));
    world.setPreview(pts, bounce);
  } else world.setPreview(null);
  if (me) sendInput(t);
  for (const e of net.takeEvents(viewTime)) onEvent(e);
  world.syncPlayers(playerStates(t), dt);
  world.syncBalls(balls, t);
  world.updateFx(dt, t);
  updateHud(t);
  world.render();
}
requestAnimationFrame(frame);

// Handle for automated tests and console poking.
window.dp = { net, input, local, aim, get me() { return me; }, get threat() { return threat; }, get view() { return view; } };
