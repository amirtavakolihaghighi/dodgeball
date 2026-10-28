// The rules editor: every game number with its name, a description, its default and an
// animated preview that runs the default next to this lobby's value. The host edits a draft
// and presses Apply: in the lobby it takes effect at once, during a match from the next round.
// Everyone else can open it read-only to see the lobby's rules, or let it follow the host's
// screen live: the same group, the rule in focus and the host's edits as they make them.
import { Preview } from './previews.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// How rule values read on screen: "0.90 s", "34 m/s", "On".
const decimals = (step) => (String(step).split('.')[1] || '').length;

/** p: a rule's schema entry (rules.py Param), v: its value. */
function formatValue(p, v) {
  if (p.kind === 'bool') return v ? 'On' : 'Off';
  if (p.kind === 'choice') return String(v).charAt(0).toUpperCase() + String(v).slice(1);
  const text = Number(v).toFixed(p.kind === 'int' ? 0 : decimals(p.step));
  if (!p.unit) return text;
  return p.unit === '°' || p.unit === '×' ? `${text}${p.unit}` : `${text} ${p.unit}`;
}

/** The text a number box shows for a value (no unit). */
function numberText(p, v) {
  return Number(v).toFixed(p.kind === 'int' ? 0 : decimals(p.step));
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
    $('rulesClose').addEventListener('click', () => this.close(true));
    $('rulesApply').addEventListener('click', () => this.apply());
    $('rulesResetAll').addEventListener('click', () => this.replaceDraft({ ...this.defaults }));
    $('rulesRevert').addEventListener('click', () => this.replaceDraft({ ...this.base() }));
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

  /** New rules from the server: the live set, and the set waiting for the next round (or null). */
  setServer(active, next) {
    const untouched = !this.draft || this.edits().length === 0;
    this.active = active;
    this.next = next;
    if (this.following) this.draft = { ...this.base(), ...this.following.d };
    else if (untouched || !this.isHost) this.draft = { ...this.base() };     // only the host drafts
    if (this.isOpen()) this.refresh();
  }

  base() {
    return this.next ?? this.active;
  }

  edits() {
    const base = this.base();
    return Object.keys(this.draft).filter((k) => this.draft[k] !== base[k]);
  }

  isOpen() {
    return !$('rulesModal').hidden;
  }

  open() {
    if (!this.schema || !this.active) return;
    if (!this.draft) this.draft = { ...this.base() };
    $('rulesModal').hidden = false;
    $('rulesFooter').hidden = !this.isHost;
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

  /** A guest's editor showing what the host's shows: the same rules, the rule in focus and the
   *  host's unapplied edits. view: the server's 'hostview' message with m === 'rules'. */
  follow(view) {
    const was = this.following;
    this.following = view;
    if (!this.isOpen()) {
      this.open();
      this.openedToFollow = true;
    }
    this.draft = { ...this.base(), ...view.d };
    const q = view.q ?? '';
    const regroup = !was || $('rulesSearch').value !== q || (!q && view.g && view.g !== this.group);
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
    this.refresh();
  }

  /** The host's screen in words, for everyone else's HUD and menu: [[text, bold?], ...]. */
  describe(view) {
    if (!view || !this.schema) return null;
    if (view.m === 'menu') return [['The host is in the menu: '], ['teams, bots and the match', true]];
    if (view.m !== 'rules') return null;
    const parts = [['The host is looking at the rules: ']];
    const p = this.params.get(view.f);
    const group = this.schema.groups.find((g) => g.id === (p?.group ?? view.g));
    if (view.q) parts.push([`search "${view.q}" › `]);
    if (group) parts.push([group.title, true]);
    if (p) {
      parts.push([' › '], [p.label, true]);
      const base = this.base();
      if (view.d && view.f in view.d && view.d[view.f] !== base[view.f]) {
        parts.push([`  ${formatValue(p, base[view.f])} → `], [formatValue(p, view.d[view.f]), true], [' (not applied yet)']);
      } else parts.push([`  ${formatValue(p, base[view.f])}`]);
    }
    const n = view.d ? Object.keys(view.d).filter((k) => view.d[k] !== this.base()[k]).length : 0;
    if (n > 1 || (n === 1 && !(view.d && view.f in view.d))) parts.push([`  · ${n} edit${n === 1 ? '' : 's'} not applied yet`]);
    return parts;
  }

  /** What the host's editor shows, for the server to pass on (host only). */
  hostView() {
    if (!this.isOpen()) return null;
    const d = {};
    for (const k of this.edits()) d[k] = this.draft[k];
    return { m: 'rules', g: this.group, q: $('rulesSearch').value.trim().slice(0, 40), f: this.focus, d };
  }

  /** Per frame while open: keeps the "when does this apply" line current. */
  tick() {
    if (!this.isOpen()) return;
    const s = this.getState();
    const mode = this.following
      ? 'Following the host\'s screen live. Untick "Follow the host" in the menu to look around yourself.'
      : !this.isHost
      ? 'Set by the host. You can look but not change them.'
      : s === 'lobby' || s === 'wait'
        ? 'Changes apply as soon as you press Apply.'
        : 'A match is on: changes apply when the next round starts.';
    if (mode !== this.mode) {
      this.mode = mode;
      $('rulesMode').textContent = mode;
    }
  }

  renderNav() {
    const nav = $('rulesNav');
    const searching = $('rulesSearch').value.trim() !== '';
    nav.replaceChildren(...this.schema.groups.map((g) => {
      const b = el('button', g.id === this.group && !searching ? 'on' : '');
      b.append(el('span', '', g.title));
      const keys = this.schema.params.filter((p) => p.group === g.id).map((p) => p.key);
      const changed = keys.filter((k) => this.draft[k] !== this.defaults[k]).length;
      const edited = keys.some((k) => this.draft[k] !== this.base()[k]);
      if (edited) b.append(el('i', 'edited', '●'));
      if (changed) b.append(el('em', '', String(changed)));
      b.title = changed ? `${changed} changed from the defaults` : 'All defaults';
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
    if (!q) return this.schema.params.filter((p) => p.group === this.group);
    return this.schema.params.filter((p) => `${p.label} ${p.desc} ${p.key} ${p.sub}`.toLowerCase().includes(q));
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
    head.append(el('b', '', p.label), el('span', 'value'), el('span', 'badges'));
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
    reset.title = 'Back to the default';
    reset.hidden = disabled;
    reset.addEventListener('click', () => this.setDraft(p.key, this.defaults[p.key]));
    ctl.append(el('span', 'default'), reset);
    row.append(head, ctl, el('p', 'desc', p.desc));
    Object.assign(row, { slider, number, reset });
    row.addEventListener('mouseenter', () => this.following || this.setFocus(p.key));
    row.addEventListener('focusin', () => this.following || this.setFocus(p.key));
    this.rows.set(p.key, row);
    this.refreshRow(p.key, true);
    return row;
  }

  /** Show one rule's current state. `typing`: don't rewrite the number box being typed in. */
  refreshRow(key, rewriteNumber = false, typing = false) {
    const row = this.rows.get(key);
    if (!row) return;
    const p = this.params.get(key);
    const v = this.draft[key];
    row.querySelector('.value').textContent = formatValue(p, v);
    if (row.slider) row.slider.value = v;
    if (row.number && (rewriteNumber || !typing)) row.number.value = numberText(p, v);
    if (row.box) row.box.checked = !!v;
    if (row.sel) row.sel.value = v;
    const isDefault = v === this.defaults[key];
    row.querySelector('.default').textContent = isDefault ? 'default' : `default ${formatValue(p, this.defaults[key])}`;
    row.reset.style.visibility = isDefault ? 'hidden' : '';
    row.classList.toggle('changed', !isDefault);
    row.classList.toggle('edited', v !== this.base()[key]);
    const badges = row.querySelector('.badges');
    const items = [];
    if (v !== this.base()[key]) items.push(el('span', 'badge edit', 'not applied yet'));
    if (this.next && this.next[key] !== this.active[key]) {
      items.push(el('span', 'badge soon', `next round (now ${formatValue(p, this.active[key])})`));
    }
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
    const sceneKeys = this.schema.params.filter((x) => x.preview === p.preview).map((x) => x.key);
    const same = sceneKeys.every((k) => this.draft[k] === this.defaults[k]);
    const drafting = this.edits().length > 0;
    const label = drafting ? `${this.following ? 'HOST\'S' : 'YOUR'} EDIT (NOT APPLIED)` : 'THIS LOBBY';
    const info = this.preview.show(p.preview, p.key, this.defaults, this.draft, `${label}${same ? ' · same as default' : ''}`);
    $('previewTitle').textContent = info.title;
    $('previewText').textContent = info.caption;
  }

  setDraft(key, value, typing = false) {
    const p = this.params.get(key);
    if (p.kind !== 'bool' && p.kind !== 'choice') {
      value = Math.min(p.hi, Math.max(p.lo, value));
      if (p.kind === 'int') value = Math.round(value);
      else value = Math.round(value * 1e4) / 1e4;
    }
    this.draft[key] = value;
    for (const k of this.enforce(key)) this.refreshRow(k, k !== key, k === key && typing);
    this.renderNavCounts();
    this.updateFooter();
    this.updatePreview();
  }

  /** The same consistency rules as the server (rules.Rules._fix). Returns the keys touched. */
  enforce(edited) {
    const d = this.draft;
    const touched = [edited];
    for (const [lo, hi] of this.schema.pairs) {
      if (d[lo] > d[hi]) {
        if (edited === hi) d[lo] = d[hi];
        else d[hi] = d[lo];
        touched.push(lo, hi);
      }
    }
    for (const [key, cap] of this.schema.caps) {
      if (d[key] > d[cap]) {
        d[key] = d[cap];
        touched.push(key);
      }
    }
    return [...new Set(touched)];
  }

  replaceDraft(values) {
    this.draft = values;
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
    for (const k of this.edits()) changes[k] = this.draft[k];
    if (Object.keys(changes).length) this.net.send({ t: 'rules', set: changes });
  }
}
