"""Dodge & Parry LAN server.

Serves the browser client and runs the authoritative game simulation (sim.py).
Run:  python server.py [--port 8000] [--no-browser]
Also packaged as a standalone Windows app by build_exe.bat (no Python needed to run that).
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import socket
import sys
import threading
import time
import traceback
import webbrowser
from dataclasses import asdict
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config as C
from sim import ACTIONS, TEAM_NAMES, Game

FROZEN = getattr(sys, "frozen", False)     # running as the packaged .exe
# Bundled files sit next to this script, or inside the packaged app.
STATIC = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent)) / "static"

game = Game()
clients: dict[int, "Client"] = {}
port = 8000


def dumps(obj) -> str:
    return json.dumps(obj, separators=(",", ":"))


class Client:
    """One browser tab. Messages leave through a small queue drained by its own task, so a
    slow device can never stall the game loop: if it falls behind, old snapshots are dropped."""

    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.queue: asyncio.Queue[str] = asyncio.Queue(maxsize=8)
        self.pid: int | None = None

    def send(self, text: str):
        if self.queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                self.queue.get_nowait()
        self.queue.put_nowait(text)

    async def pump(self):
        try:
            while True:
                await self.ws.send_text(await self.queue.get())
        except Exception:
            pass    # the socket closed; the receive loop notices and cleans up


def lan_addresses() -> list[str]:
    ips = set()
    with contextlib.suppress(OSError):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))     # no packet is sent; this just picks the LAN interface
            ips.add(s.getsockname()[0])
    with contextlib.suppress(OSError):
        ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    return sorted(ip for ip in ips if not ip.startswith("127."))


def client_config() -> dict:
    """Rules the browser needs for its HUD and its own movement (the server stays in charge)."""
    return {
        "centerGap": C.CENTER_GAP,      # the court's size itself arrives with every snapshot
        "gravity": C.GRAVITY,
        "ricochet": {"normalKeep": C.RICOCHET_NORMAL_KEEP, "tangentKeep": C.RICOCHET_TANGENT_KEEP,
                     "minSpeed": C.RICOCHET_MIN_SPEED},
        "damage": {"min": C.DAMAGE_MIN, "perSpeed": C.DAMAGE_PER_SPEED, "max": C.DAMAGE_MAX},
        "playerRadius": C.PLAYER_RADIUS, "ballRadius": C.BALL_RADIUS, "chestHeight": C.CHEST_HEIGHT,
        "walk": C.WALK_SPEED, "chargeWalk": C.CHARGE_WALK_SPEED, "defendWalk": C.DEFEND_WALK_SPEED,
        "maxHp": C.MAX_HP, "maxStamina": C.MAX_STAMINA,
        "chargeTime": C.CHARGE_TIME, "throwCost": [C.THROW_COST_MIN, C.THROW_COST_MAX],
        "throwSpeed": [C.THROW_SPEED_MIN, C.THROW_SPEED_MAX], "cooldown": C.THROW_COOLDOWN,
        "actions": {kind: asdict(spec) for kind, spec in ACTIONS.items()},
        "dash": {"time": C.DODGE_DASH_TIME, "speed": C.DODGE_DASH_SPEED},
        "assistCone": C.ASSIST_CONE_DEG, "deflectCone": C.DEFLECT_ASSIST_CONE_DEG, "assistRange": C.ASSIST_RANGE,
        "reviveCost": C.REVIVE_COST, "interpDelay": C.INTERP_DELAY, "botFillMax": C.BOT_FILL_MAX,
        "joinUrls": [f"http://{ip}:{port}" for ip in lan_addresses()],
    }


async def game_loop():
    tick = 1.0 / C.TICK_RATE
    snap_interval = 1.0 / C.SNAPSHOT_RATE
    last = time.perf_counter()
    next_snap = last
    while True:
        now = time.perf_counter()
        try:
            game.tick(max(last, now - 0.1), now)
            if now >= next_snap:
                next_snap = max(next_snap + snap_interval, now)
                text = dumps(game.snapshot(now))
                for client in list(clients.values()):
                    client.send(text)
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


@app.websocket("/ws")
async def play(ws: WebSocket):
    await ws.accept()
    client = Client(ws)
    pump = asyncio.create_task(client.pump())
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
            elif kind == "join" and client.pid is None:
                p = game.add_player(msg.get("name"), msg.get("team"), now)
                client.pid = p.id
                clients[p.id] = client
                client.send(dumps({"t": "welcome", "id": p.id, "cfg": client_config()}))
                print(f"  + {p.name} joined {TEAM_NAMES[p.team]}")
            elif client.pid is not None:
                try:
                    game.handle(client.pid, msg, now)
                except Exception:
                    traceback.print_exc()
    except WebSocketDisconnect:
        pass
    finally:
        pump.cancel()
        if client.pid is not None:
            clients.pop(client.pid, None)
            p = game.players.get(client.pid)
            if p is not None:
                print(f"  - {p.name} left")
            game.remove_player(client.pid, time.perf_counter())


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


def main():
    global port
    parser = argparse.ArgumentParser(description="Dodge & Parry LAN server")
    parser.add_argument("--port", type=int, help="default: 8000, or the next free port")
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 = reachable from the LAN")
    parser.add_argument("--no-browser", action="store_true", help="don't open the game in a browser")
    args = parser.parse_args()
    port = args.port or first_free_port(args.host, 8000)
    if sys.platform == "win32":
        with contextlib.suppress(Exception):
            import ctypes
            ctypes.windll.winmm.timeBeginPeriod(1)   # 1 ms timer resolution for a steady 60 Hz loop
    print("\n  DODGE & PARRY server")
    print(f"    this computer : http://localhost:{port}")
    for ip in lan_addresses():
        print(f"    same Wi-Fi    : http://{ip}:{port}")
    print("  If Windows Firewall asks, allow access on Private networks.")
    print("  Close this window (or press Ctrl+C) to stop the server.\n")
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
