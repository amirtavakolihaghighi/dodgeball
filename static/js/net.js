// Server connection: messages, server-clock estimate and snapshot interpolation.
//
// The world is drawn `interpDelay` seconds in the past so movement is smooth even when
// Wi-Fi packets arrive unevenly. Every button press tells the server which moment of the
// world was on screen (`viewTime()`), and the server judges the timing against that moment.

const lerp = (a, b, k) => a + (b - a) * k;

function lerpAngle(a, b, k) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

function decodePlayer(a) {
  const f = a[10];
  return {
    id: a[0], name: a[1], team: a[2], x: a[3], z: a[4], yaw: a[5], pitch: a[6], hp: a[7], stamina: a[8],
    cash: a[9], alive: !!(f & 1), charging: !!(f & 2), hasBall: !!(f & 4), bot: !!(f & 8), invuln: !!(f & 16),
    host: !!(f & 32), switching: !!(f & 64),
    act: a[11], actAge: a[12], cooldown: a[13], tp: a[14], charge: a[15], stats: a[16],
    next: a[17] ?? null,        // the team the host's move takes them to next round (-1: spectating)
  };
}

function decodeBall(a) {
  return {
    id: a[0], x: a[1], y: a[2], z: a[3], vx: a[4], vy: a[5], vz: a[6],
    rally: a[7], team: a[8], target: a[9], state: a[10], owner: a[11],
  };
}

export class Net {
  constructor() {
    this.ws = null;
    this.snaps = [];
    this.events = [];
    this.latest = null;
    this.offset = null;     // server clock minus local clock (minus the quickest one-way delay)
    this.offsetAt = 0;
    this.windowStart = 0;   // the least late update of the current few seconds: see addSnapshot
    this.windowBest = Infinity;
    this.rtt = 0;
    this.interpDelay = 0.08;
    this.gravity = 0;
    this.handlers = {};
    this.onSnapshot = null;     // (arrival ms, how much later than the quickest update so far, ms): diagnostics
    this.onStale = null;        // (number of events dropped as too old): diagnostics
    this.onReanchor = null;     // (ms the clock estimate moved back): diagnostics
    // For testing: ?lag=120 simulates a 120 ms round trip (half each way). ?jitter=150 delays
    // what arrives by up to 150 ms more, unevenly but in order, like bad Wi-Fi over TCP.
    const params = new URLSearchParams(location.search);
    this.fakeLag = Number(params.get('lag')) / 2000 || 0;
    this.fakeJitter = Number(params.get('jitter')) / 1000 || 0;
    this.nextArrival = 0;
  }

  on(type, fn) {
    this.handlers[type] = fn;
    return this;
  }

  /** extra: {guest: true} to join without host powers, {hostKey} from the console's host link,
   *  {password} in internet mode. The close handler gets the code and reason: a server that
   *  doesn't let this tab in closes with 4001 and says why. */
  connect(name, extra = {}) {
    const ws = (this.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`));
    ws.onopen = () => {
      this.send({ t: 'join', name, ...extra });
      this.pinger = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 1000);
    };
    ws.onmessage = (e) => {
      if (!this.fakeLag && !this.fakeJitter) return this.receive(JSON.parse(e.data));
      const now = performance.now();
      const at = Math.max(this.nextArrival, now + (this.fakeLag + Math.random() * this.fakeJitter) * 1000);
      this.nextArrival = at;
      setTimeout(() => this.receive(JSON.parse(e.data)), at - now);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;     // an earlier connection, already replaced by a new one
      clearInterval(this.pinger);
      this.handlers.close?.(e.code, e.reason);
    };
  }

  send(msg) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text = JSON.stringify(msg);
    if (this.fakeLag) setTimeout(() => this.ws.readyState === WebSocket.OPEN && this.ws.send(text), this.fakeLag * 1000);
    else this.ws.send(text);
  }

  receive(m) {
    if (m.t === 's') this.addSnapshot(m);
    else if (m.t === 'pong') {
      const rtt = performance.now() - m.c;
      this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt;
    } else this.handlers[m.t]?.(m);
  }

  addSnapshot(m) {
    const now = performance.now() / 1000;
    // The least-delayed snapshot gives the best clock estimate; drift slowly so it can adapt.
    const sample = m.st - now;
    if (this.offset === null) this.offset = sample;
    else {
      this.offset -= (now - this.offsetAt) * 0.001;
      if (sample > this.offset) this.offset = sample;
    }
    this.offsetAt = now;
    // If even the least late update of the last few seconds came well behind the estimate, the
    // estimate is stale: this computer's clock was adjusted (an OS time correction can run it
    // fast for a while) or the route got slower for good. Re-anchor at once; otherwise the slow
    // drift above takes minutes, and meanwhile the picture stands still and presses lose their
    // lag compensation. Ordinary Wi-Fi jitter always has some quick update in the window.
    if (now - this.windowStart >= 1.5) {
      if (this.windowBest > 0.04 && this.windowBest !== Infinity) {
        this.offset -= this.windowBest;
        this.onReanchor?.(this.windowBest * 1000);
      }
      this.windowStart = now;
      this.windowBest = Infinity;
    }
    this.windowBest = Math.min(this.windowBest, this.offset - sample);
    this.onSnapshot?.(now * 1000, (this.offset - sample) * 1000);
    const snap = { st: m.st, r: m.r, players: new Map(), balls: new Map() };
    for (const a of m.p) snap.players.set(a[0], decodePlayer(a));
    for (const a of m.b) snap.balls.set(a[0], decodeBall(a));
    this.snaps.push(snap);
    this.latest = snap;
    // Pruned here, not in the render loop: background tabs keep receiving but don't render.
    while (this.snaps.length > 3 && this.snaps[1].st < m.st - 1.5) this.snaps.shift();
    if (m.e.length) {
      this.events.push(...m.e);
      this.events.sort((a, b) => a.t - b.t);
      if (this.events.length > 300) this.events.splice(0, this.events.length - 300);
    }
  }

  /** Server time of the world currently on screen. */
  viewTime() {
    return this.offset === null ? 0 : performance.now() / 1000 + this.offset - this.interpDelay;
  }

  /** The world at server time `rt`, interpolated between the two snapshots around it. */
  sample(rt) {
    const s = this.snaps;
    if (!s.length) return null;
    let a = s[0];
    let b = s[s.length - 1];
    if (rt >= b.st) a = b;
    else if (rt <= a.st) b = a;
    else {
      for (let i = s.length - 1; i > 0; i--) {
        if (s[i - 1].st <= rt) {
          a = s[i - 1];
          b = s[i];
          break;
        }
      }
    }
    const k = b.st > a.st ? (rt - a.st) / (b.st - a.st) : 1;
    const players = new Map();
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id);
      players.set(id, pa && pa.tp === pb.tp
        ? { ...pb, x: lerp(pa.x, pb.x, k), z: lerp(pa.z, pb.z, k), yaw: lerpAngle(pa.yaw, pb.yaw, k), pitch: lerp(pa.pitch, pb.pitch, k) }
        : pb);
    }
    const balls = new Map();
    const dt = rt - a.st;
    for (const [id, bb] of b.balls) {
      const ba = a.balls.get(id);
      if (ba && ba.rally === bb.rally) {
        // State and velocity changes show once their moment is on screen, not a snapshot early.
        const from = k < 1 ? ba : bb;
        let kk = k;
        if (k < 1 && ba.state === 0 && bb.state === 1) {
          // It touched a player in between and froze there: arrive at full speed at the true
          // moment of contact, instead of drifting in slowly over the whole interval.
          const speed = Math.hypot(ba.vx, ba.vy, ba.vz) || 1;
          kk = Math.min(1, dt / (Math.hypot(bb.x - ba.x, bb.y - ba.y, bb.z - ba.z) / speed || 1e-3));
        }
        balls.set(id, {
          ...bb, state: kk < 1 ? from.state : bb.state, vx: from.vx, vy: from.vy, vz: from.vz,
          x: lerp(ba.x, bb.x, kk), y: lerp(ba.y, bb.y, kk), z: lerp(ba.z, bb.z, kk),
        });
      } else if (ba) balls.set(id, k < 0.5 ? ba : bb);     // deflected in between: no sliding
      else if (a === b) balls.set(id, bb);
    }
    for (const [id, ba] of a.balls) {
      if (b.balls.has(id) || k >= 1) continue;
      // Caught in between: keep it flying until it vanishes rather than hanging in the air.
      balls.set(id, ba.state !== 0 ? ba : {
        ...ba, x: ba.x + ba.vx * dt, y: ba.y + ba.vy * dt - 0.5 * this.gravity * dt * dt, z: ba.z + ba.vz * dt,
      });
    }
    return { players, balls };
  }

  /** Events whose moment has now been reached on screen (stale ones are dropped). */
  takeEvents(rt) {
    const due = [];
    let stale = 0;
    while (this.events.length && this.events[0].t <= rt) {
      const e = this.events.shift();
      if (e.t > rt - 1.0) due.push(e);
      else stale++;
    }
    if (stale) this.onStale?.(stale);
    return due;
  }
}
