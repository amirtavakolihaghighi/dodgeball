// Camera juice: shake that builds up and fades (trauma), quick jolts (a throw's recoil, getting
// hit, a punch on a perfect press) and a slight zoom while charging a throw.
//
// Fairness: main.js applies all of this after the aim has been worked out, and only to the
// picture: the next frame places the camera afresh. Shaking never moves where a throw goes, or
// which ball the timing ring follows.

const OMEGA = 18;               // how fast a jolt springs back (rad/s; critically damped)
const JOLT = OMEGA * Math.E;    // initial speed per metre (or degree) of peak displacement
const DECAY = 1.4;              // trauma lost per second
const SHAKE_ROT = [0.03, 0.025, 0.02];   // radians of yaw, pitch and roll at full trauma
const ZOOM = 7;                 // degrees narrower at a full charge (the user asked for more than 4.5)

/** One step of a critically damped spring back to 0: exact for any time step. */
function spring(s, key, dt) {
  const x = s[key];
  const v = s[`v${key}`];
  const e = Math.exp(-OMEGA * dt);
  const a = v + OMEGA * x;
  s[key] = (x + a * dt) * e;
  s[`v${key}`] = (v - OMEGA * a * dt) * e;
}

export class CameraFx {
  constructor(camera) {
    this.baseFov = camera.fov;
    this.amount = 1;            // the player's Screen shake setting: 0 turns all of this off
    this.trauma = 0;            // 0..1; the shake grows with its square, so small knocks stay small
    this.t = 0;
    this.s = { x: 0, y: 0, z: 0, f: 0, vx: 0, vy: 0, vz: 0, vf: 0 };   // jolt offset (m, camera axes) and extra FOV (°)
    this.zoom = 0;
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** A jolt peaking at x right, y up, z back (metres, the camera's own axes) and fov degrees wider. */
  jolt(x, y, z, fov = 0) {
    this.s.vx += x * JOLT;
    this.s.vy += y * JOLT;
    this.s.vz += z * JOLT;
    this.s.vf += fov * JOLT;
  }

  /** Every frame; charge: 0..1 while winding up a throw, else 0. */
  update(dt, charge) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - DECAY * dt);
    for (const key of ['x', 'y', 'z', 'f']) spring(this.s, key, dt);
    this.zoom += (charge * ZOOM - this.zoom) * (1 - Math.exp(-(charge > 0 ? 6 : 14) * dt));
  }

  /** After the aim: move the picture only. */
  apply(camera) {
    const a = this.amount;
    const shake = this.trauma * this.trauma * a;
    if (shake > 0) {
      const t = this.t;
      // smooth wobble: two sines per axis at unrelated speeds, rather than jumpy random noise
      const wobble = (speed, phase) => 0.6 * Math.sin(t * speed + phase) + 0.4 * Math.sin(t * speed * 2.31 + phase * 1.7);
      camera.rotateY(SHAKE_ROT[0] * shake * wobble(23, 1));
      camera.rotateX(SHAKE_ROT[1] * shake * wobble(29, 2));
      camera.rotateZ(SHAKE_ROT[2] * shake * wobble(19, 3));
    }
    const { x, y, z, f } = this.s;
    if (a && (x || y || z)) {
      camera.translateX(x * a);
      camera.translateY(y * a);
      camera.translateZ(z * a);
    }
    const fov = this.baseFov + (f - this.zoom) * a;
    if (Math.abs(camera.fov - fov) > 1e-4) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();     // so name tags (world.project) follow the moved picture
  }
}
