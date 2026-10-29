// Injected into the game page: deflects every other incoming ball too early on purpose (about
// 0.27 s before the window could reach it) and the rest on time, and records what the hits said.
// Checks the hit popup's "TOO EARLY (x s)" and "SECOND BALL" labels end to end: the server's
// judgement -> the hit event -> the popup on screen. Read the results with __report().
(() => {
  const stats = { early: 0, onTime: 0, defended: 0, hits: 0, markedEarly: 0, markedSecond: 0 };
  const popups = [];
  const pressed = new Set();

  new MutationObserver((changes) => {
    for (const c of changes) for (const el of c.addedNodes) if (el.classList?.contains('pop')) popups.push(el.textContent);
  }).observe(document.getElementById('popups'), { childList: true });

  const take = dp.net.takeEvents.bind(dp.net);
  dp.net.takeEvents = (rt) => {
    const events = take(rt);
    for (const e of events) {
      if (e.p !== dp.me?.id) continue;
      if (['catch', 'deflect', 'dodge'].includes(e.k)) stats.defended++;
      if (e.k === 'hit') {
        stats.hits++;
        if (e.early) stats.markedEarly++;
        if (e.second) stats.markedSecond++;
      }
    }
    return events;
  };

  (function loop() {
    const th = dp.threat;
    if (th && dp.me?.alive) {
      const key = `${th.b.id}:${th.b.rally}`;
      const early = th.b.id % 2 === 0;
      if (!pressed.has(key) && th.tti < (early ? 0.45 : 0.085)) {
        pressed.add(key);
        if (early) stats.early++; else stats.onTime++;
        dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
        setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' })), 30);
      }
    }
    requestAnimationFrame(loop);
  })();

  window.__report = () => {
    const tooEarly = popups.filter((t) => t.startsWith('TOO EARLY'));
    const second = popups.filter((t) => t.startsWith('SECOND BALL'));
    return JSON.stringify({ ...stats, popupsTooEarly: tooEarly.length, popupsSecondBall: second.length,
      examples: [...new Set([...tooEarly.slice(0, 3), ...second.slice(0, 2)])] });
  };
  return 'why-hit tester on';
})();
