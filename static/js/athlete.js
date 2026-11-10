// The athlete (art/athlete.py): a skinned body in two versions, a sports helmet or a face with
// hair (one picked for each player, decision 128), each in two sizes (High and Low graphics).
// Each pixel of a mesh's map holds a colour slot, not a colour, so every player's copy is painted
// in their team's kit and their own skin, hair and eyes.
//
// How it moves (step 8), in layers, each frame:
// - running and standing: clips of real motion (art/moves.py: CC0 Mesh2Motion / Quaternius clips
//   retargeted onto this skeleton). The run follows the player's speed; the legs turn where the
//   player goes while the chest and head keep facing the aim; backwards, a backpedal;
// - the whole body: the perfect dodges' acrobatics (a corkscrew, an aerial side flip, a butterfly
//   twist; a backflip going backwards), flinches, knockouts that fall away from the ball, getting
//   up when revived, winning and losing (clips);
// - the dodges' footwork, and the arms: placed by hand in the body's frame and reached with
//   two-bone IK, because no library has them: a side step pushed off the far foot, a half-crouched
//   step forwards, a jump back; three throws (overhead, side-arm, underarm like bowling), the left
//   forearm guarding the face while charging, a backhand parry and a one-handed palm catch with it.
// Every action is stretched to its player's timings: the game's rules with that player's own
// settings (man.timing, from main.js), else the game's (world.timing: the moves page's too).
import * as THREE from 'three';
import { GLTFLoader } from '/static/vendor/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '/static/vendor/addons/utils/SkeletonUtils.js';

const DIR = '/static/characters/';

// Skin, hair and eyes: the style samples' six looks (art/style_samples_2.py LOOKS2).
const LOOKS = [
  { skin: 0xe3ab82, hair: 0x3a2418, iris: 0x7a5230 },
  { skin: 0x9a6440, hair: 0x1a1410, iris: 0x4a2e1a },
  { skin: 0xf0c4a0, hair: 0xc8903e, iris: 0x3f7a9a },
  { skin: 0xc48a5c, hair: 0x2a1a12, iris: 0x5a3a20 },
  { skin: 0x6e4329, hair: 0x141010, iris: 0x3a2414 },
  { skin: 0xdba57c, hair: 0x5a3520, iris: 0x4f7a3a },
];
const LIPS = 0xb8484a;
// The shirt is the team's colour deepened, so it still reads as the team's in the warm sun (the
// style samples' kit); trims, socks' stripes and the helmet are the team's colour itself.
const DEEP = [0xc8102e, 0x0d5bd6];

// The bones, parents first, and the stick figure's joint each one turns with.
const BONES = ['hips', 'chest', 'head', 'upper_L', 'fore_L', 'hand_L', 'upper_R', 'fore_R', 'hand_R',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
const PARENT = {
  chest: 'hips', head: 'chest', upper_L: 'chest', fore_L: 'upper_L', hand_L: 'fore_L', upper_R: 'chest', fore_R: 'upper_R',
  hand_R: 'fore_R', thigh_L: 'hips', shin_L: 'thigh_L', foot_L: 'shin_L', thigh_R: 'hips', shin_R: 'thigh_R', foot_R: 'shin_R',
};
const JOINT = {
  hips: 'none', chest: 'chest', head: 'chest', upper_L: 'shoulderL', fore_L: 'elbowL', hand_L: 'elbowL',
  upper_R: 'shoulderR', fore_R: 'elbowR', hand_R: 'elbowR', thigh_L: 'hipL', shin_L: 'kneeL', foot_L: 'kneeL',
  thigh_R: 'hipR', shin_R: 'kneeR', foot_R: 'kneeR',
};
const LIMBS = {
  L: ['upper_L', 'fore_L', 'hand_L'], R: ['upper_R', 'fore_R', 'hand_R'],
  legL: ['thigh_L', 'shin_L', 'foot_L'], legR: ['thigh_R', 'shin_R', 'foot_R'],
};
const STICK_HIPS = 0.95;              // the stick figure's hips above its feet (world.js)

// Which bones a layer moves (and how much).
const UPPER = { chest: 0.55, head: 0.55, upper_L: 1, fore_L: 1, hand_L: 1, upper_R: 1, fore_R: 1, hand_R: 1 };
const LEGS = ['hips', 'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R'];
const RIGHT_ARM = { upper_R: 1, fore_R: 1, hand_R: 1 };
const LEFT_ARM = { upper_L: 1, fore_L: 1, hand_L: 1 };
const LEFT_TURN = { upper_L: 1, fore_L: 1, hand_L: 1, chest: 1, head: 1, hips: 1 };
const RIGHT_TURN = { upper_R: 1, fore_R: 1, hand_R: 1, chest: 1, head: 1, hips: 1 };

// The moves' own numbers (the rest are the game's rules, world.timing).
const ACRO_TIME = 0.5;                // a perfect dodge's acrobatics (s)
const ACROBATICS = ['corkscrew', 'sideflip', 'butterfly'];
const RELEASE = 0.42;                 // a throw's release, from the wound-up arm through (s)
const FOLLOW = 0.35;                  // the overhead throw's clip: on past its release into the follow-through (s)
const MIN_STRIDE = 4.2;               // metres a running cycle, at least
const CORK_HEIGHT = 0.28;             // the corkscrew (and backflip) fly this share of the clip's height
const GETUP = 1.1;                    // getting up when revived (s)
const RISE_CUT = 0.15;                // moving while getting up: the get-up gives way to the run over this long (s)
const CAUGHT = 0.35;                  // a caught ball shows in the left palm this long (s)
const WINS = ['win_jump', 'win_pump', 'cheer'];
const THROW_STYLES = ['over', 'side', 'under'];
const ACTS = { 1: 'dodge', 2: 'catch', 3: 'deflect' };     // the game's action codes
const TIMING = {                      // the game's defaults, until the server's arrive
  dash: { time: 0.22 }, chargeTime: 0.9,
  actions: { dodge: { window: 0.32, recovery: 0.15 }, catch: { window: 0.3, recovery: 0.25 }, deflect: { window: 0.18, recovery: 0.3 } },
};
/** The timings a figure's moves fit: its player's own (a beginner given a longer catch window
 *  catches for longer on everyone's screen), else the game's, else the defaults. */
const timingOf = (man) => man.timing || man.world.timing || TIMING;

// ------------------------------------------------------------------ the moves made here
// No CC0 library has these, so hands and feet are placed by hand in the body's frame (X: the
// athlete's left, Y: up, Z: forward; metres from the feet), and the limbs bend to reach them.
// Their numbers are in static/characters/made_moves.json (each move says there what it is), which
// the moves page's editor changes (move_edit.js); MADE holds them once loaded:
// - GUARD_L: the left forearm across the face while charging; CARRY_R: the right hand holding the
//   ball; CATCH_L: the palm catch, PULL_L: a caught ball pulled in; PARRY_L: the deflect's backhand
//   parry; THROWS: the side-arm and underarm throws; DASH_SIDE, DASH_FORWARD, DASH_BACK: the dodges'
//   footwork;
// - keys are [time, value] (a key [time, value, 'pass'] is passed through without stopping);
//   blend: seconds to come in ('in') and to go ('out').
export const MADE = {};

/** The moves made here, all of them at once (loading, and the editor's undo). */
export function setMade(data) {
  for (const k of Object.keys(MADE)) delete MADE[k];
  Object.assign(MADE, data);
}

// A faint cool light on the edges, where the body turns away from you: the athletes stand out
// from the warm, busy hall, and the dark visor gets a glossy rim.
const RIM = new THREE.Color(0xcfe6ff);
const RIM_STRENGTH = 0.35;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const approach = (cur, target, step) => (cur < target ? Math.min(target, cur + step) : Math.max(target, cur - step));
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** 1 in the middle of a move, rising over its first `rise` seconds and falling over its last `fall`. */
const fades = (t, span, rise, fall) => Math.min(rise > 0 ? clamp(t / rise, 0, 1) : 1, clamp((span - t) / fall, 0, 1));

/** Through keyframes [[time, value], ...] at u, easing from one to the next; vector values go into
 *  out. Each key is a stop (the value slows into it and out of it), unless it's [time, value,
 *  'pass']: then it's passed through at the speed it has between its neighbours. */
export function at(keys, u, out = null) {
  let i = 0;
  while (i < keys.length - 2 && u > keys[i + 1][0]) i++;
  const j = Math.min(i + 1, keys.length - 1);
  const [u0, a] = keys[i];
  const [u1, b] = keys[j];
  const k = u1 > u0 ? smooth(0, 1, (u - u0) / (u1 - u0)) : 1;
  const pass0 = keys[i][2] === 'pass';
  const pass1 = keys[j][2] === 'pass';
  if (!pass0 && !pass1) {
    if (typeof a === 'number') return a + (b - a) * k;
    return out.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k));
  }
  // a cubic (Hermite) segment: the ease above, plus each passing key's speed
  const s = u1 > u0 ? clamp((u - u0) / (u1 - u0), 0, 1) : 1;
  const h = u1 - u0;
  const c0 = pass0 ? h * (s * s * s - 2 * s * s + s) : 0;
  const c1 = pass1 ? h * (s * s * s - s * s) : 0;
  const one = (d) => {
    let v = lerp(valueOf(keys[i], d), valueOf(keys[j], d), k);
    if (c0) v += c0 * slope(keys, i, d);
    if (c1) v += c1 * slope(keys, j, d);
    return v;
  };
  if (typeof a === 'number') return one(0);
  return out.set(one(0), one(1), one(2));
}
const valueOf = (key, d) => (typeof key[1] === 'number' ? key[1] : key[1][d]);
/** How fast a key's value changes as it passes: from the key before it to the key after it. */
function slope(keys, n, d) {
  const p = keys[Math.max(0, n - 1)];
  const q = keys[Math.min(keys.length - 1, n + 1)];
  return q[0] > p[0] ? (valueOf(q, d) - valueOf(p, d)) / (q[0] - p[0]) : 0;
}

const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const tq = new THREE.Quaternion();
const tq2 = new THREE.Quaternion();
const tq3 = new THREE.Quaternion();
const tq4 = new THREE.Quaternion();
const tq5 = new THREE.Quaternion();
const tq6 = new THREE.Quaternion();
const tv = new THREE.Vector3();
const tv2 = new THREE.Vector3();
const tv3 = new THREE.Vector3();
const tv4 = new THREE.Vector3();
const tv5 = new THREE.Vector3();
const tv6 = new THREE.Vector3();
const tv7 = new THREE.Vector3();
const tm = new THREE.Matrix4();

function rimmed(mat) {
  const c = `vec3(${RIM.r.toFixed(4)}, ${RIM.g.toFixed(4)}, ${RIM.b.toFixed(4)})`;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += ${c} * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0) * ${RIM_STRENGTH.toFixed(2)};`);
  };
  mat.customProgramCacheKey = () => 'athlete-rim';
  return mat;
}

/** A repeatable number from a player's id: everyone's screen picks the same head and look. */
export function hash(n) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A map's colour slots (art/athlete.py writes slot x 16 + 8 in a grey PNG). */
async function slotMap(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const px = g.getImageData(0, 0, c.width, c.height).data;
  const ids = new Uint8Array(c.width * c.height);
  for (let i = 0; i < ids.length; i++) ids[i] = px[i * 4] >> 4;
  return { ids, size: c.width };
}

/** A texture from a map and a palette (4 bytes a slot): each 2 x 2 of slots averaged into one
 *  pixel, so borders come out smooth. */
function paint(map, pal, colorSpace) {
  const w = map.size;
  const n = w >> 1;
  const ids = map.ids;
  const out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    const r0 = 2 * y * w;
    const r1 = r0 + w;
    for (let x = 0; x < n; x++) {
      const a = ids[r0 + 2 * x] * 4;
      const b = ids[r0 + 2 * x + 1] * 4;
      const c = ids[r1 + 2 * x] * 4;
      const d = ids[r1 + 2 * x + 1] * 4;
      const o = (y * n + x) * 4;
      out[o] = (pal[a] + pal[b] + pal[c] + pal[d] + 2) >> 2;
      out[o + 1] = (pal[a + 1] + pal[b + 1] + pal[c + 1] + pal[d + 1] + 2) >> 2;
      out[o + 2] = (pal[a + 2] + pal[b + 2] + pal[c + 2] + pal[d + 2] + 2) >> 2;
      out[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(out, n, n, THREE.RGBAFormat);
  t.colorSpace = colorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** The colours of every slot for one player: their team's kit, their look's skin, hair and eyes. */
function palette(info, teamColor, team, look) {
  const col = info.color.map((c) => new THREE.Color(c));
  const set = (slot, c) => { col[info.slots.indexOf(slot)] = c; };
  const kit = new THREE.Color(teamColor);
  const skin = new THREE.Color(look.skin);
  set('skin', skin);
  set('lips', skin.clone().lerp(new THREE.Color(LIPS), 0.45));
  set('hair', new THREE.Color(look.hair));
  set('iris', new THREE.Color(look.iris));
  set('cloth', kit.clone().lerp(new THREE.Color(DEEP[team] ?? teamColor), 0.4));
  set('bright', kit);
  set('helmet', kit);
  const pal = new Uint8Array(64);
  col.forEach((c, i) => {
    const h = c.getHex();
    pal.set([h >> 16, (h >> 8) & 255, h & 255, 255], i * 4);
  });
  return pal;
}

// ------------------------------------------------------------------ poses and clips
// A pose: each bone's turn (local, as three.js holds it) and the hips' position.

function newPose(from) {
  const p = { q: {}, p: new THREE.Vector3() };
  for (const b of BONES) p.q[b] = from ? from.q[b].clone() : new THREE.Quaternion();
  if (from) p.p.copy(from.p);
  return p;
}

function copyPose(dst, src) {
  for (const b of BONES) dst.q[b].copy(src.q[b]);
  dst.p.copy(src.p);
  return dst;
}

/** dst moves towards src by w, on the bones the mask names (all of them without one). */
function mix(dst, src, w, mask = null) {
  if (w <= 0.001) return dst;
  for (const b of BONES) {
    const k = mask ? w * (mask[b] ?? 0) : w;
    if (k >= 0.999) dst.q[b].copy(src.q[b]);
    else if (k > 0.001) dst.q[b].slerp(src.q[b], k);
  }
  const k = mask ? w * (mask.hips ?? 0) : w;
  if (k > 0.001) dst.p.lerp(src.p, Math.min(1, k));
  return dst;
}

/** One of art/moves.py's clips, with its measurements (duration; for run cycles the stride and
 *  footfall; for jumps the takeoff and touchdown; for the throw the cocked arm and the release). */
class Clip {
  constructor(anim, meta = {}) {
    Object.assign(this, meta);
    this.duration = meta.duration ?? anim.duration;
    this.rot = new Map();
    this.pos = null;
    for (const track of anim.tracks) {
      const dot = track.name.lastIndexOf('.');
      const node = track.name.slice(0, dot);
      const prop = track.name.slice(dot + 1);
      if (prop === 'quaternion') this.rot.set(node, track.createInterpolant(new Float32Array(4)));
      else if (prop === 'position' && node === 'hips') this.pos = track.createInterpolant(new Float32Array(3));
    }
  }

  /** The pose t seconds in, into out: a loop wraps round, anything else holds its ends. Bones the
   *  clip doesn't move keep out's. */
  sample(t, out, loop = false) {
    const d = this.duration;
    const t1 = loop ? ((t % d) + d) % d : clamp(t, 0, d);
    for (const [name, it] of this.rot) {
      const v = it.evaluate(t1);
      out.q[name].set(v[0], v[1], v[2], v[3]);
    }
    if (this.pos) {
      const v = this.pos.evaluate(t1);
      out.p.set(v[0], v[1], v[2]);
    }
    return out;
  }
}

// ------------------------------------------------------------------ reaching
// The pose's bones in the body's frame (forward kinematics), and two-bone IK on top of it.

class Frame {
  constructor() {
    this.pos = {};
    this.rot = {};
    for (const b of BONES) {
      this.pos[b] = new THREE.Vector3();
      this.rot[b] = new THREE.Quaternion();
    }
  }

  /** Every bone's place and turn in the body's frame, from a pose. */
  of(P, R) {
    this.rot.hips.multiplyQuaternions(R.armQ, P.q.hips);
    this.pos.hips.copy(P.p).applyQuaternion(R.armQ);
    for (const b of BONES) {
      if (b === 'hips') continue;
      const p = PARENT[b];
      this.rot[b].multiplyQuaternions(this.rot[p], P.q[b]);
      this.pos[b].copy(R.local[b]).applyQuaternion(this.rot[p]).add(this.pos[p]);
    }
    return this;
  }
}

/** Turns a bone (not the hips) by angle about a body-frame axis, the bones below it coming along;
 *  keep: a child whose turn in the body's frame stays as it was (the head, looking ahead). */
function turnBone(P, F, bone, axis, angle, keep = null) {
  if (Math.abs(angle) < 1e-4) return;
  const was = keep ? tq6.copy(F.rot[keep]) : null;
  const body = tq5.setFromAxisAngle(axis, angle).multiply(F.rot[bone]);
  P.q[bone].copy(F.rot[PARENT[bone]]).invert().multiply(body);
  F.rot[bone].copy(body);
  if (keep) P.q[keep].copy(body).invert().multiply(was);
}

/** Bends a limb (an arm: 'L' or 'R'; a leg: 'legL' or 'legR') so its end reaches target (body
 *  frame), the middle joint bending towards pole. Updates the pose and the frame. */
function reach(P, F, R, limb, target, pole) {
  const [ra, mi, en] = LIMBS[limb];
  const A = F.pos[ra];
  const B = F.pos[mi];
  const C = F.pos[en];
  const la = A.distanceTo(B);
  const lb = B.distanceTo(C);
  const dir = tv.subVectors(target, A);
  const d = clamp(dir.length(), Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  dir.normalize();
  const cosA = clamp((la * la + d * d - lb * lb) / (2 * la * d), -1, 1);
  const side = tv2.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  const E = tv3.copy(A).addScaledVector(dir, la * cosA).addScaledVector(side, la * Math.sqrt(1 - cosA * cosA));
  const T = tv4.copy(A).addScaledVector(dir, d);
  const q1 = tq.setFromUnitVectors(tv5.subVectors(B, A).normalize(), tv6.subVectors(E, A).normalize());
  const rootRot = tq2.multiplyQuaternions(q1, F.rot[ra]);
  const midNow = tv5.subVectors(C, B).normalize().applyQuaternion(q1);
  const q2 = tq3.setFromUnitVectors(midNow, tv6.subVectors(T, E).normalize());
  const midRot = tq4.multiplyQuaternions(q2, q1).multiply(F.rot[mi]);
  P.q[ra].copy(F.rot[PARENT[ra]]).invert().multiply(rootRot);
  P.q[mi].copy(rootRot).invert().multiply(midRot);
  F.rot[ra].copy(rootRot);
  F.rot[mi].copy(midRot);
  F.pos[mi].copy(E);
  F.pos[en].copy(R.local[en]).applyQuaternion(midRot).add(E);
  F.rot[en].multiplyQuaternions(midRot, P.q[en]);
}

/** Turns a hand so its fingers point along `fingers` and its palm faces `palm` (body frame). */
function aimHand(P, F, R, side, fingers, palm) {
  const ax = R.hands[side];
  const f = tv.copy(fingers).normalize();
  const p = tv2.copy(palm).addScaledVector(f, -palm.dot(f)).normalize();
  const c = tv3.crossVectors(f, p);
  tm.makeBasis(f, p, c).multiply(ax.inv);
  const body = tq.setFromRotationMatrix(tm);
  const hand = `hand_${side}`;
  P.q[hand].copy(F.rot[`fore_${side}`]).invert().multiply(body);
  F.rot[hand].copy(body);
}

/** A foot flat on the floor, pointing ahead (its rest turn in the body's frame). */
function flatFoot(P, F, R, side) {
  P.q[`foot_${side}`].copy(F.rot[`shin_${side}`]).invert().multiply(R.restRot[`foot_${side}`]);
}

/** The legs turned yaw (radians, + to the right) towards where the player runs; the chest keeps a
 *  quarter of it and the head none, so both keep facing the aim. */
function turnLegs(P, R, yaw) {
  if (Math.abs(yaw) < 1e-3) return;
  const bh = tq.multiplyQuaternions(R.armQ, P.q.hips);
  const bc = tq2.multiplyQuaternions(bh, P.q.chest);
  const bd = tq3.multiplyQuaternions(bc, P.q.head);
  bh.premultiply(tq4.setFromAxisAngle(AXIS_Y, -yaw));          // a turn to the right is a negative turn about up
  P.q.hips.multiplyQuaternions(R.armInv, bh);
  bc.premultiply(tq4.setFromAxisAngle(AXIS_Y, -yaw * 0.25));
  P.q.chest.copy(bh).invert().multiply(bc);
  P.q.head.copy(bc).invert().multiply(bd);
}

/** What the moves need from the athlete at rest: each bone's place and turn in the body's frame,
 *  the stick-figure retargeting's straightened rests, and each hand's fingers and palm. */
function restOf(scene) {
  scene.updateMatrixWorld(true);
  const pos = {};
  const rot = {};
  const local = {};
  const pose = newPose();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const name of BONES) {
    const bone = scene.getObjectByName(name);
    bone.matrixWorld.decompose(p, q, s);
    pos[name] = p.clone();
    rot[name] = q.clone();
    local[name] = bone.position.clone();
    pose.q[name].copy(bone.quaternion);
  }
  pose.p.copy(local.hips);
  scene.getObjectByName('hips').parent.matrixWorld.decompose(p, q, s);
  const armQ = q.clone();                   // the skeleton's own node
  const down = new THREE.Vector3(0, -1, 0);
  const straight = (a, b) => new THREE.Quaternion().setFromUnitVectors(pos[b].clone().sub(pos[a]).normalize(), down);
  const fix = {};
  for (const x of ['L', 'R']) {
    fix[`upper_${x}`] = straight(`upper_${x}`, `fore_${x}`);
    fix[`fore_${x}`] = fix[`hand_${x}`] = straight(`fore_${x}`, `hand_${x}`);
    fix[`thigh_${x}`] = straight(`thigh_${x}`, `shin_${x}`);
    fix[`shin_${x}`] = fix[`foot_${x}`] = straight(`shin_${x}`, `foot_${x}`);
  }
  const rest = {};
  for (const name of BONES) rest[name] = (fix[name] || new THREE.Quaternion()).clone().multiply(rot[name]);
  // the right hand's fingers and palm at rest, from where a held ball sits (the left mirrors them)
  const palmAt = scene.getObjectByName('palm_R').getWorldPosition(new THREE.Vector3());
  const ballAt = scene.getObjectByName('ball_R').getWorldPosition(new THREE.Vector3());
  const palmR = ballAt.clone().sub(palmAt).normalize();
  const fingersR = palmAt.clone().sub(pos.hand_R);
  fingersR.addScaledVector(palmR, -fingersR.dot(palmR)).normalize();
  const hands = {};
  for (const [side, f, pl] of [['R', fingersR, palmR], ['L', new THREE.Vector3(-fingersR.x, fingersR.y, fingersR.z), new THREE.Vector3(-palmR.x, palmR.y, palmR.z)]]) {
    const inv = rot[`hand_${side}`].clone().invert();
    const fl = f.clone().applyQuaternion(inv);
    const pl2 = pl.clone().applyQuaternion(inv);
    pl2.addScaledVector(fl, -pl2.dot(fl)).normalize();
    hands[side] = { fingers: fl, palm: pl2, inv: new THREE.Matrix4().makeBasis(fl, pl2, fl.clone().cross(pl2)).invert() };
  }
  return {
    rest, local, pose, restRot: rot, armQ, armInv: armQ.clone().invert(), ankle: pos.foot_L.y, head: pos.head.clone(), hands,
    twist: local.chest.clone().normalize(),  // the hips' own length (a corkscrew's twist turns round it)
  };
}

/** Loads the athlete: its meshes and skeleton, the slot maps, the clips, and what the poses need. */
export async function loadAthlete() {
  const made = fetch(`${DIR}made_moves.json`).then((res) => {
    if (!res.ok) throw new Error(`made_moves.json: ${res.status}`);
    return res.json();
  });
  const info = await (await fetch(`${DIR}athlete.json`)).json();
  const names = Object.keys(info.maps);
  const [gltf, moves, ...maps] = await Promise.all([
    new GLTFLoader().loadAsync(`${DIR}athlete.glb`),
    made,
    ...names.map((name) => slotMap(DIR + info.maps[name])),
  ]);
  setMade(moves);
  const rm = new Uint8Array(64);             // roughness (green) and metalness (blue) per slot
  info.slots.forEach((_, i) => rm.set([0, Math.round(info.rough[i] * 255), Math.round(info.metal[i] * 255), 255], i * 4));
  const t = { info, scene: gltf.scene, maps: {}, rm: {}, painted: new Map(), rest: null, clips: new Map() };
  names.forEach((name, i) => {
    t.maps[name] = maps[i];
    t.rm[name] = paint(maps[i], rm, THREE.NoColorSpace);
  });
  gltf.scene.traverse((o) => {
    if (o.isMesh) o.material.dispose();      // each player gets their own
  });
  t.rest = restOf(gltf.scene);
  for (const anim of gltf.animations) t.clips.set(anim.name, new Clip(anim, info.moves?.[anim.name]));
  return t;
}

/** One player's athlete: their head, their colours, their own skeleton, their moves. */
export class Athlete {
  /** opts: { id, team, teamColor, head: 'helmet' | 'face' to force one (a URL's ?head=) } */
  constructor(t, { id, team, teamColor, head }) {
    const h = hash(id);
    this.id = id;
    this.head = head || t.info.heads[h & 1];
    this.look = (h >>> 1) % LOOKS.length;
    this.model = cloneSkinned(t.scene);
    this.meshes = { hi: [], lo: [] };
    this.mats = [];
    const pal = palette(t.info, teamColor, team, LOOKS[this.look]);
    const unused = [];
    this.model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const [part, size] = o.name.split('_');                // body_hi, helmet_lo, face_hi, ...
      if (part !== 'body' && part !== this.head) {
        unused.push(o);
        return;
      }
      const key = `${o.name}|${team}|${this.look}`;
      if (!t.painted.has(key)) t.painted.set(key, paint(t.maps[o.name], pal, THREE.SRGBColorSpace));
      o.material = rimmed(new THREE.MeshStandardMaterial({
        map: t.painted.get(key), roughnessMap: t.rm[o.name], metalnessMap: t.rm[o.name], roughness: 1, metalness: 1,
        emissive: teamColor, emissiveIntensity: 0,
      }));
      o.frustumCulled = false;                               // its bounds move with the pose
      this.meshes[size].push(o);
      this.mats.push(o.material);
    });
    for (const o of unused) o.removeFromParent();
    this.bones = Object.fromEntries(BONES.map((name) => [name, this.model.getObjectByName(name)]));
    const palm = this.model.getObjectByName(t.info.held.palm);           // a held ball: where it touches the palm,
    const centre = this.model.getObjectByName(t.info.held.centre);       // and its centre at the file's size
    this.hand = palm.parent;                                              // the right hand's bone
    this.palm = palm.position.clone();
    this.reach = centre.position.clone().sub(this.palm).divideScalar(t.info.held.radius);
    this.rest = t.rest;
    this.clips = t.clips;
    this.moving = t.clips.size > 0;                                      // an older file without clips: the stick figure's poses
    this.low = null;
    // the stick figure's joints, turned into the body's frame (stickPose)
    this.joint = { none: new THREE.Quaternion() };
    for (const j of ['chest', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR']) this.joint[j] = new THREE.Quaternion();
    this.turn = Object.fromEntries(BONES.map((name) => [name, new THREE.Quaternion()]));
    this.at = { hips: new THREE.Vector3(), thigh: new THREE.Vector3(), shin: new THREE.Vector3(), foot: new THREE.Vector3() };
    // the moves: the pose being built, the layers' poses, a body frame, and their state
    const rp = t.rest.pose;
    this.out = newPose(rp);
    this.buf = { run: newPose(rp), sprint: newPose(rp), arms: newPose(rp), stick: newPose(rp), full: newPose(rp), reach: newPose(rp) };
    this.frame = new Frame();
    this.target = new THREE.Vector3();
    this.pole = new THREE.Vector3();
    this.fingers = new THREE.Vector3();
    this.palmDir = new THREE.Vector3();
    this.clock = Math.random() * 10;                         // idles out of step with each other
    this.phase = 0;
    this.back = false;
    this.legYaw = 0;
    this.w = { throw: 0, guard: 0, carry: 0, meet: 0, end: 0 };
    this.style = 'over';
    this.act = null;                                         // the action being played: action()
    this.acro = null;
    this.ko = null;
    this.flinch = 'flinch_chest';
    this.win = null;
    this.rise = 1;                                           // how much of the get-up is left (moving cuts it)
    this.rose = 9;                                           // the get-up's last moment, to tell a new one
  }

  /** High or Low graphics: which size of the meshes shows. */
  setLow(low) {
    if (low === this.low) return;
    this.low = low;
    for (const m of this.meshes.hi) m.visible = !low;
    for (const m of this.meshes.lo) m.visible = low;
  }

  /** The bones' turns from the stick figure's joints (in the body's frame, on top of each bone's
   *  own rest turn), into out; the hips go down with its crouch. */
  stickPose(man, out) {
    const J = this.joint;
    const T = this.turn;
    const R = this.rest;
    J.chest.copy(man.chest.quaternion);                      // the stick figure's hips never turn
    J.shoulderL.multiplyQuaternions(J.chest, man.armL.shoulder.quaternion);
    J.elbowL.multiplyQuaternions(J.shoulderL, man.armL.elbow.quaternion);
    J.shoulderR.multiplyQuaternions(J.chest, man.armR.shoulder.quaternion);
    J.elbowR.multiplyQuaternions(J.shoulderR, man.armR.elbow.quaternion);
    J.hipL.copy(man.legL.hip.quaternion);
    J.kneeL.multiplyQuaternions(J.hipL, man.legL.knee.quaternion);
    J.hipR.copy(man.legR.hip.quaternion);
    J.kneeR.multiplyQuaternions(J.hipR, man.legR.knee.quaternion);
    for (const name of BONES) T[name].multiplyQuaternions(J[JOINT[name]], R.rest[name]);
    for (const name of BONES) {
      const q = out.q[name];
      if (PARENT[name]) q.copy(T[PARENT[name]]).invert().multiply(T[name]);
      else q.copy(R.armInv).multiply(T[name]);
    }
    out.p.copy(R.local.hips);
    out.p.y += man.hips.position.y - STICK_HIPS;
    return out;
  }

  /** The stick figure's pose as it is (an athlete file without clips). */
  pose(man) {
    this.apply(this.stickPose(man, this.out), true);
  }

  /** This frame's pose (dt: the pose's own clock, stopped by an impact freeze; s: the player's
   *  state; man: their Stickman, with its timers and the stick figure's joints). */
  animate(dt, s, man) {
    if (!this.moving) {
      this.pose(man);
      return;
    }
    const tm = timingOf(man);
    const round = man.world.round || {};
    this.clock += dt;
    const A = this.action(dt, s, man, tm);
    const moving = this.run(dt, man, round);
    // a dodge's footwork first, the whole-body moves over it (a perfect dodge's acrobatics over its dash)
    let full = this.footwork(man, A);
    full = Math.max(full, this.wholeBody(dt, s, man, round, moving));
    turnLegs(this.out, this.rest, this.legYaw * (1 - full));
    if (s.alive && full < 0.99) {
      this.throwArm(dt, s, man, moving, A);
      this.leftArm(dt, s, man, A);
      this.carry(dt, s, man);
    }
    this.apply(this.out, s.alive && !(man.spinT < ACRO_TIME && this.acro));
  }

  /** The action being played (a dodge, a catch, a deflect): from when the game first shows it, on
   *  this figure's own clock to its end (the rules' window and recovery). The game's own stops early
   *  (a catch or deflect that meets the ball ends at once; your own press shows for 0.4 s), and
   *  other players' comes in steps, with the updates. Returns { kind, age, span, fall } or null. */
  action(dt, s, man, tm) {
    let A = this.act;
    if (A) A.age += dt;
    if (!s.alive) A = null;
    else if (s.act && (!A || A.kind !== s.act || s.actAge < A.age - 0.12)) A = this.startAction(s.act, s.actAge, man, tm);
    if (A && A.age >= A.span) A = null;
    return (this.act = A);
  }

  /** An action began age seconds ago (also from the game's events, for one only seen by its result). */
  startAction(kind, age, man, tm = timingOf(man)) {
    const spec = tm.actions[ACTS[kind]];
    this.act = { kind, age, span: spec.window + spec.recovery, fall: spec.recovery, dodge: null, done: false };
    return this.act;
  }

  /** The game's events: a caught ball (the catch is over: the left hand pulls it in), a deflect. */
  caughtBall() {
    if (this.act?.kind === 2) this.act.done = true;
  }

  deflected(man) {
    if (this.act?.kind !== 3) this.startAction(3, 0.1, man);   // the sweep, from about where it meets the ball
  }

  /** Running and standing: the cycles follow the speed; the legs turn where the player goes (up to
   *  75° from the aim; backwards, the run plays in reverse: a backpedal). Returns how much it runs. */
  run(dt, man, round) {
    const C = this.clips;
    const B = this.buf;
    const speed = man.speed;
    const moving = smooth(0.25, 1.4, speed);
    const ang = Math.atan2(man.moveR, man.moveF);          // 0: towards the aim; + to the right
    // a backpedal past 103° from the aim, running forwards again under 97°: pure sideways (90°) always
    // runs forwards, whatever came before
    if (speed > 0.6 && (this.back ? Math.abs(ang) < 1.7 : Math.abs(ang) > 1.8)) this.back = !this.back;
    const legs = this.back ? wrapAngle(ang - Math.PI) : ang;
    this.legYaw = damp(this.legYaw, clamp(legs, -1.3, 1.3) * moving, 8, dt);
    const sprint = smooth(3, 5.5, speed);
    const jog = C.get('jog');
    const fast = C.get('sprint');
    // metres a cycle: the clips' own, but never so short the legs blur (a little slide reads better)
    const stride = Math.max(MIN_STRIDE, lerp(jog.stride || 4, fast.stride || 4, sprint));
    this.phase = (this.phase + (this.back ? -1 : 1) * dt * speed / stride + 1) % 1;
    C.get(round.s === 'play' || round.s === 'count' ? 'guard' : 'idle').sample(this.clock, this.out, true);
    if (moving > 0) {
      jog.sample((this.phase + (jog.footfall || 0)) * jog.duration, B.run, true);
      fast.sample((this.phase + (fast.footfall || 0)) * fast.duration, B.sprint, true);
      mix(this.out, mix(B.run, B.sprint, sprint), moving);
    }
    return moving;
  }

  /** The whole body's clips: a perfect dodge's acrobatics, a flinch, a knockout, getting up, a
   *  round's end. Returns how much they took over. */
  wholeBody(dt, s, man, round, moving) {
    const C = this.clips;
    const B = this.buf;
    const O = this.out;
    const alive = s.alive;
    let full = 0;
    if (alive && man.spinT < ACRO_TIME && this.acro) {
      this.acrobatics(man.spinT / ACRO_TIME, B.full);
      const w = fades(man.spinT, ACRO_TIME, 0.03, 0.08);
      mix(O, B.full, w);
      full = w;
    }
    if (alive && man.hitT < 0.5) {                           // a hit that didn't knock out: a flinch, once the freeze lets go
      const clip = C.get(this.flinch);
      clip.sample(man.hitT, B.full);
      mix(O, B.full, 0.85 * fades(man.hitT, Math.min(0.5, clip.duration), 0.03, 0.15));
    }
    if (!alive) {                                            // knocked out: down, away from the ball, harder the faster it came
      if (!this.ko) {
        const speedHit = man.hitInfo?.speed ?? 15;
        this.ko = speedHit > 24 ? 'ko_tumble' : speedHit > 16 ? 'ko_fly' : 'ko_back';
        const from = man.hitInfo?.from;               // turned to face the ball's thrower: these falls go backwards
        this.model.rotation.y = from ? wrapAngle(Math.atan2(from.x - man.root.position.x, from.z - man.root.position.z) - man.root.rotation.y) : 0;
      }
      C.get(this.ko).sample(man.downT, B.full);
      copyPose(O, B.full);
      full = 1;
    } else if (this.ko) {
      this.ko = null;
      this.model.rotation.y = 0;
    }
    if (alive && man.reviveT < GETUP) {                      // revived: getting up from the floor
      if (man.reviveT < this.rose) this.rise = 1;            // a new get-up
      this.rose = man.reviveT;
      if (moving > 0.3) this.rise = approach(this.rise, 0, dt / RISE_CUT);   // moving off: it gives way to the run
      C.get('getup').sample(man.reviveT * (C.get('getup').duration / GETUP), B.full);
      const w = fades(man.reviveT, GETUP, 0, 0.3) * this.rise;
      mix(O, B.full, w);
      full = Math.max(full, w);
    }
    // the end of a round: the winners celebrate, the losers kneel (standing still, doing nothing)
    const ended = round.s === 'over' && alive && round.w !== undefined && round.w !== null && round.w >= 0;
    const calm = (alive ? s.act : 0) === 0 && !s.charging && moving < 0.3;
    if (ended && !this.win) this.win = round.w === man.team ? WINS[hash(this.id * 31 + (round.n || 0)) % WINS.length] : 'beaten';
    if (!ended) this.win = null;
    this.w.end = approach(this.w.end, ended && calm ? 1 : 0, dt / 0.3);
    if (this.w.end > 0 && this.win) {
      C.get(this.win).sample(this.clock, B.full, true);
      mix(O, B.full, this.w.end);
      full = Math.max(full, this.w.end);
    }
    return full;
  }

  /** A dodge's footwork (placed by hand, fitted to the rules' dash time): a side step, a half-crouched
   *  step forward, or a jump back. The upper body keeps the guard. Returns how much it took over. */
  footwork(man, A) {
    if (!A || A.kind !== 1) return 0;
    const { age, span } = A;
    // which way: the dash's own velocity, once it shows (the first moments may still be the walk's)
    if (!A.dodge || (age < 0.06 && man.speed > 4)) A.dodge = dodgeKind(man.rawF, man.rawR);
    const dash = Math.max(0.05, timingOf(man).dash.time);
    const ph = age < dash ? age / dash : 1 + (age - dash) / Math.max(0.05, span - dash);
    const R = this.rest;
    const F = this.frame;
    const P = this.buf.full;
    const kind = A.dodge;
    this.clips.get('guard').sample(this.clock, P, true);   // fists up
    P.q.hips.copy(R.pose.q.hips);                           // square to the aim (the guard stands side-on)
    const D = kind === 'forward' ? MADE.DASH_FORWARD : kind === 'back' ? MADE.DASH_BACK : MADE.DASH_SIDE;
    const toRight = kind === 'right' ? 1 : kind === 'left' ? -1 : 0;
    const off = at(D.hips, ph, this.target);
    // across: towards the dash's side for a side step (the body's -X is its right), the body's X otherwise;
    // up and down from the guard's own height (its knees bent: the rest pose stands straight-legged)
    P.p.set(R.pose.p.x + (toRight ? -toRight * off.x : off.x), P.p.y + off.y, R.pose.p.z + off.z);
    F.of(P, R);
    turnBone(P, F, 'chest', AXIS_X, at(D.bend, ph), 'head');
    F.of(P, R);
    for (const side of ['L', 'R']) {
      let keys;
      if (toRight) keys = (side === 'R') === (toRight > 0) ? D.lead : D.trail;
      else keys = D[side];
      const k = at(keys, ph, this.target);
      this.target.set(toRight ? -toRight * k.x : k.x, R.ankle + k.y, k.z);
      const kn = D.knees;                                   // the left knee's way; the right's mirrors it
      this.pole.set(side === 'L' ? kn[0] : -kn[0], kn[1], kn[2]);
      reach(P, F, R, `leg${side}`, this.target, this.pole);
      flatFoot(P, F, R, side);
    }
    const w = fades(age, span, D.blend.in, D.blend.out);
    mix(this.out, P, w);
    return w;
  }

  /** The throwing (right) arm: wound up with the charge, released on the throw, in this throw's
   *  style: overhead (the clip), side-arm or underarm (placed by hand). */
  throwArm(dt, s, man, moving, A) {
    const releasing = man.throwT < RELEASE;
    if (s.charging) this.style = this.forceStyle || THROW_STYLES[hash(this.id * 977 + man.throws) % THROW_STYLES.length];   // forceStyle: tests, the moves page
    const want = s.charging || releasing ? 1 : 0;
    const parrying = A && A.kind > 1;                          // a defence mid-charge: the arm stays up a moment longer
    const blend = MADE.THROWS.blend;
    this.w.throw = approach(this.w.throw, want, dt / (want ? blend.in : parrying ? 0.4 : blend.out));
    if (this.w.throw <= 0) return;
    const B = this.buf;
    const u = s.charging ? clamp(s.charge, 0, 1) : releasing ? man.throwT / RELEASE : null;
    if (this.style === 'over') {
      const thr = this.clips.get('throw');
      if (u !== null) thr.sample(s.charging ? u * thr.cock : lerp(thr.cock, Math.min(thr.duration, thr.release + FOLLOW), u), B.arms);
      mix(this.out, B.arms, this.w.throw, this.upperMask(1 - moving));
      return;
    }
    const T = MADE.THROWS[this.style];
    const R = this.rest;
    const F = this.frame;
    const P = copyPose(B.reach, this.out);
    if (u !== null) {
      this.u = u;
      this.charging = s.charging;
    }
    const k = this.u ?? 0;
    const wound = this.charging;
    F.of(P, R);
    if (this.style === 'side') turnBone(P, F, 'chest', AXIS_Y, at(wound ? T.turnWind : T.turnRelease, k), 'head');
    else turnBone(P, F, 'chest', AXIS_X, at(wound ? T.bendWind : T.bendRelease, k), 'head');
    F.of(P, R);
    at(wound ? T.wind : T.release, k, this.target);
    reach(P, F, R, 'R', this.target, this.pole.set(...T.pole));
    aimHand(P, F, R, 'R', this.fingers.set(...T.fingers), this.palmDir.set(...T.palm));
    mix(this.out, P, this.w.throw, RIGHT_TURN);
  }

  /** The left arm: across the face while charging, a backhand parry for a deflect, a palm catch,
   *  and a caught ball pulled in to the right hand. */
  leftArm(dt, s, man, A) {
    const parry = A && A.kind === 3 ? A : null;
    const catching = A && A.kind === 2 && !A.done ? A : null;
    const caught = man.caughtT < CAUGHT;
    const G = MADE.GUARD_L;
    const guarding = s.charging && !parry && !catching && !caught;
    this.w.guard = approach(this.w.guard, guarding ? 1 : 0, dt / (guarding ? G.blend.in : G.blend.out));
    const R = this.rest;
    const F = this.frame;
    const B = this.buf;
    if (this.w.guard > 0) {
      const P = copyPose(B.reach, this.out);
      F.of(P, R);
      this.target.set(...G.hand).add(F.pos.head).sub(R.head);
      reach(P, F, R, 'L', this.target, this.pole.set(...G.pole));
      aimHand(P, F, R, 'L', this.fingers.set(...G.fingers), this.palmDir.set(...G.palm));
      mix(this.out, P, this.w.guard, LEFT_ARM);
    }
    if (parry) {
      const D = MADE.PARRY_L;
      const u = parry.age / parry.span;
      const P = copyPose(B.reach, this.out);
      F.of(P, R);
      turnBone(P, F, 'chest', AXIS_Y, at(D.chest, u), 'head');
      F.of(P, R);
      reach(P, F, R, 'L', at(D.hand, u, this.target), this.pole.set(...D.pole));
      aimHand(P, F, R, 'L', at(D.fingers, u, this.fingers), at(D.palm, u, this.palmDir));
      mix(this.out, P, fades(parry.age, parry.span, D.blend.in, D.blend.out), LEFT_TURN);
    }
    if (catching || caught) {
      // the palm out in front; once the ball is in it, pulled in (k: 0..1 over the moment it shows there)
      const C = MADE.CATCH_L;
      const U = MADE.PULL_L;
      const k = caught ? smooth(0, 1, man.caughtT / CAUGHT) : 0;
      const P = copyPose(B.reach, this.out);
      F.of(P, R);
      turnBone(P, F, 'chest', AXIS_Y, C.chest * (1 - 0.7 * k), 'head');
      F.of(P, R);
      this.target.set(...C.hand).lerp(tv7.set(...U.hand), k);
      reach(P, F, R, 'L', this.target, this.pole.set(...C.pole));
      this.fingers.set(...C.fingers).lerp(tv7.set(...U.fingers), k);
      this.palmDir.set(...C.palm).lerp(tv7.set(...U.palm), k);
      aimHand(P, F, R, 'L', this.fingers, this.palmDir);
      const w = caught ? fades(man.caughtT, CAUGHT, 0, 0.1) : fades(catching.age, catching.span, C.blend.in, catching.fall);
      mix(this.out, P, w, LEFT_TURN);
    }
  }

  /** Carrying the ball: the right hand holds it in front of the right hip, whatever the rest does
   *  (and comes to meet a caught ball). */
  carry(dt, s, man) {
    const K = MADE.CARRY_R;
    const carrying = s.hasBall && !s.charging && man.throwT >= RELEASE;
    this.w.carry = approach(this.w.carry, carrying ? 1 : 0, dt / (carrying ? K.blend.in : K.blend.out));
    this.w.meet = approach(this.w.meet, man.caughtT < CAUGHT ? smooth(0.2, 0.9, man.caughtT / CAUGHT) : 0, dt / 0.2);
    const w = this.w.carry * (1 - this.w.throw);
    if (w <= 0) return;
    const R = this.rest;
    const F = this.frame;
    const P = copyPose(this.buf.reach, this.out);
    F.of(P, R);
    this.target.set(...K.hand).lerp(tv7.set(...K.meet), this.w.meet);
    reach(P, F, R, 'R', this.target, this.pole.set(...K.pole));
    aimHand(P, F, R, 'R', this.fingers.set(...K.fingers), this.palmDir.set(...K.palm));
    mix(this.out, P, w, RIGHT_ARM);
  }

  /** The upper body, and the legs as far as standing still (0..1). */
  upperMask(standing) {
    const m = (this.mask ||= { ...UPPER });
    for (const b of LEGS) m[b] = standing;
    return m;
  }

  /** Puts a pose on the bones; then no foot through the floor (when grounded). */
  apply(P, grounded) {
    const R = this.rest;
    const b = this.bones;
    for (const name of BONES) b[name].quaternion.copy(P.q[name]);
    const hips = b.hips.position.copy(P.p);
    if (!grounded) return;
    const T = this.turn;                                     // the legs' turns in the body's frame
    T.hips.multiplyQuaternions(R.armQ, b.hips.quaternion);
    const A = this.at;
    let lowest = Infinity;
    for (const x of ['L', 'R']) {
      T[`thigh_${x}`].multiplyQuaternions(T.hips, b[`thigh_${x}`].quaternion);
      T[`shin_${x}`].multiplyQuaternions(T[`thigh_${x}`], b[`shin_${x}`].quaternion);
      A.thigh.copy(R.local[`thigh_${x}`]).applyQuaternion(T.hips).add(hips);
      A.shin.copy(R.local[`shin_${x}`]).applyQuaternion(T[`thigh_${x}`]).add(A.thigh);
      A.foot.copy(R.local[`foot_${x}`]).applyQuaternion(T[`shin_${x}`]).add(A.shin);
      lowest = Math.min(lowest, A.foot.y);
    }
    if (lowest < R.ankle) hips.y += R.ankle - lowest;
  }

  /** A perfect dodge's acrobatics at u (0..1) into out: a corkscrew (the backflip, lower, with a
   *  full twist), a backflip (going backwards), an aerial side flip (spread, turning over sideways
   *  towards the dodge), or a butterfly twist (spread, leaning flat and spinning round). */
  acrobatics(u, out) {
    const C = this.clips;
    const R = this.rest;
    const kind = this.acro.kind;
    const turn = Math.PI * 2 * u * u * (3 - 2 * u) * this.acro.dir;
    if (kind === 'corkscrew' || kind === 'backflip') {
      const flip = C.get('flip');
      flip.sample(lerp(Math.max(0, flip.takeoff - 0.1), flip.touchdown, u), out);
      out.p.y = R.pose.p.y + (out.p.y - R.pose.p.y) * CORK_HEIGHT;
      if (kind === 'corkscrew') out.q.hips.multiply(tq.setFromAxisAngle(R.twist, turn));
      return;
    }
    C.get('air').sample(0.9, out);
    out.p.y = R.pose.p.y + Math.sin(Math.PI * u) * 0.55;
    if (kind === 'sideflip') tq.setFromAxisAngle(AXIS_Z, turn);
    else tq.setFromAxisAngle(AXIS_Y, turn).multiply(tq2.setFromAxisAngle(AXIS_X, Math.sin(Math.PI * Math.min(1, u * 1.15)) * 1.25));
    out.q.hips.premultiply(R.armQ).premultiply(tq).premultiply(R.armInv);
  }

  /** A perfect dodge begins: which acrobatics (seed: the same on every screen; going backwards, a
   *  backflip) and which way. */
  startAcrobatics(seed, side, back = false) {
    this.acro = { kind: back ? 'backflip' : ACROBATICS[seed % ACROBATICS.length], dir: side >= 0 ? 1 : -1 };
  }

  /** Puts a held ball of this radius in the right hand, touching the palm. */
  hold(ball, radius) {
    if (ball.parent !== this.hand) this.hand.add(ball);
    ball.position.copy(this.reach).multiplyScalar(radius).add(this.palm);
  }

  /** Puts a ball of this radius in the left palm (a ball just caught). */
  holdLeft(ball, radius) {
    const hand = this.bones.hand_L;
    if (ball.parent !== hand) hand.add(ball);
    const ax = this.rest.hands.L;
    ball.position.copy(ax.fingers).multiplyScalar(0.075).addScaledVector(ax.palm, radius + 0.015);
  }

  /** The hit flash and the perfect dodge's glow: the team's colour over the whole body. */
  glow(k) {
    for (const m of this.mats) m.emissiveIntensity = k;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    this.model.traverse((o) => {
      if (o.isSkinnedMesh) o.skeleton.dispose();
    });
  }
}

/** Which dodge, from the dash's velocity along the aim and to the right. */
function dodgeKind(f, r) {
  const a = Math.atan2(r, f);
  if (Math.abs(a) < 0.9) return 'forward';
  if (Math.abs(a) > 2.3) return 'back';
  return a > 0 ? 'right' : 'left';
}

export const ACROBATICS_TIME = ACRO_TIME;
export const CAUGHT_TIME = CAUGHT;

// For the moves page (moves.html), which marks the moves' key moments on its timeline (and edits the
// moves made here, MADE above): the moves' own times, which dodge a dash is, and the round-end
// celebrations' order.
export const MOVE_TIMES = { ACRO_TIME, RELEASE, FOLLOW, GETUP, RISE_CUT, CAUGHT };
export { dodgeKind, WINS, ACROBATICS, MIN_STRIDE };
