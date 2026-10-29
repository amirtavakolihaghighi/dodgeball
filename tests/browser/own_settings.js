// Plays for a few seconds: throws one ball, and reads the colour each ball in flight is drawn in
// (a ball nobody deflected takes its thrower's: that team's people's or bots'), until it has seen
// a RED person's, a RED bot's and a BLUE bot's. Also the colour of the ball in our own hand.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const seen = {};
  const start = performance.now();
  let thrown = false;
  while (performance.now() - start < 15000) {
    await sleep(40);
    if (!thrown && dp.me?.alive && dp.me.hasBall) {
      dp.input.onPress('throw');
      await sleep(300);
      dp.input.onRelease('throw');
      thrown = true;
    }
    for (const b of dp.view?.balls.values() ?? []) {
      const owner = dp.net.latest.players.get(b.owner);
      const drawn = dp.world.balls.get(b.id)?.mat.color.getHexString();
      if (b.state !== 0 || b.rally || !owner || !drawn) continue;
      seen[`${owner.team ? 'BLUE' : 'RED'} ${owner.bot ? 'bot' : 'person'}`] = `#${drawn}`;
    }
    if (seen['RED person'] && seen['RED bot'] && seen['BLUE bot']) break;
  }
  await sleep(250);                         // the ball in hand is back by now
  const held = dp.world.man(dp.me.id)?.heldMat.color.getHexString();
  const R = dp.rules.active;
  return JSON.stringify({
    seen, held: `#${held}`,
    rules: { 'RED person': R.BALL_COLOR_RED, 'RED bot': R.BALL_COLOR_RED_BOTS, 'BLUE bot': R.BALL_COLOR_BLUE_BOTS },
  });
})()
