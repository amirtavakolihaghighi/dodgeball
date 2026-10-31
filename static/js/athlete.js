// The athlete (art/athlete.py): a skinned body in two versions, a sports helmet or a face with
// hair (one picked for each player, decision 128), each in two sizes (High and Low graphics).
// The stick figure's joints still carry the animation (world.js Stickman): each frame the
// athlete's bones take the same turns. Each pixel of a mesh's map holds a colour slot, not a
// colour, so every player's copy is painted in their team's kit and their own skin, hair and eyes.
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
const STICK_HIPS = 0.95;              // the stick figure's hips above its feet (world.js)
// A faint cool light on the edges, where the body turns away from you: the athletes stand out
// from the warm, busy hall, and the dark visor gets a glossy rim.
const RIM = new THREE.Color(0xcfe6ff);
const RIM_STRENGTH = 0.35;

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
function hash(n) {
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

/** What the retargeting needs from the athlete at rest: each bone's turn in the body's frame,
 *  with the limbs straightened to hang down like the stick figure's at rest (the athlete stands
 *  with arms a little out and elbows a little bent). */
function restOf(scene) {
  scene.updateMatrixWorld(true);
  const pos = {};
  const rot = {};
  const local = {};
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  for (const name of BONES) {
    const bone = scene.getObjectByName(name);
    bone.matrixWorld.decompose(p, q, s);
    pos[name] = p.clone();
    rot[name] = q.clone();
    local[name] = bone.position.clone();
  }
  scene.getObjectByName('hips').parent.matrixWorld.decompose(p, q, s);
  const armInv = q.clone().invert();       // the skeleton's own node
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
  return { rest, local, armInv, ankle: pos.foot_L.y };
}

/** Loads the athlete: its meshes and skeleton, the maps, and what the retargeting needs. */
export async function loadAthlete() {
  const info = await (await fetch(`${DIR}athlete.json`)).json();
  const names = Object.keys(info.maps);
  const [gltf, ...maps] = await Promise.all([
    new GLTFLoader().loadAsync(`${DIR}athlete.glb`),
    ...names.map((name) => slotMap(DIR + info.maps[name])),
  ]);
  const rm = new Uint8Array(64);             // roughness (green) and metalness (blue) per slot
  info.slots.forEach((_, i) => rm.set([0, Math.round(info.rough[i] * 255), Math.round(info.metal[i] * 255), 255], i * 4));
  const t = { info, scene: gltf.scene, maps: {}, rm: {}, painted: new Map(), rest: null };
  names.forEach((name, i) => {
    t.maps[name] = maps[i];
    t.rm[name] = paint(maps[i], rm, THREE.NoColorSpace);
  });
  gltf.scene.traverse((o) => {
    if (o.isMesh) o.material.dispose();      // each player gets their own
  });
  t.rest = restOf(gltf.scene);
  return t;
}

/** One player's athlete: their head, their colours, their own skeleton. */
export class Athlete {
  /** opts: { id, team, teamColor, head: 'helmet' | 'face' to force one (a URL's ?head=) } */
  constructor(t, { id, team, teamColor, head }) {
    const h = hash(id);
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
    this.low = null;
    this.joint = { none: new THREE.Quaternion() };
    for (const j of ['chest', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR']) this.joint[j] = new THREE.Quaternion();
    this.turn = Object.fromEntries(BONES.map((name) => [name, new THREE.Quaternion()]));
    this.at = { hips: new THREE.Vector3(), thigh: new THREE.Vector3(), shin: new THREE.Vector3(), foot: new THREE.Vector3() };
  }

  /** High or Low graphics: which size of the meshes shows. */
  setLow(low) {
    if (low === this.low) return;
    this.low = low;
    for (const m of this.meshes.hi) m.visible = !low;
    for (const m of this.meshes.lo) m.visible = low;
  }

  /** Every bone takes its stick-figure joint's turn (in the body's frame), on top of its own rest
   *  turn; the hips go down with the stick figure's crouch, but never put a foot through the floor. */
  pose(man) {
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
      const q = this.bones[name].quaternion;
      if (PARENT[name]) q.copy(T[PARENT[name]]).invert().multiply(T[name]);
      else q.copy(R.armInv).multiply(T[name]);
    }
    const hips = this.bones.hips.position.copy(R.local.hips);
    hips.y += man.hips.position.y - STICK_HIPS;
    const A = this.at;
    let lowest = Infinity;
    for (const x of ['L', 'R']) {
      A.thigh.copy(R.local[`thigh_${x}`]).applyQuaternion(T.hips).add(hips);
      A.shin.copy(R.local[`shin_${x}`]).applyQuaternion(T[`thigh_${x}`]).add(A.thigh);
      A.foot.copy(R.local[`foot_${x}`]).applyQuaternion(T[`shin_${x}`]).add(A.shin);
      lowest = Math.min(lowest, A.foot.y);
    }
    if (lowest < R.ankle) hips.y += R.ankle - lowest;
  }

  /** Puts a held ball of this radius in the right hand, touching the palm. */
  hold(ball, radius) {
    if (ball.parent !== this.hand) this.hand.add(ball);
    ball.position.copy(this.reach).multiplyScalar(radius).add(this.palm);
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
