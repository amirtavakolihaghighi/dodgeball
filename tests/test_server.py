"""Server tests over real WebSockets: the host, the lobby protocol, rule updates, saved rules,
and the session logs (plus the report tool that reads them).

Starts server.py on a free port (with --fresh, so your saved rules are neither used nor
touched) and talks to it like browsers do. Run with:  python tests/test_server.py
"""
import asyncio
import contextlib
import importlib.util
import io
import json
import queue
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.request
import zipfile
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import rules as rules_mod  # noqa: E402


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Browser:
    """A minimal stand-in for a browser tab: joins, then collects what the server sends."""

    def __init__(self, ws, welcome):
        self.ws, self.welcome = ws, welcome
        self.rules_msgs, self.events, self.snap, self.hostviews = [], [], None, []

    @classmethod
    async def join(cls, url, name, **extra):
        ws = await websockets.connect(url, max_queue=None)
        await ws.send(json.dumps({"t": "join", "name": name, **extra}))
        while True:
            m = json.loads(await ws.recv())
            if m["t"] == "welcome":
                return cls(ws, m)

    async def send(self, **msg):
        await self.ws.send(json.dumps(msg))

    async def pump(self, seconds):
        """Read everything for `seconds`."""
        end = time.perf_counter() + seconds
        while (left := end - time.perf_counter()) > 0:
            try:
                m = json.loads(await asyncio.wait_for(self.ws.recv(), left))
            except asyncio.TimeoutError:
                break
            if m["t"] == "rules":
                self.rules_msgs.append(m)
            elif m["t"] == "hostview":
                self.hostviews.append(m)
            elif m["t"] == "s":
                self.snap = m
                self.events += m["e"]

    def my_events(self, kind):
        me = self.welcome["id"]
        return [e for e in self.events if e["k"] == kind and e.get("p") == me]


async def scenario(url, host_key):
    host = await Browser.join(url, "Host")
    guest = await Browser.join(url, "Guest", guest=True)
    w = host.welcome
    assert w["host"] is True and guest.welcome["host"] is False         # localhost = host, unless ?guest
    assert len(w["schema"]["params"]) == len(rules_mod.PARAMS) and w["defaults"] == rules_mod.DEFAULTS
    assert w["rules"] == rules_mod.DEFAULTS and w["next"] is None and w["cfg"]["gravity"] == rules_mod.DEFAULTS["GRAVITY"]

    # A guest can't change anything.
    await guest.send(t="rules", set={"GRAVITY": 1})
    await guest.send(t="start")
    await asyncio.gather(host.pump(0.3), guest.pump(0.3))
    assert [e["why"] for e in guest.my_events("deny")] == ["host", "host"]
    assert not host.rules_msgs and host.snap["r"]["s"] == "lobby"

    # The host changes a rule in the lobby: everyone gets it at once.
    await host.send(t="rules", set={"GRAVITY": 9.5})
    await asyncio.gather(host.pump(0.3), guest.pump(0.3))
    for b in (host, guest):
        m = b.rules_msgs[-1]
        assert m["rules"]["GRAVITY"] == 9.5 and m["cfg"]["gravity"] == 9.5 and m["next"] is None

    # Start; a change mid-match is announced as pending and the live rules stay put.
    await host.send(t="start")
    await host.send(t="rules", set={"WALK_SPEED": 8})
    await asyncio.gather(host.pump(0.4), guest.pump(0.4))
    m = guest.rules_msgs[-1]
    assert m["rules"]["WALK_SPEED"] == rules_mod.DEFAULTS["WALK_SPEED"] and m["next"]["WALK_SPEED"] == 8
    assert m["cfg"]["walk"] == rules_mod.DEFAULTS["WALK_SPEED"]
    assert guest.snap["r"]["s"] == "count" and guest.snap["r"]["pend"] == 1
    assert any(e["k"] == "rules" and e["next"] for e in guest.events)

    # A tab that missed an update asks for the rules again.
    await guest.send(t="sync")
    n = len(guest.rules_msgs)
    await guest.pump(0.3)
    assert len(guest.rules_msgs) == n + 1 and guest.rules_msgs[-1]["rv"] == guest.snap["r"]["rv"]

    # The secret host link makes a guest the host (e.g. hosting from another device).
    keyed = await Browser.join(url, "Laptop", guest=True, hostKey=host_key)
    wrong = await Browser.join(url, "Snoop", guest=True, hostKey="nope")
    assert keyed.welcome["host"] is True and wrong.welcome["host"] is False

    # The host ends the match: back to the lobby, and the pending change applies now.
    await keyed.send(t="end")
    await asyncio.gather(host.pump(0.4), guest.pump(0.4), keyed.pump(0.4))
    assert guest.snap["r"]["s"] == "lobby" and guest.rules_msgs[-1]["rules"]["WALK_SPEED"] == 8
    for b in (host, guest, keyed, wrong):
        await b.ws.close()


@contextlib.contextmanager
def running_server(*extra):
    """server.py on a free port (--no-browser --fresh plus `extra`): yields (port, host key)."""
    port = free_port()
    proc = subprocess.Popen([sys.executable, "-u", str(ROOT / "server.py"), "--port", str(port), "--no-browser",
                             "--fresh", *extra], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    lines = queue.Queue()
    threading.Thread(target=lambda: [lines.put(line) for line in proc.stdout], daemon=True).start()
    try:
        key, printed = None, []
        deadline = time.time() + 20
        while key is None and time.time() < deadline:
            with contextlib.suppress(queue.Empty):
                printed.append(lines.get(timeout=0.5))
                found = re.search(r"\?host=(\S+)", printed[-1])
                key = found.group(1) if found else None
        assert key, "the console never showed the host link. It printed:\n" + "".join(printed[-30:])
        for _ in range(100):
            with socket.socket() as s:
                if s.connect_ex(("127.0.0.1", port)) == 0:
                    break
            time.sleep(0.1)
        yield port, key
    finally:
        # The venv's python.exe on Windows is a launcher with the real server as its child:
        # end the whole tree now, or the child keeps its files open for a moment longer.
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        proc.kill()
        proc.wait()


def test_lobby_protocol_over_websockets():
    with running_server() as (port, key):
        asyncio.run(scenario(f"ws://127.0.0.1:{port}/ws", key))


async def own_settings_scenario(url):
    host = await Browser.join(url, "Host")                          # RED, with Bot Ace
    alice = await Browser.join(url, "Alice", guest=True)            # BLUE, with Bot Blitz and Bot Dash
    assert alice.welcome["players"] == {} and alice.welcome["nextPlayers"] is None
    me = alice.welcome["key"]                                       # who Alice is: own settings go by it
    await alice.send(t="rules", player=me, set={"MAX_HP": 400})                     # a guest can't
    await host.send(t="rules", player=me, set={"MAX_HP": 150, "WALK_SPEED": 9, "GRAVITY": 1})
    await asyncio.gather(host.pump(0.4), alice.pump(0.4))
    a, h = alice.rules_msgs[-1], host.rules_msgs[-1]
    assert a["players"] == h["players"] == {me: {"MAX_HP": 150, "WALK_SPEED": 9.0}}  # gravity is everyone's
    assert a["labels"] == {me: "Alice"}
    assert a["cfg"]["maxHp"] == 150 and a["cfg"]["walk"] == 9 and h["cfg"]["maxHp"] == 100     # each browser its own
    assert a["rules"]["MAX_HP"] == 100 and [e["why"] for e in alice.my_events("deny")] == ["host"]
    me = next(p for p in alice.snap["p"] if p[0] == alice.welcome["id"])
    assert me[7] == 150                                             # and the server plays by them
    # A settings file: its rules (any it leaves out back to their default) and players' own settings.
    await host.send(t="rules", **{"import": {"rules": {"TEAM_HEALTH": True, "BALL_COLOR_RED": "#00FF00"},
                                             "players": {"Bot Ace": {"BOT_SKILL": "hard"}, "Alice": {"NOT_A_RULE": 1}}}})
    await asyncio.gather(host.pump(0.4), alice.pump(0.4))
    m = alice.rules_msgs[-1]
    assert m["rules"]["TEAM_HEALTH"] is True and m["rules"]["BALL_COLOR_RED"] == "#00ff00"
    assert m["players"] == {"b:ace": {"BOT_SKILL": "hard"}} and m["cfg"]["maxHp"] == 100 and m["cfg"]["teamHealth"]
    assert alice.snap["r"]["th"] == [[200, 200], [300, 300]]       # team health: everyone's health added up
    for b in (host, alice):
        await b.ws.close()


def test_each_player_gets_their_own_settings_and_a_file_replaces_the_setup():
    with running_server() as (port, _key):
        asyncio.run(own_settings_scenario(f"ws://127.0.0.1:{port}/ws"))


async def host_view_scenario(url):
    host = await Browser.join(url, "Host")
    guest = await Browser.join(url, "Guest", guest=True)
    await guest.send(t="hostview", m="rules", f="GRAVITY")          # only the host's screen is shared
    await host.send(t="hostview", m="rules", g="ricochet", q="curve" * 20, f="RICOCHET_CURVE_KEEP",
                    d={"RICOCHET_CURVE_KEEP": 0.3, "GRAVITY": "fast", "NOT_A_RULE": 1, "BOTS_RED": 99})
    await asyncio.gather(host.pump(0.3), guest.pump(0.3))
    assert not host.hostviews
    assert guest.hostviews == [{"t": "hostview", "m": "rules", "g": "ricochet", "q": ("curve" * 20)[:40],
                                "f": "RICOCHET_CURVE_KEEP", "d": {"RICOCHET_CURVE_KEEP": 0.3, "BOTS_RED": 12}}]
    late = await Browser.join(url, "Late", guest=True)             # joining now: sees it straight away
    await late.pump(0.2)
    assert late.hostviews and late.hostviews[0]["f"] == "RICOCHET_CURVE_KEEP"
    # One player's own settings: whose page it is goes along, cleaned like the rest.
    await host.send(t="hostview", m="rules", pl={"n": "Bot Comet\n", "t": 7, "b": "yes"}, g="bots", f="BOT_SKILL")
    await guest.pump(0.3)
    assert guest.hostviews[-1]["pl"] == {"n": "Bot Comet", "k": "b:comet", "t": 0, "b": False}
    assert guest.hostviews[-1]["f"] == "BOT_SKILL"
    await host.ws.close()                                          # the host leaves: everyone is told
    await asyncio.gather(guest.pump(0.5), late.pump(0.5))
    assert guest.hostviews[-1] == late.hostviews[-1] == {"t": "hostview", "m": None}
    for b in (guest, late):
        await b.ws.close()


async def identity_scenario(url):
    def players(b):
        return {p[0]: p for p in b.snap["p"]}

    code = "a-browser-secret-code-0001"
    host = await Browser.join(url, "Host")
    sam = await Browser.join(url, "Sam", guest=True, who=code, tab="tab-1")
    other = await Browser.join(url, "Sam", guest=True, who="another-browser-code-0002", tab="tab-9")
    assert sam.welcome["who"] == code and sam.welcome["key"] == rules_mod.identity_key(code)
    assert other.welcome["key"] != sam.welcome["key"]               # the same name, two people
    await host.send(t="rules", player=sam.welcome["key"], set={"MAX_HP": 220})
    await asyncio.gather(host.pump(0.3), sam.pump(0.3), other.pump(0.3))
    ps = players(host)
    assert ps[sam.welcome["id"]][7] == 220 and ps[other.welcome["id"]][7] == 100
    assert ps[sam.welcome["id"]][18] == sam.welcome["key"]           # every player's key, for the menus
    team = ps[sam.welcome["id"]][2]
    # A second tab of the same browser plays as someone else; the same tab again takes over.
    tab2 = await Browser.join(url, "Sam too", guest=True, who=code, tab="tab-2")
    assert tab2.welcome["who"] != code and tab2.welcome["key"] != sam.welcome["key"]
    back = await Browser.join(url, "Sam", guest=True, who=code, tab="tab-1")
    await asyncio.gather(host.pump(0.3), back.pump(0.3))
    ps = players(host)
    assert sam.welcome["id"] not in ps and ps[back.welcome["id"]][7] == 220
    assert ps[back.welcome["id"]][2] == team                        # and its team
    # Renaming over the network: the name changes, nothing else.
    await back.send(t="rename", name="Mina")
    await asyncio.gather(host.pump(0.3), back.pump(0.3))
    ps = players(host)
    assert ps[back.welcome["id"]][1] == "Mina" and ps[back.welcome["id"]][7] == 220
    assert [e["name"] for e in back.my_events("rename")] == ["Mina"]
    for b in (host, sam, other, tab2, back):
        with contextlib.suppress(Exception):
            await b.ws.close()


def test_who_a_player_is_follows_their_browser_not_their_name():
    with running_server() as (port, _key):
        asyncio.run(identity_scenario(f"ws://127.0.0.1:{port}/ws"))


def test_the_hosts_screen_reaches_everyone_else():
    with running_server() as (port, _key):
        asyncio.run(host_view_scenario(f"ws://127.0.0.1:{port}/ws"))


async def log_scenario(port):
    """A browser that plays for a moment and sends in its log (out of order, and one chunk twice, as
    after a reload)."""
    ws = await websockets.connect(f"ws://127.0.0.1:{port}/ws", max_queue=None)
    await ws.send(json.dumps({"t": "join", "name": "Logan", "tab": "tab123", "run": "run456"}))
    while (welcome := json.loads(await ws.recv()))["t"] != "welcome":
        pass
    assert welcome["logging"] is True and welcome["host"] is True and welcome["logDir"] and welcome["version"]["commit"]
    end = time.perf_counter() + 2.5
    while time.perf_counter() < end:
        now = time.perf_counter()
        await ws.send(json.dumps({"t": "in", "x": -5, "z": 0, "yaw": 1.57, "pitch": 0, "wt": now - 0.1, "tp": 1}))
        await asyncio.sleep(1 / 30)

    def chunk(seq, n):
        return {"t": "log", "run": "run456", "tab": "tab123", "seq": seq,
                "lines": [{"ty": "sec", "seq": seq, "i": i} for i in range(n)]}
    for msg in (chunk(2, 1), chunk(1, 2), chunk(1, 2)):     # out of order, and one chunk twice
        await ws.send(json.dumps(msg))
    acks = []
    while len(acks) < 3:
        m = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if m["t"] == "logack":
            acks.append(m["seq"])
    assert acks == [2, 1, 1]
    await ws.close()


def test_the_session_log_keeps_the_server_and_every_browser():
    with tempfile.TemporaryDirectory() as tmp, running_server("--log-dir", tmp) as (port, _key):
        asyncio.run(log_scenario(port))
        time.sleep(0.3)
        data = urllib.request.urlopen(f"http://127.0.0.1:{port}/logs/download", timeout=10).read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        server_lines = [json.loads(line) for n in names if n.endswith("/server.jsonl") for line in z.read(n).splitlines()]
        client_name = next(n for n in names if "/client-run456-Logan" in n)
        client_lines = [json.loads(line) for line in z.read(client_name).splitlines()]
    assert {"meta", "join", "sec", "leave"} <= {r["ty"] for r in server_lines}
    join = next(r for r in server_lines if r["ty"] == "join")
    assert join["tab"] == "tab123" and join["run"] == "run456" and join["host"] and join["ip"] == "127.0.0.1"
    inputs = [n["in"] for r in server_lines if r["ty"] == "sec" for n in r["net"] if n["p"] == join["p"]]
    assert inputs and max(inputs) >= 20                 # ~30 inputs a second, seen from the server
    assert [r["ty"] for r in client_lines] == ["file", "sec", "sec", "sec"]     # each chunk stored once...
    assert sorted((r["seq"], r["i"]) for r in client_lines[1:]) == [(1, 0), (1, 1), (2, 0)]   # ...whatever the order


class Recorder:
    """Stands in for diag.SessionLog: keeps what's written."""

    def __init__(self):
        self.records = []

    def write(self, record, file="server"):
        self.records.append(record)

    def of(self, kind):
        return [r for r in self.records if r["ty"] == kind]


def test_stalls_late_presses_and_held_up_prints_are_logged():
    import diag
    import server
    from sim import Game
    log = Recorder()
    stats = diag.Stats(log, diag.HostInfo())
    for t in (10.0, 10.016, 10.4, 10.416):              # one 384 ms gap in the game loop
        stats.loop(t, 0.001, 0.0)
    assert [round(r["ms"]) for r in log.of("stall")] == [384]
    game = Game()
    pia = game.add_player("Pia", 0, 20.0)
    stats.events([{"k": "hit", "t": 20.0, "p": pia.id, "by": 99, "speed": 30.0, "dmg": 40, "ko": False}], 20.12, game)
    stats.message(pia.id, {"t": "act", "a": "catch", "wt": 19.6}, 20.25, game)     # too early even on her screen
    assert not log.of("late_press") and log.of("hit")[0]["p"] == pia.id
    stats.message(pia.id, {"t": "act", "a": "catch", "wt": 19.95}, 20.30, game)    # in time on screen, late here
    late = log.of("late_press")
    assert len(late) == 1 and late[0]["screen_ms"] == 350 and late[0]["after_hit_ms"] == 180 and late[0]["over_cap"]
    stats.message(pia.id, {"t": "act", "a": "deflect", "wt": 20.01}, 20.4, game)   # a hair after contact: the grace
    assert len(log.of("late_press")) == 2
    stats.message(pia.id, {"t": "act", "a": "dodge", "wt": 29.7}, 30.0, game)      # no ball: 0.30 s behind, over 0.25
    stats.message(pia.id, {"t": "act", "a": "dodge", "wt": 29.85}, 30.0, game)     # 0.15 s behind: within the limit
    # Past the limit: the too-early catch (0.65 s behind) and the first dodge; a late press is only counted as late.
    capped = [(r["a"], r["screen_ms"], r["cap_ms"]) for r in log.of("capped")]
    assert capped == [("catch", 650, 250), ("dodge", 300, 250)], capped

    class SlowConsole(io.StringIO):                      # a console with a QuickEdit selection in it
        def write(self, text):
            time.sleep(0.15)
            return super().write(text)
    saved = server.session_log, sys.stdout
    server.session_log, sys.stdout = log, SlowConsole()
    try:
        server.say("  + Pia joined RED")
    finally:
        server.session_log, sys.stdout = saved
    held = log.of("print_block")
    assert len(held) == 1 and held[0]["ms"] >= 140


def load_report():
    spec = importlib.util.spec_from_file_location("log_report", ROOT / "tools" / "log_report.py")
    report = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(report)
    return report


def test_the_report_tells_a_host_freeze_from_a_players_own():
    report = load_report()

    def at(st):
        return int((st + 1000) * 1000)

    def sec(st, **values):
        return {"ty": "sec", "st": st, "wall": at(st), "span": 1000, "fps": 60, "frozen": 0, "late_max": 10, "ping": 8, **values}

    seconds = [float(t) for t in range(40, 120)]
    server = [{"ty": "meta", "version": {"commit": "test"}, "cpus": 8, "ram_mb": 16000, "utc_offset_min": 0},
              *[{"ty": "sec", "st": t, "wall": at(t), "gap_max": 17, "net": []} for t in seconds],
              {"ty": "stall", "st": 100.0, "ms": 1500.0, "wall": at(100)}]
    wifi = [{"ty": "file", "tab": "a", "name": "Wifi"}, {"ty": "welcome", "id": 1, "name": "Wifi"},
            *[sec(t, frozen=300, late_max=250) for t in seconds],
            *[{"ty": "freeze", "st": t, "ms": 800, "wall": at(t)} for t in (50.0, 60.0, 70.0, 80.0)],
            {"ty": "freeze", "st": 101.4, "ms": 1400, "wall": at(101.4)},
            {"ty": "mark", "st": 61.0, "wall": at(61)}, {"ty": "mark", "st": 101.6, "wall": at(101.6)}]
    cable = [{"ty": "file", "tab": "b", "name": "Cable"}, {"ty": "welcome", "id": 2, "name": "Cable"},
             *[sec(t, frozen=1000 if t == 101 else 450 if t == 102 else 0) for t in seconds],
             {"ty": "freeze", "st": 101.45, "ms": 1450, "wall": at(101.45)}]
    text = report.report("test", {"server": server, "client-a-Wifi": wifi, "client-b-Cable": cable})
    lines = text.splitlines()
    assert any("Wifi: the picture froze 30.0%" in s and "on its own" in s for s in lines), text
    assert any("Cable: the picture froze 1.8%" in s and "server stalled" in s for s in lines), text
    assert "The server stalled 1 times" in text and "2 players (Cable, Wifi)" in text
    marks = [s for s in lines if " -> " in s and "Wifi" in s]
    assert len(marks) == 2 and "(network)" in marks[0] and "the server itself stalled 1500 ms" in marks[1], marks


def test_the_report_goes_by_page_loads_and_tells_a_busy_computer_from_wifi():
    """The 9 and 10 Nov office logs: a PC clock two minutes slow lost a player's first minutes, an
    overloaded laptop's frozen picture was put down to its Wi-Fi, a renamed player kept their old
    name, joining counted as lag, and four quick presses of L were four moments."""
    report = load_report()

    def at(st, skew=0.0):           # a wall clock; `skew`: this PC's clock is that far off
        return int((st + 1000 + skew) * 1000)

    def sec(st, skew=0.0, **values):
        return {"ty": "sec", "st": st, "wall": at(st, skew), "span": 1000, "fps": 60, "frozen": 0, "late_max": 10,
                "ping": 8, **values}

    seconds = [float(t) for t in range(42, 120)]
    server = [{"ty": "meta", "st": 40.0, "wall": at(40), "version": {"commit": "test"}, "utc_offset_min": 0},
              {"ty": "join", "st": 41.0, "wall": at(41), "p": 1, "name": "Slow", "tab": "a", "run": "ra"},
              {"ty": "join", "st": 41.0, "wall": at(41), "p": 2, "name": "Busy", "tab": "b", "run": "rb"},
              {"ty": "rename", "st": 60.0, "wall": at(60), "p": 2, "was": "Busy", "name": "Hasty"},
              *[{"ty": "sec", "st": t, "wall": at(t), "gap_max": 17, "net": []} for t in seconds]]
    slow = [{"ty": "file", "run": "ra", "tab": "a", "name": "Slow"},
            {"ty": "welcome", "st": None, "wall": at(41, -130), "id": 1, "name": "Slow"},
            {"ty": "env", "st": None, "wall": at(41, -130), "gpu": "Test GPU"},
            *[sec(t, -130) for t in seconds],
            *[{"ty": "mark", "st": 70.0 + i * 0.2, "wall": at(70 + i * 0.2, -130)} for i in range(4)]]
    busy = [{"ty": "file", "run": "rb", "tab": "b", "name": "Busy"},
            {"ty": "welcome", "st": None, "wall": at(41), "id": 2, "name": "Busy"},
            sec(43.0, late_max=2000),                    # the stutter of joining: not lag
            *[sec(t, frozen=300, late_max=250, js_max=150) for t in seconds if t != 43],
            *[r for t in (60.0, 70.0, 80.0) for r in ({"ty": "hitch", "st": t, "wall": at(t), "ms": 400},
                                                      {"ty": "freeze", "st": t, "wall": at(t), "ms": 400})]]
    leftover = [{"ty": "file", "run": "old", "tab": "c", "name": "Leftover"},
                {"ty": "welcome", "st": None, "wall": at(41), "id": 9, "name": "Leftover"}, *[sec(t) for t in seconds]]
    text = report.report("test", {"server": server, "client-ra-Slow": slow, "client-rb-Busy": busy,
                                  "client-old-Leftover": leftover})
    lines = text.splitlines()
    assert "Leftover" not in text and "| 00:17:20 to 00:18:39 (1 min) |" in text, text   # this server's pages, its clock
    assert any(s.strip().startswith("Slow") and "Test GPU" in s for s in lines), text  # kept despite its clock
    assert "Hasty (joined as Busy)" in text and "2000 ms" not in text, text
    assert any("Hasty: the picture froze" in s and "their computer, not the network" in s for s in lines), text
    marks = [s for s in lines if " -> " in s]
    assert len(marks) == 1 and "Slow" in marks[0] and "(L 4 times)" in marks[0], marks


def test_the_hosts_rules_are_saved_and_come_back():
    import server
    from sim import Game
    with tempfile.TemporaryDirectory() as tmp:
        server.RULES_FILE = Path(tmp) / "saved_rules.json"
        server.save_rules = True
        server.game = Game()
        server.game.set_rules({"GRAVITY": 3, "MATCH_ROUNDS_TO_WIN": 5}, 0.0)
        server.game.set_player_rules("Bot Comet", {"BOT_SKILL": "hard", "MAX_HP": 150}, 0.0)
        server.save_current_rules().join()
        saved = json.loads(server.RULES_FILE.read_text())
        assert saved["version"] == 2 and saved["rules"] == {"GRAVITY": 3.0, "MATCH_ROUNDS_TO_WIN": 5}
        assert saved["players"] == {"b:comet": {"BOT_SKILL": "hard", "MAX_HP": 150}} and saved["bots"]["lineup"] == [
            ["ace"], ["blitz", "dash"]]
        server.game = Game()
        server.load_saved_rules()
        assert server.game.rules.GRAVITY == 3 and server.game.rules.MATCH_ROUNDS_TO_WIN == 5
        assert server.game.rules.for_player("Bot Comet").MAX_HP == 150      # players' own settings come back too
        server.RULES_FILE.write_text(json.dumps({"GRAVITY": 4}))           # older versions saved the rules alone
        server.game = Game()
        server.load_saved_rules()
        assert server.game.rules.GRAVITY == 4 and not server.game.rules.players
        server.RULES_FILE.write_text("{not json")                  # a damaged file is ignored
        server.game = Game()
        server.load_saved_rules()
        assert server.game.rules.GRAVITY == rules_mod.DEFAULTS["GRAVITY"]


def test_a_dropped_connection_is_only_noted():
    """Windows' asyncio complains when a browser drops its connection without closing it (a shut
    laptop, lost Wi-Fi): the server notes it in the session log instead of printing a traceback in
    its window. Anything else is still printed, and noted too."""
    import server
    noted, printed = [], []

    class Loop:
        def default_exception_handler(self, context):
            printed.append(context)
    real = server.note_error
    server.note_error = lambda where, exc=None, harmless=False: noted.append((where, type(exc).__name__, harmless))
    try:
        server.loop_error(Loop(), {"message": "Exception in callback _ProactorBasePipeTransport._call_connection_lost()",
                                   "exception": ConnectionResetError(10054, "An existing connection was forcibly closed")})
        server.loop_error(Loop(), {"message": "Task exception was never retrieved", "exception": ValueError("boom")})
    finally:
        server.note_error = real
    assert noted == [("a browser's connection dropped", "ConnectionResetError", True),
                     ("Task exception was never retrieved", "ValueError", False)]
    assert len(printed) == 1 and isinstance(printed[0]["exception"], ValueError)


def test_the_moves_page_and_its_list_are_served():
    """The moves page (static/moves.html) and the list it reads: docs/ANIMATIONS.md, every move by
    its number, its notes and its status. That one file only: the rest of the docs stay unserved."""
    with running_server() as (port, _key):
        base = f"http://127.0.0.1:{port}"
        page = urllib.request.urlopen(f"{base}/static/moves.html", timeout=10).read().decode()
        with urllib.request.urlopen(f"{base}/docs/ANIMATIONS.md", timeout=10) as res:
            kind, text = res.headers.get_content_type(), res.read().decode()
        try:
            urllib.request.urlopen(f"{base}/docs/PROJECT.md", timeout=10)
            other = 200
        except urllib.error.HTTPError as e:
            other = e.code
    assert "move_view.js" in page
    assert kind == "text/markdown"
    assert "| A1 | Idle |" in text and "| J14 |" in text and "Locked" in text
    assert other == 404


def _post_json(url, data):
    """POST JSON (or raw bytes); returns (status, parsed JSON or the error's text)."""
    body = data if isinstance(data, bytes) else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def test_the_moves_page_saves_the_moves_made_here():
    """The moves page's editor saves the moves placed by hand (static/characters/made_moves.json):
    only what fits the file (the same moves and parts, each value the same shape, key times in
    order, sane numbers), in the file's own layout, keeping the file it replaces. --fresh saves
    nothing; --moves-file saves into another file (this test's copy)."""
    import moves_file
    real = ROOT / "static" / "characters" / "made_moves.json"
    original = real.read_text(encoding="utf-8")
    # the file is in its own layout: saving it unchanged writes it byte for byte
    assert moves_file.text(json.loads(original)) == original

    with running_server() as (port, _key):          # --fresh: tests never change the real file
        base = f"http://127.0.0.1:{port}"
        fresh = json.load(urllib.request.urlopen(f"{base}/moves/saving", timeout=10))
        refused = _post_json(f"{base}/moves/save", json.loads(original))
    assert fresh["can"] is False and "--fresh" in fresh["why"]
    assert refused[0] == 403 and real.read_text(encoding="utf-8") == original

    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "made_moves.json"
        target.write_text(original, encoding="utf-8", newline="\n")
        saves = Path(tmp) / "move_saves"
        with running_server("--moves-file", str(target)) as (port, _key):
            base = f"http://127.0.0.1:{port}"
            status = json.load(urllib.request.urlopen(f"{base}/moves/saving", timeout=10))
            unchanged = _post_json(f"{base}/moves/save", json.loads(original))
            data = json.loads(original)
            data["PARRY_L"]["hand"][2] = [0.3, [0.45, 1.36, 0.42], "pass"]     # moved, retimed, passed through
            data["PARRY_L"]["blend"]["out"] = 0.2
            data["GUARD_L"]["hand"][0] = -0.0812345                            # kept to 4 decimals
            data["about"] = "the page can't change the descriptions"
            saved = _post_json(f"{base}/moves/save", data)
            after_save = target.read_text(encoding="utf-8")

            def broken(change):
                d = json.loads(after_save)
                change(d)
                return d
            bad = {
                "keys out of order": broken(lambda d: d["PARRY_L"]["chest"].insert(1, [0.9, 0.1])),
                "a move missing": broken(lambda d: d.pop("CATCH_L")),
                "an unknown part": broken(lambda d: d["GUARD_L"].update(elbow=[1, 0, 0])),
                "not a place": broken(lambda d: d["GUARD_L"].update(hand=[0, 1])),
                "a key not a stop or a pass": broken(lambda d: d["DASH_SIDE"]["bend"][1].append("fast")),
                "a key past the move's end": broken(lambda d: d["DASH_BACK"]["hips"].append([2.5, [0, 0, 0]])),
                "a blend out of 0": broken(lambda d: d["DASH_SIDE"]["blend"].update(out=0)),
                "a huge number": broken(lambda d: d["CATCH_L"].update(chest=1e9)),
                "text for a number": broken(lambda d: d["CATCH_L"].update(chest="-0.55")),
            }
            refusals = {name: _post_json(f"{base}/moves/save", d) for name, d in bad.items()}
            refusals["not a number at all"] = _post_json(f"{base}/moves/save", original.replace("-0.55", "NaN").encode())
            refusals["not JSON"] = _post_json(f"{base}/moves/save", b"{nope")
            final = target.read_text(encoding="utf-8")
        kept = [k.read_text(encoding="utf-8") for k in sorted(saves.glob("made_moves_*.json"))]

    assert status == {"can": True, "why": None}
    assert unchanged == (200, {"ok": True, "kept": None, "made": json.loads(original)})     # nothing changed: nothing kept
    assert saved[0] == 200 and saved[1]["kept"].startswith("move_saves/made_moves_"), saved
    written = json.loads(after_save)
    assert written == saved[1]["made"]
    assert written["PARRY_L"]["hand"][2] == [0.3, [0.45, 1.36, 0.42], "pass"] and written["PARRY_L"]["blend"]["out"] == 0.2
    assert written["GUARD_L"]["hand"][0] == -0.0812
    assert written["about"] == json.loads(original)["about"]                      # the descriptions stay the file's own
    assert after_save == moves_file.text(written)                                 # the file's layout
    assert '      [0.3, [0.45, 1.36, 0.42], "pass"],\n' in after_save             # a key a line
    assert kept == [original]                                                      # the file it replaced, kept
    for name, (code, why) in refusals.items():
        assert code == 400 and why.startswith("Not saved:"), (name, code, why)
    assert final == after_save                                                     # none of them changed the file
    assert real.read_text(encoding="utf-8") == original


def run_all():
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            fn()
            print(f"  ok    {name}")
        except Exception:
            failed += 1
            print(f"  FAIL  {name}")
            traceback.print_exc()
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    return failed


if __name__ == "__main__":
    sys.exit(1 if run_all() else 0)
