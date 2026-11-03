// Injected into the game page by graphics.json: the graphics setting (graphics.js), the warning
// for drawing without the graphics card, presses timed from their key event, and whether any
// shader still gets built mid-match (each one freezes the picture for a moment).
(() => {
  const programs = () => dp.world.renderer.info.programs.map((p) => p.name);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lobbyPrograms = null;

  window.__start = () => {
    lobbyPrograms = programs();
    return JSON.stringify({
      warning: !document.getElementById('gpuWarn').hidden && !document.getElementById('gpuWarnJoin').hidden,
      choice: dp.graphics.choice, level: dp.graphics.level, ceiling: dp.graphics.ceiling, host: dp.isHost,
      pixelRatio: dp.world.renderer.getPixelRatio(), dpr: devicePixelRatio, note: document.getElementById('gfxNote').textContent,
      warmedUp: !!dp.world.warm, programs: lobbyPrograms.length,
    });
  };

  /** Auto's rules on a stand-in world, fed made-up frame times: no waiting for a real slow laptop. */
  window.__gfxUnit = async () => {
    const { Graphics } = await import('/static/js/graphics.js');
    const fake = () => ({ calls: [], setQuality(level, ratio) { this.calls.push(`${level}@${ratio.toFixed(2)}`); } });
    const run = (g, fps, seconds, clock) => {
      for (let i = 0; i < fps * seconds; i++) {
        clock.t += 1000 / fps;
        g.frame(clock.t);
      }
    };
    const out = {};
    // 1. Slow at High; a step down helps (30 -> 50 fps): stays at Medium.
    let w = fake(); let g = new Graphics(w, 'auto', false); let c = { t: 0 }; g.frame(c.t);
    run(g, 30, 6, c); out.slowStepsDown = g.level;
    run(g, 50, 6, c); out.helpedStays = g.level;
    // 2. A step down that doesn't help (30 -> 31 fps): one more, to Low; when that doesn't help either,
    //    back to High, and Auto stops changing things.
    w = fake(); g = new Graphics(w, 'auto', false); c = { t: 0 }; g.frame(c.t);
    run(g, 30, 6, c); const stepped = g.level;
    run(g, 31, 8, c); const second = g.level;
    run(g, 31, 10, c); out.notHelped = `${stepped}, then ${second}, then ${g.level}, stuck ${g.stuck}`;
    run(g, 30, 10, c); out.afterStuck = g.level;
    // 2b. ...and when Low does help (31 -> 50 fps), it stays at Low.
    w = fake(); g = new Graphics(w, 'auto', false); c = { t: 0 }; g.frame(c.t);
    run(g, 30, 6, c); run(g, 31, 8, c); run(g, 50, 10, c); out.lowHelped = `${g.level}, stuck ${g.stuck}`;
    // 3. Smooth for 20 s at Medium: tries High, but only between rounds (calm()).
    w = fake(); g = new Graphics(w, 'medium', false); g.choose('auto'); g.level = 'medium'; c = { t: 0 }; g.frame(c.t);
    let calm = false;
    g.calm = () => calm;
    run(g, 60, 24, c); const inRound = g.level;
    calm = true;
    run(g, 60, 2, c); out.rises = `${inRound} during a round, ${g.level} after it`;
    // 3b. High turns out too slow: back to Medium, and High isn't tried again.
    run(g, 30, 6, c); run(g, 50, 6, c); const dropped = g.level;
    run(g, 60, 30, c); out.failedNotRetried = `${dropped}, then ${g.level} after 30 smooth seconds`;
    // 4. The host's ceiling: Auto at High drops to Medium; a fixed High stays.
    w = fake(); g = new Graphics(w, 'auto', false); g.setCeiling('medium'); out.hostAuto = g.level;
    w = fake(); g = new Graphics(w, 'high', false); g.setCeiling('medium'); out.hostFixedHigh = g.level;
    // 5. No graphics card: Auto starts at Low.
    w = fake(); g = new Graphics(w, 'auto', true); out.software = `${g.level}: ${g.describe()}`;
    // 6. A paused page (gap over 0.5 s) isn't counted as a slow second.
    w = fake(); g = new Graphics(w, 'auto', false); c = { t: 0 }; g.frame(c.t);
    for (let i = 0; i < 4; i++) { c.t += 5000; g.frame(c.t); run(g, 60, 0.4, c); }
    out.pausesIgnored = g.level;
    out.ratios = w.calls;
    return JSON.stringify(out);
  };

  /** B4: a press is timed from its event, even when the browser handled it late. */
  window.__pressTiming = async () => {
    const press = async (code, age) => {
      const at = performance.now() - age;
      const base = { code, target: document.body, preventDefault() {} };
      dp.input.key({ ...base, timeStamp: at }, true);
      dp.input.key({ ...base, timeStamp: performance.now() }, false);
      const line = dp.diag.lines.filter((l) => l.ty === 'press').at(-1);
      const expected = dp.net.viewTimeAt(at);
      await wait(1300);                               // past the recovery, for the next press
      return line ? { held: line.held, wtError: Math.round((line.wt - expected) * 1000) } : 'no press logged';
    };
    return JSON.stringify({
      held40ms: await press('KeyE', 40),
      held120ms: await press('KeyF', 120),
      staleFallsBackToNow: await press('KeyE', 2500),
    });
  };

  const stats = { presses: 0, effects: {} };
  window.__defend = () => {
    const take = dp.net.takeEvents.bind(dp.net);
    dp.net.takeEvents = (rt) => {
      const events = take(rt);
      for (const e of events) {
        const kind = e.perfect ? `${e.k} (perfect)` : e.k;
        stats.effects[kind] = (stats.effects[kind] || 0) + 1;
      }
      return events;
    };
    const keys = ['KeyE', 'Space', 'KeyF'];            // deflect, dodge, catch in turn: every kind of effect
    const pressed = new Set();
    (function loop() {
      const th = dp.threat;
      if (th && dp.me?.alive) {
        const key = `${th.b.id}:${th.b.rally}`;
        if (th.tti < 0.085 && !pressed.has(key)) {
          pressed.add(key);
          const code = keys[stats.presses++ % keys.length];
          dispatchEvent(new KeyboardEvent('keydown', { code }));
          setTimeout(() => dispatchEvent(new KeyboardEvent('keyup', { code })), 60);
        }
      }
      requestAnimationFrame(loop);
    })();
    return 'defending';
  };

  window.__report = () => {
    const now = programs();
    const added = now.slice(lobbyPrograms.length);
    const secs = dp.diag.lines.filter((l) => l.ty === 'sec' && l.state === 'play');
    const fps = secs.length ? Math.round(secs.reduce((s, l) => s + l.fps, 0) / secs.length) : null;
    return JSON.stringify({
      presses: stats.presses, events: stats.effects,
      programs: { lobby: lobbyPrograms.length, now: now.length, builtMidMatch: added },
      level: dp.graphics.level, gfxChanges: dp.diag.lines.filter((l) => l.ty === 'gfx').map((l) => `${l.from || l.choice} -> ${l.to}: ${l.why || ''}`),
      fpsInPlay: fps, hitches: dp.diag.lines.filter((l) => l.ty === 'hitch').length,
    });
  };
})();
