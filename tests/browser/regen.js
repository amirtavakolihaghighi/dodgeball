// Samples a health value ten times a second for `seconds` (window.__health(): my health, or my
// team's bar), then measures what regeneration did: after each hit (a drop), how long until health
// started rising again, how fast it rose, and where it stopped.
window.__watchHealth = async (seconds) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const samples = [];
  const start = performance.now();
  while (performance.now() - start < seconds * 1000) {
    const v = window.__health();
    if (v !== null) samples.push([(performance.now() - start) / 1000, v]);
    await sleep(100);
  }
  const rises = [];
  let lastDrop = null;
  let rise = null;
  for (let i = 1; i < samples.length; i++) {
    const [t, v] = samples[i];
    const dv = v - samples[i - 1][1];
    if (dv < -2) {                      // a hit
      lastDrop = t;
      rise = null;
    } else if (dv > 0) {
      if (!rise && lastDrop !== null) rises.push((rise = { after: t - lastDrop, from: samples[i - 1][1], t0: samples[i - 1][0] }));
      if (rise) Object.assign(rise, { to: v, t1: t });
    }
  }
  const done = rises.filter((r) => r.t1 - r.t0 >= 0.5);
  return {
    samples: samples.length, hits: samples.filter((s, i) => i && s[1] - samples[i - 1][1] < -2).length,
    rises: done.map((r) => ({ pauseAfterHit: +r.after.toFixed(1), from: r.from, to: r.to, perSecond: +((r.to - r.from) / (r.t1 - r.t0)).toFixed(1) })),
    highestReachedRising: done.length ? Math.max(...done.map((r) => r.to)) : null,
  };
};
'health watcher ready'
