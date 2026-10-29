// The lobby / pause menu: who is on which team, each team's bots, the match settings, and the
// host's controls. Everyone sees the same information; only the host gets working buttons (and
// the server refuses everyone else anyway). During a match, changes wait for the next round,
// and the menu says so next to each value.
import { TEAM } from './hud.js';

const $ = (id) => document.getElementById(id);
// The round time's quick steps (any other value can be typed in the rules editor).
const ROUND_TIMES = [20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900];
const minutes = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class Lobby {
  /** opts: {onStart(), openRules(), openPlayer({name, team, bot}), exportSettings(), importSettings()} */
  constructor(net, opts) {
    this.net = net;
    this.isHost = false;
    this.sig = '';
    this.wanted = {};       // values asked for but not confirmed yet: rapid clicks count from these
    this.maxBots = 12;
    this.watching = false;  // the host spectates (or will from the next round)
    $('startBtn').addEventListener('click', () => {
      net.send({ t: 'start' });
      opts.onStart();
    });
    // Ending the match affects everyone, so it takes a second click (no blocking dialog).
    let armed = 0;
    $('endBtn').addEventListener('click', () => {
      if (performance.now() < armed) {
        armed = 0;
        $('endBtn').textContent = 'End match';
        net.send({ t: 'end' });
        return;
      }
      armed = performance.now() + 3000;
      $('endBtn').textContent = 'Click again to end it for everyone';
      setTimeout(() => {
        if (performance.now() >= armed) $('endBtn').textContent = 'End match';
      }, 3100);
    });
    $('shuffleBtn').addEventListener('click', () => net.send({ t: 'shuffle' }));
    $('discardBtn').addEventListener('click', () => net.send({ t: 'rules', discard: true }));
    $('rulesBtn').addEventListener('click', () => opts.openRules());
    $('exportBtn').addEventListener('click', () => opts.exportSettings());
    $('importBtn').addEventListener('click', () => opts.importSettings());
    for (const [team, key] of [['Red', 'BOTS_RED'], ['Blue', 'BOTS_BLUE']]) {
      $(`bots${team}Minus`).addEventListener('click', () => this.step(key, -1, 0, this.maxBots));
      $(`bots${team}Plus`).addEventListener('click', () => this.step(key, 1, 0, this.maxBots));
    }
    $('watchBtn').addEventListener('click', () => net.send({ t: 'spectate', on: !this.watching }));
    $('winMinus').addEventListener('click', () => this.step('MATCH_ROUNDS_TO_WIN', -1, 0, 15));
    $('winPlus').addEventListener('click', () => this.step('MATCH_ROUNDS_TO_WIN', 1, 0, 15));
    $('timeMinus').addEventListener('click', () => this.stepThrough('ROUND_TIME_LIMIT', -1, ROUND_TIMES));
    $('timePlus').addEventListener('click', () => this.stepThrough('ROUND_TIME_LIMIT', 1, ROUND_TIMES));
    $('skillSelect').addEventListener('change', (e) => this.set('BOT_SKILL', e.target.value));
    for (const id of ['listRed', 'listBlue']) {
      $(id).addEventListener('click', (e) => {
        const b = e.target.closest('button[data-p]');
        if (b) net.send({ t: 'move', p: Number(b.dataset.p) });
        const own = e.target.closest('button[data-own]');      // ⚙: that player's own settings
        if (own) opts.openPlayer({ name: own.dataset.own, team: Number(own.dataset.team), bot: own.dataset.bot === '1' });
      });
    }
  }

  setHost(isHost, maxBots) {
    this.isHost = isHost;
    this.maxBots = maxBots;
    for (const e of document.querySelectorAll('.hostCtl')) e.disabled = !isHost;
    $('rulesBtn').textContent = isHost ? 'Game rules…' : 'View the game rules…';
    $('importBtn').hidden = !isHost;
    this.sig = '';
  }

  /** Changed rules: the shown values must refresh. */
  dirty() {
    this.sig = '';
    for (const k of Object.keys(this.wanted)) delete this.wanted[k];
  }

  set(key, value) {
    this.wanted[key] = value;
    this.net.send({ t: 'rules', set: { [key]: value } });
    this.sig = '';
  }

  /** What a click steps from: the value just asked for, else the host's latest choice. Read now,
   *  not from the copy update() keeps: a rules message can arrive between two frames. */
  chosen(key) {
    return this.wanted[key] ?? (this.rules?.next ?? this.rules?.active)?.[key];
  }

  step(key, delta, lo, hi) {
    const now = this.chosen(key) ?? 0;
    const value = Math.max(lo, Math.min(hi, now + delta));
    if (value !== now) this.set(key, value);
  }

  /** The next value up (dir 1) or down (-1) in `steps`, from what's asked for (a value set in the
   *  editor between two steps goes to the nearer one that way). */
  stepThrough(key, dir, steps) {
    const now = this.chosen(key) ?? steps[0];
    const value = dir > 0 ? steps.find((v) => v > now) : [...steps].reverse().find((v) => v < now);
    if (value !== undefined) this.set(key, value);
  }

  /** Called every frame while the menu is open; rebuilds only when something changed. */
  update(snap, myId, rules) {
    if (!snap || !rules.active) return;
    const r = snap.r;
    const players = [...snap.players.values()];
    this.rules = rules;
    this.desired = rules.next ?? rules.active;
    this.own = rules.nextPlayers ?? rules.players;     // each player's own settings, as the host last chose
    const sig = JSON.stringify([r.s, r.n, r.score, r.res, r.pend, rules.rv, this.isHost, this.wanted,
      players.map((p) => [p.id, p.name, p.team, p.bot, p.host, p.next])]);
    if (sig === this.sig) return;
    this.sig = sig;
    const lobby = r.s === 'lobby';
    const host = players.find((p) => p.host && p.id !== myId) ?? players.find((p) => p.host);

    const title = { lobby: 'Lobby', wait: 'Waiting for players', count: `Round ${r.n} is starting!`, over: 'Round over' }[r.s];
    $('overlayTitle').textContent = title ?? 'Paused';
    $('menuStatus').textContent = this.status(r, lobby, host, myId);
    $('resumeBtn').textContent = lobby ? 'Warm up' : r.s === 'count' ? 'Play' : 'Back to the game';
    $('startBtn').hidden = !this.isHost || !lobby;
    $('endBtn').hidden = !this.isHost || lobby;
    $('shuffleBtn').hidden = !this.isHost;
    $('discardBtn').hidden = !this.isHost;
    const me = players.find((p) => p.id === myId);
    this.watching = !!me && (me.next !== null ? me.next === -1 : me.team === -1);
    $('watchBtn').hidden = !this.isHost;
    if (me?.team === -1) $('resumeBtn').textContent = 'Watch';
    $('watchBtn').textContent = this.watching ? 'Join a team' : 'Spectate';
    $('watchBtn').title = this.watching ? 'Play again, on the team you had' : 'Watch the game instead of playing (bots and the others play on)';
    const watchers = players.filter((p) => p.team === -1);
    $('watchers').hidden = !watchers.length;
    $('watchers').textContent = watchers.length
      ? `Spectating: ${watchers.map((p) => `${p.name}${p.next !== null ? ` (joins ${TEAM[p.next]} next round)` : ''}`).join(', ')}` : '';

    for (const team of [0, 1]) {
      const list = $(team ? 'listBlue' : 'listRed');
      const members = players.filter((p) => p.team === team).sort((a, b) => a.bot - b.bot || a.id - b.id);
      $(team ? 'countBlue' : 'countRed').textContent = `${members.length}`;
      list.replaceChildren(...members.map((p) => this.row(p, myId, lobby)));
    }
    $('teamsNote').textContent = this.isHost
      ? `⇄ moves a player to the other team${lobby ? '' : ' from the next round'}. Bots stay where you put them: nothing balances the teams.`
      : 'The host sets the teams and the bots.';
    $('matchWho').textContent = this.isHost ? 'you are the host' : host ? `set by ${host.name}` : 'no host connected';

    this.value('botsRedValue', 'botsRedSoon', rules, 'BOTS_RED', (v) => String(v));
    this.value('botsBlueValue', 'botsBlueSoon', rules, 'BOTS_BLUE', (v) => String(v));
    this.value('winValue', 'winSoon', rules, 'MATCH_ROUNDS_TO_WIN', (v) => (v ? `first to ${v}` : 'endless'));
    this.value('timeValue', 'timeSoon', rules, 'ROUND_TIME_LIMIT', minutes);
    const skill = this.wanted.BOT_SKILL ?? this.desired.BOT_SKILL;
    if ($('skillSelect').value !== skill) $('skillSelect').value = skill;
    $('skillSoon').textContent = rules.next && rules.next.BOT_SKILL !== rules.active.BOT_SKILL ? 'next round' : '';

    const changed = Object.keys(rules.defaults).filter((k) => this.desired[k] !== rules.defaults[k]).length;
    $('rulesSummary').textContent = changed ? `${changed} changed from the defaults` : 'default rules';
    $('pendingBox').hidden = !r.pend;
    $('pendingText').textContent = `${r.pend} rule change${r.pend === 1 ? '' : 's'} will apply when the next round starts.`;
  }

  status(r, lobby, host, myId) {
    const res = r.res;
    const last = res
      ? res[0] === null || res[0] === undefined
        ? ` The last match was ended at ${res[1]}–${res[2]}.`
        : ` ${TEAM[res[0]]} won the last match ${res[1]}–${res[2]}.`
      : '';
    if (lobby) {
      if (this.isHost) return `You're the host: set up the teams and the rules, then press Start match. Everyone can warm up meanwhile.${last}`;
      if (!host) return `Waiting for the host. The host is whoever plays on the computer running the game.${last}`;
      return `Waiting for ${host.id === myId ? 'you' : host.name} to start the match. Warm up meanwhile.${last}`;
    }
    const goal = r.win ? ` · first to ${r.win}` : '';
    if (r.s === 'wait') return `The match is on hold until both teams have someone${this.isHost ? ': move a player or add bots' : ''}.`;
    return `Round ${r.n} · RED ${r.score[0]} – ${r.score[1]} BLUE${goal}. ${this.isHost ? 'Changes you make now apply from the next round.' : ''}`;
  }

  row(p, myId, lobby) {
    const li = el('li', p.bot ? 'bot' : '');
    li.append(el('span', 'name', p.name));
    if (p.id === myId) li.append(el('span', 'tag', 'you'));
    if (p.host) li.append(el('span', 'tag host', 'host'));
    if (p.bot) li.append(el('span', 'tag', 'bot'));
    if (p.next !== null) li.append(el('span', 'tag soon', p.next === -1 ? '→ spectating next round' : `→ ${TEAM[p.next]} next round`));
    const own = Object.keys(this.own?.[p.name] ?? {}).length;
    if (own) li.append(el('span', 'tag own', `own settings: ${own}`));
    const gear = el('button', 'small gear', '⚙');      // everyone may look; only the host changes them
    Object.assign(gear.dataset, { own: p.name, team: p.team, bot: p.bot ? '1' : '0' });
    gear.title = this.isHost ? `Settings just for ${p.name}` : `${p.name}'s own settings`;
    li.append(gear);
    if (this.isHost && !p.bot && !(p.id === myId && p.next === -1)) {
      const b = el('button', 'small move', p.next !== null ? '✕' : '⇄');
      b.dataset.p = p.id;
      b.title = p.next !== null ? 'Cancel the move' : `Move to ${TEAM[1 - p.team]}${lobby ? '' : ' (from the next round)'}`;
      li.append(b);
    }
    return li;
  }

  /** A number the host can step: what's asked for, plus "next round" while it waits. */
  value(id, soonId, rules, key, fmt) {
    const wanted = this.wanted[key] ?? this.desired[key];
    $(id).textContent = fmt(wanted);
    const pending = rules.next && rules.next[key] !== rules.active[key];
    $(soonId).textContent = pending ? `next round (now ${fmt(rules.active[key])})` : '';
  }
}
