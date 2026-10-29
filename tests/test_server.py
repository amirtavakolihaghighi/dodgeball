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
    await alice.send(t="rules", player="Alice", set={"MAX_HP": 400})                # a guest can't
    await host.send(t="rules", player="Alice", set={"MAX_HP": 150, "WALK_SPEED": 9, "GRAVITY": 1})
    await asyncio.gather(host.pump(0.4), alice.pump(0.4))
    a, h = alice.rules_msgs[-1], host.rules_msgs[-1]
    assert a["players"] == h["players"] == {"Alice": {"MAX_HP": 150, "WALK_SPEED": 9.0}}  # gravity is everyone's
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
    assert m["players"] == {"Bot Ace": {"BOT_SKILL": "hard"}} and m["cfg"]["maxHp"] == 100 and m["cfg"]["teamHealth"]
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
    assert guest.hostviews[-1]["pl"] == {"n": "Bot Comet", "t": 0, "b": False} and guest.hostviews[-1]["f"] == "BOT_SKILL"
    await host.ws.close()                                          # the host leaves: everyone is told
    await asyncio.gather(guest.pump(0.5), late.pump(0.5))
    assert guest.hostviews[-1] == late.hostviews[-1] == {"t": "hostview", "m": None}
    for b in (guest, late):
        await b.ws.close()


def test_the_hosts_screen_reaches_everyone_else():
    with running_server() as (port, _key):
        asyncio.run(host_view_scenario(f"ws://127.0.0.1:{port}/ws"))


async def log_scenario(port):
    """A browser that plays for a moment and sends in its log (one chunk twice, as after a reload)."""
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
        return {"t": "log", "run": "run456", "tab": "tab123", "seq": seq, "lines": [{"ty": "sec", "i": i} for i in range(n)]}
    for msg in (chunk(1, 2), chunk(1, 2), chunk(2, 1)):
        await ws.send(json.dumps(msg))
    acks = []
    while len(acks) < 3:
        m = json.loads(await asyncio.wait_for(ws.recv(), 5))
        if m["t"] == "logack":
            acks.append(m["seq"])
    assert acks == [1, 1, 2]
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
    assert [r["ty"] for r in client_lines] == ["file", "sec", "sec", "sec"]     # the resent chunk is stored once


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


def test_the_report_tells_a_host_freeze_from_a_players_own():
    spec = importlib.util.spec_from_file_location("log_report", ROOT / "tools" / "log_report.py")
    report = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(report)

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
        assert json.loads(server.RULES_FILE.read_text()) == {
            "rules": {"GRAVITY": 3.0, "MATCH_ROUNDS_TO_WIN": 5}, "players": {"Bot Comet": {"BOT_SKILL": "hard", "MAX_HP": 150}}}
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
