// Injected into the game page: walks out of the way of every incoming ball (holds A or D,
// away from the ball's line, from ~0.25 s before it arrives) and never presses a defence.
// With simulated lag (?lag=150) the server learns where you are late, so it measures what
// sidestep compensation does: with it on, balls you walked clear of on your screen miss you.
// Read the results with __report().
(() => {
  const stats = { tried: 0, sidestepped: 0, hits: 0, clearHits: 0 };
  const tried = new Set();
  const take = dp.net.takeEvents.bind(dp.net);
  dp.net.takeEvents = (rt) => {
    const events = take(rt);
    for (const e of events) {
      if (e.p !== dp.me?.id) continue;
      if (e.k === 'sidestep') stats.sidestepped++;
      else if (e.k === 'hit') {
        stats.hits++;
        if ((e.gap ?? -1) > 0) stats.clearHits++;     // clear on this screen, hit anyway
      }
    }
    return events;
  };

  (function loop() {
    const th = dp.threat;
    if (th && dp.me?.alive && th.tti < 0.25) {
      const key = `${th.b.id}:${th.b.rally}`;
      if (!tried.has(key)) {
        tried.add(key);
        stats.tried++;
        const b = th.b;
        const len = Math.hypot(b.vx, b.vz) || 1;
        const px = -b.vz / len;
        const pz = b.vx / len;
        const side = (dp.local.x - b.pos.x) * px + (dp.local.z - b.pos.z) * pz;
        const sign = Math.abs(side) > 0.05 ? Math.sign(side) : 1;
        const right = [-Math.cos(dp.local.yaw), Math.sin(dp.local.yaw)];
        const code = (px * sign * right[0] + pz * sign * right[1]) > 0 ? 'KeyD' : 'KeyA';
        dispatchEvent(new KeyboardEvent('keydown', { code }));
        setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code })), 350);
      }
    }
    requestAnimationFrame(loop);
  })();

  window.__report = () => `sidestep compensation ${dp.cfg.sidestepComp ? 'on' : 'off'}: ${JSON.stringify(stats)}`;
  return 'sidestepper on';
})();
