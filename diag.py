"""Session logs, to trace the lag people report back to its cause.

Each server run gets a folder under logs/ (next to the app) holding JSON-lines files:

- server.jsonl: what the server saw. Its own timing (game-loop stalls, tick cost), the host
  computer (CPU, memory, power, Wi-Fi signal, network adapters, console QuickEdit), each
  player's connection as it arrives here (input rate and gaps, how far behind their screen
  runs, messages queued or dropped toward them), hits on people (with how far clear of the
  ball they were on their own screen), balls they sidestepped on their screen, defences that
  counted thanks to the press grace, presses that arrived after the ball had already hit, and
  console prints that Windows held up.
- client-<run>-<name>.jsonl: each browser's own log, sent in every few seconds (static/js/diag.js).

Nothing here may slow the game: a background thread writes the files, and the slow checks of
the host computer (Wi-Fi, adapters) run on their own thread.
"""
from __future__ import annotations

import collections
import contextlib
import ctypes
import io
import json
import math
import queue
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import zipfile
from datetime import datetime
from pathlib import Path

KEEP_SESSIONS = 30              # older session folders are deleted when the server starts
MAX_CLIENT_BYTES = 30_000_000   # per browser page per session, so a runaway tab can't fill the disk
STALL_MS = 100                  # game-loop gaps longer than this are logged one by one
PRINT_BLOCK_MS = 100            # so are console prints held up this long (a QuickEdit selection)
HOST_POLL = 30                  # seconds between Wi-Fi / power readings
SESSION_NAME = re.compile(r"\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d")
UNSAFE = re.compile(r"[^A-Za-z0-9_-]+")
WIN = sys.platform == "win32"


def wall_ms():
    return int(time.time() * 1000)


def ms(seconds):
    return round(seconds * 1000, 1)


class SessionLog:
    """This server run's log folder. write() never blocks: a background thread does the disk work."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._prune()
        self.dir = self.root / datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        self.dir.mkdir(exist_ok=True)
        self._queue = queue.SimpleQueue()
        self._runs = {}             # browser page (run id) -> [file name, last chunk stored, bytes]
        self._files = {}
        self.failed = None
        threading.Thread(target=self._writer, daemon=True, name="session-log").start()

    def _prune(self):
        sessions = sorted(p for p in self.root.iterdir() if p.is_dir() and SESSION_NAME.fullmatch(p.name))
        for old in sessions[:max(0, len(sessions) - (KEEP_SESSIONS - 1))]:
            shutil.rmtree(old, ignore_errors=True)

    def write(self, record, file="server"):
        self._queue.put((file, json.dumps(record, separators=(",", ":"), default=str)))

    def client(self, run, name, tab, seq, lines):
        """A chunk of a browser's log. False if it's malformed, True once stored (or if it was
        already: the browser resends chunks whose acknowledgement it never got)."""
        run = UNSAFE.sub("", str(run))[:24]
        if not run or isinstance(seq, bool) or not isinstance(seq, int) or not isinstance(lines, list):
            return False
        entry = self._runs.get(run)
        if entry is None:
            label = UNSAFE.sub("_", str(name or ""))[:24].strip("_") or "player"
            entry = self._runs[run] = [f"client-{run}-{label}", 0, 0]
            self.write({"ty": "file", "run": run, "tab": UNSAFE.sub("", str(tab))[:24], "name": str(name)[:32],
                        "wall": wall_ms()}, entry[0])
        if seq <= entry[1]:
            return True
        for line in lines[:5000]:
            if not isinstance(line, dict):
                continue
            text = json.dumps(line, separators=(",", ":"))
            entry[2] += len(text) + 1
            if entry[2] > MAX_CLIENT_BYTES:
                break
            self._queue.put((entry[0], text))
        entry[1] = seq
        return True

    def _writer(self):
        while True:
            batch = [self._queue.get()]
            with contextlib.suppress(queue.Empty):
                while len(batch) < 2000:
                    batch.append(self._queue.get_nowait())
            touched, waiting = set(), []
            for name, text in batch:
                if name is None:                # a flush request: text is the Event to set
                    waiting.append(text)
                    continue
                if self.failed:
                    continue
                try:
                    f = self._files.get(name)
                    if f is None:
                        f = self._files[name] = open(self.dir / f"{name}.jsonl", "a", encoding="utf-8")
                    f.write(text + "\n")
                    touched.add(f)
                except OSError as e:
                    self.failed = str(e)
                    print(f"  (the session log stopped: {e})")
            for f in touched:
                with contextlib.suppress(OSError):
                    f.flush()
            for event in waiting:
                event.set()

    def flush(self, timeout=3.0):
        """Wait until everything written so far is on disk."""
        done = threading.Event()
        self._queue.put((None, done))
        done.wait(timeout)

    def zip_recent(self, hours=24):
        """This session and every other one from the last `hours`, as zip bytes (for the host)."""
        self.flush()
        cutoff = time.time() - hours * 3600
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for session in sorted(p for p in self.root.iterdir() if p.is_dir() and SESSION_NAME.fullmatch(p.name)):
                files = sorted(session.glob("*.jsonl"))
                if session != self.dir and not any(f.stat().st_mtime >= cutoff for f in files):
                    continue
                for f in files:
                    z.write(f, f"{session.name}/{f.name}")
        return buf.getvalue()


# ---------------------------------------------------------------- the host computer (Windows)

if WIN:
    from ctypes import wintypes

    class _MemStatus(ctypes.Structure):
        _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD),
                    ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]

    class _ProcMem(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t)]

    class _Power(ctypes.Structure):
        _fields_ = [("ACLineStatus", ctypes.c_ubyte), ("BatteryFlag", ctypes.c_ubyte),
                    ("BatteryLifePercent", ctypes.c_ubyte), ("SystemStatusFlag", ctypes.c_ubyte),
                    ("BatteryLifeTime", wintypes.DWORD), ("BatteryFullLifeTime", wintypes.DWORD)]


class HostInfo:
    """The host computer's CPU, memory, power and console. On other systems only the server
    process's own CPU time is measured; the rest is simply left out."""

    def __init__(self):
        self._proc = (time.process_time(), time.perf_counter())
        self._faults = None
        self.k32 = None
        if WIN:
            with contextlib.suppress(Exception):
                k = ctypes.WinDLL("kernel32")
                k.GetSystemTimes.argtypes = [ctypes.POINTER(wintypes.FILETIME)] * 3
                k.GlobalMemoryStatusEx.argtypes = [ctypes.POINTER(_MemStatus)]
                k.GetCurrentProcess.restype = wintypes.HANDLE
                k.K32GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ProcMem), wintypes.DWORD]
                k.GetSystemPowerStatus.argtypes = [ctypes.POINTER(_Power)]
                k.GetStdHandle.argtypes = [wintypes.DWORD]
                k.GetStdHandle.restype = wintypes.HANDLE
                k.GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
                self.k32 = k
        self._sys = self._system_times()

    def _system_times(self):
        if not self.k32:
            return None
        times = [wintypes.FILETIME() for _ in range(3)]
        if not self.k32.GetSystemTimes(*(ctypes.byref(t) for t in times)):
            return None
        return [(t.dwHighDateTime << 32) | t.dwLowDateTime for t in times]   # idle, kernel (incl. idle), user

    def sample(self):
        """Readings since the last call: CPU of the server and of the whole computer, memory."""
        out = {}
        cpu, now = time.process_time(), time.perf_counter()
        if now > self._proc[1]:
            out["cpu"] = round((cpu - self._proc[0]) / (now - self._proc[1]) * 100, 1)
        self._proc = (cpu, now)
        if not self.k32:
            return out
        with contextlib.suppress(Exception):
            times = self._system_times()
            if times and self._sys:
                idle, kernel, user = (a - b for a, b in zip(times, self._sys))
                if kernel + user > 0:
                    out["sys_cpu"] = round((1 - idle / (kernel + user)) * 100, 1)
            self._sys = times
            m = _MemStatus()
            m.dwLength = ctypes.sizeof(m)
            if self.k32.GlobalMemoryStatusEx(ctypes.byref(m)):
                out["mem_load"] = m.dwMemoryLoad
                out["avail_mb"] = m.ullAvailPhys // 1048576
            pm = _ProcMem()
            pm.cb = ctypes.sizeof(pm)
            if self.k32.K32GetProcessMemoryInfo(self.k32.GetCurrentProcess(), ctypes.byref(pm), pm.cb):
                out["ws_mb"] = round(pm.WorkingSetSize / 1048576, 1)
                if self._faults is not None:
                    out["faults"] = pm.PageFaultCount - self._faults
                self._faults = pm.PageFaultCount
        return out

    def total_ram_mb(self):
        if not self.k32:
            return None
        m = _MemStatus()
        m.dwLength = ctypes.sizeof(m)
        return m.ullTotalPhys // 1048576 if self.k32.GlobalMemoryStatusEx(ctypes.byref(m)) else None

    def power(self):
        if not self.k32:
            return {}
        p = _Power()
        if not self.k32.GetSystemPowerStatus(ctypes.byref(p)):
            return {}
        return {"on_battery": p.ACLineStatus == 0, "battery": None if p.BatteryLifePercent == 255 else p.BatteryLifePercent,
                "battery_saver": p.SystemStatusFlag == 1}

    def quick_edit(self):
        """Is console QuickEdit on? Then a click in the server window can freeze the game."""
        if not self.k32:
            return None
        mode = wintypes.DWORD()
        if not self.k32.GetConsoleMode(self.k32.GetStdHandle(-10), ctypes.byref(mode)):
            return None         # no console (started hidden or redirected)
        return bool(mode.value & 0x0040)


def _run(args):
    try:
        out = subprocess.run(args, capture_output=True, timeout=8, creationflags=0x08000000 if WIN else 0)
    except (OSError, subprocess.SubprocessError):
        return ""
    return out.stdout.decode("oem" if WIN else "utf-8", errors="replace")


def wifi_status():
    """The Wi-Fi link (signal, band, rates) from netsh, without network names or addresses."""
    info = {}
    for line in _run(["netsh", "wlan", "show", "interfaces"]).splitlines():
        key, sep, value = line.partition(" : ")
        key, value = key.strip(), value.strip()
        if sep and key and not re.search(r"SSID|Profile|Physical address|GUID", key, re.I):
            info[key] = value
    return info


def adapters():
    """Network adapters from ipconfig: their names (a VPN shows up here) and IPv4 addresses."""
    out, current = [], None
    for line in _run(["ipconfig"]).splitlines():
        if line and not line[0].isspace() and line.rstrip().endswith(":"):
            current = {"name": line.rstrip().rstrip(":"), "ipv4": [], "disconnected": False}
            out.append(current)
        elif current is not None:
            text = line.strip()
            if "IPv4" in text and ":" in text:
                current["ipv4"].append(text.rsplit(":", 1)[1].strip().replace("(Preferred)", ""))
            elif "disconnected" in text.lower():
                current["disconnected"] = True
    return [a for a in out if "IP Configuration" not in a["name"]]


def route_ip(target):
    """The local address traffic to `target` leaves from: a VPN adapter's address means the
    VPN carries that traffic. Instant: connecting a UDP socket sends nothing."""
    with contextlib.suppress(OSError), socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect((target, 1))
        return s.getsockname()[0]
    return None


def watch_host(log, host):
    """Background thread: the host's adapters once, then Wi-Fi and power every HOST_POLL s."""
    def loop():
        log.write({"ty": "host", "wall": wall_ms(), "adapters": adapters(), "route_lan": route_ip("10.255.255.255"),
                   "route_internet": route_ip("8.8.8.8"), "quick_edit": host.quick_edit(), **host.power()})
        while True:
            log.write({"ty": "poll", "st": round(time.perf_counter(), 3), "wall": wall_ms(), "wifi": wifi_status() if WIN else None,
                       **host.power()})
            time.sleep(HOST_POLL)
    threading.Thread(target=loop, daemon=True, name="host-watch").start()


# ---------------------------------------------------------------- per-second numbers

class _Conn:
    """One player's messages within the current second."""

    def __init__(self):
        self.last_in = None
        self.reset()

    def reset(self):
        self.ins = 0
        self.in_gap = 0.0
        self.lag_sum = 0.0
        self.lag_n = 0
        self.lag_max = 0.0


class Stats:
    """Per-second numbers from the game loop and each player's connection, plus notable moments.
    The server calls loop() every iteration, message() for every message from a browser,
    events() with every snapshot's events, and tick() often (it writes once a second)."""

    def __init__(self, log, host):
        self.log = log
        self.host = host
        self.conns = {}
        self.hits = collections.defaultdict(collections.deque)    # pid -> recent (contact time, learned at)
        self.last_loop = None
        self.next_write = 0.0
        self._reset()

    def _reset(self):
        self.loops = 0
        self.gap_max = 0.0
        self.tick_sum = 0.0
        self.tick_max = 0.0
        self.snap_max = 0.0

    def loop(self, now, tick_s, snap_s):
        if self.last_loop is not None:
            gap = now - self.last_loop
            self.gap_max = max(self.gap_max, gap)
            if gap * 1000 > STALL_MS:
                self.log.write({"ty": "stall", "st": round(self.last_loop, 3), "ms": ms(gap), "wall": wall_ms()})
        self.last_loop = now
        self.loops += 1
        self.tick_sum += tick_s
        self.tick_max = max(self.tick_max, tick_s)
        self.snap_max = max(self.snap_max, snap_s)

    def message(self, pid, msg, now, game):
        c = self.conns.get(pid)
        if c is None:
            c = self.conns[pid] = _Conn()
        kind = msg.get("t")
        if kind == "in":
            c.ins += 1
            if c.last_in is not None:
                c.in_gap = max(c.in_gap, now - c.last_in)
            c.last_in = now
        wt = msg.get("wt")
        if isinstance(wt, (int, float)) and not isinstance(wt, bool) and math.isfinite(wt):
            lag = now - wt          # how far behind the server this player's screen runs
            c.lag_sum += lag
            c.lag_n += 1
            c.lag_max = max(c.lag_max, lag)
            if kind == "act":
                self._late_press(pid, msg.get("a"), wt, now, game)

    def _late_press(self, pid, action, wt, now, game):
        """A defence whose press was in time on the player's screen, but that reached the
        server after the ball had already been counted as a hit: lag cost them that ball."""
        spec = game.rules.actions.get(action) if isinstance(action, str) else None
        hits = self.hits.get(pid)
        if spec is None or not hits:
            return
        while hits and now - hits[0][1] > 2.0:
            hits.popleft()
        for contact, decided in hits:
            if wt <= contact <= wt + spec.window:
                self.log.write({"ty": "late_press", "st": round(now, 3), "p": pid, "a": action, "contact": round(contact, 3),
                                "wt": round(wt, 3), "screen_ms": ms(now - wt), "after_hit_ms": ms(now - decided),
                                "over_cap": now - wt > game.rules.MAX_LAG_COMP, "wall": wall_ms()})
                return

    def events(self, events, now, game):
        for e in events:
            k = e["k"]
            if k == "hit":
                p = game.players.get(e["p"])
                if p is None or p.bot:
                    continue
                self.hits[e["p"]].append((e["t"], now))
                self.log.write({"ty": "hit", "st": e["t"], "p": e["p"], "by": e["by"], "speed": e["speed"], "dmg": e["dmg"],
                                "ko": e["ko"], "bank": e.get("bank"), "gap": e.get("gap"), "view_lag": ms(p.view_lag),
                                "decided_ms": ms(now - e["t"]), **{k: e[k] for k in ("early", "second") if k in e},
                                "wall": wall_ms()})
            elif k == "sidestep" or (k in ("catch", "deflect", "dodge") and e.get("graced")):
                # A ball that missed because the player had stepped clear on their screen, or a
                # defence that counted only thanks to the press grace.
                self.log.write({"ty": "sidestep" if k == "sidestep" else "graced", "st": e["t"], "p": e["p"],
                                **({"a": k} if k != "sidestep" else {}), "wall": wall_ms()})
            elif k in ("round", "match", "rules", "team", "shuffle"):
                self.log.write({"ty": "game", "st": e["t"], "wall": wall_ms(), **{key: v for key, v in e.items() if key != "t"}})

    def tick(self, now, game, clients):
        """Writes the last second's numbers once a second. `clients`: pid -> server.Client."""
        if now < self.next_write:
            return
        first = self.next_write == 0.0
        self.next_write = now + 1.0
        if first:
            self.host.sample()
            self._reset()
            return
        humans = sum(not p.bot for p in game.players.values())
        record = {"ty": "sec", "st": round(now, 3), "wall": wall_ms(), "state": game.state, "round": game.round_no,
                  "loops": self.loops, "gap_max": ms(self.gap_max), "tick_avg": ms(self.tick_sum / max(1, self.loops)),
                  "tick_max": ms(self.tick_max), "snap_max": ms(self.snap_max), "humans": humans,
                  "bots": len(game.players) - humans, "balls": len(game.balls), **self.host.sample()}
        net = []
        for pid, client in list(clients.items()):
            c = self.conns.get(pid) or _Conn()
            p = game.players.get(pid)
            net.append({"p": pid, "in": c.ins, "in_gap": ms(c.in_gap), "lag": ms(c.lag_sum / c.lag_n) if c.lag_n else None,
                        "lag_max": ms(c.lag_max), "view_lag": ms(p.view_lag) if p else None, "q": client.q_max,
                        "drop": client.dropped, "send_max": ms(client.send_max)})
            c.reset()
            client.q_max, client.dropped, client.send_max = client.queue.qsize(), 0, 0.0
        for pid in [pid for pid in self.conns if pid not in clients]:
            del self.conns[pid]
        record["net"] = net
        self.log.write(record)
        self._reset()
