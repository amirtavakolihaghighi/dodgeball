// Ball-flight maths shared by the game (throw preview) and the rules editor's previews.

/** Same arc maths as the server (sim.launch_velocity): the velocity that carries a ball from
 *  `from` through `to` at `speed` on the flatter of the two gravity arcs. Out of reach, it's
 *  the longest (45 degree) throw, or null if `reachMax` is false. Points are [x, y, z]. */
export function launchVelocity(from, to, speed, gravity, reachMax = true) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dz);
  const g = gravity;
  if (g <= 0 || d < 0.3) {
    const l = Math.hypot(dx, dy, dz) || 1;
    return [(dx / l) * speed, (dy / l) * speed, (dz / l) * speed];
  }
  const s2 = speed * speed;
  const disc = s2 * s2 - g * (g * d * d + 2 * dy * s2);
  if (disc < 0 && !reachMax) return null;
  const theta = disc < 0 ? Math.PI / 4 : Math.atan2(s2 - Math.sqrt(disc), g * d);
  const h = (Math.cos(theta) * speed) / d;
  return [dx * h, Math.sin(theta) * speed, dz * h];
}

/** Same as the server (rules.Rules.curve_share): how hard a ball at `speed` bends, as a share of
 *  a full-power ball's turn rate. Per metre, a tap-speed ball bends SLOW_BALL_CURVE as much. */
export function curveShare(R, speed) {
  const lo = R.THROW_SPEED_MIN;
  const hi = R.THROW_SPEED_MAX;
  const f = hi > lo ? Math.max(0, Math.min(1, (speed - lo) / (hi - lo))) : 1;
  return ((R.SLOW_BALL_CURVE + (1 - R.SLOW_BALL_CURVE) * f) * speed) / Math.max(hi, 1e-6);
}
