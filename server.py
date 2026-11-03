"""Dodgeball LAN server.

Serves the browser client and runs the authoritative game simulation (sim.py).
Run:  python server.py [--port 8000] [--no-browser] [--fresh]
Also packaged as a standalone Windows app by build_exe.bat (no Python needed to run that).

The host is whoever plays in a browser on this computer (or opens the secret host link that
the console shows): they set up the lobby (teams, bots, rules) and start the match. The rules
they choose are saved next to the app and come back the next time it starts.

Every run also writes a session log under logs/ next to the app (diag.py): the server's own
numbers plus every browser's log, which the browsers send in. --no-log turns it off.
"""
from __future__ import annotations

import argparse
import asyncio
import atexit
import contextlib
import json
import os
import platform
import secrets
import socket
import subprocess
import sys
import threading
import time
import traceback
import webbrowser
from datetime import datetime
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

import diag
import rules as rules_mod
from sim import TEAM_NAMES, Game

FROZEN = getattr(sys, "frozen", False)     # running as the packaged .exe
# Bundled files sit next to this script, or inside the packaged app.
STATIC = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "static"
# Files the app writes go next to the .exe (or this script), where the user can find them.
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
RULES_FILE = APP_DIR / "saved_rules.json"
HOST_KEY = secrets.token_urlsafe(6)         # the console's host link carries it, for hosting from another device
SCHEMA = rules_mod.schema()

game = Game()
clients: dict[int, "Client"] = {}
port = 8000
save_rules = True
own_ips: list[str] = []                     # this computer's addresses (likely LAN first): browsers from them are the host
session_log: diag.SessionLog | None = None  # None: not logging (--no-log / --fresh)
stats: diag.Stats | None = None
VERSION: dict = {}
host_view: dict | None = None               # what the host's screen shows (menu, rule in focus, unapplied edits), for everyone else
HOST_VIEWS = ("game", "menu", "rules")
GROUP_IDS = {g for g, _, _ in rules_mod.GROUPS}


def dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))


class Client:
    """One browser tab. Messages leave through a small queue drained by its own task, so a
    slow device can never stall the game loop: if it falls behind, old snapshots are dropped."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
        self.pid: int | None = None
        self.name = ""
        self.key = ""           # who the player is (rules.identity_key): own settings, the team
        self.tab = ""           # the browser tab (the same across its reloads)
        self.dropped = 0        # for the session log: messages dropped, longest queue, slowest send
        self.q_max = 0
        self.send_max = 0.0

    def send(self, text: str):
        if self.queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
                self.dropped += 1
        self.queue.put_nowait(text)
        self.q_max = max(self.q_max, self.queue.qsize())

    async def pump(self):
        try:
            while True:
                text = await self.queue.get()
                started = time.perf_counter()
                await self.ws.send_text(text)
                self.send_max = max(self.send_max, time.perf_counter() - started)
        except Exception:
            pass    # the socket closed; the receive loop notices and cleans up


def lan_addresses(wait: float | None = None) -> list[str]:
    """This computer's addresses that others could join. `wait` caps the time spent looking up its
    own name: on some systems (macOS asks the local network) that takes many seconds."""
    ips = set()
    with contextlib.suppress(OSError):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))     # no packet is sent; this just picks the LAN interface
            ips.add(s.getsockname()[0])
    by_name = []

    def look_up():
        with contextlib.suppress(OSError):
            by_name.extend(socket.gethostbyname_ex(socket.gethostname())[2])
    lookup = threading.Thread(target=look_up, daemon=True)
    lookup.start()
    lookup.join(wait)
    ips.update(list(by_name))
    # 127.x is this computer only and 169.254.x means "no network": nobody else can use them.
    # Home and office networks are usually 192.168.x or 10.x; VPN adapters often use 172.x, so
    # list the likely LAN address first.
    usable = [ip for ip in ips if not ip.startswith(("127.", "169.254."))]
    return sorted(usable, key=lambda ip: (not ip.startswith("192.168."), not ip.startswith("10."), ip))


def watch_addresses():
    """Keep this computer's addresses current (a hotspot or a cable can appear mid-session),
    off the game loop: looking them up can be slow on some networks."""
    def loop():
        global own_ips
        while True:
            own_ips = lan_addresses()
            time.sleep(15)
    threading.Thread(target=loop, daemon=True).start()


def is_this_computer(ip: str | None) -> bool:
    if not ip:
        return False
    ip = ip.removeprefix("::ffff:")
    return ip.startswith("127.") or ip in ("::1", "localhost") or ip in own_ips


def say(text):
    """print() to the console, and note in the session log if Windows held the print up: a
    click in the console window (QuickEdit) pauses the program until the selection ends."""
    started = time.perf_counter()
    try:
        print(text)
    except UnicodeEncodeError:      # output redirected to a code page that lacks a name's letters
        print(text.encode("ascii", "replace").decode())
    held = time.perf_counter() - started
    if session_log and held * 1000 > diag.PRINT_BLOCK_MS:
        session_log.write({"ty": "print_block", "st": round(started, 3), "ms": diag.ms(held), "text": text.strip()[:60],
                           "wall": diag.wall_ms()})


def note_error(where: str, exc: BaseException | None = None, harmless: bool = False):
    """Keep an error in the session log too, so it can be read even without the console's text."""
    if session_log:
        text = f"{type(exc).__name__}: {exc}" if exc else where
        session_log.write({"ty": "error", "st": round(time.perf_counter(), 3), "wall": diag.wall_ms(), "where": where,
                           "error": text[:300], "harmless": harmless})


# A browser that drops its connection without closing it (a laptop lid shut, Wi-Fi lost, a tab
# killed) makes Windows' asyncio complain while it closes a socket that's already gone.
DROPPED = (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)


def loop_error(loop, context):
    """asyncio's handler for errors nothing else caught: a dropped connection is only noted in the
    session log (the console used to show a frightening traceback for it); anything else is printed
    as usual and logged."""
    exc = context.get("exception")
    if isinstance(exc, DROPPED):
        note_error("a browser's connection dropped", exc, harmless=True)
        return
    note_error(str(context.get("message") or "asyncio"), exc)
    loop.default_exception_handler(context)


def version_info() -> dict:
    """Which code this is: the packaged app's build info, or git's description of the source."""
    if FROZEN:
        with contextlib.suppress(OSError, ValueError):
            return json.loads((STATIC.parent / "build_info.json").read_text(encoding="utf-8"))
        return {"commit": "unknown"}
    with contextlib.suppress(OSError, subprocess.SubprocessError):
        out = subprocess.run(["git", "describe", "--always", "--dirty", "--tags"], cwd=APP_DIR, capture_output=True,
                             text=True, timeout=3)
        if out.stdout.strip():
            return {"commit": out.stdout.strip()}
    return {"commit": "unknown"}


def may_download_logs(ip: str | None, key: str | None) -> bool:
    """Only the host gets everyone's logs: a browser on this computer, or the host link's key."""
    return is_this_computer(ip) or (bool(key) and key == HOST_KEY)


def client_config(key: str | None = None) -> dict:
    """Rules the browser needs for its HUD and its own movement (the server stays in charge):
    the ones its player plays by, with their own settings."""
    mine = game.rules.for_player(key) if key else game.rules
    return {**mine.for_client(), "joinUrls": [f"http://{ip}:{port}" for ip in own_ips]}


def rules_message(key: str | None = None) -> dict:
    """The lobby's rules, every player's own settings (by key, with the names they go by) and the
    bots (live, and waiting for the next round), plus `cfg`: the numbers this browser's player
    plays by."""
    nxt = game.next_rules
    return {"t": "rules", "cfg": client_config(key), "rules": game.rules.values(), "players": game.rules.players,
            "labels": {**game.rules.labels, **(nxt.labels if nxt is not None else {})}, "bots": game.rules.bots_data(),
            "next": nxt.values() if nxt is not None else None, "nextPlayers": nxt.players if nxt is not None else None,
            "nextBots": nxt.bots_data() if nxt is not None else None, "rv": game.rules_version}


def send_rules():
    """Everyone gets the changed rules, each with their own `cfg`."""
    for client in list(clients.values()):
        client.send(dumps(rules_message(client.key)))


def clean_host_view(msg: dict) -> dict:
    """The host's browser reports what it shows, so the others can follow along: which screen,
    which group of rules (and whose: `pl`, a player's own settings), the search, the rule in focus
    and the edits not applied yet. Untrusted like any message: only known screens, groups and
    rules, with valid values, get through."""
    out = {"t": "hostview", "m": msg.get("m") if msg.get("m") in HOST_VIEWS else "game"}
    pl = msg.get("pl")
    if isinstance(pl, dict) and isinstance(pl.get("n"), str) and rules_mod.clean_name(pl["n"]):
        out["pl"] = {"n": rules_mod.clean_name(pl["n"]), "k": rules_mod.clean_key(pl.get("k") or pl["n"]),
                     "t": 1 if pl.get("t") == 1 else 0, "b": pl.get("b") is True}
    if msg.get("g") in GROUP_IDS:
        out["g"] = msg["g"]
    if isinstance(msg.get("q"), str):
        out["q"] = msg["q"][:40]
    if msg.get("f") in rules_mod.BY_KEY:
        out["f"] = msg["f"]
    if isinstance(msg.get("d"), dict):
        draft = {}
        for key, raw in list(msg["d"].items())[:len(rules_mod.PARAMS)]:
            param = rules_mod.BY_KEY.get(key) if isinstance(key, str) else None
            value = param.clean(raw) if param else None
            if value is not None:
                draft[key] = value
        out["d"] = draft
    return out


def share_host_view(msg: dict | None, sender: int | None = None):
    """Pass the host's screen on to everyone but the host (None: no host is connected any more)."""
    global host_view
    host_view = msg
    text = dumps(msg or {"t": "hostview", "m": None})
    for pid, client in list(clients.items()):
        if pid != sender:
            client.send(text)


def load_saved_rules():
    """The rules the host chose last time (only the values that differ from the defaults) and
    each player's own settings. Older versions saved just the rules, as one flat object."""
    try:
        saved = json.loads(RULES_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return
    if not isinstance(saved, dict):
        return
    if isinstance(saved.get("rules"), dict):
        game.rules = rules_mod.Rules(saved["rules"], saved.get("players"), saved.get("labels"), saved.get("bots"))
    else:
        game.rules = rules_mod.Rules(saved)
    changed, own = game.rules.differences(), len(game.rules.players)
    if changed or own:
        players = f", and own settings for {own} player{'' if own == 1 else 's'}" if own else ""
        print(f"  Loaded the rules you saved last time ({len(changed)} changed from the defaults{players}).")
        print("  To undo: Esc > Game rules > Reset all, in the host's browser"
              f"{' (a player: the gear next to their name)' if own else ''}.\n")


def save_current_rules():
    """Write the host's latest choice (the pending set if a match is on) without blocking the
    game. Returns the writer thread (tests wait for it), or None when saving is off."""
    if not save_rules:
        return None
    wanted = game.next_rules or game.rules
    data = {"version": 2, "rules": {k: v for k, v in wanted.values().items() if v != rules_mod.DEFAULTS[k]},
            "players": wanted.players, "labels": wanted.labels, "bots": wanted.bots_data()}
    path = RULES_FILE

    def write():
        try:
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
            os.replace(tmp, path)
        except OSError as e:
            print(f"  (couldn't save the rules to {path}: {e})")
    writer = threading.Thread(target=write, daemon=True)
    writer.start()
    return writer


async def game_loop():
    last = time.perf_counter()
    next_snap = last
    sent_rules = game.rules_version
    while True:
        now = time.perf_counter()
        tick = 1.0 / game.rules.TICK_RATE
        try:
            game.tick(max(last, now - 0.1), now)
            ticked = time.perf_counter()
            if game.rules_version != sent_rules:
                sent_rules = game.rules_version
                send_rules()
                save_current_rules()
            snap = None
            if now >= next_snap:
                next_snap = max(next_snap + 1.0 / game.rules.SNAPSHOT_RATE, now)
                snap = game.snapshot(now)
                text = dumps(snap)
                for client in list(clients.values()):
                    client.send(text)
            if stats:
                stats.loop(now, ticked - now, time.perf_counter() - ticked if snap else 0.0)
                if snap:
                    stats.events(snap["e"], now, game)
                stats.tick(now, game, clients)
        except Exception as e:
            traceback.print_exc()   # keep the match running; a bug shows up in the console
            note_error("the game loop", e)
        last = now
        await asyncio.sleep(max(0.0, tick - (time.perf_counter() - now)))


@contextlib.asynccontextmanager
async def lifespan(_app):
    asyncio.get_running_loop().set_exception_handler(loop_error)
    task = asyncio.create_task(game_loop())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def always_revalidate(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"   # edits to the client show up on reload
    return response


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/logs/download")
async def download_logs(request: Request, key: str = ""):
    """The host's "Download all logs": this session's folder, and any others from the last day, zipped."""
    if session_log is None:
        return PlainTextResponse("This server isn't saving logs (it was started with --no-log or --fresh).", 404)
    if not may_download_logs(request.client.host if request.client else None, key):
        return PlainTextResponse("Only the host can download everyone's logs.", 403)
    data = await asyncio.to_thread(session_log.zip_recent)
    # The page fetches this and saves it itself. No Content-Disposition: Chrome hands such a
    # response to its download manager and gives the page's fetch an empty 204 instead.
    name = f"dodgeball-logs-{datetime.now():%Y-%m-%d_%H-%M}.zip"
    return Response(data, media_type="application/zip", headers={"X-Filename": name})


@app.websocket("/ws")
async def play(ws: WebSocket):
    await ws.accept()
    client = Client(ws)
    pump = asyncio.create_task(client.pump())
    closed_code = None
    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            now = time.perf_counter()
            kind = msg.get("t")
            if kind == "ping":
                client.send(dumps({"t": "pong", "c": msg.get("c"), "st": round(now, 4)}))
            elif kind == "sync":    # the browser noticed it missed a rules update
                client.send(dumps(rules_message(client.key)))
            elif kind == "join" and client.pid is None:
                ip = ws.client.host if ws.client else None
                host = (is_this_computer(ip) and msg.get("guest") is not True) or msg.get("hostKey") == HOST_KEY
                client.tab = str(msg.get("tab", ""))[:24]
                code = identity(msg.get("who"), client.tab)
                client.key = rules_mod.identity_key(code)
                p = game.add_player(msg.get("name"), None, now, host=host, key=client.key)
                client.pid, client.name = p.id, p.name
                clients[p.id] = client
                extra = {"logDir": str(session_log.dir)} if host and session_log else {}
                client.send(dumps({**rules_message(client.key), "t": "welcome", "id": p.id, "host": host, "who": code,
                                   "key": client.key, "defaults": rules_mod.DEFAULTS, "schema": SCHEMA,
                                   "logging": session_log is not None, "version": VERSION, **extra}))
                if host_view and not host:
                    client.send(dumps(host_view))
                if session_log:
                    session_log.write({"ty": "join", "st": round(now, 3), "wall": diag.wall_ms(), "p": p.id, "name": p.name,
                                       "team": p.team, "host": host, "ip": ip,
                                       "via": diag.route_ip(ip) if ip and not is_this_computer(ip) else None,
                                       "tab": str(msg.get("tab", ""))[:24],
                                       "run": str(msg.get("run", ""))[:24], "ua": ws.headers.get("user-agent", "")[:200]})
                say(f"  + {p.name} joined {TEAM_NAMES[p.team]}{' (host)' if host else ''}")
            elif kind == "log" and client.pid is not None:      # a chunk of this browser's own log
                if session_log and session_log.client(msg.get("run"), client.name, msg.get("tab"), msg.get("seq"),
                                                      msg.get("lines")):
                    client.send(dumps({"t": "logack", "run": msg.get("run"), "seq": msg.get("seq")}))
            elif kind == "hostview" and client.pid is not None:  # the host's screen, for the others to follow
                p = game.players.get(client.pid)
                if p is not None and p.host:
                    share_host_view(clean_host_view(msg), client.pid)
            elif client.pid is not None:
                if stats:
                    stats.message(client.pid, msg, now, game)
                try:
                    game.handle(client.pid, msg, now)
                except Exception as e:
                    traceback.print_exc()
                    note_error(f"a '{str(msg.get('t'))[:20]}' message", e)
                p = game.players.get(client.pid)
                if p is not None and p.name != client.name:     # they renamed themselves
                    say(f"  ~ {client.name} is now {p.name}")
                    if session_log:
                        session_log.write({"ty": "rename", "st": round(now, 3), "wall": diag.wall_ms(), "p": p.id,
                                           "was": client.name, "name": p.name})
                    client.name = p.name
    except WebSocketDisconnect as e:
        closed_code = e.code
    finally:
        pump.cancel()
        if client.pid is not None:
            clients.pop(client.pid, None)
            p = game.players.get(client.pid)
            if session_log:
                session_log.write({"ty": "leave", "st": round(time.perf_counter(), 3), "wall": diag.wall_ms(), "p": client.pid,
                                   "name": client.name, "code": closed_code})
            if p is not None:
                say(f"  - {p.name} left")
            game.remove_player(client.pid, time.perf_counter())
            if p is not None and p.host and host_view and not any(q.host for q in game.players.values()):
                share_host_view(None)


def identity(code, tab: str) -> str:
    """The secret code this tab plays under. Normally the one its browser keeps, so a player is the
    same person after a reload, a dropped connection or a rename, and keeps their own settings and
    their team. Another tab of the same browser that's already playing gets a code of its own
    (testing alone with several tabs); the same tab again (a reload, or back after Wi-Fi dropped)
    takes over from its old connection."""
    code = code if isinstance(code, str) and 16 <= len(code) <= 64 else secrets.token_urlsafe(16)
    key = rules_mod.identity_key(code)
    for other in list(clients.values()):
        if other.key != key:
            continue
        if other.tab != tab or not tab:
            return identity(None, tab)
        retire(other)
    return code


def retire(client: Client):
    """An older connection of a tab that has connected again: its player leaves now, and the old
    socket closes in the background (it may be dead already)."""
    if client.pid is not None:
        clients.pop(client.pid, None)
        p = game.players.get(client.pid)
        if session_log:
            session_log.write({"ty": "leave", "st": round(time.perf_counter(), 3), "wall": diag.wall_ms(), "p": client.pid,
                               "name": client.name, "code": "replaced"})
        if p is not None:
            say(f"  - {p.name} left (reconnected)")
        game.remove_player(client.pid, time.perf_counter())
        client.pid = None

    async def close():
        with contextlib.suppress(Exception):
            await client.ws.close(code=4001)
    asyncio.get_running_loop().create_task(close())


def first_free_port(host, preferred, tries=20):
    """`preferred`, or the next port up if something else is already using it."""
    for candidate in range(preferred, preferred + tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, candidate))
                return candidate
            except OSError:
                continue
    return preferred


def open_browser_when_ready(url, port):
    def wait_then_open():
        for _ in range(100):
            with contextlib.suppress(OSError), socket.create_connection(("127.0.0.1", port), timeout=0.3):
                webbrowser.open(url)
                return
            time.sleep(0.1)
    threading.Thread(target=wait_then_open, daemon=True).start()


def start_logging(folder, args):
    global session_log, stats
    session_log = diag.SessionLog(folder)
    host = diag.HostInfo()
    stats = diag.Stats(session_log, host)
    changed = {k: v for k, v in game.rules.values().items() if v != rules_mod.DEFAULTS[k]}
    offset = datetime.now().astimezone().utcoffset()
    session_log.write({"ty": "meta", "st": round(time.perf_counter(), 3), "wall": diag.wall_ms(), "version": VERSION,
                       "python": platform.python_version(), "os": platform.platform(), "machine": platform.machine(),
                       "cpus": os.cpu_count(), "ram_mb": host.total_ram_mb(), "frozen": FROZEN, "port": port,
                       "own_ips": own_ips, "args": vars(args), "rules_changed": changed, "players_own": game.rules.players,
                       "utc_offset_min": round(offset.total_seconds() / 60) if offset else 0})
    diag.watch_host(session_log, host)
    atexit.register(session_log.flush, 2.0)


def main():
    global port, save_rules, own_ips, VERSION
    parser = argparse.ArgumentParser(description="Dodgeball LAN server")
    parser.add_argument("--port", type=int, help="default: 8000, or the next free port")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = reachable from the LAN")
    parser.add_argument("--no-browser", action="store_true", help="don't open the game in a browser")
    parser.add_argument("--fresh", action="store_true",
                        help="start with the default rules, don't save rule changes and don't log (for tests)")
    parser.add_argument("--no-log", action="store_true", help="don't write a session log")
    parser.add_argument("--log-dir", help="where session logs go (default: logs next to the app); logs even with --fresh")
    args = parser.parse_args()
    port = args.port or first_free_port(args.host, 8000)
    save_rules = not args.fresh
    VERSION = version_info()
    if sys.platform == "win32":
        with contextlib.suppress(Exception):
            import ctypes
            ctypes.windll.winmm.timeBeginPeriod(1)   # 1 ms timer resolution for a steady 60 Hz loop
    own_ips = lan_addresses(wait=2.0)    # don't hold the console up; the watcher adds late ones
    watch_addresses()
    print("\n  DODGEBALL server")
    print(f"    this computer : http://localhost:{port}    <- you're the host here: set up the lobby, then Start")
    for ip in own_ips:
        print(f"    same Wi-Fi    : http://{ip}:{port}")
    print(f"    host from another device: http://{own_ips[0] if own_ips else 'localhost'}:{port}/?host={HOST_KEY}"
          "  (keep it private)")
    if sys.platform == "win32":
        print("  Friends can't connect? Don't turn the firewall off: double-click 'Allow friends to connect.bat'")
        print("  in this folder once (it asks for administrator permission), or set this Wi-Fi to Private.")
    print("  Close this window (or press Ctrl+C) to stop the server.\n")
    if not args.fresh:
        load_saved_rules()
    if not args.no_log and (args.log_dir or not args.fresh):
        try:
            start_logging(Path(args.log_dir).resolve() if args.log_dir else APP_DIR / "logs", args)
            print(f"  This session is logged to {session_log.dir}")
            print("  Afterwards, in the game: Esc > Download all logs, and send that zip.\n")
        except OSError as e:
            print(f"  (no session log: {e})\n")
    if not args.no_browser:
        open_browser_when_ready(f"http://localhost:{port}", port)
    uvicorn.run(app, host=args.host, port=port, log_level="warning")


if __name__ == "__main__":
    try:
        main()
    finally:
        if FROZEN:      # a double-clicked .exe: keep the window open so any error can be read
            with contextlib.suppress(Exception):
                input("\n  The server has stopped. Press Enter to close this window.")
