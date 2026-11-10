// The moves page (moves.html): every move in docs/ANIMATIONS.md, played by the game's own athlete
// in the game's own hall: looped, slowed down, a frame at a time, from any side, with the time of
// every moment. It runs the game's own code (world.js, athlete.js) on a script of what the player
// does (move_scenes.js), so what it shows is what a match shows. Claude can't see motion, so a
// moment can be copied as a link (the move, the time, the camera) that opens exactly as it was.
import * as THREE from 'three';
import { OrbitControls } from '/static/vendor/addons/controls/OrbitControls.js';
import { World } from './world.js';
import { SCENES, SECTIONS, ScenePlayer, DT, DEFAULT_TIMING, clipInfo } from './move_scenes.js';
import { createEditor, EDITABLE } from './move_edit.js';

const $ = (id) => document.getElementById(id);
const FRAME = 1 / 60;                          // a frame of a 60 Hz screen
const PER_FRAME = Math.round(FRAME / DT);      // the page's steps in one
const ID = 1;                                  // the player's id: their skin and hair come from it
const SEED = 20261104;                         // the page's own chance: a scene plays the same every time
const SPEEDS = [1, 0.5, 0.25, 0.1];
const CHEST = 1.25;                            // the height the camera looks at: the athlete sits low, under the move's notes
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (t) => (Math.abs(t) < 5e-4 ? 0 : t).toFixed(3);
const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');     // only the picture (pictures of a moment)

// ------------------------------------------------------------------ the game's world, on this page

const canvas = $('view');
const world = new World(canvas);
world.resize = function resize() {             // the picture fills the page beside the list, above the bar
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  this.renderer.setSize(w, h, false);
  this.camera.aspect = w / h;
  this.camera.updateProjectionMatrix();
};
// the bar at the bottom grows with the moments it lists: the picture ends where it starts
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--bar', `${$('bar').offsetHeight}px`);
  world.resize();
}).observe($('bar'));
world.resize();
world.buildCourt(13, 7, 1);                    // the game's court before a match sets its size (main.js)
world.warmUp();                                // every effect's shader now, not in the middle of a move
const PIXELS = Math.min(devicePixelRatio, 1.5);

// The timings the moves stretch to: the game's (it keeps them in this browser for this page), or the defaults.
const TIMING_FIELDS = [
  ['dash.time', 'Dash duration', 's'], ['dash.speed', 'Dash speed', 'm/s'],
  ['actions.dodge.window', 'Dodge window', 's'], ['actions.dodge.recovery', 'Dodge recovery', 's'],
  ['actions.catch.window', 'Catch window', 's'], ['actions.catch.recovery', 'Catch recovery', 's'],
  ['actions.deflect.window', 'Deflect window', 's'], ['actions.deflect.recovery', 'Deflect recovery', 's'],
  ['chargeTime', 'Charge time', 's'], ['walk', 'Run speed', 'm/s'], ['chargeWalk', 'Speed while charging', 'm/s'],
  ['defendWalk', 'Speed while catching or deflecting', 'm/s'], ['cooldown', 'New ball after', 's'],
];
const getPath = (o, path) => path.split('.').reduce((v, k) => v?.[k], o);
const setPath = (o, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((v, k) => v[k], o)[last] = value;
};
/** A full set of timings: any number missing from what was kept is the default. */
function complete(t) {
  const out = JSON.parse(JSON.stringify(DEFAULT_TIMING));
  for (const [path] of TIMING_FIELDS) {
    const v = getPath(t, path);
    if (typeof v === 'number' && Number.isFinite(v)) setPath(out, path, v);
  }
  if (Array.isArray(t?.throwSpeed)) out.throwSpeed = [...t.throwSpeed];
  return out;
}
let shared = null;
try {
  shared = JSON.parse(localStorage.getItem('dp.timing') || 'null');
} catch { /* nothing kept */ }
const GAME_TIMING = shared?.now ? complete(shared.now) : null;
const DEFAULTS = shared?.defaults ? complete(shared.defaults) : complete(null);

const view = {
  scene: null, player: null, clips: null, playing: true, speed: 1, loop: true, follow: true, ball: true,
  team: 0, head: 'helmet', low: false, cam: 'front', timing: complete(GAME_TIMING ?? DEFAULTS), scrubbing: false,
  timingFrom: GAME_TIMING ? 'game' : 'defaults',
};
let pendingSeek = null;       // a step to go to, at the next frame (dragging the timeline)
let acc = 0;                  // time to play that hasn't made a whole step yet
let editor = null;            // the moves placed by hand, changed here (move_edit.js)

// The page's own chance (mulberry32), started over with every scene, so the same moment always
// looks the same: the impact freeze's shudder, a flinch's pick. Set once the hall is built.
let rngState = SEED;
const random = () => {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ------------------------------------------------------------------ playing a scene

const noCrowd = () => {};

/** The scene from its very first step: a new figure, no effects, the same chance. */
function restart() {
  const P = view.player;
  world.syncPlayers([], 0);
  world.syncBalls([], 0);
  world.clearFx();
  world.cheering = 0;
  world.crowdT = -Infinity;        // the crowd moves on with time, and time starts over here
  rngState = SEED;
  P.reset();
  world.round = P.roundAt(P.t);
  world.syncPlayers([P.state()], 0);
  const man = world.man(ID);
  if (man.meRing) man.meRing.visible = false;     // the game's ring under your own feet
  if (man.athlete) man.athlete.clock = 0;          // its idle and guard start at their start
  advance(0, true);
}

/** One step of the page (1/120 s): the game's events first, then the player's new state, as a
 *  frame of the game does them (main.js drawFrame). quiet: on the way to a moment, unseen. */
function step(quiet) {
  const P = view.player;
  const t0 = P.t;
  const s = P.next();
  const t = P.t;
  const man = world.man(ID);
  for (const e of P.eventsIn(t0, t)) fire(man, e);
  world.round = P.roundAt(t);
  world.syncPlayers([s], DT);
  world.syncBalls(view.ball ? P.ballsAt(t) : [], t);
  if (quiet) world.moveCrowd = noCrowd;            // the crowd only needs placing at the end
  world.updateFx(DT, t);
  if (quiet) delete world.moveCrowd;
}

/** What the game's events (main.js onEvent) do to the figure. */
function fire(man, e) {
  if (!man) return;
  switch (e.type) {
    case 'style':
      if (man.athlete) man.athlete.forceStyle = e.style;
      break;
    case 'throw':
      man.playThrow();
      break;
    case 'hit':
      man.impact(e.ko ? 0.15 : 0.085, { speed: e.speed, from: e.from });
      if (e.flinch && man.athlete) man.athlete.flinch = e.flinch;
      if (e.ko) world.cheer(0.5);
      break;
    case 'catch':
      man.caught();
      break;
    case 'deflect':
      man.deflected();
      break;
    case 'perfect':
      man.perfectDodge(e.seed);
      break;
    case 'cheer':
      world.cheer(e.amount);
      break;
    default:
  }
}

function advance(n, quiet = false) {
  const P = view.player;
  while (P.n < n) step(quiet);
  if (quiet) world.moveCrowd(P.t);
}

/** To a step of the scene: from where it is if that's later, from the start if it's earlier. */
function seekStep(n) {
  const P = view.player;
  n = clamp(Math.round(n), 0, P.lastStep);
  if (n < P.n) restart();
  advance(n, true);
}

/** The scene played again from its start to t (or where it is), with the moves as they are now
 *  (the editor changed them). */
function resim(t = null) {
  const P = view.player;
  const n = t === null ? P.n : clamp(Math.round(t / DT), 0, P.lastStep);
  restart();
  advance(n, true);
  showTime(true);
}

/** ...and made again first (the editor moved a key moment: the timeline's marks move too). */
function rebuild(t = null) {
  const n = t === null ? view.player.n : Math.round(t / DT);
  compile();
  restart();
  advance(clamp(n, 0, view.player.lastStep), true);
  showTime(true);
}

/** The scene made again (another scene, other timings, another team): its own player and timeline. */
function compile() {
  world.setTiming(view.timing);
  view.player = new ScenePlayer(view.scene, view.timing, view.clips, { team: view.team, id: ID });
  buildTimeline();
}

/** Made again at the same moment (a switch changed what it looks like). */
function refresh() {
  const n = view.player ? view.player.n : 0;
  compile();
  restart();
  seekStep(Math.min(n, view.player.lastStep));
  placeCamera(true);
  showTime(true);
  updateHash();
}

function select(id, { t = 0, play = true } = {}) {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) return false;
  view.scene = scene;
  compile();
  restart();
  seekStep(t / DT);
  view.playing = play;
  acc = 0;
  showMove();
  editor?.sceneChanged();
  placeCamera(true);
  showPlay();
  showTime(true);
  updateHash();
  return true;
}

// ------------------------------------------------------------------ the camera

const controls = new OrbitControls(world.camera, canvas);
controls.minDistance = 0.4;
controls.maxDistance = 45;
controls.addEventListener('start', () => {
  if (view.cam === 'custom') return;
  view.cam = 'custom';
  showCams();
});
controls.addEventListener('end', () => updateHash());

// Where each view looks from, in the player's frame: metres ahead, to the right, above the chest.
const CAMS = {
  front: [3.4, 0, 0.3], back: [-3.4, 0, 0.5], left: [0, -3.4, 0.3], right: [0, 3.4, 0.3], above: [-0.5, 0, 4.6], opponent: [14, 0, 1.3],
};

/** The camera for the view chosen (follow: along with the player; a view picked: placed afresh). */
function placeCamera(fresh = false) {
  const man = world.man(ID);
  if (!man) return;
  const p = man.root.position;
  const yaw = man.root.rotation.y;
  const cam = world.camera;
  if (view.follow || fresh) {
    const d = new THREE.Vector3(p.x, CHEST, p.z).sub(controls.target);
    controls.target.add(d);
    if (!fresh || view.cam === 'custom') cam.position.add(d);
  }
  if (view.cam === 'yours') {                       // the game's own camera (main.js shoulderCamera, level)
    const dx = Math.sin(yaw);
    const dz = Math.cos(yaw);
    const px = p.x - Math.cos(yaw) * 0.75;
    const pz = p.z + Math.sin(yaw) * 0.75;
    cam.position.set(px - dx * 4.4, 1.75 + 0.55, pz - dz * 4.4);
    cam.lookAt(px + dx * 20, 1.75, pz + dz * 20);
    return;
  }
  if (fresh && CAMS[view.cam]) {
    const [f, r, u] = CAMS[view.cam];
    const fwd = [Math.sin(yaw), Math.cos(yaw)];
    const right = [-Math.cos(yaw), Math.sin(yaw)];
    cam.position.set(controls.target.x + fwd[0] * f + right[0] * r, CHEST + u, controls.target.z + fwd[1] * f + right[1] * r);
  }
  controls.update();
}

function setCam(name) {
  view.cam = name;
  placeCamera(true);
  showCams();
  updateHash();
}

// ------------------------------------------------------------------ the frame loop

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  const P = view.player;
  if (P && pendingSeek !== null) {
    seekStep(pendingSeek);
    pendingSeek = null;
  } else if (P && view.playing && !view.scrubbing) {
    acc += dt * view.speed;
    let budget = 48;                 // steps a frame at most: a slow computer falls behind instead of freezing
    while (acc >= DT - 1e-9 && budget-- > 0) {
      acc -= DT;
      if (P.n >= P.lastStep) {
        if (!view.loop) {
          view.playing = false;
          acc = 0;
          showPlay();
          updateHash();
          break;
        }
        restart();
      } else step(false);
    }
    if (budget <= 0) acc = 0;
  }
  if (P && editor) editor.frame();
  if (P) placeCamera();
  world.seeThrough(dt);
  world.render();
  if (P) showTime();
}

// ------------------------------------------------------------------ the list (docs/ANIMATIONS.md)

/** Every table row of the list, by section: { key, title, rows: [{ id, name, when, see, from, tester, status }] }. */
function parseList(md) {
  const sections = [];
  let section = null;
  let header = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    const h = line.match(/^## ([A-Z])\. (.+)$/);
    if (h) {
      section = { key: h[1], title: h[2], rows: [] };
      sections.push(section);
      header = null;
      continue;
    }
    if (!section || !line.startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
    if (cells[0] === '#') {
      header = cells;
      continue;
    }
    if (!header || /^-+$/.test(cells[0])) continue;
    const cell = (name) => cells[header.indexOf(name)] ?? '';
    section.rows.push({
      id: cells[0], name: cell('Animation') || cell('Change'), when: cell('When it plays'), see: cell('What you should see'),
      from: cell('Made from'), tester: cell('What the tester experienced'), status: cell('Status'),
    });
  }
  return sections.filter((s) => s.rows.length);
}

/** A cell's text with its `code` and **bold** (never as HTML). */
function richText(el, text) {
  el.replaceChildren();
  text.split('`').forEach((part, i) => {
    if (i % 2) {
      el.append(Object.assign(document.createElement('code'), { textContent: part }));
      return;
    }
    part.split('**').forEach((bit, j) => el.append(j % 2 ? Object.assign(document.createElement('b'), { textContent: bit }) : bit));
  });
}

const statusWord = (status) => (status || '').split(/[\s(]/)[0];
let sections = [];
const rowsById = new Map();
const buttons = new Map();

function buildList() {
  const box = $('list');
  box.replaceChildren();
  for (const s of sections) {
    const h = document.createElement('h2');
    h.textContent = `${s.key}. ${s.title}`;
    box.append(h);
    for (const row of s.rows) {
      rowsById.set(row.id, row);
      const b = document.createElement('button');
      const playable = SCENES.some((sc) => sc.id === row.id);
      b.disabled = !playable;
      b.title = playable ? row.name : 'Not a move this page plays (see the switches: High or Low, the hall)';
      const id = Object.assign(document.createElement('b'), { textContent: row.id });
      const name = Object.assign(document.createElement('span'), { className: 'name', textContent: row.name });
      b.append(id, name);
      const word = statusWord(row.status);
      if (word && word !== 'Open') b.append(Object.assign(document.createElement('span'), { className: `chip ${word}`, textContent: word }));
      b.dataset.find = `${row.id} ${row.name} ${row.see}`.toLowerCase();
      b.addEventListener('click', () => select(row.id));
      buttons.set(row.id, b);
      box.append(b);
    }
  }
}

$('filter').addEventListener('input', () => {
  const words = $('filter').value.toLowerCase().split(/\s+/).filter(Boolean);
  for (const b of buttons.values()) b.hidden = !words.every((w) => b.dataset.find.includes(w));
  for (const h of $('list').querySelectorAll('h2')) {
    let next = h.nextElementSibling;
    let any = false;
    while (next && next.tagName === 'BUTTON') {
      any ||= !next.hidden;
      next = next.nextElementSibling;
    }
    h.hidden = !any;
  }
});

function showMove() {
  const sc = view.scene;
  const row = rowsById.get(sc.id) || { id: sc.id, name: sc.name };
  $('moveId').textContent = sc.id;
  $('moveName').textContent = row.name || sc.name;
  const word = statusWord(row.status);
  $('moveStatus').hidden = !row.status;
  $('moveStatus').className = `chip ${word}`;
  $('moveStatus').textContent = row.status || '';
  richText($('moveSee'), row.see ? `What you should see: ${row.see}` : '');
  $('moveDoes').textContent = `This scene: ${sc.does}`;
  const dl = $('moveDl');
  dl.replaceChildren();
  for (const [label, text] of [['When it plays', row.when], ['Made from', row.from], ['The tester', row.tester]]) {
    if (!text) continue;
    const dd = document.createElement('dd');
    richText(dd, text);
    dl.append(Object.assign(document.createElement('dt'), { textContent: label }), dd);
  }
  $('moveMore').hidden = !dl.children.length;
  $('moveMore').open = false;
  for (const [id, b] of buttons) b.classList.toggle('sel', id === sc.id);
  buttons.get(sc.id)?.scrollIntoView({ block: 'nearest' });
  document.title = `${sc.id} ${row.name || sc.name} | Dodgeball: every move`;
}

// ------------------------------------------------------------------ the timeline

const tl = $('timeline');
let cursor = null;

function buildTimeline() {
  const P = view.player;
  const len = P.length;
  const at = (t) => `${(clamp(t / len, 0, 1) * 100).toFixed(3)}%`;
  const width = tl.clientWidth || 800;
  const { events, bands, keys } = P.marks;
  // the spans in rows, so none overlap
  const rows = [];
  const bandBox = tl.querySelector('.bands');
  bandBox.replaceChildren();
  for (const b of [...bands].sort((a, c) => a.t0 - c.t0)) {
    let r = rows.findIndex((end) => end <= b.t0 + 1e-6);
    if (r < 0) r = rows.push(0) - 1;
    rows[r] = b.t1;
    const el = Object.assign(document.createElement('div'), { className: `band ${b.cls}`, textContent: b.label });
    Object.assign(el.style, { left: at(b.t0), width: `${((b.t1 - b.t0) / len) * 100}%`, top: `${r * 15}px` });
    el.title = `${b.label}: ${fmt(b.t0)} – ${fmt(b.t1)} s`;
    bandBox.append(el);
  }
  bandBox.style.height = `${rows.length * 15}px`;
  const track = tl.querySelector('.track');
  track.replaceChildren();
  for (const e of events) {
    const el = Object.assign(document.createElement('div'), { className: 'tick', title: `${fmt(e.t)} s: ${e.label}` });
    el.style.left = at(e.t);
    track.append(el);
  }
  for (const k of keys) {
    const el = Object.assign(document.createElement('div'), { className: 'key', title: `${fmt(k.t)} s: ${k.label}` });
    el.style.left = at(k.t);
    track.append(el);
  }
  cursor = Object.assign(document.createElement('div'), { className: 'cursor' });
  track.append(cursor);
  shownStep = null;                // the next showTime() places the new cursor
  editor?.timelineBuilt();         // its rows of key moments
  // the events' names under them, in as many lines as it takes not to overlap
  const labels = tl.querySelector('.labels');
  labels.replaceChildren();
  const lanes = [];
  for (const e of events) {
    const text = `${fmt(e.t)} ${e.label}`;
    const x = (e.t / len) * width;
    const w = text.length * 5.6 + 8;
    let lane = lanes.findIndex((end) => end < x);
    if (lane < 0) lane = lanes.push(0) - 1;
    lanes[lane] = x + w;
    const el = Object.assign(document.createElement('div'), { className: 'label', textContent: text });
    Object.assign(el.style, { left: at(e.t), top: `${lane * 13}px` });
    labels.append(el);
  }
  labels.style.height = `${Math.max(1, lanes.length) * 13 + 2}px`;
  // a scale in seconds
  const scale = tl.querySelector('.scale');
  scale.replaceChildren();
  const stepT = len > 6 ? 1 : len > 2.5 ? 0.5 : len > 1.2 ? 0.2 : 0.1;
  for (let t = 0; t <= len + 1e-6; t += stepT) {
    const el = Object.assign(document.createElement('span'), { textContent: `${+t.toFixed(2)} s` });
    el.style.left = at(t);
    scale.append(el);
  }
}

function scrubTo(e) {
  const r = tl.getBoundingClientRect();
  pendingSeek = (clamp((e.clientX - r.left) / r.width, 0, 1) * view.player.length) / DT;
}
tl.addEventListener('pointerdown', (e) => {
  if (!view.player) return;
  tl.setPointerCapture(e.pointerId);
  view.scrubbing = true;
  view.playing = false;
  showPlay();
  scrubTo(e);
});
tl.addEventListener('pointermove', (e) => {
  if (view.scrubbing) scrubTo(e);
});
tl.addEventListener('pointerup', () => {
  view.scrubbing = false;
  updateHash();
});
addEventListener('resize', () => view.player && buildTimeline());

let shownStep = null;
function showTime(force = false) {
  const P = view.player;
  if (!force && P.n === shownStep) return;
  shownStep = P.n;
  const t = P.t;
  const frameNo = Math.floor(P.n / PER_FRAME);
  $('time').textContent = `${fmt(t)} s of ${fmt(P.length)} s · frame ${frameNo} of ${Math.floor(P.lastStep / PER_FRAME)}`;
  tl.style.setProperty('--at', `${(clamp(t / P.length, 0, 1) * 100).toFixed(3)}%`);     // the cursors (the editor's rows too)
}

// ------------------------------------------------------------------ the controls

function showPlay() {
  $('playPauseBtn').textContent = view.playing ? 'Pause' : 'Play';
}
function showCams() {
  for (const b of document.querySelectorAll('#cams button')) b.classList.toggle('on', b.dataset.cam === view.cam);
}
function showSwitches() {
  $('hallBtn').classList.toggle('on', !params.has('noarena'));
  $('plainBtn').classList.toggle('on', params.has('noarena'));
  for (const b of document.querySelectorAll('[data-head]')) b.classList.toggle('on', b.dataset.head === view.head);
  for (const b of document.querySelectorAll('[data-team]')) b.classList.toggle('on', Number(b.dataset.team) === view.team);
  for (const b of document.querySelectorAll('[data-low]')) b.classList.toggle('on', (b.dataset.low === '1') === view.low);
  $('ballBtn').classList.toggle('on', view.ball);
  $('loopBtn').classList.toggle('on', view.loop);
  $('followBox').checked = view.follow;
  for (const b of $('speeds').children) b.classList.toggle('on', Number(b.dataset.speed) === view.speed);
}

function togglePlay() {
  const P = view.player;
  if (!P) return;
  if (!view.playing && P.n >= P.lastStep) restart();    // at the end: from the start again
  view.playing = !view.playing;
  acc = 0;
  showPlay();
  updateHash();
}
/** One frame on or back (k frames), landing on a whole frame. */
function frameStep(k) {
  const P = view.player;
  if (!P) return;
  view.playing = false;
  showPlay();
  const whole = Math.floor(P.n / PER_FRAME) + (k < 0 && P.n % PER_FRAME ? 1 : 0);
  seekStep((whole + k) * PER_FRAME);
  updateHash();
}

$('playPauseBtn').addEventListener('click', togglePlay);
$('startBtn').addEventListener('click', () => {
  if (!view.player) return;
  seekStep(0);
  updateHash();
});
$('backFrameBtn').addEventListener('click', () => frameStep(-1));
$('nextFrameBtn').addEventListener('click', () => frameStep(1));
for (const s of SPEEDS) {
  const b = Object.assign(document.createElement('button'), { textContent: s === 1 ? '1×' : s === 0.5 ? '½×' : s === 0.25 ? '¼×' : '⅒×' });
  b.dataset.speed = s;
  b.title = s === 1 ? 'As fast as in the game' : `${1 / s} times slower`;
  b.addEventListener('click', () => {
    view.speed = s;
    showSwitches();
    updateHash();
  });
  $('speeds').append(b);
}
$('loopBtn').addEventListener('click', () => {
  view.loop = !view.loop;
  showSwitches();
  updateHash();
});
for (const b of document.querySelectorAll('#cams button')) b.addEventListener('click', () => setCam(b.dataset.cam));
$('followBox').addEventListener('change', () => {
  view.follow = $('followBox').checked;
  updateHash();
});
// the hall or the plain court is decided as the page loads: load it again, at the same moment
const reloadWith = (noarena) => {
  const q = new URLSearchParams(location.search);
  if (noarena) q.set('noarena', '');
  else q.delete('noarena');
  const search = q.toString().replace(/=(&|$)/g, '$1');
  location.href = `${location.pathname}${search ? `?${search}` : ''}#${hashText(true)}`;
};
$('hallBtn').addEventListener('click', () => params.has('noarena') && reloadWith(false));
$('plainBtn').addEventListener('click', () => !params.has('noarena') && reloadWith(true));
for (const b of document.querySelectorAll('[data-head]')) {
  b.addEventListener('click', () => {
    view.head = b.dataset.head;
    world.headChoice = view.head;
    showSwitches();
    refresh();
  });
}
for (const b of document.querySelectorAll('[data-team]')) {
  b.addEventListener('click', () => {
    view.team = Number(b.dataset.team);
    showSwitches();
    refresh();
    placeCamera(true);
  });
}
for (const b of document.querySelectorAll('[data-low]')) {
  b.addEventListener('click', () => {
    view.low = b.dataset.low === '1';
    world.setQuality(view.low ? 'low' : 'high', PIXELS);
    showSwitches();
    refresh();
  });
}
$('ballBtn').addEventListener('click', () => {
  view.ball = !view.ball;
  showSwitches();
  refresh();
});

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (editor?.keydown(e)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
    e.preventDefault();
    frameStep(e.code === 'ArrowLeft' ? -1 : 1);
  } else if (e.code === 'Home' && view.player) {
    seekStep(0);
    updateHash();
  } else if (e.code === 'End' && view.player) {
    view.playing = false;
    showPlay();
    seekStep(view.player.lastStep);
    updateHash();
  }
});

$('backBtn').addEventListener('click', () => {      // opened in its own tab: close it, or go to the game
  window.close();
  setTimeout(() => { location.href = '/'; }, 200);
});

// ------------------------------------------------------------------ the timings

function buildTimings() {
  const box = $('timingFields');
  box.replaceChildren();
  for (const [path, label, unit] of TIMING_FIELDS) {
    const row = document.createElement('label');
    const input = Object.assign(document.createElement('input'), { type: 'number', step: '0.01', min: '0', value: getPath(view.timing, path) });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < 0) {
        input.value = getPath(view.timing, path);
        return;
      }
      setPath(view.timing, path, v);
      view.timingFrom = 'own';
      showTimingFrom();
      refresh();
    });
    row.append(label, input, unit);
    box.append(row);
  }
  showTimingFrom();
}
function showTimingFrom() {
  $('timingFrom').textContent = {
    game: "The game's: the rules of the game you opened this page from (your own settings included).",
    defaults: 'The defaults: the rules a new setup starts with.',
    own: 'Changed here: the moves stretch to these, like they would to a host\'s rules.',
  }[view.timingFrom];
  $('gameTimingBtn').disabled = !GAME_TIMING;
  $('gameTimingBtn').title = GAME_TIMING ? '' : 'Open this page from the game (Esc › Your settings) to have its rules here';
}
function useTiming(t, from) {
  view.timing = complete(t);
  view.timingFrom = from;
  buildTimings();
  refresh();
}
$('timingsBtn').addEventListener('click', () => {
  $('timings').hidden = !$('timings').hidden;
});
$('closeTimingBtn').addEventListener('click', () => { $('timings').hidden = true; });
$('gameTimingBtn').addEventListener('click', () => GAME_TIMING && useTiming(GAME_TIMING, 'game'));
$('defaultTimingBtn').addEventListener('click', () => useTiming(DEFAULTS, 'defaults'));

// ------------------------------------------------------------------ links and pictures

/** The timings, if they aren't the defaults: every number, in TIMING_FIELDS' order. */
function timingText() {
  const values = TIMING_FIELDS.map(([path]) => getPath(view.timing, path));
  const base = TIMING_FIELDS.map(([path]) => getPath(DEFAULT_TIMING, path));
  return values.every((v, i) => Math.abs(v - base[i]) < 1e-9) ? '' : values.map((v) => +v.toFixed(4)).join(',');
}

/** The camera, in the link: a view's name, or where it is from what it looks at (x, height, z). */
function camText() {
  if (view.cam !== 'custom') return view.cam;
  const d = world.camera.position.clone().sub(controls.target);
  return [d.x, d.y, d.z].map((v) => v.toFixed(2)).join(',');
}

function hashText(withTime) {
  const P = view.player;
  const parts = [`${view.scene?.id ?? ''}${withTime && P ? `@${fmt(P.t)}` : ''}`];
  if (view.cam !== 'front') parts.push(`cam=${camText()}`);
  if (!view.follow) parts.push('follow=0');
  if (!view.ball) parts.push('ball=0');
  if (view.team) parts.push('team=1');
  if (view.head !== 'helmet') parts.push(`head=${view.head}`);
  if (view.low) parts.push('low=1');
  if (view.speed !== 1) parts.push(`speed=${view.speed}`);
  if (!view.loop) parts.push('loop=0');
  const tm = timingText();
  if (tm) parts.push(`timing=${tm}`);
  return parts.join('&');
}

/** This page's address keeps the move (and the moment, when paused), so a reload comes back to it. */
function updateHash() {
  if (!view.scene) return;
  history.replaceState(null, '', `#${hashText(!view.playing)}`);
}

function readHash() {
  const text = decodeURIComponent(location.hash.slice(1));
  if (!text) return null;
  const [first, ...rest] = text.split('&');
  const [id, t] = first.split('@');
  return { id, t: t === undefined ? null : Number(t), ...Object.fromEntries(rest.map((p) => p.split('='))) };
}

function linkText() {
  return `${location.origin}${location.pathname}${location.search}#${hashText(true)}`;
}

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2200);
}

$('linkBtn').addEventListener('click', async () => {
  view.playing = false;
  showPlay();
  updateHash();
  const link = linkText();
  const box = $('linkBox');
  box.value = link;
  box.hidden = false;
  try {
    await navigator.clipboard.writeText(link);
    toast('Copied: paste it in the chat');
  } catch {
    box.select();      // no clipboard on this page (an address that isn't this computer's): copy it from the box
    toast(document.execCommand('copy') ? 'Copied: paste it in the chat' : 'Copy the link from the box under the buttons');
  }
});

$('shotBtn').addEventListener('click', () => {
  world.render();      // drawn now, read at once (the picture isn't kept after it's shown)
  const P = view.player;
  canvas.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `move-${view.scene.id}-${fmt(P.t)}s.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
});

// ------------------------------------------------------------------ for tests (and Claude's pictures)

/** Where the hands, feet, hips and head are, in the player's own frame (metres: x to their left, up,
 *  z ahead of them), and what the athlete is doing: the numbers the moves test reads in the game. */
function where() {
  const man = world.man(ID);
  const a = man?.athlete;
  if (!a) return null;
  const inv = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -man.root.rotation.y);
  const p = (b) => {
    const v = a.bones[b].getWorldPosition(new THREE.Vector3()).sub(man.root.position).applyQuaternion(inv);
    return [+v.x.toFixed(3), +v.y.toFixed(3), +v.z.toFixed(3)];
  };
  // where the hips face, from the bones (tests/browser/moves.js hipsTurn: + to the right)
  const rel = man.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(a.bones.hips.getWorldQuaternion(new THREE.Quaternion()));
  rel.multiply(a.rest.restRot.hips.clone().invert());
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(rel);
  return {
    handR: p('hand_R'), handL: p('hand_L'), footL: p('foot_L'), footR: p('foot_R'), hips: p('hips'), head: p('head'),
    legYaw: +a.legYaw.toFixed(3), hipsTurn: +(-Math.atan2(f.x, f.z)).toFixed(3), back: a.back, ko: a.ko, acro: a.acro?.kind ?? null,
    act: a.act ? `${a.act.kind}@${a.act.age.toFixed(3)}` : null, dodge: a.act?.dodge ?? null, style: a.style, win: a.win,
    alive: view.player.state().alive, shown: man.root.visible, caughtBall: !!man.catchBall?.visible, held: !!man.held?.visible,
  };
}

window.moveView = {
  ready: false,
  world,
  ids: () => SCENES.map((s) => s.id),
  select: (id, t = 0, play = false) => select(id, { t, play }),
  seek: (t) => {
    seekStep(t / DT);
    showTime(true);
    return +view.player.t.toFixed(4);
  },
  frames: (k) => frameStep(k),
  play: () => { if (!view.playing) togglePlay(); },
  pause: () => { if (view.playing) togglePlay(); },
  cam: (name) => setCam(name),
  state: () => ({
    id: view.scene?.id, t: +view.player.t.toFixed(4), step: view.player.n, frame: Math.floor(view.player.n / PER_FRAME),
    length: +view.player.length.toFixed(4), playing: view.playing, speed: view.speed, loop: view.loop, cam: view.cam,
    follow: view.follow, ball: view.ball, team: view.team, head: view.head, low: view.low, timing: view.timingFrom,
  }),
  marks: () => view.player.marks,
  where,
  link: linkText,
  edit: null,                     // the editor's own steps, once it's made (move_edit.js test)
};

// ------------------------------------------------------------------ starting

(async () => {
  const docs = fetch('/docs/ANIMATIONS.md').then((r) => (r.ok ? r.text() : null)).catch(() => null);
  await world.loading;
  view.clips = clipInfo(world.athlete);
  Math.random = random;           // from here on, the page's own chance
  const md = await docs;
  sections = md ? parseList(md) : [];
  if (!sections.length) {         // a copy without the docs: the scenes' own names
    sections = Object.entries(SECTIONS).map(([key, title]) => ({
      key, title, rows: SCENES.filter((s) => s.id.startsWith(key) && /^\d+$/.test(s.id.slice(key.length))).map((s) => ({ id: s.id, name: s.name })),
    })).filter((s) => s.rows.length);
  }
  buildList();
  buildTimings();
  if (!params.has('clean') && world.athlete) {     // pictures of a moment show the moves as saved, with no handles
    editor = createEditor({
      world, orbit: controls, canvas, tl, view,
      man: () => world.man(ID),
      resim,
      rebuild,
      pause: () => {
        if (!view.playing) return;
        view.playing = false;
        acc = 0;
        showPlay();
        updateHash();
      },
      statusOf: (id) => rowsById.get(id)?.status || '',
      nameOf: (id) => rowsById.get(id)?.name || SCENES.find((s) => s.id === id)?.name || '',
      toast,
      timeAt: (clientX) => {
        const r = tl.getBoundingClientRect();
        return clamp((clientX - r.left) / r.width, 0, 1) * view.player.length;
      },
      pct: (t) => `${(clamp(t / view.player.length, 0, 1) * 100).toFixed(3)}%`,
      relayout: () => {
        world.resize();
        if (view.player) buildTimeline();
      },
    });
    window.moveView.edit = editor.test;
    for (const id of EDITABLE) {       // the moves it can change, marked in the list (and found by "edit")
      const b = buttons.get(id);
      if (!b) continue;
      const chip = Object.assign(document.createElement('span'), { className: 'chip edit', textContent: '✎ edit' });
      chip.title = 'Placed by hand: Edit this move changes it';
      b.querySelector('.name').after(chip);
      b.dataset.find += ' edit';
    }
  }
  const h = readHash();
  if (h) {
    view.team = h.team === '1' ? 1 : 0;
    view.head = h.head === 'face' ? 'face' : 'helmet';
    view.low = h.low === '1';
    view.ball = h.ball !== '0';
    view.follow = h.follow !== '0';
    view.loop = h.loop !== '0';
    if (SPEEDS.includes(Number(h.speed))) view.speed = Number(h.speed);
    if (h.timing) {
      const values = h.timing.split(',').map(Number);
      if (values.length === TIMING_FIELDS.length && values.every((v) => Number.isFinite(v) && v >= 0)) {
        const t = complete(DEFAULT_TIMING);
        TIMING_FIELDS.forEach(([path], i) => setPath(t, path, values[i]));
        view.timing = t;
        view.timingFrom = 'own';
        buildTimings();
      }
    }
    if (h.cam && (CAMS[h.cam] || h.cam === 'yours')) view.cam = h.cam;
  }
  world.headChoice = view.head;
  if (view.low) world.setQuality('low', PIXELS);
  showSwitches();
  const start = h && SCENES.some((s) => s.id === h.id) ? h.id : SCENES[0].id;
  select(start, { t: h?.t ?? 0, play: h?.t === null || h?.t === undefined });
  if (h?.cam && !CAMS[h.cam] && h.cam !== 'yours') {     // a camera placed by hand: where it was, from what it looked at
    const v = h.cam.split(',').map(Number);
    if (v.length === 3 && v.every(Number.isFinite)) {
      view.cam = 'custom';
      world.camera.position.copy(controls.target).add(new THREE.Vector3(...v));
      controls.update();
      showCams();
    }
  }
  showCams();
  requestAnimationFrame((now) => {
    last = now;
    frame(now);
    window.moveView.ready = true;
  });
})();
