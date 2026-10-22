# Dodge & Parry: notes for Claude

**Read `PROJECT.md` before changing anything.** It holds the full history, every design decision and who made it, the architecture, network protocol, rules and numbers, how to run, test and build, and known pitfalls.

Quick facts:

- **Where things are:** the game lives in `prototype/`.
- **Stack:** a Python server (FastAPI + uvicorn) runs the authoritative rules (`prototype/sim.py`, `bots.py`, numbers in `config.py`). The browser client is three.js (`prototype/static/js/`).
- **Run for testing:** `prototype\.venv\Scripts\python prototype\server.py --port 8123 --no-browser`. Always pass `--no-browser` in tests, or windows open on the user's desktop. Restart the server after Python changes.
- **Rule tests:** `prototype\.venv\Scripts\python prototype\tests\test_sim.py`. All 30 must pass.
- **Browser tests:** see `prototype/tests/browser/README.md`. Re-run the auto-defender after touching `net.js`, threat detection or the pending/lag-compensation logic.
- **Standalone Windows app:** `prototype\build_exe.bat` produces `prototype\dist\DodgeAndParry-windows.zip`. Rebuild to ship any change.
- **Decisions:** don't change decisions the user made (marked **U** in PROJECT.md section 5) without asking. Ask about genuine design forks; decide the obvious things yourself.
- **What the user values:** simple but genuinely working features, verified by actually running them (no fake UI); blunt, evidence-based feedback; testing solo with multiple browser tabs and bots; desktop/laptop only for now.
- **Environment:** Windows 10, Python 3.14, Node 24, Chrome. `.bat` files need CRLF line endings.
- **Keep in sync:** `sim.launch_velocity` ↔ `main.js launchVelocity`, and the `HAND_*` constants in both files.
- **Keep this documentation current:** after meaningful changes, update `PROJECT.md` (history, decisions, numbers).
