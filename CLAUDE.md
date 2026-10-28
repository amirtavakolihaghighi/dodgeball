# Dodge & Parry: notes for Claude

**Read `PROJECT.md` before changing anything.** It holds the full history, every design decision and who made it, the architecture, network protocol, rules and numbers, how to run, test and build, and known pitfalls.

Quick facts:

- **Where things are:**
  - The game lives in `prototype/`.
  - `LAG_ANALYSIS.md` is the cycle-2 lag study, with what the office sessions' logs showed (Updates 2 and 3). Logging is built, and the game-side fixes are settings under Network (advanced).
  - `prototype/testlog/` holds the session logs the user collected (git-ignored: coworkers' names and IPs). Run `tools/log_report.py` on a session folder first.
- **Git:**
  - Private repo `github.com/amirtavakolihaghighi/dodge-and-parry`.
  - `main` = v1.0.0 (tagged, released with the Windows zip). Cycle-2 work is on the branch `cycle-2`.
  - Commit or push only when the user asks.
- **Stack:**
  - A Python server (FastAPI + uvicorn) runs the authoritative rules in `prototype/sim.py` and `bots.py`.
  - Every number is a host-editable rule: `rules.py` holds the name, description, range and preview; `config.py` holds the defaults. The game reads them from `game.rules`, never from `config` directly.
  - The browser client is three.js (`prototype/static/js/`).
- **The lobby:**
  - The server starts in a lobby. The host (a browser on the server's PC, or the console's `?host=KEY` link) sets up teams, bots and rules, then starts the match.
  - Host changes apply at once in the lobby and from the next round during a match.
  - Add `?guest` to a URL for the non-host view. Guests see the host's screen live (`hostview`), and the host can spectate (team -1).
- **Run for testing:** `prototype\.venv\Scripts\python prototype\server.py --port 8123 --no-browser --fresh`.
  - Always pass `--no-browser` in tests, or windows open on the user's desktop.
  - Always pass `--fresh`, or tests load or overwrite the user's `saved_rules.json`.
  - Restart the server after Python changes, and between browser test suites (it keeps changed rules in memory).
- **Rule tests:** `prototype\.venv\Scripts\python prototype\tests\test_sim.py` (all 50 must pass) and `prototype\tests\test_server.py` (all 6 must pass).
- **Session logs:**
  - Every server run writes `logs\<date_time>\` next to the app (`diag.py`). Every browser sends in its own log (`static/js/diag.js`; L marks a laggy moment).
  - The host downloads them all as one zip, and `prototype\tools\log_report.py <zip or folder>` turns them into a diagnosis. The user sends these zips to be analysed.
  - `--fresh` turns logging off; add `--log-dir <folder>` to log in tests.
- **Browser tests:**
  - See `prototype/tests/browser/README.md`.
  - Re-run the auto-defender after touching `net.js`, `main.js` threat detection or the pending/lag-compensation logic, `sidestep.json` (with `&lag=150`) after touching sidestep compensation or position reports, and `clock.json` after touching the clock estimate in `net.js`.
  - The lag study's fixes are settings under Network (advanced): view delay, press grace, sidestep compensation, the lockout scale. Defaults are in `config.py`.
  - Re-run the lobby tests after touching the lobby, rules or host code, and `logs.json` after touching the logging.
  - Kill test servers by their process tree (the venv's `python.exe` is a launcher with the server as its child).
- **Standalone Windows app:** `prototype\build_exe.bat` produces `prototype\dist\DodgeAndParry-windows.zip`, with `Allow friends to connect.bat` (the firewall helper) next to the exe. Rebuild to ship any change.
- **Decisions:** don't change decisions the user made (marked **U** in PROJECT.md section 5) without asking. Ask about genuine design forks; decide the obvious things yourself.
- **What the user values:**
  - simple but genuinely working features, verified by actually running them (no fake UI);
  - blunt, evidence-based feedback;
  - testing solo with multiple browser tabs and bots;
  - desktop/laptop only for now;
  - discussing open-ended topics (like the lag plan) before anything is built.
- **Environment:** Windows 10, Python 3.14, Node 24, Chrome. `.bat` files need CRLF line endings (`.gitattributes` enforces it).
- **Keep in sync:**
  - `sim.launch_velocity` ↔ `static/js/physics.js launchVelocity`;
  - the `HAND_*` constants in `sim.py` and `main.js`;
  - `rules.Rules._fix` ↔ `rules_ui.js enforce`;
  - the formulas in `previews.js` ↔ `rules.py` / `sim.py`;
  - `rules.Rules.curve_share` ↔ `physics.js curveShare` (how hard a ball bends at a given speed).
- **Adding a rule:** a default in `config.py`, an `_add(...)` line in `rules.py`, and a read through `game.rules`. `test_every_rule_is_used_by_the_game` fails if nothing reads it.
- **Keep this documentation current:** after meaningful changes, update `PROJECT.md` (history, decisions, numbers).
