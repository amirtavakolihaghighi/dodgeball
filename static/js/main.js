// Game client: joins the server, moves the local player, aims, and draws everything.
//
// The server owns all the rules (balls, hits, stamina, timing). This browser only moves its
// own player (so movement feels instant), shows the world slightly in the past for
// smoothness, and tells the server which moment was on screen whenever a button is pressed.
// The host (whoever plays on the computer running the server) also runs the lobby: teams,
// bots, the rules and the start and end of the match, and may spectate instead of playing.
// Everyone else sees it read-only, and can follow the host's screen while they set things up.
import { Net } from './net.js';
import { Input } from './input.js';
import { World } from './world.js';
import { Hud, TEAM, TEAM_CLASS, regenLimit } from './hud.js';
import { Sfx } from './sfx.js';
import { Lobby } from './lobby.js';
import { RulesEditor } from './rules_ui.js';
import { launchVelocity } from './physics.js';
import { Diag } from './diag.js';
import * as settingsFile from './settings_file.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const clock = () => performance.now() / 1000;
const ACT_CODE = { dodge: 1, catch: 2, deflect: 3 };
const DENY = {
  stamina: 'Not enough stamina', busy: 'Still recovering', noball: 'No ball yet',
  cash: 'Not enough cash', nobody: 'Nobody to revive', round: 'Not now', host: 'Only the host can do that',
  full: 'Team health is already full',
};
// Each team's ball colours, people's and bots' (rules; a player may have their own). Deflected
// balls show their rally colour instead (world.js).
const BALL_COLOR_KEYS = [['BALL_COLOR_RED', 'BALL_COLOR_RED_BOTS'], ['BALL_COLOR_BLUE', 'BALL_COLOR_BLUE_BOTS']];
// Must match sim.py (HAND_FWD, HAND_RIGHT, HAND_UP): balls leave from the right hand.
const HAND_FWD = 0.3;
const HAND_RIGHT = 0.32;
const HAND_UP = 1.45;

const canvas = $('view');
const params = new URLSearchParams(location.search);
const net = new Net();
const input = new Input(canvas);
const world = new World(canvas);
const hud = new Hud();
const sfx = new Sfx();
// The diagnostics log (see diag.js): it reads the clock and a little context from here.
const diag = new Diag();
diag.clock = () => (net.offset === null ? null : performance.now() / 1000 + net.offset);
diag.context = () => ({
  ping: Math.round(net.rtt), state: net.latest?.r.s ?? null, alive: me?.alive ? 1 : 0,
  lock: input.locked ? 1 : 0, interp: Math.round(net.interpDelay * 1000),
});
net.onSnapshot = (now, late) => diag.snapshot(now, late);
net.onStale = (n) => diag.count('stale', n);
net.onReanchor = (ms) => diag.log('clock', { shift: Math.round(ms) });     // every update arrived late: re-anchored
const editor = new RulesEditor(net, () => net.latest?.r.s);
const lobby = new Lobby(net, {
  onStart: () => { sfx.unlock(); input.lock(); },     // the host's click starts the match and enters it
  openRules: () => editor.open(),
  openPlayer: (who) => editor.openFor(who),          // one player's (or bot's) own settings
  exportSettings, importSettings,
});
editor.onMessage = (text, cls) => hud.popup(text, cls);

const settings = { sens: 1, volume: 0.6, ring: true, follow: true };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('dp.settings') || '{}'));
} catch { /* private mode etc: defaults are fine */ }
const saveSettings = () => {
  try { localStorage.setItem('dp.settings', JSON.stringify(settings)); } catch { /* ignore */ }
};
sfx.setVolume(settings.volume);

let cfg = null;
let isHost = false;
// The lobby's rules from the server, live and waiting for the next round, and each player's own settings.
const rules = { defaults: null, active: null, next: null, rv: -1, players: {}, nextPlayers: null };
let lastSync = 0;
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
  charging: false, chargeAt: 0, throwAt: -9, lastSend: 0, handled: null, ignoredAt: -9,
  // Standing still, and the latest hits on me and my team: for the regeneration hint (the server decides).
  stillSince: 0, stillX: 0, stillZ: 0, hurtAt: -99, teamHurtAt: -99,
};
// The host's spectator camera: flies freely, or rides behind a player (follow = their id).
const spec = { x: 0, y: 9, z: -20, yaw: 0, pitch: -0.4, follow: null };
let hostView = null;        // what the host's screen shows (guests): the server's 'hostview' message
const sharedView = { text: '', at: 0 };    // what this host last told the others about its screen
const watching = () => me?.team === -1;

world.buildCourt(13, 7, 1);

// ------------------------------------------------------------------ join & menu

let saved = null;
try { saved = JSON.parse(sessionStorage.getItem('dp.join') || 'null'); } catch { /* ignore */ }
$('nameInput').value = saved?.name || `Player-${100 + Math.floor(Math.random() * 900)}`;
$('playBtn').addEventListener('click', join);
$('nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && join());
if (saved?.joined) join();     // a reloaded tab rejoins under the same name (sessionStorage is per tab); the server gives back its team

function join() {
  myName = $('nameInput').value.trim().slice(0, 16) || 'Player';
  try {
    sessionStorage.setItem('dp.join', JSON.stringify({ name: myName, joined: true }));
  } catch { /* ignore */ }
  $('join').hidden = true;
  sfx.unlock();
  diag.name = myName;
  // ?guest: join without host powers (to see what others see); ?host=KEY: the console's host link
  const extra = { tab: diag.tab, run: diag.run };
  if (params.has('guest')) extra.guest = true;
  if (params.get('host')) extra.hostKey = params.get('host');
  net.connect(myName, extra);
  showMenu();
}

/** The rules changed (or arrived): everything derived from them follows. */
function applyRules(m) {
  cfg = m.cfg;
  rules.active = m.rules;
  rules.next = m.next;
  rules.rv = m.rv;
  rules.players = m.players ?? {};
  rules.nextPlayers = m.nextPlayers ?? null;
  net.interpDelay = cfg.interpDelay;
  net.gravity = cfg.gravity;
  world.setBallRadius(cfg.ballRadius);
  courtKey = '';          // the centre strip may have changed: redraw the court
  editor.setServer(m.rules, m.next, rules.players, rules.nextPlayers);
  lobby.dirty();
}

/** A rule's value for one player: their own setting, or everyone's. */
const ownValue = (name, key) => rules.players[name]?.[key] ?? rules.active[key];
/** The colour of a player's balls (p: a snapshot player). */
const ballColorOf = (p) => (p && p.team >= 0 ? ownValue(p.name, BALL_COLOR_KEYS[p.team][p.bot ? 1 : 0]) : null);

net.on('welcome', (m) => {
  myId = m.id;
  isHost = m.host;
  rules.defaults = m.defaults;
  editor.setup(m.schema, m.defaults, isHost);
  lobby.setHost(isHost, m.cfg.botsMax);
  applyRules(m);
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
  diag.log('welcome', { id: m.id, name: myName, host: m.host, version: m.version, logging: m.logging });
  diag.log('env', envInfo());
  navigator.getBattery?.().then((b) => {
    const note = () => diag.log('battery', { level: Math.round(b.level * 100), charging: b.charging });
    note();
    b.addEventListener('chargingchange', note);
  }).catch(() => { /* not available on this page */ });
  if (m.logging) diag.connect((msg) => net.send(msg));
  $('diagText').textContent = m.logging
    ? 'This game records a log to find the cause of lag: frame rate, connection timing and device info (graphics card, CPU cores, screen). It goes to the host\'s computer by itself. In the game, press L the moment something feels laggy.'
    : 'This server isn\'t saving logs, but you can still save your own.';
  $('hostLogsBtn').hidden = !(isHost && m.logging);
  $('diagWhere').textContent = isHost && m.logDir ? `On this computer the logs are in ${m.logDir}` : '';
});
net.on('rules', applyRules);
net.on('logack', (m) => diag.ack(m.run, m.seq));
net.on('hostview', (m) => { hostView = m.m ? m : null; });
net.on('close', () => {
  diag.log('ws', { closed: true });
  diag.flush();
  $('disconnected').hidden = false;
  document.exitPointerLock?.();
});
$('reconnectBtn').addEventListener('click', () => location.reload());

function showMenu() {
  $('overlay').hidden = false;
  lobby.dirty();
}
$('resumeBtn').addEventListener('click', () => {
  sfx.unlock();
  input.lock();
});
input.onLockChange = (locked) => {
  diag.log('lock', { on: locked });
  $('overlay').hidden = locked;
  if (locked) editor.close();
  else if (myId !== null) showMenu();
};

$('sensInput').value = settings.sens;
$('volInput').value = settings.volume;
$('ringInput').checked = settings.ring;
$('followInput').checked = settings.follow;
$('followInput').addEventListener('change', (e) => {
  settings.follow = e.target.checked;
  saveSettings();
  if (!settings.follow) editor.unfollow();
});
editor.onStopFollowing = () => {        // closing the editor that followed the host: stop following
  settings.follow = false;
  $('followInput').checked = false;
  saveSettings();
};
$('sensInput').addEventListener('input', (e) => { settings.sens = Number(e.target.value); saveSettings(); });
$('volInput').addEventListener('input', (e) => { settings.volume = Number(e.target.value); sfx.setVolume(settings.volume); saveSettings(); });
$('ringInput').addEventListener('change', (e) => { settings.ring = e.target.checked; saveSettings(); });
$('saveLogBtn').addEventListener('click', () => {
  const bytes = diag.download();
  hud.popup(`Log saved to your Downloads folder (${Math.max(1, Math.round(bytes / 1024))} KB)`, 'good');
});
$('hostLogsBtn').addEventListener('click', downloadAllLogs);

/** The host's "Download all logs": every browser's log and the server's, zipped by the server. */
async function downloadAllLogs() {
  const button = $('hostLogsBtn');
  button.disabled = true;
  try {
    diag.flush();
    await new Promise((resolve) => setTimeout(resolve, 500));     // let our own latest lines arrive
    const key = params.get('host');
    const res = await fetch(`/logs/download${key ? `?key=${encodeURIComponent(key)}` : ''}`);
    if (!res.ok) throw new Error(await res.text());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = res.headers.get('X-Filename') ?? 'dodgeball-logs.zip';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    hud.popup('All logs saved to your Downloads folder', 'good');
  } catch (e) {
    hud.popup(`Couldn't get the logs: ${e.message}`, 'bad');
  } finally {
    button.disabled = false;
  }
}

/** Anyone: save the whole setup (every rule and each player's own settings) as a file. What waits
 *  for the next round counts: it's what the host chose. */
function exportSettings() {
  if (!rules.active) return;
  const name = settingsFile.setupFileName();
  settingsFile.download(name, settingsFile.setupFile(rules.next ?? rules.active, rules.nextPlayers ?? rules.players));
  hud.popup(`Settings saved to your Downloads folder: ${name}`, 'good');
}

/** The host: load a settings file. It replaces the whole setup: at once in the lobby, from the
 *  next round during a match. */
async function importSettings() {
  const file = await settingsFile.pickFile();
  if (file) importSetupText(file.text, file.name);
}

function importSetupText(text, fileName = 'the file') {
  let data;
  try {
    data = settingsFile.readSetup(text, new Set(Object.keys(rules.defaults)));
  } catch (e) {
    hud.popup(e.message, 'bad');
    return false;
  }
  net.send({ t: 'rules', import: data });
  const now = ['lobby', 'wait'].includes(net.latest?.r.s);
  hud.popup(`Loaded ${fileName}${now ? '' : ': it applies from the next round'}`, 'good');
  return true;
}

/** The device, for the log: what frame rate and timing depend on. */
function envInfo() {
  const gl = world.renderer.getContext();
  let gpu = null;
  let vendor = null;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    vendor = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
  } catch { /* not available */ }
  const c = navigator.connection;
  return {
    ua: navigator.userAgent, platform: navigator.userAgentData?.platform ?? navigator.platform,
    cores: navigator.hardwareConcurrency ?? null, mem_gb: navigator.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height}`, dpr: devicePixelRatio, window: `${innerWidth}x${innerHeight}`,
    canvas: `${canvas.width}x${canvas.height}`, pixel_ratio: world.renderer.getPixelRatio(), gpu, vendor,
    net: c ? { type: c.effectiveType, rtt: c.rtt, down: c.downlink } : null,
    url: location.search.replace(/([?&]host=)[^&]*/, '$1(hidden)'), tab: diag.tab, run: diag.run, lang: navigator.language,
  };
}

// ------------------------------------------------------------------ actions

input.onPress = (a) => {
  if (a === 'scores') { scoresHeld = true; return; }
  if (a === 'mark') {
    diag.log('mark', diag.context());
    hud.popup('Laggy moment noted in the log. Thanks!', 'dim');
    return;
  }
  if (a === 'ring') {
    settings.ring = !settings.ring;
    $('ringInput').checked = settings.ring;
    saveSettings();
    hud.popup(`Timing ring ${settings.ring ? 'on' : 'off'}`, 'dim');
    return;
  }
  if (watching()) {
    if (a === 'throw') followNext(1);
    else if (a === 'catch') followNext(-1);
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

const combatOpen = () => ['lobby', 'wait', 'play'].includes(net.latest?.r.s);
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
  if (hi <= lo) return me.stamina >= lo ? held : 0;                     // every throw costs the same
  return Math.min(held, clamp((me.stamina - lo) / (hi - lo), 0, 1));   // stamina caps the power
}

function denied(text) {
  hud.popup(text, 'dim');
  sfx.deny();
}

/** A press during the recovery after your last dodge, catch or deflect does nothing. Say so
 *  (it used to be silent, which felt like a lost key press), and note it in the log. */
function ignored(kind, t) {
  diag.log('ignored', { a: kind, left: round(local.busyUntil - t, 3), after: local.action, tti: threat ? round(threat.tti, 3) : null });
  if (t - local.ignoredAt < 0.4) return;
  local.ignoredAt = t;
  denied(`Still recovering (${(local.busyUntil - t).toFixed(1)}s)`);
}

function startCharge() {
  const t = clock();
  if (!combatOpen()) return;
  if (t < local.busyUntil) return ignored('throw', t);
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
  if (!combatOpen()) return;
  if (t < local.busyUntil) return ignored(kind, t);
  const spec = cfg.actions[kind];
  if (me.stamina < spec.cost) {
    hud.flashStamina();
    return denied(DENY.stamina);
  }
  local.action = kind;
  local.actionAt = t;
  local.busyUntil = t + (spec.window + spec.recovery) * cfg.lockoutScale;    // 0: press again at once
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
  diag.log('press', { a: kind, wt: round(net.viewTime(), 3), tti: threat ? round(threat.tti, 3) : null, ball: threat?.b.id ?? null });
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
    local.stillSince = local.hurtAt = clock();      // the server starts both over at a (re)spawn
    local.stillX = me.x;
    local.stillZ = me.z;
  }
  if (me.team !== myTeam || !document.title.startsWith(myName)) {
    if (me.team === -1 && myTeam !== -1) startSpectating();
    myTeam = me.team;
    hud.setIdentity(myName, myTeam);
    document.title = `${myName} · ${TEAM[myTeam] ?? 'SPECTATING'} | Dodgeball`;
  }
}

// ------------------------------------------------------------------ the host's spectator camera

/** Just started watching: fly from where the camera is, looking at the middle of the court. */
function startSpectating() {
  const c = world.camera.position;
  Object.assign(spec, { x: c.x, y: Math.max(3, c.y), z: c.z, yaw: Math.atan2(-c.x, -c.z), pitch: -0.4, follow: null });
}

/** Mouse looks; W A S D fly where you look, Space / Shift go up and down. Flying stops following. */
function moveSpectator(dt) {
  const [mx, my] = input.takeMouse();
  const k = 0.0022 * settings.sens;
  spec.yaw -= mx * k;
  spec.pitch = clamp(spec.pitch - my * k, -1.45, 1.2);
  const { f, r } = input.axis();
  const up = (input.keys.has('Space') ? 1 : 0) - (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') ? 1 : 0);
  if (spec.follow !== null && (f || r || up)) spec.follow = null;
  if (spec.follow !== null) return;
  const speed = 14;
  const sy = Math.sin(spec.yaw);
  const cy = Math.cos(spec.yaw);
  const { L, W } = court();
  spec.x = clamp(spec.x + (sy * f - cy * r) * speed * dt, -L - 30, L + 30);
  spec.z = clamp(spec.z + (cy * f + sy * r) * speed * dt, -W - 30, W + 30);
  spec.y = clamp(spec.y + up * speed * dt, 0.5, 60);
}

/** Ride behind the next (step 1) or previous (-1) player still standing. */
function followNext(step) {
  const list = [...(view?.players.values() ?? [])].filter((p) => p.team >= 0 && p.alive).sort((a, b) => a.team - b.team || a.id - b.id);
  if (!list.length) {
    spec.follow = null;
    return;
  }
  const i = list.findIndex((p) => p.id === spec.follow);
  const next = list[i < 0 ? (step > 0 ? 0 : list.length - 1) : (i + step + list.length) % list.length];
  spec.follow = next.id;
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

/** Standing still (health regeneration), judged like the server does: moving more than 2 cm from
 *  where you stopped is walking; a dodge's dash isn't. Only for the hint on the HUD. */
function trackStill(t) {
  if (Math.hypot(local.x - local.stillX, local.z - local.stillZ) > 0.02) {
    if (t > local.dashUntil + 0.06) local.stillSince = t;
    local.stillX = local.x;
    local.stillZ = local.z;
  }
}

/** What to say about standing still and regeneration, or null: only when standing still matters,
 *  there's health to regain and the pause after a hit is over. bar: my team's [health, size]. */
function regenHint(t, bar) {
  const r = bar ? cfg.teamRegen : cfg.regen;
  if (!r?.on || r.still === 'off' || !me?.alive || (!bar && cfg.teamHealth)) return null;
  const [hp, full] = bar ?? [me.hp, cfg.maxHp];
  if (hp >= regenLimit(r, full) - 0.5 || t - (bar ? local.teamHurtAt : local.hurtAt) < r.delay) return null;
  const counts = t - local.stillSince >= r.stillTime;
  return [REGEN_HINTS[`${bar ? 'team' : 'own'}.${r.still}.${counts ? 'still' : 'moving'}`], counts ? 'on' : ''];
}
const REGEN_HINTS = {
  'own.faster.moving': 'Stand still to regenerate faster', 'own.faster.still': 'Standing still: regenerating faster',
  'own.only.moving': 'Stand still to regenerate', 'own.only.still': 'Standing still: regenerating',
  'team.faster.moving': "Stand still to speed up the team's bar", 'team.faster.still': "Standing still: speeding up the team's bar",
  'team.only.moving': "Stand still: the team's bar only fills while someone stands", 'team.only.still': "Standing still: filling the team's bar",
};

/** Over the right shoulder of someone at (x, z), like Fortnite: the crosshair is the aim. */
function shoulderCamera(x, z, yaw, pitch) {
  const cam = world.camera;
  const cp = Math.cos(pitch);
  const dx = Math.sin(yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = Math.cos(yaw) * cp;
  const px = x - Math.cos(yaw) * 0.75;
  const pz = z + Math.sin(yaw) * 0.75;
  const py = 1.75;
  const dist = 4.4;
  cam.position.set(px - dx * dist, Math.max(0.3, py - dy * dist + 0.55), pz - dz * dist);
  cam.lookAt(px + dx * 20, py + dy * 20, pz + dz * 20);
}

function placeCamera() {
  const cam = world.camera;
  if (watching()) {
    const p = spec.follow !== null ? view?.players.get(spec.follow) : null;
    if (p) {
      shoulderCamera(p.x, p.z, p.yaw, clamp(p.pitch, -0.6, 0.8));
      // Flying off starts from this view.
      Object.assign(spec, { x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw: p.yaw, pitch: clamp(p.pitch, -0.6, 0.8) });
    } else {
      spec.follow = null;
      const cp = Math.cos(spec.pitch);
      cam.position.set(spec.x, spec.y, spec.z);
      cam.lookAt(spec.x + Math.sin(spec.yaw) * cp * 10, spec.y + Math.sin(spec.pitch) * 10, spec.z + Math.cos(spec.yaw) * cp * 10);
    }
  } else if (me && me.alive) {
    shoulderCamera(local.x, local.z, local.yaw, local.pitch);
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
  const { normalKeep: kn, tangentKeep: kt, minSpeed, max: maxBounces } = cfg.ricochet;
  let [x, y, z] = handPos();
  let [vx, vy, vz] = launchVelocity([x, y, z], aim.point, speed, cfg.gravity);
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
      if (bounce || maxBounces < 1) break;
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
 *  against where it last knew me, and that offset is what this browser is ahead by. With
 *  sidestep compensation the server judges them against my screen instead, so no shift. */
function displayBalls(viewMe) {
  const out = [];
  const shift = !cfg.sidestepComp && viewMe && viewMe.alive && me?.alive;
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
    // The thrower's colour (theirs, or their team's people's or bots'); a thrower who left: their team's.
    b.color = ballColorOf(net.latest.players.get(b.owner)) ?? rules.active[BALL_COLOR_KEYS[b.team]?.[0]];
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
  diag.count('ins');
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
  if ((mine && ['hit', 'catch', 'deflect', 'dodge', 'deny', 'sidestep'].includes(e.k)) || e.k === 'round' || e.k === 'match') diag.log('ev', e);
  switch (e.k) {
    case 'throw':
      if (!mine) {
        world.man(e.p)?.playThrow();
        sfx.throw(e.power, volumeFor(e.p) * 0.6);
      }
      break;
    case 'hit': {
      world.man(e.p)?.flinch();
      if (pos) world.burst(pos.x, 1.2, pos.z, 0xffffff, 1.8);
      if (mine) local.hurtAt = clock();               // regeneration's pause starts over
      if (e.bar && net.latest?.players.get(e.p)?.team === myTeam) local.teamHurtAt = clock();
      if (mine) {
        hud.damage();
        // Why it got through: your press had just ended, or you had just stopped another ball.
        const why = e.early ? `TOO EARLY (${e.early.toFixed(2)} s)  ` : e.second ? 'SECOND BALL  ' : '';
        // e.bar: team health, it came off the team's bar (and a knockout takes the whole team down)
        const out = e.bar ? `YOUR TEAM IS OUT  −${e.dmg}` : `KNOCKED OUT  −${e.dmg}`;
        hud.popup(`${why}${e.ko ? out : `−${e.dmg} ${e.bar ? 'team health' : 'HP'}`}`, 'bad');
        sfx.hit();
        if (e.ko) sfx.ko();
      } else if (e.by === myId) {
        hud.popup(`${e.bank ? 'RICOCHET ' : ''}${e.ko ? (e.bar ? 'TEAM KNOCKOUT' : 'KNOCKOUT') : 'HIT'}  +${e.cash}`, 'good');
        sfx.hit(0.8);
      } else sfx.hit(volumeFor(e.p) * 0.5);
      const team = net.latest?.players.get(e.p)?.team ?? 0;
      const victim = e.ko && e.bar ? [`${TEAM[team]}, the whole team`, TEAM_CLASS[team]] : who(e.p);
      hud.feed([
        who(e.by), [e.ko ? ' knocked out ' : ' hit '], victim, [`  ${Math.round(e.speed)} m/s, ${e.dmg} dmg`],
        [e.bank ? '  ricochet!' : '', 'gold'], [e.rally ? `  rally ×${e.rally}` : '', 'gold'],
      ]);
      break;
    }
    case 'heal':          // team health: someone spent cash on health for their team's bar
      hud.feed([who(e.p), [` bought +${e.hp} team health (${e.cost} cash)`]]);
      if (mine) hud.popup(`+${e.hp} TEAM HEALTH  −${e.cost} cash`, 'good');
      if (mine || e.team === myTeam) sfx.revive();
      break;
    case 'sidestep':      // it missed: on my screen I had already stepped out of its way
      if (mine) hud.popup('SIDESTEPPED', 'dim');
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
        if (e.m !== undefined) hud.banner(`${TEAM[e.m]} WINS THE MATCH`, `Round ${e.n}`, TEAM_CLASS[e.m], 3800);
        else hud.banner(e.w === -1 ? 'DRAW' : `${TEAM[e.w]} WINS`, `Round ${e.n}`, e.w === -1 ? '' : TEAM_CLASS[e.w], 3500);
      } else if (e.s === 'wait') hud.banner('Waiting for players', 'One team is empty', '', 2500);
      break;
    case 'join':
      hud.feed([[e.name, TEAM_CLASS[e.team]], [' joined']]);
      break;
    case 'leave':
      hud.feed([[e.name], [' left']]);
      break;
    case 'team':     // the host moved someone
      if (e.cancel) {
        if (mine) hud.popup('Your team change was cancelled', 'dim');
      } else if (mine) hud.popup(e.now ? `The host put you on ${TEAM[e.team]}` : `You'll play for ${TEAM[e.team]} from the next round`, 'dim');
      else hud.feed([who(e.p), [` moves to ${TEAM[e.team]}${e.now ? '' : ' next round'}`]]);
      break;
    case 'shuffle':
      hud.feed([[`The host shuffled the teams${e.now ? '' : ' (from the next round)'}`, 'gold']]);
      break;
    case 'spectate':
      if (mine) hud.popup(e.on ? (e.now ? 'Spectating' : 'You spectate from the next round') : (e.now ? 'Back in the game' : 'You play again from the next round'), 'dim');
      else hud.feed([who(e.p), [e.on ? ` spectates${e.now ? '' : ' from the next round'}` : ` plays again${e.now ? '' : ' from the next round'}`]]);
      break;
    case 'rules': {
      const more = e.n > e.names.length ? ` and ${e.n - e.names.length} more` : '';
      hud.feed([[e.discard ? 'The host cancelled the waiting rule changes'
        : `Rules changed: ${e.names.join(', ')}${more}${e.next ? ' (from the next round)' : ''}`, 'gold']]);
      break;
    }
    case 'match':
      if (e.s === 'end') {
        const how = e.w === null ? 'The host ended the match' : `${TEAM[e.w]} won the match`;
        hud.banner('BACK TO THE LOBBY', `${how}: ${e.score[0]} – ${e.score[1]}`, e.w === null ? '' : TEAM_CLASS[e.w], 3500);
        document.exitPointerLock?.();       // everyone sees the lobby with the result
        showMenu();
      }
      break;
  }
}

// ------------------------------------------------------------------ frame loop

function playerStates(t) {
  const out = [];
  for (const p of view.players.values()) {
    if (p.team < 0 || (p.id === myId && me && me.team < 0)) continue;     // spectating: nobody to draw
    if (p.id === myId && me) {
      const actAge = t - local.actionAt;
      out.push({
        id: p.id, team: me.team, isMe: true, x: local.x, z: local.z, yaw: local.yaw, alive: me.alive,
        charging: local.charging, charge: local.charging ? chargePower(t) : 0,
        act: local.action && actAge < 0.4 ? ACT_CODE[local.action] : 0, actAge,
        hasBall: hasBall(), invuln: me.invuln, ballColor: ballColorOf(me),
      });
    } else {
      out.push({
        id: p.id, team: p.team, isMe: false, x: p.x, z: p.z, yaw: p.yaw, alive: p.alive,
        charging: p.charging, charge: p.charge, act: p.act, actAge: p.actAge, hasBall: p.hasBall, invuln: p.invuln,
        ballColor: ballColorOf(p),
      });
    }
  }
  return out;
}

function updateHud(t) {
  const r = net.latest.r;
  const players = net.latest.players;
  hud.setRound(r, players, myId);
  hud.setTeamHealth(r.th, cfg.teamRegen);
  if (r.s === 'count') {
    const n = Math.ceil(r.left);
    if (n !== lastCount && n > 0) {
      lastCount = n;
      hud.banner(String(n), r.n === 1 ? 'The match is starting' : `Round ${r.n}`, '', 1000);
      sfx.beep(false);
    }
  } else lastCount = -1;
  hud.showScores(scoresHeld, players, myId);
  hud.setNet(`${Math.round(net.rtt)} ms · ${Math.round(fps)} fps`);
  const lobbyOn = r.s === 'lobby';
  const spectating = watching();
  hud.setWatching(spectating);
  hud.setHint(spectating
    ? spec.follow !== null ? `Spectating ${nameOf(spec.follow)} · LMB / RMB: next / previous player · W A S D: fly free · Esc: menu`
      : 'Spectating · Mouse: look · W A S D: fly · Space / Shift: up / down · LMB: follow a player · Esc: menu'
    : !lobbyOn ? (r.s === 'wait' ? 'Waiting for players: one team is empty' : '')
      : isHost ? 'Lobby warm-up · press Esc to set up teams and rules, then Start match' : 'Lobby warm-up · the host starts the match');
  followHost();
  if (!$('overlay').hidden) {
    lobby.update(net.latest, myId, rules);
    const s = diag.status();
    const text = !s.sending ? `${s.lines} lines logged, kept in this browser`
      : s.waiting ? `${s.lines} lines logged; ${s.waiting} not on the host's computer yet` : `${s.lines} lines logged, all on the host's computer`;
    if ($('diagStatus').textContent !== text) $('diagStatus').textContent = text;
  }
  editor.tick();
  // A rules update went missing (the snapshot knows a newer version): ask for it again.
  if (r.rv !== rules.rv && rules.rv >= 0) {
    if (!lastSync) lastSync = t;
    else if (t - lastSync > 1) {
      lastSync = t;
      net.send({ t: 'sync' });
    }
  } else lastSync = 0;
  if (!me) return;
  if (spectating) {
    const tags = [];
    for (const p of view.players.values()) {
      const s = p.alive && p.team >= 0 ? world.project(p.x, 2.2, p.z) : null;
      if (s && s.onScreen) tags.push(tagFor(p, s));
    }
    hud.setTags(tags);
    hud.setAssist(null, '');
    hud.setThreat(null);
    hud.setDead(null);
    return;
  }

  const power = local.charging ? chargePower(t) : 0;
  const bar = r.th?.[myTeam] ?? null;         // team health: my team's bar, [health, size]
  hud.setVitals(me, cfg, local.charging ? throwCost(power) : 0, bar);
  hud.setRegenHint(regenHint(t, bar));
  hud.setThrow({
    alive: me.alive, charging: local.charging, power, cost: throwCost(power),
    speed: throwSpeed(power), damage: damageFor(throwSpeed(power)),
    hasBall: hasBall(), cooldown: Math.max(0, me.cooldown), cooldownMax: cfg.cooldown,
  });
  // R: a revive's price, or with team health a health pack's (0: all your cash).
  const reviveCost = r.rc?.[myTeam] ?? cfg.reviveCost;
  let canSpend;
  if (cfg.teamHealth) {
    canSpend = me.alive && r.s === 'play' && !!bar && bar[0] < bar[1] && (cfg.teamHeal.mode === 'pack' ? me.cash >= reviveCost : me.cash > 0);
  } else {
    const fallen = [...players.values()].some((p) => p.team === myTeam && !p.alive);
    canSpend = me.alive && fallen && me.cash >= reviveCost && r.s === 'play';
  }
  const active = local.action && t < local.actionAt + cfg.actions[local.action].window ? local.action : null;
  hud.setActions(me, cfg, reviveCost, canSpend, active);

  const tags = [];
  for (const p of view.players.values()) {
    if (p.id === myId || !p.alive) continue;
    const s = world.project(p.x, 2.2, p.z);
    if (s && s.onScreen) tags.push(tagFor(p, s));
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
  hud.setDead(me.alive || r.s !== 'play' ? null : `You're out. A teammate can revive you (${reviveCost} ${cfg.teamCash ? 'team cash' : 'cash'}). Move the mouse to look around.`);
}

/** A name tag: health and stamina as a share of that player's own (team health: no health, it's the team's). */
function tagFor(p, s) {
  const hp = cfg.teamHealth ? null : (100 * p.hp) / ownValue(p.name, 'MAX_HP');
  return { id: p.id, name: p.name, team: p.team, x: s.x, y: s.y, hp, stamina: (100 * p.stamina) / ownValue(p.name, 'MAX_STAMINA') };
}

/** Guests: show what the host is doing in the menus, and (if they follow) open the same rules. */
function followHost() {
  if (isHost) {
    $('hostViewBox').hidden = true;
    return;
  }
  const parts = editor.describe(hostView);
  hud.setHostLive(parts);
  $('hostViewBox').hidden = !hostView;
  const text = parts ?? [['The host is playing.']];
  const sig = JSON.stringify(text);
  if ($('hostViewText').dataset.sig !== sig) {
    $('hostViewText').dataset.sig = sig;
    $('hostViewText').replaceChildren(...text.map(([s, bold]) => {
      const span = document.createElement(bold ? 'b' : 'span');
      span.textContent = s;
      return span;
    }));
  }
  const want = settings.follow && !$('overlay').hidden && hostView?.m === 'rules';
  if (want && editor.following !== hostView) editor.follow(hostView);
  else if (!want && editor.following) editor.unfollow();
}

/** The host tells the server what their screen shows, a few times a second at most. */
function shareHostView(t) {
  if (!isHost) return;
  const v = editor.hostView() ?? { m: $('overlay').hidden ? 'game' : 'menu' };
  const text = JSON.stringify(v);
  if (text === sharedView.text || t - sharedView.at < 0.12) return;
  sharedView.text = text;
  sharedView.at = t;
  net.send({ t: 'hostview', ...v });
}

let last = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const tMs = performance.now();
  const frozen = drawFrame(tMs);
  diag.frame(tMs, performance.now() - tMs, frozen);
}

/** One frame. Returns true when no newer world update existed to show, so the picture of the
 *  other players and the balls stood still: what the diagnostics log calls "frozen". */
function drawFrame(tMs) {
  const dt = Math.min(0.1, (tMs - last) / 1000);
  last = tMs;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  const t = tMs / 1000;
  hud.tick();
  if (!cfg || !net.latest) {
    local.yaw += dt * 0.05;      // slow orbit behind the join screen
    placeCamera();
    world.render();
    return false;
  }
  syncCourt();
  viewTime = net.viewTime();
  view = net.sample(viewTime);
  me = net.latest.players.get(myId) || null;
  if (me) {
    syncSelf();
    if (watching()) moveSpectator(dt);
    else {
      moveLocal(dt, t);
      trackStill(t);
    }
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
  if (me && !watching()) sendInput(t);
  for (const e of net.takeEvents(viewTime)) onEvent(e);
  world.syncPlayers(playerStates(t), dt);
  world.syncBalls(balls, t);
  world.updateFx(dt, t);
  updateHud(t);
  shareHostView(t);
  world.render();
  return viewTime > net.latest.st;
}
requestAnimationFrame(frame);

// Handle for automated tests and console poking.
window.dp = {
  net, input, local, aim, world, lobby, editor, rules, diag, showMenu, spec, followNext,
  exportSettings, importSetupText, settingsFile, ownValue, ballColorOf,
  get hostView() { return hostView; },
  get me() { return me; }, get threat() { return threat; }, get view() { return view; }, get cfg() { return cfg; }, get isHost() { return isHost; },
};
