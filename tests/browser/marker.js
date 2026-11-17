// Injected into the game page by marker.json: the incoming-ball marker (Your settings: Meter, Ring
// or Off, and the meter's shape, colours, width and size) and the Revive / Team health tile's
// attention effect.
(() => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  /** The pointer's tip on the meter: its angle (0 up, clockwise) and distance from the crosshair. */
  const tipOf = () => {
    const n = document.querySelector('#meter .tip').getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
    return { angle: Math.atan2(n[2], -n[3]), r: Math.hypot(n[2], n[3]) };
  };
  const stripes = () => [...document.querySelectorAll('#meter .stripe')].filter((p) => p.getAttribute('d'))
    .map((p) => p.getAttribute('fill'));
  /** How far round the crosshair the meter reaches, in degrees (its first stripe's ends). */
  const spanOf = () => {
    const n = document.querySelector('#meter .stripe').getAttribute('d').match(/-?\d+(\.\d+)?/g).map(Number);
    const angles = [];
    for (let i = 0; i < n.length; i += 2) angles.push((Math.atan2(n[i], -n[i + 1]) * 180) / Math.PI);
    return Math.round(Math.max(...angles) - Math.min(...angles));
  };
  /** The run's printout: the numbers, after "FAIL" and what didn't hold if anything didn't. */
  const verdict = (out, problems) => (problems.length ? `FAIL ${problems.join('; ')} ` : '') + JSON.stringify(out);
  /** While the game itself would redraw them each frame, draw them ourselves. */
  const hold = () => {
    const real = { meter: dp.hud.setMeter.bind(dp.hud), actions: dp.hud.setActions.bind(dp.hud) };
    dp.hud.setMeter = () => {};
    dp.hud.setActions = () => {};
    return real;
  };
  const release = (real) => {
    dp.hud.setMeter = real.meter;
    dp.hud.setActions = real.actions;
  };

  window.__markerSettings = () => {
    const out = { defaults: { ...['marker', 'meterShape', 'meterColours', 'meterWidth', 'meterSize'].reduce((o, k) => ({ ...o, [k]: dp.settings[k] }), {}) } };
    out.optionsShown = !document.getElementById('meterOptions').hidden;
    const sel = document.getElementById('markerSelect');
    sel.value = 'ring';
    sel.dispatchEvent(new Event('change'));
    out.ringHidesOptions = document.getElementById('meterOptions').hidden;
    const cycle = [];
    for (let i = 0; i < 3; i++) {
      dp.input.onPress('ring', performance.now());       // H
      cycle.push(dp.settings.marker);
    }
    out.hCycles = `ring → ${cycle.join(' → ')}`;
    out.popup = document.getElementById('popups').textContent.slice(-40);
    const w = document.getElementById('meterWidth');
    w.value = '30';
    w.dispatchEvent(new Event('input'));
    out.widthSaved = JSON.parse(localStorage.getItem('dp.settings')).meterWidth;
    w.value = String(out.defaults.meterWidth);
    w.dispatchEvent(new Event('input'));
    out.selectShows = sel.value;
    sel.value = 'meter';                // the meter again, for the rest of the run
    sel.dispatchEvent(new Event('change'));
    const want = { marker: 'meter', meterShape: 'crescent', meterColours: 'all', meterWidth: 24, meterSize: 150 };
    const problems = [];
    if (JSON.stringify(out.defaults) !== JSON.stringify(want)) problems.push(`the defaults aren't ${JSON.stringify(want)}`);
    if (!out.optionsShown || !out.ringHidesOptions) problems.push("the meter's options don't show only with the meter");
    if (out.hCycles !== 'ring → off → meter → ring') problems.push("H doesn't go Meter → Ring → Off");
    if (!out.popup.endsWith('Incoming-ball marker: Ring (H)')) problems.push("H's message isn't shown");
    if (out.widthSaved !== 30) problems.push("the width isn't saved");
    if (out.selectShows !== 'ring') problems.push("the settings menu doesn't follow H");
    return verdict(out, problems);
  };

  /** What the meter shows at exact moments, by this player's own windows. */
  window.__meterLook = async () => {
    const { meterLook } = await import('/static/js/hud.js');
    const A = dp.cfg.actions;
    const at = (tti, colours) => meterLook(tti, A, colours).map((s) => `${s.kind} ${s.state}`).join(', ');
    const out = {
      windows: Object.fromEntries(Object.entries(A).map(([k, s]) => [k, `${s.window} s, perfect ${s.perfect} s`])),
      '0.50 s': at(0.5), '0.31 s': at(0.31), '0.25 s': at(0.25), '0.15 s': at(0.15), '0.11 s': at(0.11),
      '0.08 s': at(0.08), '0.05 s': at(0.05), 'catch only, 0.20 s': at(0.2, 'catch'), 'catch only, 0.09 s': at(0.09, 'catch'),
    };
    const want = {          // by the default windows: dodge 0.32 s (perfect 0.12), catch 0.30 (0.10), deflect 0.18 (0.06)
      windows: { dodge: '0.32 s, perfect 0.12 s', catch: '0.3 s, perfect 0.1 s', deflect: '0.18 s, perfect 0.06 s' },
      '0.50 s': 'dodge early, catch early, deflect early', '0.31 s': 'dodge now, catch early, deflect early',
      '0.25 s': 'dodge now, catch now, deflect early', '0.15 s': 'dodge now, catch now, deflect now',
      '0.11 s': 'dodge perfect, catch now, deflect now', '0.08 s': 'dodge perfect, catch perfect, deflect now',
      '0.05 s': 'dodge perfect, catch perfect, deflect perfect', 'catch only, 0.20 s': 'catch now', 'catch only, 0.09 s': 'catch perfect',
    };
    const problems = Object.keys(want).filter((k) => JSON.stringify(out[k]) !== JSON.stringify(want[k]))
      .map((k) => `${k} isn't ${JSON.stringify(want[k])}`);
    return verdict(out, problems);
  };

  /** The meter drawn: stripes, colours, the pointer's direction, shapes and sizes. */
  window.__meterDraw = () => {
    const real = hold();
    const m = (o) => ({ dir: 0, tti: 0.15, windows: dp.cfg.actions, shape: 'crescent', width: 18, size: 150, colours: 'all', ...o });
    const out = {};
    real.meter(m({}));
    out.shown = document.getElementById('meter').classList.contains('on');
    out.stripes = stripes();
    out.ahead = tipOf();
    real.meter(m({ dir: Math.PI / 2 }));
    out.right = tipOf();
    real.meter(m({ dir: Math.PI }));
    out.behind = tipOf();
    real.meter(m({ colours: 'deflect', tti: 0.04 }));
    out.deflectOnlyPerfect = stripes();
    real.meter(m({ size: 220, tti: 0.0 }));
    out.bigAtImpact = Math.round(tipOf().r);
    out.spanAtImpact = spanOf();
    out.edge = !!document.querySelector('#meter .edge').getAttribute('d');
    real.meter(m({ size: 220, tti: 1.1 }));
    out.bigFarAway = Math.round(tipOf().r);
    out.spanFarAway = spanOf();
    real.meter(m({ shape: 'band' }));
    out.band = stripes().length;
    real.meter(null);
    out.hidden = !document.getElementById('meter').classList.contains('on');
    release(real);
    const deg = (k) => Math.round((out[k].angle * 180) / Math.PI);
    const problems = [];
    if (!out.shown || !out.hidden) problems.push("it doesn't show and hide");
    if (JSON.stringify(out.stripes) !== '["#6fd0ff","#5dff9b","#ff6bd8"]') problems.push('0.15 s out, the three stripes are not dodge, catch, deflect');
    if (deg('ahead') !== 0 || deg('right') !== 90 || Math.abs(deg('behind')) !== 180) problems.push("the pointer doesn't point where the ball is");
    if (JSON.stringify(out.deflectOnlyPerfect) !== '["#ffc940"]') problems.push('deflect only, 0.04 s out, is not one gold stripe');
    if (!(out.bigAtImpact > out.bigFarAway && out.bigFarAway > 225 && out.bigAtImpact < 250)) problems.push("the size setting doesn't place it");
    if (!(out.spanAtImpact > 3 * out.spanFarAway)) problems.push("it doesn't grow as the ball comes");
    if (!out.edge) problems.push('no dark edge');
    if (out.band !== 3) problems.push('the band has not three stripes');
    for (const k of ['ahead', 'right', 'behind']) out[k] = `${deg(k)}° at ${Math.round(out[k].r)} px`;
    return verdict(out, problems);
  };

  /** A gallery of the meter's moments, for a picture: copies of it at its real size and the default
   *  width and size, each pointing up, over the hall with the rest of the HUD hidden. */
  window.__meterGallery = () => {
    document.getElementById('overlay').hidden = true;
    const hud = document.getElementById('hud');
    for (const el of hud.children) {
      el.dataset.galleryWas = el.style.visibility;
      el.style.visibility = 'hidden';
    }
    const real = hold();
    const cells = [
      ['0.9 s away', { tti: 0.9 }], ['0.5 s', { tti: 0.5 }], ['0.31 s · dodge', { tti: 0.31 }], ['0.25 s · + catch', { tti: 0.25 }],
      ['0.15 s · + deflect', { tti: 0.15 }], ['0.11 s · dodge perfect', { tti: 0.11 }], ['0.08 s · catch perfect', { tti: 0.08 }],
      ['0.05 s · all perfect', { tti: 0.05 }],
      ['Band · 0.5 s', { shape: 'band', tti: 0.5 }], ['Band · 0.25 s', { shape: 'band', tti: 0.25 }],
      ['Band · 0.15 s', { shape: 'band', tti: 0.15 }], ['Band · 0.05 s', { shape: 'band', tti: 0.05 }],
      ['Catch only · 0.5 s', { colours: 'catch', tti: 0.5 }], ['Catch only · 0.2 s', { colours: 'catch', tti: 0.2 }],
      ['Catch only · 0.06 s', { colours: 'catch', tti: 0.06 }], ['Deflect only · 0.12 s', { colours: 'deflect', tti: 0.12 }],
    ];
    const svg = document.getElementById('meter');
    const s = dp.settings;
    cells.forEach(([label, o], i) => {
      const x = (i % 4) * 320;
      const y = Math.floor(i / 4) * 180;
      real.meter({ dir: 0, windows: dp.cfg.actions, shape: s.meterShape, width: s.meterWidth, size: s.meterSize, colours: 'all', ...o });
      const copy = svg.cloneNode(true);
      copy.removeAttribute('id');
      copy.classList.add('galleryCopy');
      Object.assign(copy.style, {        // the crosshair (the copy's middle) under the cell, the arc above it
        position: 'absolute', display: 'block', width: '640px', height: '640px', margin: '0', pointerEvents: 'none',
        left: `${x + 160 - 320}px`, top: `${y + 200 - 320}px`, visibility: 'visible',
      });
      const tag = document.createElement('div');
      tag.className = 'galleryCopy';
      tag.textContent = label;
      Object.assign(tag.style, {
        position: 'absolute', left: `${x}px`, top: `${y + 132}px`, width: '320px', visibility: 'visible',
        textAlign: 'center', font: '600 15px system-ui', color: '#fff', textShadow: '0 1px 4px #000, 0 0 2px #000',
      });
      hud.append(copy, tag);
    });
    real.meter(null);
    release(real);
    return 'gallery drawn';
  };
  window.__clearGallery = () => {
    document.querySelectorAll('.galleryCopy').forEach((el) => el.remove());
    for (const el of document.getElementById('hud').children) {
      el.style.visibility = el.dataset.galleryWas ?? '';
      delete el.dataset.galleryWas;
    }
    return 'gallery cleared';
  };

  /** In a match: whenever a ball comes at us, the meter shows and points where it comes from. */
  window.__meterMatch = async (seconds = 15) => {
    const out = { framesWithBall: 0, meterShown: 0, worstAngleError: 0, states: new Set(), bearings: [] };
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      await frame();
      const t = dp.threat;
      if (!t || !dp.me?.alive || dp.settings.marker !== 'meter') continue;
      out.framesWithBall++;
      if (!document.getElementById('meter').classList.contains('on')) continue;
      out.meterShown++;
      const ux = t.b.pos.x - dp.local.x;
      const uz = t.b.pos.z - dp.local.z;
      const want = Math.atan2(-ux * Math.cos(dp.local.yaw) + uz * Math.sin(dp.local.yaw), ux * Math.sin(dp.local.yaw) + uz * Math.cos(dp.local.yaw));
      const got = tipOf().angle;
      const err = Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want)));
      out.worstAngleError = Math.max(out.worstAngleError, err);
      out.bearings.push(Math.abs(want));
      stripes().forEach((c) => out.states.add(c));
    }
    out.worstAngleError = `${((out.worstAngleError * 180) / Math.PI).toFixed(1)}°`;
    out.bearings.sort((a, b) => a - b);
    out.medianBearing = out.bearings.length ? `${Math.round((out.bearings[out.bearings.length >> 1] * 180) / Math.PI)}° from straight ahead` : null;
    delete out.bearings;
    out.colours = [...out.states];
    delete out.states;
    const problems = [];
    if (out.framesWithBall < 5) problems.push('no ball came at us');
    if (out.meterShown !== out.framesWithBall) problems.push('a ball came and the meter was not shown');
    if (parseFloat(out.worstAngleError) > 1) problems.push("the meter doesn't point at the ball");
    if (!out.colours.includes('#e9eef9') || out.colours.length < 2) problems.push("it didn't light up as balls came");
    return verdict(out, problems);
  };

  /** The R tile: usable, it gets 'ready' and pops once; not usable, back to normal. */
  window.__reviveTile = () => {
    const rev = document.getElementById('actRevive');
    const real = hold();
    const out = {};
    real.actions(dp.me, dp.cfg, 80, false, null);
    out.notUsable = rev.className;
    real.actions(dp.me, dp.cfg, 80, true, null);
    out.usable = rev.className;
    out.animations = getComputedStyle(rev).animationName;
    real.actions(dp.me, dp.cfg, 80, true, null);
    out.stillUsable = rev.className;
    real.actions(dp.me, dp.cfg, 80, false, null);
    out.notAgain = rev.className;
    real.actions(dp.me, dp.cfg, 80, true, null);       // for the picture
    window.__reviveHeld = real;
    const has = (k, c) => out[k].split(' ').includes(c);
    const problems = [];
    if (has('notUsable', 'ready') || !has('notUsable', 'no')) problems.push('not usable, it is marked ready');
    if (!has('usable', 'ready') || !has('usable', 'pop') || has('usable', 'no')) problems.push("usable, it isn't marked ready");
    if (!/actPop/.test(out.animations) || !/actReady/.test(out.animations)) problems.push("it doesn't pop and pulse");
    if (!has('stillUsable', 'ready')) problems.push('it lost ready while still usable');
    if (has('notAgain', 'ready') || has('notAgain', 'pop')) problems.push('it stays ready when no longer usable');
    return verdict(out, problems);
  };
  window.__reviveRelease = () => {
    release(window.__reviveHeld);
    return 'tile released';
  };
})();
