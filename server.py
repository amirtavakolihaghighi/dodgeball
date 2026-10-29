"""Dodgeball server, for a LAN or (with --internet) for friends over the internet.

Serves the browser client and runs the authoritative game simulation (sim.py).
Run:  python server.py [--port 8000] [--no-browser] [--fresh]
      python server.py --internet --password ... --host-password ...   (see docs/INTERNET.md)
Also packaged as a standalone Windows app by build_exe.bat (no Python needed to run that).

The host is whoever plays in a browser on this computer (or opens the secret host link that
the console shows): they set up the lobby (teams, bots, rules) and start the match. The rules
they choose are saved next to the app and come back the next time it starts. In internet mode
(internet.py) players need a password and the host is whoever types the host password.

Every run also writes a session log under logs/ next to the app (diag.py): the server's own
numbers plus every browser's log, which the browsers send in. --no-log turns it off. In
internet mode there's a log folder per game night instead of one per run.
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
from urllib.parse import unquote

import uvicorn
from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

import diag
import internet
import rules as rules_mod
from sim import TEAM_NAMES, Game

FROZEN = getattr(sys, "frozen", False)     # running as the packaged .exe
# Bundled files sit next to this script, or inside the packaged app.
STATIC = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "static"
# Files the app writes go next to the .exe (or this script), where the user can find them.
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
RULES_FILE = APP_DIR / "saved_rules.json"
HOST_KEY = secrets.token_urlsafe(6)         # the console's host link carries it (in internet mode: the host password)
SCHEMA = rules_mod.schema()
REFUSED = 4001                              # WebSocket close code: not let in (the reason says why; main.js REFUSAL)
MAX_MESSAGE = 1024 * 1024                   # the biggest message anyone may send (a whole settings file is ~150 KB)
SESSION_IDLE = 30 * 60                      # internet mode: a game night's log folder closes after this long with nobody on

game = Game()
clients: dict[int, "Client"] = {}
port = 8000
save_rules = True
own_ips: list[str] = []                     # this computer's addresses (likely LAN first): browsers from them are the host
door: internet.Door | None = None           # internet mode's passwords and limits (--internet); None on a LAN
session_log: diag.SessionLog | None = None  # None: not logging (--no-log / --fresh)
stats: diag.Stats | None = None
host_info: diag.HostInfo | None = None
log_args: dict = {}                         # the command line, for the session log (never the passwords)
empty_since: float | None = None            # when the last player left (internet mode's log folders)
noted_loopback = False
VERSION: dict = {}
host_view: dict | None = None               # what the host's screen shows (menu, rule in focus, unapplied edits), for everyone else
HOST_VIEWS = ("game", "menu", "rules")
GROUP_IDS = {g for g, _, _ in rules_mod.GROUPS}


def dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))


class Client:
    """One browser tab. Messages leave through a small queue drained by its own task, so a
    slow device can never stall the game loop: if it falls behind, old snapshots are dropped."""

    def __init__(self, ws: WebSocket, ip: str | None, now: float):
        self.ws = ws
        self.ip = ip
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
        self.pid: int | None = None
        self.name = ""
        self.dropped = 0        # for the session log: messages dropped, longest queue, slowest send
        self.q_max = 0
        self.send_max = 0.0
        # Internet mode: what this connection may still send (bytes, messages).
        self.budget = ((internet.Budget(internet.BYTES_PER_S, internet.BYTES_BURST, now),
                        internet.Budget(internet.MSGS_PER_S, internet.MSGS_BURST, now)) if door else None)

    def too_much(self, size: int, now: float) -> bool:
        """Internet mode: has this connection sent more than any browser would?"""
        if not self.budget:
            return False
        if self.pid is None and size > internet.JOIN_MAX:
            return True
        bytes_ok = self.budget[0].take(size, now)
        count_ok = self.budget[1].take(1, now)
        return not (bytes_ok and count_ok)

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
    """Only the host gets everyone's logs: a browser on this computer, or the host link's key.
    In internet mode only the host password counts: behind a proxy, everyone's browser seems
    to be on this computer."""
    if door:
        return internet.same(key, HOST_KEY)
    return is_this_computer(ip) or (bool(key) and key == HOST_KEY)


def client_config(name: str | None = None) -> dict:
    """Rules the browser needs for its HUD and its own movement (the server stays in charge):
    the ones its player plays by, with their own settings. `joinUrls`: the addresses others can
    join at (none in internet mode: the browser shows the address it was opened with)."""
    mine = game.rules.for_player(name) if name else game.rules
    return {**mine.for_client(), "joinUrls": [] if door else [f"http://{ip}:{port}" for ip in own_ips]}


def rules_message(name: str | None = None) -> dict:
    """The lobby's rules and every player's own settings (live, and waiting for the next round),
    plus `cfg`: the numbers this browser's player plays by."""
    nxt = game.next_rules
    return {"t": "rules", "cfg": client_config(name), "rules": game.rules.values(), "players": game.rules.players,
            "next": nxt.values() if nxt is not None else None, "nextPlayers": nxt.players if nxt is not None else None,
            "rv": game.rules_version}


def send_rules():
    """Everyone gets the changed rules, each with their own `cfg`."""
    for client in list(clients.values()):
        client.send(dumps(rules_message(client.name)))


def clean_host_view(msg: dict) -> dict:
    """The host's browser reports what it shows, so the others can follow along: which screen,
    which group of rules (and whose: `pl`, a player's own settings), the search, the rule in focus
    and the edits not applied yet. Untrusted like any message: only known screens, groups and
    rules, with valid values, get through."""
    out = {"t": "hostview", "m": msg.get("m") if msg.get("m") in HOST_VIEWS else "game"}
    pl = msg.get("pl")
    if isinstance(pl, dict) and isinstance(pl.get("n"), str) and rules_mod.clean_name(pl["n"]):
        out["pl"] = {"n": rules_mod.clean_name(pl["n"]), "t": 1 if pl.get("t") == 1 else 0, "b": pl.get("b") is True}
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
        game.rules = rules_mod.Rules(saved["rules"], saved.get("players"))
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
    data = {"rules": {k: v for k, v in wanted.values().items() if v != rules_mod.DEFAULTS[k]},
            "players": wanted.players}
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
                if door:
                    end_idle_session(now)
        except Exception:
            traceback.print_exc()   # keep the match running; a bug shows up in the console
        last = now
        await asyncio.sleep(max(0.0, tick - (time.perf_counter() - now)))


@contextlib.asynccontextmanager
async def lifespan(_app):
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


@app.get("/join-info")
async def join_info():
    """What the join screen asks for: a password, in internet mode."""
    return {"password": door is not None}


@app.get("/logs/download")
async def download_logs(request: Request, key: str = ""):
    """The host's "Download all logs": this session's folder, and any others from the last day, zipped.
    The host's key or password comes in the X-Host-Key header (URI-encoded), or as ?key=."""
    if session_log is None:
        return PlainTextResponse("This server isn't saving logs (it was started with --no-log or --fresh).", 404)
    key = unquote(request.headers.get("x-host-key", "")) or key
    if not may_download_logs(request.client.host if request.client else None, key):
        return PlainTextResponse("Only the host can download everyone's logs.", 403)
    data = await asyncio.to_thread(session_log.zip_recent)
    # The page fetches this and saves it itself. No Content-Disposition: Chrome hands such a
    # response to its download manager and gives the page's fetch an empty 204 instead.
    name = f"dodgeball-logs-{datetime.now():%Y-%m-%d_%H-%M}.zip"
    return Response(data, media_type="application/zip", headers={"X-Filename": name})


async def refuse(ws: WebSocket, why: str):
    """Close a connection the server won't serve, saying why (the browser shows it)."""
    with contextlib.suppress(Exception):
        await ws.close(code=REFUSED, reason=why)


def turned_away(ip: str | None, why: str, name: str = ""):
    """Internet mode: a refused connection. Wrong passwords and floods show in the console too."""
    address = internet.masked(ip)
    if why == "password":
        say(f"  ! wrong password from {address}")
    elif why == "flood":
        say(f"  ! {name or address} sent far more than a browser does, and was disconnected")
    if session_log:
        session_log.write({"ty": "refused", "st": round(time.perf_counter(), 3), "wall": diag.wall_ms(), "why": why,
                           "ip": address, **({"name": name} if name else {})})


def note_loopback(ip: str | None):
    """Internet mode: a player connecting from this computer itself is expected when testing here.
    Behind a proxy or tunnel it means the player's address isn't passed on (X-Forwarded-For), and
    the limits per address then treat every player as one."""
    global noted_loopback
    address = (ip or "").removeprefix("::ffff:")
    if not noted_loopback and (address.startswith("127.") or address == "::1"):
        noted_loopback = True
        say("  (A player connected from this computer itself: fine when you test here. If players come through a\n"
            "   proxy or tunnel, it isn't passing on their address, so the limits per address count them all as one.)")


def people() -> int:
    """How many people are in the game (bots don't count)."""
    return sum(not p.bot for p in game.players.values())


@app.websocket("/ws")
async def play(ws: WebSocket):
    await ws.accept()
    ip = ws.client.host if ws.client else None
    if door and (why := door.arrive(ip)):
        turned_away(ip, why)
        await refuse(ws, why)
        return
    client = Client(ws, ip, time.perf_counter())
    pump = asyncio.create_task(client.pump())
    closed_code = None
    join_by = time.perf_counter() + internet.JOIN_TIMEOUT
    try:
        while True:
            if door and client.pid is None:     # internet mode: join soon, or the connection closes
                try:
                    message = await asyncio.wait_for(ws.receive(), join_by - time.perf_counter())
                except asyncio.TimeoutError:
                    turned_away(ip, "slow")
                    await refuse(ws, "slow")
                    break
            else:
                message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                closed_code = message.get("code")
                break
            text = message.get("text")
            now = time.perf_counter()
            if door and client.too_much(len(text if text is not None else message.get("bytes") or b""), now):
                turned_away(ip, "flood", client.name)
                await refuse(ws, "flood")
                break
            if text is None:
                continue                        # binary: browsers never send it
            try:
                msg = json.loads(text)
            except ValueError:
                continue
            if not isinstance(msg, dict):
                continue
            kind = msg.get("t")
            if kind == "ping":
                client.send(dumps({"t": "pong", "c": msg.get("c"), "st": round(now, 4)}))
            elif kind == "sync" and client.pid is not None:     # the browser noticed it missed a rules update
                client.send(dumps(rules_message(client.name)))
            elif kind == "join" and client.pid is None:
                if door:
                    # Internet mode: the password decides, never the address (behind a proxy every
                    # player seems to connect from this computer).
                    host, why = door.join(msg, ip, people(), now)
                    if why:
                        turned_away(ip, why)
                        await refuse(ws, why)
                        break
                    note_loopback(ip)
                    if session_log and not session_log.active:
                        begin_session()         # the first player of a game night
                else:
                    host = (is_this_computer(ip) and msg.get("guest") is not True) or msg.get("hostKey") == HOST_KEY
                p = game.add_player(msg.get("name"), None, now, host=host)
                client.pid, client.name = p.id, p.name
                clients[p.id] = client
                extra = {"logDir": str(session_log.dir)} if host and session_log else {}
                client.send(dumps({**rules_message(p.name), "t": "welcome", "id": p.id, "host": host,
                                   "internet": door is not None, "defaults": rules_mod.DEFAULTS, "schema": SCHEMA,
                                   "logging": session_log is not None, "version": VERSION, **extra}))
                if host_view and not host:
                    client.send(dumps(host_view))
                if session_log:
                    session_log.write({"ty": "join", "st": round(now, 3), "wall": diag.wall_ms(), "p": p.id, "name": p.name,
                                       "team": p.team, "host": host, "ip": internet.masked(ip) if door else ip,
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
                except Exception:
                    traceback.print_exc()
    finally:
        pump.cancel()
        if door:
            door.depart(ip)
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
    """On a LAN, one session log for the whole run; in internet mode, one per game night (it
    starts when the first player joins: begin_session)."""
    global session_log, stats, host_info, log_args
    session_log = diag.SessionLog(folder, start=False)
    host_info = diag.HostInfo()
    stats = diag.Stats(session_log, host_info)
    log_args = {k: v for k, v in vars(args).items() if k not in ("password", "host_password")}
    if not door:
        begin_session()
    diag.watch_host(session_log, host_info)
    atexit.register(session_log.flush, 2.0)


def begin_session():
    """A new session log folder: what this server is, then the host computer (on a thread: slow on Windows)."""
    session_log.start()
    changed = {k: v for k, v in game.rules.values().items() if v != rules_mod.DEFAULTS[k]}
    offset = datetime.now().astimezone().utcoffset()
    session_log.write({"ty": "meta", "st": round(time.perf_counter(), 3), "wall": diag.wall_ms(), "version": VERSION,
                       "python": platform.python_version(), "os": platform.platform(), "machine": platform.machine(),
                       "cpus": os.cpu_count(), "ram_mb": host_info.total_ram_mb(), "frozen": FROZEN, "port": port,
                       "internet": door is not None, "own_ips": own_ips, "args": log_args, "rules_changed": changed,
                       "players_own": game.rules.players,
                       "utc_offset_min": round(offset.total_seconds() / 60) if offset else 0})
    threading.Thread(target=diag.describe_host, args=(session_log, host_info), daemon=True).start()


def end_idle_session(now):
    """Internet mode: a game night's log folder closes once nobody has been on for SESSION_IDLE,
    so a server that runs for weeks writes nothing while it waits."""
    global empty_since
    if clients:
        empty_since = None
    elif empty_since is None:
        empty_since = now
    elif session_log.active and now - empty_since >= SESSION_IDLE:
        session_log.stop()


def main():
    global port, save_rules, own_ips, VERSION, door, HOST_KEY
    parser = argparse.ArgumentParser(description="Dodgeball server: for a LAN, or with --internet for friends "
                                     "over the internet (docs/INTERNET.md)")
    parser.add_argument("--port", type=int, help="default: 8000, or the next free port (internet mode: 8000)")
    parser.add_argument("--host", help="the address to listen on: 0.0.0.0 = every network connection (the default), "
                        "127.0.0.1 = this computer only (the default in internet mode, where HTTPS goes in front)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the game in a browser")
    parser.add_argument("--fresh", action="store_true",
                        help="start with the default rules, don't save rule changes and don't log (for tests)")
    parser.add_argument("--no-log", action="store_true", help="don't write a session log")
    parser.add_argument("--log-dir", help="where session logs go (default: logs next to the app); logs even with --fresh")
    parser.add_argument("--internet", action="store_true",
                        help="for a server on the internet: players need a password, the host is whoever types the "
                        "host password, and there are limits against abuse (docs/INTERNET.md)")
    parser.add_argument("--password", help="internet mode: the password players type (or set DODGEBALL_PASSWORD)")
    parser.add_argument("--host-password", help="internet mode: the host's password (or set DODGEBALL_HOST_PASSWORD)")
    parser.add_argument("--max-players", type=int, help="internet mode: the most people at once, bots not counted "
                        f"(default {internet.DEFAULT_MAX_PLAYERS}; the host always gets in)")
    args = parser.parse_args()
    if args.internet:
        password = (args.password or os.environ.get("DODGEBALL_PASSWORD") or "").strip()
        host_password = (args.host_password or os.environ.get("DODGEBALL_HOST_PASSWORD") or "").strip()
        if not password or not host_password:
            parser.error("internet mode needs a password for the players and one for the host: --password and "
                         "--host-password, or the environment variables DODGEBALL_PASSWORD and DODGEBALL_HOST_PASSWORD")
        if password == host_password:
            parser.error("the host password must differ from the players' password, or every player is the host")
        max_players = internet.DEFAULT_MAX_PLAYERS if args.max_players is None else args.max_players
        if max_players < 1:
            parser.error("--max-players must be at least 1")
        door = internet.Door(password, host_password, max_players)
        HOST_KEY = host_password
    elif args.password or args.host_password or args.max_players is not None:
        parser.error("--password, --host-password and --max-players are for internet mode: add --internet")
    bind = args.host or ("127.0.0.1" if door else "0.0.0.0")
    port = args.port or (8000 if door else first_free_port(bind, 8000))
    save_rules = not args.fresh
    VERSION = version_info()
    if sys.platform == "win32":
        with contextlib.suppress(Exception):
            import ctypes
            ctypes.windll.winmm.timeBeginPeriod(1)   # 1 ms timer resolution for a steady 60 Hz loop
    own_ips = lan_addresses(wait=2.0)    # don't hold the console up; the watcher adds late ones
    watch_addresses()
    if door:
        print("\n  DODGEBALL server, internet mode")
        if bind in ("127.0.0.1", "localhost", "::1"):
            print(f"    listening on {bind}:{port}: this computer only. Friends come in through HTTPS in front of it")
            print("    (docs/INTERNET.md).")
        else:
            print(f"    listening on {bind}:{port}, without HTTPS: passwords and everything else travel unencrypted.")
        print("    Players type the password to join; the host types the host password instead.")
        print(f"    At most {door.max_players} players at once (bots don't count).")
        if len(door.host_password) < 8:
            print("    The host password is short: whoever guesses it runs the game.")
        print(f"    To try it on this computer: http://localhost:{port}")
        print("  Ctrl+C stops the server.\n")
    else:
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
            if door:
                print(f"  Logs: a folder for each game night, in {session_log.root}")
            else:
                print(f"  This session is logged to {session_log.dir}")
            print("  Afterwards, in the game: Esc > Download all logs, and send that zip.\n")
        except OSError as e:
            print(f"  (no session log: {e})\n")
    if not args.no_browser and not door:    # a server on the internet has no screen to open one on
        open_browser_when_ready(f"http://localhost:{port}", port)
    uvicorn.run(app, host=bind, port=port, log_level="warning", ws_max_size=MAX_MESSAGE)


if __name__ == "__main__":
    try:
        main()
    finally:
        if FROZEN:      # a double-clicked .exe: keep the window open so any error can be read
            with contextlib.suppress(Exception):
                input("\n  The server has stopped. Press Enter to close this window.")
