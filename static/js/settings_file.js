// Settings files: the whole setup (every rule, each player's own settings, the bots and their
// flags) or one player's own settings (a profile, like "beginner", to put on anyone). Anyone can
// save them; the host loads them, and the server checks every value like any other rule edit.
// Version 2 keys own settings by who players are (with the names they went by); version 1 files
// went by name, and still load: the first person with that name takes them over.

const VERSION = 2;
const MAX_BYTES = 1 << 20;      // a settings file is a few KB; anything this big isn't one

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
const fileSafe = (s) => s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'player';

/** The whole setup as a file: every rule's value, each player's own settings (by key, with the
 *  names they go by), and the bots: the host's own, the flags and each team's lineup. */
export function setupFile(rules, players, labels = {}, bots = null) {
  return {
    dodgeball: 'settings', version: VERSION, saved: new Date().toISOString(),
    rules: { ...rules }, players: JSON.parse(JSON.stringify(players ?? {})), labels: { ...labels },
    ...(bots ? { bots: JSON.parse(JSON.stringify(bots)) } : {}),
  };
}

/** One player's own settings as a file. */
export function playerFile(name, settings) {
  return { dodgeball: 'player', version: VERSION, saved: new Date().toISOString(), name, settings: { ...settings } };
}

export const setupFileName = () => `dodgeball-settings-${stamp()}.json`;
export const playerFileName = (name) => `dodgeball-player-${fileSafe(name)}-${stamp()}.json`;

function parse(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error("That file is far too big to be a Dodgeball settings file");
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Dodgeball settings file (it isn't JSON)");
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error("That file isn't a Dodgeball settings file");
  return data;
}

const ruleLike = (data, known) => Object.keys(data).some((k) => known.has(k));

/** A file for the whole setup -> {rules, players}. Takes this game's own files, the server's
 *  saved_rules.json ({rules, players}), and older saved_rules.json files (just the rules). */
export function readSetup(text, known) {
  const data = parse(text);
  if (data.dodgeball === 'player') throw new Error("That's one player's own settings: load it from that player's ⚙ in the lobby");
  if (data.rules && typeof data.rules === 'object') {
    return { rules: data.rules, players: data.players ?? {}, labels: data.labels ?? {}, bots: data.bots ?? null };
  }
  if (ruleLike(data, known)) return { rules: data, players: {} };
  throw new Error("That file isn't a Dodgeball settings file");
}

/** A file with one player's own settings -> those settings. */
export function readPlayer(text, known) {
  const data = parse(text);
  if (data.dodgeball === 'settings' || (data.rules && typeof data.rules === 'object')) {
    throw new Error("That's a whole setup: load it with Import settings in the lobby");
  }
  if (data.dodgeball === 'player' && data.settings && typeof data.settings === 'object') return data.settings;
  if (ruleLike(data, known)) return data;
  throw new Error("That file isn't a player's settings file");
}

/** The last file saved, for tests: {name, text}. */
export const last = { name: null, text: null };

/** Saves `data` as a .json file in the Downloads folder. */
export function download(name, data) {
  const text = JSON.stringify(data, null, 1);
  last.name = name;
  last.text = text;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** Lets the person pick a .json file. Resolves {name, text} (text: null for a file far too big to
 *  be one), or null if they cancelled. */
export function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, text: file.size > MAX_BYTES ? null : await file.text() } : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
