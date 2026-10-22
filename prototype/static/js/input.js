// Keyboard + mouse with pointer lock.
// Everything is released when the tab loses focus or the mouse is freed, so a player in a
// background tab never keeps running or stays stuck charging a throw.

const KEY_ACTIONS = {
  Space: 'dodge', ShiftLeft: 'dodge', ShiftRight: 'dodge',
  KeyF: 'catch', KeyE: 'deflect', KeyR: 'revive', KeyH: 'ring', Tab: 'scores',
};
const MOUSE_ACTIONS = { 0: 'throw', 2: 'catch' };

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.buttons = new Set();
    this.dx = 0;
    this.dy = 0;
    this.locked = false;
    // ?nolock lets automated tests drive the game without pointer lock.
    this.free = new URLSearchParams(location.search).has('nolock');
    this.onPress = () => {};
    this.onRelease = () => {};
    this.onCancel = () => {};
    this.onLockChange = () => {};

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.releaseAll();
      this.onLockChange(this.locked);
    });
    addEventListener('keydown', (e) => this.key(e, true));
    addEventListener('keyup', (e) => this.key(e, false));
    addEventListener('mousedown', (e) => this.button(e, true));
    addEventListener('mouseup', (e) => this.button(e, false));
    addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.dx += e.movementX;
        this.dy += e.movementY;
      }
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => document.hidden && this.releaseAll());
  }

  get active() {
    return this.locked || this.free;
  }

  lock() {
    if (this.free) return this.onLockChange(true);
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => this.onLockChange(false));
    } catch {
      this.onLockChange(false);
    }
  }

  key(e, down) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === 'Tab' || (e.code === 'Space' && this.active)) e.preventDefault();
    const action = KEY_ACTIONS[e.code];
    if (!down) {
      if (this.keys.delete(e.code) && action) this.onRelease(action);
      return;
    }
    if (this.keys.has(e.code) || (!this.active && e.code !== 'Tab')) return;   // ignore auto-repeat
    this.keys.add(e.code);
    if (action) this.onPress(action);
  }

  button(e, down) {
    const action = MOUSE_ACTIONS[e.button];
    if (!action) return;
    if (!down) {
      if (this.buttons.delete(action)) this.onRelease(action);
    } else if (this.active && !this.buttons.has(action)) {
      this.buttons.add(action);
      this.onPress(action);
    }
  }

  releaseAll() {
    const tabHeld = this.keys.has('Tab');
    this.keys.clear();
    this.buttons.clear();
    if (tabHeld) this.onRelease('scores');
    this.onCancel();
  }

  /** Movement keys as forward / right in -1..1. */
  axis() {
    const k = this.keys;
    return {
      f: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
      r: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
    };
  }

  takeMouse() {
    const d = [this.dx, this.dy];
    this.dx = this.dy = 0;
    return d;
  }
}
