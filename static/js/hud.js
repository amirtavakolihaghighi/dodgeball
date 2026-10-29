// DOM HUD: bars, round info, name tags, timing ring, popups, kill feed and scoreboard.
// Player names only ever go in through textContent.

const $ = (id) => document.getElementById(id);
export const TEAM = ['RED', 'BLUE'];
export const TEAM_CLASS = ['red', 'blue'];

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Where health regeneration stops for a pool of `full` health, or null when it's off
 *  (r: cfg.regen or cfg.teamRegen). The twin of rules.Rules.regen_limit. */
export const regenLimit = (r, full) => (!r?.on ? null : r.mode === 'share' ? (full * r.share) / 100 : Math.min(r.amount, full));

/** The marker on a health bar at the regeneration limit (hidden when there is none); fromRight:
 *  the bar fills from its right edge (BLUE's team bar). */
function placeLimit(el, limit, full, fromRight = false) {
  el.style.display = limit === null || full <= 0 ? 'none' : 'block';
  if (limit !== null && full > 0) el.style[fromRight ? 'right' : 'left'] = `${Math.min(1, limit / full) * 100}%`;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export class Hud {
  constructor() {
    this.root = $('hud');
    this.tags = new Map();
    this.pipSig = ['', ''];
    this.bannerUntil = 0;
    this.lastScoreSig = '';
    this.liveSig = '';
  }

  show(on) {
    this.root.hidden = !on;
  }

  setRound(r, players, myId) {
    setText($('scoreRed'), String(r.score[0]));
    setText($('scoreBlue'), String(r.score[1]));
    const label = { lobby: 'LOBBY', wait: 'WAITING FOR PLAYERS', count: `ROUND ${r.n}`, play: `ROUND ${r.n}`, over: `ROUND ${r.n} OVER` }[r.s];
    setText($('roundLabel'), label);
    const goal = r.win ? ` · TO ${r.win}` : '';
    setText($('roundTime'), r.s === 'play' ? fmtTime(r.left) : r.s === 'count' ? 'GET READY' : r.s === 'lobby' ? 'WARM-UP' : r.s === 'wait' ? '—' : '');
    setText($('roundGoal'), r.s === 'lobby' ? '' : goal);
    [0, 1].forEach((team) => {
      const members = [...players.values()].filter((p) => p.team === team).sort((a, b) => a.id - b.id);
      const sig = members.map((p) => `${p.id}${p.alive ? 'a' : 'd'}`).join(',');
      if (sig === this.pipSig[team]) return;
      this.pipSig[team] = sig;
      const box = $(team ? 'pipsBlue' : 'pipsRed');
      box.replaceChildren(...members.map((p) => {
        const i = document.createElement('i');
        if (!p.alive) i.classList.add('out');
        if (p.id === myId) i.classList.add('me');
        i.title = p.name;
        return i;
      }));
    });
  }

  /** Team health: each team's shared bar, th = [[health, size], [health, size]], or null when it's
   *  off; regen: cfg.teamRegen, for the marker where the bar's regeneration stops. */
  setTeamHealth(th, regen) {
    $('topbar').classList.toggle('teamhp', !!th);
    if (!th) return;
    th.forEach(([hp, size], team) => {
      const bar = $(team ? 'thBlue' : 'thRed');
      bar.querySelector('i').style.width = `${size > 0 ? Math.max(0, Math.min(1, hp / size)) * 100 : 0}%`;
      bar.classList.toggle('low', size > 0 && hp / size < 0.3);
      placeLimit(bar.querySelector('b'), regenLimit(regen, size), size, team === 1);
      setText(bar.querySelector('span'), `${hp} / ${size}`);
    });
  }

  setIdentity(name, team) {
    setText($('myName'), name);
    const t = $('myTeam');
    setText(t, TEAM[team] ?? 'SPECTATING');
    t.className = TEAM_CLASS[team] ?? '';
  }

  /** Spectating: no body, so no vitals, ball, actions or crosshair. */
  setWatching(on) {
    this.root.classList.toggle('watching', on);
  }

  /** bar: with team health, my team's [health, size]: my health bar shows that instead. The
   *  marker on it shows where regeneration stops, when it's on. */
  setVitals(me, cfg, cost, bar = null) {
    const [hp, size] = bar ?? [Math.max(0, me.hp), cfg.maxHp];
    $('hpFill').style.width = `${size > 0 ? Math.min(1, hp / size) * 100 : 0}%`;
    $('hpFill').parentElement.classList.toggle('low', hp < 0.35 * size);
    placeLimit($('hpLimit'), regenLimit(bar ? cfg.teamRegen : cfg.regen, size), size);
    setText($('hpText'), bar ? `TEAM ${Math.round(hp)} / ${size}` : `${Math.round(hp)} HP`);
    const st = me.stamina;
    $('stFill').style.width = `${(st / cfg.maxStamina) * 100}%`;
    setText($('stText'), `${Math.floor(st)} STAMINA`);
    const costEl = $('stCost');
    if (cost > 0) {
      costEl.style.display = 'block';
      costEl.style.left = `${(Math.max(0, st - cost) / cfg.maxStamina) * 100}%`;
      costEl.style.width = `${(Math.min(cost, st) / cfg.maxStamina) * 100}%`;
    } else costEl.style.display = 'none';
    setText($('cash'), `◆ ${me.cash} ${cfg.teamCash ? 'team cash' : 'cash'}`);
  }

  /** hint: [text, 'on' | ''] about standing still and regeneration, or null for none. */
  setRegenHint(hint) {
    const el = $('regenState');
    el.hidden = !hint;
    if (!hint) return;
    setText(el, hint[0]);
    if (el.className !== hint[1]) el.className = hint[1];
  }

  flashStamina() {
    const bar = $('stFill').parentElement;
    bar.classList.remove('flash');
    void bar.offsetWidth;
    bar.classList.add('flash');
  }

  setThrow(t) {
    const state = $('ballState');
    const fill = $('powerFill');
    $('throwbox').style.visibility = t.alive ? 'visible' : 'hidden';
    if (t.charging) {
      setText(state, `${Math.round(t.speed)} m/s  ·  ~${t.damage} dmg  ·  ${Math.round(t.cost)} stamina`);
      state.className = 'ready';
      fill.style.width = `${t.power * 100}%`;
    } else if (t.hasBall) {
      setText(state, 'BALL READY · hold LMB to charge');
      state.className = 'ready';
      fill.style.width = '0%';
    } else {
      setText(state, `NEW BALL IN ${t.cooldown.toFixed(1)}s`);
      state.className = '';
      fill.style.width = `${(1 - t.cooldown / t.cooldownMax) * 100}%`;
    }
  }

  /** price: what R costs now (a revive, or with team health a health pack; 0: all your cash). */
  setActions(me, cfg, price, canSpend, active) {
    for (const [kind, id] of [['dodge', 'actDodge'], ['catch', 'actCatch'], ['deflect', 'actDeflect']]) {
      const spec = cfg.actions[kind];
      const el = $(id);
      setText(el.querySelector('span'), `${spec.cost} st · perfect ${spec.perfect_cost}`);
      el.classList.toggle('no', !me.alive || me.stamina < spec.cost);
      el.classList.toggle('live', active === kind);
    }
    const rev = $('actRevive');
    const heal = cfg.teamHealth;
    setText(rev.querySelector('b'), heal ? 'Team health' : 'Revive');
    setText(rev.querySelector('span'), !heal ? `${price} cash`
      : cfg.teamHeal.mode === 'pack' ? `+${cfg.teamHeal.amount} · ${price} cash` : `all cash · ${cfg.teamHeal.perCash}/cash`);
    rev.classList.toggle('no', !canSpend);
  }

  setTags(list) {
    const box = $('tags');
    const seen = new Set();
    for (const t of list) {
      seen.add(t.id);
      let el = this.tags.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.innerHTML = '<div class="n"></div><div class="b hp"><i></i></div><div class="b st"><i></i></div>';
        box.appendChild(el);
        this.tags.set(t.id, el);
      }
      // hp: a share of their own health, or null with team health (the team's bar is at the top)
      const cls = `tag3d ${TEAM_CLASS[t.team]}${t.hp !== null && t.hp < 35 ? ' low' : ''}`;
      if (el.className !== cls) el.className = cls;
      setText(el.firstChild, t.name);
      el.children[1].hidden = t.hp === null;
      el.children[1].firstChild.style.width = `${t.hp ?? 0}%`;
      el.children[2].firstChild.style.width = `${t.stamina}%`;
      el.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px)`;
    }
    for (const [id, el] of this.tags) {
      if (!seen.has(id)) {
        el.remove();
        this.tags.delete(id);
      }
    }
  }

  setAssist(pos, kind) {
    const el = $('assist');
    el.className = pos ? kind : '';
    if (pos) el.style.transform = `translate(${pos.x.toFixed(1)}px, ${pos.y.toFixed(1)}px) rotate(45deg)`;
  }

  /** t: {radius, level: '' | 'near' | 'now', arrow: radians | null, text} or null */
  setThreat(t) {
    const ring = $('ring');
    setText($('threatText'), t ? t.text : '');
    if (!t || t.radius <= 0) {
      ring.className = '';
      return;
    }
    ring.className = `on ${t.level}`;
    const size = t.radius * 2;
    ring.style.width = ring.style.height = `${size}px`;
    ring.style.margin = `${-t.radius}px 0 0 ${-t.radius}px`;
    const arrow = $('ringArrow');
    arrow.style.display = t.arrow === null ? 'none' : 'block';
    if (t.arrow !== null) {
      arrow.style.transformOrigin = `8px ${t.radius + 12}px`;
      arrow.style.transform = `rotate(${t.arrow}rad)`;
    }
  }

  popup(text, cls = 'good') {
    const box = $('popups');
    const el = document.createElement('div');
    el.className = `pop ${cls}`;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => el.remove(), 1300);
  }

  /** parts: [[text, cls?], ...] */
  feed(parts) {
    const box = $('feed');
    const line = document.createElement('div');
    for (const [text, cls] of parts) {
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = text;
      line.appendChild(span);
    }
    box.appendChild(line);
    while (box.children.length > 6) box.firstChild.remove();
    setTimeout(() => (line.style.opacity = '0'), 6000);
    setTimeout(() => line.remove(), 6700);
  }

  banner(text, sub = '', cls = '', ms = 1800) {
    setText($('bannerText'), text);
    setText($('bannerSub'), sub);
    $('banner').className = `on ${cls}`;
    this.bannerUntil = performance.now() + ms;
  }

  tick() {
    if (this.bannerUntil && performance.now() > this.bannerUntil) {
      $('banner').className = '';
      this.bannerUntil = 0;
    }
  }

  damage() {
    this.flash('vignette');
  }

  /** Gold screen-edge flash for perfectly timed defence. */
  perfect() {
    this.flash('goldfx');
  }

  flash(id) {
    const v = $(id);
    v.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => v.classList.remove('on')));
  }

  setDead(text) {
    const el = $('deadmsg');
    el.hidden = !text;
    if (text) setText(el, text);
    $('crosshair').style.display = text ? 'none' : '';
  }

  setNet(text) {
    setText($('netinfo'), text);
  }

  /** A line under the score bar: what's going on in the lobby or while waiting. */
  setHint(text) {
    const el = $('hint');
    setText(el, text);
    el.hidden = !text;
  }

  /** What the host is doing in the menus, for everyone else. parts: [[text, bold?]] or null. */
  setHostLive(parts) {
    const sig = JSON.stringify(parts);
    if (sig === this.liveSig) return;
    this.liveSig = sig;
    const el = $('hostLive');
    el.hidden = !parts;
    if (parts) el.replaceChildren(...parts.map(([text, bold]) => {
      const span = document.createElement(bold ? 'b' : 'span');
      span.textContent = text;
      return span;
    }));
  }

  showScores(on, players, myId) {
    $('scoreboard').hidden = !on;
    if (!on) return;
    const rows = [...players.values()].filter((p) => p.team >= 0).sort((a, b) => a.team - b.team || b.cash - a.cash || a.id - b.id);
    const sig = JSON.stringify(rows.map((p) => [p.id, p.name, p.cash, p.stats]));
    if (sig === this.lastScoreSig) return;
    this.lastScoreSig = sig;
    $('scoreRows').replaceChildren(...rows.map((p) => {
      const tr = document.createElement('tr');
      tr.className = `${TEAM_CLASS[p.team]}${p.id === myId ? ' me' : ''}`;
      for (const v of [`${p.name}${p.bot ? ' (bot)' : ''}${p.alive ? '' : ' ✕'}`, p.cash, ...p.stats]) {
        const td = document.createElement('td');
        td.textContent = String(v);
        tr.appendChild(td);
      }
      return tr;
    }));
  }
}
