// The rules editor: every game number with its name, a description, its default and an
// animated preview that runs the default next to this lobby's value. The host edits a draft
// and presses Apply: in the lobby it takes effect at once, during a match from the next round.
// Everyone else can open it read-only to see the lobby's rules, or let it follow the host's
// screen live: the same group, the rule in focus and the host's edits as they make them.
// It also shows one player's (or bot's) own settings (openFor): only the rules that may differ
// per player, each either "same as everyone" or their own value, compared with everyone's.
import { Preview } from './previews.js';
import * as settingsFile from './settings_file.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// How rule values read on screen: "0.90 s", "34 m/s", "On", "#FF8A2A".
const decimals = (step) => (String(step).split('.')[1] || '').length;

/** p: a rule's schema entry (rules.py Param), v: its value. */
function formatValue(p, v) {
  if (p.kind === 'bool') return v ? 'On' : 'Off';
  if (p.kind === 'color') return String(v).toUpperCase();
  if (p.kind === 'choice') {
    const i = p.choices.indexOf(v);
    if (i >= 0 && p.labels?.[i]) return p.labels[i];
    return String(v).charAt(0).toUpperCase() + String(v).slice(1);
  }
  const text = Number(v).toFixed(p.kind === 'int' ? 0 : decimals(p.step));
  if (!p.unit) return text;
  return p.unit === '°' || p.unit === '×' || p.unit === '%' ? `${text}${p.unit}` : `${text} ${p.unit}`;
}

/** The text a number box shows for a value (no unit). */
function numberText(p, v) {
  return Number(v).toFixed(p.kind === 'int' ? 0 : decimals(p.step));
}

const numeric = (p) => p.kind === 'int' || p.kind === 'float';
const sameWho = (a, b) => (a?.name ?? null) === (b?.name ?? null) && (a?.team ?? null) === (b?.team ?? null) && !!a?.bot === !!b?.bot;

/** The same consistency rules as the server (rules.Rules._fix): ordered pairs stay in order (an
 *  edited one wins) and a capped rule stays under its cap. Changes `values`; returns the keys it touched. */
function keepConsistent(values, schema, edited) {
  const touched = [];
  for (const [lo, hi] of schema.pairs) {
    if (values[lo] > values[hi]) {
      if (edited.has(hi) && !edited.has(lo)) values[lo] = values[hi];
      else values[hi] = values[lo];
      touched.push(lo, hi);
    }
  }
  for (const [key, cap] of schema.caps) {
    if (values[key] > values[cap]) {
      values[key] = values[cap];
      touched.push(key);
    }
  }
  return touched;
}

export class RulesEditor {
  /** getState(): the round state ('lobby', 'play', ...), to say when changes apply. */
  constructor(net, getState) {
    this.net = net;
    this.getState = getState;
    this.schema = null;
    this.params = new Map();
    this.defaults = null;
    this.active = null;
    this.next = null;
    this.players = {};          // each player's own settings: live...
    this.nextPlayers = null;    // ...and as they'll be from the next round (null: nothing waits)
    this.who = null;            // whose own settings this shows, {name, team, bot}; null: the lobby's rules
    this.draft = null;
    this.isHost = false;
    this.group = null;
    this.focus = null;
    this.rows = new Map();
    this.mode = '';
    this.following = null;      // the host's screen this editor is mirroring (guests only)
    this.openedToFollow = false;
    this.preview = new Preview($('previewCanvas'));
    this.onStopFollowing = null;    // a guest closed the editor that followed the host
    this.onMessage = null;          // (text, cls): say something on screen (a file that didn't load)
    $('rulesClose').addEventListener('click', () => this.close(true));
    $('rulesApply').addEventListener('click', () => this.apply());
    $('rulesResetAll').addEventListener('click', () => this.replaceDraft({ ...this.reference() }));
    $('rulesRevert').addEventListener('click', () => this.replaceDraft({ ...this.base() }));
    $('rulesExportPlayer').addEventListener('click', () => this.exportPlayer());
    $('rulesImportPlayer').addEventListener('click', () => this.importPlayer());
    $('rulesSearch').addEventListener('input', () => this.renderList());
    $('rulesModal').addEventListener('mousedown', (e) => e.target.id === 'rulesModal' && this.close(true));
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close(true);
    });
  }

  setup(schema, defaults, isHost) {
    this.schema = schema;
    this.defaults = defaults;
    this.isHost = isHost;
    this.params = new Map(schema.params.map((p) => [p.key, p]));
    this.group = schema.groups[0].id;
  }

  /** New rules from the server: the live set, the set waiting for the next round (or null), and
   *  each player's own settings (live, and from the next round or null). */
  setServer(active, next, players = {}, nextPlayers = null) {
    const untouched = !this.draft || this.edits().length === 0;
    this.active = active;
    this.next = next;
    this.players = players;
    this.nextPlayers = nextPlayers;
    if (this.following) this.draft = { ...this.base(), ...this.following.d };
    else if (untouched || !this.isHost) this.draft = { ...this.base() };     // only the host drafts
    if (this.isOpen()) this.refresh();
  }

  /** Everyone's values, as the host last chose them (what waits for the next round counts). */
  shared() {
    return this.next ?? this.active;
  }

  /** A player's own settings, as the host last chose them. */
  ownOf(name) {
    return (this.nextPlayers ?? this.players)?.[name] ?? {};
  }

  /** What `own` settings make of everyone's values `shared` (the server's Rules.for_player). */
  effective(shared, own) {
    const values = { ...shared, ...own };
    keepConsistent(values, this.schema, new Set(Object.keys(own)));
    return values;
  }

  /** The values the draft starts from: the lobby's rules, or what this player plays by. */
  base() {
    return this.who ? this.effective(this.shared(), this.ownOf(this.who.name)) : this.shared();
  }

  /** What "changed" is measured from: the defaults, or for a player everyone's values. */
  reference() {
    return this.who ? this.shared() : this.defaults;
  }

  edits() {
    const base = this.base();
    return Object.keys(this.draft).filter((k) => this.draft[k] !== base[k]);
  }

  isOpen() {
    return !$('rulesModal').hidden;
  }

  /** The lobby's rules. */
  open() {
    this.show(null);
  }

  /** One player's (or bot's) own settings: who = {name, team, bot}. */
  openFor(who) {
    this.show(who);
  }

  show(who) {
    if (!this.schema || !this.active) return;
    if (!sameWho(who, this.who) || !this.draft) {
      this.who = who;
      this.draft = { ...this.base() };      // another page: the edits made on the last one are dropped
    }
    if (!this.groups().some((g) => g.id === this.group)) this.group = this.groups()[0]?.id ?? this.schema.groups[0].id;
    $('rulesModal').hidden = false;
    this.renderHeader();
    this.renderNav();
    this.renderList();
    this.tick();
    this.preview.start();
  }

  /** byUser: the ✕, Esc or a click outside. A guest who does that while following stops following. */
  close(byUser = false) {
    $('rulesModal').hidden = true;
    this.preview.stop();
    document.activeElement?.blur?.();
    if (this.following) {
      if (byUser) this.onStopFollowing?.();
      this.following = null;
      this.draft = { ...this.base() };      // the host's unapplied edits were only on show
    }
    this.openedToFollow = false;
  }

  /** A guest's editor showing what the host's shows: the same page (the lobby's rules or one
   *  player's own settings), the rule in focus and the host's unapplied edits. view: the server's
   *  'hostview' message with m === 'rules'. */
  follow(view) {
    const was = this.following;
    this.following = view;
    const who = view.pl ? { name: view.pl.n, team: view.pl.t, bot: view.pl.b } : null;
    const page = !this.isOpen() || !sameWho(who, this.who);
    if (page) {
      const opening = !this.isOpen();
      this.show(who);
      if (opening) this.openedToFollow = true;
    }
    this.draft = { ...this.base(), ...view.d };
    const q = view.q ?? '';
    const regroup = page || !was || $('rulesSearch').value !== q || (!q && view.g && view.g !== this.group);
    $('rulesSearch').value = q;
    if (view.g) this.group = view.g;
    if (view.f) this.focus = view.f;
    if (regroup) this.renderList();
    else this.refresh();
    this.setFocus(this.focus);
    const row = this.rows.get(view.f);
    for (const [k, r] of this.rows) r.classList.toggle('hostFocus', k === view.f);
    if (row && view.f !== was?.f) row.scrollIntoView({ block: 'nearest' });
  }

  /** Stop following: an editor opened only to follow closes again; the host's edits go away. */
  unfollow() {
    if (!this.following) return;
    if (this.openedToFollow) return this.close();
    this.following = null;
    this.draft = { ...this.base() };
    for (const r of this.rows.values()) r.classList.remove('hostFocus');
    this.renderHeader();
    this.refresh();
  }

  /** The host's screen in words, for everyone else's HUD and menu: [[text, bold?], ...]. */
  describe(view) {
    if (!view || !this.schema) return null;
    if (view.m === 'menu') return [['The host is in the menu: '], ['teams, bots and the match', true]];
    if (view.m !== 'rules') return null;
    const parts = [[view.pl ? 'The host is looking at ' : 'The host is looking at the rules: ']];
    if (view.pl) parts.push([`${view.pl.n}'s own settings`, true], [': ']);
    const base = view.pl ? this.effective(this.shared(), this.ownOf(view.pl.n)) : this.shared();
    const p = this.params.get(view.f);
    const group = this.schema.groups.find((g) => g.id === (p?.group ?? view.g));
    if (view.q) parts.push([`search "${view.q}" › `]);
    if (group) parts.push([group.title, true]);
    if (p) {
      parts.push([' › '], [p.label, true]);
      if (view.d && view.f in view.d && view.d[view.f] !== base[view.f]) {
        parts.push([`  ${formatValue(p, base[view.f])} → `], [formatValue(p, view.d[view.f]), true], [' (not applied yet)']);
      } else parts.push([`  ${formatValue(p, base[view.f])}`]);
    }
    const n = view.d ? Object.keys(view.d).filter((k) => view.d[k] !== base[k]).length : 0;
    if (n > 1 || (n === 1 && !(view.d && view.f in view.d))) parts.push([`  · ${n} edit${n === 1 ? '' : 's'} not applied yet`]);
    return parts;
  }

  /** What the host's editor shows, for the server to pass on (host only). */
  hostView() {
    if (!this.isOpen()) return null;
    const d = {};
    for (const k of this.edits()) d[k] = this.draft[k];
    const view = { m: 'rules', g: this.group, q: $('rulesSearch').value.trim().slice(0, 40), f: this.focus, d };
    if (this.who) view.pl = { n: this.who.name, t: this.who.team, b: this.who.bot };
    return view;
  }

  /** Per frame while open: keeps the "when does this apply" line current. */
  tick() {
    if (!this.isOpen()) return;
    const s = this.getState();
    const whose = this.who ? `Only ${this.who.name} plays by these; the rest of the rules are everyone's. ` : '';
    const mode = this.following
      ? 'Following the host\'s screen live. Untick "Follow the host" in the menu to look around yourself.'
      : !this.isHost
      ? `${whose}Set by the host. You can look but not change them.`
      : whose + (s === 'lobby' || s === 'wait'
        ? 'Changes apply as soon as you press Apply.'
        : 'A match is on: changes apply when the next round starts.');
    if (mode !== this.mode) {
      this.mode = mode;
      $('rulesMode').textContent = mode;
    }
  }

  /** The title and which footer buttons show: the host edits; anyone may save a player's settings. */
  renderHeader() {
    const w = this.who;
    $('rulesHeading').textContent = w ? `${w.name}'s own settings` : 'Game rules';
    $('rulesSearch').placeholder = w ? 'Search their settings…' : 'Search rules…';
    const editing = this.isHost && !this.following;
    $('rulesFooter').hidden = !editing && !w;
    for (const id of ['rulesResetAll', 'rulesRevert', 'rulesApply', 'rulesEditCount']) $(id).hidden = !editing;
    $('rulesResetAll').textContent = w ? 'All the same as everyone' : 'Reset all to defaults';
    $('rulesExportPlayer').hidden = !w;
    $('rulesImportPlayer').hidden = !w || !editing;
    this.mode = '';
  }

  /** On a player's page, only the rules that may differ for them: who (people, bots), their team's
   *  colours, and for a bot the numbers of the skill it plays at. */
  applies(p) {
    const w = this.who;
    if (!w) return true;
    if (!p.who || (p.who === 'people' && w.bot) || (p.who === 'bots' && !w.bot)) return false;
    if (p.team >= 0 && p.team !== w.team) return false;
    if (p.group === 'bots' && p.sub) return p.sub.toLowerCase().startsWith(String(this.draft?.BOT_SKILL));
    return true;
  }

  groups() {
    return this.schema.groups.filter((g) => this.schema.params.some((p) => p.group === g.id && this.applies(p)));
  }

  renderNav() {
    const nav = $('rulesNav');
    const searching = $('rulesSearch').value.trim() !== '';
    const ref = this.reference();
    const base = this.base();
    nav.replaceChildren(...this.groups().map((g) => {
      const b = el('button', g.id === this.group && !searching ? 'on' : '');
      b.append(el('span', '', g.title));
      const keys = this.schema.params.filter((p) => p.group === g.id && this.applies(p)).map((p) => p.key);
      const changed = keys.filter((k) => this.draft[k] !== ref[k]).length;
      const edited = keys.some((k) => this.draft[k] !== base[k]);
      if (edited) b.append(el('i', 'edited', '●'));
      if (changed) b.append(el('em', '', String(changed)));
      b.title = !changed ? (this.who ? 'All the same as everyone' : 'All defaults')
        : this.who ? `${changed} of their own` : `${changed} changed from the defaults`;
      b.addEventListener('click', () => {
        $('rulesSearch').value = '';
        this.group = g.id;
        this.renderNav();
        this.renderList();
      });
      return b;
    }));
  }

  visibleParams() {
    const q = $('rulesSearch').value.trim().toLowerCase();
    const params = this.schema.params.filter((p) => this.applies(p));
    if (!q) return params.filter((p) => p.group === this.group);
    return params.filter((p) => `${p.label} ${p.desc} ${p.key} ${p.sub}`.toLowerCase().includes(q));
  }

  renderList() {
    const list = $('rulesList');
    const params = this.visibleParams();
    const searching = $('rulesSearch').value.trim() !== '';
    this.rows.clear();
    const items = [];
    if (!searching) {
      const g = this.schema.groups.find((x) => x.id === this.group);
      items.push(el('p', 'groupBlurb', g.blurb));
    } else if (!params.length) items.push(el('p', 'groupBlurb', 'No rule matches that search.'));
    let heading = null;
    for (const p of params) {
      const h = searching ? this.schema.groups.find((x) => x.id === p.group).title + (p.sub ? ` · ${p.sub}` : '') : p.sub;
      if (h && h !== heading) items.push(el('h4', 'subhead', h));
      heading = h;
      items.push(this.row(p));
    }
    list.replaceChildren(...items);
    list.scrollTop = 0;
    if (!searching) this.renderNav();
    const first = params[0];
    if (first && (!this.focus || !params.some((p) => p.key === this.focus))) this.setFocus(first.key);
    else this.setFocus(this.focus);
  }

  row(p) {
    const row = el('div', 'rule');
    row.dataset.key = p.key;
    const head = el('div', 'ruleHead');
    head.append(el('b', '', p.label), el('span', p.kind === 'color' ? 'value swatch' : 'value'), el('span', 'badges'));
    const ctl = el('div', 'ruleCtl');
    const disabled = !this.isHost;
    let slider = null;
    let number = null;
    if (p.kind === 'bool') {
      const box = el('input');
      box.type = 'checkbox';
      box.disabled = disabled;
      box.addEventListener('change', () => this.setDraft(p.key, box.checked));
      const lab = el('label', 'check');
      lab.append(box, el('span', '', 'On'));
      ctl.append(lab);
      row.box = box;
    } else if (p.kind === 'choice') {
      const sel = el('select');
      for (const c of p.choices) sel.append(new Option(formatValue(p, c), c));
      sel.disabled = disabled;
      sel.addEventListener('change', () => this.setDraft(p.key, sel.value));
      ctl.append(sel);
      row.sel = sel;
    } else if (p.kind === 'color') {
      const pick = el('input');
      pick.type = 'color';
      pick.disabled = disabled;
      pick.addEventListener('input', () => this.setDraft(p.key, pick.value.toLowerCase()));
      ctl.append(pick);
      row.pick = pick;
    } else {
      slider = el('input');
      slider.type = 'range';
      number = el('input');
      number.type = 'number';
      for (const input of [slider, number]) {
        input.min = p.lo;
        input.max = p.hi;
        input.step = p.step;
        input.disabled = disabled;
      }
      slider.addEventListener('input', () => this.setDraft(p.key, Number(slider.value)));
      number.addEventListener('input', () => {
        if (number.value !== '' && Number.isFinite(Number(number.value))) this.setDraft(p.key, Number(number.value), true);
      });
      number.addEventListener('change', () => this.refreshRow(p.key, true));
      ctl.append(slider, number);
      if (p.unit) ctl.append(el('span', 'unit', p.unit));
    }
    const reset = el('button', 'small reset', '↺');
    reset.title = this.who ? 'Back to everyone\'s value' : 'Back to the default';
    reset.hidden = disabled;
    reset.addEventListener('click', () => this.setDraft(p.key, this.reference()[p.key]));
    ctl.append(el('span', 'default'), reset);
    row.append(head, ctl, el('p', 'desc', p.desc));
    Object.assign(row, { slider, number, reset });
    row.addEventListener('mouseenter', () => this.following || this.setFocus(p.key));
    row.addEventListener('focusin', () => this.following || this.setFocus(p.key));
    this.rows.set(p.key, row);
    this.refreshRow(p.key, true);
    return row;
  }

  /** The value now in play when what waits for the next round differs from it, else undefined. */
  livePending(key) {
    if (!this.next) return undefined;
    const live = this.who ? this.effective(this.active, this.players?.[this.who.name] ?? {}) : this.active;
    return this.base()[key] !== live[key] ? live[key] : undefined;
  }

  /** Show one rule's current state. `typing`: don't rewrite the number box being typed in. */
  refreshRow(key, rewriteNumber = false, typing = false) {
    const row = this.rows.get(key);
    if (!row) return;
    const p = this.params.get(key);
    const v = this.draft[key];
    const value = row.querySelector('.value');
    value.textContent = formatValue(p, v);
    if (p.kind === 'color') value.style.setProperty('--swatch', v);
    if (row.slider) row.slider.value = v;
    if (row.number && (rewriteNumber || !typing)) row.number.value = numberText(p, v);
    if (row.box) row.box.checked = !!v;
    if (row.sel) row.sel.value = v;
    if (row.pick) row.pick.value = v;
    const ref = this.reference()[key];
    const same = v === ref;
    const unapplied = v !== this.base()[key];
    row.querySelector('.default').textContent = this.who
      ? (same ? 'same as everyone' : `everyone: ${formatValue(p, ref)}`)
      : (same ? 'default' : `default ${formatValue(p, ref)}`);
    row.reset.style.visibility = same ? 'hidden' : '';
    row.classList.toggle('changed', !same);
    row.classList.toggle('edited', unapplied);
    const badges = row.querySelector('.badges');
    const items = [];
    if (unapplied) items.push(el('span', 'badge edit', 'not applied yet'));
    const live = this.livePending(key);
    if (live !== undefined) items.push(el('span', 'badge soon', `next round (now ${formatValue(p, live)})`));
    badges.replaceChildren(...items);
  }

  refresh() {
    for (const key of this.rows.keys()) this.refreshRow(key, true);
    this.renderNavCounts();
    this.updateFooter();
    this.updatePreview();
  }

  renderNavCounts() {
    if ($('rulesSearch').value.trim() === '') this.renderNav();
  }

  setFocus(key) {
    if (!key) return;
    this.focus = key;
    for (const [k, row] of this.rows) row.classList.toggle('focus', k === key);
    this.updatePreview();
  }

  updatePreview() {
    const p = this.params.get(this.focus);
    if (!p) return;
    const ref = this.reference();
    const sceneKeys = this.schema.params.filter((x) => x.preview === p.preview).map((x) => x.key);
    const same = sceneKeys.every((k) => this.draft[k] === ref[k]);
    const drafting = this.edits().length > 0;
    const whose = this.who ? this.who.name.toUpperCase() : 'THIS LOBBY';
    const label = drafting ? `${this.who ? `${whose} · ` : ''}${this.following ? 'HOST\'S' : 'YOUR'} EDIT (NOT APPLIED)` : whose;
    const tail = same ? (this.who ? ' · same as everyone' : ' · same as default') : '';
    const info = this.preview.show(p.preview, p.key, ref, this.draft, `${label}${tail}`, this.who ? 'EVERYONE' : 'DEFAULT',
      this.who ? 'everyone' : 'default', this.who ? this.who.name : 'this lobby');
    $('previewTitle').textContent = info.title;
    $('previewText').textContent = info.caption;
  }

  setDraft(key, value, typing = false) {
    const p = this.params.get(key);
    if (numeric(p)) {
      value = Math.min(p.hi, Math.max(p.lo, value));
      if (p.kind === 'int') value = Math.round(value);
      else value = Math.round(value * 1e4) / 1e4;
    }
    this.draft[key] = value;
    if (key === 'BOT_SKILL' && this.who) {      // a bot's skill decides which profile's numbers it uses
      this.renderList();
      this.updateFooter();
      return;
    }
    for (const k of this.enforce(key)) this.refreshRow(k, k !== key, k === key && typing);
    this.renderNavCounts();
    this.updateFooter();
    this.updatePreview();
  }

  /** The same consistency rules as the server (rules.Rules._fix). Returns the keys touched. */
  enforce(edited) {
    return [...new Set([edited, ...keepConsistent(this.draft, this.schema, new Set([edited]))])];
  }

  replaceDraft(values) {
    this.draft = values;
    if (this.who) this.renderList();     // a bot's skill may have changed with it
    this.refresh();
  }

  updateFooter() {
    const n = this.edits().length;
    $('rulesEditCount').textContent = n ? `${n} edit${n === 1 ? '' : 's'} not applied yet` : 'No unapplied edits';
    $('rulesApply').disabled = n === 0;
    $('rulesRevert').disabled = n === 0;
  }

  apply() {
    const changes = {};
    const shared = this.shared();
    // On a player's page a value equal to everyone's is no own setting: null takes it away.
    for (const k of this.edits()) changes[k] = this.who && this.draft[k] === shared[k] ? null : this.draft[k];
    if (!Object.keys(changes).length) return;
    this.net.send(this.who ? { t: 'rules', player: this.who.name, set: changes } : { t: 'rules', set: changes });
  }

  /** Anyone: save this player's own settings as a file (a profile to load onto anyone). */
  exportPlayer() {
    if (!this.who) return;
    const name = settingsFile.playerFileName(this.who.name);
    settingsFile.download(name, settingsFile.playerFile(this.who.name, this.ownOf(this.who.name)));
    this.onMessage?.(`${this.who.name}'s own settings saved to your Downloads folder: ${name}`, 'good');
  }

  /** The host: load a player's settings file onto this player, replacing their own settings. */
  async importPlayer() {
    if (!this.who || !this.isHost) return;
    const file = await settingsFile.pickFile();
    if (file) this.importPlayerText(file.text, file.name);
  }

  importPlayerText(text, fileName = 'the file') {
    let settings;
    try {
      settings = settingsFile.readPlayer(text, new Set(this.params.keys()));
    } catch (e) {
      this.onMessage?.(e.message, 'bad');
      return false;
    }
    this.net.send({ t: 'rules', player: this.who.name, replace: settings });
    const later = ['lobby', 'wait'].includes(this.getState()) ? '' : ' (from the next round)';
    this.onMessage?.(`Loaded ${fileName} onto ${this.who.name}${later}`, 'good');
    return true;
  }
}
