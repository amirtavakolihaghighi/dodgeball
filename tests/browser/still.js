// Standing still and regeneration, end to end: after the next hit, plays out standing, walking, and
// dodging two ways (the direction let go before the dash ends, or held on after it), holding keys like
// a player, and reports the health gained in each part and the HUD's hint. window.__health() gives
// the health to watch: mine, or my team's bar.
window.__stillRun = async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const keys = dp.input.keys;
  const hint = () => (document.getElementById('regenState').hidden ? '' : document.getElementById('regenState').textContent);
  const start = window.__health();
  const until = performance.now() + 25000;
  while (window.__health() >= start && performance.now() < until) await sleep(50);   // the hit
  if (window.__health() >= start) return 'no hit came';
  await sleep(250);
  const parts = [];
  const part = async (name, ms, during) => {
    const h0 = window.__health();
    const seen = new Set();
    const end = performance.now() + ms;
    if (during) during();
    while (performance.now() < end) {
      seen.add(hint());
      await sleep(50);
    }
    parts.push({ part: name, gained: +(window.__health() - h0).toFixed(1), hint: [...seen].filter(Boolean).join(' / ') });
  };
  await part('standing', 2000);
  keys.add('KeyW');
  await part('walking', 1500);
  keys.delete('KeyW');
  await part('standing again: its first second', 1000);
  await part('standing again: after that', 1500);
  keys.add('KeyS');
  await part('a dodge, the key let go during the dash', 1500, () => {
    dp.input.onPress('dodge');
    setTimeout(() => keys.delete('KeyS'), 120);           // the dash lasts 0.22 s
  });
  keys.add('KeyW');
  await part('a dodge, the key held on after it', 900, () => dp.input.onPress('dodge'));
  keys.delete('KeyW');
  await part('standing: its first second', 1000);
  await part('standing: after that', 1500);
  return parts;
};
'standing-still script ready'
