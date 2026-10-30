// The graphics setting: how sharp the picture is, and how many decorative effects are drawn.
//
// Auto (the default) watches the frame rate and steps down a level when it stays low, so a slow
// laptop stays smooth. A step down that doesn't raise the frame rate is undone: the game is then
// held back by something else (battery saver, a busy computer), and a softer picture wouldn't
// help. The host's computer also runs the server, so there Auto stays at Medium or lower.
// Nothing that matters for play changes with the level: balls, trails, the timing ring and the
// throw preview look the same everywhere, so a low setting is never a disadvantage.

export const LEVELS = ['low', 'medium', 'high'];
export const LEVEL_NAMES = { low: 'Low', medium: 'Medium', high: 'High' };
const ABOUT = {
  high: 'the sharpest picture and every effect',
  medium: 'a softer picture (3/4 of the sharpness) and every effect',
  low: 'a soft picture (half the sharpness) and fewer decorative effects',
};
// How much of the screen's sharpness each level draws, after the usual cap of 1.5 render pixels
// per page pixel (very sharp screens would otherwise cost a lot for little gain).
const SHARPNESS = { low: 0.5, medium: 0.75, high: 1 };
const MAX_PIXEL_RATIO = 1.5;
const DROP_FPS = 45;        // Auto: a second under this many frames is slow...
const DROP_AFTER = 3;       // ...and this many slow seconds in a row step down a level
const HELPED = 1.12;        // a step down must raise the frame rate by 12%, or it's undone
const RISE_FPS = 57;        // this many frames a second or more...
const RISE_AFTER = 20;      // ...for this many seconds in a row tries a level up
const RISES = 2;            // at most this many tries a session, so it can't keep see-sawing
const SETTLE = 2;           // seconds not counted after a change, while the picture is rebuilt

// What browsers report when they draw without a graphics card: Chrome's SwiftShader, Mesa's
// llvmpipe and softpipe on Linux, Windows' Basic Render Driver.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** The graphics card as the browser reports it, and whether the page is drawn without one. */
export function gpuInfo(renderer) {
  const gl = renderer.getContext();
  let gpu = null;
  let vendor = null;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    vendor = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
  } catch { /* not available */ }
  return { gpu, vendor, software: SOFTWARE.test(`${gpu} ${vendor}`) };
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

export class Graphics {
  /** choice: 'auto', 'high', 'medium' or 'low' (the player's saved setting). */
  constructor(world, choice, software) {
    this.world = world;
    this.software = software;
    this.ceiling = 'high';
    this.choice = ['auto', ...LEVELS].includes(choice) ? choice : 'auto';
    this.level = this.choice === 'auto' ? (software ? 'low' : 'high') : this.choice;
    this.why = this.choice === 'auto' && software ? 'the page is drawn without the graphics card' : '';
    this.fps = null;            // the latest second's frame rate
    this.onChange = () => {};   // (from, to, why): Auto changed the level by itself
    this.ups = 0;
    this.stuck = false;         // a step down didn't help: Auto stops changing things
    this.trial = null;          // after a step down: is it helping?
    this.slow = [];
    this.fast = 0;
    this.settle = SETTLE;
    this.secStart = null;
    this.frames = 0;
    this.lastMs = null;
    this.apply();
  }

  /** The render size and effects for the current level (also after the window is resized). */
  apply() {
    const ratio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO) * SHARPNESS[this.level];
    this.world.setQuality(this.level, ratio);
  }

  /** The player picked a setting in the menu. */
  choose(choice) {
    this.choice = choice;
    this.stuck = false;
    this.trial = null;
    this.ups = 0;
    this.why = choice === 'auto' && this.software ? 'the page is drawn without the graphics card' : '';
    this.change(choice === 'auto' ? (this.software ? 'low' : this.ceiling) : choice, '');
  }

  /** The host's computer runs the server too: Auto goes no higher than this there. */
  setCeiling(level) {
    this.ceiling = level;
    if (this.choice === 'auto' && LEVELS.indexOf(this.level) > LEVELS.indexOf(level)) {
      this.change(level, 'this computer also runs the server');
    }
  }

  change(level, why) {
    if (level === this.level) return;
    const from = this.level;
    this.level = level;
    if (why) this.why = why;
    this.slow = [];
    this.fast = 0;
    this.settle = SETTLE;
    this.apply();
    if (why) this.onChange(from, level, why);
  }

  /** Every rendered frame (ms on the performance.now clock). */
  frame(nowMs) {
    if (this.lastMs === null || nowMs - this.lastMs > 500) {
      // the first frame, or back after the tab was hidden or the page stalled: start afresh
      this.secStart = nowMs;
      this.frames = 0;
      this.lastMs = nowMs;
      return;
    }
    this.lastMs = nowMs;
    this.frames++;
    const span = nowMs - this.secStart;
    if (span < 1000) return;
    this.fps = (this.frames * 1000) / span;
    this.secStart = nowMs;
    this.frames = 0;
    if (this.choice === 'auto') this.watch(this.fps);
  }

  watch(fps) {
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    const i = LEVELS.indexOf(this.level);
    if (this.trial) {
      this.trial.seconds.push(fps);
      if (this.trial.seconds.length < 3) return;
      const after = mean(this.trial.seconds);
      const { from, before } = this.trial;
      this.trial = null;
      if (after < DROP_FPS && after < before * HELPED) {
        this.stuck = true;
        this.change(from, `a lower level didn't help (${Math.round(before)} → ${Math.round(after)} frames a second): something else holds the game back, like battery saver or a busy computer`);
      }
      return;
    }
    if (this.stuck) return;
    if (fps < DROP_FPS) {
      this.fast = 0;
      this.slow.push(fps);
      if (this.slow.length < DROP_AFTER) return;
      const before = mean(this.slow);
      this.slow = [];
      if (i === 0) return;
      const from = this.level;
      this.change(LEVELS[i - 1], `the frame rate was under ${DROP_FPS} (${Math.round(before)} frames a second)`);
      this.trial = { from, before, seconds: [] };
      return;
    }
    this.slow = [];
    this.fast = fps >= RISE_FPS ? this.fast + 1 : 0;
    if (this.fast >= RISE_AFTER && this.ups < RISES && i < LEVELS.indexOf(this.ceiling)) {
      this.ups++;
      this.change(LEVELS[i + 1], 'the frame rate has room to spare');
    }
  }

  /** For the menu: what the setting does now. */
  describe() {
    const name = LEVEL_NAMES[this.level];
    if (this.choice !== 'auto') return `${name}: ${ABOUT[this.level]}.`;
    let text = `Auto: ${name} now`;
    if (this.why) text += `, because ${this.why}`;
    text += `. It lowers itself if the game gets choppy (under ${DROP_FPS} frames a second).`;
    if (this.ceiling !== 'high') text += ' On the host\'s computer it stays at Medium or lower, because that computer also runs the server.';
    return text;
  }
}
