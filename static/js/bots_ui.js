// The bots and their flags (Lobby › Bots & flags…). The host makes bots of their own (a name the
// bot keeps, with its flags and own settings, and a place on a team), gives any bot flags, and
// defines the flags: named bundles of behaviour such as "Dodge master" or "Berserker". Everyone
// can look; only the host changes anything, and the server checks every change
// (rules.Rules.bot_change). Like every rule, changes apply at once in the lobby and from the next
// round during a match.
import { TEAM } from './hud.js';

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** A text box that sends its value when it's changed (Enter or leaving it); typing isn't playing. */
function textBox(value, max, onChange, placeholder = '') {
  const input = el('input');
  Object.assign(input, { value, maxLength: max, placeholder, spellcheck: false, autocomplete: 'off' });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') input.blur();
  });
  input.addEventListener('change', () => onChange(input.value.trim()));
  return input;
}

export class BotsPage {
  /** opts: {openPlayer({key, name, team, bot}), openFlag(id, name), describe(rule, value) -> text} */
  constructor(net, opts) {
    this.net = net;
    this.opts = opts;
    this.isHost = false;
    this.bots = null;           // as the host last chose them (what waits for the next round counts)
    this.waiting = false;       // some of it waits for the next round
    this.sig = '';
    this.armed = null;          // a Delete waiting for its second click: {what, until}
    $('botsClose').addEventListener('click', () => this.close());
    $('botsModal').addEventListener('mousedown', (e) => e.target.id === 'botsModal' && this.close());
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });
    $('newBotBtn').addEventListener('click', () => this.makeBot());
    $('newFlagBtn').addEventListener('click', () => this.makeFlag());
    for (const id of ['newBotName', 'newFlagName']) {
      $(id).addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (id === 'newBotName' ? this.makeBot() : this.makeFlag());
      });
    }
    // Typing in a box holds back redrawing it: catch up when the box is left.
    $('botsModal').addEventListener('focusout', () => setTimeout(() => this.render(), 0));
  }

  setHost(isHost) {
    this.isHost = isHost;
    this.sig = '';
    for (const id of ['newBotRow', 'newFlagRow']) $(id).hidden = !isHost;
    $('botsMode').textContent = isHost
      ? 'Changes apply at once in the lobby, and from the next round during a match.'
      : 'Set by the host: you can look, but not change them.';
  }

  isOpen() {
    return !$('botsModal').hidden;
  }

  open() {
    $('botsModal').hidden = false;
    this.sig = '';
    this.render();
  }

  close() {
    $('botsModal').hidden = true;
    this.armed = null;
    document.activeElement?.blur?.();
  }

  send(op) {
    this.net.send({ t: 'rules', bot: op });
  }

  /** The rules changed: live and next-round bots (rules message). */
  setServer(bots, nextBots) {
    this.bots = nextBots ?? bots;
    this.waiting = !!nextBots && JSON.stringify(nextBots) !== JSON.stringify(bots);
    if (this.isOpen()) this.render();
  }

  makeBot() {
    const name = $('newBotName').value.trim();
    if (!name) return;
    const team = $('newBotTeam').value;
    this.send({ do: 'make', name, ...(team === '' ? {} : { team: Number(team) }) });
    $('newBotName').value = '';
  }

  makeFlag() {
    const name = $('newFlagName').value.trim();
    if (!name) return;
    this.send({ do: 'flag', name, desc: '', values: {} });
    $('newFlagName').value = '';
  }

  /** Delete takes a second click within 3 s (no dialog). Returns true on the second. */
  confirm(what, button) {
    if (this.armed?.what === what && performance.now() < this.armed.until) {
      this.armed = null;
      return true;
    }
    this.armed = { what, until: performance.now() + 3000 };
    button.textContent = 'Click again to delete';
    setTimeout(() => {
      if (this.armed?.what === what && performance.now() >= this.armed.until) {
        this.armed = null;
        this.sig = '';
        this.render();
      }
    }, 3100);
    return false;
  }

  render() {
    const b = this.bots;
    if (!b || !this.isOpen()) return;
    const typing = $('botsModal').contains(document.activeElement) && document.activeElement.tagName === 'INPUT';
    const sig = JSON.stringify([b, this.isHost, this.waiting, this.armed?.what]);
    if (sig === this.sig || typing) return;
    this.sig = sig;
    const team = new Map();
    b.lineup.forEach((ids, t) => ids.forEach((id) => team.set(id, t)));
    const own = Object.entries(b.roster).filter(([, e]) => e.name).sort((x, y) => x[1].name.localeCompare(y[1].name));
    const builtin = [...team.keys(), ...Object.keys(b.roster)].filter((id, i, all) => !b.roster[id]?.name && all.indexOf(id) === i);
    $('rosterList').replaceChildren(...(own.length ? own.map(([id]) => this.botRow(id, team)) : [el('li', 'empty', 'None yet: name one below.')]));
    $('builtinList').replaceChildren(...builtin.map((id) => this.botRow(id, team)));
    const flags = Object.entries(b.flags).sort((x, y) => x[1].name.localeCompare(y[1].name));
    $('flagList').replaceChildren(...(flags.length ? flags.map(([id]) => this.flagRow(id)) : [el('li', 'empty', 'No flags.')]));
    $('botsWaiting').hidden = !this.waiting;
  }

  botName(id) {
    const e = this.bots.roster[id];
    return e?.name || `Bot ${id.charAt(0).toUpperCase()}${id.slice(1)}`;
  }

  botRow(id, team) {
    const b = this.bots;
    const entry = b.roster[id] ?? { flags: [] };
    const mine = !!entry.name;          // one of the host's own bots (built-in ones keep their names)
    const name = this.botName(id);
    const on = team.get(id);
    const li = el('li', 'botItem');
    const head = el('div', 'botHead');
    head.append(this.isHost && mine ? textBox(name, 32, (v) => v && v !== name && this.send({ do: 'edit', bot: id, name: v }))
      : el('b', '', name));
    const where = el('span', `tag ${on === undefined ? '' : on ? 'blue' : 'red'}`, on === undefined ? 'not on a team' : `on ${TEAM[on]}`);
    head.append(where);
    if (this.isHost) {
      if (on === undefined) {
        for (const t of [0, 1]) {
          const add = el('button', 'small', `→ ${TEAM[t]}`);
          add.title = `Put ${name} on ${TEAM[t]}`;
          add.addEventListener('click', () => this.send({ do: 'add', team: t, bot: id }));
          head.append(add);
        }
      } else {
        const move = el('button', 'small', '⇄');
        move.title = `Move ${name} to ${TEAM[1 - on]}`;
        move.addEventListener('click', () => this.send({ do: 'move', bot: id }));
        const off = el('button', 'small', 'Take off');
        off.title = `Take ${name} off ${TEAM[on]} (it keeps its flags and own settings)`;
        off.addEventListener('click', () => this.send({ do: 'remove', bot: id }));
        head.append(move, off);
      }
    }
    const gear = el('button', 'small gear', '⚙');
    gear.title = `${name}'s own settings (on top of its flags)`;
    gear.addEventListener('click', () => this.opts.openPlayer({ key: `b:${id}`, name, team: on ?? 0, bot: true }));
    head.append(gear);
    if (this.isHost && mine) {
      const del = el('button', 'small danger', 'Delete');
      del.title = `Delete ${name}, with its own settings`;
      del.addEventListener('click', () => this.confirm(`bot:${id}`, del) && this.send({ do: 'delete', bot: id }));
      head.append(del);
    }
    const flags = el('div', 'flagChips');
    flags.append(el('span', 'note', 'Flags:'));
    for (const f of entry.flags ?? []) {
      const chip = el('span', 'chip', b.flags[f]?.name ?? f);
      if (this.isHost) {
        const x = el('button', 'chipX', '✕');
        x.title = `Take the flag off ${name}`;
        x.addEventListener('click', () => this.send({ do: 'edit', bot: id, flags: entry.flags.filter((g) => g !== f) }));
        chip.append(x);
      }
      flags.append(chip);
    }
    if (!entry.flags?.length) flags.append(el('span', 'note', 'none'));
    const free = Object.entries(b.flags).filter(([f]) => !(entry.flags ?? []).includes(f));
    if (this.isHost && free.length && (entry.flags?.length ?? 0) < 8) {
      const pick = el('select', 'small');
      pick.append(new Option('+ a flag…', ''), ...free.map(([f, v]) => new Option(v.name, f)));
      pick.addEventListener('change', () => pick.value && this.send({ do: 'edit', bot: id, flags: [...(entry.flags ?? []), pick.value] }));
      flags.append(pick);
    }
    li.append(head, flags);
    return li;
  }

  flagRow(id) {
    const b = this.bots;
    const flag = b.flags[id];
    const li = el('li', 'flagItem');
    const head = el('div', 'botHead');
    const save = (change) => this.send({ do: 'flag', flag: id, name: flag.name, desc: flag.desc, values: flag.values, ...change });
    head.append(this.isHost ? textBox(flag.name, 32, (v) => v && v !== flag.name && save({ name: v })) : el('b', '', flag.name));
    const edit = el('button', 'small', this.isHost ? 'What it changes…' : 'What it changes');
    edit.title = 'Open the rules it changes, with their values';
    edit.addEventListener('click', () => this.opts.openFlag(id, flag.name));
    head.append(edit);
    if (this.isHost) {
      const del = el('button', 'small danger', 'Delete');
      del.title = `Delete the flag ${flag.name}: bots carrying it lose it`;
      del.addEventListener('click', () => this.confirm(`flag:${id}`, del) && this.send({ do: 'unflag', flag: id }));
      head.append(del);
    }
    li.append(head);
    if (this.isHost) {
      const desc = textBox(flag.desc ?? '', 200, (v) => v !== (flag.desc ?? '') && save({ desc: v }), 'What it does, in a few words');
      desc.className = 'flagDesc';
      li.append(desc);
    } else if (flag.desc) li.append(el('p', 'note', flag.desc));
    const values = Object.entries(flag.values ?? {});
    li.append(el('p', 'flagSum', values.length ? values.map(([k, v]) => this.opts.describe(k, v)).join(' · ') : 'Changes nothing yet.'));
    const carriers = Object.entries(b.roster).filter(([, e]) => e.flags?.includes(id)).map(([bid]) => this.botName(bid));
    if (carriers.length) li.append(el('p', 'note', `Carried by ${carriers.join(', ')}`));
    return li;
  }
}
