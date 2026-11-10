// The moves page's editor ("Edit this move" in moves.html): the moves placed by hand, changed on the
// athlete itself. Their numbers are static/characters/made_moves.json (athlete.js MADE): where the
// hands, feet and hips go and how the chest turns, at each key moment. Handles on the athlete move
// them (arrows), turn a hand (rings) and set where an elbow or knee points (a ball); the timeline's
// rows retime, add and delete key moments. Every change shows at once: the page plays the scene
// again from its start with the new numbers (move_view.js). Save sends the file to the server
// (server.py /moves/save), which writes it from the host's computer only, keeping the file it
// replaces. Unsaved changes stay in this browser until saved or dropped.
import * as THREE from 'three';
import { TransformControls } from '/static/vendor/addons/controls/TransformControls.js';
import { MADE, MOVE_TIMES, setMade, at } from './athlete.js';
import { DT } from './move_scenes.js';

const $ = (id) => document.getElementById(id);
const DRAFT = 'dp.movesDraft';                 // unsaved changes, kept in this browser: { base, now }
const DEG = 180 / Math.PI;
const POLE_OUT = 0.3;                          // the elbow's (knee's) ball sits this far out from the limb (m)
const FAR = 0.02;                              // a hand or foot further than this from its handle: say so (m)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000 + 0;        // + 0: never -0
const r4 = (v) => Math.round(v * 10000) / 10000 + 0;
const get = (path) => path.reduce((o, k) => o?.[k], MADE);
const put = (path, value) => {
  get(path.slice(0, -1))[path[path.length - 1]] = value;
};
const isKeys = (v) => Array.isArray(v) && Array.isArray(v[0]);
const span = (T, kind) => T.actions[kind].window + T.actions[kind].recovery;
const el = (tag, cls = '', text = undefined) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const LIMBS = { L: ['upper_L', 'fore_L', 'hand_L'], R: ['upper_R', 'fore_R', 'hand_R'], legL: ['thigh_L', 'shin_L', 'foot_L'] };
const LEFT_UP_FORWARD = ['to its left', 'up', 'forward'];

// ------------------------------------------------------------------ what each scene edits

/** When a move's key moments happen in a scene: a moment of the move (0..1, a dash 0..2) <-> seconds. */
const CLOCKS = {
  parry(P) {
    const p = P.presses.find((q) => q.kind === 'deflect');
    const s = span(P.T, 'deflect');
    return p && { max: 1, of: 'the move', toT: (u) => p.t + u * s, toU: (t) => (t - p.t) / s };
  },
  wind(P, style) {
    const c = P.charges.find((q) => q.style === style);
    const ct = P.T.chargeTime;
    return c && { max: 1, of: 'the charge', toT: (u) => c.t0 + u * ct, toU: (t) => (t - c.t0) / ct };
  },
  release(P, style) {
    const c = P.charges.find((q) => q.style === style && q.thrown);
    const r = MOVE_TIMES.RELEASE;
    return c && { max: 1, of: 'the release', toT: (u) => c.end + u * r, toU: (t) => (t - c.end) / r };
  },
  dash(P) {
    const p = P.presses.find((q) => q.kind === 'dodge');
    const dash = Math.max(0.05, P.T.dash.time);
    const land = Math.max(0.05, span(P.T, 'dodge') - dash);
    return p && {
      max: 2, of: 'the dash',
      toT: (u) => p.t + (u <= 1 ? u * dash : dash + (u - 1) * land),
      toU: (t) => (t - p.t <= dash ? (t - p.t) / dash : 1 + (t - p.t - dash) / land),
    };
  },
};

const turnOf = (name) => ({ fingers: [...name, 'fingers'], palm: [...name, 'palm'] });
const hand = (side, path, turn, extra = {}) => ({
  id: 'hand', label: `${side === 'L' ? 'Left' : 'Right'} hand`, kind: 'point', path, frame: 'body', end: `hand_${side}`, turn, axes: LEFT_UP_FORWARD, ...extra,
});
const elbow = (side, path) => ({ id: 'elbow', label: `${side === 'L' ? 'Left' : 'Right'} elbow`, kind: 'pole', path, limb: side, note: 'Where the elbow points: drag its ball.' });
const chest = (path) => ({ id: 'chest', label: 'Chest turn', kind: 'angle', path, axis: 'turn', note: '+ turns it to the left, − to the right.' });
const lean = (path) => ({ id: 'lean', label: 'Lean forward', kind: 'angle', path, axis: 'lean', note: '+ bends the upper body forward.' });

/** The move a scene edits (null: none), with its parts as this scene shows them. */
function sceneMove(id, P) {
  const first = (kind) => P.presses.find((q) => q.kind === kind);
  const throwMove = (style, phase) => {
    const S = ['THROWS', style];
    const angle = style === 'side' ? (phase === 'wind' ? 'turnWind' : 'turnRelease') : (phase === 'wind' ? 'bendWind' : 'bendRelease');
    return {
      about: [['THROWS'], S], clock: CLOCKS[phase](P, style), blend: ['THROWS', 'blend'], blendNote: 'All three throws share it (the overhead one too).',
      parts: [hand('R', [...S, phase], turnOf(S)), style === 'side' ? chest([...S, angle]) : lean([...S, angle]), elbow('R', [...S, 'pole'])],
    };
  };
  const dashMove = (name) => {
    const kind = first('dodge')?.dodge;
    const toRight = kind === 'right' ? 1 : kind === 'left' ? -1 : 0;
    const mirror = toRight ? -toRight : 1;
    const side = name === 'DASH_SIDE';
    const across = side ? 'towards the dash' : 'to its left';
    const feet = side
      ? [['lead', toRight > 0 ? 'R' : 'L', ' (leading)'], ['trail', toRight > 0 ? 'L' : 'R', ' (pushing off)']]
      : [['L', 'L', ''], ['R', 'R', '']];
    return {
      about: [[name]], clock: CLOCKS.dash(P), blend: [name, 'blend'],
      blendNote: side ? 'The dash left mirrors this one: changing either changes both.' : '',
      parts: [
        { id: 'hips', label: 'Hips', kind: 'point', path: [name, 'hips'], frame: 'hips', mirror, axes: [across, 'up', 'forward'] },
        ...feet.map(([key, s, role]) => ({
          id: key, label: `${s === 'L' ? 'Left' : 'Right'} foot${role}`, kind: 'point', path: [name, key], frame: 'foot', mirror, end: `foot_${s}`,
          axes: [across, 'lifted', 'forward'],
        })),
        lean([name, 'bend']),
        { id: 'knees', label: 'Knees', kind: 'pole', path: [name, 'knees'], limb: 'legL', note: 'Where the left knee points (the right one mirrors it): drag its ball.' },
      ],
    };
  };
  switch (id) {
    case 'B1':
    case 'B2':
      return {
        about: [['CARRY_R']], blend: ['CARRY_R', 'blend'], show: id === 'B1' ? 0.5 : 0.9,
        parts: [hand('R', ['CARRY_R', 'hand'], turnOf(['CARRY_R'])), elbow('R', ['CARRY_R', 'pole'])],
      };
    case 'C4': return throwMove('side', 'wind');
    case 'C5': return throwMove('side', 'release');
    case 'C6': return throwMove('under', 'wind');
    case 'C7': return throwMove('under', 'release');
    case 'D1': {
      const c = P.charges[0];
      return {
        about: [['GUARD_L']], blend: ['GUARD_L', 'blend'], show: c ? c.t0 + 0.8 * P.T.chargeTime : 0.8,
        parts: [hand('L', ['GUARD_L', 'hand'], turnOf(['GUARD_L']), { frame: 'head', note: 'It follows the head when the body bends.' }), elbow('L', ['GUARD_L', 'pole'])],
      };
    }
    case 'D2':
    case 'D3':
    case 'D4':
      return {
        about: [['PARRY_L']], clock: CLOCKS.parry(P), blend: ['PARRY_L', 'blend'],
        parts: [hand('L', ['PARRY_L', 'hand'], turnOf(['PARRY_L'])), chest(['PARRY_L', 'chest']), elbow('L', ['PARRY_L', 'pole'])],
      };
    case 'D5':
    case 'D6': {
      const p = first('catch');
      return {
        about: [['CATCH_L']], blend: ['CATCH_L', 'blend'], blendNote: 'It goes over the catch\'s recovery (a rule).',
        show: p ? p.t + P.T.actions.catch.window / 2 : 0.5,
        parts: [hand('L', ['CATCH_L', 'hand'], turnOf(['CATCH_L'])), chest(['CATCH_L', 'chest']), elbow('L', ['CATCH_L', 'pole'])],
      };
    }
    case 'D7': {
      const caught = P.events.find((e) => e.type === 'catch');
      return {
        about: [['PULL_L']], show: caught ? caught.t + MOVE_TIMES.CAUGHT - 0.1 : 0.6,
        parts: [
          hand('L', ['PULL_L', 'hand'], turnOf(['PULL_L']), { id: 'pull', label: 'Left hand, pulling the ball in' }),
          hand('R', ['CARRY_R', 'meet'], null, { id: 'meet', label: 'Right hand, taking it', note: 'It holds the ball as in B1 (edit its turn there).' }),
        ],
      };
    }
    case 'E2':
    case 'E3': return dashMove('DASH_SIDE');
    case 'E4': return dashMove('DASH_FORWARD');
    case 'E5': return dashMove('DASH_BACK');
    default: return null;
  }
}

/** The scenes that edit a move, for the page's notes. */
export const EDITABLE = ['B1', 'B2', 'C4', 'C5', 'C6', 'C7', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'E2', 'E3', 'E4', 'E5'];
const EDITABLE_TEXT = 'B1, B2, C4–C7, D1–D7, E2–E5';

// ------------------------------------------------------------------ the editor

/** api (move_view.js): { world, orbit, canvas, tl, view, man(), resim(t), rebuild(t), pause(), statusOf(id), nameOf(id),
 *  toast(text), timeAt(clientX), pct(t), relayout() } */
export function createEditor(api) {
  const { world, orbit, canvas, tl, view } = api;
  const ed = {
    open: false, move: null, part: null, key: -1, mode: 'move', unlocked: new Set(),
    saved: JSON.stringify(MADE), history: [], future: [], gesture: null,
    dirty: false, seekTo: null, rebuild: false, drag: null, saving: null, message: '', ask: true,
  };

  // ---------------------------------------------------------------- handles in the hall
  const tc = new TransformControls(world.camera, canvas);
  tc.setSize(1.1);
  tc.setSpace('local');
  const gizmo = tc.getHelper();
  world.scene.add(gizmo);
  const proxy = new THREE.Object3D();           // what the handles move; the editor reads it back
  world.scene.add(proxy);
  const marks = new THREE.Group();              // a ball where each part goes, lines to what reaches it
  marks.renderOrder = 10;
  world.scene.add(marks);
  const ballGeo = new THREE.SphereGeometry(1, 16, 12);
  const mat = (color, opacity = 0.9) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const COLORS = { point: 0xffc940, pole: 0x6ff3ff, picked: 0xffffff, far: 0xff5a5a };
  const balls = new Map();                      // part id -> mesh
  const lineMat = new THREE.LineBasicMaterial({ color: 0x6ff3ff, transparent: true, opacity: 0.8, depthTest: false, toneMapped: false });
  const farMat = new THREE.LineBasicMaterial({ color: COLORS.far, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false });
  const line = (m) => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), m);
    l.renderOrder = 10;
    l.frustumCulled = false;
    marks.add(l);
    return l;
  };
  const poleLine = line(lineMat);
  const farLine = line(farMat);

  // the camera stays put while a handle is dragged: decided before the orbit camera sees the press
  addEventListener('pointerdown', (e) => {
    if (e.target === canvas && tc.object && tc.enabled && tc.axis !== null) orbit.enabled = false;
  }, true);
  addEventListener('pointerup', () => {
    if (!tc.dragging) orbit.enabled = true;
  }, true);
  tc.addEventListener('dragging-changed', (e) => {
    orbit.enabled = !e.value;
  });
  tc.addEventListener('mouseDown', dragStart);
  tc.addEventListener('objectChange', dragMove);
  tc.addEventListener('mouseUp', dragEnd);

  // a click on a ball picks its part
  let downAt = null;
  canvas.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!ed.open || !downAt || tc.dragging || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
    const r = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), world.camera);
    const hit = ray.intersectObjects([...balls.values()].filter((b) => b.visible))[0];
    if (hit) choose(ed.move.parts.find((p) => p.id === hit.object.userData.part));
  });

  /** The athlete's frame now: its model, how far apply() lifted it off the floor, its facing. */
  function frameNow() {
    const a = api.man()?.athlete;
    if (!a) return null;
    a.model.updateWorldMatrix(true, true);
    return { a, model: a.model, R: a.rest, lift: a.bones.hips.position.y - a.out.p.y, q: a.model.getWorldQuaternion(new THREE.Quaternion()) };
  }
  const bodyOf = (F, bone) => F.model.worldToLocal(F.a.bones[bone].getWorldPosition(new THREE.Vector3()));
  const asArray = (v) => (Array.isArray(v) ? v : [v.x, v.y, v.z]);

  /** Where in the scene's moment a keyed move is (u), or null for a move without key moments. */
  const uNow = () => (ed.move?.clock ? ed.move.clock.toU(view.player.t) : null);
  /** A part's value now: a keyed one at this moment, a fixed one as it is. */
  function valueNow(part) {
    const v = get(part.path);
    if (!isKeys(v)) return v;
    const u = uNow();
    return typeof v[0][1] === 'number' ? at(v, u) : at(v, u, new THREE.Vector3()).toArray();
  }
  /** The value the handles edit: the picked key's, or the part's own (no key moments). */
  function editedValue(part) {
    const v = get(part.path);
    if (!isKeys(v)) return v;
    const k = part === ed.part ? v[ed.key] : null;
    return k ? k[1] : valueNow(part);
  }
  /** Where a part's place is, in the athlete's frame (as athlete.js reaches for it, then lifted with the body). */
  function pointBody(F, part, v) {
    const [x, y, z] = asArray(v);
    const m = part.mirror ?? 1;
    switch (part.frame) {
      case 'head': return new THREE.Vector3(x, y, z).add(bodyOf(F, 'head')).sub(F.R.head);
      case 'foot': return new THREE.Vector3(m * x, F.R.ankle + y + F.lift, z);
      case 'hips': {
        const [nx, ny, nz] = valueNow(part);
        return bodyOf(F, 'hips').add(new THREE.Vector3(m * (x - nx), y - ny, z - nz));
      }
      default: return new THREE.Vector3(x, y + F.lift, z);
    }
  }
  /** An elbow's (knee's) ball: out from the middle of the limb, the way the pole points. */
  function poleBody(F, part) {
    const [root, mid, end] = LIMBS[part.limb];
    const A = bodyOf(F, root);
    const C = bodyOf(F, end);
    const along = C.clone().sub(A).normalize();
    const pole = new THREE.Vector3(...get(part.path));
    pole.addScaledVector(along, -pole.dot(along));
    if (pole.lengthSq() < 1e-8) pole.set(0, 0, 1);
    return { centre: A.add(C).multiplyScalar(0.5), mid: bodyOf(F, mid), out: pole.normalize() };
  }
  function handQuat(f, p) {
    const x = new THREE.Vector3(...f).normalize();
    const y = new THREE.Vector3(...p);
    y.addScaledVector(x, -y.dot(x)).normalize();
    const z = new THREE.Vector3().crossVectors(x, y);
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  /** A hand's turn (fingers, palm) where the handles edit it: the picked key's, or the move's own. */
  function turnPaths(part) {
    if (!part.turn) return null;
    const f = get(part.turn.fingers);
    if (!isKeys(f)) return { fingers: part.turn.fingers, palm: part.turn.palm, keyed: false };
    const u = get(part.path)[ed.key]?.[0];
    const i = f.findIndex((k) => Math.abs(k[0] - u) < 1e-6);
    return i < 0 ? null : { fingers: [...part.turn.fingers, i, 1], palm: [...part.turn.palm, i, 1], keyed: true };
  }

  /** Is the scene at the picked key moment (a keyed part's handles only show there)? */
  function atKey(part) {
    const v = get(part.path);
    if (!isKeys(v)) return true;
    const k = v[ed.key];
    return !!k && Math.abs(ed.move.clock.toT(k[0]) - view.player.t) <= DT / 2 + 1e-9;
  }
  const lockedNow = () => ed.move && api.statusOf(view.scene.id).startsWith('Locked') && !ed.unlocked.has(view.scene.id);

  /** The balls, the lines and the handles, where the parts are now (every frame while editing). */
  function placeHandles() {
    const F = frameNow();
    const show = ed.open && ed.move && F && !lockedNow();
    marks.visible = !!show;
    if (!show) {
      if (tc.object) tc.detach();
      return;
    }
    const u = uNow();
    const active = u === null || (u >= -1e-6 && u <= ed.move.clock.max + 1e-6);
    for (const part of ed.move.parts) {
      if (part.kind === 'angle') continue;
      let ball = balls.get(part.id);
      if (!ball) {
        ball = new THREE.Mesh(ballGeo, mat(part.kind === 'pole' ? COLORS.pole : COLORS.point));
        ball.renderOrder = 11;
        ball.userData.part = part.id;
        marks.add(ball);
        balls.set(part.id, ball);
      }
      ball.visible = active;
      const picked = part === ed.part;
      ball.material.color.setHex(picked ? COLORS.picked : part.kind === 'pole' ? COLORS.pole : COLORS.point);
      ball.scale.setScalar(picked ? 0.03 : 0.022);
      if (part.kind === 'pole') {
        const P = poleBody(F, part);
        ball.position.copy(F.model.localToWorld(P.centre.clone().addScaledVector(P.out, POLE_OUT)));
        if (picked) {
          poleLine.geometry.setFromPoints([F.model.localToWorld(P.mid.clone()), ball.position.clone()]);
          poleLine.visible = true;
        }
      } else ball.position.copy(F.model.localToWorld(pointBody(F, part, editedValue(part))));
    }
    for (const [id, ball] of balls) if (!ed.move.parts.some((p) => p.id === id)) ball.visible = false;
    if (!ed.part || ed.part.kind !== 'pole') poleLine.visible = false;
    // the picked part: its handles (at the picked key moment), and how far the hand or foot is from it
    const part = ed.part;
    const here = part && part.kind !== 'angle' && active && atKey(part) && !view.playing;
    farLine.visible = false;
    const reachNote = $('editReach');
    if (reachNote) reachNote.textContent = '';
    if (!here) {
      if (tc.object) tc.detach();
      return;
    }
    const ball = balls.get(part.id);
    if (part.end) {
      const end = F.a.bones[part.end].getWorldPosition(new THREE.Vector3());
      const gap = end.distanceTo(ball.position);
      if (gap > FAR) {
        farLine.geometry.setFromPoints([end, ball.position.clone()]);
        farLine.visible = true;
        const what = part.end.startsWith('hand') ? 'hand' : 'foot';
        if (reachNote) reachNote.textContent = `The ${what} is ${Math.round(gap * 100)} cm from its ball here (the red line): it can't reach that far, or the move is still blending in or out.`;
      }
    }
    if (tc.dragging) return;
    const turning = ed.mode === 'turn' && turnPaths(part);
    tc.setMode(turning ? 'rotate' : 'translate');
    proxy.position.copy(ball.position);
    if (turning) {
      const T = turnPaths(part);
      proxy.quaternion.copy(F.q).multiply(handQuat(get(T.fingers), get(T.palm)));
    } else proxy.quaternion.copy(F.q);
    proxy.updateMatrixWorld();
    if (tc.object !== proxy) tc.attach(proxy);
  }

  // ---------------------------------------------------------------- dragging a handle
  function dragStart() {
    const part = ed.part;
    const F = frameNow();
    if (!part || !F) return;
    begin();
    ed.drag = { part, F, p0: proxy.position.clone(), q0: proxy.quaternion.clone(), qInv: F.q.clone().invert(), v0: [...asArray(editedValue(part))] };
    if (part.kind === 'pole') {
      const [root, , end] = LIMBS[part.limb];
      ed.drag.centre = bodyOf(F, root).add(bodyOf(F, end)).multiplyScalar(0.5);
    }
  }
  function dragMove() {
    const d = ed.drag;
    if (!d) return;
    const part = d.part;
    if (tc.mode === 'rotate') {
      const T = turnPaths(part);
      const q = d.qInv.clone().multiply(proxy.quaternion);
      put(T.fingers, new THREE.Vector3(1, 0, 0).applyQuaternion(q).toArray().map(r3));
      put(T.palm, new THREE.Vector3(0, 1, 0).applyQuaternion(q).toArray().map(r3));
    } else if (part.kind === 'pole') {
      const at = d.F.model.worldToLocal(proxy.position.clone()).sub(d.centre);
      if (at.lengthSq() > 1e-6) put(part.path, at.normalize().toArray().map(r3));
    } else {
      const m = part.mirror ?? 1;
      const delta = proxy.position.clone().sub(d.p0).applyQuaternion(d.qInv);
      setValue(part, [d.v0[0] + m * delta.x, d.v0[1] + delta.y, d.v0[2] + delta.z].map(r3));
    }
    ed.dirty = true;
    showValues();
  }
  function dragEnd() {
    ed.drag = null;
    end();
  }

  /** A place for the part (at the picked key, or its own). */
  function setValue(part, value) {
    const v = get(part.path);
    if (isKeys(v)) v[ed.key][1] = value;
    else put(part.path, value);
  }

  // ---------------------------------------------------------------- undo, save
  /** A change starts: what it was before, for undo. */
  function begin() {
    if (ed.gesture === null) ed.gesture = JSON.stringify(MADE);
  }
  /** ...and ends: one step of undo, if it changed anything. */
  function end() {
    if (ed.gesture === null) return;
    const before = ed.gesture;
    ed.gesture = null;
    if (JSON.stringify(MADE) === before) return;
    ed.history.push(before);
    if (ed.history.length > 300) ed.history.shift();
    ed.future = [];
    ed.message = '';
    changed();
  }
  /** One change, all at once (a typed number, a button). */
  function change(fn, { retimed = false } = {}) {
    begin();
    fn();
    end();
    ed.dirty = true;
    ed.rebuild ||= retimed;
  }
  const isChanged = () => JSON.stringify(MADE) !== ed.saved;
  function changed() {
    try {
      if (isChanged()) localStorage.setItem(DRAFT, JSON.stringify({ base: ed.saved, now: JSON.stringify(MADE) }));
      else localStorage.removeItem(DRAFT);
    } catch { /* no storage */ }
    showStatus();
  }
  /** Everything replaced (undo, redo, back to saved, saved): the scene made again, the selection kept if it can be. */
  function replaced(text) {
    setMade(JSON.parse(text));
    ed.dirty = true;
    ed.rebuild = true;
    if (ed.part && isKeys(get(ed.part.path))) ed.key = clamp(ed.key, 0, get(ed.part.path).length - 1);
    changed();
    showPanel();
  }
  function undo() {
    if (!ed.history.length) return;
    ed.future.push(JSON.stringify(MADE));
    replaced(ed.history.pop());
  }
  function redo() {
    if (!ed.future.length) return;
    ed.history.push(JSON.stringify(MADE));
    replaced(ed.future.pop());
  }
  function revert() {
    if (!isChanged()) return;
    ed.history.push(JSON.stringify(MADE));      // back to saved can be undone too
    ed.future = [];
    ed.message = 'Back to the saved file (Undo brings your changes back).';
    replaced(ed.saved);
  }
  async function save() {
    if (!ed.saving?.can || !isChanged()) return false;
    $('saveBtn').disabled = true;
    try {
      const res = await fetch('/moves/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(MADE) });
      if (!res.ok) {
        ed.message = (await res.text()) || `Not saved (${res.status}).`;
        showStatus();
        return false;
      }
      const out = await res.json();
      ed.saved = JSON.stringify(out.made);
      const time = new Date().toTimeString().slice(0, 5);
      ed.message = `Saved at ${time}. The game plays it from its next start (reload the game's tab). The file it replaced is kept: ${out.kept}.`;
      replaced(ed.saved);
      api.toast('Saved');
      return true;
    } catch (e) {
      ed.message = `Not saved: ${e.message}`;
      showStatus();
      return false;
    }
  }
  fetch('/moves/saving').then((r) => r.json()).then((s) => {
    ed.saving = s;
    showStatus();
  }).catch(() => {
    ed.saving = { can: false, why: "The server didn't answer." };
  });
  addEventListener('beforeunload', (e) => {     // (the changes are kept in the browser anyway: offered back next time)
    if (!isChanged() || !ed.ask) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // ---------------------------------------------------------------- key moments
  /** The tracks a part's key moments are in: its places, and its hand's turns if they have keys too. */
  function tracksOf(part) {
    const out = [part.path];
    if (part.turn && isKeys(get(part.turn.fingers))) out.push(part.turn.fingers, part.turn.palm);
    return out;
  }
  const keyAt = (track, u) => track.findIndex((k) => Math.abs(k[0] - u) < 1e-6);
  function retime(part, i, u) {
    const u0 = get(part.path)[i][0];
    for (const path of tracksOf(part)) {
      const tr = get(path);
      const j = keyAt(tr, u0);
      if (j >= 0) tr[j][0] = u;
    }
  }
  function addKey(part, u) {
    const main = get(part.path);
    const max = ed.move.clock.max;
    u = r4(clamp(u, 0, max));
    if (main.some((k) => Math.abs(k[0] - u) < 0.01 * max)) return false;
    change(() => {
      for (const path of tracksOf(part)) {
        const tr = get(path);
        const v = typeof tr[0][1] === 'number' ? r3(at(tr, u)) : at(tr, u, new THREE.Vector3()).toArray().map(r3);
        const j = tr.findIndex((k) => k[0] > u);
        tr.splice(j < 0 ? tr.length : j, 0, [u, v]);
      }
    }, { retimed: true });
    ed.key = keyAt(get(part.path), u);
    return true;
  }
  function deleteKey(part, i) {
    const main = get(part.path);
    if (i <= 0 || i >= main.length - 1) return false;       // the first and last stay: the move's start and end
    const u = main[i][0];
    change(() => {
      for (const path of tracksOf(part)) {
        const tr = get(path);
        const j = keyAt(tr, u);
        if (j > 0 && j < tr.length - 1) tr.splice(j, 1);
      }
    }, { retimed: true });
    ed.key = Math.min(i, get(part.path).length - 1);
    return true;
  }
  function setEase(part, i, pass) {
    const u = get(part.path)[i][0];
    change(() => {
      for (const path of tracksOf(part)) {
        const k = get(path)[keyAt(get(path), u)];
        if (!k) continue;
        if (pass) k[2] = 'pass';
        else k.length = 2;
      }
    }, { retimed: true });
  }

  // ---------------------------------------------------------------- picking
  /** Go to a part (and a key moment of it): the scene jumps to where it shows. */
  function choose(part, key = null, { rows = true } = {}) {
    if (!part) return;
    ed.part = part;
    const keys = get(part.path);
    const C = ed.move.clock;
    if (isKeys(keys)) {
      if (key === null) {             // the key moment nearest to where the scene is, inside the move
        const u = uNow();
        let best = 1;
        keys.forEach(([k], i) => {
          if (i > 0 && i < keys.length - 1 && Math.abs(k - u) < Math.abs(keys[best][0] - u)) best = i;
        });
        key = Math.min(best, keys.length - 1);
      }
      ed.key = key;
      go(C.toT(keys[key][0]));
    } else if (C) {                    // a part without keys in a move with them: at the picked moment, or the first
      const main = ed.move.parts.find((p) => isKeys(get(p.path)));
      const mk = get(main.path);
      const u = uNow();
      if (u === null || u < 0 || u > C.max) go(C.toT(mk[Math.min(1, mk.length - 1)][0]));
    } else go(ed.move.show);
    if (!part.turn || (part.turn && !turnPaths(part))) ed.mode = 'move';
    showPanel({ rows });
  }
  function go(t) {
    api.pause();
    ed.seekTo = t;
    ed.dirty = true;
  }

  // ---------------------------------------------------------------- the timeline's rows
  const rowsBox = tl.querySelector('.editRows');
  function drawRows() {
    rowsBox.replaceChildren();
    if (!ed.open || !ed.move?.clock || lockedNow()) return;
    const C = ed.move.clock;
    for (const part of ed.move.parts) {
      const keys = get(part.path);
      if (!isKeys(keys)) continue;
      const row = el('div', 'erow');
      row.dataset.part = part.id;
      row.append(el('span', 'elabel', part.label));
      keys.forEach(([u, , ease], i) => {
        const d = el('div', `ekey${ease === 'pass' ? ' pass' : ''}`);
        d.dataset.i = i;
        d.style.left = api.pct(C.toT(u));
        d.title = `${part.label}: ${keyText(part, i)}${i > 0 && i < keys.length - 1 ? ' · drag to retime' : ''}`;
        d.addEventListener('pointerdown', (e) => keyDown(e, part, i));
        row.append(d);
      });
      row.addEventListener('dblclick', (e) => {
        if (e.target !== row && !e.target.classList.contains('elabel')) return;
        if (addKey(part, C.toU(api.timeAt(e.clientX)))) choose(part, ed.key);
      });
      rowsBox.append(row);
    }
    rowsBox.append(el('div', 'cursor'));
    markRows();
  }
  function markRows() {
    for (const row of rowsBox.querySelectorAll('.erow')) {
      for (const d of row.querySelectorAll('.ekey')) d.classList.toggle('sel', row.dataset.part === ed.part?.id && Number(d.dataset.i) === ed.key);
    }
  }
  /** A key moment pressed: picked, and dragged sideways to retime it (not the first or last). */
  function keyDown(e, part, i) {
    e.stopPropagation();
    e.preventDefault();
    const d = e.currentTarget;
    choose(part, i, { rows: false });    // (the rows stay: this one is held)
    markRows();
    const keys = get(part.path);
    if (i === 0 || i === keys.length - 1) return;
    const C = ed.move.clock;
    const gap = 0.01 * C.max;
    const lo = keys[i - 1][0] + gap;
    const hi = keys[i + 1][0] - gap;
    d.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const u = r4(clamp(C.toU(api.timeAt(ev.clientX)), lo, hi));
      if (u === get(part.path)[i][0]) return;
      begin();
      retime(part, i, u);
      d.style.left = api.pct(C.toT(u));
      ed.seekTo = C.toT(u);
      ed.dirty = true;
      showKeyInfo();
    };
    const up = () => {
      d.removeEventListener('pointermove', move);
      d.removeEventListener('pointerup', up);
      end();
      ed.rebuild = true;
      ed.dirty = true;
    };
    d.addEventListener('pointermove', move);
    d.addEventListener('pointerup', up);
  }
  function keyText(part, i) {
    const keys = get(part.path);
    const u = keys[i][0];
    const C = ed.move.clock;
    const where = C.max === 2 ? (u <= 1 ? `${Math.round(u * 100)}% into the dash` : `${Math.round((u - 1) * 100)}% into the landing`)
      : `${Math.round(u * 100)}% into ${C.of}`;
    return `key moment ${i + 1} of ${keys.length}, ${where} (${C.toT(u).toFixed(3)} s)`;
  }

  // ---------------------------------------------------------------- the panel
  function showPanel({ rows = true } = {}) {
    const box = $('editBody');
    box.replaceChildren();
    document.body.classList.toggle('editing', ed.open);
    $('edit').hidden = !ed.open;
    if (!ed.open) return;
    const id = view.scene.id;
    const M = ed.move;
    $('editTitle').textContent = `${id} ${api.nameOf(id)}`;
    if (!M) {
      box.append(el('p', 'note', `This move isn't placed by hand: it's a clip or the game's own, so there's nothing to edit here. The moves placed by hand (marked ✎ edit in the list): ${EDITABLE_TEXT}.`));
      drawRows();
      showStatus();
      return;
    }
    const about = M.about.map((path) => get([...path, 'about'])).filter(Boolean).join(' ');
    if (about) box.append(el('p', 'note about', about));
    if (lockedNow()) {
      const warn = el('p', 'warn', `${id} is Locked: the tester approved it. `);
      const b = el('button', '', 'Change it anyway');
      b.addEventListener('click', () => {
        ed.unlocked.add(id);
        showPanel();
        drawRows();
      });
      warn.append(b);
      box.append(warn);
      drawRows();
      showStatus();
      return;
    }
    box.append(el('p', 'note', 'Changes here show wherever this move plays, in other rows of the list too.'));
    const parts = el('div', 'parts');
    for (const part of M.parts) {
      const b = el('button', part === ed.part ? 'on' : '', part.label);
      b.addEventListener('click', () => choose(part));
      parts.append(b);
    }
    box.append(parts);
    const part = ed.part;
    if (part) {
      const sec = el('section', 'part');
      const keyed = isKeys(get(part.path));
      if (keyed) {
        const nav = el('div', 'row');
        const prev = el('button', '', '◀');
        prev.title = 'The key moment before';
        prev.disabled = ed.key <= 0;
        prev.addEventListener('click', () => choose(part, ed.key - 1));
        const next = el('button', '', '▶');
        next.title = 'The key moment after';
        next.disabled = ed.key >= get(part.path).length - 1;
        next.addEventListener('click', () => choose(part, ed.key + 1));
        nav.append(prev, el('span', 'keyInfo'), next);
        sec.append(nav);
      } else sec.append(el('p', 'keyInfo note', ed.move.clock ? 'The same all through the move.' : ''));
      if (part.note) sec.append(el('p', 'note', part.note));
      if (part.turn) {
        const modes = el('div', 'row modes');
        for (const [mode, label] of [['move', 'Move'], ['turn', 'Turn the hand']]) {
          const b = el('button', ed.mode === mode ? 'on' : '', label);
          b.dataset.mode = mode;
          b.disabled = mode === 'turn' && !turnPaths(part);
          b.addEventListener('click', () => {
            ed.mode = mode;
            showPanel();
          });
          modes.append(b);
        }
        sec.append(modes);
        if (ed.mode === 'turn' && turnPaths(part) && !turnPaths(part).keyed && keyed) sec.append(el('p', 'note', "The hand's turn is the same at every key moment of this move."));
      }
      if (part.kind === 'point' || part.kind === 'pole') sec.append(xyzInputs(part));
      if (part.kind === 'angle') sec.append(angleInput(part));
      if (keyed) {
        // at this key moment, does it pause for an instant, or flow on through it?
        sec.append(el('div', 'unit', 'At this key moment it:'));
        const ease = el('div', 'row ease');
        const k = get(part.path)[ed.key];
        for (const [pass, label, tip] of [
          [false, 'Slows to a stop', 'It slows down into this pose and speeds up out of it again, as if pausing for an instant (every key moment did, at first)'],
          [true, 'Keeps moving', 'It moves through this pose without slowing down: one smooth motion from the key moment before to the one after'],
        ]) {
          const b = el('button', (k?.[2] === 'pass') === pass ? 'on' : '', label);
          b.title = tip;
          b.addEventListener('click', () => {
            if ((get(part.path)[ed.key]?.[2] === 'pass') !== pass) setEase(part, ed.key, pass);
            showPanel();
          });
          ease.append(b);
        }
        sec.append(ease);
        sec.append(el('p', 'note', 'Slows to a stop: a pause in the motion, for a pose that should land (the end of a swing, a turn back). Keeps moving: for a point in the middle of one smooth swing. On the timeline, ◆ slows to a stop, ● keeps moving.'));
        const keysRow = el('div', 'row');
        const add = el('button', '', 'Add a key moment here');
        add.title = 'At the moment the scene is at: the part where it is now, to move from there (or double-click its row on the timeline)';
        add.addEventListener('click', () => {
          if (addKey(part, uNow())) choose(part, ed.key);
          else api.toast('Too close to a key moment: move the scene a little first');
        });
        const del = el('button', '', 'Delete this key moment');
        del.disabled = ed.key <= 0 || ed.key >= get(part.path).length - 1;
        del.title = del.disabled ? "The move's first and last key moments stay" : 'Delete (the Delete key)';
        del.addEventListener('click', () => {
          if (deleteKey(part, ed.key)) choose(part, ed.key);
        });
        keysRow.append(add, del);
        sec.append(keysRow);
      }
      sec.append(el('p', 'note reach', ''));
      sec.querySelector('.reach').id = 'editReach';
      box.append(sec);
    } else box.append(el('p', 'note', 'Pick a part above, a ball on the athlete, or a key moment on the timeline.'));
    if (M.blend) box.append(blendInputs(M));
    box.append(el('p', 'note legend', 'Arrows: red to its left, green up, blue forward. Rings turn the hand. Drag a key moment on the timeline to retime it; double-click a row to add one. Ctrl+Z undoes.'));
    showKeyInfo();
    showStatus();
    if (rows) drawRows();
  }
  function showKeyInfo() {
    const info = document.querySelector('#editBody .keyInfo');
    if (info && ed.part && isKeys(get(ed.part.path)) && get(ed.part.path)[ed.key]) info.textContent = keyText(ed.part, ed.key);
  }
  function numberBox(value, step, onChange) {
    const input = el('input');
    Object.assign(input, { type: 'number', step, value });
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value === '' || !Number.isFinite(v)) {
        showPanel();
        return;
      }
      onChange(v);
    });
    return input;
  }
  function xyzInputs(part) {
    const box = el('div', 'xyz');
    const v = part.kind === 'pole' ? get(part.path) : asArray(editedValue(part));
    const names = part.kind === 'pole' ? LEFT_UP_FORWARD : part.axes;
    names.forEach((name, d) => {
      const label = el('label');
      const input = numberBox(v[d], '0.01', (x) => change(() => {
        const now = [...asArray(part.kind === 'pole' ? get(part.path) : editedValue(part))];
        now[d] = r3(clamp(x, -3, 3));
        if (part.kind === 'pole') put(part.path, now);
        else setValue(part, now);
      }));
      input.dataset.d = d;
      label.append(el('span', '', name), input);
      box.append(label);
    });
    box.append(el('span', 'unit', part.kind === 'pole' ? '(a direction)' : 'm'));
    return box;
  }
  /** The numbers shown, as a handle moves. */
  function showValues() {
    const part = ed.part;
    if (!part || part.kind === 'angle') return;
    const v = part.kind === 'pole' ? get(part.path) : asArray(editedValue(part));
    for (const input of document.querySelectorAll('#editBody .xyz input')) input.value = v[Number(input.dataset.d)];
  }
  function angleInput(part) {
    const box = el('div', 'angle');
    const keys = get(part.path);
    const read = () => (isKeys(get(part.path)) ? get(part.path)[ed.key][1] : get(part.path));
    const write = (deg) => {
      const rad = r3(clamp(deg, -120, 120) / DEG);
      if (isKeys(get(part.path))) get(part.path)[ed.key][1] = rad;
      else put(part.path, rad);
    };
    const slider = el('input');
    Object.assign(slider, { type: 'range', min: -90, max: 90, step: 1, value: Math.round(read() * DEG) });
    const num = numberBox(Math.round(read() * DEG * 10) / 10, '1', (deg) => change(() => write(deg)));
    slider.addEventListener('input', () => {
      begin();
      write(Number(slider.value));
      num.value = slider.value;
      ed.dirty = true;
    });
    slider.addEventListener('change', () => end());
    box.append(el('span', '', part.axis === 'turn' ? 'Turn' : 'Lean'), slider, num, el('span', 'unit', '°'));
    if (!isKeys(keys) && ed.move.clock) box.append(el('p', 'note', 'The same all through the move.'));
    if (part.note) box.append(el('p', 'note', part.note));
    return box;
  }
  function blendInputs(M) {
    const box = el('div', 'blend');
    const b = get(M.blend);
    box.append(el('span', '', 'Blend: in'));
    box.append(numberBox(b.in, '0.01', (v) => change(() => { get(M.blend).in = r3(clamp(v, 0, 2)); })), el('span', 'unit', 's'));
    if (b.out !== undefined) {
      box.append(el('span', '', 'out'));
      box.append(numberBox(b.out, '0.01', (v) => change(() => { get(M.blend).out = r3(clamp(v, 0.01, 2)); })), el('span', 'unit', 's'));
    }
    const wrap = el('div');
    wrap.append(box);
    wrap.append(el('p', 'note', `How long the move takes to come in and to go${M.blendNote ? `. ${M.blendNote}` : '.'}`));
    return wrap;
  }
  function showStatus() {
    const changedNow = isChanged();
    $('undoBtn').disabled = !ed.history.length;
    $('redoBtn').disabled = !ed.future.length;
    $('revertBtn').disabled = !changedNow;
    $('saveBtn').disabled = !changedNow || !ed.saving?.can;
    $('saveBtn').title = ed.saving?.can ? 'Save the moves file: the game plays it from its next start' : ed.saving?.why || '';
    const words = [];
    if (ed.message) words.push(ed.message);
    else if (changedNow) words.push('Unsaved changes.');
    else words.push('No changes since the last save.');
    if (ed.saving && !ed.saving.can) words.push(`Saving is off: ${ed.saving.why}`);
    $('editStatus').textContent = words.join(' ');
    $('unsaved').hidden = !changedNow;
  }

  $('editBtn').addEventListener('click', () => setOpen(true));
  $('editCloseBtn').addEventListener('click', () => setOpen(false));
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('revertBtn').addEventListener('click', () => {
    if (confirm('Drop every change since the last save? (Undo brings them back.)')) revert();
  });
  $('saveBtn').addEventListener('click', save);

  function setOpen(open) {
    ed.open = open;
    if (open && ed.move && !ed.part) ed.part = ed.move.parts[0];
    if (open && ed.part) choose(ed.part, isKeys(get(ed.part.path)) ? ed.key : null);
    showPanel();
    api.relayout();                  // the picture and the timeline are narrower beside the panel
  }

  // a draft from before (this browser): offered, never put back without asking
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) || 'null');
    if (d && d.now && d.now !== ed.saved) {
      $('draftNote').hidden = false;
      $('draftText').textContent = d.base === ed.saved
        ? 'You have unsaved changes to the moves from before.'
        : 'You have unsaved changes to the moves from before (the file has changed since).';
      $('draftBackBtn').addEventListener('click', () => {
        begin();
        setMade(JSON.parse(d.now));
        end();
        ed.dirty = true;
        ed.rebuild = true;
        $('draftNote').hidden = true;
        setOpen(true);
      });
      $('draftDropBtn').addEventListener('click', () => {
        localStorage.removeItem(DRAFT);
        $('draftNote').hidden = true;
      });
    }
  } catch { /* no storage */ }

  return {
    /** A new scene: its move (if it has one made here), the same part picked if it has it. */
    sceneChanged() {
      const was = ed.part?.id;
      ed.move = sceneMove(view.scene.id, view.player);
      ed.part = ed.move?.parts.find((p) => p.id === was) ?? ed.move?.parts[0] ?? null;
      const keys = ed.part && get(ed.part.path);
      if (isKeys(keys)) ed.key = clamp(ed.key, 0, keys.length - 1);
      const btn = $('editBtn');             // on every move: greyed where there's nothing placed by hand to change
      btn.hidden = false;
      btn.disabled = !ed.move;
      btn.title = ed.move ? 'Change this move: its hands, feet, turns and key moments'
        : `This move is a clip or the game's own. Only the moves placed by hand can be changed here (marked ✎ edit in the list): ${EDITABLE_TEXT}`;
      if (ed.open && ed.part) choose(ed.part, isKeys(keys) ? ed.key : null);
      showPanel();
    },
    /** The scene was made again (other timings, a retimed key): its clock, the rows. */
    timelineBuilt() {
      if (!ed.move) return;
      const keep = ed.part?.id;
      ed.move = sceneMove(view.scene.id, view.player);
      ed.part = ed.move?.parts.find((p) => p.id === keep) ?? null;
      drawRows();
    },
    /** Each frame: the scene played again if the moves changed, and the handles placed. */
    frame() {
      if (ed.dirty) {
        ed.dirty = false;
        const t = ed.seekTo;
        ed.seekTo = null;
        if (ed.rebuild) {
          ed.rebuild = false;
          api.rebuild(t);
        } else api.resim(t);
        showKeyInfo();
        markRows();
      }
      placeHandles();
    },
    keydown(e) {
      if (!ed.open) return false;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.code === 'KeyZ') {
        if (e.shiftKey) redo();
        else undo();
      } else if (ctrl && e.code === 'KeyY') redo();
      else if (ctrl && e.code === 'KeyS') save();
      else if (e.code === 'Delete' && ed.part && isKeys(get(ed.part.path))) {
        if (deleteKey(ed.part, ed.key)) choose(ed.part, ed.key);
      } else return false;
      e.preventDefault();
      return true;
    },
    // for tests (tests/browser/move_view.js): the same steps as the page's buttons and handles
    test: {
      open: () => setOpen(true),
      close: () => setOpen(false),
      state: () => ({
        open: ed.open, part: ed.part?.id ?? null, key: ed.key, mode: ed.mode, parts: ed.move?.parts.map((p) => p.id) ?? null,
        changed: isChanged(), undo: ed.history.length, redo: ed.future.length, saving: ed.saving, message: ed.message,
        handle: tc.object ? tc.mode : null, rows: rowsBox.querySelectorAll('.erow').length, locked: !!lockedNow(),
      }),
      choose: (id, key = null) => choose(ed.move.parts.find((p) => p.id === id), key),
      value: (id, key = null) => {
        const v = get(ed.move.parts.find((p) => p.id === id).path);
        return isKeys(v) && key !== null ? v[key] : v;
      },
      keys: (id) => get(ed.move.parts.find((p) => p.id === id).path).map((k) => k[0]),
      /** A handle dragged by (dx, dy, dz) metres in the athlete's frame, as TransformControls moves it. */
      drag: (dx, dy, dz) => {
        frameNow();
        dragStart();
        proxy.position.add(new THREE.Vector3(dx, dy, dz).applyQuaternion(frameNow().q));
        dragMove();
        dragEnd();
      },
      /** The hand turned about its fingers (deg), as the rings turn it. */
      turn: (deg) => {
        ed.mode = 'turn';
        placeHandles();
        dragStart();
        proxy.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), deg / DEG));
        tc.mode = 'rotate';
        dragMove();
        dragEnd();
      },
      type: (d, v) => {
        const input = document.querySelectorAll('#editBody .xyz input')[d];
        input.value = v;
        input.dispatchEvent(new Event('change'));
      },
      angle: (deg) => {
        const input = document.querySelector('#editBody .angle input[type=number]');
        input.value = deg;
        input.dispatchEvent(new Event('change'));
      },
      retime: (id, i, u) => {
        const part = ed.move.parts.find((p) => p.id === id);
        change(() => retime(part, i, r4(u)), { retimed: true });
      },
      addKey: (id, u) => addKey(ed.move.parts.find((p) => p.id === id), u),
      deleteKey: (id, i) => deleteKey(ed.move.parts.find((p) => p.id === id), i),
      ease: (id, i, pass) => setEase(ed.move.parts.find((p) => p.id === id), i, pass),
      blend: (which, v) => {
        const input = [...document.querySelectorAll('#editBody .blend input')][which === 'in' ? 0 : 1];
        input.value = v;
        input.dispatchEvent(new Event('change'));
      },
      undo, redo, revert, save,
      made: () => JSON.parse(JSON.stringify(MADE)),
      /** No "Leave site?" question (a test reloads the page with unsaved changes). */
      noAsking: () => {
        ed.ask = false;
      },
      /** Saving as if the server allowed it (tests run it with --fresh, which saves nothing). */
      pretendSaving: () => {
        ed.saving = { can: true, why: null };
        showStatus();
      },
      /** Where a part's ball is on the screen (CSS pixels), for a real mouse drag. */
      screen: (id) => {
        const ball = balls.get(id ?? ed.part.id);
        const r = canvas.getBoundingClientRect();
        const p = ball.position.clone().project(world.camera);
        return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
      },
      ball: (id) => balls.get(id ?? ed.part.id)?.position.toArray().map(r3),
      reach: () => $('editReach')?.textContent ?? '',
    },
  };
}
