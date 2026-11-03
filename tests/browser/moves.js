// Injected after athletes.js by moves.json: the athletes' moves (athlete.js, step 8). Holds your
// own player (standing in the lobby's warm-up) in each move, at a chosen moment, so pictures can be
// taken of it: the state the game would have (charging, a dodge, ...), and the figure's timers. The
// timers are set a frame early (dt), because the frame moves them on before the pose is made.
(() => {
  const world = dp.world;
  const sync = world.syncPlayers.bind(world);
  window.__move = null;           // { state: {...}, man: {...}, athlete: {...} or (dt) => {...}, round: {...} }
  const TIMERS = ['throwT', 'hitT', 'spinT', 'reviveT', 'downT'];     // what update() moves on before the pose
  world.syncPlayers = (players, dt) => {
    const m = window.__move;
    const man = dp.me && world.man(dp.me.id);
    if (m && man) {
      for (const s of players) if (s.id === dp.me.id) Object.assign(s, typeof m.state === 'function' ? m.state(s, m) : m.state || {});
      for (const [k, v] of Object.entries(m.man || {})) man[k] = TIMERS.includes(k) ? Math.max(0, v - dt) : v;
      if (man.athlete) Object.assign(man.athlete, typeof m.athlete === 'function' ? m.athlete(dt) : m.athlete || {});
      if (m.round) world.round = m.round;
    }
    return sync(players, dt);
  };
  // an action held at one moment: the game's state and the athlete's own (action(): played on its own clock)
  const SPAN = (name) => world.timing.actions[name].window + world.timing.actions[name].recovery;
  const act = (kind, name, age, more = {}) => ({
    state: { act: kind, actAge: age, ...(more.state || {}) },
    athlete: (dt) => ({ act: { kind, age: age - dt, span: SPAN(name), fall: world.timing.actions[name].recovery, dodge: more.dodge || null, done: false } }),
  });
  const dodge = (kind, age) => act(1, 'dodge', age, { dodge: kind });
  // walking at a steady speed (m/s ahead and to the right), still facing ahead: the legs turn that way
  const walk = (ahead, right) => ({
    state: (s, m) => {
      const now = performance.now() / 1000;
      m.start ||= { t: now, x: s.x, z: s.z };
      const t = now - m.start.t;
      const f = [Math.sin(s.yaw), Math.cos(s.yaw)];          // ahead, and to the right: (-cos, sin) (world.js update)
      const r = [-Math.cos(s.yaw), Math.sin(s.yaw)];
      return { x: m.start.x + (f[0] * ahead + r[0] * right) * t, z: m.start.z + (f[1] * ahead + r[1] * right) * t };
    },
  });
  const MOVES = {
    stand: {},
    strafe_right: walk(0, 4),
    strafe_left: walk(0, -4),
    backpedal: walk(-3, 0),
    getup_moving: { ...walk(0, 4), man: { reviveT: 0.3 } },     // moving off while getting up: the run takes over
    windup_over: { state: { charging: true, charge: 1, hasBall: true }, athlete: { forceStyle: 'over' } },
    release_over: { state: { hasBall: false }, man: { throwT: 0.16 }, athlete: { style: 'over', forceStyle: 'over' } },
    windup_side: { state: { charging: true, charge: 1, hasBall: true }, athlete: { forceStyle: 'side' } },
    release_side: { state: { hasBall: false }, man: { throwT: 0.14 }, athlete: { style: 'side', forceStyle: 'side' } },
    windup_under: { state: { charging: true, charge: 1, hasBall: true }, athlete: { forceStyle: 'under' } },
    release_under: { state: { hasBall: false }, man: { throwT: 0.14 }, athlete: { style: 'under', forceStyle: 'under' } },
    parry_start: act(3, 'deflect', 0.03),
    parry: act(3, 'deflect', 0.155),
    parry_after: act(3, 'deflect', 0.24),
    catch: act(2, 'catch', 0.12),
    caught: { state: { hasBall: true }, man: { caughtT: 0.1 } },
    caught_in: { state: { hasBall: true }, man: { caughtT: 0.22 } },
    carry: { state: { hasBall: true } },
    dash_right: dodge('right', 0.12),
    land_right: dodge('right', 0.26),
    dash_left: dodge('left', 0.12),
    dash_forward: dodge('forward', 0.2),
    dash_back: dodge('back', 0.12),
    corkscrew: { man: { spinT: 0.22, lastGhost: 9 }, athlete: { acro: { kind: 'corkscrew', dir: 1 } } },
    sideflip: { man: { spinT: 0.2, lastGhost: 9 }, athlete: { acro: { kind: 'sideflip', dir: 1 } } },
    butterfly: { man: { spinT: 0.2, lastGhost: 9 }, athlete: { acro: { kind: 'butterfly', dir: 1 } } },
    backflip: { man: { spinT: 0.25, lastGhost: 9 }, athlete: { acro: { kind: 'backflip', dir: 1 } } },
    corkscrew_in_dash: {                                    // a perfect dodge comes during a dash: the acrobatic shows
      state: { act: 1, actAge: 0.15 }, man: { spinT: 0.22, lastGhost: 9 },
      athlete: (dt) => ({ ...act(1, 'dodge', 0.15, { dodge: 'right' }).athlete(dt), acro: { kind: 'corkscrew', dir: 1 } }),
    },
    ko_back: { state: { alive: false }, man: { downT: 0.9, hitInfo: { speed: 10 } }, athlete: { ko: null } },
    ko_fly: { state: { alive: false }, man: { downT: 0.55, hitInfo: { speed: 20 } }, athlete: { ko: null } },
    ko_tumble: { state: { alive: false }, man: { downT: 0.5, hitInfo: { speed: 30 } }, athlete: { ko: null } },
    lying: { state: { alive: false }, man: { downT: 2.0, hitInfo: { speed: 20 } } },
    getup: { man: { reviveT: 0.45 } },
    win: { round: { s: 'over', w: 0, n: 1 } },
    lose: { round: { s: 'over', w: 1, n: 1 } },
  };
  window.__hold2 = (name) => {
    const m = MOVES[name];
    if (!m) return `no move ${name}`;
    const man = world.man(dp.me.id);
    // a fresh start for what's picked once (the knockout's kind, the round's end, the throw's style)
    if (man?.athlete) {
      man.athlete.ko = null;
      man.athlete.win = null;
      man.athlete.forceStyle = null;
      man.athlete.act = null;
      man.athlete.rose = 9;                                // each held move gets up afresh
      man.athlete.w.end = name === 'win' || name === 'lose' ? 1 : 0;
    }
    m.start = null;
    window.__move = name === 'stand' ? null : m;
    if (name === 'stand') world.round = null;
    return name;
  };

  /** Where the hips face, from the bones (radians from where the player faces, + to the right). */
  const hipsTurn = (man) => {
    const a = man.athlete;
    const Q = a.bones.hips.quaternion.constructor;
    const rel = man.root.getWorldQuaternion(new Q()).invert().multiply(a.bones.hips.getWorldQuaternion(new Q()));
    rel.multiply(a.rest.restRot.hips.clone().invert());                       // the turn from the hips' rest
    const f = new a.bones.hips.position.constructor(0, 0, 1).applyQuaternion(rel);
    return +(-Math.atan2(f.x, f.z)).toFixed(2);                                // the model's +x is its left
  };

  /** Where the hands, feet, hips and head are (from your player's feet, in the world: x, height, z). */
  window.__where = () => JSON.stringify(where());
  const where = () => {
    const man = world.man(dp.me.id);
    const a = man.athlete;
    const p = (b) => {
      const v = a.bones[b].getWorldPosition(new a.bones[b].position.constructor());
      return [+(v.x - man.root.position.x).toFixed(2), +v.y.toFixed(2), +(v.z - man.root.position.z).toFixed(2)];
    };
    return { handR: p('hand_R'), handL: p('hand_L'), footL: p('foot_L'), footR: p('foot_R'), hips: p('hips'), head: p('head'),
      legYaw: +a.legYaw.toFixed(2), hipsTurn: hipsTurn(man), back: a.back, ko: a.ko, acro: a.acro?.kind, act: a.act && `${a.act.kind}@${a.act.age.toFixed(2)}`, dodge: a.act?.dodge, style: a.style, win: a.win, caughtBall: !!man.catchBall?.visible };
  };

  // Moves the user approved (docs/ANIMATIONS.md, status Locked): their key numbers at the held moment,
  // each [value, tolerance] or an exact value. A change that moves one prints FAIL, and the run fails.
  // 'hips.1' is the hips' height (the second of x, height, z).
  const LOCKS = {
    strafe_right: { rows: 'A6, A11', since: '2026-11-03', want: { legYaw: [1.3, 0.1], hipsTurn: [1.32, 0.15], back: false } },
    strafe_left: { rows: 'A7', since: '2026-11-03', want: { legYaw: [-1.3, 0.1], hipsTurn: [-1.29, 0.15], back: false } },
    strafe_after_back: { rows: 'A6, A11', since: '2026-11-03', want: { legYaw: [1.3, 0.1], hipsTurn: [1.32, 0.15], back: false } },
    corkscrew: { rows: 'F1, F2', since: '2026-11-03', want: { acro: 'corkscrew', 'hips.1': [1.48, 0.1], 'head.1': [1.07, 0.15] } },
    sideflip: { rows: 'F3', since: '2026-11-03', want: { acro: 'sideflip', 'hips.1': [1.51, 0.1], 'head.1': [1.31, 0.15] } },
    butterfly: { rows: 'F4', since: '2026-11-03', want: { acro: 'butterfly', 'hips.1': [1.51, 0.1], 'head.1': [1.4, 0.15], hipsTurn: [-1.68, 0.3] } },
    backflip: { rows: 'F5', since: '2026-11-03', want: { acro: 'backflip', 'hips.1': [1.53, 0.1], 'head.1': [1.09, 0.15] } },
    corkscrew_in_dash: { rows: 'J8', since: '2026-11-03', want: { acro: 'corkscrew', 'hips.1': [1.48, 0.1], 'head.1': [1.07, 0.15] } },
    getup: { rows: 'H1, H2', since: '2026-11-03', want: { 'hips.1': [0.29, 0.08], 'head.1': [0.64, 0.12] } },
    getup_moving: { rows: 'H1, H2, J11', since: '2026-11-03', want: { 'hips.1': [0.96, 0.12], legYaw: [1.3, 0.15] } },
  };
  /** Checks a locked move held right now: "locked ok" or a FAIL line naming what changed. */
  window.__lock = (name) => {
    const lock = LOCKS[name];
    if (!lock) return `FAIL no lock named ${name}`;
    const now = where();
    const bad = [];
    for (const [path, want] of Object.entries(lock.want)) {
      const [k, i] = path.split('.');
      const v = i === undefined ? now[k] : now[k]?.[Number(i)];
      const ok = Array.isArray(want) ? typeof v === 'number' && Math.abs(v - want[0]) <= want[1] : v === want;
      if (!ok) bad.push(`${path} is ${JSON.stringify(v)}, locked at ${Array.isArray(want) ? `${want[0]} ± ${want[1]}` : JSON.stringify(want)}`);
    }
    return bad.length
      ? `FAIL locked move ${name} (${lock.rows}, locked ${lock.since}) changed: ${bad.join('; ')}`
      : `locked ok: ${name} (${lock.rows})`;
  };
})();
