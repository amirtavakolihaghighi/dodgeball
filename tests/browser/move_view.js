// Injected by move_view.json: checks of the moves page (static/moves.html, move_view.js). Each
// window.__mv* returns lines; a line starting with FAIL fails the run (cdp.js).
(() => {
  const DT = 1 / 120;
  const errors = [];
  addEventListener('error', (e) => errors.push(e.message));
  addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
  const near = (v, want, tol) => typeof v === 'number' && Math.abs(v - want) <= tol;
  const check = (ok, text) => `${ok ? 'ok' : 'FAIL'} ${text}`;
  const at = (id, t) => {
    moveView.select(id, 0, false);
    moveView.seek(t);
    return moveView.where();
  };

  /** Every move the list has is a scene, every scene plays to its end and back, and the list came
   *  from docs/ANIMATIONS.md (its sections, the locked moves marked). */
  window.__mvAll = () => {
    const out = [];
    const ids = moveView.ids();
    const rows = [...document.querySelectorAll('#list button')];
    const playable = rows.filter((b) => !b.disabled).map((b) => b.querySelector('b').textContent);
    out.push(check(ids.every((id) => playable.includes(id)) && playable.length === ids.length, `the list plays every scene: ${playable.length} of ${ids.length}`));
    out.push(check(document.querySelectorAll('#list h2').length >= 10, `the list's sections from the docs: ${document.querySelectorAll('#list h2').length}`));
    const locked = rows.filter((b) => b.querySelector('.chip.Locked')).map((b) => b.querySelector('b').textContent);
    out.push(check(['A6', 'A7', 'A11', 'F1', 'F2', 'F3', 'F4', 'F5', 'H1', 'H2', 'J8', 'J11'].every((id) => locked.includes(id)), `Locked marked: ${locked.join(' ')}`));
    const broken = [];
    let slowest = 0;
    for (const id of ids) {
      try {
        moveView.select(id, 0, false);
        const L = moveView.state().length;
        const a = performance.now();
        moveView.seek(L);
        moveView.seek(L / 3);
        slowest = Math.max(slowest, performance.now() - a);
        if (!moveView.where()) broken.push(`${id}: no athlete`);
      } catch (e) {
        broken.push(`${id}: ${e.message}`);
      }
    }
    out.push(check(!broken.length, `every scene plays to its end and back${broken.length ? `: ${broken.join('; ')}` : ''} (the slowest: ${slowest.toFixed(0)} ms)`));
    return out.join('\n');
  };

  /** The same moment always looks the same: reached by playing on, or by going back (from the start
   *  again); a frame is two of the page's steps. */
  window.__mvSteps = () => {
    const out = [];
    for (const [id, t] of [['F2', 0.6], ['G4', 1.0], ['D7', 0.6], ['E1', 2.4]]) {
      moveView.select(id, 0, false);
      moveView.seek(t);
      const ahead = JSON.stringify(moveView.where());
      moveView.seek(t + 0.5);
      moveView.seek(t);
      const back = JSON.stringify(moveView.where());
      out.push(check(ahead === back, `${id} at ${t} s: the same played on and gone back to`));
    }
    moveView.select('D2', 0.5, false);
    const s0 = moveView.state().step;
    moveView.frames(1);
    const s1 = moveView.state().step;
    moveView.frames(-2);
    const s2 = moveView.state().step;
    out.push(check(s1 === s0 + 2 && s2 === s0 - 2, `a frame on and two back: steps ${s0} → ${s1} → ${s2}`));
    return out.join('\n');
  };

  // The locked moves (tests/browser/moves.js LOCKS): the page plays them as the game does. Its
  // moments: a perfect dodge 0.1 s into a dash at 0.30 s (spinT counts from that step), a revive at 0.30 s.
  window.__mvLocks = () => {
    const out = [];
    const want = (name, w, checks) => {
      const bad = checks.filter(([path, v, tol]) => {
        const [k, i] = path.split('.');
        const got = i === undefined ? w[k] : w[k]?.[Number(i)];
        return tol === undefined ? got !== v : !near(got, v, tol);
      });
      out.push(check(!bad.length, `${name}${bad.length ? `: ${bad.map(([p, v]) => `${p} is ${JSON.stringify(p.includes('.') ? w[p.split('.')[0]][p.split('.')[1]] : w[p])}, locked at ${v}`).join('; ')}` : ''}`));
    };
    want('A6 strafing right (locked)', at('A6', 0.7), [['legYaw', 1.3, 0.1], ['hipsTurn', 1.32, 0.15], ['back', false]]);
    want('A7 strafing left (locked)', at('A7', 0.7), [['legYaw', -1.3, 0.1], ['hipsTurn', -1.29, 0.15], ['back', false]]);
    want('A11 sideways after backing up runs forwards (locked)', at('A11', 2.6), [['legYaw', 1.3, 0.1], ['back', false]]);
    want('F2 corkscrew (locked)', at('F2', 0.4 + 0.22 - DT), [['acro', 'corkscrew'], ['hips.1', 1.48, 0.1], ['head.1', 1.07, 0.15]]);
    want('F3 side flip (locked)', at('F3', 0.4 + 0.2 - DT), [['acro', 'sideflip'], ['hips.1', 1.51, 0.1], ['head.1', 1.31, 0.15]]);
    want('F4 butterfly (locked)', at('F4', 0.4 + 0.2 - DT), [['acro', 'butterfly'], ['hips.1', 1.51, 0.1], ['head.1', 1.4, 0.15], ['hipsTurn', -1.68, 0.3]]);
    want('F5 backflip (locked)', at('F5', 0.4 + 0.25 - DT), [['acro', 'backflip'], ['hips.1', 1.53, 0.1], ['head.1', 1.09, 0.15]]);
    want('J8 a corkscrew in a dash (locked)', at('J8', 0.4 + 0.22 - DT), [['acro', 'corkscrew'], ['hips.1', 1.48, 0.1], ['head.1', 1.07, 0.15]]);
    want('H1 getting up (locked)', at('H1', 0.3 + 0.45), [['hips.1', 0.29, 0.08], ['head.1', 0.64, 0.12]]);
    want('J11 walking off during a get-up (locked)', at('J11', 4.6), [['hips.1', 0.96, 0.12], ['legYaw', 1.3, 0.15]]);
    // moves made here, against the game's own numbers (PROJECT.md step 8): printed, not locked
    const w = (id, t, keys) => {
      const v = at(id, t);
      return `${id} at ${t} s: ${keys.map((k) => `${k} ${JSON.stringify(v[k])}`).join(', ')}`;
    };
    out.push(w('C4', 1.5, ['handR']), w('D2', 0.54, ['handL']), w('D5', 0.5, ['handL']), w('E2', 0.42, ['footR', 'footL']), w('E4', 0.5, ['footL', 'hips']), w('G6', 1, ['hips']), w('I2', 2, ['hips']));
    return out.join('\n');
  };

  /** The timeline: D2's press, its window and recovery, and the parry's key moments. */
  window.__mvMarks = () => {
    moveView.select('D2', 0, false);
    const m = moveView.marks();
    const win = m.bands.find((b) => b.label === 'window');
    const rec = m.bands.find((b) => b.label === 'recovery');
    const press = m.events.find((e) => e.label === 'deflect');
    const out = [
      check(press && near(press.t, 0.3, 1e-6), `the deflect pressed at ${press?.t}`),
      check(win && near(win.t0, 0.3, 1e-6) && near(win.t1, 0.48, 1e-6) && rec && near(rec.t1, 0.78, 1e-6), `its window ${win?.t0}–${win?.t1} s, recovery to ${rec?.t1} s`),
      check(m.keys.length === 5 && [0.12, 0.32, 0.5, 0.6, 0.75].every((u, i) => near(m.keys[i].t, 0.3 + u * 0.48, 1e-6)), `the parry's key moments (hand 0.12, 0.32, 0.5, 0.75; chest 0.6 of the move): ${m.keys.map((k) => k.t.toFixed(3)).join(', ')}`),
      check(document.querySelectorAll('#timeline .band').length === m.bands.length && document.querySelectorAll('#timeline .key').length === m.keys.length, 'all of them drawn'),
    ];
    return out.join('\n');
  };

  /** The timings: a longer deflect window stretches the scene, and the defaults bring it back. */
  window.__mvTimings = () => {
    moveView.select('D2', 0, false);
    const before = moveView.state().length;
    const input = [...document.querySelectorAll('#timingFields label')].find((l) => l.textContent.startsWith('Deflect window')).querySelector('input');
    input.value = '0.3';
    input.dispatchEvent(new Event('change'));
    const win = moveView.marks().bands.find((b) => b.label === 'window');
    const after = moveView.state().length;
    const link = moveView.link();
    document.getElementById('defaultTimingBtn').click();
    const back = moveView.state().length;
    return [
      check(near(win.t1 - win.t0, 0.3, 1e-6) && near(after - before, 0.12, 0.01), `the window 0.3 s: the scene ${before} → ${after} s`),
      check(/&timing=0\.22,14,0\.32,0\.15,0\.3,0\.25,0\.3,0\.3,0\.9,6,4,2\.5,1\.6/.test(link), `the link carries them: ${link.split('#')[1]}`),
      check(near(back, before, 1e-6) && moveView.state().timing === 'defaults', `the defaults again: ${back} s`),
    ].join('\n');
  };

  /** The switches: Low draws the light bodies, Face the face, Blue the blue kit. */
  window.__mvSwitches = () => {
    const man = () => moveView.world.man(1);
    moveView.select('A2', 0.5, false);
    const vis = (size) => man().athlete.meshes[size].every((m) => m.visible);
    document.querySelector('[data-low="1"]').click();
    const low = vis('lo') && !man().athlete.meshes.hi.some((m) => m.visible);
    document.querySelector('[data-low="0"]').click();
    document.querySelector('[data-head="face"]').click();
    const face = man().athlete.head === 'face';
    document.querySelector('[data-head="helmet"]').click();
    document.querySelector('[data-team="1"]').click();
    const blue = man().team === 1;
    const facing = man().root.rotation.y;
    document.querySelector('[data-team="0"]').click();
    return [
      check(low, 'Low: the light meshes show'), check(face, 'Face: the face version'),
      check(blue && near(facing, -Math.PI / 2, 1e-6), `Blue: the blue team, facing the red half (${facing.toFixed(3)})`),
      check(man().team === 0 && man().athlete.head === 'helmet' && vis('hi'), 'and back to red, the helmet, High'),
    ].join('\n');
  };

  /** A moment as a link: kept for after the reload, checked by __mvLinkBack. */
  window.__mvLink = () => {
    moveView.select('E2', 0.42, false);
    moveView.cam('left');
    const link = moveView.link();
    sessionStorage.setItem('mvLink', JSON.stringify({ link, state: moveView.state(), where: moveView.where() }));
    setTimeout(() => {
      location.href = link;
      location.reload();
    }, 50);
    return check(/#E2@0\.417&cam=left$/.test(link), `the link: ${link.split('/static/')[1]}`);
  };
  window.__mvLinkBack = () => {
    const was = JSON.parse(sessionStorage.getItem('mvLink') || 'null');
    if (!was) return 'FAIL nothing kept before the reload';
    const now = moveView.state();
    const same = JSON.stringify(moveView.where()) === JSON.stringify(was.where);
    return [
      check(now.id === 'E2' && now.step === was.state.step && !now.playing && now.cam === 'left', `opened at ${now.id} ${now.t} s (step ${now.step}), paused, camera ${now.cam}`),
      check(same, 'the same pose as before the reload'),
    ].join('\n');
  };

  /** Every scene's every step, as a fingerprint of the athlete's pose (each bone's turn, the hips'
   *  place, where the figure stands and faces, its shudder and fall, the balls in its hands), to the
   *  last bit. move_print.json prints them: a change that must not alter any move (moving numbers
   *  into a file, tidying the code) prints the same before and after. */
  window.__mvFingerprint = (ids = moveView.ids()) => {
    const out = [];
    const buf = new Float64Array(96);
    const words = new Uint32Array(buf.buffer);
    for (const id of ids) {
      moveView.select(id, 0, false);
      const last = Math.round(moveView.state().length / DT);
      let h1 = 0x811c9dc5;
      let h2 = 0x2545f491;
      for (let n = 0; n <= last; n++) {
        moveView.seek(n * DT);
        const man = moveView.world.man(1);
        const a = man.athlete;
        let i = 0;
        for (const b of Object.values(a.bones)) {
          const q = b.quaternion;
          buf[i++] = q.x;
          buf[i++] = q.y;
          buf[i++] = q.z;
          buf[i++] = q.w;
        }
        const hp = a.bones.hips.position;
        buf[i++] = hp.x;
        buf[i++] = hp.y;
        buf[i++] = hp.z;
        buf[i++] = man.root.position.x;
        buf[i++] = man.root.position.z;
        buf[i++] = man.root.rotation.y;
        buf[i++] = man.body.position.x;
        buf[i++] = man.body.position.y;
        buf[i++] = man.body.position.z;
        buf[i++] = a.model.rotation.y;
        buf[i++] = man.held.visible ? 1 : 0;
        buf[i++] = man.catchBall?.visible ? 1 : 0;
        for (let j = 0; j < i * 2; j++) {
          h1 = Math.imul(h1 ^ words[j], 16777619);
          h2 = Math.imul(h2 ^ words[j], 0x5bd1e995) ^ (h2 >>> 15);
        }
      }
      out.push(`${id} ${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')} (${last + 1} steps)`);
    }
    return out.join('\n');
  };

  // ---------------------------------------------------------------- the editor (move_edit.json)
  const E = () => moveView.edit;
  const frames = (k = 3) => new Promise((done) => {
    const f = () => (k-- > 0 ? requestAnimationFrame(f) : done());
    f();
  });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const angle = (a, b) => {
    const n = (v) => Math.hypot(...v);
    return (Math.acos(clampDot(a.reduce((s, x, i) => s + x * b[i], 0) / (n(a) * n(b)))) * 180) / Math.PI;
  };
  const clampDot = (v) => Math.max(-1, Math.min(1, v));
  /** The pose (where()) at t of a scene, with the moves as they are now (after the editor's own
   *  jump to its picked key moment, which picking a scene makes). */
  const poseAt = async (id, t) => {
    moveView.select(id, 0, false);
    await frames(2);
    moveView.seek(t);
    return moveView.where();
  };

  /** Finding the editor: the button on every move (gold where it can change it, greyed elsewhere),
   *  and the 17 moves placed by hand marked in the list, found by typing "edit". */
  window.__mvEditFind = () => {
    const btn = document.getElementById('editBtn');
    moveView.select('A1', 0, false);
    const a1Title = btn.title;
    const onA1 = !btn.hidden && btn.disabled && /B1, B2, C4–C7, D1–D7, E2–E5/.test(a1Title);
    moveView.select('D2', 0, false);
    const onD2 = !btn.hidden && !btn.disabled && getComputedStyle(btn).fontWeight === '700';
    const marked = [...document.querySelectorAll('#list button')].filter((b) => b.querySelector('.chip.edit')).map((b) => b.querySelector('b').textContent);
    const filter = document.getElementById('filter');
    filter.value = 'edit';
    filter.dispatchEvent(new Event('input'));
    const shown = [...document.querySelectorAll('#list button')].filter((b) => !b.hidden).length;
    filter.value = '';
    filter.dispatchEvent(new Event('input'));
    return [
      check(onA1, `on A1 (a clip) the button shows, greyed: "${a1Title}"`),
      check(onD2, 'on D2 (placed by hand) it shows, gold'),
      check(marked.join(' ') === 'B1 B2 C4 C5 C6 C7 D1 D2 D3 D4 D5 D6 D7 E2 E3 E4 E5', `the list marks ${marked.length}: ${marked.join(' ')}`),
      check(shown === 17, `typing "edit" in the find box lists them: ${shown}`),
    ].join('\n');
  };

  /** The editor: each kind of change shows on the athlete, and Undo brings back exactly what was. */
  window.__mvEdit = async () => {
    const out = [];
    localStorage.removeItem('dp.movesDraft');
    const start = JSON.stringify(E().made());

    // D2: the parry's hand, its 2nd key moment (across the chest), moved 5 cm up with its handle
    moveView.select('D2', 0, false);
    E().open();
    E().choose('hand', 1);
    await frames();
    const t1 = moveView.state().t;
    const was = E().value('hand', 1)[1];
    const handBefore = moveView.where().handL;
    out.push(check(E().state().handle === 'translate' && near(t1, 0.3 + 0.12 * 0.48, DT / 2 + 1e-6),
      `picking it goes to its moment (${t1} s) and shows the arrows`));
    E().drag(0, 0.05, 0);
    await frames();
    const now = E().value('hand', 1)[1];
    const handAfter = moveView.where().handL;
    out.push(check(now[0] === was[0] && near(now[1], was[1] + 0.05, 1e-9) && now[2] === was[2] && E().state().undo === 1 && E().state().changed,
      `the key's place: ${JSON.stringify(was)} → ${JSON.stringify(now)}`));
    out.push(check(near(handAfter[1] - handBefore[1], 0.05, 0.01), `the athlete's left hand follows it up: ${JSON.stringify(handBefore)} → ${JSON.stringify(handAfter)}`));
    E().undo();
    await frames();
    out.push(check(same(E().value('hand', 1)[1], was) && same(moveView.where().handL, handBefore) && !E().state().changed && E().state().redo === 1,
      'Undo: the same numbers and the same pose as before'));
    E().redo();
    await frames();
    out.push(check(same(E().value('hand', 1)[1], now) && same(moveView.where().handL, handAfter), 'Redo: the change again'));
    E().undo();

    // retiming the 3rd key moment: the hand's place and turn move together; the timeline's marks too
    E().retime('hand', 2, 0.36);
    await frames();
    let M = E().made().PARRY_L;
    out.push(check([M.hand, M.fingers, M.palm].every((tr) => tr[2][0] === 0.36) && moveView.marks().keys.some((k) => near(k.t, 0.3 + 0.36 * 0.48, 1e-6)),
      'a key moment retimed (0.32 → 0.36 of the move): its place and its turn, and the timeline\'s mark'));
    E().undo();

    // a key moment added to the chest's turn where the scene is (nothing moves), then deleted
    const tAdd = 0.3 + 0.45 * 0.48;
    const before = await poseAt('D2', tAdd);
    E().choose('chest', 1);
    await frames();
    moveView.seek(tAdd);
    const added = E().addKey('chest', 0.45);
    await frames();
    const withKey = moveView.where();
    M = E().made().PARRY_L;
    const moved = Math.max(...['handL', 'head', 'hips'].flatMap((k) => withKey[k].map((v, i) => Math.abs(v - before[k][i]))));
    out.push(check(added && M.chest.length === 6 && M.chest[3][0] === 0.45 && moved < 0.01,
      `a key moment added at 0.45 of the move: ${M.chest.length} keys, the pose there moved ${(moved * 100).toFixed(2)} cm`));
    E().deleteKey('chest', 3);
    await frames();
    out.push(check(E().made().PARRY_L.chest.length === 5 && same(moveView.where(), before), 'deleted: the 5 keys and the very same pose'));
    out.push(check(!E().deleteKey('chest', 0) && !E().deleteKey('chest', 4), "the first and last key moments can't be deleted"));
    E().undo();
    E().undo();
    await frames();
    out.push(check(JSON.stringify(E().made()) === start, 'both undone: the file as it was'));

    // passing through a key: the same pose at the key, another in between
    const atKey = 0.3 + 0.32 * 0.48;
    const between = 0.3 + 0.41 * 0.48;
    const k0 = await poseAt('D2', atKey);
    const b0 = await poseAt('D2', between);
    E().choose('hand', 2);
    E().ease('hand', 2, true);
    M = E().made().PARRY_L;
    const k1 = await poseAt('D2', atKey);
    const b1 = await poseAt('D2', between);
    const dKey = Math.max(...k1.handL.map((v, i) => Math.abs(v - k0.handL[i])));
    const dMid = Math.max(...b1.handL.map((v, i) => Math.abs(v - b0.handL[i])));
    out.push(check([M.hand, M.fingers, M.palm].every((tr) => tr[2][2] === 'pass') && dKey < 0.01 && dMid > 0.005,
      `"Keeps moving": the hand moves through the key (${(dKey * 100).toFixed(1)} cm off at it, ${(dMid * 100).toFixed(1)} cm off between keys)`));
    E().undo();

    // the blend out, typed: the move's end changes
    const late = 0.3 + 0.48 - 0.06;
    const e0 = await poseAt('D2', late);
    E().blend('out', 0.3);
    const e1 = await poseAt('D2', late);
    out.push(check(E().made().PARRY_L.blend.out === 0.3 && !same(e0.handL, e1.handL), `blend out 0.3 s: the hand later in the move ${JSON.stringify(e0.handL)} → ${JSON.stringify(e1.handL)}`));
    E().undo();

    // the chest's turn, typed in degrees
    E().choose('chest', 2);
    await frames();
    E().angle(20);
    out.push(check(E().value('chest', 2)[1] === 0.349, `the chest's turn at its 3rd key: 20° = ${E().value('chest', 2)[1]} rad`));
    E().undo();

    // how far the hand is from its ball: the parry's widest moment falls short in the guard (the viewer's finding)
    E().choose('hand', 2);
    await frames();
    const short = E().reach();
    out.push(check(/^The hand is \d+ cm from its ball/.test(short), `at the parry's 3rd key moment: "${short}"`));

    // the elbow, where the arm is bent (the guard: the forearm across the face): its ball dragged up, the elbow follows
    moveView.select('D1', 0, false);
    E().choose('elbow');
    await frames();
    const pole0 = E().value('elbow');
    const el0 = moveView.world.man(1).athlete.bones.fore_L.getWorldPosition(new moveView.world.camera.position.constructor()).toArray();
    E().drag(0, 0.15, 0);
    await frames();
    const el1 = moveView.world.man(1).athlete.bones.fore_L.getWorldPosition(new moveView.world.camera.position.constructor()).toArray();
    const elbowMoved = Math.hypot(...el1.map((v, i) => v - el0[i]));
    out.push(check(!same(E().value('elbow'), pole0) && elbowMoved > 0.01, `the elbow's way ${JSON.stringify(pole0)} → ${JSON.stringify(E().value('elbow'))}: the elbow moved ${(elbowMoved * 100).toFixed(1)} cm`));
    E().undo();

    // D5, the catch: the hand turned 30° about its fingers with the rings
    moveView.select('D5', 0, false);
    E().choose('hand');
    await frames();
    const C0 = E().made().CATCH_L;
    E().turn(30);
    await frames();
    const C1 = E().made().CATCH_L;
    const square = (palm, f) => {          // the palm as the hand holds it: square to the fingers
      const n = Math.hypot(...f);
      const k = palm.reduce((s, x, i) => s + (x * f[i]) / n, 0);
      return palm.map((x, i) => x - (k * f[i]) / n);
    };
    const palmTurn = angle(square(C0.palm, C0.fingers), square(C1.palm, C1.fingers));
    out.push(check(angle(C0.fingers, C1.fingers) < 1 && near(palmTurn, 30, 1),
      `the hand turned: the fingers ${angle(C0.fingers, C1.fingers).toFixed(1)}° off, the palm ${palmTurn.toFixed(1)}°`));
    E().undo();
    moveView.select('D1', 0, false);
    E().choose('hand');
    await frames();
    out.push(check(E().reach() === '', "the guard's hand reaches its ball: no note"));

    // the dashes: E3 (left) mirrors E2 (right). E2's leading foot 5 cm further out moves E3's too
    const lead = (await poseAt('E3', 0.3 + 0.75 * 0.22)).footL;
    moveView.select('E2', 0, false);
    E().choose('lead', 2);
    await frames();
    const r0 = moveView.where().footR;
    E().drag(-0.05, 0, 0);                  // to its right: towards the dash
    await frames();
    const r1 = moveView.where().footR;
    const lead1 = (await poseAt('E3', 0.3 + 0.75 * 0.22)).footL;
    out.push(check(E().made().DASH_SIDE.lead[2][1][0] === 0.38 && near(r1[0] - r0[0], -0.05, 0.01) && near(lead1[0] - lead[0], 0.05, 0.01),
      `E2's leading foot 5 cm further out (x ${r0[0]} → ${r1[0]}), and E3's, mirrored (x ${lead[0]} → ${lead1[0]})`));
    E().undo();
    await frames();
    out.push(check(JSON.stringify(E().made()) === start && !E().state().changed, 'all undone: the file as it was, no changes'));

    // saving: off on a test server (--fresh), and the page says why
    const off = await E().save();
    out.push(check(!off && E().state().saving?.can === false && /--fresh/.test(document.getElementById('editStatus').textContent),
      `Save is off here: ${document.getElementById('editStatus').textContent}`));
    E().close();
    await frames();
    out.push(check(!E().state().open && E().state().handle === null && document.getElementById('edit').hidden, 'closed: no panel, no handles'));
    return out.join('\n');
  };

  /** Save, as the host's computer would (the server's answer stood in for: tests never write the file). */
  window.__mvEditSave = async () => {
    const out = [];
    moveView.select('B1', 0, false);
    E().open();
    E().choose('hand');
    await frames();
    E().drag(0.02, 0, 0);
    E().pretendSaving();
    const real = window.fetch;
    let sent = null;
    window.fetch = async (url, opts) => {
      if (url !== '/moves/save') return real(url, opts);
      sent = JSON.parse(opts.body);
      return new Response(JSON.stringify({ ok: true, kept: 'move_saves/made_moves_test.json', made: sent }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const ok = await E().save();
    window.fetch = real;
    const status = document.getElementById('editStatus').textContent;
    out.push(check(ok && sent?.CARRY_R.hand[0] === -0.22 && !E().state().changed && /Saved at/.test(status) && /move_saves\/made_moves_test\.json/.test(status) && !localStorage.getItem('dp.movesDraft'),
      `saved: the file sent with the change (the hand at x ${sent?.CARRY_R.hand[0]}); "${status}"`));
    E().close();
    return out.join('\n');
  };

  /** Unsaved changes stay in the browser: after a reload the page offers them back. */
  window.__mvEditDraft = async () => {
    moveView.select('D5', 0, false);
    E().open();
    E().choose('hand');
    await frames();
    E().drag(0, 0, -0.04);
    const kept = JSON.parse(localStorage.getItem('dp.movesDraft') || 'null');
    sessionStorage.setItem('mvDraft', JSON.stringify(E().value('hand')));
    E().noAsking();                          // no "Leave site?" question: nobody's there to answer it
    setTimeout(() => location.reload(), 50);
    return check(kept && JSON.parse(kept.now).CATCH_L.hand[2] === 0.56, `an unsaved change kept in the browser (the catch's hand 4 cm nearer: z ${kept && JSON.parse(kept.now).CATCH_L.hand[2]})`);
  };
  window.__mvEditDraftBack = async () => {
    const out = [];
    const note = document.getElementById('draftNote');
    out.push(check(!note.hidden && !E().state().changed, `after the reload: the saved file, and the offer "${document.getElementById('draftText').textContent}"`));
    document.getElementById('draftBackBtn').click();
    await frames();
    out.push(check(E().state().open && E().state().changed && same(E().made().CATCH_L.hand, JSON.parse(sessionStorage.getItem('mvDraft'))) && note.hidden,
      `"Bring them back": the change again (${JSON.stringify(E().made().CATCH_L.hand)}), the editor open`));
    E().revert();
    await frames();
    out.push(check(!E().state().changed && !localStorage.getItem('dp.movesDraft'), '"Back to saved": no changes, nothing kept in the browser'));
    E().close();
    return out.join('\n');
  };

  /** A real mouse drag of a handle (the arrows' centre, which moves in the picture's plane): the
   *  hand goes up, the camera stays where it was. Then a key moment dragged along the timeline. */
  window.__mvEditMouseSetup = async () => {
    moveView.select('D1', 0, false);
    moveView.cam('front');
    E().open();
    E().choose('hand');
    await frames(4);
    window.__mvMouse = { at: E().screen('hand'), value: E().value('hand'), cam: moveView.world.camera.position.toArray(), undo: E().state().undo };
    return `the guard's hand on the screen at ${Math.round(__mvMouse.at.x)}, ${Math.round(__mvMouse.at.y)}`;
  };
  window.__mvEditMouseCheck = async () => {
    await frames();
    const v = E().value('hand');
    const cam = moveView.world.camera.position.toArray();
    const out = [
      check(v[1] > __mvMouse.value[1] + 0.02 && E().state().undo === __mvMouse.undo + 1, `dragged up 40 px: the guard's hand ${JSON.stringify(__mvMouse.value)} → ${JSON.stringify(v)}`),
      check(same(cam, __mvMouse.cam), 'the camera stayed where it was'),
    ];
    E().undo();
    moveView.select('D2', 0, false);
    E().choose('hand', 2);
    await frames();
    const d = document.querySelector('#timeline .erow[data-part="hand"] .ekey[data-i="2"]').getBoundingClientRect();
    window.__mvKeyAt = { x: d.left + d.width / 2, y: d.top + d.height / 2, undo: E().state().undo };
    const under = document.elementFromPoint(__mvKeyAt.x, __mvKeyAt.y);
    out.push(check(under?.classList.contains('ekey'), `the 3rd key moment of the hand's row is under the mouse (${under?.className})`));
    return out.join('\n');
  };
  window.__mvEditKeyCheck = async () => {
    await frames();
    const u = E().keys('hand')[2];
    const M = E().made().PARRY_L;
    const out = [check(u > 0.34 && u < 0.5 && M.fingers[2][0] === u && M.palm[2][0] === u && E().state().undo === __mvKeyAt.undo + 1,
      `the 3rd key moment dragged later on the timeline: 0.32 → ${u} of the move (its turn with it)`)];
    E().undo();
    await frames();
    out.push(check(E().keys('hand')[2] === 0.32, 'undone'));
    E().close();
    return out.join('\n');
  };

  window.__mvErrors = () => check(!errors.length, errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
  return 'move_view checks ready';
})();
