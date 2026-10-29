// Diagnostics log for this browser, to trace lag back to its cause. Every second it notes the
// frame rate, hitches, how late world updates arrive, how long the picture of other players
// stood frozen (no newer update to show), ping and inputs sent. It also notes moments: long
// hitches and freezes, presses and what came of them, connection drops, errors, the tab being
// hidden, and moments the player marked with L. It only counts; it never slows the game.
//
// Lines go to the host's computer every few seconds (the server's logs folder). They're also
// kept in this browser's storage until the server confirms them, so a page reloaded after a
// dropped connection still delivers them. "Save my log" downloads what this tab logged.

const FLUSH_MS = 5000;
const HITCH_MS = 150;       // a single frame this long is noted on its own...
const FREEZE_MS = 150;      // ...and so is a frozen picture this long
const KEEP_DAYS = 3;        // stored logs older than this are deleted
const KEY = 'dpl:';         // localStorage: dpl:<run>:meta, dpl:<run>:acked, dpl:<run>:<seq>

const r1 = (v) => Math.round(v * 10) / 10;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

/** This tab's id: the same across reloads (sessionStorage is per tab). */
function tabId() {
  try {
    let id = sessionStorage.getItem('dp.tab');
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('dp.tab', id);
    }
    return id;
  } catch {
    return 'notab';
  }
}

export class Diag {
  constructor() {
    this.run = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);   // this page load
    this.tab = tabId();
    this.name = '';
    this.lines = [];            // this tab's whole log (earlier page loads first), for "Save my log"
    this.pending = [];          // lines not yet bundled into a chunk
    this.unacked = new Map();   // `${run}:${seq}` -> chunk the server hasn't confirmed yet
    this.seq = 0;
    this.send = null;           // set when the server keeps logs: (message) => void
    this.clock = () => null;    // main.js: estimated server time now, in seconds
    this.context = () => ({});  // main.js: ping, round state, alive, pointer lock, view delay
    this.lastFrame = 0;
    this.lastJs = 0;
    this.wasHidden = false;
    this.frozenFor = 0;
    this.lastSnap = 0;
    this.gaps = [];             // [arrival ms, gap ms] of recent world updates
    this.seconds = 0;
    this.lastFlush = performance.now();
    this.resetSecond(performance.now());
    this.restore();
    document.addEventListener('visibilitychange', () => {
      this.log('vis', { hidden: document.hidden });
      if (document.hidden) {
        this.wasHidden = true;
        this.flush();
      }
    });
    addEventListener('focus', () => this.log('focus', { on: true }));
    addEventListener('blur', () => this.log('focus', { on: false }));
    addEventListener('error', (e) => this.log('error', { msg: String(e.message).slice(0, 200), at: `${e.filename}:${e.lineno}` }));
    addEventListener('unhandledrejection', (e) => this.log('error', { msg: String(e.reason).slice(0, 200) }));
    addEventListener('pagehide', () => this.flush());
  }

  resetSecond(now) {
    this.s = {
      start: now, frames: 0, ftMax: 0, long50: 0, long100: 0, jsSum: 0, jsMax: 0,
      snaps: 0, gapMax: 0, lateSum: 0, lateMax: 0, frozen: 0, ins: 0, stale: 0,
    };
  }

  log(ty, data = {}) {
    const st = this.clock();
    const line = { ty, wall: Date.now(), st: st === null ? null : Math.round(st * 1000) / 1000, ...data };
    this.lines.push(line);
    this.pending.push(line);
    return line;
  }

  count(key, n = 1) {
    this.s[key] += n;
  }

  /** Every rendered frame. `jsMs`: time spent in the frame's own code; `frozen`: no newer
   *  world update existed to show (the picture of other players stood still). */
  frame(now, jsMs, frozen) {
    const s = this.s;
    const interval = this.lastFrame ? now - this.lastFrame : 0;
    const resumed = this.wasHidden;     // that gap was the tab being hidden, not a hitch
    this.lastFrame = now;
    this.wasHidden = false;
    s.frames++;
    s.jsSum += jsMs;
    s.jsMax = Math.max(s.jsMax, jsMs);
    if (resumed) s.resumed = 1;
    else {
      s.ftMax = Math.max(s.ftMax, interval);
      if (interval > 50) s.long50++;
      if (interval > 100) s.long100++;
      if (interval >= HITCH_MS) this.log('hitch', { ms: Math.round(interval), js: r1(this.lastJs) });
    }
    this.lastJs = jsMs;
    if (frozen && !resumed) {
      s.frozen += interval;
      this.frozenFor += interval;
    } else if (!frozen && this.frozenFor) {
      if (this.frozenFor >= FREEZE_MS) {
        const recent = this.gaps.filter(([at]) => now - at < 3000).map(([, gap]) => gap);
        this.log('freeze', { ms: Math.round(this.frozenFor), gap: Math.round(Math.max(0, ...recent)) });
      }
      this.frozenFor = 0;
    }
    if (now - s.start >= 1000) this.second(now);
  }

  /** Every world update: `late` = how much later it arrived than the quickest one so far. */
  snapshot(now, lateMs) {
    const s = this.s;
    s.snaps++;
    if (this.lastSnap) {
      const gap = now - this.lastSnap;
      s.gapMax = Math.max(s.gapMax, gap);
      this.gaps.push([now, gap]);
      if (this.gaps.length > 120) this.gaps.shift();
    }
    this.lastSnap = now;
    s.lateSum += lateMs;
    s.lateMax = Math.max(s.lateMax, lateMs);
  }

  second(now) {
    const s = this.s;
    const span = now - s.start;
    const line = {
      span: Math.round(span), fps: r1((s.frames * 1000) / span), ft_max: Math.round(s.ftMax), long50: s.long50, long100: s.long100,
      js_avg: s.frames ? r1(s.jsSum / s.frames) : 0, js_max: r1(s.jsMax), snaps: s.snaps, gap_max: Math.round(s.gapMax),
      late_avg: s.snaps ? Math.round(s.lateSum / s.snaps) : null, late_max: s.snaps ? Math.round(s.lateMax) : null,
      frozen: Math.round(s.frozen), ins: s.ins, stale: s.stale, hidden: document.hidden ? 1 : 0,
      focus: document.hasFocus() ? 1 : 0, ...this.context(),
    };
    if (s.resumed) line.resumed = 1;     // the tab was hidden during this second: not lag

    if (++this.seconds % 10 === 0 && performance.memory) line.heap_mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
    this.log('sec', line);
    this.resetSecond(now);
    if (now - this.lastFlush >= FLUSH_MS) this.flush();
  }

  /** Bundles the new lines into a chunk: stored here, and sent to the server if it logs. */
  flush() {
    this.lastFlush = performance.now();
    if (!this.pending.length) return;
    const chunk = { run: this.run, seq: ++this.seq, lines: this.pending };
    this.pending = [];
    this.unacked.set(`${chunk.run}:${chunk.seq}`, chunk);
    if (chunk.seq === 1) this.store(`${KEY}${this.run}:meta`, { tab: this.tab, name: this.name, started: Date.now() });
    this.store(`${KEY}${this.run}:${chunk.seq}`, chunk.lines);
    this.upload(chunk);
  }

  upload(chunk) {
    this.send?.({ t: 'log', run: chunk.run, seq: chunk.seq, tab: this.tab, lines: chunk.lines });
  }

  /** The server stored everything up to chunk `seq` of page load `run`. */
  ack(run, seq) {
    for (const [key, chunk] of this.unacked) if (chunk.run === run && chunk.seq <= seq) this.unacked.delete(key);
    this.store(`${KEY}${run}:acked`, seq);
  }

  /** The server keeps logs: from now on send there, starting with anything an earlier page
   *  load of this browser never got confirmed (duplicates are fine: the server skips them). */
  connect(send) {
    this.send = send;
    this.flush();
    for (const chunk of this.unacked.values()) this.upload(chunk);
  }

  store(key, value) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return;
      } catch {
        if (!this.makeRoom()) return;     // storage blocked or full of unsent lines: the server still gets them
      }
    }
  }

  /** Frees storage: confirmed chunks of other page loads first, then this one's oldest. */
  makeRoom() {
    const confirmed = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const [prefix, run, part] = key.split(':');
        if (`${prefix}:` !== KEY || !/^\d+$/.test(part)) continue;
        if (Number(part) <= (read(`${KEY}${run}:acked`) ?? 0)) confirmed.push([run === this.run ? 1 : 0, Number(part), key]);
      }
    } catch {
      return false;
    }
    confirmed.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    confirmed.slice(0, Math.max(20, confirmed.length >> 2)).forEach(([, , key]) => remove(key));
    return confirmed.length > 0;
  }

  /** Earlier page loads of this browser: their unconfirmed chunks are sent again once
   *  connected, and this tab's own lines come back for "Save my log". Old logs are deleted. */
  restore() {
    const runs = new Map();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key.startsWith(KEY)) continue;
        const [, run, part] = key.split(':');
        if (!runs.has(run)) runs.set(run, { seqs: [], keys: [] });
        const r = runs.get(run);
        r.keys.push(key);
        if (part === 'meta') r.meta = read(key);
        else if (part === 'acked') r.acked = read(key);
        else r.seqs.push(Number(part));
      }
    } catch {
      return;     // storage blocked (private mode): the log still goes to the server
    }
    const cutoff = Date.now() - KEEP_DAYS * 86400000;
    const mine = [];
    for (const [run, r] of runs) {
      if (!r.meta || r.meta.started < cutoff) {
        r.keys.forEach(remove);
        continue;
      }
      r.seqs.sort((a, b) => a - b);
      if (r.meta.tab === this.tab) mine.push([r.meta.started, run, r]);
      for (const seq of r.seqs) {
        if (seq <= (r.acked ?? 0)) continue;
        const lines = read(`${KEY}${run}:${seq}`);
        if (Array.isArray(lines)) this.unacked.set(`${run}:${seq}`, { run, seq, lines });
      }
    }
    mine.sort((a, b) => a[0] - b[0]);
    for (const [, run, r] of mine) {
      for (const seq of r.seqs) {
        const lines = read(`${KEY}${run}:${seq}`);
        if (Array.isArray(lines)) this.lines.push(...lines);
      }
    }
  }

  /** "Save my log": everything this tab logged, as a file in the Downloads folder. */
  download() {
    this.flush();
    const text = `${this.lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }));
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    a.download = `dodgeball-log-${(this.name || 'player').replace(/[^\w-]+/g, '_')}-${stamp}.jsonl`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return text.length;
  }

  /** For the menu: what's logged and whether the server has it all. */
  status() {
    const waiting = [...this.unacked.values()].reduce((n, c) => n + c.lines.length, 0) + this.pending.length;
    return { lines: this.lines.length, waiting, sending: !!this.send };
  }
}
