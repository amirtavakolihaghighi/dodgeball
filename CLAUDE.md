# Dodgeball: notes for Claude

**Read `docs/PROJECT.md` before changing anything.** It holds the full history, every design decision and who made it, the architecture, network protocol, rules and numbers, how to run, test and build, and known pitfalls.

**Open tasks** (the full list is in section 15 of `docs/PROJECT.md`):

- **The athletes' animations: on hold, not finished** (decisions 142–143). Remind the user that they're still open. When they come back to them:
  - **First build the animation tool** (decision 143): a page in the game, like the "Hear every sound" page. First a viewer for every move and change of move (loop it, slow it down, step frame by frame, turn the camera round), then an editor for the moves placed by hand (drag the hands and feet at each key moment, change the timing, save). The options weighed are at the end of `docs/ANIMATIONS.md`.
  - Then go through `docs/ANIMATIONS.md` one move at a time (decision 142): the user tries a move and says what differs; fix only that move, and write their notes and the outcome into the list.
  - Never change a **Locked** move without the user's say. When a move is locked, add its key numbers to `LOCKS` in `tests/browser/moves.js` and a `__lock` step to `moves.json`, so a later change that alters it prints `FAIL` and the run exits with 1; re-run `moves.json` after every change to the moves.
  - Claude can't see motion: show pictures of the moment that matters, and ask for a picture of the pose the user wants.
- **The HUD and menus** in the new look (the look-and-feel plan's step 9): not started.
- **Internet mode** waits on its own branch (see Git below).

**The art and sound** (the look-and-feel cycle: phase 15 in `docs/PROJECT.md`; `docs/LOOK_AND_FEEL.md` holds its plan, the budgets, the style samples and its log):

- **Making art:**
  - Scripts in `art/` build it in Blender, run in the background. From Bash, the guard refuses a quoted path with spaces, so put Blender's folder on the PATH: `PATH="/c/Program Files/Blender Foundation/Blender 5.2:$PATH" blender.exe --background --factory-startup --python art/<script>.py -- <options>`.
  - Blender 5.2's pitfalls (black haze, mirrored lamp blobs, the slow crowd, the compositor, beams that won't show, hills that hide the sun, loading into the user's Blender) are in section 14 of `docs/PROJECT.md`.
  - Their output (renders and `.blend` files) goes to `art/out/`, which is git-ignored. What the game loads is exported as glTF into `static/`.
  - `art/athlete.py` builds the players' athlete from the style samples' shapes and writes `static/characters/` (about a minute). It runs `art/moves.py`, which downloads Mesh2Motion's CC0 animations once and retargets the clips the game uses onto the athlete (`--sheets` renders them for checking). `athlete.js` loads it; `?noathlete` keeps the stick figures, `?head=helmet` or `?head=face` puts everyone in one version.
  - `art/arena.py` builds the sports hall: it bakes the light with Cycles on the graphics card and writes `static/arena/` (about 3½ minutes; `--quick` takes 10 seconds). `world.js` loads it (`loadArena`); `?noarena` draws the plain court instead.
- **Making sound:** `art/sounds.py` downloads the CC0 recordings into `art/out/sound-sources/`, cuts and levels them, and writes `static/sounds/` (run it with `uv run --no-project --with numpy --with soundfile --with py7zr python art/sounds.py`; `--sheets`, with `--with matplotlib`, draws each cut into `art/out/sound-sheets/`). Claude can't hear: choose from measurements and those pictures, and ask the user to listen on the "Hear every sound" page (`/static/sounds.html`). The files are `.oga`, because Internet Download Manager on this PC (and maybe players' PCs) empties Chrome's requests for `.ogg`, `.mp3`, `.wav` and `.zip`.
- **The user's open Blender** is reached through the MCP tools `mcp__blender__*`:
  - `look` shows it, and `get_scene_info` describes it.
  - `execute_blender_code` runs in safe mode: `bpy`, `bmesh`, `mathutils`, `math` and `random` only, with no `os`, `open`, files or network; files go through bpy's own import, export and save.
  - Load results there for the user to turn around.
  - Never turn telemetry on.
  - The server is pinned to `mcp-for-blender==2.2.6`; if the user updates the add-on, update the pin to match its protocol.
- **Only art made here or CC0** (decision 119): Poly Haven, Quaternius's Universal Animation Library, Mesh2Motion. Never Mixamo, paid packs or the AI generators. List every CC0 source used in `THIRD_PARTY_NOTICES.md`.
- **Performance comes first** (decision 116): anything heavier must keep office laptops smooth. The budgets are in `docs/LOOK_AND_FEEL.md`, and the office laptops' measured frame rates are in phase 16 of `docs/PROJECT.md`. Claude can't see motion or hear sound, so ask the user to judge feel, animation and audio.

Quick facts:

- **Where things are:**
  - The game's code sits at the repository root (`server.py`, `sim.py`, `static/`, `tests/`, ...). Until v2.0.0 it was in `prototype/`, and the game was called Dodge & Parry.
  - `docs/MANUAL.md` is the player and host guide. `docs/LAG_ANALYSIS.md` is the cycle-2 lag study, with what the office sessions' logs showed (Updates 2 and 3). Logging is built, and the game-side fixes are settings under Network (advanced).
  - `testlog/` holds the session logs the user collected (git-ignored: coworkers' names and IPs). Run `tools/log_report.py` on a session folder first.
- **Git and GitHub:**
  - **Public** repo `github.com/amirtavakolihaghighi/dodgeball` (MIT). Never commit personal data: names, email addresses, local paths with the Windows user name, IP addresses, anything from `testlog/`. Anonymise examples taken from logs or conversations.
  - `main` holds the releases (tags `v1.0.0`, `v2.0.0`, `v2.1.0`, `v2.2.0`, `v2.3.0`). Commits use GitHub's noreply address (set in the repo's git config).
  - The history from before publishing was deleted everywhere on 2026-10-29: the user's old private repo `dodge-and-parry` and every local backup. Push `main`, explicit tags and explicitly named feature branches only (never `--all`, `--tags` or `--mirror`).
  - The branch `internet-mode` (pushed, not merged) holds internet mode, waiting for the user's friend to test it on a cloud server. Merge it into main only when the user says so. At the merge, take `--branch internet-mode` (and the sentence after it) out of the clone command in `docs/INTERNET.md`. The next steps are at the end of phase 14 in `docs/PROJECT.md`.
  - The look-and-feel cycle (graphics, juice, sound, the athletes and their moves, and the lobby batch of phase 16) was developed on the branch `look-and-feel` in its own worktree folder, merged into `main` on 2026-11-03 at the user's word, and released as v2.3.0; the worktree folder was removed. Its full record is phases 15 and 16 of `docs/PROJECT.md`.
  - Each development cycle gets its own branch from `main`, and `main` stays as it is meanwhile (decision 117). `main`'s docs say why each branch exists and give its plan; the branch's docs hold its full record and its progress. Phase and decision numbers can clash between branches: at a merge, renumber the incoming branch's after `main`'s.
  - CI starts by itself only for `main` and pull requests. On another branch, start it by hand: `gh workflow run ci.yml --ref <branch>`.
  - Commit or push only when the user asks.
  - CI (`.github/workflows/ci.yml`) runs the Python tests on Windows, macOS and Linux with Python 3.10–3.14, plus a headless-Chrome match. Pushing a `vX.Y.Z` tag builds the Windows zip in GitHub Actions (`release.yml`); the release routine is in `CONTRIBUTING.md`.
  - `requirements.txt` is a lockfile: edit `requirements.in`, then run `uv pip compile requirements.in --universal --python-version 3.10 -o requirements.txt`.
- **Stack:**
  - A Python server (FastAPI + uvicorn) runs the authoritative rules in `sim.py` and `bots.py`.
  - Every number is a host-editable rule: `rules.py` holds the name, description, range and preview; `config.py` holds the defaults. The game reads them from `game.rules`, never from `config` directly.
  - A player (or bot) may have their own settings for the rules marked `who` in `rules.py`. A player's numbers come from `p.rules` (`Rules.for_player`: everyone's with theirs on top), a ball's from `b.rules` (its thrower's); `game.rules` only for what's the same for everyone.
  - The browser client is three.js (`static/js/`).
- **The lobby:**
  - The server starts in a lobby. The host (a browser on the server's PC, or the console's `?host=KEY` link) sets up teams, bots and rules, then starts the match.
  - Host changes apply at once in the lobby and from the next round during a match.
  - Add `?guest` to a URL for the non-host view. Guests see the host's screen live (`hostview`), and the host can spectate (team -1).
- **Run for testing:** `.venv\Scripts\python server.py --port 8123 --no-browser --fresh`.
  - Always pass `--no-browser` in tests, or windows open on the user's desktop.
  - Always pass `--fresh`, or tests load or overwrite the user's `saved_rules.json`.
  - Restart the server after Python changes, and between browser test suites (it keeps changed rules in memory).
- **Rule tests:** `.venv\Scripts\python tests\test_sim.py` (all 74 must pass) and `tests\test_server.py` (all 9 must pass).
- **Session logs:**
  - Every server run writes `logs\<date_time>\` next to the app (`diag.py`). Every browser sends in its own log (`static/js/diag.js`; L marks a laggy moment).
  - The host downloads them all as one zip, and `tools\log_report.py <zip or folder>` turns them into a diagnosis. The user sends these zips to be analysed. Logs from before the rename are named `dodgeparry-...`; the report reads them the same way.
  - `--fresh` turns logging off; add `--log-dir <folder>` to log in tests.
- **Browser tests:**
  - See `tests/browser/README.md`.
  - Re-run the auto-defender after touching `net.js`, `main.js` threat detection or the pending/lag-compensation logic, `sidestep.json` (with `&lag=150`) after touching sidestep compensation or position reports, and `clock.json` after touching the clock estimate in `net.js`.
  - The lag study's fixes are settings under Network (advanced): view delay, press grace, sidestep compensation, the lockout scale. Defaults are in `config.py`.
  - Re-run the lobby tests after touching the lobby, rules or host code, `logs.json` after touching the logging, and `why_hit.json` after touching the hit marks or the hit popup.
  - Re-run `graphics.json` after touching `graphics.js`, the effects (`fxtex.js` too), the sun shadows, the ball, the hall (`loadArena`, the court's walls, the stands, the crowd) or `warmUp()` in `world.js`, or press timing (`input.js eventTime`), and `juice.json` after touching `juice.js`, where the camera is placed or the aim worked out, the effects in `onEvent`, or the see-through walls (`seeThrough`).
  - Re-run `athletes.json` after touching `athlete.js`, the stick figure's dressing or poses in `world.js`, or `static/characters/`, and `moves.json` after touching the moves (`athlete.js animate`, `art/moves.py`, the stick figure's timers).
  - Re-run `sound.json` after touching `sfx.js`, the sound calls in `main.js`, or `static/sounds/`.
  - Re-run `team_health.json` after touching team health, `regen.json` after touching health regeneration or the lobby's round-time buttons, `still.json` after touching standing still (what counts as walking, the dodge's dash, the hint), and `own_settings.json` after touching players' own settings, the ball colours or the settings files (export/import).
  - Re-run `people_bots.json` after touching who players are (keys, `server.identity`), renaming, the rules search, or the bots page, flags and lineups.
  - Kill test servers by their process tree (the venv's `python.exe` is a launcher with the server as its child).
- **Standalone Windows app:** `build_exe.bat` produces `dist\Dodgeball-windows.zip`, with `Allow friends to connect.bat` (the firewall helper) next to the exe. Rebuild to ship any change; releases are built by GitHub Actions.
- **Decisions:** don't change decisions the user made (marked **U** in `docs/PROJECT.md` section 5) without asking. Ask about genuine design forks; decide the obvious things yourself.
- **What the user values:**
  - simple but genuinely working features, verified by actually running them (no fake UI);
  - blunt, evidence-based feedback;
  - testing solo with multiple browser tabs and bots;
  - desktop/laptop only for now;
  - discussing open-ended topics (like the lag plan) before anything is built;
  - plain explanations: the user isn't a developer, SRE or devops person (a developer friend sets up servers).
- **Environment:** Windows 10, Python 3.14, Node 24, Chrome. Text files are LF and `.bat` files CRLF (`.gitattributes` enforces both).
- **Keep in sync:**
  - `sim.launch_velocity` ↔ `static/js/physics.js launchVelocity`;
  - the `HAND_*` constants in `sim.py` and `main.js`;
  - `rules.Rules._fix` ↔ `rules_ui.js keepConsistent` (also how a player's own settings combine with everyone's);
  - the rally colours: `world.js RALLY_COLORS` ↔ `previews.js RALLY_COLORS`;
  - where regeneration stops and how fast: `rules.Rules.regen_limit` ↔ `hud.js regenLimit`, `rules.Rules.regen_speed` ↔ `previews.js regenSpeed`;
  - standing still: `sim.Game._track_still` (2 cm from where you stopped; a dash, plus 0.06 s, doesn't count) ↔ `main.js trackStill`;
  - the formulas in `previews.js` ↔ `rules.py` / `sim.py`;
  - `rules.Rules.curve_share` ↔ `physics.js curveShare` (how hard a ball bends at a given speed);
  - how a bot's flags lie under its own settings: `rules.Rules.own_of` ↔ `rules_ui.js ownOf`, and the rules a flag may set: `rules.FLAG_RULES` ↔ `rules_ui.js flagRule`;
  - the longest name: `rules.NAME_LENGTH` ↔ `main.js NAME_LENGTH` (and the two name boxes' `maxlength` in `index.html`).
- **Adding a rule:** a default in `config.py`, an `_add(...)` line in `rules.py`, and a read through `game.rules`. `test_every_rule_is_used_by_the_game` fails if nothing reads it. If a player may have their own value, give it `who=` and read it through `p.rules`.
- **Keep this documentation current:** after meaningful changes, update `docs/PROJECT.md` (history, decisions, numbers) and add a line under "Unreleased" in `CHANGELOG.md`.
