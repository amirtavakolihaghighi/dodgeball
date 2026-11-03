// Injected into the game page by athletes.json: the athletes (athlete.js) that replace the stick
// figures. Whether everyone is dressed, which head and look each got, what each costs to draw, the
// Low version, whether the athlete's hands and feet follow the stick figure's pose, and pictures
// from chosen places (the camera moved only while drawing, so the game itself is untouched).
(() => {
  const world = dp.world;
  const men = () => [...world.men.entries()].map(([id, man]) => ({ id, man }));
  const v3 = (o) => o.getWorldPosition(new o.position.constructor());
  const r2 = (x) => Math.round(x * 100) / 100;

  window.__athletes = () => {
    const t = world.athlete;
    const list = men().map(({ id, man }) => {
      const a = man.athlete;
      const shown = [];
      a?.model.traverse((o) => { if (o.isSkinnedMesh && o.visible) shown.push(o.name); });
      return { id, team: man.team, me: man.isMe, head: a?.head, look: a?.look, drawn: shown };
    });
    return JSON.stringify({
      loaded: !!t, triangles: t?.info.triangles, maps: t && Object.fromEntries(Object.entries(t.maps).map(([k, m]) => [k, m.size])),
      dressed: list.filter((m) => m.head).length, of: list.length, men: list,
      programs: world.renderer.info.programs.length, quality: world.quality,
    });
  };

  // Hold a player's state (my own: it stands still) in a pose: charging, a dodge, a catch, a deflect.
  const sync = world.syncPlayers.bind(world);
  window.__pose = null;
  world.syncPlayers = (players, dt) => {
    for (const s of players) if (window.__pose && s.id === window.__pose.id) Object.assign(s, window.__pose.state);
    return sync(players, dt);
  };
  const POSES = {
    idle: {},
    charging: { charging: true, charge: 1, hasBall: true },
    dodge: { act: 1, actAge: 0.12 },
    catch: { act: 2, actAge: 0.1 },
    deflect: { act: 3, actAge: 0.2 },
  };
  window.__hold = (pose) => {
    window.__pose = pose ? { id: dp.me.id, state: POSES[pose] } : null;
    return pose || 'released';
  };

  // Pictures from a chosen place: who ('me', 'helmet', 'face', 'red', 'blue': someone else first),
  // and from where around them ('front', 'back', 'side', 'face', 'top': from above and behind, 'hips': close, low).
  const render = world.render.bind(world);
  window.__cam = null;
  const pick = (who) => {
    const all = men();
    if (who === 'me') return all.find((m) => m.man.isMe);
    const others = all.filter((m) => !m.man.isMe);
    return others.find((m) => m.man.athlete?.head === who || ['red', 'blue'][m.man.team] === who) || others[0];
  };
  world.render = () => {
    const c = window.__cam;
    const m = c && pick(c.who);
    if (!m) return render();
    const cam = world.camera;
    const keep = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov };
    const r = m.man.root;
    const f = [Math.sin(r.rotation.y), Math.cos(r.rotation.y)];        // forward
    const l = [Math.cos(r.rotation.y), -Math.sin(r.rotation.y)];       // the athlete's left
    const at = (along, left, up) => [r.position.x + f[0] * along + l[0] * left, up, r.position.z + f[1] * along + l[1] * left];
    const views = {
      front: [at(3.2, 0.9, 1.3), at(0, 0, 0.95), 38], back: [at(-3.2, 0.7, 1.45), at(0, 0, 0.95), 38],
      side: [at(0.4, 3.3, 1.2), at(0, 0, 0.95), 38], face: [at(1.15, 0.3, 1.62), at(0, 0, 1.56), 30],
      top: [at(-1.4, 0, 3.4), at(0.3, 0, 0.3), 42], hips: [at(1.5, 0.2, 0.6), at(0, 0, 0.72), 28],
    };
    const [from, to, fov] = views[c.view];
    cam.position.set(...from);
    cam.lookAt(...to);
    cam.fov = fov;
    cam.updateProjectionMatrix();
    const others = men().filter((o) => o.man !== m.man && o.man.root.visible).map((o) => o.man.root);
    for (const o of others) o.visible = false;              // nobody walks in front
    render();
    for (const o of others) o.visible = true;
    cam.position.copy(keep.p);
    cam.quaternion.copy(keep.q);
    cam.fov = keep.fov;
    cam.updateProjectionMatrix();
  };
  window.__photo = (who, view = 'front') => {
    window.__cam = who ? { who, view } : null;
    document.getElementById('hud').style.opacity = who ? 0 : '';
    const m = who && pick(who);
    return who ? `${who} (${m?.man.athlete?.head}, team ${m?.man.team}) from the ${view}` : 'the game camera';
  };

  /** No foot under the floor (the moves' clips put the ankles about 7 cm up when a foot is down). */
  window.__follows = () => JSON.stringify(men().filter((m) => m.man.athlete).map(({ id, man }) => {
    const b = man.athlete.bones;
    const feet = ['L', 'R'].map((x) => v3(b[`foot_${x}`]).y - man.root.position.y);
    return { id, lowestAnkle: r2(Math.min(...feet)), alive: man.downT === 0 };
  }));

  /** Low graphics: the light meshes show instead, and the pictures still draw. */
  window.__low = (low) => {
    dp.graphics.choose(low ? 'low' : 'high');
    return dp.graphics.level;
  };
})();
