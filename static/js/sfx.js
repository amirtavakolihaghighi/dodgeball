// Synthesized sound effects (no audio files). Only the focused tab makes noise, so several
// test tabs open on one computer don't all play at once.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
  }

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    this.master.gain.value = this.volume;
    this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running' && this.volume > 0 && document.hasFocus();
  }

  tone(freq, dur, { type = 'sine', gain = 0.3, slide = 1, delay = 0 } = {}) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur, { freq = 1000, q = 1, gain = 0.3, slide = 1, delay = 0 } = {}) {
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
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  throw(power = 0.5, vol = 1) { this.noise(0.2, { freq: 500 + power * 900, slide: 2.2, gain: 0.32 * vol }); }
  catch(perfect, vol = 1) {
    this.tone(150, 0.14, { type: 'triangle', gain: 0.5 * vol, slide: 0.55 });
    this.noise(0.05, { freq: 2500, gain: 0.15 * vol });
    if (perfect) this.perfect(vol);
  }
  perfect(vol = 1) {
    this.tone(1320, 0.4, { gain: 0.16 * vol });
    this.tone(1980, 0.45, { gain: 0.1 * vol, delay: 0.05 });
  }
  deflect(rally, perfect, vol = 1) {
    const f = 480 + Math.min(rally, 8) * 90;
    this.tone(f, 0.14, { type: 'square', gain: 0.13 * vol, slide: 1.6 });
    this.noise(0.09, { freq: 3200, gain: 0.25 * vol });
    if (perfect) this.perfect(vol);
  }
  hit(vol = 1) {
    this.tone(95, 0.25, { gain: 0.65 * vol, slide: 0.45 });
    this.noise(0.12, { freq: 420, gain: 0.35 * vol });
  }
  ko() { this.tone(420, 0.7, { type: 'sawtooth', gain: 0.12, slide: 0.25 }); }
  dodge(perfect) {
    this.noise(0.16, { freq: 1600, slide: 0.45, gain: 0.18 });
    if (perfect) this.perfect(0.8);
  }
  ricochet(vol = 1) {
    this.tone(1900, 0.09, { type: 'square', gain: 0.07 * vol, slide: 0.55 });
    this.noise(0.06, { freq: 4200, gain: 0.22 * vol });
  }
  warn() { this.tone(900, 0.05, { type: 'square', gain: 0.05 }); }
  deny() { this.tone(150, 0.12, { type: 'square', gain: 0.1 }); }
  revive() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, { gain: 0.15, delay: i * 0.08 })); }
  beep(high) { this.tone(high ? 1046 : 523, high ? 0.3 : 0.12, { type: 'triangle', gain: 0.22 }); }
}
