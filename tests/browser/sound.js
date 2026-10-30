// Injected into the game page by sound.json: the recordings load and decode, every moment makes
// real sound (measured at the output), the volume of each kind works, sounds come from the side
// they happen on, the music follows the round, and a pile-up of sounds stays capped.
(() => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frames = (n) => new Promise((resolve) => {
    const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });
  const sfx = () => dp.sfx;
  let tap = null;

  /** Listens to what reaches the speakers: both channels, after the limiter. */
  function listen() {
    if (tap) return tap;
    const ctx = sfx().ctx;
    const split = ctx.createChannelSplitter(2);
    const ears = [ctx.createAnalyser(), ctx.createAnalyser()];
    sfx().limiter.connect(split);
    ears.forEach((a, i) => {
      a.fftSize = 2048;
      split.connect(a, i);
    });
    const buf = new Float32Array(2048);
    // the loudest sample and the energy on each side, over `ms`
    tap = async (ms) => {
      const out = { peak: 0, l: 0, r: 0 };
      const end = performance.now() + ms;
      while (performance.now() < end) {
        ears.forEach((a, i) => {
          a.getFloatTimeDomainData(buf);
          for (const v of buf) {
            out.peak = Math.max(out.peak, Math.abs(v));
            out[i ? 'r' : 'l'] += v * v;
          }
        });
        await wait(20);
      }
      return out;
    };
    return tap;
  }

  const db = (v) => Math.round(20 * Math.log10(v + 1e-9));

  /** The music slider: at 0 for the measurements (the meter would hear the music). */
  window.__musicLevel = async (v) => {
    const slider = document.getElementById('vol-music');
    slider.value = String(v);
    slider.dispatchEvent(new Event('input'));
    await wait(2000);         // the fade, then the pause
    return JSON.stringify(Object.fromEntries(Object.entries(sfx().tracks).map(([n, tr]) => [n, tr.el.paused ? 'paused' : 'playing'])));
  };

  window.__soundLoaded = async () => {
    const s = sfx();
    const hadFocus = document.hasFocus();
    s.setFocus(true);           // headless Chrome's page may not report focus; the game plays only when focused
    await s.loading;
    const sounds = s.bank ? Object.keys(s.bank.sounds) : [];
    return JSON.stringify({
      state: s.ctx.state, rate: s.ctx.sampleRate, hadFocus, error: s.loadError ?? null,
      sounds: sounds.length, variants: sounds.reduce((n, k) => n + s.bank.sounds[k].length, 0),
      seconds: s.bank ? +s.bank.buffer.duration.toFixed(1) : 0,
      sliders: document.querySelectorAll('.soundMix input[type=range]').length,
    });
  };

  /** Every moment, one at a time: how loud it comes out (dBFS); silence would be about -180. */
  window.__soundFlows = async () => {
    const t = listen();
    const s = sfx();
    const near = { x: s.ear.x + s.ear.fx * 5, z: s.ear.z + s.ear.fz * 5 };
    const moments = {
      throw: () => s.throw(0.8),
      throwOther: () => s.throw(0.8, near),
      hitMe: () => s.hit(null, { mine: true }),
      hitOther: () => s.hit(near),
      bounceFloor: () => s.bounce(near, true),
      bounceWall: () => s.bounce(near, false),
      catch: () => s.catch(null),
      perfectCatch: () => s.catch(null, true),
      deflect: () => s.deflect(null, 3),
      dash: () => s.dash(),
      dashOther: () => s.dash(near),
      hurtOther: () => s.hit(near, { who: 1 }),
      koOther: () => s.hit(near, { ko: true, who: 2 }),
      reviveAlly: () => s.revive(true),
      reviveEnemy: () => s.revive(false),
      warn: () => s.warn(),
      deny: () => s.deny(),
      revive: () => s.revive(),
      heal: () => s.heal(),
      round1: () => s.say('round1'),
      start: () => s.roundStart(),
      whistleLong: () => s.whistle(true),
      cheer: () => s.crowd('cheer'),
      applause: () => s.crowd('applause'),
      big: () => s.crowd('big'),
      win: () => s.say('win'),
    };
    const out = {};
    for (const [name, fn] of Object.entries(moments)) {
      await silence();          // the last one has faded (a revive rings for seconds)
      fn();
      out[name] = db((await t(450)).peak);
    }
    await silence();
    out.silentAfter = db((await t(300)).peak);
    return JSON.stringify(out);
  };

  /** Until nothing comes out (the crowd's applause lasts seconds). */
  async function silence() {
    const t = listen();
    for (let i = 0; i < 60 && (await t(200)).peak > 0.001; i++);
  }

  /** A kind at 0 is silent while the others still play; the sliders set and save the volumes. */
  window.__soundLevels = async () => {
    const t = listen();
    const s = sfx();
    await silence();
    const slider = document.getElementById('vol-announcer');
    slider.value = '0';
    slider.dispatchEvent(new Event('input'));
    await t(300);
    s.say('fight');
    const announcerOff = db((await t(500)).peak);
    s.hit(null, { mine: true });
    const effectsStillOn = db((await t(500)).peak);
    slider.value = '0.8';
    slider.dispatchEvent(new Event('input'));
    await t(800);
    s.say('fight');
    const announcerBack = db((await t(500)).peak);
    const saved = JSON.parse(localStorage.getItem('dp.settings')).levels;
    return JSON.stringify({ announcerOff, effectsStillOn, announcerBack, saved });
  };

  /** A bounce 6 m to your left is louder on the left, and to your right on the right. */
  window.__soundSides = async () => {
    const t = listen();
    const s = sfx();
    const side = { x: s.ear.fz, z: -s.ear.fx };        // the unit vector to the left
    const at = (k) => ({ x: s.ear.x + side.x * 6 * k, z: s.ear.z + side.z * 6 * k });
    const res = {};
    for (const [name, k] of [['left', 1], ['right', -1]]) {
      await t(500);
      s.bounce(at(k), true);
      const e = await t(400);
      res[name] = +(10 * Math.log10((e.l + 1e-12) / (e.r + 1e-12))).toFixed(1);     // dB louder on the left
    }
    return JSON.stringify({ leftMinusRightDb: res });
  };

  /** Out of breath for a second: the panting sounds, then stops by itself a few seconds after. */
  window.__breath = async () => {
    const t = listen();
    const s = sfx();
    await silence();
    let on = true;
    const tick = () => {
      if (!on) return;
      s.breathe(1);
      requestAnimationFrame(tick);
    };
    tick();
    const tired = db((await t(1500)).peak);
    on = false;
    const lingering = db((await t(1500)).peak);
    await wait(4500);
    return JSON.stringify({ tired, lingering, stoppedAfter: s.breath === null, after: db((await t(300)).peak) });
  };

  /** Which track plays, how loud (its gain), and whether it moves. */
  window.__music = async () => {
    const s = sfx();
    const state = () => Object.fromEntries(Object.entries(s.tracks).map(([n, tr]) => [n, {
      paused: tr.el.paused, at: +tr.el.currentTime.toFixed(2), gain: +tr.gain.gain.value.toFixed(2),
    }]));
    const before = state();
    await wait(1200);
    const el = s.tracks.match.el;
    return JSON.stringify({ round: dp.net.latest.r.s, mode: s.musicMode, before, after: state(), matchReady: el.readyState, matchError: el.error && el.error.code });
  };

  /** 300 bounces in one go: the same sound twice within 25 ms plays once; past that (the
   *  25 ms rule switched off here), the voices stay capped; the frames keep coming. */
  window.__pileUp = async () => {
    const s = sfx();
    await silence();
    await frames(10);
    const bounce = (i) => s.bounce({ x: s.ear.x + (i % 20) - 10, z: s.ear.z + 5 }, i % 2 === 0);
    const t0 = performance.now();
    for (let i = 0; i < 300; i++) bounce(i);
    const tookMs = +(performance.now() - t0).toFixed(1);
    const sameMoment = s.voices;
    for (let i = 0; i < 300; i++) {
      s.recent = {};
      bounce(i);
    }
    const capped = s.voices;
    const f0 = performance.now();
    await frames(30);
    return JSON.stringify({ voicesFromSameMoment: sameMoment, voicesWhenForced: capped, callsTookMs: tookMs,
      msPerFrameAfter: +((performance.now() - f0) / 30).toFixed(1) });
  };

  /** What the match itself played. */
  window.__soundCounts = () => JSON.stringify(sfx().count);
})();
