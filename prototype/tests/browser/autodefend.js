// Injected into the game page: presses a defence key ~80 ms before each incoming ball would
// hit (using the same threat detection that drives the timing ring), and records why any
// hit got through. Measures the whole timing path: client prediction -> key press -> server
// lag-compensated judgement -> event back. Mode comes from the URL: ?mode=catch|deflect|dodge.
// Read the results with __report().
(() => {
  const mode = new URLSearchParams(location.search).get('mode') || 'catch';
  const code = { catch: 'KeyF', deflect: 'KeyE', dodge: 'Space' }[mode];
  const stats = { presses: 0, sent: 0, defended: 0, perfect: 0, hits: 0, denies: 0 };
  const seen = {};          // ball id -> what the client saw of it
  const notes = [];
  const pressed = new Set();

  const send = dp.net.send.bind(dp.net);
  dp.net.send = (m) => {
    if (m.t === 'act') stats.sent++;
    return send(m);
  };
  const take = dp.net.takeEvents.bind(dp.net);
  dp.net.takeEvents = (rt) => {
    const events = take(rt);
    for (const e of events) {
      if (e.p !== dp.me?.id) continue;
      if (['catch', 'deflect', 'dodge'].includes(e.k)) {
        stats.defended++;
        if (e.perfect) stats.perfect++;
      } else if (e.k === 'hit') {
        stats.hits++;
        notes.push(`hit by ball ${e.b} (${e.speed} m/s${e.bank ? ', ricochet' : ''}): ${seen[e.b] ? JSON.stringify(seen[e.b]) : 'never seen as incoming'}`);
      } else if (e.k === 'deny') {
        stats.denies++;
        notes.push('server refused: ' + e.why);
      }
    }
    return events;
  };

  (function loop() {
    const th = dp.threat;
    if (th && dp.me?.alive) {
      const info = (seen[th.b.id] ??= { firstTti: +th.tti.toFixed(3) });
      info.lastTti = +th.tti.toFixed(3);
      const key = `${th.b.id}:${th.b.rally}`;
      if (th.tti < 0.085 && !pressed.has(key)) {
        pressed.add(key);
        stats.presses++;
        const before = stats.sent;
        info.pressedAtTti = +th.tti.toFixed(3);
        dispatchEvent(new KeyboardEvent('keydown', { code }));
        info.sent = stats.sent > before;    // false = blocked locally (recovery / stamina)
        setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code })), 30);
      }
    }
    requestAnimationFrame(loop);
  })();

  window.__report = () => [`mode ${mode}: ${JSON.stringify(stats)}`, ...notes].join('\n  ');
  return `auto-defender on (${mode})`;
})();
