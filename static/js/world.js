// Three.js scene: the court, stick figures, balls, trails and effects.
import * as THREE from 'three';
import { GLTFLoader } from '/static/vendor/addons/loaders/GLTFLoader.js';

export const TEAM_COLORS = [0xff4d5e, 0x3fa9ff];
// Ball colour by rally (number of deflections): a distinct hue per level, ending white-hot. A ball
// nobody has deflected shows its thrower's colour instead (a rule: each team's people's and bots').
export const RALLY_COLORS = [0xffd23f, 0x3ff2ff, 0xff4bd8, 0xff3b3b, 0xffffff];
export const rallyColor = (rally) => RALLY_COLORS[Math.min(rally, RALLY_COLORS.length - 1)];
const DEAD_BALL = 0x8a8f99;
/** "#rrggbb" -> 0xrrggbb (anything else: the plain ball yellow). */
const hex = (css) => (typeof css === 'string' && /^#[0-9a-f]{6}$/i.test(css) ? parseInt(css.slice(1), 16) : RALLY_COLORS[0]);

const tmpV = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const SPIN_TIME = 0.38;

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 18, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Two seams round the ball (great circles), so its spin shows. White, so the ball's colour
 *  shows through; the seams darken it. Wrapped round the sphere's usual texture layout. */
function seamTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#7a7a7a';
  g.fillRect(0, 60, 256, 8);              // the equator
  g.fillRect(0, 0, 4, 128);               // a meridian, and the opposite one: one great circle
  g.fillRect(252, 0, 4, 128);
  g.fillRect(124, 0, 8, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Small glowing specks thrown out by impacts. One pool of points and one draw call for all of
 *  them; each fades and falls, and bounces off the floor. */
class Particles {
  static MAX = 600;

  constructor(scene, map) {
    const n = Particles.MAX;
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1);
    this.life = new Float32Array(n).fill(1);
    this.drag = new Float32Array(n);
    this.next = 0;
    this.live = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.13, map, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** count specks of color from (x, y, z): speed m/s, up = how much they fly upwards (0..1),
   *  life s, drag (how fast they slow down). */
  emit(x, y, z, color, count, { speed = 5, up = 0.5, life = 0.5, drag = 2.5 } = {}) {
    const c = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % Particles.MAX;
      let dx = Math.random() * 2 - 1;
      let dy = Math.random() * 2 - 1;
      let dz = Math.random() * 2 - 1;
      const len = Math.hypot(dx, dy, dz) || 1;
      const s = speed * (0.35 + 0.65 * Math.random()) / len;
      dx *= s;
      dz *= s;
      dy = dy * s * (1 - up) + Math.abs(speed) * up * (0.4 + 0.6 * Math.random());
      this.pos.set([x, y, z], i * 3);
      this.vel.set([dx, dy, dz], i * 3);
      this.base.set([c.r, c.g, c.b], i * 3);
      this.age[i] = 0;
      this.life[i] = life * (0.6 + 0.4 * Math.random());
      this.drag[i] = drag;
    }
  }

  update(dt) {
    let live = 0;
    for (let i = 0; i < Particles.MAX; i++) {
      const o = i * 3;
      if (this.age[i] >= this.life[i]) {
        if (this.col[o] || this.col[o + 1] || this.col[o + 2]) this.col.fill(0, o, o + 3);
        continue;
      }
      live++;
      this.age[i] += dt;
      const slow = Math.exp(-this.drag[i] * dt);
      this.vel[o] *= slow;
      this.vel[o + 2] *= slow;
      this.vel[o + 1] = this.vel[o + 1] * slow - 9.8 * dt;
      this.pos[o] += this.vel[o] * dt;
      this.pos[o + 1] += this.vel[o + 1] * dt;
      this.pos[o + 2] += this.vel[o + 2] * dt;
      if (this.pos[o + 1] < 0.03) {        // the floor
        this.pos[o + 1] = 0.03;
        this.vel[o + 1] *= -0.35;
        this.vel[o] *= 0.6;
        this.vel[o + 2] *= 0.6;
      }
      const k = 1 - this.age[i] / this.life[i];
      const f = k * k;                     // additive: darker is fainter
      this.col[o] = this.base[o] * f;
      this.col[o + 1] = this.base[o + 1] * f;
      this.col[o + 2] = this.base[o + 2] * f;
    }
    if (live || this.live) {               // nothing to send while every speck is gone
      const geo = this.points.geometry;
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    }
    this.live = live;
  }
}

const capsules = new Map();
function capsule(len, r) {
  const key = `${len}:${r}`;
  if (!capsules.has(key)) capsules.set(key, new THREE.CapsuleGeometry(r, len, 4, 10));
  return capsules.get(key);
}
const headGeo = new THREE.SphereGeometry(0.16, 18, 14);
const handGeo = new THREE.SphereGeometry(0.055, 10, 8);
const heldGeo = new THREE.SphereGeometry(0.15, 16, 12);
const ballGeo = new THREE.SphereGeometry(0.2, 20, 16);
const visorGeo = new THREE.BoxGeometry(0.22, 0.07, 0.08);
const blobGeo = new THREE.PlaneGeometry(1, 1);
const markGeo = new THREE.RingGeometry(0.22, 0.32, 32);
const visorMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.3 });

function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();     // its per-instance buffers (the crowd)
    if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    if (o.material) {
      for (const m of [].concat(o.material)) {
        if (m.userData.keep) continue;      // shared by every court: its shader stays built
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

// ------------------------------------------------------------------ the sports hall
// Built and lit in Blender (art/arena.py): its sunlight is baked into textures, so drawing it
// costs no lighting at all. The court's paint, its walls, the stands and the crowd follow the
// court's size, so they're made here. Until the hall has loaded (or if it can't), the plain
// court of before is drawn.
const ARENA = '/static/arena/';
const FLOOR_PPM = 32;                     // the hall floor's canvas: pixels a metre
const PALETTE = [0x16c4b4, 0xffc93c, 0x6dd04e, 0x8b6cff, 0xff9f43];    // the hall's (style samples, round 2)
const PAINT = ['#e33f4f', '#2a79c2'];     // the court's halves: satin team paint
const STANDS = { gap: 2.5, rows: 6, depth: 0.85, rise: 0.45 };   // behind the court's side walls
const SHAFT_GLOW = 0.035;                 // how brightly the sun's shafts glow (they add up where they cross)
const LOW_CROWD = 3;                      // Low graphics: one fan in this many, standing still

const keep = (thing) => {
  thing.userData.keep = true;
  return thing;
};
const unitBox = keep(new THREE.BoxGeometry(1, 1, 1));

/** A repeatable random sequence (mulberry32), so the planks and the crowd look the same each time. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Honey-coloured wooden boards over the whole canvas (ppm: pixels a metre). */
function paintWood(c, w, h, ppm) {
  c.fillStyle = '#c98a4c';                                 // the gaps between boards
  c.fillRect(0, 0, w, h);
  const rnd = seeded(7);
  const width = 0.14 * ppm;
  const length = 2.4 * ppm;
  const tones = ['#efb46c', '#eaab62', '#e3a35d', '#dc9a52', '#f2bb75'];
  for (let y = 0, row = 0; y < h; y += width, row++) {
    for (let x = -((row * 0.37) % 1) * length; x < w; x += length) {
      c.fillStyle = tones[Math.floor(rnd() * tones.length)];
      c.fillRect(x, y, length - Math.max(1, ppm * 0.01), width - Math.max(0.5, ppm * 0.008));
    }
  }
}

/** The court from its top-left corner (-L, -W): the halves, a 1 m grid, the no-go strip, the lines. */
function paintCourt(c, L, W, gap, ppm, hall) {
  const cw = 2 * L * ppm;
  const ch = 2 * W * ppm;
  const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
  c.fillStyle = hall ? PAINT[0] : '#3b2531';
  c.fillRect(0, 0, cw / 2, ch);
  c.fillStyle = hall ? PAINT[1] : '#1f2e49';
  c.fillRect(cw / 2, 0, cw / 2, ch);
  c.strokeStyle = `rgba(255,255,255,${hall ? 0.1 : 0.06})`;     // 1 m grid: helps judge distance in 3D
  c.lineWidth = 0.05 * ppm;
  for (let i = 1; i < 2 * L; i++) line(i * ppm, 0, i * ppm, ch);
  for (let j = 1; j < 2 * W; j++) line(0, j * ppm, cw, j * ppm);
  c.fillStyle = `rgba(0,0,0,${hall ? 0.25 : 0.4})`;             // no-go strip around the centre line
  c.fillRect(cw / 2 - gap * ppm, 0, 2 * gap * ppm, ch);
  c.save();
  c.beginPath();
  c.rect(cw / 2 - gap * ppm, 0, 2 * gap * ppm, ch);
  c.clip();
  c.strokeStyle = `rgba(255,255,255,${hall ? 0.14 : 0.08})`;
  c.lineWidth = 0.15 * ppm;
  for (let y = -ch; y < ch * 2; y += 0.85 * ppm) line(cw / 2 - gap * ppm, y, cw / 2 + gap * ppm, y + 2 * gap * ppm);
  c.restore();
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 0.1 * ppm;
  line(cw / 2 - (L / 2) * ppm, 0, cw / 2 - (L / 2) * ppm, ch);
  line(cw / 2 + (L / 2) * ppm, 0, cw / 2 + (L / 2) * ppm, ch);
  c.strokeStyle = 'rgba(255,255,255,0.9)';
  c.lineWidth = 0.2 * ppm;
  c.strokeRect(0.1 * ppm, 0.1 * ppm, cw - 0.2 * ppm, ch - 0.2 * ppm);
  line(cw / 2, 0, cw / 2, ch);
}

/** Soft shafts of sunlight from the window panes to the floor: see-through, glowing more where
 *  you look across them than along their edges, and fading towards the floor. */
function sunShafts(panes, toward, color) {
  const d = new THREE.Vector3(...toward).negate();         // the sunlight's direction
  const pos = [];
  const fade = [];
  const index = [];
  for (const quad of panes) {
    const base = pos.length / 3;
    for (const [x, y, z] of quad) {
      const k = y / -d.y;                                  // down to the floor
      pos.push(x, y, z, x + d.x * k, 0, z + d.z * k);
      fade.push(1, 0);
    }
    for (let i = 0; i < 4; i++) {
      const a = base + 2 * i;
      const b = base + 2 * ((i + 1) % 4);
      index.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, glow: { value: SHAFT_GLOW } },
    vertexShader: `attribute float fade; varying float vFade; varying vec3 vN; varying vec3 vV;
      void main() { vFade = fade; vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float glow; varying float vFade; varying vec3 vN; varying vec3 vV;
      void main() { float facing = abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(color * glow * vFade * facing * facing * facing, 1.0); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

export class World {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1220);
    this.scene.fog = new THREE.Fog(0x0d1220, 40, 110);
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.05, 260);
    this.men = new Map();
    this.balls = new Map();
    this.fx = [];
    this.oldTrails = [];
    this.shadowTex = radialTexture('rgba(0,0,0,0.65)', 'rgba(0,0,0,0)');
    this.glowTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    this.shadowMat = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false });
    this.seamTex = seamTexture();
    this.particles = new Particles(this.scene, this.glowTex);
    const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x2a2018, 1.25);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 20, 10);
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.55);
    fill.position.set(-10, 8, -12);
    this.scene.add(hemi, sun, fill);
    this.lights = { hemi, sun, fill };

    // Throw preview: dotted arc plus a ring where it would ricochet.
    this.previewPos = new Float32Array(160 * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.previewPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.preview = new THREE.Points(pg, new THREE.PointsMaterial({
      color: 0xfff0b8, size: 9, sizeAttenuation: false, map: dotTexture(), transparent: true, depthWrite: false,
    }));
    this.preview.frustumCulled = false;
    this.bounceMark = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.preview.visible = this.bounceMark.visible = false;
    this.scene.add(this.preview, this.bounceMark);

    this.court = null;
    this.ballScale = 1;     // the lobby's ball radius over the 0.2 m the meshes are built for
    this.quality = 'high';  // the graphics level (graphics.js): Low draws fewer decorative effects
    this.arena = null;      // the sports hall, once loaded
    this.courtSize = null;
    this.crowd = [];        // per side: { fans, bodies, heads }
    this.crowdT = -1;
    this.occluders = [];    // what turns see-through when the camera is behind it
    this.cheering = 0;
    addEventListener('resize', () => this.resize());
    this.resize();
    // ?noarena: the plain court, for comparing frame rates (like ?nowarm for the warm-up)
    this.ready = false;     // the hall has loaded, or won't
    this.loading = (new URLSearchParams(location.search).has('noarena') ? Promise.resolve() : this.loadArena())
      .then(() => { this.ready = true; });
  }

  /** Loads the hall (art/arena.py's output) and puts the court in it. */
  async loadArena() {
    try {
      const info = await (await fetch(`${ARENA}arena.json`)).json();
      const loader = new THREE.TextureLoader();
      const texture = (file, flipY = true) => loader.loadAsync(ARENA + file).then((t) => {
        t.flipY = flipY;                         // glTF's UVs run top-down, the floor's bottom-up
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      });
      const [gltf, floorLight, hallLight, leavesLight, sky] = await Promise.all([
        new GLTFLoader().loadAsync(ARENA + info.walls.model),
        texture(info.floor.light), texture(info.walls.light.hall, false), texture(info.walls.light.leaves, false),
        texture(info.sky),
      ]);
      const lit = Math.PI / info.lightScale;       // the lightmaps hold light x lightScale
      const group = new THREE.Group();
      const isLeaves = (o) => { for (let q = o; q; q = q.parent) if (q.name.startsWith('leaves')) return true; return false; };
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const light = isLeaves(o) ? leavesLight : hallLight;
        const made = [].concat(o.material).map((m) => {
          const flat = m.name.startsWith('emit_')    // the scoreboard glows: no light needed
            ? new THREE.MeshBasicMaterial({ color: m.emissive.clone().multiplyScalar(m.emissiveIntensity) })
            : new THREE.MeshBasicMaterial({ color: m.color, lightMap: light, lightMapIntensity: lit });
          m.dispose();
          return flat;
        });
        o.material = Array.isArray(o.material) ? made : made[0];
      });
      group.add(gltf.scene);
      const [fw, fd] = info.floor.size;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(fw * FLOOR_PPM);
      canvas.height = Math.round(fd * FLOOR_PPM);
      const floorTex = new THREE.CanvasTexture(canvas);
      floorTex.colorSpace = THREE.SRGBColorSpace;
      floorTex.anisotropy = 8;
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(fw, fd),
        new THREE.MeshBasicMaterial({ map: floorTex, lightMap: floorLight, lightMapIntensity: lit }));
      floor.rotation.x = -Math.PI / 2;
      group.add(floor);
      const shafts = sunShafts(info.panes, info.sun.toward, info.sun.color);
      shafts.visible = this.quality !== 'low';
      group.add(shafts);
      sky.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.background = sky;
      this.scene.fog = null;
      // the players and balls: the same sun as the bake, and the sky and the warm floor around them
      const { hemi, sun, fill } = this.lights;
      sun.color.set(info.sun.color);
      sun.intensity = info.sun.strength;
      sun.position.set(...info.sun.toward).multiplyScalar(60);
      hemi.color.set(0xa9d2ff);
      hemi.groundColor.set(0xd39a62);
      hemi.intensity = 1.2;
      fill.intensity = 0;
      this.renderer.toneMapping = THREE.NeutralToneMapping;
      this.renderer.toneMappingExposure = 0.55;
      this.scene.add(group);
      this.arena = { info, group, canvas, floorTex, shafts };
      if (this.courtSize) this.buildCourt(...this.courtSize);
      this.renderer.compile(this.scene, this.camera);     // its shaders now, not in the first round
    } catch (err) {
      console.warn('The sports hall could not be loaded; the plain court stays.', err);
    }
  }

  /** The hall around a court this size: scaled up if the court and its stands don't fit, with the
   *  court painted on its floor (so the court gets the hall's baked sunlight). */
  fitArena(L, W, gap) {
    const a = this.arena;
    const [hl, hw] = a.info.hall.half;
    const reach = W + STANDS.gap + STANDS.rows * STANDS.depth + 1.5;
    const scale = Math.max(1, reach / hw, (L + 8) / hl);
    a.group.scale.setScalar(scale);
    const c = a.canvas.getContext('2d');
    const ppm = a.canvas.width / (2 * hl * scale);
    paintWood(c, a.canvas.width, a.canvas.height, ppm);
    c.save();
    c.translate(a.canvas.width / 2 - L * ppm, a.canvas.height / 2 - W * ppm);
    paintCourt(c, L, W, gap, ppm, true);
    c.restore();
    a.floorTex.needsUpdate = true;
  }

  /** The crowd cheers: 1 at the end of a round, less for a knockout. */
  cheer(amount = 1) {
    this.cheering = Math.max(this.cheering, amount);
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /** The graphics level and how many render pixels to draw per page pixel (graphics.js). */
  setQuality(level, pixelRatio) {
    this.quality = level;
    if (this.arena) this.arena.shafts.visible = level !== 'low';
    this.crowdSize();
    if (pixelRatio !== this.renderer.getPixelRatio()) {
      this.renderer.setPixelRatio(pixelRatio);
      this.resize();
    }
  }

  /** Builds every kind of effect once, out of sight, so their shaders exist before play starts:
   *  building one in the middle of a match freezes the picture for a moment, which looks just
   *  like lag. One of each stays (hidden), or three.js would throw the shaders away again. */
  warmUp() {
    if (this.warm) return;
    const at = { x: 0, y: -40, z: 0 };
    const first = this.fx.length;
    this.burst(at.x, at.y, at.z, 0xffffff);
    this.ring(at.x, at.y, at.z, 0xffffff);
    this.spark(at.x, at.y, at.z, 0xffffff, true);
    this.ghostBall(at, 0xffffff);
    const mine = new Stickman(this, 0, true);       // a figure with the ring under your own feet
    const faded = new Stickman(this, 1, false);     // one fading out (near the camera, or blinking)
    for (const m of faded.fadeMats) {
      m.transparent = true;
      m.opacity = 0.5;
    }
    const quality = this.quality;
    this.quality = 'high';
    this.ghostMan(mine);                            // a perfect dodge's afterimage
    this.quality = quality;
    const ball = new BallView(this);                // a deflected ball: glow, shadow and trail
    ball.update({ pos: at, state: 1, rally: 1, color: '#ffffff', vx: 20, vy: 0, vz: 0 }, 0);
    ball.update({ pos: { x: 0.5, y: at.y, z: 0 }, state: 1, rally: 1, color: '#ffffff', vx: 20, vy: 0, vz: 0 }, 0.01);
    const kept = this.fx.splice(first);
    for (const root of [mine.root, faded.root]) root.position.y = at.y;
    const objects = [...kept.map((f) => f.obj), mine.root, faded.root, ball.holder, ball.glow, ball.shadow, ball.trail.mesh];
    this.preview.visible = this.bounceMark.visible = true;     // the throw preview, too
    this.renderer.compile(this.scene, this.camera);
    this.preview.visible = this.bounceMark.visible = false;
    for (const o of objects) o.visible = false;
    this.warm = { kept, mine, faded, ball };
  }

  buildCourt(L, W, gap) {
    this.courtSize = [L, W, gap];
    const old = this.court;
    if (old) {
      // Disposed only after the new court has been drawn once: the new court's materials then
      // reuse the old ones' shaders instead of building them again (a hitch as a round starts).
      this.scene.remove(old);
      requestAnimationFrame(() => requestAnimationFrame(() => disposeTree(old)));
    }
    const g = (this.court = new THREE.Group());
    this.scene.add(g);
    if (this.arena) this.fitArena(L, W, gap);
    else this.plainFloor(g, L, W, gap);
    if (this.arena) {
      this.occluders = [];
      this.courtWalls(g, L, W);
      this.stands(g, L, W);
      return;
    }

    // Side walls are bouncy glass (balls ricochet); the team-coloured end walls stop balls.
    const kick = new THREE.MeshStandardMaterial({ color: 0x283149, roughness: 0.7 });
    const wall = (len, x, z, rotY, endColor) => {
      const w = new THREE.Group();
      w.position.set(x, 0, z);
      w.rotation.y = rotY;
      const board = new THREE.Mesh(new THREE.BoxGeometry(len, 0.5, 0.16), endColor
        ? new THREE.MeshStandardMaterial({ color: endColor, roughness: 0.6, emissive: endColor, emissiveIntensity: 0.25 })
        : kick);
      board.position.y = 0.25;
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(len, 4.6), new THREE.MeshBasicMaterial({
        color: endColor || 0x9fe8ff, transparent: true, opacity: endColor ? 0.1 : 0.06, side: THREE.DoubleSide, depthWrite: false,
      }));
      pane.position.y = 2.8;
      const top = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.06), new THREE.MeshBasicMaterial({
        color: endColor || 0x9fe8ff, transparent: true, opacity: 0.45,
      }));
      top.position.y = 5.1;
      w.add(board, pane, top);
      g.add(w);
    };
    wall(2 * L, 0, -W - 0.08, 0);
    wall(2 * L, 0, W + 0.08, 0);
    wall(2 * W, -L - 0.08, 0, Math.PI / 2, TEAM_COLORS[0]);
    wall(2 * W, L + 0.08, 0, Math.PI / 2, TEAM_COLORS[1]);

    // Bleachers along the long sides give the space some scale.
    const seat = new THREE.MeshStandardMaterial({ color: 0x1b2236, roughness: 0.9 });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const height = 0.45 * (i + 1);
        const step = new THREE.Mesh(new THREE.BoxGeometry(2 * L, height, 0.9), seat);
        step.position.set(0, height / 2, side * (W + 2.2 + i * 0.9));
        g.add(step);
      }
    }
  }

  /** The court before the hall has loaded: its markings on a dark floor. */
  plainFloor(g, L, W, gap) {
    // Floor markings drawn on a canvas: canvas x -> world x, canvas y -> world z.
    const ppm = 40;
    const cv = document.createElement('canvas');
    cv.width = Math.round(2 * L * ppm);
    cv.height = Math.round(2 * W * ppm);
    paintCourt(cv.getContext('2d'), L, W, gap, ppm, false);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * L, 2 * W), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2;
    g.add(floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ color: 0x121a2b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    g.add(ground);
  }

  /** The court's walls in the hall: padded boards in the hall's palette along the sides (balls
   *  ricochet off them), the team's colour at the ends (balls stop there), glass above both: the
   *  walls go up as high as any ball. Each end and each side has materials of its own, so it can
   *  turn see-through on its own when the camera is behind it (seeThrough). */
  courtWalls(g, L, W) {
    const M = (this.wallMats ??= {
      side: [0, 1].map(() => PALETTE.map((c) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, transparent: true })))),
      end: TEAM_COLORS.map((c) => keep(new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, emissive: c, emissiveIntensity: 0.12, transparent: true }))),
      stripe: [0, 1].map(() => keep(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, transparent: true }))),
      glass: keep(new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false })),
      // the outline left showing while a wall is see-through: red end, blue end, the two sides
      edge: [0, 1, 2, 3].map(() => keep(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }))),
    });
    const edges = (this.unitEdges ??= keep(new THREE.EdgesGeometry(unitBox)));
    const box = (mat, sx, sy, sz, x, y, z, outline = false) => {
      const m = outline ? new THREE.LineSegments(edges, mat) : new THREE.Mesh(unitBox, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(x, y, z);
      g.add(m);
    };
    const n = Math.max(2, Math.round((2 * L) / 3.5));
    [-1, 1].forEach((s, k) => {
      const z = s * (W + 0.13);
      for (let i = 0; i < n; i++) box(M.side[k][(i + k) % PALETTE.length], (2 * L) / n - 0.04, 1.0, 0.26, -L + ((i + 0.5) * 2 * L) / n, 0.5, z);
      box(M.edge[2 + k], 2 * L, 1.0, 0.26, 0, 0.5, z, true);
      box(M.glass, 2 * L, 3.6, 0.02, 0, 2.8, z);
      this.addOccluder({ mats: M.side[k], edge: M.edge[2 + k], min: 0.2, test: (c) => s * c.z > W + 0.05 });
    });
    [-1, 1].forEach((s, t) => {
      const x = s * (L + 0.13);
      box(M.end[t], 0.26, 2.0, 2 * W + 0.52, x, 1.0, 0);
      box(M.stripe[t], 0.28, 0.2, 2 * W + 0.54, x, 1.45, 0);
      box(M.edge[t], 0.28, 2.0, 2 * W + 0.54, x, 1.0, 0, true);
      box(M.glass, 0.02, 2.6, 2 * W, x, 3.3, 0);
      this.addOccluder({ mats: [M.end[t], M.stripe[t]], edge: M.edge[t], min: 0.15, test: (c) => s * c.x > L + 0.05 });
    });
  }

  /** Stands along the long sides, behind the court's walls, and a crowd on them: per side, two
   *  instanced meshes (bodies and heads), a few hundred fans in four draw calls. Each side has
   *  materials of its own, so it can turn see-through when the camera is in it (seeThrough). */
  stands(g, L, W) {
    const M = (this.standMats ??= {
      step: [0, 1].map(() => keep(new THREE.MeshLambertMaterial({ color: 0x2c3550, transparent: true }))),
      front: [1, 0].map((i) => keep(new THREE.MeshLambertMaterial({ color: PALETTE[i], transparent: true }))),
      body: [0, 1].map(() => keep(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true }))),
      head: [0, 1].map(() => keep(new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true }))),
    });
    const len = 2 * L + 6;
    const rnd = seeded(9);
    const bodyGeo = (this.fanBody ??= keep(new THREE.CapsuleGeometry(0.2, 0.32, 2, 8)));    // round, never blocky
    const headGeo2 = (this.fanHead ??= keep(new THREE.SphereGeometry(0.115, 8, 5)));
    const shirts = [...TEAM_COLORS, ...TEAM_COLORS, ...PALETTE, 0xffffff, 0x2b2f3a];
    const skins = [0xf1c8a5, 0xd9a07a, 0xa86f4c, 0x6e4430, 0xf5d7bd];
    const color = new THREE.Color();
    this.crowd = [];
    [-1, 1].forEach((s, k) => {
      const fans = [];
      for (let i = 0; i < STANDS.rows; i++) {
        const z = s * (W + STANDS.gap + (i + 0.5) * STANDS.depth);
        const top = 0.5 + i * STANDS.rise;
        const step = new THREE.Mesh(unitBox, M.step[k]);
        step.scale.set(len, top, STANDS.depth);
        step.position.set(0, top / 2, z);
        g.add(step);
        for (let x = -len / 2 + 0.4; x < len / 2 - 0.3; x += 0.62 + rnd() * 0.12) {
          if (rnd() < 0.12) continue;                    // an empty seat
          fans.push({ x: x + (rnd() - 0.5) * 0.1, y: top, z: z + (rnd() - 0.5) * 0.12, s: 0.9 + rnd() * 0.2, phase: rnd() * 6.28, r: rnd(), q: rnd() });
        }
      }
      const front = new THREE.Mesh(unitBox, M.front[k]);
      front.scale.set(len, 0.7, 0.12);
      front.position.set(0, 0.35, s * (W + STANDS.gap - 0.06));
      g.add(front);
      for (let i = fans.length - 1; i > 0; i--) {         // shuffled: Low shows the first third
        const j = Math.floor(rnd() * (i + 1));
        [fans[i], fans[j]] = [fans[j], fans[i]];
      }
      const bodies = new THREE.InstancedMesh(bodyGeo, M.body[k], fans.length);
      const heads = new THREE.InstancedMesh(headGeo2, M.head[k], fans.length);
      fans.forEach((f, i) => {
        bodies.setColorAt(i, color.set(shirts[Math.floor(f.r * shirts.length)]));
        heads.setColorAt(i, color.set(skins[Math.floor(f.q * skins.length)]));
      });
      bodies.instanceColor.needsUpdate = true;
      heads.instanceColor.needsUpdate = true;
      g.add(bodies, heads);
      this.crowd.push({ fans, bodies, heads });
      this.addOccluder({ mats: [M.step[k], M.front[k], M.body[k], M.head[k]], min: 0.15, test: (c) => s * c.z > W + STANDS.gap - 0.6 });
    });
    this.crowdT = -1;
    this.crowdSize();
    this.moveCrowd(0);
  }

  /** All the fans, or a third of them on Low graphics. */
  crowdSize() {
    for (const c of this.crowd) c.bodies.count = c.heads.count = this.quality === 'low' ? Math.ceil(c.fans.length / LOW_CROWD) : c.fans.length;
  }

  /** The crowd sways a little, and jumps when it cheers (cheer()). Not on Low graphics. */
  moveCrowd(t) {
    if (!this.crowd.length || (this.crowdT >= 0 && this.quality === 'low')) return;
    if (t - this.crowdT < 1 / 30) return;               // 30 times a second is plenty
    this.crowdT = t;
    const m = new THREE.Matrix4();
    const jump = this.cheering;
    for (const c of this.crowd) {
      c.fans.forEach((f, k) => {
        const bob = 0.03 * Math.sin(t * 2.1 + f.phase) + jump * 0.28 * Math.max(0, Math.sin(t * 9 + f.phase));
        m.makeScale(f.s, f.s, f.s).setPosition(f.x, f.y + 0.36 * f.s + bob, f.z);
        c.bodies.setMatrixAt(k, m);
        m.setPosition(f.x, f.y + 0.82 * f.s + bob, f.z);
        c.heads.setMatrixAt(k, m);
      });
      c.bodies.instanceMatrix.needsUpdate = true;
      c.heads.instanceMatrix.needsUpdate = true;
    }
  }

  /** A wall, a side's boards or a side's stands that turns see-through when the camera is behind it. */
  addOccluder(o) {
    o.fade = 0;
    for (const m of o.mats) {
      m.opacity = 1;
      m.depthWrite = true;
    }
    if (o.edge) o.edge.opacity = 0;
    this.occluders.push(o);
  }

  /** Every frame, once the camera is placed: a wall, a side's boards or a side's stands between the
   *  camera and the court fades until you can see through it, with a faint outline left showing,
   *  so you never lose sight of yourself when you back into a wall. Only the picture changes: the
   *  aim is worked out before, from where the camera would be anyway. */
  seeThrough(dt) {
    const c = this.camera.position;
    for (const o of this.occluders) {
      const want = o.test(c) ? 1 : 0;
      if (o.fade === want) continue;
      o.fade += (want - o.fade) * (1 - Math.exp(-12 * dt));
      if (Math.abs(o.fade - want) < 0.01) o.fade = want;
      const opacity = 1 - (1 - o.min) * o.fade;
      for (const m of o.mats) {
        m.opacity = opacity;
        m.depthWrite = o.fade < 0.5;        // see-through: what's behind it shows
      }
      if (o.edge) o.edge.opacity = 0.55 * o.fade;
    }
  }

  /** players: [{id, team, isMe, x, z, yaw, alive, charging, charge, act, actAge, hasBall, invuln, ballColor}] */
  syncPlayers(players, dt) {
    const seen = new Set();
    for (const s of players) {
      seen.add(s.id);
      let man = this.men.get(s.id);
      if (man && man.team !== s.team) {
        man.dispose(this.scene);
        man = null;
      }
      if (!man) {
        man = new Stickman(this, s.team, s.isMe);
        this.men.set(s.id, man);
      }
      s.camDist = Math.hypot(s.x - this.camera.position.x, s.z - this.camera.position.z);
      man.update(dt, s);
    }
    for (const [id, man] of this.men) {
      if (!seen.has(id)) {
        man.dispose(this.scene);
        this.men.delete(id);
      }
    }
  }

  /** balls: [{...ball, pos: {x, y, z}, color: its thrower's "#rrggbb"}] */
  syncBalls(balls, t) {
    const seen = new Set();
    for (const b of balls) {
      seen.add(b.id);
      let view = this.balls.get(b.id);
      if (!view) this.balls.set(b.id, (view = new BallView(this)));
      view.update(b, t);
    }
    for (const [id, view] of this.balls) {
      if (!seen.has(id)) {
        view.dispose(this.scene);
        this.balls.delete(id);
      }
    }
  }

  man(id) {
    return this.men.get(id);
  }

  /** A trail whose ball is gone (or changed colour) keeps fading where it was. */
  retireTrail(trail) {
    this.oldTrails.push(trail);
  }

  burst(x, y, z, color, size = 1.6) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sprite.position.set(x, y, z);
    this.scene.add(sprite);
    this.fx.push({ obj: sprite, t: 0, dur: 0.35, size });
  }

  ring(x, y, z, color) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(x, y, z);
    mesh.lookAt(this.camera.position);
    this.scene.add(mesh);
    this.fx.push({ obj: mesh, t: 0, dur: 0.4, size: 2.2, ownGeometry: true });
  }

  /** Ricochet spark: a flash plus a ring lying on the surface it bounced off. */
  spark(x, y, z, color, floor) {
    this.burst(x, y, z, color, 1.3);
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 32), new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(x, floor ? 0.03 : y, z);
    if (floor) mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    this.fx.push({ obj: mesh, t: 0, dur: 0.4, size: 2.4, ownGeometry: true });
  }

  /** A fading copy of a ball, left behind by fast (deflected) balls. */
  ghostBall(p, color) {
    const mesh = new THREE.Mesh(ballGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.position.set(p.x, p.y, p.z);
    this.scene.add(mesh);
    this.fx.push({ obj: mesh, t: 0, dur: 0.22, fade: 0.5 });
  }

  /** A fading glowing copy of a stick figure's current pose (perfect-dodge afterimage). Low
   *  graphics skip it: each copies the whole figure, and the popup and sound say "perfect" too. */
  ghostMan(man) {
    if (this.quality === 'low') return;
    const group = new THREE.Group();
    group.position.copy(man.root.position);
    group.rotation.copy(man.root.rotation);
    const opacity = man.isMe ? 0.22 : 0.45;     // your own sit right in front of the camera
    const mat = new THREE.MeshBasicMaterial({ color: man.ghostColor, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const body = man.body.clone(true);
    body.traverse((o) => { if (o.isMesh) o.material = mat; });
    group.add(body);
    this.scene.add(group);
    this.fx.push({ obj: group, mat, t: 0, dur: 0.4, fade: opacity });
  }

  /** Specks flying out of an impact (Particles.emit); Low graphics throw half as many. */
  burstOf(x, y, z, color, count, opts) {
    this.particles.emit(x, y, z, color, Math.max(1, Math.round(count * (this.quality === 'low' ? 0.5 : 1))), opts);
  }

  updateFx(dt, t) {
    this.particles.update(dt);
    this.cheering = Math.max(0, this.cheering - dt * 0.5);
    this.moveCrowd(t);
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const k = f.t / f.dur;
      const mat = f.mat || f.obj.material;
      if (k >= 1) {
        this.scene.remove(f.obj);
        mat.dispose();
        if (f.ownGeometry) f.obj.geometry.dispose();
        return false;
      }
      if (f.fade) mat.opacity = f.fade * (1 - k);
      else {
        f.obj.scale.setScalar(f.size * (0.35 + k));
        mat.opacity = 1 - k;
      }
      return true;
    });
    this.oldTrails = this.oldTrails.filter((trail) => {
      if (trail.update(t, this.camera.position)) return true;
      trail.dispose(this.scene);
      return false;
    });
  }

  /** points: [[x, y, z], ...] or null; bounce: {pos: [x, y, z], floor: bool} or null */
  setPreview(points, bounce) {
    if (!points || points.length < 2) {
      this.preview.visible = this.bounceMark.visible = false;
      return;
    }
    const n = Math.min(points.length, 160);
    for (let i = 0; i < n; i++) this.previewPos.set(points[i], i * 3);
    this.preview.geometry.attributes.position.needsUpdate = true;
    this.preview.geometry.setDrawRange(0, n);
    this.preview.visible = true;
    this.bounceMark.visible = !!bounce;
    if (bounce) {
      this.bounceMark.position.set(...bounce.pos);
      this.bounceMark.rotation.set(bounce.floor ? -Math.PI / 2 : 0, 0, 0);
      if (bounce.floor) this.bounceMark.position.y = 0.03;
    }
  }

  setBallRadius(r) {
    this.ballScale = r / 0.2;
  }

  cameraRay() {
    this.camera.getWorldDirection(tmpDir);
    const o = this.camera.position;
    return { o: { x: o.x, y: o.y, z: o.z }, d: { x: tmpDir.x, y: tmpDir.y, z: tmpDir.z } };
  }

  /** World point -> CSS pixel position, or null when behind the camera. */
  project(x, y, z) {
    tmpV.set(x, y, z).project(this.camera);
    if (tmpV.z > 1) return null;
    return {
      x: ((tmpV.x + 1) / 2) * innerWidth,
      y: ((1 - tmpV.y) / 2) * innerHeight,
      onScreen: Math.abs(tmpV.x) <= 1 && Math.abs(tmpV.y) <= 1,
    };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

class Stickman {
  constructor(world, team, isMe) {
    const color = TEAM_COLORS[team];
    this.world = world;
    this.team = team;
    this.isMe = isMe;
    this.ghostColor = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35);
    this.mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, emissive: color, emissiveIntensity: 0.18 });
    this.skin = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45, emissive: 0xffffff, emissiveIntensity: 0.06 });
    this.heldMat = new THREE.MeshStandardMaterial({ color: RALLY_COLORS[0], emissive: RALLY_COLORS[0], emissiveIntensity: 0.4, roughness: 0.35 });
    this.fadeMats = [this.mat, this.skin, this.heldMat];
    this.root = new THREE.Group();
    this.body = new THREE.Group();          // pivots at the feet: leans, hops, falls over
    this.root.add(this.body);
    this.hips = new THREE.Group();
    this.hips.position.y = 0.95;
    this.body.add(this.hips);
    this.chest = new THREE.Group();         // twists for throws and swats
    this.hips.add(this.chest);
    const torso = new THREE.Mesh(capsule(0.42, 0.11), this.mat);
    torso.position.y = 0.3;
    const head = new THREE.Mesh(headGeo, this.skin);
    head.position.y = 0.79;
    const visor = new THREE.Mesh(visorGeo, visorMat);   // shows which way they face
    visor.position.set(0, 0.81, 0.13);
    this.chest.add(torso, head, visor);
    this.armL = this.arm(0.21);
    this.armR = this.arm(-0.21);
    this.legL = this.leg(0.1);
    this.legR = this.leg(-0.1);
    this.held = new THREE.Mesh(heldGeo, this.heldMat);
    this.held.position.y = -0.06;
    this.armR.hand.add(this.held);
    const shadow = new THREE.Mesh(blobGeo, world.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.scale.setScalar(1.15);
    this.root.add(shadow);
    if (isMe) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      this.root.add(ring);
      this.meRing = ring;
    }
    world.scene.add(this.root);
    this.phase = 0;
    this.speed = 0;
    this.side = 0;            // smoothed sideways velocity, picks the spin direction
    this.last = null;
    this.throwT = 9;
    this.hitT = 9;
    this.freezeT = 0;
    this.freezeDur = 1;
    this.downT = 0;
    this.spinT = 9;
    this.spinDir = 1;
    this.lastGhost = 0;
  }

  arm(x) {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 0.56, 0);
    const upper = new THREE.Mesh(capsule(0.24, 0.05), this.mat);
    upper.position.y = -0.15;
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    const fore = new THREE.Mesh(capsule(0.22, 0.045), this.mat);
    fore.position.y = -0.14;
    const hand = new THREE.Group();
    hand.position.y = -0.3;
    hand.add(new THREE.Mesh(handGeo, this.skin));
    elbow.add(fore, hand);
    shoulder.add(upper, elbow);
    this.chest.add(shoulder);
    return { shoulder, elbow, hand };
  }

  leg(x) {
    const hip = new THREE.Group();
    hip.position.set(x, 0, 0);
    const thigh = new THREE.Mesh(capsule(0.36, 0.06), this.mat);
    thigh.position.y = -0.23;
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    const shin = new THREE.Mesh(capsule(0.36, 0.055), this.mat);
    shin.position.y = -0.22;
    knee.add(shin);
    hip.add(thigh, knee);
    this.hips.add(hip);
    return { hip, knee };
  }

  playThrow() {
    this.throwT = 0;
  }

  flinch() {
    this.hitT = 0;
  }

  /** Impact freeze (hitstop): the pose holds and shudders for `dur` seconds, with the hit flash,
   *  then the flinch plays. Only this figure stops: the balls and everyone else keep moving. */
  impact(dur) {
    this.freezeT = this.freezeDur = dur;
    this.hitT = 0;
  }

  /** Perfect dodge: a full spin out of the way, leaving glowing afterimages. */
  perfectDodge() {
    this.spinT = 0;
    this.lastGhost = -1;
    this.spinDir = this.side > 0 ? -1 : 1;     // spin the way we're moving
  }

  // Joint sign conventions (limbs hang down, the model faces +z, its right is -x):
  // rotation.x < 0 swings a limb forward, knee rotation.x > 0 bends it, elbow < 0 bends it,
  // left arm rotation.z > 0 / right arm rotation.z < 0 raise the arm out to the side.
  update(dt, s) {
    const frozen = this.freezeT > 0;
    if (frozen) this.freezeT -= dt;
    const pdt = frozen ? 0 : dt;              // the pose's own clock, stopped by an impact freeze
    if (!this.last) this.last = { x: s.x, z: s.z };
    const inv = 1 / Math.max(dt, 1e-3);
    const vx = (s.x - this.last.x) * inv;
    const vz = (s.z - this.last.z) * inv;
    this.last.x = s.x;
    this.last.z = s.z;
    this.speed = damp(this.speed, Math.min(16, Math.hypot(vx, vz)), 10, dt);
    this.throwT += pdt;
    this.hitT += pdt;
    this.spinT += pdt;
    this.downT = s.alive ? 0 : this.downT + pdt;

    const sy = Math.sin(s.yaw);
    const cy = Math.cos(s.yaw);
    const vf = vx * sy + vz * cy;       // velocity along facing
    const vr = -vx * cy + vz * sy;      // velocity to the right
    this.side = damp(this.side, vr, 20, dt);
    this.phase += pdt * this.speed * 1.9;
    const w = Math.min(1, this.speed / 6);
    const sw = Math.sin(this.phase);
    const spinning = this.spinT < SPIN_TIME && s.alive;
    const T = {
      legL: sw * 0.75 * w, legR: -sw * 0.75 * w,
      kneeL: Math.max(0, Math.sin(this.phase + 1.2)) * w, kneeR: Math.max(0, Math.sin(this.phase + 1.2 + Math.PI)) * w,
      armLx: -sw * 0.6 * w, armRx: sw * 0.6 * w, armLz: 0.12, armRz: -0.12, elbowL: -0.35, elbowR: -0.35,
      leanX: 0.1 * w, leanZ: 0, twist: 0, crouch: 0,
    };
    if (spinning) {                                     // perfect dodge: arms flung out mid-spin
      T.armLz = 1.25;
      T.armRz = -1.25;
      T.armLx = T.armRx = -0.2;
      T.elbowL = T.elbowR = -0.15;
      T.crouch = 0.12;
      T.kneeL = T.kneeR = 0.5;
      T.legL = -0.25;
      T.legR = 0.25;
    } else if (s.act === 1 && s.actAge < 0.35) {        // dodge: low dash
      T.crouch = 0.22;
      T.leanX = clamp(vf / 14, -1, 1) * 0.45;
      T.leanZ = clamp(vr / 14, -1, 1) * 0.45;
      T.armLx = T.armRx = -0.5;
      T.elbowL = T.elbowR = -1.5;
      T.legL = -0.5;
      T.legR = 0.3;
      T.kneeL = T.kneeR = 0.9;
    } else if (s.act === 3 && s.actAge < 0.3) {         // deflect: backhand swat across the body
      const k = clamp(s.actAge / 0.16, 0, 1);
      T.armRx = -1.35;
      T.armRz = -1.2 + 2.0 * k;
      T.elbowR = -0.2;
      T.twist = -0.5 + 1.0 * k;
      T.armLx = -0.9;
      T.armLz = 0.35;
      T.elbowL = -0.9;
    } else if (s.act === 2 && s.actAge < 0.32) {        // catch: both hands out in front
      T.armLx = T.armRx = -1.3;
      T.armLz = -0.28;
      T.armRz = 0.28;
      T.elbowL = T.elbowR = -0.45;
      T.crouch = 0.06;
      T.leanX = 0.15;
    } else if (this.throwT < 0.35) {                    // throw follow-through
      const k = clamp(this.throwT / 0.12, 0, 1);
      T.armRx = 2.5 - 3.8 * k;
      T.elbowR = -0.3;
      T.twist = -0.45 + 0.8 * k;
      T.leanX = 0.25 * k;
      T.armLx = -0.4;
      T.armLz = 0.3;
    } else if (s.charging) {                            // wind-up: ball cocked behind the head
      const c = s.charge;
      T.armRx = 1.7 + 0.9 * c;
      T.armRz = -0.25;
      T.elbowR = -0.9 - 0.3 * c;
      T.twist = -0.25 - 0.3 * c;
      T.armLx = -1.45;
      T.armLz = 0.05;
      T.elbowL = -0.1;
      T.leanX = -0.08 * c;
    }
    if (this.hitT < 0.35) {                             // flinch
      const k = 1 - this.hitT / 0.35;
      T.leanX -= 0.5 * k;
      T.armLz += 0.6 * k;
      T.armRz -= 0.6 * k;
    }

    const r = 22;
    this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, T.legL, r, pdt);
    this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, T.legR, r, pdt);
    this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, T.kneeL, r, pdt);
    this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, T.kneeR, r, pdt);
    const ra = this.throwT < 0.2 ? 60 : 26;
    this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, T.armLx, 26, pdt);
    this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, T.armRx, ra, pdt);
    this.armL.shoulder.rotation.z = damp(this.armL.shoulder.rotation.z, T.armLz, 30, pdt);
    this.armR.shoulder.rotation.z = damp(this.armR.shoulder.rotation.z, T.armRz, 30, pdt);
    this.armL.elbow.rotation.x = damp(this.armL.elbow.rotation.x, T.elbowL, 26, pdt);
    this.armR.elbow.rotation.x = damp(this.armR.elbow.rotation.x, T.elbowR, 26, pdt);
    this.chest.rotation.y = damp(this.chest.rotation.y, T.twist, 24, pdt);
    this.hips.position.y = damp(this.hips.position.y, 0.95 - T.crouch, 20, pdt);

    let spin = 0;
    let hop = 0;
    if (spinning) {
      const k = this.spinT / SPIN_TIME;
      spin = this.spinDir * Math.PI * 2 * (1 - (1 - k) ** 3);
      hop = Math.sin(Math.PI * k) * 0.3;
      if (this.spinT - this.lastGhost >= 0.065) {
        this.lastGhost = this.spinT;
        this.root.rotation.y = s.yaw + spin;
        this.root.position.set(s.x, 0, s.z);
        this.world.ghostMan(this);
      }
    }
    this.root.position.set(s.x, 0, s.z);
    this.root.rotation.y = s.yaw + spin;
    const shudder = frozen ? 0.05 * (this.freezeT / this.freezeDur) : 0;
    this.body.position.x = shudder * (Math.random() * 2 - 1);
    this.body.position.z = shudder * (Math.random() * 2 - 1);
    if (s.alive) {
      this.body.rotation.x = damp(this.body.rotation.x, T.leanX, 14, pdt);
      this.body.rotation.z = damp(this.body.rotation.z, T.leanZ, 14, pdt);
      this.body.position.y = hop;
    } else {                                            // knocked out: fall flat, then fade away
      const k = clamp(this.downT / 0.4, 0, 1);
      this.body.rotation.x = -1.45 * (1 - (1 - k) * (1 - k));
      this.body.rotation.z = 0;
      this.body.position.y = 0.12 * k;
    }
    let opacity = 1;
    if (!s.alive) opacity = 1 - clamp((this.downT - 1.4) / 0.6, 0, 1);
    else if (s.invuln) opacity = Math.sin(performance.now() / 45) > 0 ? 0.85 : 0.3;
    if (s.camDist < 2.6 && !s.isMe) opacity = Math.min(opacity, 0.2);   // don't block the camera
    this.root.visible = opacity > 0.01;
    for (const m of this.fadeMats) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
    this.mat.emissiveIntensity = 0.18 + Math.max(0, 1 - this.hitT / 0.18) * 1.6 + (spinning ? 0.6 : 0);
    this.held.visible = s.alive && s.hasBall && this.throwT > 0.12;
    this.held.scale.setScalar(this.world.ballScale);
    if (s.ballColor !== this.ballColor) {      // the ball in hand is the colour it'll fly in
      this.ballColor = s.ballColor;
      this.heldMat.color.setHex(hex(s.ballColor));
      this.heldMat.emissive.setHex(hex(s.ballColor));
    }
    this.heldMat.emissiveIntensity = 0.4 + (s.charging ? s.charge * 1.4 : 0);
  }

  dispose(scene) {
    scene.remove(this.root);
    for (const m of this.fadeMats) m.dispose();
    if (this.meRing) {
      this.meRing.geometry.dispose();
      this.meRing.material.dispose();
    }
  }
}

/** A ribbon through a ball's recent positions that fades with age: the path stays in the air. */
class Trail {
  static MAX = 90;
  static index = null;

  constructor(scene, color, life, width) {
    this.pts = [];
    this.color = new THREE.Color(color);
    this.life = life;
    this.width = width;
    this.pos = new Float32Array(Trail.MAX * 6);
    this.col = new Float32Array(Trail.MAX * 8);
    if (!Trail.index) {
      Trail.index = [];
      for (let i = 0; i < Trail.MAX - 1; i++) {
        const k = i * 2;
        Trail.index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(Trail.index);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  add(x, y, z, t) {
    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y, z - last.z) < 0.06) return;
    this.pts.push({ x, y, z, t });
    if (this.pts.length > Trail.MAX) this.pts.shift();
  }

  /** Rebuilds the ribbon facing the camera. Returns false once it has fully faded. */
  update(t, cam) {
    while (this.pts.length && t - this.pts[0].t > this.life) this.pts.shift();
    const n = this.pts.length;
    if (n < 2) {
      this.mesh.visible = false;
      return n > 0;
    }
    this.mesh.visible = true;
    const { r, g, b } = this.color;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const a = this.pts[Math.max(0, i - 1)];
      const c = this.pts[Math.min(n - 1, i + 1)];
      const tx = c.x - a.x;
      const ty = c.y - a.y;
      const tz = c.z - a.z;
      const ex = cam.x - p.x;
      const ey = cam.y - p.y;
      const ez = cam.z - p.z;
      let sx = ty * ez - tz * ey;
      let sy = tz * ex - tx * ez;
      let sz = tx * ey - ty * ex;
      const k = 1 - (t - p.t) / this.life;           // 1 = fresh, 0 = about to vanish
      const w = (this.width * (0.25 + 0.75 * k)) / (Math.hypot(sx, sy, sz) || 1);
      sx *= w;
      sy *= w;
      sz *= w;
      const o = i * 6;
      this.pos[o] = p.x + sx;
      this.pos[o + 1] = p.y + sy;
      this.pos[o + 2] = p.z + sz;
      this.pos[o + 3] = p.x - sx;
      this.pos[o + 4] = p.y - sy;
      this.pos[o + 5] = p.z - sz;
      const q = i * 8;
      const alpha = k * k;
      this.col[q] = this.col[q + 4] = r;
      this.col[q + 1] = this.col[q + 5] = g;
      this.col[q + 2] = this.col[q + 6] = b;
      this.col[q + 3] = this.col[q + 7] = alpha;
    }
    const geo = this.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.setDrawRange(0, (n - 1) * 6);
    return true;
  }

  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// A fast ball stretches along its flight (up to 30% longer, thinner to keep its volume), and
// spins: its seams turn at a speed that reads on screen without strobing.
const STRETCH = { from: 8, per: 0.012, max: 0.3 };      // m/s where it starts, extra length per m/s, cap
const SPIN_MAX = 26;                                    // rad/s (about 4 turns a second)
const UP = new THREE.Vector3(0, 1, 0);

class BallView {
  constructor(world) {
    this.world = world;
    this.mat = new THREE.MeshStandardMaterial({
      color: RALLY_COLORS[0], emissive: RALLY_COLORS[0], emissiveIntensity: 0.6, roughness: 0.35,
      map: world.seamTex, emissiveMap: world.seamTex,
    });
    this.holder = new THREE.Group();                    // carries the stretch; the ball spins inside it
    this.mesh = new THREE.Mesh(ballGeo, this.mat);
    this.holder.add(this.mesh);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: world.glowTex, color: RALLY_COLORS[0], transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shadowMat = world.shadowMat.clone();
    this.shadow = new THREE.Mesh(blobGeo, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    world.scene.add(this.holder, this.glow, this.shadow);
    this.key = '';
    this.trail = null;
    this.trailRally = -1;
    this.ghostAt = 0;
  }

  update(b, t) {
    const p = b.pos;
    const scale = this.world.ballScale;
    const dt = this.lastT === undefined ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    this.holder.position.set(p.x, p.y, p.z);
    const speed = b.state === 2 ? 0 : Math.hypot(b.vx || 0, b.vy || 0, b.vz || 0);
    const long = 1 + clamp((speed - STRETCH.from) * STRETCH.per, 0, STRETCH.max);
    if (speed > 0.5) this.holder.quaternion.setFromUnitVectors(UP, tmpDir.set(b.vx, b.vy, b.vz).normalize());
    this.holder.scale.set(scale / Math.sqrt(long), scale * long, scale / Math.sqrt(long));
    this.mesh.rotation.x += Math.min(SPIN_MAX, speed * (b.rally ? 1.6 : 1.1)) * dt;   // tumbles forward
    this.glow.position.set(p.x, p.y, p.z);
    const live = b.state !== 2;
    const col = !live ? DEAD_BALL : b.rally ? rallyColor(b.rally) : hex(b.color);
    const key = `${col}:${live}`;
    if (key !== this.key) {
      this.key = key;
      this.mat.color.setHex(col);
      this.mat.emissive.setHex(col);
      this.mat.emissiveIntensity = live ? 0.6 : 0.05;
      this.glow.material.color.setHex(col);
    }
    this.glow.visible = live;
    this.glow.scale.setScalar((1.0 + 0.3 * Math.min(b.rally, 5)) * scale);
    if (live) {
      // Every throw leaves a short speed streak; deflected balls leave a long, lingering
      // path plus afterimages. A new rally starts a new trail and the old one fades in place.
      if (!this.trail || this.trailRally !== b.rally) {
        if (this.trail) this.world.retireTrail(this.trail);
        const rally = Math.min(b.rally, 5);
        this.trail = new Trail(this.world.scene, col, rally ? 0.35 + 0.12 * rally : 0.09, rally ? 0.13 + 0.03 * rally : 0.11);
        this.trailRally = b.rally;
      }
      this.trail.add(p.x, p.y, p.z, t);
      if (b.rally && t - this.ghostAt > (this.world.quality === 'low' ? 0.07 : 0.035)) {   // Low: half as many
        this.ghostAt = t;
        this.world.ghostBall(p, col);
      }
    }
    if (this.trail) this.trail.update(t, this.world.camera.position);
    this.shadow.position.set(p.x, 0.025, p.z);
    this.shadow.scale.setScalar((0.45 + p.y * 0.12) * scale);
    this.shadowMat.opacity = clamp(1 - p.y / 6, 0.2, 0.9);
  }

  dispose(scene) {
    scene.remove(this.holder, this.glow, this.shadow);
    this.mat.dispose();
    this.glow.material.dispose();
    this.shadowMat.dispose();
    if (this.trail) this.world.retireTrail(this.trail);
  }
}
