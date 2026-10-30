// The sound check page (sounds.html): every sound the game plays, on buttons, so a person can
// judge them (Claude can't hear). It uses the game's own Sfx and the volumes saved by the game.
import { Sfx, KINDS, LEVELS } from './sfx.js';

const $ = (id) => document.getElementById(id);
const sfx = new Sfx();
const settings = { volume: 0.6, levels: { ...LEVELS } };
try {
  const saved = JSON.parse(localStorage.getItem('dp.settings') || '{}');
  settings.volume = saved.volume ?? settings.volume;
  settings.levels = { ...LEVELS, ...saved.levels };
} catch { /* defaults */ }
sfx.setVolume(settings.volume);
for (const kind of KINDS) sfx.setLevel(kind, settings.levels[kind]);
sfx.setEar(0, 0, 0, 1);         // standing at the middle, looking along +z: +x is on the left

const LEFT = { x: 6, z: 3 };
const RIGHT = { x: -6, z: 3 };
const FAR = { x: 0, z: 24 };

function save() {
  try {
    const saved = JSON.parse(localStorage.getItem('dp.settings') || '{}');
    localStorage.setItem('dp.settings', JSON.stringify({ ...saved, volume: settings.volume, levels: settings.levels }));
  } catch { /* ignore */ }
}

const NAMES = { volume: 'Volume', music: 'Music', effects: 'Effects', announcer: 'Announcer', interface: 'Interface', crowd: 'Crowd' };
for (const key of ['volume', 'music', 'effects', 'announcer', 'interface', 'crowd']) {
  const label = document.createElement('label');
  label.textContent = NAMES[key];
  const slider = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1, step: 0.05 });
  slider.value = key === 'volume' ? settings.volume : settings.levels[key];
  slider.addEventListener('input', () => {
    if (key === 'volume') sfx.setVolume(settings.volume = Number(slider.value));
    else sfx.setLevel(key, settings.levels[key] = Number(slider.value));
    save();
  });
  label.append(slider);
  $('levels').append(label);
}

// Back to the game: this page opened in its own tab, so close it; if it can't be closed (it was
// opened some other way), go to the game instead.
$('backBtn').addEventListener('click', () => {
  window.close();
  setTimeout(() => { location.href = '/'; }, 200);
});

// Out of breath, for a few seconds (the game calls breathe() every frame; so does this page).
let tired = 0;
let tiredUntil = 0;
const breathing = () => {
  sfx.breathe(performance.now() < tiredUntil ? tired : 0);
  requestAnimationFrame(breathing);
};
requestAnimationFrame(breathing);
const tiredFor = (level, ms) => {
  tired = level;
  tiredUntil = performance.now() + ms;
};

let started = false;
async function start() {
  if (!started) {
    started = true;
    sfx.unlock();
    sfx.setFocus(true);
    await sfx.loading;
    $('state').textContent = sfx.bank ? 'Sound is on.' : `The recordings didn't load (${sfx.loadError}); you hear the synthesized fallback.`;
    listRecordings();
  }
  sfx.unlock();
}

function card(parent, title, buttons, src = '') {
  const div = document.createElement('div');
  div.className = 'item';
  const b = document.createElement('b');
  b.textContent = title;
  div.append(b);
  for (const [text, fn] of buttons) {
    const button = document.createElement('button');
    button.className = 'small';
    button.textContent = text;
    button.addEventListener('click', async () => {
      await start();
      fn();
    });
    div.append(button);
  }
  if (src) {
    const s = document.createElement('div');
    s.className = 'src';
    s.textContent = src;
    div.append(s);
  }
  parent.append(div);
}

const M = $('moments');
card(M, 'Your throw', [['Soft', () => sfx.throw(0.15)], ['Medium', () => sfx.throw(0.5)], ['Hard', () => sfx.throw(1)]]);
card(M, "Someone else's throw", [['From the left', () => sfx.throw(0.7, LEFT)], ['From the right', () => sfx.throw(0.7, RIGHT)], ['Far away', () => sfx.throw(0.7, FAR)]]);
card(M, 'You get hit', [['Hit', () => sfx.hit(null, { mine: true, who: 1 })], ['Knocked out', () => sfx.hit(null, { mine: true, ko: true, who: 1 })]]);
card(M, 'Your throw lands', [['Near', () => sfx.hit(LEFT, { mineThrew: true, who: 2 })], ['Far away', () => sfx.hit(FAR, { mineThrew: true, who: 2 })], ['Knockout', () => sfx.hit(FAR, { mineThrew: true, ko: true, who: 2 })]]);
card(M, 'Someone else is hit', [['From the left', () => sfx.hit(LEFT, { who: 3 })], ['From the right', () => sfx.hit(RIGHT, { who: 3 })], ['Far away', () => sfx.hit(FAR, { who: 3 })]]);
card(M, 'The four voices (each player keeps one)', [0, 1, 2, 3].flatMap((v) => [
  [`${v + 1}: hit`, () => sfx.hit(null, { who: v })], [`${v + 1}: knocked out`, () => sfx.hit(null, { ko: true, who: v })],
]));
card(M, 'Catch', [['Yours', () => sfx.catch(null)], ['Perfect', () => sfx.catch(null, true)], ['From the left', () => sfx.catch(LEFT)], ['Far away', () => sfx.catch(FAR)]]);
card(M, 'Deflect', [['Rally ×1', () => sfx.deflect(null, 1)], ['×4', () => sfx.deflect(null, 4)], ['×8', () => sfx.deflect(null, 8)], ['Perfect', () => sfx.deflect(null, 2, true)], ['From the right', () => sfx.deflect(RIGHT, 3)]]);
card(M, 'Dodge (the dash)', [['Your dash', () => sfx.dash()], ['Perfect dodge', () => { sfx.dash(); sfx.perfect(0.8); }], ['Someone else, from the left', () => sfx.dash(LEFT)]]);
card(M, 'Out of breath (low stamina)', [['Very tired, 4 s', () => tiredFor(1, 4000)], ['A little tired, 4 s', () => tiredFor(0.3, 4000)]]);
card(M, 'Someone is revived', [['On your team', () => sfx.revive(true)], ['On the other team', () => sfx.revive(false)]]);
card(M, 'Ball bounces', [['Floor, near', () => sfx.bounce({ x: 1, z: 3 }, true)], ['Floor, far', () => sfx.bounce(FAR, true)], ['Wall, left', () => sfx.bounce(LEFT, false)]]);
card(M, 'Interface', [['Incoming ball', () => sfx.warn()], ['Countdown', () => sfx.beep(false)], ['Not now', () => sfx.deny()], ['Team health bought', () => sfx.heal()]]);
card(M, 'A round', [
  ['Round 1', () => sfx.say('round1')], ['Final round', () => sfx.say('final')], ['Start', () => sfx.roundStart()],
  ['Won', () => { sfx.whistle(true); sfx.crowd('cheer'); }],
  ['Draw', () => { sfx.whistle(true); sfx.crowd('applause'); sfx.say('tie', 0.9); }],
]);
card(M, 'The match ends', [
  ['You win', () => { sfx.whistle(true); sfx.crowd('big'); sfx.say('win', 0.9); }],
  ['You lose', () => { sfx.whistle(true); sfx.crowd('big'); sfx.say('lose', 0.9); }],
]);

card($('music'), 'Music', [
  ['Lobby', () => sfx.setMusic('lobby')], ['Match', () => sfx.setMusic('match')],
  ['Match, while a round is played', () => sfx.setMusic('duck')], ['Stop', () => sfx.setMusic(null)],
], 'MintoDog, “Sunny City” (the lobby) and its faster climax version (the match); CC0');

function kindOf(name) {
  if (name.startsWith('voice.') || name.startsWith('whistle.')) return 'announcer';
  if (name.startsWith('crowd.')) return 'crowd';
  if (name.startsWith('ui.')) return 'interface';
  return 'effects';
}

function listRecordings() {
  if (!sfx.bank) return;
  for (const [name, variants] of Object.entries(sfx.bank.sounds)) {
    const from = [...new Set(sfx.bank.from[name])].join('; ');
    card($('sounds'), name, variants.map((_, i) => [String(i + 1), () => sfx.play(name, { kind: kindOf(name), variant: i, vary: false })]), from);
  }
}
