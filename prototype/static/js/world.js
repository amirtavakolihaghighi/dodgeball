// Three.js scene: the court, stick figures, balls, trails and effects.
import * as THREE from 'three';

export const TEAM_COLORS = [0xff4d5e, 0x3fa9ff];
// Ball colour by rally (number of deflections): a distinct hue per level, ending white-hot.
export const RALLY_COLORS = [0xffd23f, 0x3ff2ff, 0xff4bd8, 0xff3b3b, 0xffffff];
export const rallyColor = (rally) => RALLY_COLORS[Math.min(rally, RALLY_COLORS.length - 1)];

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
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of [].concat(o.material)) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
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
    const hemi = new THREE.HemisphereLight(0xd6e6ff, 0x2a2018, 1.25);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 20, 10);
    const fill = new THREE.DirectionalLight(0x9fb8ff, 0.55);
    fill.position.set(-10, 8, -12);
    this.scene.add(hemi, sun, fill);

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
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }

  buildCourt(L, W, gap) {
    if (this.court) {
      this.scene.remove(this.court);
      disposeTree(this.court);
    }
    const g = (this.court = new THREE.Group());
    this.scene.add(g);

    // Floor markings drawn on a canvas: canvas x -> world x, canvas y -> world z.
    const ppm = 40;
    const cw = Math.round(2 * L * ppm);
    const ch = Math.round(2 * W * ppm);
    const cv = document.createElement('canvas');
    cv.width = cw;
    cv.height = ch;
    const c = cv.getContext('2d');
    const line = (x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    c.fillStyle = '#3b2531';
    c.fillRect(0, 0, cw / 2, ch);
    c.fillStyle = '#1f2e49';
    c.fillRect(cw / 2, 0, cw / 2, ch);
    c.strokeStyle = 'rgba(255,255,255,0.06)';      // 1 m grid: helps judge distance in 3D
    c.lineWidth = 2;
    for (let i = 1; i < 2 * L; i++) line(i * ppm, 0, i * ppm, ch);
    for (let j = 1; j < 2 * W; j++) line(0, j * ppm, cw, j * ppm);
    c.fillStyle = 'rgba(0,0,0,0.4)';                // no-go strip around the centre line
    c.fillRect(cw / 2 - gap * ppm, 0, 2 * gap * ppm, ch);
    c.save();
    c.beginPath();
    c.rect(cw / 2 - gap * ppm, 0, 2 * gap * ppm, ch);
    c.clip();
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 6;
    for (let y = -ch; y < ch * 2; y += 34) line(cw / 2 - gap * ppm, y, cw / 2 + gap * ppm, y + 2 * gap * ppm);
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.35)';
    c.lineWidth = 4;
    line(cw / 2 - (L / 2) * ppm, 0, cw / 2 - (L / 2) * ppm, ch);
    line(cw / 2 + (L / 2) * ppm, 0, cw / 2 + (L / 2) * ppm, ch);
    c.strokeStyle = 'rgba(255,255,255,0.9)';
    c.lineWidth = 8;
    c.strokeRect(4, 4, cw - 8, ch - 8);
    line(cw / 2, 0, cw / 2, ch);
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

  /** players: [{id, team, isMe, x, z, yaw, alive, charging, charge, act, actAge, hasBall, invuln}] */
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

  /** balls: [{...ball, pos: {x, y, z}}] */
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

  /** A fading glowing copy of a stick figure's current pose (perfect-dodge afterimage). */
  ghostMan(man) {
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

  updateFx(dt, t) {
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
    if (!this.last) this.last = { x: s.x, z: s.z };
    const inv = 1 / Math.max(dt, 1e-3);
    const vx = (s.x - this.last.x) * inv;
    const vz = (s.z - this.last.z) * inv;
    this.last.x = s.x;
    this.last.z = s.z;
    this.speed = damp(this.speed, Math.min(16, Math.hypot(vx, vz)), 10, dt);
    this.throwT += dt;
    this.hitT += dt;
    this.spinT += dt;
    this.downT = s.alive ? 0 : this.downT + dt;

    const sy = Math.sin(s.yaw);
    const cy = Math.cos(s.yaw);
    const vf = vx * sy + vz * cy;       // velocity along facing
    const vr = -vx * cy + vz * sy;      // velocity to the right
    this.side = damp(this.side, vr, 20, dt);
    this.phase += dt * this.speed * 1.9;
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
    this.legL.hip.rotation.x = damp(this.legL.hip.rotation.x, T.legL, r, dt);
    this.legR.hip.rotation.x = damp(this.legR.hip.rotation.x, T.legR, r, dt);
    this.legL.knee.rotation.x = damp(this.legL.knee.rotation.x, T.kneeL, r, dt);
    this.legR.knee.rotation.x = damp(this.legR.knee.rotation.x, T.kneeR, r, dt);
    const ra = this.throwT < 0.2 ? 60 : 26;
    this.armL.shoulder.rotation.x = damp(this.armL.shoulder.rotation.x, T.armLx, 26, dt);
    this.armR.shoulder.rotation.x = damp(this.armR.shoulder.rotation.x, T.armRx, ra, dt);
    this.armL.shoulder.rotation.z = damp(this.armL.shoulder.rotation.z, T.armLz, 30, dt);
    this.armR.shoulder.rotation.z = damp(this.armR.shoulder.rotation.z, T.armRz, 30, dt);
    this.armL.elbow.rotation.x = damp(this.armL.elbow.rotation.x, T.elbowL, 26, dt);
    this.armR.elbow.rotation.x = damp(this.armR.elbow.rotation.x, T.elbowR, 26, dt);
    this.chest.rotation.y = damp(this.chest.rotation.y, T.twist, 24, dt);
    this.hips.position.y = damp(this.hips.position.y, 0.95 - T.crouch, 20, dt);

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
    if (s.alive) {
      this.body.rotation.x = damp(this.body.rotation.x, T.leanX, 14, dt);
      this.body.rotation.z = damp(this.body.rotation.z, T.leanZ, 14, dt);
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

class BallView {
  constructor(world) {
    this.world = world;
    this.mat = new THREE.MeshStandardMaterial({ color: RALLY_COLORS[0], emissive: RALLY_COLORS[0], emissiveIntensity: 0.6, roughness: 0.35 });
    this.mesh = new THREE.Mesh(ballGeo, this.mat);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: world.glowTex, color: RALLY_COLORS[0], transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.shadowMat = world.shadowMat.clone();
    this.shadow = new THREE.Mesh(blobGeo, this.shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    world.scene.add(this.mesh, this.glow, this.shadow);
    this.key = '';
    this.trail = null;
    this.trailRally = -1;
    this.ghostAt = 0;
  }

  update(b, t) {
    const p = b.pos;
    this.mesh.position.set(p.x, p.y, p.z);
    this.glow.position.set(p.x, p.y, p.z);
    const live = b.state !== 2;
    const col = live ? rallyColor(b.rally) : 0x8a8f99;
    const key = `${b.rally}:${live}`;
    if (key !== this.key) {
      this.key = key;
      this.mat.color.setHex(col);
      this.mat.emissive.setHex(col);
      this.mat.emissiveIntensity = live ? 0.6 : 0.05;
      this.glow.material.color.setHex(col);
    }
    this.glow.visible = live;
    this.glow.scale.setScalar(1.0 + 0.3 * Math.min(b.rally, 5));
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
      if (b.rally && t - this.ghostAt > 0.035) {
        this.ghostAt = t;
        this.world.ghostBall(p, col);
      }
    }
    if (this.trail) this.trail.update(t, this.world.camera.position);
    this.shadow.position.set(p.x, 0.025, p.z);
    this.shadow.scale.setScalar(0.45 + p.y * 0.12);
    this.shadowMat.opacity = clamp(1 - p.y / 6, 0.2, 0.9);
  }

  dispose(scene) {
    scene.remove(this.mesh, this.glow, this.shadow);
    this.mat.dispose();
    this.glow.material.dispose();
    this.shadowMat.dispose();
    if (this.trail) this.world.retireTrail(this.trail);
  }
}
