"""Reads the logs of a play session and says what went wrong, and for whom.

Usage:
    python tools/log_report.py <the host's zip | a session folder | the logs folder | one player's saved log>

For each session it prints the host computer (CPU, memory, power, Wi-Fi, VPN adapters, console
QuickEdit), the server's own stalls, a table of the players (frame rate, frozen picture, how
late world updates arrived, ping, presses that came too late or during a recovery, lag marks),
freezes that hit several players at once, what stands out, and every moment someone pressed L
with the numbers just before it. Times are the host computer's clock (players' own clocks can be
off by minutes). Joining and loading are left out of each player's numbers. Plain Python, no
packages needed.
"""
from __future__ import annotations

import json
import sys
import zipfile
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

VPN_WORDS = ("vpn", "tun", "tap-", "wireguard", "wintun", "singbox", "sing-box", "surfshark", "nord", "openvpn", "zscaler",
             "anyconnect", "globalprotect", "fortinet", "forticlient", "tailscale", "zerotier", "hamachi", "proton",
             "mullvad", "expressvpn", "warp", "clash", "v2ray")
NO_GPU = ("swiftshader", "basic render", "llvmpipe", "software rasterizer")
# Left out of a player's numbers: the seconds after joining (the menus, the court and the athletes are
# built) and after the hall and the athletes arrive (dressed and drawn the first time). A page stutters
# then for 0.3-2 s, which says nothing about the network.
JOIN_SETTLE_MS = 10_000
LOAD_SETTLE_MS = 3_000
STALL_FRAME_MS = 150        # a frame this long: the page itself stalled (diag.js HITCH_MS)
BUSY_CODE_MS = 100          # a frame of the game's own code this long: busy (an L mark with no freeze before it)
MARKS_TOGETHER_S = 2.0      # L pressed again within this: the same moment


# ---------------------------------------------------------------- loading

def load(path: Path) -> dict[str, dict[str, list[dict]]]:
    """{session: {file name without .jsonl: [records]}} from a zip, folder or single file."""
    sessions: dict[str, dict[str, list[dict]]] = defaultdict(dict)

    def add(session, name, text):
        records = []
        for line in text.splitlines():
            if line.strip():
                try:
                    records.append(json.loads(line))
                except ValueError:
                    pass
        sessions[session][Path(name).stem] = records

    if path.is_file() and path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.endswith(".jsonl"):
                    parts = Path(name).parts
                    add(parts[-2] if len(parts) > 1 else path.stem, parts[-1], z.read(name).decode("utf-8", "replace"))
    elif path.is_file():                                    # one player's "Save my log"
        add(path.stem, f"client-{path.stem}", path.read_text("utf-8", errors="replace"))
    elif any(path.glob("*.jsonl")):
        for f in sorted(path.glob("*.jsonl")):
            add(path.name, f.name, f.read_text("utf-8", errors="replace"))
    else:
        for d in sorted(p for p in path.iterdir() if p.is_dir()):
            for f in sorted(d.glob("*.jsonl")):
                add(d.name, f.name, f.read_text("utf-8", errors="replace"))
    return sessions


# ---------------------------------------------------------------- small helpers

def pct(values, q):
    values = sorted(v for v in values if v is not None)
    if not values:
        return None
    k = (len(values) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(values) - 1)
    return values[lo] + (values[hi] - values[lo]) * (k - lo)


def num(v, unit="", digits=0):
    if v is None:
        return "-"
    return f"{v:.{digits}f}{unit}"


class Clock:
    """Turns server time (st, seconds) and wall time (ms) into the host's local clock time.
    `records`: the server's log, or (without one) the host's browser log, whose clock is the same."""

    def __init__(self, records, offset_min):
        pairs = [(r["wall"] / 1000 - r["st"]) for r in records if r.get("ty") == "sec" and r.get("st") and r.get("wall")]
        self.shift = pct(pairs, 0.5)
        self.tz = timezone(timedelta(minutes=offset_min)) if offset_min is not None else None

    def wall(self, ms):
        return datetime.fromtimestamp(ms / 1000, self.tz).strftime("%H:%M:%S") if ms else "?"

    def st(self, st, fallback_ms=None):
        if st is not None and self.shift is not None:
            return self.wall((st + self.shift) * 1000)
        return self.wall(fallback_ms)


# ---------------------------------------------------------------- per player

def settling_test(records):
    """Is a browser line from while its page was joining or loading? Before joining it has no clock
    yet (st is null); then the seconds after each join and after the hall and the athletes arrived.
    The page's own clock throughout, so a PC clock that's off doesn't matter."""
    spans = [(r["wall"], r["wall"] + JOIN_SETTLE_MS) for r in records if r.get("ty") == "welcome" and r.get("wall")]
    spans += [(r["wall"], r["wall"] + LOAD_SETTLE_MS) for r in records if r.get("ty") == "load" and r.get("wall")]

    def settling(r):
        wall = r.get("wall") or 0
        return r.get("st") is None or any(a <= wall <= b for a, b in spans)
    return settling


class Player:
    def __init__(self, tab, records, name):
        self.tab = tab
        self.recs = records
        self.name = name or tab
        self.env = next((r for r in reversed(records) if r.get("ty") == "env"), {})
        welcome = next((r for r in reversed(records) if r.get("ty") == "welcome"), {})
        self.ids = {r["id"] for r in records if r.get("ty") == "welcome" and r.get("id") is not None}
        self.host = bool(welcome.get("host"))
        self.was = None             # the name they joined with, if they renamed themselves
        settling = settling_test(records)
        # Every second (to line up moments), and the ones that count for the numbers: joining and
        # loading left out (unless that's all there is).
        self.all_secs = [r for r in records if r.get("ty") == "sec" and not r.get("hidden") and not r.get("resumed")]
        self.secs = [r for r in self.all_secs if not settling(r)] or self.all_secs
        self.all_freezes = [r for r in records if r.get("ty") == "freeze" and r.get("st") is not None]
        self.freezes = [r for r in self.all_freezes if not settling(r)]
        self.hitches = [r for r in records if r.get("ty") == "hitch"]
        self.marks = [r for r in records if r.get("ty") == "mark"]
        self.ignored = [r for r in records if r.get("ty") == "ignored"]    # pressed while still recovering
        self.clock = [r for r in records if r.get("ty") == "clock"]        # the browser re-anchored its clock estimate
        self.drops = [r for r in records if r.get("ty") == "ws" and r.get("closed")]
        self.errors = [r for r in records if r.get("ty") == "error"]
        self.presses = sum(r.get("ty") == "press" for r in records)
        self.got_hit = sum(r.get("ty") == "ev" and r.get("k") == "hit" for r in records)
        span = sum(r.get("span", 1000) for r in self.secs)
        self.minutes = span / 60000
        self.frozen_pct = 100 * sum(r.get("frozen", 0) for r in self.secs) / span if span else None
        self.fps_med = pct([r.get("fps") for r in self.secs], 0.5)
        self.fps_p10 = pct([r.get("fps") for r in self.secs], 0.1)
        self.slow_share = 100 * sum((r.get("fps") or 0) < 30 for r in self.secs) / len(self.secs) if self.secs else None
        self.js_med = pct([r.get("js_avg") for r in self.secs], 0.5)
        self.late_p95 = pct([r.get("late_max") for r in self.secs], 0.95)
        self.late_max = max((r.get("late_max") or 0 for r in self.secs), default=None)
        self.ping_med = pct([r.get("ping") for r in self.secs if r.get("ping")], 0.5)
        self.ping_p95 = pct([r.get("ping") for r in self.secs if r.get("ping")], 0.95)
        self.long100 = sum(r.get("long100", 0) for r in self.secs)
        # Seconds (server time) this player was really playing: in a round, alive, in the game.
        free = "nolock" in (self.env.get("url") or "")      # automated tests play without pointer lock
        self.playing = {int(r["st"]) for r in self.secs if r.get("st") is not None and r.get("state") == "play"
                        and r.get("alive") and (r.get("lock") or free)}
        self.gpu = self.env.get("gpu") or "?"
        self.no_gpu = any(w in self.gpu.lower() for w in NO_GPU)
        # The graphics setting (graphics.js): what they chose, and Auto's own changes, with why.
        self.gfx_choice = self.env.get("graphics")
        self.gfx_auto = [r for r in records if r.get("ty") == "gfx" and r.get("why")]
        # The recorded sounds (sfx.js): why they didn't load, if they didn't.
        self.sound_error = next((r.get("error") for r in records if r.get("ty") == "sound" and r.get("error")), None)
        # How long the browser held each press before the game's code saw it (ms): a busy page.
        self.held = [r["held"] for r in records if r.get("ty") == "press" and r.get("held") is not None]
        # Loading the game (main.js): seconds from opening the page to the hall and athlete in place, and
        # how much came over the network (files from the browser's cache don't count).
        self.loads = [r for r in records if r.get("ty") == "load"]
        self.late_presses = []      # filled from the server log
        self.capped = []            # presses that reached the server past the lag compensation limit
        self.sidesteps = []         # balls that missed: clear on their own screen (sidestep compensation)
        self.graced = []            # defences that counted only thanks to the press grace
        self.clear_hits = []        # hits while they were clear of the ball on their own screen
        self.early_hits = []        # hits just after their press had ended ("TOO EARLY")
        self.second_hits = []       # hits just after they had stopped another ball ("SECOND BALL")
        self.in_gaps = []           # the server's view: longest gap between this player's inputs, per second
        self.shared_ms = 0          # frozen time while the server stalled or most others froze too
        self.computer_ms = 0        # ...while their own page stalled (their computer)
        self.own_ms = 0             # ...the rest: their own download (their Wi-Fi)

    def window(self, st0, st1):
        return [r for r in self.all_secs if r.get("st") is not None and st0 <= r["st"] <= st1]

    def played_through(self, st0, st1):
        """Playing the whole time from st0 to st1 (server time): in the menu, knocked out or in
        a hidden tab nobody sends inputs, so a gap then means nothing. One second of slack:
        the browser's idea of server time is a little off."""
        return all(s in self.playing or s - 1 in self.playing or s + 1 in self.playing
                   for s in range(int(st0), int(st1) + 1))


def players_of(files, since=None, runs=None):
    """One Player per browser tab. A browser keeps its unsent log until a server takes it, so a
    session folder can hold page loads from earlier sessions: with `runs` (the page loads that
    joined this server) only those count; without them (logs from before joins named the page),
    lines from before `since` (ms, the server's start) are left out. Players' own clocks can be
    minutes off, so `runs` is the sure way."""
    groups, names = defaultdict(list), {}
    for stem, records in files.items():
        if stem == "server":
            continue
        head = next((r for r in records if r.get("ty") == "file"), {})
        if runs:
            run = head.get("run") or (stem.split("-")[1] if stem.count("-") >= 2 else None)
            if run not in runs:
                continue
        elif since:
            records = [r for r in records if not r.get("wall") or r["wall"] >= since - 60_000]
            if not any(r.get("ty") == "sec" for r in records):
                continue
        env = next((r for r in records if r.get("ty") == "env"), {})
        tab = head.get("tab") or env.get("tab") or stem
        groups[tab].extend(r for r in records if r.get("ty") != "file")
        name = head.get("name") or next((r.get("name") for r in records if r.get("ty") == "welcome" and r.get("name")), None)
        if name:
            names[tab] = name
    players = []
    for tab, records in groups.items():
        records.sort(key=lambda r: r.get("wall") or 0)
        players.append(Player(tab, records, names.get(tab)))
    return sorted(players, key=lambda p: -(p.frozen_pct or 0))


# ---------------------------------------------------------------- the report

def report(session, files):
    out = []
    say = out.append
    server = files.get("server", [])
    meta = next((r for r in server if r.get("ty") == "meta"), {})
    host = next((r for r in server if r.get("ty") == "host"), {})
    joins = [r for r in server if r.get("ty") == "join"]
    # The page loads that joined this server (joins name them since the session logs began).
    runs = {j["run"] for j in joins} if joins and all(j.get("run") for j in joins) else None
    players = players_of(files, meta.get("wall"), runs)
    hosts = [p for p in players if p.host]
    clock = Clock(server or (hosts[0].recs if hosts else []), meta.get("utc_offset_min"))
    by_pid = {}
    for p in players:
        for pid in p.ids:
            by_pid[pid] = p
    for j in joins:
        if j.get("p") not in by_pid:
            by_pid[j["p"]] = next((p for p in players if p.tab == j.get("tab")), None)
    for r in server:                    # the name they go by now, if they renamed themselves
        q = by_pid.get(r.get("p")) if r.get("ty") == "rename" else None
        if q is not None and r.get("name"):
            q.was = q.was or r.get("was")
            q.name = r["name"]
    # The session's length on the host's clock: players' own clocks can be minutes off.
    walls = [r["wall"] for r in (server or [x for p in players for x in p.recs]) if r.get("wall")]
    start, end = (min(walls), max(walls)) if walls else (None, None)
    version = (meta.get("version") or {}).get("commit", "?")
    say(f"=== SESSION {session} | build {version} | {clock.wall(start)} to {clock.wall(end)}"
        f" ({round((end - start) / 60000) if start else '?'} min) | {len(players)} player log(s)")

    if server:
        say("")
        say("HOST COMPUTER (the PC running the server)")
        ram = meta.get("ram_mb")
        say(f"  {meta.get('os', '?')}, {meta.get('cpus', '?')} CPU threads, {num(ram / 1024 if ram else None, ' GB RAM', 1)}"
            f"{', packaged app' if meta.get('frozen') else ', run from source'}")
        polls = [r for r in server if r.get("ty") == "poll"]
        battery = [r for r in polls + [host] if r.get("on_battery")]
        saver = [r for r in polls + [host] if r.get("battery_saver")]
        say(f"  Power: {'ON BATTERY for part of the session' if battery else 'plugged in'}"
            f"{' (battery saver on: slower CPU and Wi-Fi)' if saver else ''}")
        qe = host.get("quick_edit")
        say(f"  Console QuickEdit: {'ON (a click in the server window can freeze the game for everyone)' if qe else 'off' if qe is False else 'unknown'}")
        vpn = [a for a in host.get("adapters", []) if a.get("ipv4") and any(w in a["name"].lower() for w in VPN_WORDS)]
        if vpn:
            say("  VPN-like network adapters in use: " + ", ".join(f"{a['name']} ({', '.join(a['ipv4'])})" for a in vpn))
        vpn_ips = {ip for a in vpn for ip in a["ipv4"]}
        through_vpn = [j for j in joins if j.get("via") in vpn_ips]
        for j in through_vpn:
            say(f"  Traffic to {j.get('name')} ({j.get('ip')}) went through the VPN adapter ({j['via']})")
        if vpn_ips and not through_vpn and any(j.get("via") for j in joins):
            say("  Traffic to the players went directly over the local network (not through the VPN)")
        if host.get("route_internet") in vpn_ips:
            say(f"  Internet traffic goes through the VPN ({host['route_internet']})")
        wifi = [r.get("wifi") or {} for r in polls]
        signal = [int(w["Signal"].rstrip("%")) for w in wifi if str(w.get("Signal", "")).rstrip("%").isdigit()]
        if signal:
            last = next((w for w in reversed(wifi) if w.get("Signal")), {})
            say(f"  Wi-Fi: signal {round(pct(signal, 0.5))}% (lowest {min(signal)}%), {last.get('Band', '')} {last.get('Radio type', '')},"
                f" {last.get('Receive rate (Mbps)', '?')}/{last.get('Transmit rate (Mbps)', '?')} Mbps".replace("  ", " "))
        elif polls:
            states = {w.get("State") for w in wifi if w}
            say(f"  Wi-Fi: {'not connected (on a cable?)' if states <= {'disconnected', None} else 'no signal reading'}")
        secs = [r for r in server if r.get("ty") == "sec"]
        sys_cpu = [r.get("sys_cpu") for r in secs]
        if any(v is not None for v in sys_cpu):
            say(f"  CPU of the whole computer: {num(pct(sys_cpu, 0.5), '%')} typical, {num(pct(sys_cpu, 0.95), '%')} p95,"
                f" {num(max(v for v in sys_cpu if v is not None), '%')} max; the server itself"
                f" {num(sum(r.get('cpu') or 0 for r in secs) / max(1, len(secs)), '%', 1)} on average")
        mem = [r.get("mem_load") for r in secs if r.get("mem_load") is not None]
        if mem:
            avail = min(r.get("avail_mb") for r in secs if r.get("avail_mb") is not None)
            say(f"  Memory: up to {max(mem)}% in use, at least {avail / 1024:.1f} GB free")

        say("")
        say("SERVER")
        stalls = [r for r in server if r.get("ty") == "stall"]
        if stalls:
            worst = max(stalls, key=lambda r: r["ms"])
            say(f"  Game-loop stalls over 100 ms: {len(stalls)}, worst {worst['ms']:.0f} ms at {clock.st(worst['st'], worst.get('wall'))}"
                "  (everyone's game froze during these)")
        else:
            say("  Game-loop stalls over 100 ms: none")
        errors = [r for r in server if r.get("ty") == "error"]
        dropped = [r for r in errors if r.get("harmless")]
        real = [r for r in errors if not r.get("harmless")]
        if dropped:
            say(f"  Connections a browser dropped without closing (a laptop shut, Wi-Fi lost; harmless): {len(dropped)}")
        if real:
            say(f"  Errors in the server: {len(real)}; first at {clock.st(real[0]['st'], real[0].get('wall'))},"
                f" in {real[0].get('where')}: {real[0].get('error')}")
        blocks = [r for r in server if r.get("ty") == "print_block"]
        if blocks:
            worst = max(blocks, key=lambda r: r["ms"])
            say(f"  Console prints held up (a QuickEdit selection in the server window): {len(blocks)},"
                f" longest {worst['ms'] / 1000:.1f} s at {clock.st(worst['st'], worst.get('wall'))}")
        drops = defaultdict(int)
        for r in secs:
            for n in r.get("net", []):
                drops[n["p"]] += n.get("drop", 0)
        if any(drops.values()):
            say("  Updates dropped for connections that couldn't keep up: " + ", ".join(
                f"{(by_pid.get(pid) or Player('?', [], f'#{pid}')).name} {n}" for pid, n in drops.items() if n))
        for r in server:
            q = by_pid.get(r.get("p"))
            if q is None:
                continue
            if r.get("ty") == "late_press":
                q.late_presses.append(r)
            elif r.get("ty") == "capped":
                q.capped.append(r)
            elif r.get("ty") == "sidestep":
                q.sidesteps.append(r)
            elif r.get("ty") == "graced":
                q.graced.append(r)
            elif r.get("ty") == "hit":
                if (r.get("gap") or 0) > 0:
                    q.clear_hits.append(r)
                if r.get("early"):
                    q.early_hits.append(r)
                elif r.get("second"):
                    q.second_hits.append(r)
        for r in secs:
            if (r.get("gap_max") or 0) >= 100:
                continue        # the server itself stalled that second: every player's inputs waited
            for n in r.get("net", []):
                q = by_pid.get(n["p"])
                if q and n.get("in") and (not q.secs or q.played_through(r["st"] - (n.get("in_gap") or 0) / 1000, r["st"])):
                    q.in_gaps.append(n.get("in_gap"))

    say("")
    say("PLAYERS (seconds with the game hidden are left out)")
    say(f"  {'name':<14} {'graphics':<26} {'fps med/p10':>11} {'<30fps':>7} {'frozen':>7} {'late p95/max':>13}"
        f" {'ping med/p95':>13} {'input gap':>9} {'hitch':>6} {'late press':>10} {'ignored':>7} {'marks':>5} {'drops':>5}")
    for p in players:
        gpu = (p.gpu[:23] + "..") if len(p.gpu) > 25 else p.gpu
        say(f"  {(p.name + (' *' if p.host else ''))[:14]:<14} {gpu:<26} {num(p.fps_med):>5}/{num(p.fps_p10):<5}"
            f" {num(p.slow_share, '%'):>7} {num(p.frozen_pct, '%', 1):>7} {num(p.late_p95):>6}/{num(p.late_max, ' ms'):<6}"
            f" {num(p.ping_med):>5}/{num(p.ping_p95, ' ms'):<7} {num(max(p.in_gaps, default=None), ' ms'):>9}"
            f" {len([h for h in p.hitches if h.get('ms', 0) >= 250]):>6}"
            f" {len(p.late_presses):>10} {len(p.ignored):>7} {len(p.marks):>5} {len(p.drops):>5}")
    say("  (* = the host. frozen = time the picture of the others stood still. late = how much later than the quickest"
        " update the world updates arrived. input gap = longest wait between this player's inputs reaching the server,"
        " while playing. ignored = presses during the recovery after their own dodge, catch or deflect. The first"
        f" {JOIN_SETTLE_MS // 1000} s after joining and {LOAD_SETTLE_MS // 1000} s after loading are left out: the page"
        " builds the game then.)")
    renamed = [p for p in players if p.was and p.was != p.name]
    if renamed:
        say("  Renamed during the session: " + ", ".join(f"{p.name} (joined as {p.was})" for p in renamed))

    loading = [(p, r) for p in players for r in p.loads]
    if loading:
        say("")
        say("LOADING: from opening the page to the game ready (the hall and the athletes in place)")
        for p, r in loading:
            kb = r.get("kb") or 0
            got = (f"{kb / 1024:.1f} MB downloaded" if kb >= 1024 else f"{kb} KB downloaded" if kb
                   else "everything from the browser's cache")
            slow = r.get("slowest") or [None, None]
            extra = f"; slowest file {slow[0]} {slow[1] / 1000:.1f} s" if slow[0] and slow[1] else ""
            say(f"  {p.name[:14]:<14} {r.get('ms', 0) / 1000:5.1f} s, {got}{extra}")

    helped = [p for p in players if p.sidesteps or p.graced or p.clear_hits or p.early_hits or p.second_hits or p.capped]
    if helped:
        say("")
        say("FAIRNESS: what the press grace, sidestep compensation and the lag compensation limit did (Game rules >"
            " Network), and hits that came right after a press or a defence")
        for p in helped:
            parts = []
            if p.capped:
                cap = p.capped[0].get("cap_ms", 0)
                worst = max(r.get("screen_ms", 0) for r in p.capped)
                share = f" ({100 * len(p.capped) / p.presses:.0f}% of their presses)" if p.presses else ""
                parts.append(f"{len(p.capped)} press(es){share} reached the server more than the lag compensation limit"
                             f" ({cap / 1000:.2f} s) after the moment their screen showed, so they counted up to"
                             f" {(worst - cap) / 1000:.2f} s later than pressed")
            if p.sidesteps:
                parts.append(f"{len(p.sidesteps)} ball(s) missed because they had stepped clear on their screen")
            if p.graced:
                parts.append(f"{len(p.graced)} defence(s) counted thanks to the press grace")
            if p.clear_hits:
                worst = max(r["gap"] for r in p.clear_hits)
                parts.append(f"{len(p.clear_hits)} hit(s) while clear on their own screen (up to {worst:.2f} m;"
                             " sidestep compensation was off)")
            if p.early_hits:
                early = [r["early"] for r in p.early_hits]
                parts.append(f"{len(early)} hit(s) just after their press had ended (too early by"
                             f" {min(early):.2f}-{max(early):.2f} s)")
            if p.second_hits:
                parts.append(f"{len(p.second_hits)} hit(s) by a second ball right after they had stopped one")
            say(f"  {p.name}: " + "; ".join(parts))

    stalls = [r for r in server if r.get("ty") == "stall"]
    attribute_freezes(players, stalls)
    shared = shared_freezes(players)
    if shared:
        say("")
        say("FREEZES SEVERAL PLAYERS HAD AT THE SAME MOMENT (points at the host or the network as a whole)")
        for ev in shared[:15]:
            stall = next((s for s in stalls if s["st"] - 0.5 <= ev["end"] and s["st"] + s["ms"] / 1000 + 0.5 >= ev["start"]), None)
            say(f"  {clock.st(ev['end'])}  {len(ev['who'])} players ({', '.join(sorted(ev['who']))}), up to {ev['ms'] / 1000:.1f} s"
                + (f"; the server itself stalled {stall['ms']:.0f} ms" if stall else ""))
        if len(shared) > 15:
            say(f"  ... and {len(shared) - 15} more")

    say("")
    say("WHAT STANDS OUT")
    notes = 0
    for p in players:
        for line in verdicts(p):
            say(f"  - {p.name}: {line}")
            notes += 1
    if server and stalls:
        say(f"  - The server stalled {len(stalls)} times: every player froze then. Likely the host computer"
            " (a click in the server window, CPU or memory pressure).")
        notes += 1
    if not notes:
        say("  Nothing: the numbers look healthy for everyone.")

    def mark_time(m):
        return m["st"] if m.get("st") is not None else (m.get("wall") or 0) / 1000
    moments = []        # [player, first mark, presses of L, time of the last]: L pressed again soon after is one moment
    for p in players:
        for m in sorted(p.marks, key=mark_time):
            if moments and moments[-1][0] is p and mark_time(m) - moments[-1][3] <= MARKS_TOGETHER_S:
                moments[-1][2] += 1
                moments[-1][3] = mark_time(m)
            else:
                moments.append([p, m, 1, mark_time(m)])
    if moments:
        say("")
        say("LAG MARKS (someone pressed L): the 3 seconds before each")
        for p, m, presses, _ in sorted(moments, key=lambda e: mark_time(e[1])):
            again = f" (L {presses} times)" if presses > 1 else ""
            say(f"  {clock.st(m.get('st'), m.get('wall'))}  {p.name:<12} {explain_mark(p, m, stalls)}{again}")
    return "\n".join(out)


def attribute_freezes(players, stalls):
    """Splits each player's frozen time three ways: host side (the server stalled, or at least half
    of the other players froze at the same time), their computer (their own page stalled right
    then, drawing no frame for STALL_FRAME_MS, so world updates waited unread) or their own
    download (their Wi-Fi). On the 10 Nov office log it gave the Linux laptops' Wi-Fi scanning 100%
    download and an overloaded laptop 58% computer. (A slow frame anywhere in the same second
    proved too loose: one 127 ms frame took the blame for a 1.2 s freeze.)"""
    stall_spans = [(s["st"] - 0.3, s["st"] + s["ms"] / 1000 + 0.3) for s in stalls]

    def overlaps(a, b, spans):
        return any(x < b and y > a for x, y in spans)

    for p in players:
        others = [q for q in players if q is not p]
        stalled = [(h["st"] - h["ms"] / 1000, h["st"]) for h in p.hitches
                   if h.get("st") is not None and h.get("ms", 0) >= STALL_FRAME_MS]
        counted = {id(f) for f in p.freezes}       # joining and loading: a cause (for the L marks), not a total
        for f in p.all_freezes:
            a, b = f["st"] - f["ms"] / 1000, f["st"]
            host_side = overlaps(a, b, stall_spans)
            if not host_side:
                active = [q for q in others if q.window(a - 2, b + 2)]
                froze = [q for q in active if overlaps(a, b, [(g["st"] - g["ms"] / 1000, g["st"]) for g in q.all_freezes])]
                host_side = bool(active) and len(froze) >= len(active) / 2
            if host_side:
                f["cause"], total = "host", "shared_ms"
            elif overlaps(a - 0.05, b + 0.2, stalled):
                f["cause"], total = "computer", "computer_ms"
            else:
                f["cause"], total = "own", "own_ms"
            if id(f) in counted:
                setattr(p, total, getattr(p, total) + f["ms"])


def shared_freezes(players, slack=0.1):
    """Moments when at least two players (and at least half of those logging) froze together."""
    spans = []
    for p in players:
        for f in p.freezes:
            spans.append((f["st"] - f["ms"] / 1000, f["st"], f["ms"], p.name))
    spans.sort()
    events = []
    for start, end, length, name in spans:
        if events and start <= events[-1]["end"] + slack:
            ev = events[-1]
            ev["end"] = max(ev["end"], end)
            ev["ms"] = max(ev["ms"], length)
            ev["who"].add(name)
        else:
            events.append({"start": start, "end": end, "ms": length, "who": {name}})
    result = []
    for ev in events:
        active = sum(1 for p in players if p.window(ev["start"] - 2, ev["end"] + 2))
        if len(ev["who"]) >= 2 and len(ev["who"]) >= active / 2:
            result.append(ev)
    return result


def verdicts(p):
    out = []
    if p.no_gpu:
        out.append(f"draws without the graphics card ({p.gpu}). Turn on hardware acceleration in Chrome settings.")
    if p.fps_med is not None and (p.fps_med < 45 or (p.slow_share or 0) > 10):
        cpu = (f"; {p.js_med:.0f} ms of game code per frame, so the CPU is part of it: battery saver or other programs,"
               " and browsers don't tell the game about a player's battery") if (p.js_med or 0) > 8 else ""
        fixed = (f" They chose {p.gfx_choice.capitalize()} graphics: Auto or a lower level would help."
                 if p.gfx_choice in ("high", "medium") else "")
        out.append(f"low frame rate (typically {p.fps_med:.0f} fps, under 30 for {p.slow_share:.0f}% of the time{cpu}).{fixed}")
    for r in p.gfx_auto[:3]:
        out.append(f"Auto graphics went from {str(r.get('from')).capitalize()} to {str(r.get('to')).capitalize()}: {r.get('why')}.")
    if len(p.gfx_auto) > 3:
        out.append(f"...and {len(p.gfx_auto) - 3} more automatic graphics change(s).")
    if p.sound_error:
        out.append(f"the recorded sounds didn't load ({p.sound_error}), so they heard the simple synthesized ones."
                   " A download manager in the browser (such as IDM) can do this.")
    slow_load = max((r.get("ms", 0) for r in p.loads), default=0)
    if slow_load >= 15000:
        out.append(f"the game took {slow_load / 1000:.0f} s to load: a slow Wi-Fi link to the host (the first visit"
                   " downloads about 7 MB from the host's computer).")
    held = pct(p.held, 0.95)
    if held is not None and held >= 30:
        out.append(f"the browser held their presses up to {held:.0f} ms (p95) before the game saw them: a busy page."
                   " Presses are timed from the key itself, so it doesn't count against them.")
    if (p.frozen_pct or 0) >= 1 or (p.late_p95 or 0) >= 60:
        where, most = "mostly on its own (this player's download: likely their Wi-Fi)", p.own_ms
        if p.computer_ms > most:
            where, most = ("mostly while their own computer stalled (it drew no frame for 0.15 s or more right then):"
                           " their computer, not the network"), p.computer_ms
        if p.shared_ms > most:
            where = "mostly while the server stalled or others froze too (host side)"
        out.append(f"the picture froze {p.frozen_pct:.1f}% of the time: world updates arrived up to {num(p.late_max, ' ms')} late, {where}.")
    gap = max((g for g in p.in_gaps if g is not None), default=0)
    if gap >= 300:
        why = "their computer stalling" if p.computer_ms > p.own_ms else "their upload: Wi-Fi, or their computer stalling"
        out.append(f"their inputs reached the server in bursts (gaps up to {gap:.0f} ms), so others saw them stutter ({why}).")
    if (p.ping_p95 or 0) >= 100:
        out.append(f"high ping: typically {num(p.ping_med, ' ms')}, {num(p.ping_p95, ' ms')} at worst (p95).")
    if p.late_presses:
        delay = pct([r.get("screen_ms") for r in p.late_presses], 0.5)
        capped = sum(bool(r.get("over_cap")) for r in p.late_presses)
        out.append(f"{len(p.late_presses)} dodge/catch/deflect presses arrived after the ball had already hit"
                   f" (their screen ran ~{delay:.0f} ms behind{'; beyond the lag-compensation limit ' + str(capped) + 'x' if capped else ''}).")
    if len(p.ignored) >= 5:
        coming = sum(r.get("tti") is not None for r in p.ignored)
        out.append(f"{len(p.ignored)} presses came while still recovering from their own dodge, catch or deflect, so they"
                   f" did nothing ({coming} with a ball coming). The game now says \"Still recovering\" when that happens.")
    if p.clock:
        biggest = max(r.get("shift", 0) for r in p.clock)
        out.append(f"every update arrived late for a while {len(p.clock)} time(s), so the game re-anchored its clock (by up to"
                   f" {biggest} ms). Usually this computer's own clock being corrected by the system.")
    if p.drops:
        out.append(f"lost the connection {len(p.drops)} time(s).")
    if p.errors:
        out.append(f"{len(p.errors)} browser error(s), first: {p.errors[0].get('msg', '')[:80]}")
    return out


def explain_mark(p, m, stalls):
    st = m.get("st")
    if st is None:
        return "(no timing)"
    before = p.window(st - 3, st + 0.5)
    frozen = sum(r.get("frozen", 0) for r in before)
    late = max((r.get("late_max") or 0 for r in before), default=0)
    fps = min((r.get("fps") for r in before if r.get("fps")), default=None)
    ping = max((r.get("ping") or 0 for r in before), default=0)
    hitch = max((h.get("ms", 0) for h in p.hitches if h.get("st") and st - 3 <= h["st"] <= st + 0.5), default=0)
    busy = max((r.get("js_max") or 0 for r in before), default=0)       # the longest frame of the game's code
    stall = next((s for s in stalls if st - 3.5 <= s["st"] <= st + 0.5), None)
    late_press = next((r for r in p.late_presses if abs(r["st"] - st) <= 3), None)
    facts = f"frozen {frozen / 1000:.1f} s, updates up to {late:.0f} ms late, {num(fps)} fps min, ping {ping:.0f} ms"
    # The freezes that had ended by the press (what made them press L), as attribute_freezes split them;
    # with none, the page's own frames decide.
    causes = defaultdict(float)
    for f in p.all_freezes:
        if st - 3 <= f["st"] <= st + 0.1:
            causes[f.get("cause")] += f["ms"]
    computer = (causes["computer"] > causes["own"] if causes
                else hitch >= STALL_FRAME_MS or busy >= BUSY_CODE_MS)
    if stall:
        why = f"the server itself stalled {stall['ms']:.0f} ms (host computer)"
    elif (frozen >= 300 or late >= 120) and computer:
        why = (f"this computer stalled (no frame for {hitch:.0f} ms), so world updates waited unread" if hitch >= STALL_FRAME_MS
               else f"this computer was busy (a frame of the game's code took {busy:.0f} ms), so world updates waited unread")
    elif frozen >= 300 or late >= 120:
        why = "world updates arrived late (network)"
    elif (fps is not None and fps < 30) or hitch >= 150:
        why = f"this computer's frame rate (hitch {hitch:.0f} ms)" if hitch else "this computer's frame rate"
    elif late_press:
        why = f"a press arrived after the ball had hit (screen {late_press['screen_ms']:.0f} ms behind)"
    else:
        why = "nothing unusual in the numbers"
    return f"{facts} -> {why}"


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.stdout.reconfigure(errors="replace")     # a console that can't show a name's letters shows "?"
    sessions = load(Path(sys.argv[1]))
    if not sessions:
        sys.exit("No logs found there.")
    print("\n\n".join(report(name, files) for name, files in sorted(sessions.items())))


if __name__ == "__main__":
    main()
