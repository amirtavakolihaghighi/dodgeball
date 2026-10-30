// Injected into the game page by juice.json: the camera effects (shake, jolts, the charge zoom)
// must never move the aim; specks, the impact freeze and the stretched balls work.
(() => {
  const frames = (n) => new Promise((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const close = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

  /** Full shake and a strong jolt: the aim from the shaken frame equals the aim from the camera
   *  placed afresh (unshaken), while the camera that drew the frame had moved. */
  window.__aimUnmoved = async () => {
    dp.camFx.amount = 1;
    dp.camFx.trauma = 1;
    dp.camFx.jolt(0.12, 0.08, 0.2, 6);
    await frames(3);
    const shakenAim = [...dp.aim.point];
    const cam = dp.world.camera;
    const shakenAt = cam.position.toArray();
    const shakenFov = cam.fov;
    const shakenDir = cam.getWorldDirection(cam.position.clone()).toArray();
    dp.placeCamera();
    dp.computeAim();
    const cleanAim = [...dp.aim.point];
    const cleanAt = cam.position.toArray();
    const cleanDir = cam.getWorldDirection(cam.position.clone()).toArray();
    const moved = Math.hypot(...shakenAt.map((v, i) => v - cleanAt[i]));
    const turned = Math.acos(Math.min(1, shakenDir.reduce((s, v, i) => s + v * cleanDir[i], 0))) * 180 / Math.PI;
    return JSON.stringify({
      aimUnmoved: close(shakenAim, cleanAim), cameraMovedCm: Math.round(moved * 100), cameraTurnedDeg: +turned.toFixed(2),
      fovWas: +shakenFov.toFixed(2), baseFov: dp.camFx.baseFov,
    });
  };

  /** Backing into your end wall puts the camera behind it: the wall turns see-through, with its
   *  outline showing, and comes back when you step away. The same at a side, where the camera
   *  ends up in the stands. */
  window.__seeThrough = async () => {
    const w = dp.world;
    if (!w.arena) return JSON.stringify({ skipped: 'no hall (noarena)' });
    const [L, W] = w.courtSize;
    const team = dp.me.team === 1 ? 1 : 0;
    const s = team === 1 ? 1 : -1;                       // red's end is at -L, blue's at +L
    const end = w.wallMats.end[team];
    const outline = w.wallMats.edge[team];
    const place = async (x, z, yaw) => {
      dp.local.x = x;
      dp.local.z = z;
      dp.local.yaw = yaw;
      await wait(900);
    };
    const facing = s > 0 ? -Math.PI / 2 : Math.PI / 2;  // towards the middle
    await place(s * (L - 0.5), 0, facing);
    const back = { wall: +end.opacity.toFixed(2), outline: +outline.opacity.toFixed(2), cameraX: +w.camera.position.x.toFixed(1) };
    await place(s * L / 2, 0, facing);
    const middle = { wall: +end.opacity.toFixed(2), outline: +outline.opacity.toFixed(2) };
    await place(s * L / 2, -(W - 0.5), 0);                // at the -z side, facing across the court
    const side = { boards: +w.wallMats.side[0][0].opacity.toFixed(2), stands: +w.standMats.step[0].opacity.toFixed(2),
      crowd: +w.standMats.body[0].opacity.toFixed(2), otherSide: +w.standMats.step[1].opacity.toFixed(2), cameraZ: +w.camera.position.z.toFixed(1) };
    await place(s * L / 2, 0, facing);
    const away = { boards: +w.wallMats.side[0][0].opacity.toFixed(2), stands: +w.standMats.step[0].opacity.toFixed(2) };
    return JSON.stringify({ team, court: [L, W], back, middle, side, away });
  };

  /** The Screen shake slider at 0: nothing moves. */
  window.__shakeOff = async () => {
    const input = document.getElementById('shakeInput');
    input.value = '0';
    input.dispatchEvent(new Event('input'));
    dp.camFx.trauma = 1;
    dp.camFx.jolt(0.12, 0.08, 0.2, 6);
    await frames(3);
    const cam = dp.world.camera;
    const drawnAt = cam.position.toArray();
    const fov = cam.fov;
    dp.placeCamera();
    const moved = Math.hypot(...drawnAt.map((v, i) => v - cam.position.toArray()[i]));
    const saved = JSON.parse(localStorage.getItem('dp.settings')).shake;
    input.value = '1';
    input.dispatchEvent(new Event('input'));
    return JSON.stringify({ amount: 0, movedCm: Math.round(moved * 100), fov: +fov.toFixed(2), saved });
  };

  window.__specks = async () => {
    const before = dp.world.particles.live;
    dp.world.burstOf(0, 1.2, 0, 0xffffff, 40, { speed: 5 });
    await frames(2);
    const live = dp.world.particles.live;
    await wait(1600);
    return JSON.stringify({ before, afterBurst: live, after1600ms: dp.world.particles.live });
  };

  window.__freeze = async () => {
    const man = dp.world.man(dp.me.id);
    man.impact(0.2);
    await frames(2);
    const during = man.freezeT > 0;
    const shudder = Math.hypot(man.body.position.x, man.body.position.z);
    await wait(400);
    return JSON.stringify({ frozenRightAfter: during, shudderCm: +(shudder * 100).toFixed(1), frozenAfter400ms: man.freezeT > 0, still: Math.hypot(man.body.position.x, man.body.position.z) });
  };

  let stretchMax = 1;
  let speckPeak = 0;
  window.__watch = () => {
    (function loop() {
      for (const v of dp.world.balls.values()) stretchMax = Math.max(stretchMax, v.holder.scale.y / v.holder.scale.x);
      speckPeak = Math.max(speckPeak, dp.world.particles.live);
      requestAnimationFrame(loop);
    })();
    return 'watching balls and specks';
  };
  window.__juiceReport = () => JSON.stringify({ longestBallStretch: +stretchMax.toFixed(2), speckPeak, trauma: +dp.camFx.trauma.toFixed(2) });
})();
