# Contributing

Thanks for wanting to help. Dodgeball is a small party game for players on one local
network: a Python server (FastAPI + uvicorn) runs every rule of the game, and a three.js page
draws it. The design history, every decision and the architecture are in
[`docs/PROJECT.md`](docs/PROJECT.md): read it before larger changes.

## Set up

You need Python 3.10 or newer. Browser tests also need Chrome and Node 22+.

```bash
git clone https://github.com/amirtavakolihaghighi/dodgeball.git
cd dodgeball
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt     # Windows: .venv\Scripts\python -m pip ...
.venv/bin/python server.py                              # Windows: double-click run.bat instead
```

`requirements.txt` is a lockfile: exact versions for every platform, generated from
`requirements.in`. To change dependencies, edit `requirements.in` and regenerate it:

```bash
uv pip compile requirements.in --universal --python-version 3.10 -o requirements.txt
```

New dependencies need a good reason: the game runs with two.

## Tests never touch your real data

The game keeps two things between runs, next to `server.py`: the host's rules
(`saved_rules.json`) and the session logs (`logs/`). Tests must leave both alone:

- Start every test server with **`--fresh`**: default rules, nothing saved, no logs. Add
  `--log-dir <temp folder>` when a test needs logging.
- Start it with **`--no-browser`**, or it opens a browser window on your desktop.
- The automated tests already do this, and use free ports and temporary folders.
- Never point a test at a server that is hosting a real session.

```bash
python tests/test_sim.py       # the rules: 53 tests, about a minute
python tests/test_server.py    # the server over real WebSockets, the session logs, the log report
```

Browser tests drive the real client in headless Chrome: see
[`tests/browser/README.md`](tests/browser/README.md) for which ones to re-run
after which change (timing, the lobby, the logs, sidestep compensation, the clock estimate).
Outside Windows, tell them where Chrome is: `CHROME=/usr/bin/google-chrome node tests/browser/cdp.js ...`.

CI runs the Python tests on Windows, macOS and Linux with Python 3.10 to 3.14, and plays a match
in headless Chrome, on every push and pull request.

## How the code is organised

- **Every number is a rule the host can change.** A new one needs a default in `config.py`, an
  `_add(...)` line in `rules.py` (plain name, description, range, preview) and a read through
  `game.rules`. `test_every_rule_is_used_by_the_game` fails if nothing reads it.
- **The server decides everything** (`sim.py`, `bots.py`); the browser only moves its own player.
- **Some code exists twice and must stay in sync:** `sim.launch_velocity` and
  `physics.js launchVelocity`; `rules.Rules.curve_share` and `physics.js curveShare`; the `HAND_*`
  constants in `sim.py` and `main.js`; `rules.Rules._fix` and `rules_ui.js enforce`; the formulas
  in `previews.js` and `rules.py` / `sim.py`.
- **Text players read is plain language**: describe what a player notices, not the mechanism.
- **Comments explain why**, not what the line already says.
- Files use LF line endings (`.gitattributes` handles it), except Windows `.bat` files.

## Pull requests

Keep them focused, and say in the description what the change does for players or the host.
Update `docs/PROJECT.md` when a rule, a number, the protocol or a design decision changes, and add
a line under "Unreleased" in [`CHANGELOG.md`](CHANGELOG.md).

## Releases (maintainer)

1. In `CHANGELOG.md`, turn "Unreleased" into the new version with today's date, and add its link
   at the bottom.
2. Commit it: `chore(release): X.Y.Z`.
3. Tag it, annotated: `git tag -a vX.Y.Z -m "vX.Y.Z: one-line summary"`.
4. Push both: `git push` and `git push origin vX.Y.Z` (a plain `git push` doesn't send tags).
5. The **Release** workflow builds the Windows app from the tag and attaches the zip and its
   checksum to the release. Then write the release notes for someone who has never seen the game.

Versions follow [Semantic Versioning](https://semver.org): MAJOR when hosts or players have to
change how they use the game (or settings saved by an older version stop applying), MINOR for
new features, PATCH for fixes.
