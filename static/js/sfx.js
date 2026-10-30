// Sound: CC0 recordings mixed with Web Audio (decision 132), with synthesized sounds as a fallback
// while they load or when the browser can't decode them.
//
// static/sounds/sfx.oga holds every short sound one after another, and sfx.json says where each
// variant starts (art/sounds.py builds both from the sources in THIRD_PARTY_NOTICES.md). Each
// sound belongs to a kind with its own volume under the master volume. Sounds come from where they
// happen (left or right, quieter far away), and the hall's echo is one shared reverb that farther
// sounds feed more. A limiter keeps a pile-up from clipping.
//
// Only the focused tab makes noise, so several test tabs on one computer don't all play at once.

export const KINDS = ['effects', 'interface', 'announcer', 'crowd', 'music'];
export const LEVELS = { effects: 1, interface: 0.8, announcer: 0.8, crowd: 0.6, music: 0.5 };   // the defaults
const ECHO = { effects: 0.3, interface: 0, announcer: 0.25, crowd: 0.35, music: 0 };   // share sent to the hall's echo
const MAX_VOICES = 40;          // more at once are skipped (a dozen bounces in one frame)
const RANGE = 30;               // metres: quieter with distance, down to a quarter this far away
const MATCH_MUSIC = 0.45;       // the match music's level between rounds (the lobby's is 1)...
const DUCK = 0.22;              // ...and while a round is played: low, in the background (the user's call)
const VOICES = 4;               // players' voices (hurt.0..3, ko.0..3); each player keeps one
const INCOMING = 1.6;           // the incoming-ball whoosh's peak: filtered noise is quiet, and it must be heard
const RESTART_AFTER = 20000;    // ms: music stopped this long starts over from the top

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** A player's voice: one of the recorded voices, a little higher or lower, the same every time. */
export function voiceOf(id) {
  const n = Math.abs(Math.round(id)) || 0;
  return { n: n % VOICES, rate: 0.94 + ((n * 7) % 5) * 0.03 };
}

/** A sports hall's echo: a short gap, a few reflections off the floor and walls, then a tail of
 *  about 1.4 s whose highs die first. */
function hallEcho(ctx) {
  const rate = ctx.sampleRate;
  const n = Math.floor(rate * 1.6);
  const ir = ctx.createBuffer(2, n, rate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let low = 0;
    for (let i = Math.floor(rate * 0.012); i < n; i++) {
      const t = i / rate;
      low += (Math.random() * 2 - 1 - low) * (0.12 + 0.8 * Math.exp(-t * 3));   // the filter closes over time
      d[i] = low * Math.exp(-6.9 * t / 1.4);
    }
    for (const [ms, g] of [[17, 0.5], [29, 0.35], [41, 0.3], [58, 0.22], [73, 0.18]]) {
      d[Math.floor(rate * (ms + c * 3) / 1000)] += c ? -g : g;
    }
  }
  return ir;
}

export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;                  // the master volume
    this.levels = { ...LEVELS };
    this.bank = null;                   // { buffer, sounds: { name: [[start, length], ...] }, from }
    this.voices = 0;
    this.last = {};                     // the variant each sound played last (never twice in a row)
    this.recent = {};                   // when each sound last started: twice within 25 ms plays once
    this.ear = { x: 0, z: 0, fx: 0, fz: 1 };
    this.musicMode = null;
    this.focused = true;
    this.count = {};                    // plays of each sound, for the tests
  }

  unlock() {
    if (!this.ctx) this.build();
    this.applyLevels();
    this.ctx.resume();
    this.updateMusic();                 // music is refused until the page has had a click
  }

  build() {
    // 48 kHz whatever the sound card runs at (some run at 192 kHz): the decoded sounds take a
    // quarter of the memory there, and the echo a quarter of the work
    let ctx;
    try {
      ctx = new AudioContext({ sampleRate: 48000 });
    } catch {
      ctx = new AudioContext();
    }
    this.ctx = ctx;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.connect(this.limiter).connect(ctx.destination);
    this.echo = ctx.createConvolver();
    this.echo.buffer = hallEcho(ctx);
    this.echo.connect(this.master);
    this.dry = {};
    this.wet = {};
    for (const kind of KINDS) {
      this.dry[kind] = ctx.createGain();
      this.dry[kind].connect(this.master);
      this.wet[kind] = ctx.createGain();
      this.wet[kind].connect(this.echo);
    }
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.tracks = {};
    for (const name of ['lobby', 'match']) {
      const el = new Audio(`/static/sounds/music-${name}.oga`);
      el.loop = true;
      el.preload = name === 'lobby' ? 'auto' : 'metadata';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      ctx.createMediaElementSource(el).connect(gain).connect(this.dry.music);
      this.tracks[name] = { el, gain, stoppedAt: -Infinity };
    }
    this.focused = document.hasFocus();
    addEventListener('focus', () => this.setFocus(true));
    addEventListener('blur', () => this.setFocus(false));
    this.loading = this.load();
  }

  async load() {
    try {
      const [meta, data] = await Promise.all([
        fetch('/static/sounds/sfx.json').then((r) => r.json()),
        fetch('/static/sounds/sfx.oga').then((r) => r.arrayBuffer()),
      ]);
      this.bank = { buffer: await this.ctx.decodeAudioData(data), sounds: meta.sounds, from: meta.from };
    } catch (err) {
      this.loadError = String(err);     // the synthesized sounds stay
      console.warn('Sounds could not be loaded; using the synthesized ones.', err);
    }
    this.onLoaded?.(this.loadError ?? null);
  }

  setVolume(v) {
    this.volume = v;
    this.applyLevels();
  }

  setLevel(kind, v) {
    this.levels[kind] = v;
    this.applyLevels();
  }

  setFocus(on) {
    this.focused = on;
    this.applyLevels();
  }

  applyLevels() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.focused ? this.volume : 0, t, 0.03);
    for (const kind of KINDS) {
      this.dry[kind].gain.setTargetAtTime(this.levels[kind], t, 0.03);
      this.wet[kind].gain.setTargetAtTime(this.levels[kind] * ECHO[kind], t, 0.03);
    }
    this.updateMusic();
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running' && this.volume > 0 && this.focused;
  }

  /** Where the camera is and which way it looks (x and z, a unit vector), every frame. */
  setEar(x, z, fx, fz) {
    const e = this.ear;
    e.x = x;
    e.z = z;
    e.fx = fx;
    e.fz = fz;
  }

  /** Plays a variant of a sound. pos: where it happens ({x, z}); none for your own and the interface's.
   *  floor: the quietest distance makes it (a quarter, unless it matters more). */
  play(name, { kind = 'effects', pos = null, gain = 1, rate = 1, delay = 0, vary = true, floor = 0.25, variant = -1 } = {}) {
    const list = this.ok && this.bank?.sounds[name];
    if (!list) return false;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (this.voices >= MAX_VOICES || now - (this.recent[name] ?? -1) < 0.025) return false;
    this.recent[name] = now;
    let i = variant >= 0 ? variant % list.length : Math.floor(Math.random() * list.length);
    if (variant < 0 && list.length > 1 && i === this.last[name]) i = (i + 1) % list.length;
    this.last[name] = i;
    let far = 0;
    const pan = this.panOf(pos);
    if (pos) {
      far = Math.min(1, Math.hypot(pos.x - this.ear.x, pos.z - this.ear.z) / RANGE);
      gain *= Math.max(floor, 1 - far);
    }
    if (vary) {                         // no two alike: a little pitch and level each time
      rate *= 1 + (Math.random() - 0.5) * 0.08;
      gain *= 1 - Math.random() * 0.15;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.bank.buffer;
    src.playbackRate.value = rate;
    let out = ctx.createGain();
    out.gain.value = gain;
    src.connect(out);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out = out.connect(p);
    }
    out.connect(this.dry[kind]);
    if (ECHO[kind]) {
      const send = ctx.createGain();
      send.gain.value = 0.6 + 0.8 * far;          // far away, you hear more of the hall than of the thing
      out.connect(send).connect(this.wet[kind]);
    }
    const [start, length] = list[i];
    src.start(now + delay, start, length);
    this.voices++;
    src.onended = () => this.voices--;
    this.count[name] = (this.count[name] || 0) + 1;
    return true;
  }

  /** Left (−) or right (+) of the camera, up to 75%; 0 for no position. */
  panOf(pos) {
    if (!pos) return 0;
    const dx = pos.x - this.ear.x;
    const dz = pos.z - this.ear.z;
    const d = Math.hypot(dx, dz);
    return d > 0.5 ? 0.75 * clamp((dz * this.ear.fx - dx * this.ear.fz) / d, -1, 1) : 0;
  }

  /** How loud a synthesized fallback is from where it happens (as the recordings are). */
  near(pos) {
    return pos ? Math.max(0.25, 1 - Math.hypot(pos.x - this.ear.x, pos.z - this.ear.z) / RANGE) : 1;
  }

  // ---------------------------------------------------------------- the game's sounds

  throw(power = 0.5, pos = null) {
    if (!this.play('throw', { pos, gain: 0.45 + 0.35 * power, rate: 0.85 + 0.35 * power }) && !this.bank) {
      this.noise(0.2, { freq: 500 + power * 900, slide: 2.2, gain: 0.32 * this.near(pos) * (pos ? 0.6 : 1) });
    }
  }

  /** A ball hits someone (who: their id, for their voice). mine: it hit you; mineThrew: your throw
   *  landed (loud wherever it is). They grunt, or cry out and fall if it knocked them out. */
  hit(pos, { ko = false, mine = false, mineThrew = false, who = 0 } = {}) {
    const floor = mineThrew ? 0.8 : 0.25;
    if (this.play('hit.thump', { pos, gain: mine ? 1 : 0.85, rate: ko ? 0.82 : 1, floor })) {
      this.play('hit.body', { pos, gain: 0.55, floor });
      const voice = voiceOf(who);
      this.play(`${ko ? 'ko' : 'hurt'}.${voice.n}`, { pos, gain: mine ? 0.8 : 0.7, rate: voice.rate, floor, delay: 0.03 });
      if (ko) this.play('bodyfall', { pos, gain: 0.7, floor, delay: 0.45 });     // when the figure reaches the floor
    } else if (!this.bank) {
      const vol = mine ? 1 : mineThrew ? 0.8 : this.near(pos) * 0.5;
      this.tone(95, 0.25, { gain: 0.65 * vol, slide: 0.45 });
      this.noise(0.12, { freq: 420, gain: 0.35 * vol });
    }
    if (mine) this.tone(70, 0.35, { gain: 0.45, slide: 0.5 });   // a low boom you feel
    if (mine && ko) this.tone(420, 0.7, { type: 'sawtooth', gain: 0.08, slide: 0.25, kind: 'interface' });
  }

  bounce(pos, floor = true) {
    if (!this.play(floor ? 'bounce.floor' : 'bounce.wall', { pos, gain: 0.7 }) && !this.bank) {
      const vol = this.near(pos);
      this.tone(1900, 0.09, { type: 'square', gain: 0.07 * vol, slide: 0.55 });
      this.noise(0.06, { freq: 4200, gain: 0.22 * vol });
    }
  }

  /** perfect: your own perfect catch (the chime). */
  catch(pos, perfect = false) {
    if (this.play('catch', { pos, gain: 0.8 })) {
      this.play('bounce.floor', { pos, gain: 0.45, rate: 0.85 });
    } else if (!this.bank) {
      const vol = pos ? this.near(pos) * 0.5 : 1;
      this.tone(150, 0.14, { type: 'triangle', gain: 0.5 * vol, slide: 0.55 });
      this.noise(0.05, { freq: 2500, gain: 0.15 * vol });
    }
    if (perfect) this.perfect();
  }

  /** rally: how many times this ball has been deflected; it rises in pitch as the rally grows. */
  deflect(pos, rally = 1, perfect = false) {
    const r = Math.min(rally, 8);
    const vol = pos ? this.near(pos) * 0.6 : 1;
    if (this.play('deflect', { pos, gain: 0.8, rate: 1 + 0.04 * r })) {
      this.play('bounce.wall', { pos, gain: 0.5, rate: 1.05 + 0.05 * r });
      this.tone(480 + r * 90, 0.12, { type: 'square', gain: 0.05 * vol, slide: 1.6 });
    } else if (!this.bank) {
      this.tone(480 + r * 90, 0.14, { type: 'square', gain: 0.13 * vol, slide: 1.6 });
      this.noise(0.09, { freq: 3200, gain: 0.25 * vol });
    }
    if (perfect) this.perfect();
  }

  /** A dash (the dodge's): a whoosh and a push-off, then the feet landing hard as it ends (it lasts
   *  0.22 s). Yours when you press; pos: someone else's, when it took them out of a ball's way. */
  dash(pos = null) {
    const g = pos ? 0.7 : 1;
    if (this.play('dash.whoosh', { pos, gain: 0.6 * g, rate: 1.1 })) {
      this.play('dash.push', { pos, gain: 0.5 * g });
      this.play('dash.land', { pos, gain: 0.95 * g, delay: 0.18 });
      if (!pos) this.tone(62, 0.16, { gain: 0.32, slide: 0.6, delay: 0.18 });      // the weight behind it
    } else if (!this.bank) this.noise(0.16, { freq: 1600, slide: 0.45, gain: 0.18 * this.near(pos) });
  }

  /** Out of breath: level 0..1 every frame (0: not tired). The panting repeats, louder and a little
   *  faster the more tired, and goes on for a moment after you've recovered. */
  breathe(level) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (level > 0) this.breathUntil = now + 2.5;
    const want = level > 0 ? 0.35 + 0.65 * level : now < (this.breathUntil ?? 0) ? 0.3 : 0;
    const loop = this.bank?.sounds.breath?.[0];
    if (want > 0 && !this.breath && this.ok && loop) {
      const [start, length] = loop;
      const src = this.ctx.createBufferSource();
      src.buffer = this.bank.buffer;
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = start + length;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.dry.effects);
      src.start(now, start + Math.random() * length * 0.8);
      this.breath = { src, gain, level: 0, stopAt: 0 };
      this.count.breath = (this.count.breath || 0) + 1;
    }
    const b = this.breath;
    if (!b) return;
    if (Math.abs(want - b.level) > 0.02) {
      b.level = want;
      b.gain.gain.setTargetAtTime(want * 0.6, now, want > 0 ? 0.25 : 0.6);
      b.src.playbackRate.setTargetAtTime(1 + 0.12 * level, now, 0.5);
    }
    if (want > 0) b.stopAt = 0;
    else if (!b.stopAt) b.stopAt = now + 2.5;     // after the fade
    else if (now > b.stopAt) {
      b.src.stop();
      this.breath = null;
    }
  }

  perfect(vol = 1) {
    this.tone(1320, 0.4, { gain: 0.16 * vol, kind: 'interface' });
    this.tone(1980, 0.45, { gain: 0.1 * vol, delay: 0.05, kind: 'interface' });
  }

  /** A ball coming at you, tti seconds away (once per ball). style, the player's choice:
   *  'whoosh': air swelling from the ball's side, loudest as it arrives, the moment to press;
   *  'tick': a short beep; 'off': nothing. */
  incoming(style, tti = 0.6, pos = null) {
    if (style === 'tick') return this.tone(900, 0.07, { type: 'square', gain: 0.2, kind: 'interface' });
    if (style !== 'whoosh' || !this.ok) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = clamp(tti, 0.2, 0.9);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const band = ctx.createBiquadFilter();       // the pitch rises as it closes in
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(350, t);
    band.frequency.exponentialRampToValueAtTime(1600, t + dur);
    const g = ctx.createGain();                // from 30 dB under its peak: heard from the start
    g.gain.setValueAtTime(INCOMING / 30, t);
    g.gain.exponentialRampToValueAtTime(INCOMING, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.12);
    let out = src.connect(band).connect(g);
    const pan = this.panOf(pos);
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      out = out.connect(p);
    }
    out.connect(this.dry.interface);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.15);
    this.count.incoming = (this.count.incoming || 0) + 1;
  }

  deny() {
    if (!this.play('ui.deny', { kind: 'interface', gain: 0.5, vary: false }) && !this.bank) {
      this.tone(150, 0.12, { type: 'square', gain: 0.1, kind: 'interface' });
    }
  }

  /** Someone is revived. For their team an entrance: a deep drum, a ringing bell and the rising
   *  chime. For the other team a danger: the drum lower, a horn an octave down, a rumble. */
  revive(ally = true) {
    if (this.play('revive.boom', ally ? { gain: 0.9, vary: false } : { gain: 0.85, rate: 0.72, vary: false })) {
      if (ally) {
        this.play('revive.shine', { gain: 0.4, vary: false });
        this.play('ui.revive', { kind: 'interface', gain: 0.45, vary: false, delay: 0.05 });
      } else {
        this.play('revive.horn', { gain: 0.45, rate: 0.5, vary: false, delay: 0.04 });
        this.tone(48, 1.4, { gain: 0.3, slide: 0.8 });
      }
    } else if (!this.bank) {
      if (ally) this.chord();
      else this.tone(110, 0.8, { type: 'sawtooth', gain: 0.1, slide: 0.5 });
    }
  }

  heal() {
    if (!this.play('ui.heal', { kind: 'interface', gain: 0.6, vary: false }) && !this.bank) this.chord();
  }

  chord() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, { gain: 0.15, delay: i * 0.08, kind: 'interface' })); }

  beep(high) { this.tone(high ? 1046 : 523, high ? 0.3 : 0.12, { type: 'triangle', gain: 0.22, kind: 'interface' }); }

  /** The announcer: round1..round5, final, ready, fight, win, lose, tie, over. */
  say(line, delay = 0) { return this.play(`voice.${line}`, { kind: 'announcer', gain: 0.9, delay, vary: false }); }

  whistle(long = false) {
    return this.play(long ? 'whistle.long' : 'whistle.short', { kind: 'announcer', gain: 0.35, vary: false });
  }

  /** cheer, applause or big. */
  crowd(kind) { return this.play(`crowd.${kind}`, { kind: 'crowd', gain: 0.6, vary: false }); }

  /** A round starts: the whistle and "Fight!" (a beep until the recordings have loaded). */
  roundStart() {
    if (this.whistle()) this.say('fight', 0.15);
    else this.beep(true);
  }

  // ---------------------------------------------------------------- music

  /** null (none), 'lobby', 'match', or 'duck' (a round is being played: the match music, quieter). */
  setMusic(mode) {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    this.updateMusic();
  }

  updateMusic() {
    if (!this.tracks) return;
    const t = this.ctx.currentTime;
    const want = this.musicMode === 'lobby' ? 'lobby' : this.musicMode ? 'match' : null;
    for (const [name, track] of Object.entries(this.tracks)) {
      const on = name === want && this.focused && this.volume > 0 && this.levels.music > 0;
      const level = this.musicMode === 'lobby' ? 1 : this.musicMode === 'duck' ? DUCK : MATCH_MUSIC;
      track.gain.gain.setTargetAtTime(on ? level : 0, t, on ? 0.5 : 0.3);
      clearTimeout(track.stop);
      if (on && track.el.paused) {
        if (performance.now() - track.stoppedAt > RESTART_AFTER) track.el.currentTime = 0;
        track.el.play().catch(() => {});    // refused until the page has had a click: unlock() tries again
      } else if (!on && !track.el.paused) {
        track.stop = setTimeout(() => {     // after the fade
          track.el.pause();
          track.stoppedAt = performance.now();
        }, 1500);
      }
    }
  }

  // ---------------------------------------------------------------- synthesized sounds

  tone(freq, dur, { type = 'sine', gain = 0.3, slide = 1, delay = 0, kind = 'effects' } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.dry[kind]);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, { freq = 1000, q = 1, gain = 0.3, slide = 1, delay = 0, kind = 'effects' } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.dry[kind]);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
