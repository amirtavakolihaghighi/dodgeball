# Dodgeball: full project context and history

This document is the complete hand-off for the project. It's written so that a brand-new chat (an AI assistant with no memory of earlier conversations) or a returning human can pick up the work: what the game is, how it got here, every design decision and who made it, how the code works, how to run, test and ship it, and the pitfalls already discovered.

- **In Claude Code:** `CLAUDE.md` in the repository root loads automatically and points here.
- **In any other chat tool:** attach this file.

Last updated: 2026-10-29 (development cycle 2: lobby, host controls, rules editor, lag analysis, session logs; then the office logs, ball-curve rules, per-team bots, host spectating, the host's screen shown live, team cash, press feedback and the firewall helper; then the lag study's five suggestions and the press lockout as Network settings; then the 28 Oct office session and a fix for a browser whose clock ran fast; then publishing as **Dodgeball**: a public repository with a rebuilt history, the game at the repository root, CI and release builds).

## Contents

1. [The game in one paragraph](#1-the-game-in-one-paragraph)
2. [The user and how they like to work](#2-the-user-and-how-they-like-to-work)
3. [Folder map](#3-folder-map)
4. [History: the path from idea to now](#4-history-the-path-from-idea-to-now)
5. [Decision log](#5-decision-log)
6. [Current features](#6-current-features)
7. [Rules and numbers](#7-rules-and-numbers)
8. [Architecture](#8-architecture)
9. [Network protocol](#9-network-protocol)
10. [Server code tour](#10-server-code-tour)
11. [Client code tour](#11-client-code-tour)
12. [Bots](#12-bots)
13. [Running, testing, building, sharing](#13-running-testing-building-sharing)
14. [Pitfalls and lessons learned](#14-pitfalls-and-lessons-learned)
15. [Known limitations and ideas for next steps](#15-known-limitations-and-ideas-for-next-steps)
16. [Glossary](#16-glossary)

## 1. The game in one paragraph

**Dodgeball** (called Dodge & Parry until v2.0.0) is a real-time multiplayer 3D dodgeball game played in the browser on a local network, with no internet needed:

- **The core:** two teams throw balls at each other. Stamina limits everything, Dark Souls-style. An incoming ball can be **dodged**, **caught** or **deflected**, and pressing at the last moment is "perfect", which is cheaper and pays more.
- **Rallies:** a ball deflected back and forth gets faster every time.
- **Throwing:** throws are charged, and harder throws cost more stamina, fly faster and deal more damage. Balls fly in gentle arcs and can ricochet once off the floor or a side wall.
- **Elimination:** 0 HP knocks you out, and teammates can spend cash to revive you.
- **Hosting:** one PC runs the game server (Python, or the packaged `Dodgeball.exe`). Everyone on the same Wi-Fi opens a web page.
- **The lobby:** the server starts in a lobby. The host, who plays in the browser on that PC, sets up the teams, the bots and **every rule of the game**, then starts the match. Others can join at any time, but only the host changes anything. Changes made during a match apply from the next round.
- **The rules editor:** each of the 117 numbers has a name, a description and an animated preview that runs the default next to the lobby's value.
- **Looks:** an over-the-shoulder, Fortnite-style camera, with stick figures for characters.
- **Bots:** the host puts any number on either team, so it also works solo.
- **Spectating and the host's screen:** the host can watch instead of playing, and everyone else sees the host's menus and rule edits live while they set things up.

## 2. The user and how they like to work

- **Machine:**
  - Windows 10.
  - Python 3.14 (python.org install).
  - Node 24, Chrome and Edge, uv, git, GitHub CLI.
  - Edited in VS Code with Claude Code (PowerShell, with Git Bash also available).
  - **Git:** the folder is a git repository, published as the **public** GitHub repo `amirtavakolihaghighi/dodgeball` (MIT) with a history rebuilt for publishing (phase 9); the user's old private repo `dodge-and-parry` holds the original history until they delete it. `main` holds the releases, **v1.0.0** and **v2.0.0** (tags, each with a GitHub release carrying the Windows zip built by GitHub Actions). Commits use GitHub's noreply address. Commit or push only when the user asks.
  - The PC runs VPN/proxy tools, whose tunnel adapters show up in the join-address list.
- **Wants simple but genuinely working prototypes.** They were burned by a ChatGPT prototype that looked polished but didn't work, with fake UI, mechanics that could never trigger and a broken renderer. No fake or decorative features: everything shown must work.
- **Wants blunt, evidence-based judgment**, backed by screenshots, simulations and measurements, not opinion.
- **Wants to be asked about genuine design forks** (multiple-choice questions with a recommendation), but not about things with an obvious default.
- **Tests solo** by opening several browser tabs or windows as different players, plus bots.
- **Platform:** desktop/laptop only for now (keyboard and mouse). Phones/touch were explicitly deferred.
- **Shares builds with friends.** They first sent a RAR of the source folder, which broke, and now send the standalone Windows app.
- **Plays with coworkers in the office** (6–10 people, office Wi-Fi; several on Linux laptops). Some of them had lag; see `LAG_ANALYSIS.md`. The user collects the session logs and drops them in `testlog\` (git-ignored) for analysis.
- **Works in development cycles:** a stable version on `main`, then a batch of requested changes, then the user tests.
- **Wants to discuss before building** when a topic is open-ended (the lag plan was discussed first, then built as settings: phase 7).

## 3. Folder map

```text
dodgeball/                     (git repo -> github.com/amirtavakolihaghighi/dodgeball, public)
├── README.md                  the front page: what the game is, playing and hosting, safety and privacy
├── CLAUDE.md                  short instructions auto-loaded by Claude Code (points here)
├── LICENSE                    MIT
├── CHANGELOG.md               what changed in each version (Keep a Changelog)
├── CONTRIBUTING.md            setup, tests, conventions, the release routine
├── SECURITY.md                what the game exposes and writes; reporting a vulnerability privately
├── CODE_OF_CONDUCT.md
├── THIRD_PARTY_NOTICES.md     three.js, the Python packages, PyInstaller's bootloader
├── .gitignore / .gitattributes / .editorconfig   venvs, builds, logs, saved rules ignored; LF except .bat (CRLF)
├── .github\                   workflows\ci.yml (tests on 3 OSes x Python 3.10-3.14, a browser match),
│                              workflows\release.yml (the Windows zip from a tag), issue and PR templates
├── docs\
│   ├── MANUAL.md              the player and host guide: run, share, lobby, controls, every rule's default, logs
│   ├── PROJECT.md             this document
│   ├── LAG_ANALYSIS.md        cycle 2: measured causes of lag, options, what the office logs showed
│   └── images\                the README's screenshots
├── run.bat                    start the server (creates/repairs .venv; opens the browser)
├── build_exe.bat              build the standalone Windows app -> dist\Dodgeball-windows.zip
├── build_exe.py               the build logic (PyInstaller + zip with retries; ships the firewall helper too)
├── Allow friends to connect.bat   lets other PCs join through Windows Firewall: one rule, local network only
├── server.py                  FastAPI web server + WebSocket + game loop + host detection + rules broadcast/saving
├── sim.py                     all game rules (server-authoritative), lobby/match states, host actions
├── diag.py                    the session log: per-second server/host/connection numbers, stalls, late presses
├── rules.py                   every host-editable rule: name, description, range, preview; the Rules object
├── bots.py                    bot AI
├── config.py                  the DEFAULT value of every gameplay number
├── requirements.in            the direct dependencies: fastapi, uvicorn[standard]
├── requirements.txt           the lockfile: exact versions for every OS (uv pip compile)
├── requirements-build.in/.txt PyInstaller for build_exe.py, pinned the same way
├── icon.ico                   app icon (gold dodgeball, generated by a script)
├── tools\log_report.py        reads a session's logs and prints the diagnosis
├── static\                    the browser client (served by server.py)
│   ├── index.html             HUD, lobby menu, rules editor, join screen markup; import map for three.js
│   ├── style.css
│   ├── js\main.js             glue: join flow, rules, local player, camera, aim, preview, threat ring, events, HUD
│   ├── js\lobby.js            the lobby / pause menu: teams, each team's bots, match settings, host controls, spectate
│   ├── js\rules_ui.js         the rules editor (list, search, draft, apply, reset; following the host's screen)
│   ├── js\previews.js         the rules editor's animated previews (20 scenes, the game's own formulas)
│   ├── js\physics.js          launchVelocity and curveShare, shared by the game client and the rules previews
│   ├── js\diag.js             this browser's diagnostics log: per-second numbers, moments, L marks; sent to the host
│   ├── js\net.js              WebSocket, server-clock estimate, snapshot interpolation, event queue
│   ├── js\world.js            three.js scene: court, stick figures, balls, trails, effects
│   ├── js\hud.js              DOM HUD (bars, tags, ring, popups, feed, scoreboard, hint line)
│   ├── js\input.js            keyboard/mouse, pointer lock, release-everything-on-blur
│   ├── js\sfx.js              synthesized sounds (WebAudio)
│   └── vendor\                three.js 0.185.1: three.module.min.js + three.core.min.js
├── tests\
│   ├── test_sim.py            50 rule tests: python tests\test_sim.py (or pytest)
│   ├── test_server.py         6 server tests (lobby protocol, the host's screen, saved rules, session logs, the log report)
│   └── browser\               headless-Chrome end-to-end tests (cdp.js driver + step files, freeze_server.py)
├── logs\                      (made at runtime) one folder of session logs per server run; the 30 newest are kept
├── saved_rules.json           (made at runtime) the host's rules, reloaded at the next start
├── testlog\                   the user's collected session logs from office tests (git-ignored: names and IPs)
├── .venv\                     local Python environment (made by run.bat; never share it)
└── dist\                      build output: Dodgeball\ (app) + Dodgeball-windows.zip
```

The code is about 10,000 lines in total. The biggest files are `previews.js` (~1,390), `sim.py` (~1,170), `main.js` (~1,110), `test_sim.py` (~900), `world.js` (~790), `rules.py` (~470), `log_report.py` (~450) and `diag.py` (~440).

## 4. History: the path from idea to now

### Phase 0: the idea and ChatGPT's attempt (2026-10-19)

The user described the game to ChatGPT (free version); the transcript was deleted when the project was published (phase 9). The requirements, in the user's words, condensed:

- **Teams and balls:** two teams. Each player has a ball; after throwing there's a cooldown, then a new ball.
- **Defence:** the targeted player can **dodge, catch or deflect**.
  - Dodge at the last moment = **perfect dodge**.
  - Catch at the last moment = **extra points**.
  - **Deflect** = catch and throw in quick succession: more skill, smaller window.
- **Health and stamina:** dodging costs stamina; perfect dodges cost less (same idea for catch and deflect). Getting hit loses health; at 0 you're out. Teammates can spend **cash points to revive** fallen teammates.
- **Rallies:** a continuously deflected ball gets **faster and faster**.
- **Tech:** a Python server on a PC, with friends on the same Wi-Fi playing in a browser.
- **Follow-up message:** throwing costs stamina **based on how hard you throw**. It should be **3D with a Fortnite-like camera**; stick figures are fine.

ChatGPT produced a first attempt (deleted since): a FastAPI server and a single `index.html` with hand-written WebGL. When asked to judge it harshly, I verified every claim by running it:

1. **The 3D view never rendered.**
   - Its matrix multiply produced B·A instead of A·B for column-major matrices, so the whole MVP chain was reversed.
   - Running its exact math in Node put the camera's look-at point far off-screen and the player at NaN.
   - A headless-Chrome screenshot showed diagonal stripes, with no arena, players or balls.
2. **Deflect, the signature mechanic, could never succeed.**
   - It required a catch in the previous 0.38 s, but a catch deletes the ball, and pressing deflect overwrote the catch action.
   - A simulation confirmed that every deflect attempt got the player hit.
3. **Dodge didn't move the player**: the ball just vanished on touch within 0.34 s. **Catch also deleted the ball**, so the player never got it.
4. **Aiming was fake**: every throw auto-targeted the nearest enemy, flying straight at a fixed height.
5. **WASD was mirrored**: a reflection transform, so at spawn W walked backward and D walked left.
6. **Fake UI:**
   - A static "05:00" timer and "FIRST TO 10".
   - A "REVIVES 0/2" limit that didn't exist.
   - Each team's score showed its *own* dead count.
   - Cover blocks were drawn with no collision.
7. **Rules gaps:**
   - Hits earned 0 points, so revives were barely fundable.
   - No rounds or win condition, and no center line.
   - Throw power was trusted from the browser.
8. **Server flaws:**
   - It awaited each client's send inside the game loop, so one slow client stalled everyone.
   - It used a deprecated startup hook and paths relative to the working directory.
   - It had no network-delay handling.

**Salvaged:** only the stack choice (Python FastAPI server, browsers over WebSockets). Everything else was rewritten in `prototype\` (the game's folder until phase 9 moved it to the repository root).

### Phase 1: the first real prototype (2026-10-20 → 21)

**Questions asked, and the user's answers:**

| Question | Options offered | User chose |
| --- | --- | --- |
| How should aiming work? | soft lock-on (homing) / free aim, straight / **free aim + light assist** | **Free aim + light assist** |
| How is deflect performed? | **own key, tighter window** / catch then quick throw | **Own key, tighter window** |
| Bots? | **yes, fill teams** / no | **Yes** |
| Devices? | **desktop only** / phones too | **Desktop/laptop only**, *and* "I want to open multiple tabs so I can test with different players" |

**What got built:**

- **Server and rules:** a server-authoritative Python simulation (`sim.py`) with explicit timestamps.
- **Client:**
  - A three.js client with real lighting, stick figures with procedural animation, an over-the-shoulder camera with pointer lock, and a full HUD.
  - Client-side movement for instant response, with server validation.
- **Lag compensation:** the client tells the server which moment it was looking at when a key was pressed (section 8).
- **Bots, rounds, revives, cash, per-tab identity** (sessionStorage, auto-rejoin on reload), and inputs released on blur.

**Evidence and iteration:**

- **Rule tests** (22 at first) passed on the first run, except one: a bots-only match was far too slow.
  - Profiling showed 70 revives in 2 rounds; rounds always hit the 3-minute cap.
  - Fix: **escalating revive cost** (80, then +40 per revive per team per round) and lower catch/deflect cash.
  - Dodges that dashed cleanly out of the way weren't credited. That led to the **"afterimage" rule**: a ball reaching the spot where your dodge started counts as dodged.
  - After both fixes, rounds lasted 21–92 s (about 50 s on average) with 1–2 revives per round.
- **Headless-Chrome screenshots** drove the camera changes: pulled back to 4.4 m, raised, field of view 62. A teammate standing next to the camera blocked the view, so players within 2.6 m of the camera now fade.
- **A bug found by reasoning:** inputs sent before the client noticed a teleport could overwrite the server's "face the enemy" spawn direction. Fix: the `tp` teleport counter gates position, yaw and pitch.
- **End-to-end "auto-defender" through the real network path:** catch 6/6 perfect; deflect at 150 ms simulated lag gave 5 deflects and 0 hits; dodge 8/8 perfect.
- **Two simultaneous browsers** (Alice and Bob) saw each other move and saw each other's throws and hits.

### Phase 2: the user's second round of requests (2026-10-21)

The user asked for:

1. A **perfect dodge** that looks different: a 360° spin out of the way with afterimages.
2. **Deflected balls** that look distinct: another color, afterimages, or a path that lingers in the air to show the speed.
3. **Vertical curves**, for example throwing at the ground so the ball ricochets toward another player.
4. **Holding to throw makes the ball faster, and speed is what deals damage.** This was already the rule, but too subtle.
5. **A wider arena for more players**, growing with each added player.

**Questions asked, and answers:**

| Question | Options | User chose |
| --- | --- | --- |
| Vertical curves | **light gravity arcs on every throw** / straight throws + ricochets only | **Light gravity arcs** |
| Ricochet surfaces | **floor only** / floor and walls | **Floor and walls** |

**What got built:**

- **Physics:** ball physics became velocity-based with gravity (6 m/s²). A ballistic launch solve keeps the crosshair accurate: the ball lands where you aim.
- **Aim assist** now steers toward the *arc* that would hit the target.
- **Ricochets:** one bounce off the floor or a side wall, losing speed, then curving toward the nearest enemy ahead.
  - **End walls stop balls.** This was my decision: with every wall bouncing, about half of all misses came back off the back wall and hit defenders from behind, unseen.
  - Bots throw **bank shots** (15% of throws on normal skill).
  - Aiming at the floor or a wall *short of* an enemy disables the throw-time assist, so the bounce happens.
- **Throw preview:** while charging, a dotted line shows the arc and the bounce point.
- **Charge, speed and damage:** a tap is 12 m/s for ~15 damage; a full charge is 34 m/s for ~45. The HUD shows speed, expected damage and cost while charging, and the kill feed shows each hit's speed and damage.
- **Perfect-dodge visuals:** a 360° spin with a hop, glowing afterimage copies of the figure, and a gold screen-edge flash for your own perfects.
- **Deflect visuals:**
  - A distinct color per rally level (yellow → cyan → magenta → red → white-hot).
  - A camera-facing ribbon trail that lingers in the air, longer per rally level, plus fading ghost balls.
- **Arena size** scales with the biggest team. It grows immediately and only shrinks between rounds.
- **Extra bots** join mid-round; fewer bots apply next round.

**Bugs found by diagnostics and fixed** (several affected timing fairness, not just looks):

1. When standing near your back wall, the camera sits outside the court, and the aim ray skipped the walls, so the aim point landed 42 m away. Fix: a slab test for where the ray leaves the court box.
2. Clicking the bot-count "+" rapidly computed from a stale snapshot. Fix: a local pending value.
3. The timing ring ignored lobs aimed at you that were predicted to fly over (the assist bends them down). Fix: a ball homing on you always counts.
4. The ring's near-miss margin (0.6 m) baited wasted presses. Fix: 0.15 m for free-flying balls, 0.6 m for balls homing on someone else.
5. A second ball close behind the first was hidden by the ring. Fix: once you've pressed for a ball, the ring moves on to the next.
6. Your browser kept you "busy" after a catch until the confirmation arrived, so a second ball couldn't be answered. Fix: free your hands the moment the answered ball arrives, as the server does.
7. Snapshot interpolation took a ball's state and velocity from the *later* snapshot. A ball touching a player is frozen ("pending") with zero velocity, so it vanished from threat detection up to 33 ms early. Fix: take state and velocity from the earlier snapshot until the later one's time.
8. **Balls arrived late on screen**: they drifted into the contact point over a whole snapshot interval. Fix: arrive at full speed at the true contact moment. Caught balls keep flying until they vanish instead of hanging in the air.
9. Score and round count survived after everyone left. Fix: reset when no humans remain.
10. Shockwave rings and your own afterimages near the camera blocked the view. Fix: no ring for your own actions, fainter own ghosts, smaller rings.

**Results after the fixes:**

- 30 rule tests pass.
- Auto-defender:
  - catch: 9 of 10, with 0 hits;
  - catch at 60 ms lag: 18 of 19 (the one miss was a ricochet visible only 0.011 s before impact);
  - deflect at 150 ms lag: 12 of 12;
  - dodge: 9, with 8 perfect and 0 hits.
- In bot matches, ~32% of throws bounce and ~17–23% of hits are ricochets. Damage ranges 15–52 (average ~31), and rounds last 26–89 s.

### Phase 3: sharing with friends, and the standalone app (2026-10-21)

**The `.venv` problem:** the user sent friends a RAR of `prototype\`. Friends got:

```text
did not find executable at 'C:\Users\<user>\...\Python314\python.exe'
```

A venv stores the absolute path of the Python that created it, and the RAR included `.venv`.

- **Immediate fix for them:** delete `.venv` and run `run.bat`.
- **Permanent fix:** `run.bat` now checks that `.venv` works (`import fastapi, uvicorn`). If it doesn't, it deletes it and rebuilds it with the `py` launcher, or `python` on PATH. This was verified by recreating the friends' exact error in a copy of the folder.

**Standalone app:** the user asked whether it could work without Python. It now does.

- `build_exe.bat` → `build_exe.py` runs **PyInstaller** (onedir) and writes `dist\DodgeAndParry-windows.zip`: about 19 MB zipped and 36 MB unpacked, holding `DodgeAndParry.exe` plus `_internal\`.
- `server.py` gained:
  - a static path that works inside the package (`sys._MEIPASS`);
  - **automatic browser opening** once the port accepts connections (`--no-browser` turns it off);
  - **the first free port from 8000** when `--port` isn't given;
  - in the packaged app, a "Press Enter to close" pause on exit, so errors stay readable.
- A custom icon, a gold dodgeball, was generated programmatically.
- **Verified:**
  - it runs from a fresh unzip with Python hidden from PATH;
  - a full match played in the browser with no errors;
  - with 8000 occupied it moves to 8001;
  - a forced busy-port error stays visible;
  - the browser opens at the right address (checked by pointing the `BROWSER` environment variable at a recorder script).

Finally, the browser test tools were moved from a temporary folder into `prototype\tests\browser\`, and this document plus `CLAUDE.md` were written.

### Phase 4: version control and development cycle 2 (2026-10-22)

**Git:** the folder became a git repository, pushed to the private GitHub repo `amirtavakolihaghighi/dodge-and-parry`.

- `main` = **v1.0.0**, "the first stable version": tagged, with a GitHub release that carries `DodgeAndParry-windows.zip`.
- `.gitattributes` keeps `.bat` files CRLF and the vendored three.js byte-for-byte.
- Cycle-2 work is on the branch `cycle-2` and is left uncommitted for the user to test first.

**The user's cycle-2 requests**, after playing with 6–8 coworkers on the office Wi-Fi:

1. **Lag.** Some players lagged. The user asked three things:
   - what would reduce lag, including gameplay changes;
   - what each kind of resource shortage (host or player machines) does;
   - whether connecting to the host's hotspot changes anything.
   **They want to discuss before anything is built.**
2. **A lobby phase.**
   - The server creates a lobby that the host configures and starts.
   - Anyone can join, even mid-game, but only the host controls anything. Before, anyone could press Esc and add bots or switch teams.
   - Rule changes made mid-game apply from the next round.
3. **The host can change every number of the game mechanics.** Each comes with a proper name, a description, and if possible an image or a replaying video of what changing it looks or feels like.

**1. The lag analysis** is in `LAG_ANALYSIS.md`, written from measurements on the v1 code.

- **The server is not the bottleneck:**
  - 3% of one core with 8 simulated players, ~60 MB of RAM, ~35 kbit/s per player after compression;
  - snapshots always on time (worst gap 39 ms).
- **So the likely causes** are per-player Wi-Fi jitter and stalls, slow rendering, or the host's process pausing. One host-side pause: a click in the console starts a QuickEdit selection, which freezes the whole game at the next `print`.
- **The client tolerates only ~47–80 ms of lateness** before players and balls freeze and jump.
- **It proposes a plan** (diagnostics first, then smoothing fixes, gameplay forgiveness last) and lists the questions that would sharpen it. **Nothing from it is implemented.**

**2 and 3. What got built:**

- **Rules as data.**
  - `rules.py` lists 111 rules in 16 groups, each with a name, a plain-language description, a range, a step, a unit and a preview scene.
  - A `Rules` object holds one complete set. `sim.py` and `bots.py` read every number from `game.rules` instead of `config.py`, which now holds only the defaults.
  - Untrusted edits are type-checked and clamped to their range. Ordered pairs stay in order (the edited one wins), and a perfect zone or perfect cost can't exceed its window or cost.
- **The lobby state:**
  - The server starts in `lobby`: a warm-up where combat is open, the downed stand up after 2 s and bots don't throw.
  - The host presses **Start match**. The first countdown is 2 s longer, so people can click in.
  - Rounds then run until a team reaches **rounds to win** (a new rule; 0 = endless, the default), or the host presses **End match** (two clicks). Either way everyone returns to the lobby, which shows the result.
- **Who is host:**
  - the browser on the server's own computer (loopback or one of its addresses);
  - anyone opening the **secret host link** the console prints (`?host=KEY`), for hosting from another device;
  - `?guest` opts a local tab out, so you can see the guest view.
  - The server gates every host-only message; others get a "deny: host".
- **Host controls:**
  - Start/End, ⇄ move any player, Shuffle teams;
  - bots fill and skill, match length, and the full rules editor;
  - cancelling changes that wait for the next round.
  - In the lobby (and while a match waits for players) changes apply at once. During a match they wait for the next round's countdown, and both the menu and the editor show "next round (now X)".
  - Players no longer pick teams: they're auto-balanced, the host moves them, and a reconnecting player gets their team back (the server remembers names).
- **The rules editor:**
  - category list, search, sliders and number boxes, per-rule reset, "Reset all", "Undo my edits", Apply;
  - read-only for guests;
  - every rule has an **animated preview**, one of 19 canvas scenes computed with the game's own formulas and arc maths (`physics.js`). Most run the default and the lobby's value side by side in real time, so a change is visible as a difference.
- **Saved rules:** the host's rules are saved to `saved_rules.json` next to the app and reloaded at the next start. `--fresh` skips this, for tests.
- **Smaller fixes made along the way:**
  - Name tags use the max HP/stamina.
  - The ball mesh follows the ball radius.
  - The throw preview respects "0 bounces".
  - Bot defence leads shrink with narrow windows.
  - Equal throw costs no longer divide by zero.
  - Join addresses skip `169.254.x` and list `192.168.x` / `10.x` first. This PC's VPN adapter used to come first.

**Evidence:**

- **42 rule tests**, including:
  - lobby and host gating;
  - rule changes applying at once vs next round;
  - validation;
  - "every listed rule is read by the game" (no decorative settings);
  - a fuzz test of 20 matches with random rule values, often at the extremes and also changed mid-match, checked for crashes and NaN.
- **2 server tests over real WebSockets:** the lobby protocol, the host key, re-sync, and saved rules.
- **Browser runs:**
  - a host and a guest at the same time;
  - the host's quick controls;
  - a match won on rounds;
  - screenshots of all 19 preview scenes, checked against the formulas.
- **Auto-defender after the changes:**
  - catch: 9 of 10, 0 hits;
  - deflect at 150 ms lag: 12 of 13, 0 hits;
  - dodge: 13 of 13, all perfect.

### Phase 5: session logs, to measure the lag (2026-10-22)

**The user's answers to the lag questions:**

- Only some people lagged, going by what they said.
- Nobody knows the ms/fps numbers or which symptom was worst.
- The host was the user's own PC, on Wi-Fi, and the user played on it too.
- Maybe someone clicked the server window, and maybe a VPN was running.

**The request:** the server and every client should write log files during the next test, so the user can collect them and send them in.

**What got built** (`diag.py`, `static/js/diag.js`, `tools/log_report.py`):

- **The server log:** one folder per server run under `logs/` next to the app. `server.jsonl` gets:
  - **every second:** loop timing, the host's CPU, memory and page faults, and each player's input rate and gaps, screen delay, and queue, drops and send time;
  - **notable moments:** game-loop stalls, console prints held up (QuickEdit), hits on people, presses that arrived after the ball had hit, joins and leaves (with IP, the local address their traffic leaves from, and browser);
  - **every 30 s:** Wi-Fi and power;
  - **once:** the adapters (VPNs) and the build version.
- **Every browser's log:**
  - **every second:** fps, long frames, code time per frame, update lateness and gaps, frozen time, ping and inputs;
  - **notable moments:** hitches and freezes over 150 ms, presses, own hits and defences, rounds, disconnects, errors, visibility and focus, and **L** marks;
  - **once:** the device (graphics card, CPU cores, screen, pixel ratio).
- **Delivery:**
  - The browser sends its log to the server every 5 s. Chunks are acknowledged and kept in localStorage until then; after a reload they're resent, and the server skips duplicates.
  - "Save my log" downloads the browser's own copy.
  - The host's "Download all logs (zip)" fetches the last 24 h of sessions from `/logs/download`, which only the host may do.
- **`tools/log_report.py`** reads a zip, a folder or a single saved log, and prints the diagnosis. It splits each player's frozen time into host side (a server stall, or most others froze too) and their own, and gives every L mark a cause.
- **A test option:** `?jitter=N` simulates uneven Wi-Fi delay (in order, like TCP).

**Evidence:**

- **Rehearsals with a jittery player and a forced 1.5 s server freeze:** the report named each cause correctly (details in `LAG_ANALYSIS.md`).
- **New tests:** 3 server tests (the whole pipeline over a real server, the three detectors, the report's judgement), plus the browser test `logs.json`.
- **Timing unchanged:** the auto-defender still defends every press (catch 13/14 perfect, deflect at 150 ms lag 12/12, dodge 10/10, 0 hits).

**Found along the way** (see section 14):

- Chrome hands `Content-Disposition: attachment` responses to its download manager, and the page's `fetch` gets an empty 204.
- The venv's `python.exe` is a launcher with the server as a child process.
- This console uses code page 1256.
- Two software-rendered headless Chromes saturate this 16-thread PC and starve the server.

### Phase 6: the office logs, and the next batch of requests (2026-10-25 → 27)

**What the user sent:** five browser logs from the 25 Oct session, then the server logs of eight runs (three office sessions with 7–11 players: 25, 26 and 27 Oct) and the host's "Download all logs" zip of the 27th. Analysis details are in `LAG_ANALYSIS.md`, "Update 2". In short:

- **The host and server were healthy:** no game-loop stall over 100 ms in any session, the server at ~10–15% CPU. The host PC's memory sat at 90–96% (Chrome, VPN tools).
- **Devices were fine:** everyone ran at 60 fps or more.
- **Lag compensation for buttons works:** 3 of 567 hits (25 Oct) came after a press that was in time on the player's screen.
- **The worst lag was a few players' own Wi-Fi, mostly Linux laptops:** three of them froze in bursts, a 170–230 ms freeze every ~0.43 s for 5–20 s, every 30 s to 5 min (the signature of Wi-Fi background scanning); one stuttered steadily (17.6% frozen; likely Wi-Fi power saving). Their uploads stalled too, so others saw them jump.
- **The host's own Wi-Fi went quiet three times on the 26th** (~0.25 s, every remote player at once, both directions); not on the 25th or 27th.
- **"My press did nothing":** after a dodge, catch or deflect that meets no ball, the browser ignored new presses for its window plus recovery (~0.5 s) without a sound. 8–11% of all hits landed inside such a lockout.
- **Ricochets** were 50–66% of all hits; one player's lag marks followed bank-shot deaths, not network trouble.
- **The report tool needed fixes:** browsers resend unsent chunks from earlier sessions (it now leaves those out), menu time counted as input gaps (now only while playing), and players' PC clocks differ by minutes (times now on the host's clock).

**The requests, and what got built:**

- **Slower throws curve less** (configurable): `SLOW_BALL_CURVE`, "Slow-ball curve", default 0.5. The aim assist's bend is now measured per metre: a tap-speed ball bends half as much as a full-power one; balls in between scale smoothly, and so does a ball that slowed down. A full-power throw bends exactly as before. Preview: a new "Slow balls curve less" scene.
- **A bounce takes curve away** (configurable): `RICOCHET_CURVE_KEEP`, "Curve kept after a bounce", default 0.5, replacing `RICOCHET_TURN_RATE_DEG` (150°/s homing). A ricochet bends at half the strength of a ball that never bounced, and each further bounce halves it again.
- **The host can spectate:** a Spectate / Join a team button in the Teams panel. Watching, the host is on no team (team −1): never hit, not counted, still running the lobby. Free camera (mouse, WASD, Space/Shift), or LMB/RMB to ride behind the next/previous player. At once in free play, otherwise from the next round, like a team move.
- **Everyone sees the host's screen live:** the host's browser reports which screen it shows, the rules group, the search, the rule in focus and its unapplied edits (≤ ~8 times a second). Guests get a "The host's screen" box in the menu and a line on the HUD ("The host is looking at the rules: Ricochets › Curve kept after a bounce 0.50× → 0.30× (not applied yet)"). With "Follow the host" on (default), their own read-only rules editor opens on the same page, highlights the same rule and shows the host's draft. Teams and bots were already visible to everyone.
- **The host sets each team's bots freely:** `BOTS_RED` and `BOTS_BLUE` (0–12 each, defaults 1 and 2) replace `BOT_FILL`. Nothing adds, removes or balances bots or people automatically; a newcomer still joins the team with fewer people, and the host moves anyone.
- **Shared team cash** (an option, off by default): `TEAM_CASH`. Everything anyone earns goes into one pot per team; any teammate can spend it on revives (bots too). Switching it on pours everyone's cash into the pot; switching it off shares the pot out evenly.
- **Cash that carries over while prices don't:** this already existed ("Cash resets each round" off; revive prices start over every round). The descriptions now say so, and a new match always starts everyone at 0 cash.
- **Presses during a recovery** now say "Still recovering (0.3s)" with the deny sound, and are logged (`ignored`), instead of doing nothing silently.
- **Firewall:** `Allow friends to connect.bat` (next to the exe, and in `prototype\`) asks for admin once, adds one inbound rule (TCP 8000–8019, local subnet only, any network profile) and removes Windows' old block rules for the game's program. The server window points to it.
- **Answered without building:** UDP (not worth it now: browsers can't use raw UDP, and the measured freezes were radio gaps that UDP can't fix); the five earlier lag suggestions, re-explained from the player's side.

**Evidence:** 47 rule tests and 6 server tests pass. Browser runs confirmed: smoke; lobby controls (per-team bots, "Still recovering", the new previews, mid-match bot changes, spectate on/off across rounds, free flight, following a player, the host's body not drawn); the two-browser test with the guest following the host's rules screen; the auto-defender (catch 13/13 perfect, deflect at 150 ms lag 10 defended, dodge 10/10, 0 hits in all modes); and the logging test.

**Found along the way:** the lobby's `.tag` labels shared a class name with the join screen's tagline, so each inherited the other's style (scoped now); a `const` in one browser-test step leaks into the next (steps use IIFEs).

### Phase 7: the lag study's suggestions, as settings (2026-10-27)

**The request:** "All five suggestions look good. Apply them, as options in the network settings with their own explanation. Also put the lockout timer (after a dodge, catch or deflect that didn't meet a ball) in the options: I may want to test with 0."

**What got built** (all in Game rules › Network (advanced), each with a player-terms description and a preview):

1. **Ricochet homing:** already a setting (Ricochets › Curve kept after a bounce, 0.5); the Network blurb points to it.
2. **View delay** (`INTERP_DELAY`) now defaults to **0.10 s** (was 0.08): a bigger cushion, so fewer one-frame stops on jittery Wi-Fi; the description explains the trade.
3. **Press grace** (`PRESS_GRACE`, default **0.02 s**, people only): a dodge, catch or deflect counts from 0.02 s before the press, because the screen is drawn a moment before the finger moves. A defence that counted only thanks to it is marked `graced`.
4. **Sidestep compensation** (`SIDESTEP_COMP`, default **on**): stepping out of a ball's way is judged by the player's own screen. The server keeps each person's recent reported positions with the moment their screen showed (`Player.seen`). When a ball touches someone with no defence active, it already waits (pending) for a late press; now, once that player's report from the contact moment arrives, the server checks where they were *on their screen*. Clear: the ball flies on past them from where it would be by now (event `sidestep`, popup "SIDESTEPPED"). With it on, browsers no longer shift nearby balls onto the player's present position (that shift existed to match the old server judgement).
5. **Logs:** every hit on a person records `gap`, how far clear of the ball they were on their own screen (negative = touching); sidesteps and graced defences are logged; the report has a FAIRNESS section.
6. **Lockout after a missed press** (`LOCKOUT_SCALE`, default **1×**, 0–1.5×): scales the window-plus-recovery lockout after a defence that meets no ball. At 0 you can press again at once, and the new press takes over from the one still active. The action's own window is never cut short (`Player.lockout_end` is separate from `action_end`).

**Evidence:**

- 50 rule tests (3 new: press grace, sidestep compensation on/off/too late, lockout 1 / 0 / short) and 6 server tests pass.
- A new end-to-end browser test (`sidestep.json`): a scripted player walks out of every incoming ball's path with 150 ms simulated lag. With compensation **on**: 26 tries, 13 balls missed them, 7 hits, 0 hits while clear on their screen. **Off**: 16 tries, 14 hits, all 14 while clear on their own screen.
- The lobby test checks lockout 0 in the browser (two quick presses both sent, none ignored, no "busy" refusals) and screenshots the new previews.
- The auto-defender still has 0 hits in all modes (catch 9/12 defended, deflect at 150 ms lag 13/13, dodge 6/8; the rest were balls that missed anyway).
- The logging test, plus a logged sidestep run: the report's FAIRNESS line matched the browser's own count (11).

**Found along the way:** for a frame after the host starts spectating, the interpolated view still had them on a team while the newest snapshot said team −1, so the game tried to draw a body with no team colour (fixed in `playerStates`).

### Phase 8: the 28 Oct office session, and a clock fix (2026-10-28 → 29)

**The session:** 10 players, 22 minutes, with the new settings (team cash on, lockout 0, slow-ball curve 0.2, ricochet curve kept 0.75). The host switched sidestep compensation **off** mid-match (15:47:51, from the next round), which made a clean A/B test:

- **On (15:41–15:48):** 233 balls missed people who had stepped clear on their own screen, and **no** hit while clear on screen.
- **Off (15:48–16:01):** about 400 hits on people who were clear on their own screen (up to 0.9 m clear).
- The server was healthy (no stalls, 18% CPU), no browser errors, and every player ran at 47–144 fps.

**The bug it showed:** one player (a Linux laptop, 144 Hz) had the picture stand still for about 5 minutes. Their updates kept arriving 30 times a second with a normal ping, but the measured lateness climbed smoothly from 30 to about 330 ms over 25 s, and the server saw their screen times run *ahead* of its own clock. Their computer's clock ran about 1% fast for those 25 s, most likely the system's time service correcting the clock. The browser's clock estimate only moved back 1 ms per second, so it took minutes to recover; meanwhile the view time sat past the newest update (no smooth motion, events played late, presses and sidesteps without lag compensation).

**The fix** (`net.js addSnapshot`): if even the least late update of a 1.5 s window arrived more than 40 ms behind the estimate, re-anchor it by that much at once (logged as a `clock` line in the browser's log; the report notes it). Ordinary jitter always has some quick update in the window.

**Evidence:** a new browser test (`clock.json`) makes the page's clock run fast (+300 ms over 10 s). Before the fix: frozen about 1 s of every second until the end (22 s of 25, and it would have gone on for minutes). After: 2 s in total, partly during the ramp, recovered as soon as the clock settled. With jitter up to 200 ms it re-anchored once (49 ms) in 35 s; with 100 ms jitter or a steady 150 ms lag, never. The auto-defender is unchanged (deflect at 150 ms lag 14/15, dodge 10/12, catch 6/6 and 11/12, no hits apart from one two-balls-at-once case), and the sidestep test still has no hits while clear.

### Phase 9: publishing on GitHub as Dodgeball (2026-10-29)

**The request:** check the user's standard for publishing projects on GitHub and suggest improvements (then work them into it), prepare the project, and publish it following the standard. The user's choices:

- a **public** repository under the **MIT** licence, with commits under GitHub's **noreply** address;
- the name **Dodgeball** for the project, wherever it's needed (it was Dodge & Parry), in a new repository `dodgeball`; the old private `dodge-and-parry` stays untouched until the user deletes it;
- the idea transcript (`Chat.md`) and ChatGPT's attempt left out of the repository, then deleted from disk altogether;
- the game's files moved out of `prototype/` to the repository root.

**The privacy gate** (the standard's first step) found personal data in the old history: a personal email address in every commit and in the v1.0.0 tag, and in the docs a local folder path containing the Windows user name, coworkers' names (from the log analysis), a LAN address and details of the office network. The idea transcript and ChatGPT's attempt were committed in v1.0.0 too.

**What was done:**

- **The history was rebuilt** with the same content, dates and messages, minus the personal data (coworkers became "Player A" to "Player F", the path a generic one, the address `192.168.x.x`) and the two dropped files: v1.0.0, then the cycle-2 commit, then one publishing commit (v2.0.0). The v1.0.0 tag was recreated with its original date. GitHub keeps force-pushed commits reachable by their id and in a repository's public Activity view, so the clean history went to a fresh repository rather than over the old one.
- **The rename:** the join screen's logo and the page title, the browser tab, the server window, the app (`Dodgeball.exe` in `Dodgeball-windows.zip`), the log downloads (`dodgeball-logs-…`, `dodgeball-log-…`), the firewall helper's rule (it removes the old "Dodge & Parry" rule too), the docs and the repository. Internal names (`dp.settings` in the browser's storage, `window.dp` for the tests) stay, so players' saved settings survive. `log_report.py` reads logs by their content, so logs with the old names still work.
- **The flat layout:** everything that was in `prototype/` sits at the repository root, and its README became `docs/MANUAL.md`. The code needed no changes, since every path is relative to its own file; the docs, CI and the release workflow did. The release workflow still builds v1.0.0, which has the old layout.
- **Front page and policies:** `README.md` (the problem first, playing and hosting, safety and privacy, screenshots checked by eye for personal data), `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md` (what the game exposes and writes), `CODE_OF_CONDUCT.md`, `THIRD_PARTY_NOTICES.md`, issue and pull request templates. `PROJECT.md` and `LAG_ANALYSIS.md` moved to `docs/`.
- **Line endings:** `.gitattributes` stores every text file with LF and `.bat` files with CRLF, and leaves images, archives and the vendored three.js untouched.
- **Locked dependencies:** `requirements.in` lists the two direct dependencies; `requirements.txt` is a lockfile for every OS and Python 3.10+ (`uv pip compile --universal`); `requirements-build.txt` pins PyInstaller, which `build_exe.py` installs from it.
- **CI** (`.github/workflows/ci.yml`): the rule and server tests on Windows, macOS and Linux with Python 3.10 to 3.14, plus a job that boots the server and plays a match in headless Chrome.
- **Release builds** (`.github/workflows/release.yml`): a pushed `vX.Y.Z` tag builds the Windows app on GitHub's machines and attaches the zip and its SHA-256 checksum to the release; "Run workflow" with a tag rebuilds an older one.
- **Repository settings:** private vulnerability reporting (`SECURITY.md` relies on it), secret scanning with push protection, Dependabot alerts, a description and topics.

**Evidence:** before the push, both test suites passed in a fresh clone installed from the lockfile (Python 3.14, and Python 3.10 through uv), the server booted and a match ran in headless Chrome with no page errors, the Windows app built and started, the privacy scan found nothing in any commit, and the line endings were checked in the staged files. CI's results are on the repository's Actions tab.

## 5. Decision log

**U** = the user decided. **C** = Claude decided; reasonable to revisit, but say so first. Don't silently change a **U** decision.

| # | Decision | By | Why / notes |
| --- | --- | --- | --- |
| 1 | Python server + browser clients over WebSockets on the LAN | U | Original idea |
| 2 | 3D, over-the-shoulder Fortnite-like camera, stick figures | U | Second message of the original idea conversation |
| 3 | Free aim + light aim assist (10° cone, 45°/s bending at full power) | U | Chosen over lock-on and pure straight throws. Slower balls bend less: #43 |
| 4 | Deflect = its own key with a tighter window than catch; instantly returns the ball faster | U | Chosen over catch-then-quick-throw |
| 5 | ~~Bots fill teams~~ | U | Needed for solo testing. Superseded by #47 (the user's own request): the host sets each team's bots |
| 6 | Desktop/laptop only; multi-tab self-testing must work | U | Phones deferred |
| 7 | Light gravity arcs on every throw, crosshair stays accurate | U | Chosen over straight throws |
| 8 | Ricochets off floor and walls, one per throw | U | Chosen over floor only |
| 9 | Charge → speed → damage must be strongly felt | U | Request 4 |
| 10 | Arena grows with players | U | Request 5 |
| 11 | Perfect dodge = 360° spin with afterimages; deflects get distinct colors and lingering trails | U | Requests 1–2 |
| 12 | Catching puts the ball in your hand (throw immediately) | C | Natural dodgeball rule; rewards catching |
| 13 | Teams stay on their half (center line with 1 m gap each side) | C | Real dodgeball; prevents point-blank throws |
| 14 | Rounds: wipe the other team; 3-minute cap (more players standing wins, then total HP); score = rounds won | C | ChatGPT had none |
| 15 | Cash is personal, resets each round; R revives the longest-down teammate; revive cost escalates per team per round | C | Flat cost made rounds endless (measured). Shared team cash is an option (#48); carry-over too (#49) |
| 16 | Afterimage rule: a ball reaching your dodge's start point counts as dodged | C | Clean dodges weren't credited |
| 17 | End walls stop balls; only floor and side walls ricochet | C | Back-wall ricochets hit defenders from behind (measured) |
| 18 | Aiming at a floor/wall point short of an enemy disables the throw-time assist | C | Otherwise bank shots got "corrected" into straight throws |
| 19 | ~~Extra bots join mid-round~~; teams fill to max(fill, biggest human team) | C | Superseded by #27: during a match, every bot change now waits for the next round |
| 20 | Movement is simulated by each browser, clamped by the server | C | Instant response on LAN; fine among friends |
| 21 | Timing judged against the moment on the player's screen (lag compensation), capped at 0.25 s | C | Parries must feel fair on Wi-Fi |
| 22 | three.js bundled locally, no CDN | C | LAN parties may have no internet |
| 23 | All numbers in config.py | C | Easy balancing |
| 24 | Timing ring (toggle with H) | C | Readability of 3D ball timing; may be "too easy", so it's optional |
| 25 | Standalone app via PyInstaller onedir (not onefile) | C | Faster start, fewer antivirus false positives |
| 26 | A lobby before the match: the host sets it up and starts it; anyone can join any time; only the host changes settings, bots or teams | U | Cycle-2 request 2 |
| 27 | Changes made during a match (rules, bots, team moves) apply from the next round | U | Cycle-2 request 2 |
| 28 | The host can change every game-mechanic number; each has a name, a description and a preview of its effect | U | Cycle-2 request 3 |
| 29 | Host = a browser on the server's own computer, or the console's secret host link (`?host=KEY`); `?guest` opts a local tab out | C | No accounts or passwords; the user hosts from the PC running the app |
| 30 | Players no longer pick teams: a newcomer joins the team with fewer people, the host moves them; a reconnecting player gets their team back (by name) | C | "Give all the controls to the host". Nothing re-balances afterwards (#47) |
| 31 | In free play (lobby, or a match waiting for players) changes apply at once | C | No round is running; otherwise a stalled match (empty team) could never be fixed |
| 32 | Rule previews are animated 2D canvas diagrams using the game's formulas (default next to this lobby), not recorded videos or images | C | Recordings can't show arbitrary values; diagrams follow the slider live |
| 33 | "Rounds to win" match setting, default 0 = endless (v1 behaviour) | C | A lobby needs a way for matches to end; the default keeps v1 |
| 34 | The host's rules are saved next to the app and restored at start (`--fresh` skips it) | C | Tuning shouldn't be lost on a restart |
| 35 | A match's first countdown is 2 s longer; End match needs a second click | C | Time to click into the game; ending affects everyone |
| 36 | Network numbers (view delay, lag compensation, update rates) are host-editable under "Network (advanced)" | C | Lets parts of the lag plan be tried live in a session |
| 37 | No lag fixes in cycle 2, only the analysis | U | "Discuss first, then plan" |
| 38 | The server and every client write logs at the next test; the user collects them and sends them in | U | Measure before fixing |
| 39 | Browsers send their log to the server (one zip from the host), plus a "Save my log" copy; logging is on by default (`--no-log`, and `--fresh` turns it off for tests) | C | A web page can't write files on its own; collecting from every PC is error-prone |
| 40 | The L key marks "this felt laggy" in the log | C | Ties what people feel to the numbers |
| 41 | Keep the 30 newest log sessions | C | Bounded disk use with no maintenance |
| 42 | QuickEdit stays as it is (only measured, not fixed) | C | No lag fixes until the plan is agreed (#37) |
| 43 | The slower a ball, the less it curves: "Slow-ball curve" (`SLOW_BALL_CURVE`), per metre, default 0.5 | U | Cycle-2 follow-up request. The per-metre model and the 0.5 default are C; a full-power throw bends as before |
| 44 | A bounce takes curve away: "Curve kept after a bounce" (`RICOCHET_CURVE_KEEP`), default 0.5, replaces the 150°/s ricochet homing | U | "No bounce: more curve; wall and ground: less curve". Default C. Ricochets were 50–66% of all hits in the office logs |
| 45 | The host can spectate: free camera or following a player; at once in free play, otherwise from the next round | U | The camera controls and the "next round" timing are C (like team moves, #27) |
| 46 | Everyone sees the host's screen live, low fidelity: the screen, the rule in focus, the unapplied edits; "Follow the host" opens the same rules page (on by default, a guest can untick it) | U | Details C. Only the host's browser reports; the server checks every field |
| 47 | The host sets each team's bots freely (0–12 per team); nothing balances or divides players automatically | U | Replaces `BOT_FILL`. Newcomers still join the team with fewer people (C) |
| 48 | Optional shared team cash: one pot per team, anyone (bots too) revives from it; off by default | U | Switching it keeps the total: on pours personal cash in, off shares the pot out |
| 49 | Cash can carry over between rounds while revive prices start over each round | U | Already possible ("Cash resets each round" off); descriptions now say so. A new match starts everyone at 0 (C) |
| 50 | A press during the recovery after your own action says "Still recovering" and is logged | C | It used to be silent and felt like a lost key press; 8–11% of hits landed during such a lockout |
| 51 | Firewall: a helper `.bat` adds one rule (TCP 8000–8019, local subnet, any profile) and removes Windows' block rules for the game's program | C | The user turned the firewall off to let others in. Block rules beat allow rules, so both steps are needed |
| 52 | No UDP transport for now | C (recommendation) | Browsers can't use raw UDP; WebRTC/WebTransport are big projects; the measured freezes were radio gaps UDP can't fix. Open for discussion |
| 53 | The lag study's suggestions are settings, explained in player terms, under Network (advanced) | U | "Apply them, as options in the network setting with their own explanation" |
| 54 | View delay 0.10 s by default (was 0.08) | U | Fewer one-frame stops; everything on screen is 0.02 s older |
| 55 | Press grace 0.02 s by default, people only | U | Value C: one or two frames of drawing plus monitor delay |
| 56 | Sidestep compensation on by default | U | Mechanism C: judged at the pending check from the player's reported positions; the ball then flies on from where it would be; the nearby-ball display shift is off while it's on |
| 57 | The lockout after a missed press is a setting (0–1.5×, default 1×); at 0 a new press takes over the active one | U | "Maybe I want to test with 0 lockout time". A short lockout never cuts the window itself (C) |
| 58 | Hits log the on-screen gap; sidesteps and graced defences are logged and reported | U | The fifth suggestion: measure what the fairness settings do |
| 59 | A browser re-anchors its clock estimate when every update of 1.5 s arrived over 40 ms late | C | A laptop whose clock ran fast saw a frozen picture for ~5 minutes (28 Oct log). Logged as `clock` |
| 60 | Publish as a public GitHub repository under the MIT licence | U | Following the user's publishing standard; MIT was the recommendation |
| 61 | Commits use GitHub's noreply address, and the published history was rebuilt without personal data | U | The old commits carried a personal email, the docs a local path and coworkers' names. How the history was rebuilt: C |
| 62 | The idea transcript (`Chat.md`) and ChatGPT's first attempt are left out of the published history, then deleted from disk | U | "Drop both", then "delete the folder of the failed prototype altogether, and Chat.md" |
| 63 | The clean history goes to a new repository, `dodgeball`; the old private `dodge-and-parry` stays untouched until the user deletes it | U | A new repository: C (force-pushing over the old one would leave the old commits reachable by id and in its Activity view). "Leave the old repo, I delete it myself": U |
| 64 | Windows release builds are made by GitHub Actions from the tag, with a SHA-256 checksum | C | Anyone can see what the app was built from; no local paths end up in the build |
| 65 | `requirements.txt` is a lockfile (uv, every OS, Python 3.10+) generated from `requirements.in`; PyInstaller is pinned too | C | A fresh clone installs exactly what CI tested |
| 66 | CI runs the Python tests on Windows, macOS and Linux with Python 3.10–3.14, and a headless-Chrome match on Linux | C | The README says the game runs from source on all three; CI proves it |
| 67 | Cycle 2 is version 2.0.0 (major) | C | Hosts use it differently (the host starts matches; players no longer pick teams or add bots), and a saved "team size with bots" no longer applies |
| 68 | The project is called **Dodgeball** (it was Dodge & Parry): the title, the app and zip names, the log downloads, the firewall rule, the repository | U | "The name of the project is Dodgeball; rename it anywhere that is needed". Internal names (`dp.settings`, `window.dp`) stay, so saved settings survive (C) |
| 69 | The game's files live at the repository root (no `prototype/` folder); its manual is `docs/MANUAL.md` | U | "Bring out the content of the prototype folder into the root". The manual's new place: C |
| 70 | The firewall helper treats the old "Dodge & Parry" rule as its own | C | Running it again (or `undo`) on a PC that ran the old helper replaces that rule instead of leaving it behind |

## 6. Current features

**Gameplay:**

- Charged throws: speed and stamina cost scale with hold time, and damage comes from speed.
- Gravity arcs, with a throw preview while charging.
- Light aim assist (slower balls curve less); bank shots and ricochets (a bounce takes curve away).
- Dodge (dash with invulnerability), catch (the ball becomes yours) and deflect (instant return, faster). Each has a perfect zone.
- Escalating rallies.
- HP and Souls-style stamina (regenerates after a short pause).
- Knockouts; cash (optionally one shared pot per team, and optionally carried over between rounds); revives with escalating cost.
- Rounds with a countdown and a winner banner.
- A dynamic arena size; bots (three skill levels) with bank shots.

**Lobby and host:**

- **The lobby:** the server starts in a lobby warm-up. The host starts the match; a match ends when a team reaches "rounds to win", or when the host ends it. Then everyone is back in the lobby with the result.
- **Host-only controls:** start/end, move players (⇄), shuffle teams, each team's bots (0–12) and their skill, match length, the rules editor, cancelling waiting changes, and spectating. Guests see the same panel read-only.
- **Spectating (host):** watch instead of playing, with a free camera or riding behind any player.
- **The host's screen, live:** everyone else sees which menu and rule the host is on and the edits they haven't applied yet; with "Follow the host", their rules editor follows along.
- **The rules editor:**
  - 111 rules in 16 groups: search, sliders and number boxes, per-rule reset, reset all, undo, apply.
  - Animated previews compare the default with this lobby's value.
  - Mid-match edits are marked "next round (now X)".
- **Saved rules:** the host's rules survive restarts (`saved_rules.json`).

**Fairness and network:**

- Server-authoritative rules; lag compensation up to 0.25 s; press grace (0.02 s); sidestep compensation (dodging by moving is judged by your own screen); the lockout after a missed press is adjustable (0 = none).
- Smooth interpolation, with ball arrival matched to the true contact moment.
- A slow device can't stall the game.

**Presentation:**

- three.js scene: the court with a 1 m grid, glass walls, bleachers and blob shadows.
- Procedurally animated stick figures: walk, wind-up, throw, catch, swat, dodge, perfect-dodge spin with afterimages, flinch, knockout fall and fade.
- Balls: rally colors, ribbon trails, ghost afterimages, glow.
- **HUD:**
  - HP and stamina bars, with a cost preview on the stamina bar while charging.
  - A throw box (ball ready, cooldown, or speed/damage/cost while charging).
  - Action costs; team scores with alive pips; round timer; kill feed.
  - Name tags with HP and stamina; the aim-assist marker; the timing ring with a direction arrow.
  - Popups (including "Still recovering" when a press comes during a recovery); gold and red screen flashes; a Tab scoreboard; a hint line in the lobby; a line saying what the host is doing.
  - An Esc menu that doubles as the lobby: teams, match settings, the rules editor, your own settings (sensitivity, volume, ring), controls and join addresses.
- Synthesized sounds.

**Operations:**

- `run.bat` with self-repairing `.venv`.
- The LAN address banner; automatic browser opening; automatic port choice.
- The standalone `.exe` build with an icon; it records which code it was built from.
- Multi-tab support: per-tab identity, auto-rejoin on reload, inputs released on blur, sound only in the focused tab.
- **Session logs** from the server and every browser, collected on the host. The host downloads them as one zip, and `tools\log_report.py` turns them into a diagnosis. Players press L to mark laggy moments.
- **`Allow friends to connect.bat`:** lets other PCs through Windows Firewall without turning it off.

## 7. Rules and numbers

These are the **defaults**, all in `config.py`. The host can change any of them in the lobby's rules editor; `rules.py` lists each editable rule with its range. Units are seconds, metres and m/s.

**Court:**

- `half_length = 12 + 0.5 × N` and `half_width = 3.5 + 1.75 × N`, where N = the biggest team's size.
- That gives 26 × 14 m for N=2, 28 × 21 m for N=4 and 30 × 28 m for N=6.
- Center gap 1.0 m each side of the line. Teams spawn at 70% of their half's depth.
- **Red is at −x, Blue at +x.**

**Bodies:**

- The player hit capsule is the vertical segment y 0.25–1.45 with radius 0.42.
- Ball radius 0.2. Chest height (the aim and assist target) 1.15.

**Movement:** walking 6.0 m/s, while charging 4.0, while a catch/deflect window is active 2.5.

**HP and stamina:** HP 100. Stamina 100, regenerating 30/s after a 0.6 s pause following any spend. No regen while charging or during a defence window.

**Throwing:**

| Setting | Value |
| --- | --- |
| Charge time (0 → full power) | 0.9 s |
| Speed | 12 → 34 m/s |
| Stamina cost | 6 → 34; if stamina is short, the throw is as hard as stamina allows |
| Damage | 15 + 1.35 per m/s above 12, capped at 60 (full throw ≈ 45; based on speed at impact) |
| New ball after a throw | 1.6 s |
| Gravity | 6.0 m/s² (0 = straight throws) |
| Ball lifetime | 6 s |

**Aim assist:**

- Cone 10° for throws, 20° for deflects, with 4° slack for the enemy the client highlighted.
- It bends a full-power ball at 45°/s toward the arc that hits the target's chest, within 40 m range.
- **Slower balls bend less** (`SLOW_BALL_CURVE` 0.5): per metre, a tap-speed ball bends half as much as a full-power one, scaling linearly with speed in between. In turn rate: `45°/s × (0.5 + 0.5 × f) × speed / 34`, with `f = (speed − 12) / (34 − 12)` clamped to 0–1 (`rules.Rules.curve_share`). Rally balls faster than 34 m/s bend like full power per metre.
- It lets go once the ball goes past or wide (target more than 72° off the heading).

**Ricochets:**

- The first floor or side-wall contact bounces. The ball keeps 75% of its speed off the surface and 85% along it.
- If it's still at least 9 m/s, it re-targets the enemy within 35° of its new heading and bends toward them with **half** the curve it had (`RICOCHET_CURVE_KEEP` 0.5; each further bounce halves it again), scaled by its speed like any ball.
- The second contact kills the ball. End walls always kill it. A deflect gives the ball a fresh ricochet.

**Defence:**

| Action | Stamina (perfect) | Active window | Perfect if the ball arrives within | Recovery after the window |
| --- | --- | --- | --- | --- |
| Dodge | 25 (10) | 0.32 s of invulnerability | 0.12 s | 0.15 s |
| Catch | 20 (8) | 0.30 s | 0.10 s | 0.25 s |
| Deflect | 30 (12) | 0.18 s | 0.06 s | 0.30 s |

- **Dodge:** a 0.22 s dash at 14 m/s in the held direction. With no direction held, it sidesteps away from the incoming ball's line, or to the right.
- **Afterimage:** during a dodge, a ball reaching the dodge's start point also counts as dodged.
- **Reach:** catch and deflect reach 0.35 m beyond your body.
- **Perfect** refunds the difference between the two costs.
- A successful catch or deflect frees you instantly (no recovery). A dodge's invulnerability lasts its whole window and can dodge several balls.
- **Deflect:** the ball leaves from your hand toward your aim point (or back at the thrower if you have no aim), 15% faster, capped at 50 m/s. Rally +1.

**Cash:**

| Event | Cash |
| --- | --- |
| Hit | 10 |
| Knockout | +20 on top of the hit |
| Catch | 5 (perfect 12) |
| Deflect | 8 (perfect 15) |
| Perfect dodge | 8 |
| Catching or deflecting a rally ball | +3 per deflection already on it |

- **Revive:** costs 80, then 120, 160… per team per round; prices start over every round. The revived player comes back with 50 HP and 2 s of invulnerability.
- **Cash resets each round** by default (`CASH_RESETS_EACH_ROUND`); off, it carries over. A new match always starts everyone at 0.
- **Shared team cash** (`TEAM_CASH`, off by default): one pot per team that everyone earns into and any teammate (bots too) revives from. Snapshots then show the pot as each member's cash.

**Lobby, match and rounds:**

- **The lobby:** the server starts in the lobby, a free warm-up. Combat is open, the downed stand up after 2 s (`WARMUP_RESPAWN`), and bots don't throw. The host presses **Start match**.
- **A round:** a 3 s countdown (movement allowed, no throwing or defending; **5 s before a match's first round**, `MATCH_START_EXTRA`) → play → round over (4 s, winner banner) → the next countdown.
- **The end of a match:** a team wins `MATCH_ROUNDS_TO_WIN` rounds (default 0 = endless), or the host ends it (two clicks). Everyone returns to the lobby, which shows the result.
- **The "wait" state** applies when a team is empty mid-match: free play until both teams have someone, then the countdown.
- **When no humans remain:** bots are removed, score and round reset, and the server is back in the lobby. The rules stay. (A spectating host counts as a human, so bots can play while the host watches.)
- **Teams:** a newcomer joins the team with fewer people; after that only the host moves anyone: at once in free play, otherwise from the next round. A player who reconnects under the same name gets their team back.
- **Spectating:** the host can switch to watching (team −1: never hit, never revived, not counted) and back, at once in free play, otherwise from the next round.
- **Host changes** (rules, bots, match length) apply at once in the lobby or while waiting; during a match, at the next round's countdown.

**Bots:** the host sets each team's bots (`BOTS_RED` 1, `BOTS_BLUE` 2 by default; 0–12 each), and nothing changes them but the host; with no human connected there are none. Skill can be easy, normal or hard; the profiles (section 12) are rules too. Bots keep 30 stamina for defending (`BOT_STAMINA_RESERVE`).

**Network fairness:** browsers render the world 0.10 s in the past (`INTERP_DELAY`). Lag compensation is capped at 0.25 s (`MAX_LAG_COMP`). A person's defence counts from 0.02 s before the press (`PRESS_GRACE`). Sidestep compensation is on (`SIDESTEP_COMP`). After a defence that meets no ball you can press another after its window plus recovery × `LOCKOUT_SCALE` (1 = normal, 0 = at once).

## 8. Architecture

```text
 Browser tab (one per player)                          Python server (one per game)
 ─────────────────────────────                         ─────────────────────────────
 input.js  keys/mouse ──► main.js                      server.py  FastAPI + uvicorn
   moves OWN player locally (instant)                     /            -> static/index.html
   camera, aim point, assist candidate                    /static/*    -> client files (no-cache)
   sends 'in' 30 Hz + actions with wt ──────────────►    /ws          -> one Client per tab
                                                            reader: json -> sim.Game.handle()
 net.js   snapshots (30 Hz) ◄────────────────────────     game_loop: 60 Hz sim.Game.tick()
   clock offset, interpolation at view time                          30 Hz snapshot -> every Client queue
   event queue (played when view reaches e.t)                        rules changed? -> 'rules' to all + save
 world.js three.js render, hud.js DOM HUD, sfx.js         Client.pump: queue -> ws (drops old if slow)
 lobby.js menu, rules_ui.js + previews.js editor          sim.py game, rules.py rule set, bots.py AI, config.py defaults
```

**Server-authoritative.** The server alone decides balls, hits, damage, stamina, cooldowns, timing windows, cash, revives and rounds. The only client authority is its own position, yaw and pitch, which the server clamps to the court half. Inputs sent before the client acknowledges a teleport are ignored, using the `tp` counter.

**Rules, the lobby and the host:**

- **Where the numbers live:**
  - `game.rules` (a `rules.Rules`) holds every number the game reads.
  - `game.next_rules` holds changes made during a match until the next countdown (`_start_countdown` → `_activate`).
  - In free play (`lobby`, `wait`) changes activate at once.
- **How changes spread:** `game.rules_version` bumps on every change. The server loop then:
  - sends every client a `rules` message (the client config plus the live and next values);
  - saves the host's choice to `saved_rules.json` on a background thread.
  Snapshots carry the version (`r.rv`), so a client that missed an update asks again with `sync`.
- **Who is host:** `server.py` marks a joining player `host` when either is true:
  - the WebSocket comes from this computer (loopback, or one of its own addresses, refreshed every 15 s off the game thread) and the join doesn't say `guest`;
  - the join carries the console's host key.
  `sim.Game.handle` refuses host-only messages from anyone else.
- **States:** `lobby` → `count` → `play` → `over` → `count` … → `lobby`, plus `wait` when a team is empty mid-match.
- **Spectating:** a spectating host is a player on team `WATCHING` (−1), not alive. Everything that loops over teams 0 and 1 skips them; the warm-up respawn skips them too.
- **The host's screen:** the host's browser sends `hostview` when its screen changes (at most every 0.12 s). `server.py` checks it (`clean_host_view`: known screens, groups and rules only, values cleaned like rule edits), keeps the latest, and passes it to everyone but the sender, including people who join later. When the last host leaves, everyone gets `{m: null}`.

**Session logs** (`diag.py` on the server, `static/js/diag.js` in each browser):

- **On the server:**
  - `game_loop` calls `stats.loop` (loop gaps, tick and snapshot cost), `stats.events` (hits on people, rounds, rules) and `stats.tick` (writes a `sec` record once a second).
  - Every message from a browser goes through `stats.message`: input rate and gaps, screen delay from `wt`, and late presses. A press is "late" when its `wt` window covers the contact time of a hit already decided for that player.
  - `Client` counts dropped messages, the longest queue and the slowest send.
- **Writing never blocks the game:**
  - `SessionLog.write` only queues; a background thread appends to the files.
  - The slow host checks (`netsh`, `ipconfig`) run on their own thread every 30 s.
  - `say()` wraps console prints and logs any that Windows held up.
- **In the browser:**
  - `main.js` calls `diag.frame()` every frame (code time, and whether the picture was frozen: the view time is past the newest snapshot) and `diag.snapshot()` for every world update.
  - Each update's lateness is how much later it arrived than the quickest so far: `offset − (st − arrival)`.
  - Lines go out in chunks every 5 s as `log` messages. Each chunk sits in localStorage until the server's `logack`, so after a reload the unacknowledged chunks go again; the server stores each chunk once.
  - **Clocks:** browser lines carry `st` (estimated server time) and `wall`; server lines carry `st` (`perf_counter`) and `wall`. So freezes on different PCs line up in time with each other and with server stalls.

**Lag compensation ("view time"):**

- **The view time:** each client renders the world at `wt = performance.now()/1000 + offset − INTERP_DELAY` (0.10 s).
  - `offset` = the maximum of `(snapshot.st − local arrival time)`, decaying by 1 ms per second.
  - So `wt` is the server time of the world on screen, about 0.1 s behind on a LAN.
  - **Re-anchoring:** if even the least late update of a 1.5 s window arrived over 40 ms behind the estimate, the offset moves back by that much at once (this computer's clock was adjusted, or the route got slower for good). Without it, a clock running fast left the view time past the newest update for minutes.
- **The press:** every action message carries `wt`. The server clamps it to `[now − 0.25, now]` and uses it as the press time (`action_start`). The clamp bounds cheating.
- **When a ball touches a player with no active action:**
  - The ball becomes `pending`: frozen at the contact point.
  - It waits until `deadline = t_c + clamp(view_lag + 0.03, 0.05, 0.28)`, where `view_lag` is smoothed from `now − wt` of the input messages.
  - If an action arrives whose window covers `t_c`, the defence succeeds. A person's window counts from `PRESS_GRACE` (0.02 s) before their press. Otherwise it's a hit. Bots get no waiting and no grace.
  - **Sidestep compensation** (`SIDESTEP_COMP`): every accepted input adds `(wt, x, z)` to the player's `seen` history. While the ball waits, as soon as a report from the contact moment has arrived (or at the deadline, the latest one), the server checks the ball against where the player was on their own screen at `t_c`. Clear: `_let_through` (event `sidestep`); the ball ignores them and is flown on from `t_c` to now. Each hit records that on-screen `gap`.
- **The lockout:** `start_action` sets `action_end = start + window + recovery` (the action is over) and `lockout_end = start + (window + recovery) × LOCKOUT_SCALE` (another defence or a throw may start). A new press during the window takes over the old action. A successful catch or deflect ends both at once.
- **Events** carry the contact time `t`. Clients play them when their view time reaches `t`, so effects line up with what's on screen.

**Client presentation details that matter for fairness:**

- **Interpolation:** other players and balls are interpolated between the two snapshots around the view time.
  - Ball **state and velocity come from the earlier snapshot** until the later one's time.
  - A ball that becomes pending between snapshots **arrives at full speed at the true contact moment**.
  - Balls removed between snapshots keep flying until they vanish.
- **Convergence:** balls within 4 m of you are shifted onto your *present* position, weighted `w = 1 − d/4`. The server judged them against where it last knew you, and that offset is how far your browser is ahead. **Only while sidestep compensation is off:** with it on, the server judges against your screen, so balls are drawn where they are.
- **Threat detection** (the timing ring and incoming warning) predicts the time to impact for enemy balls:
  - The horizontal closest approach, plus a gravity height check.
  - Balls homing on you always count. Balls homing on someone else count if they'd pass within the hit radius (0.62 m) plus 0.6 m. Free-flying balls count only within the hit radius plus 0.15 m.
  - A ball you've already pressed for is skipped, so the next one shows.
- **Answered balls:** after a successful catch or deflect, your hands are freed locally the moment the answered ball arrives, mirroring the server.

**Physics:**

- The server ticks at 60 Hz with variable dt (capped at 0.1 s). Balls sub-step every ≤ 0.15 m with semi-implicit gravity, so contact times are precise and fast balls can't tunnel.
- The launch velocity solves the flatter of the two ballistic arcs through the aim point. Out of range, it's a 45° throw (for homing, no bend).
- Dead balls fall under 18 m/s² gravity, bounce, and disappear after 1.6 s.

**Coordinates and conventions** (shared by server and client):

- y is up. `forward(yaw) = (sin yaw, cos yaw)`, `right(yaw) = (−cos yaw, sin yaw)`. Red faces +x (yaw π/2), Blue faces −x (yaw −π/2).
- The throwing hand = position + forward × 0.3 + right × 0.32, at height 1.45 (`HAND_*` in sim.py, mirrored in main.js).
- **Keep these in sync:**
  - `sim.launch_velocity` ↔ `physics.js launchVelocity` (used by the throw preview and the rules previews);
  - `HAND_*` ↔ main.js `HAND_*`;
  - `rules.Rules._fix` ↔ `rules_ui.js enforce` (the pair and cap lists come from the server; the logic is duplicated);
  - the formulas in `previews.js` (throw speed/cost, damage, bounce and seek) ↔ `rules.py` / `sim.py`;
  - `rules.Rules.curve_share` ↔ `physics.js curveShare` (how hard a ball at a given speed bends).

## 9. Network protocol

JSON over one WebSocket at `/ws`. Snapshot entries are **arrays**, to keep messages small.

**Client → server:**

| Message | Fields | Notes |
| --- | --- | --- |
| `join` | `name`, `guest?` (true = no host powers), `hostKey?`, `tab`, `run` | Must be first. Team = the one this name had before, else auto (fewer humans, then fewer players, then red). `tab`/`run` identify the browser tab and page load in the logs |
| `log` | `run, seq, tab, lines:[…]` | A chunk of the browser's diagnostics log. The server stores it once per (run, seq) and replies `logack` |
| `ping` | `c` (client ms) | Server replies `pong {c, st}`; used for the ping display |
| `sync` | none | A snapshot showed a newer rules version than the client has: the server resends `rules` |
| `in` | `x, z, yaw, pitch, wt, tp, aim:[x,y,z], tg` | Sent at 30 Hz. Position/yaw/pitch are ignored unless `tp` matches |
| `charge` | `wt` | Start the wind-up (needs a ball, not busy) |
| `throw` | `wt, aim, tg` | Power = (`wt` − charge `wt`) / 0.9 |
| `cancel` | none | Cancel the wind-up (tab lost focus) |
| `act` | `a` (dodge/catch/deflect), `wt, dir:[dx,dz]` or null, `aim, tg` | `dir` = dash direction for dodge |
| `revive` | none | Revives the longest-down teammate |
| `rules` | `set: {KEY: value}`, or `reset: true`, or `discard: true` | **Host only.** Edit rules (at once in free play, else from the next round), back to all defaults, or drop the waiting changes |
| `start` | none | **Host only.** Lobby → the match's first countdown |
| `end` | none | **Host only.** End the match: back to the lobby |
| `move` | `p` (player id) | **Host only.** Move that human to the other team (again before it applies = cancel) |
| `shuffle` | none | **Host only.** Deal the humans into random, even teams (a spectator keeps watching; bots stay put) |
| `spectate` | `on` (true/false) | **Host only.** Watch instead of playing, or come back (to the team they had, else the one with fewer people). At once in free play, otherwise next round; asking the other way before then cancels |
| `hostview` | `m` (game/menu/rules), `g?` (rules group), `q?` (search), `f?` (rule in focus), `d?` ({KEY: unapplied value}) | **Host's browser only** (others are ignored, no deny). Relayed to everyone else |

Host-only messages from anyone else get a `deny` with `why: host`. The old `team` (players switching themselves) and `cfg` (anyone changing bots) messages are gone.

**Server → client:**

- **`welcome {id, host, cfg, rules, next, rv, defaults, schema, logging, version, logDir?}`:**
  - `logging`: whether the server keeps logs (then the browser sends its own). `version`: `{commit, built?}` of the server. `logDir`: where the logs are, for the host only.
  - `cfg` holds what the client needs, derived from the live rules (`Rules.for_client`):
    - `centerGap`, `gravity`, `ricochet{normalKeep, tangentKeep, minSpeed, max}`, `damage{min, perSpeed, max}`
    - `playerRadius`, `ballRadius`, `chestHeight`, `walk`, `chargeWalk`, `defendWalk`, `maxHp`, `maxStamina`
    - `chargeTime`, `throwCost[min,max]`, `throwSpeed[min,max]`, `cooldown`
    - `actions{dodge|catch|deflect: {cost, perfect_cost, window, perfect, recovery}}`, `dash{time, speed}`
    - `assistCone`, `deflectCone`, `assistRange`, `reviveCost`, `interpDelay`, `pressGrace`, `sidestepComp`, `lockoutScale`, `teamCash`, `botsMax`, `joinUrls[]`
  - `rules` / `next`: flat `{KEY: value}` dicts, live and waiting for the next round (`next` is null when nothing waits). `rv` is the rules version. `defaults` uses the same shape.
  - `schema` (sent once): `{groups: [{id, title, blurb}], params: [{key, group, label, desc, lo, hi, step, unit, kind, choices, preview, sub}], pairs, caps}`.
- **`rules {cfg, rules, next, rv}`:** sent to everyone after any change.
- **`logack {run, seq}`:** that log chunk (and everything before it) is stored.
- **`hostview {m, g?, q?, f?, d?}`:** the host's screen (the cleaned copy of the host's own message), sent to everyone but the host when it changes and to each newcomer after `welcome`. `{m: null}`: no host is connected any more.
- **HTTP `GET /logs/download`:** the host's zip of the last 24 h of sessions. It answers 403 to anyone else (allowed: this computer, or `?key=` with the host key) and 404 when the server isn't logging. The filename comes in `X-Filename`, not `Content-Disposition` (see section 14).
- **`s` (snapshot, 30 Hz):** `{st, r, p, b, e}`:
  - `r` (round): `{s: lobby|wait|count|play|over, n, left, score:[red,blue], w, bots:[red, blue], skill, rc:[reviveCostRed, reviveCostBlue], court:[halfLength, halfWidth], win, res, pend, rv}`.
    - `win`: rounds to win (0 = endless).
    - `res`: the last match's result, `[winner or null if ended by the host, red, blue]`.
    - `pend`: how many rule changes wait for the next round.
    - `rv`: the rules version.
  - `p` (players): each is `[id, name, team, x, z, yaw, pitch, hp, stamina, cash, flags, act, actAge, cooldownLeft, tp, charge, stats, next]`.
    - `team`: 0 RED, 1 BLUE, −1 spectating. `cash`: what they can spend (their team's pot with shared team cash).
    - `flags`: alive=1, charging=2, hasBall=4, bot=8, invuln=16, host=32, switching team next round=64.
    - `next`: the team the host's move takes them to at the next round (−1 = spectating), or null.
    - `act`: 0 none, 1 dodge, 2 catch, 3 deflect.
    - `charge`: wind-up fraction, 0–1.
    - `stats` = `[hits, kos, catches, deflects, perfects, outs]`.
  - `b` (balls): each is `[id, x, y, z, vx, vy, vz, rally, team, target (0 = none), state, owner]`. `state`: 0 live, 1 pending, 2 dead. Pending balls report zero velocity.
  - `e` (events): each is `{k, t, ...}`, listed next.
- **`pong {c, st}`.**

**Events:**

| Event | Fields |
| --- | --- |
| `throw` | `p, b, power, speed` |
| `hit` | `p, by, b, dmg, ko, rally, cash, speed, bank, gap?` (bank = it had ricocheted; gap = how far clear of the ball they were on their own screen, m, negative = touching; people only) |
| `sidestep` | `p, b`: the ball missed p because they had stepped clear on their own screen |
| `catch` | `p, by, perfect, rally, cash` |
| `deflect` | `p, perfect, rally, cash, speed` |
| `dodge` | `p, perfect, cash` |
| `bounce` | `b, x, y, z` |
| (catch, deflect, dodge) | also `graced: true` when the defence counted only thanks to the press grace |
| `revive` | `p, by, cost` |
| `deny` | `p, why`: stamina, busy, noball, cash, nobody, round or host |
| `round` | `s, n, w?, m?` (m = the team that just won the match) |
| `match` | `s`: start or end; at the end `w` (winner, or null when the host ended it) and `score` |
| `rules` | `n` (how many changed), `names` (up to 3), `next` (waits for the next round), `discard?` |
| `join` | `p, name, team` |
| `leave` | `p, name` |
| `team` | `p, team, now, cancel?`: the host moved p (now = at once, else next round) |
| `shuffle` | `now` |
| `spectate` | `p, on, now`: the host started (on) or stopped watching, at once or from the next round |

## 10. Server code tour

**`server.py`:**

- **`Client`:** wraps a WebSocket. Its send queue has maxsize 8 and drops the oldest message if full. A `pump` task writes to the socket. It counts dropped messages, its longest queue and its slowest send, for the log.
- **Logging:** `start_logging()` (the `meta` record, the host watcher), `say()` (console prints that note when Windows held them up), `version_info()` (git describe, or the packaged `build_info.json`), `may_download_logs()` and the `/logs/download` route. The flags are `--no-log` and `--log-dir`; `--fresh` turns logs off unless `--log-dir` is given.
- **`game_loop()`:**
  - ticks the game at `TICK_RATE` and sends one snapshot string per `1/SNAPSHOT_RATE` to every client (both are rules);
  - when `game.rules_version` changes, sends `rules_message()` to everyone and calls `save_current_rules()`;
  - catches and prints exceptions so the match keeps running.
- **`play()`:** the WebSocket endpoint.
  - On `join` it decides host (`is_this_computer`, `guest`, `hostKey`) and sends `welcome` with the schema.
  - It answers `ping` and `sync` itself, relays the host's `hostview` (`clean_host_view`, `share_host_view`, the latest kept in `host_view`), and hands everything else to `game.handle`.
- **Utilities:**
  - `lan_addresses()`: UDP-connect trick plus hostname lookup. It drops `127.x` and `169.254.x` and lists `192.168.x`, then `10.x`, first.
  - `watch_addresses()`: refreshes `own_ips` every 15 s on a thread (a hotspot or cable may appear mid-session).
  - `client_config()`, `rules_message()`.
  - `load_saved_rules()` and `save_current_rules()`: `saved_rules.json` next to the exe or script, written on a thread, atomically.
  - `first_free_port()`; `open_browser_when_ready()` (a thread that polls the port, then calls `webbrowser.open`); Windows `timeBeginPeriod(1)` for a steady loop.
  - `HOST_KEY`: a random key per run, printed in the console's host link.
- **Flags:** `--port`, `--host`, `--no-browser`, and `--fresh` (default rules, nothing saved; for tests).
- **Static files** are served with `Cache-Control: no-cache`, so a browser reload always picks up client edits.

**`diag.py`:**

- **`SessionLog`:** the run's folder (keeps the 30 newest sessions), `write()` (queued and written by a thread), `client()` (stores a browser's chunk once per run and seq; at most 30 MB per page), `flush()`, `zip_recent()`.
- **`HostInfo`:** Windows `ctypes` readings: system and process CPU, memory, page faults, power, QuickEdit. Plus `wifi_status()` (`netsh`, with network names and addresses dropped), `adapters()` (`ipconfig`), `route_ip()` (which local address traffic to an address leaves from) and `watch_host()`.
- **`Stats`:** per-second numbers and the notable records (`stall`, `hit`, `late_press`, `game`).
- **Record types in `server.jsonl`:** `meta`, `host`, `poll` (Wi-Fi and power), `sec`, `stall`, `print_block`, `join`, `leave`, `hit` (with `bank` and the on-screen `gap`), `sidestep`, `graced`, `late_press`, `game`.
- **Record types in the browser logs:** `file` (written by the server), `welcome`, `env`, `battery`, `sec`, `hitch`, `freeze`, `press`, `ignored` (a press during the recovery), `clock` (the clock estimate was re-anchored), `ev` (own events, rounds), `mark`, `vis`, `focus`, `lock`, `ws`, `error`.

**`tools/log_report.py`:** loads a zip, a session folder, the logs folder or one saved browser log. It leaves out what browsers resent from earlier sessions, counts input gaps only while the player was really playing, shows every time on the host's clock (from the server log, or the host's browser log), and counts presses ignored during a recovery. Its FAIRNESS section lists, per player, balls sidestepped on screen, defences saved by the press grace, and hits while clear on their own screen.

- `Player`: per-player summaries.
- `attribute_freezes`: host side vs own.
- `shared_freezes`: moments most players froze together.
- `verdicts`: what stands out.
- `explain_mark`: the cause of each L press.

**`rules.py`:**

- **`Param`:** one rule (key, group, label, desc, lo/hi/step, unit, kind, choices, preview, sub). `clean()` turns untrusted input into a valid value or None.
- **`PARAMS`:** filled by `_define()`, in editor order, with per-skill bot rules generated from `BOT_FIELDS`.
- **Lookups and limits:** `DEFAULTS` (from `config.py`), `BY_KEY`, `ORDERED_PAIRS` and `CAPPED_BY` (the consistency limits), `display_name()`, and `schema()` (what the editor gets).
- **`Rules`:**
  - attribute access (`rules.GRAVITY`);
  - `update()` (validate, keep pairs and caps, derive the `actions` specs), `values()`, `copy()`, `differences()`;
  - the formulas `throw_cost`, `throw_speed`, `damage_for` and `curve_share`, plus `bots_for()`, `bot_profile()` and `for_client()`.

**`sim.py`, the `Game` class** (`Game(seed, rules)`; every number via `self.rules`). `tick(t0, t1)` runs:

1. bots (decide at t0);
2. `_update_player` (velocity estimate, ball cooldown, stuck-charge guard, bot dash, stamina regen);
3. balls: `_fly` for live, `_fall` for dead;
4. `_check_pending`;
5. `_update_round`.

Key methods:

- **Ball flight and contact:**
  - `_fly`: sub-steps, gravity, `_hit_world`, player contact including reach and the afterimage check.
  - `_bend`: assist toward the ballistic arc, at the ball's `curve` (rad/s at full power) × `rules.curve_share(speed)`.
  - `_hit_world`: end walls kill; floor and side walls ricochet once and multiply the ball's `curve` by `RICOCHET_CURVE_KEEP`.
  - `_ricochet_target`.
  - `_contact`: invulnerability, an active action defends, otherwise pending.
  - `_check_pending`: a late press (`_action_at`, with the press grace), sidestep compensation (`_screen_position`, `_screen_gap`, `_stepped_clear`, `_let_through`), else the hit at the deadline.
  - `_defend` → `_dodged`, `_caught` or `_deflected`; `_hit`.
- **Player actions:** `throw`, `_aimed_velocity`, `_assist_target` (with the `_is_bank_shot` rule), `start_action`, `revive`.
- **Cash:** `cash_of` (own cash or the team's pot), `_earn` (in or, negative, out), `_regroup_cash` (team cash switched on or off), `revive_cost`.
- **Players, bots and the court:** `_sync_bots` (exactly the host's count per team), `_fit_court`, `_spawn`, `_line_up` (everyone fresh in a row), `_remember_team`.
- **The lobby and the host:**
  - `start_match`, `end_match`, `set_rules` (now or next round), `_host_rules` (set/reset/discard), `_activate`, `pending_changes`;
  - `move_player`, `shuffle_teams`, `spectate`, `_assign` (a team or `WATCHING`, now or next round), `_apply_team_moves`, `_stand_down`;
  - the properties `bots_each` (both teams' bots, for tests) and `bot_skill` map to the rules.
- **`handle(pid, msg, now)`:** the only entry point for client messages. It refuses host-only messages from non-hosts and sanitizes every input (`_num`, `_int`, `_vec3`, name cleaning).
- **Pure helpers:** `launch_velocity(frm, to, speed, gravity, reach_max)` and `rotate_toward`. The throw and damage formulas live on `Rules`.

**`bots.py`:** see section 12.

## 11. Client code tour

**`main.js`**, in frame order:

1. `syncCourt` rebuilds the court when its size changes.
2. `net.sample(viewTime)`.
3. `syncSelf`: teleport snap and identity.
4. `moveLocal`: mouse look; WASD relative to the camera; speed modifiers; dash. Spectating, `moveSpectator` instead (fly; flying stops following).
5. The optimistic hands-free check.
6. Hold-to-charge auto-start.
7. `placeCamera`: right shoulder at 0.75 m, pivot y 1.75, 4.4 m back, +0.55 m up (`shoulderCamera`). When dead or joining, it orbits instead (radius 8 + L × 1.05). Spectating: the free camera, or `shoulderCamera` on the followed player.
8. `displayBalls`: the convergence shift.
9. `computeAim`:
   - The aim ray hits enemy cylinders, the floor or a wall (slab exit). It never throws backwards.
   - The assist candidate is the smallest angle from the hand.
10. `findThreat`.
11. The preview path while charging (`previewPath`, `physics.js launchVelocity`).
12. `sendInput` at 30 Hz.
13. Events.
14. World sync.
15. `updateHud` (including `followHost`: the host's screen for guests).
16. `shareHostView` (the host's browser reports its screen).
17. Render.

Other parts of `main.js`:

- **Actions:** `startCharge`, `releaseThrow`, `tryAction` (local busy, stamina pre-check, dodge direction, the "handled" ball), `ignored` (a press during the recovery: "Still recovering", logged as `ignored`).
- **Spectating:** `startSpectating`, `moveSpectator`, `followNext` (LMB/RMB), `shoulderCamera`; `watching()` is true while the player's team is −1.
- **The join flow:**
  - The name is saved per tab in sessionStorage, and a reloaded tab rejoins automatically; the server gives back its team.
  - `?guest` and `?host=KEY` go along with the join. Personal settings live in localStorage.
- **Rules:**
  - `applyRules()` runs on `welcome` and on every `rules` message. It sets `cfg`, the net's interpolation delay and gravity, and the ball size, redraws the court, and refreshes the editor and the lobby.
  - `updateHud` sends `sync` when a snapshot's `rv` stays ahead for over 1 s.
- **The menu:** `showMenu()` opens the lobby panel. The match-end event drops everyone back into it.
- **The debug handle `window.dp`** exposes `net`, `input`, `local`, `aim`, `world`, `lobby`, `editor`, `rules`, `diag`, `showMenu`, `spec`, `followNext`, `hostView`, `me`, `threat`, `view`, `cfg` and `isHost`.

**`lobby.js`:** the lobby / pause menu.

- The team lists, with the host's ⇄ buttons and "→ BLUE next round" tags.
- Status and title lines for host and guests.
- Start, and End (two clicks), and Shuffle.
- Quick controls for each team's bots (in its column), bot skill and match length. They send `rules` edits, count rapid clicks from the value asked for, and show "next round (now X)".
- The host's Spectate / Join a team button, and the "Spectating: …" line.
- The pending-changes notice, with Cancel.

**`rules_ui.js`:** the rules editor.

- The group list (with changed-from-default counts), search, and one row per rule: slider, number box, unit, default, reset, description, badges.
- A **draft**: Apply sends only the edits; "Undo my edits" and "Reset all" change the draft.
- `enforce()` mirrors the server's pair and cap limits while dragging.
- Read-only for guests. Esc or a click outside closes it.
- **Following the host:** `follow(view)` shows the host's page, rule in focus (outlined) and draft; `unfollow()`; `describe(view)` puts the host's screen in words; `hostView()` is what the host's browser reports. A guest who closes a followed editor stops following.

**`previews.js`:** the editor's animated previews. 21 scenes, each tied to its rules through `preview` in `rules.py`:

- **Side views:** throw, arc, ricochet.
- **Top views:** wall ricochet, assist, slow balls curve less, stepping out of the way (sidestep compensation), dash.
- **Timelines:** defence windows (with the press grace and the lockout marker), rounds, cooldown, network, durations.
- **Charts:** damage, rally, stamina, cash, court.
- **Other:** body/reach, movement, bots.

Two-lane scenes run the default rules next to the lobby's (or the host's draft) in real time. Side views may stretch distances up to 1.5× to fill the lane; the readouts give exact numbers. Simulations are memoised by the values they depend on.

**`physics.js`:** `launchVelocity(from, to, speed, gravity, reachMax)`, the JS twin of `sim.launch_velocity`, and `curveShare(R, speed)`, the twin of `rules.Rules.curve_share`.

**`diag.js`:** the browser's diagnostics log.

- `frame()` and `snapshot()` (per-frame and per-update counters), `second()` (the `sec` line), `log()`.
- `flush()` (chunks into localStorage and to the server), `ack()`, `connect()` (also resends unacknowledged chunks from earlier page loads), `restore()`.
- `download()` ("Save my log"), `status()`.
- `main.js` gives it `clock` (server time) and `context` (ping, state, alive, lock, view delay). `drawFrame()` returns whether the picture was frozen.
- The menu's "Lag diagnostics" section has "Save my log" and the host's "Download all logs (zip)". L logs a `mark`.
- `net.js` reports each update's lateness (`onSnapshot`) and stale events (`onStale`), and supports `?jitter=N`.

**`net.js`:** connection, `?lag=N` simulation, clock offset, snapshot buffer (1.5 s), `sample()` with the interpolation rules above, and `takeEvents()` (drops events more than 1 s stale).

**`world.js`:**

- **`World`:** the scene, lights, fog, court builder, preview points and bounce marker, effects (burst, ring, spark, ghostBall, ghostMan), and `project()` and `cameraRay()`.
- **`Stickman`:** joint hierarchy and procedural poses. The sign conventions are in a comment in the code.
  - Poses: walk cycle, dodge, deflect swat, catch, throw follow-through, wind-up, flinch, knockout fall, invulnerability flicker, fading near the camera.
  - The perfect-dodge spin lasts 0.38 s with ghosts every 0.065 s (your own at 0.22 opacity, others at 0.45).
- **`Trail`:** a camera-facing ribbon with vertex alpha. Life is 0.09 s for normal balls and 0.35 + 0.12 × rally s for deflected ones; old trails keep fading after their ball is gone.
- **`BallView`:** rally colors, glow, trail, ghosts every 0.035 s when rally ≥ 1, and a height-scaled shadow.

**`hud.js`:** DOM updates only when values change; names always go in via `textContent`. The timing ring radius is 26 + 150 × time-to-impact px, with "near" at ≤ 0.3 s and "now" at ≤ 0.1 s.

**`input.js`:** bindings, pointer lock (`?nolock` bypasses it for tests), and everything released on blur, visibility change or loss of the lock. Releasing on blur cancels a wind-up instead of throwing.

**Controls:**

| Input | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| Hold / release left mouse | Charge / throw |
| Space / Shift | Dodge |
| Right mouse / F | Catch |
| E | Deflect |
| R | Revive |
| Tab | Scoreboard |
| H | Toggle the timing ring |
| Esc | The lobby / pause menu (the host's controls are here) |
| L | Marks "this feels laggy" in the session log |
| Spectating (host) | Mouse look, WASD fly, Space/Shift up/down, LMB/RMB follow the next/previous player |

**`sfx.js`:** synthesized throw, catch, perfect, deflect (pitch rises with rally), hit, knockout, dodge, ricochet, incoming warning, deny, revive and countdown beeps. Sound plays only in the focused tab.

## 12. Bots

`bots.update(game, p, now, dt)` runs at the start of each tick for every bot:

- **`_defend`:** for each enemy live ball, the bot estimates time to impact (horizontal closest approach plus a gravity height check).
  - It makes one plan per `(ball id, rally)`, so a returning rally ball is a new threat. The plan is no reaction, a sidestep for slow balls, or an action with a chosen lead time.
  - Ideal leads: dodge 0.15 s, catch 0.15, deflect 0.09, but never more than half the window, so narrower windows set by the host still work. Gaussian spread on top.
  - When the time to impact drops to the lead, the bot acts. A deflect aims back at the thrower.
- **`_throw`:**
  - The bot doesn't throw when a ball arrives within 0.7 s, and keeps 30 stamina in reserve (`BOT_STAMINA_RESERVE`).
  - Target weighting: closer is preferred, low stamina ×1.6, low HP ×1.3 (low = under 40% of the maximum).
  - Power is random up to what the reserve allows.
  - Aim leads the target's velocity (40–100%), plus Gaussian error.
  - With the profile's `bank` chance it throws a bank shot instead: the floor 45–70% of the way to the target, or the nearer side wall via the target's mirror image.
- **`_walk`:** wanders to random points in its own half every 1.5–4 s and faces its target or the nearest enemy.
- **`_revive`:** when affordable (from the team's pot with shared team cash), revives after a 0.8–2.5 s delay.

**Profiles** (defaults in `config.BOT_PROFILES`; each number is a rule, `BOT_<SKILL>_<FIELD>`, in the editor's Bots group):

| Skill | React chance | Timing spread | Aim error | Extra throw pause | Mix (dodge/catch/deflect) | Bank shots |
| --- | --- | --- | --- | --- | --- | --- |
| Easy | 0.55 | 0.09 s | 7.0° | 1.6–3.4 s | .5/.45/.05 | 5% |
| Normal | 0.80 | 0.055 s | 3.5° | 0.8–2.2 s | .4/.4/.2 | 15% |
| Hard | 0.93 | 0.03 s | 1.8° | 0.3–1.2 s | .3/.4/.3 | 25% |

## 13. Running, testing, building, sharing

**Run, for development or hosting:**

```powershell
.\run.bat                                        # creates/repairs .venv, starts on 8000 (or next free), opens browser
.venv\Scripts\python server.py --port 8123 --no-browser --fresh   # for testing: fixed port, no browser, default rules, nothing saved
```

- **Restarts:** restart the server after changing Python code; there's no auto-reload. Client changes only need a browser reload.
- **A test server remembers rules** that tests changed until it restarts, so restart it between test suites.
- **Hosting from the test PC:** the browser on the server's PC is the host. Add `?guest` to a tab's URL to see the guest view.

**Rule tests** (all 50 must pass) and **server tests** (all 6 must pass):

```powershell
.venv\Scripts\python tests\test_sim.py
.venv\Scripts\python tests\test_server.py      # starts its own server on a free port (with --fresh)
```

`test_server.py` covers:

- **over real WebSockets:** host detection, guest refusals, lobby edits applied at once, mid-match edits announced as pending, `sync`, the host key, and End applying the waiting changes;
- **the host's screen:** relayed only from the host, cleaned (bad rules and values dropped, numbers clamped), sent to latecomers, and cleared when the host leaves;
- **saved rules:** saving, loading, and ignoring a damaged `saved_rules.json`;
- **the session log:** server and browser records reaching the host's zip, a resent chunk stored once, and inputs counted per player;
- **the detectors:** stalls, late presses (and early ones that aren't), and console prints held up;
- **the report:** it blames a freeze during a server stall on the host and a player's own freezes on them, and gives each L mark the right cause.

**Reading a session's logs:** `.venv\Scripts\python tools\log_report.py <zip | session folder | logs folder | saved log>`. The logging browser test and the server-freeze helper are described in the browser tests' README.

The rule tests cover:

- hits, damage, harder throws hitting harder, arcs landing where aimed, throw cost, power and cooldown;
- catch timing (normal, perfect, too early); deflect (return, perfect, tighter than catch); the rally speeding to its cap; dodge (perfect, early);
- late presses that were on time on screen, presses after the ball arrived, the lag-compensation bound, no stamina;
- aim assist correcting small errors only; juking beating slow throws but not fast ones;
- floor and wall ricochets; one ricochet per throw; a deflect giving a fresh ricochet;
- slow balls bending less per metre (0, 0.5 and 1); a bounce taking curve away (0.5 and 0);
- the press grace (a press a hair late counts, and not with grace 0); sidestep compensation (a ball misses someone clear on their screen; off, it hits and the log shows the gap; moving too late is still a hit); the lockout (normal, 0 with the new press taking over, and a short lockout never cutting the window);
- court growth and shrinking; the center line; knockout, revive and round end;
- each team's bots set by the host, untouched by people joining or leaving, changed mid-match from the next round, gone with the last person; a full bots-only match;
- the host spectating (only the host; never hit or revived; back from the next round; cancelling); shared team cash (earning, a teammate reviving from the pot, switching it off and on); cash carrying over while revive prices start over;
- **the lobby and host:**
  - the server starts in the lobby and only the host starts the match;
  - guests can't change rules, bots, teams or the match;
  - rule changes apply at once in the lobby and from the next round in a match; discard and reset;
  - the host ends the match (waiting team moves apply);
  - moves and shuffle; a reconnecting player keeps their team;
  - "rounds to win" ends the match;
- **rules:**
  - validation and clamping;
  - changed rules really change the game (catch window, gravity, damage, health);
  - **every listed rule is read by the game**;
  - **20 fuzzed matches with random rule values**, also changed mid-match.

**Browser end-to-end tests:** see `tests\browser\README.md`. The server must run with `--no-browser --fresh`.

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\smoke.json
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock&mode=deflect&lag=150" tests\browser\autodefend.json
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\lobby_controls.json
```

- **Healthy result:** nearly every auto-defender press is defended.
- **Expected misses:** two balls arriving together, and ricochets bouncing at your feet. In software-rendered headless Chrome (~20 fps), frame stalls cause occasional late presses.
- **The two-browser lobby test** (`lobby_host.json` with `lobby_guest.json`, run at the same time) is described in the browser tests' README.
- **The clock test** (`clock.json`) makes the page's clock run fast (+300 ms over 10 s, like an OS time correction) and prints the frozen time per second. Healthy: the picture recovers as soon as the clock settles. Re-run it after touching the clock estimate in `net.js`.
- **The sidestep test** (`sidestep.json` + `sidestep.js`, with `&lag=150`, and `&comp=0` for compensation off) walks out of every incoming ball's path and counts balls sidestepped, hits, and hits while clear on screen. Re-run it after touching sidestep compensation, position reports or the pending logic.

**CI** (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request: the rule and server tests on Windows, macOS and Linux with Python 3.10 to 3.14, and a job that boots the server, checks it answers and plays a match in headless Chrome (`smoke.json`; any page error fails it).

**Balance profiling** (a bots-only match; prints round lengths and event counts):

```python
import collections
from sim import Game
g = Game(seed=11); g.bots_play_alone = True; g.bots_each = 3; g._sync_bots(0.0); g.start_match(0.0)
t, dt, counts, start, lengths = 0.0, 1 / 60, collections.Counter(), 0, []
for _ in range(int(600 / dt)):
    g.tick(t, t + dt); t += dt
    for e in g.events:
        counts[e["k"]] += 1
        if e["k"] == "round" and e["s"] == "play": start = e["t"]
        if e["k"] == "round" and e["s"] == "over": lengths.append(round(e["t"] - start))
    g.events.clear()
    if g.round_no > 8: break
print(lengths, g.score, dict(counts))
```

**Build the standalone Windows app:**

```powershell
.\build_exe.bat      # needs a working .venv (run run.bat once); installs the PyInstaller pinned in requirements-build.txt
```

- Output: `dist\Dodgeball\Dodgeball.exe` plus `_internal\`, and `dist\Dodgeball-windows.zip` (~19 MB).
- Rebuild after any code or `config.py` change: the defaults are baked in. The host's lobby rules are not; they live in `saved_rules.json` next to the exe.
- The PyInstaller flags live in `build_exe.py`: `--onedir --console --icon icon.ico --add-data static;static --collect-submodules uvicorn/websockets/anyio`.
- **Releases:** pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml` on GitHub's Windows machines. It builds the app from the tag and attaches the zip and its `.sha256` checksum to the tag's release, a draft until its notes are written. **Run workflow** with a tag rebuilds an older release. The routine is in `CONTRIBUTING.md`.

**Sharing:**

- **People without Python:** send the zip, or the link to the latest GitHub release. They unzip it and run `Dodgeball.exe`. SmartScreen may say "Windows protected your PC" (the app is unsigned): **More info → Run anyway**.
- **Friends can't connect (firewall):** the host double-clicks `Allow friends to connect.bat` next to the exe once (it asks for admin; `... check` shows what it would do, `... undo` removes the rule). Or set the Wi-Fi to Private and allow the prompt. Never turn the firewall off.
- **Playing together on one Wi-Fi:** only the host runs it; others open the address shown in its window. The host sets up the lobby in the browser that opens on their PC and presses Start match.
- **Passing on tuned rules:** copy `saved_rules.json` next to another host's `Dodgeball.exe`, or `server.py`.
- **Sharing the source:** exclude `.venv`, `build`, `dist`. A copied `.venv` is auto-repaired by `run.bat`.
- **Mac/Linux:** run from source with Python. There's no Mac build; it would have to be built on a Mac.

## 14. Pitfalls and lessons learned

- **Never start the server in automated tests without `--no-browser`**, or it opens browser windows on the user's desktop.
- **A venv is not portable**: it stores the absolute path of its Python. Hence `run.bat`'s self-repair.
- **Windows batch files:**
  - They need CRLF line endings. Convert after writing them from Git Bash: `sed -i 's/\r\?$/\r/' file.bat`.
  - `%VAR%` inside a parenthesized block is expanded when the block is *parsed*. `run.bat` uses labels and `goto` instead.
  - From Git Bash, launch them by full Windows path: ``cmd //c "$(cygpath -w path/to/file.bat)"``.
- **PowerShell `Compress-Archive`** reports success even when it fails, and trips over files that Windows Defender is still scanning. `build_exe.py` zips with Python's `shutil` and retries instead.
- **PyInstaller:**
  - uvicorn, websockets and anyio import parts by name at runtime, so collect their submodules.
  - Static files live under `sys._MEIPASS` in the package.
  - The "Hidden import tzdata not found" warning is harmless.
- **Snapshot interpolation subtleties (section 8)** were the source of most timing bugs: when state changes appear, the velocity of frozen balls, and the arrival moment. Measure with the auto-defender after touching `net.js`, `findThreat` or the pending logic.
- **Duplicated math must stay in sync:** `launch_velocity` and the hand offsets exist in both `sim.py` and `main.js`.
- **Headless Chrome** can't do pointer lock (use `?nolock`) and renders in software, so judge visual tuning on a real GPU.
- **three.js r185** ships as `three.module.min.js`, which imports `./three.core.min.js`. Both must sit side by side in `static\vendor\`.
- **The game server holds state in memory.** Restarting it resets everything except the host's saved rules. When the last human leaves, bots, score and round reset, but the rules stay.
- **Test servers and rules:**
  - A test server keeps any rules a test changed until it restarts.
  - Start test servers with `--fresh`, so they neither load nor overwrite the user's `saved_rules.json`.
  - Browser tests that change rules should reset them first and wait for the reset to arrive.
- **Every browser on the host PC is a host**, so multi-tab testing on one PC shows host controls in every tab. Use `?guest` to see what other players see.
- **Adding a rule:**
  1. Put its default in `config.py`.
  2. Add an `_add(...)` line in `rules.py` (name, plain description, range, unit, preview scene).
  3. Read it through `self.rules` / `game.rules`. If the browser needs it, add it to `Rules.for_client`.
  - `test_every_rule_is_used_by_the_game` fails for a rule nothing reads, and the fuzz test exercises the new range.
  - The preview id must name a scene in `previews.js`; unknown ids fall back to the generic duration bar.
- **Scripted edits from Git Bash:** heredocs passed through the Bash tool can lose backslashes, or fail to parse at all. Write edit scripts to a file first, or use the editor tool.
- **Python on Windows writes CRLF in text mode.** `Path.write_text` / `open(..., "w")` turn `\n` into `\r\n`, which silently changes a file's line endings. Edit scripts should use `read_bytes`/`write_bytes` (or `newline="\n"`).
- **Chrome hands `Content-Disposition: attachment` responses to its download manager**, so a page's `fetch()` of such a URL gets an empty 204 instead. Measured in headless Chrome with a probe server. `/logs/download` sends the filename in `X-Filename`, and the page saves the zip itself.
- **The venv's `python.exe` is a launcher:** the real interpreter runs as its child. Killing only the launcher leaves the server alive for a moment, still holding its files and port. Tests end the tree with `taskkill /F /T`.
- **This PC's console code page is 1256.** Printing characters outside it to a pipe raises `UnicodeEncodeError`. The real console window is fine (Python writes UTF-16 to it). `say()` falls back to ASCII, and the log report prints ASCII only. `python -I` ignores `PYTHONIOENCODING`, so isolated scripts call `sys.stdout.reconfigure(encoding="utf-8")`.
- **Headless Chrome renders in software on every CPU core.** Two at once saturate this 16-thread PC and starve the server under test; the session logs show it as server stalls. Rehearse with one browser (plus `CDP_SIZE=640x360`), and fake other players with a script.
- **Browser-test steps share one global scope:** a `const` declared in one `eval` step makes the next step that declares it fail ("already been declared"). Wrap steps in `(() => { ... })()`.
- **Browser tests and localStorage:** each debug port keeps its Chrome profile in the temp folder, so personal settings (like "Follow the host") survive between runs. Tests set what they rely on.
- **CSS class names are global:** the lobby's `.tag` labels and the join screen's `.tag` tagline styled each other (fixed by scoping to `.teamCol .tag`).
- **Windows Firewall:** block rules win over allow rules. Answering its "allow access" prompt for private networks only makes *block* rules for public ones, so on an office Wi-Fi marked Public the game stays blocked until those go (`Allow friends to connect.bat` removes them).
- **A computer's clock can run fast for a while:** an OS time correction (seen on a Linux laptop) made the browser's `performance.now()` run about 1% fast for 25 s. Anything that estimates the server clock from arrival times must be able to move back quickly, not just drift (`net.js` re-anchors).
- **Browsers resend old log chunks:** a page keeps unsent chunks in localStorage and sends them to whichever server it reaches next, so a session folder can hold lines from earlier sessions. The report leaves out lines from before the server started.
- **Git and line endings on Windows:** with `core.autocrlf` on, files checked out before `.gitattributes` existed keep CRLF in the working tree, while git stores LF. Scripts that match text across lines must handle `\r\n`.
- **GitHub keeps force-pushed commits:** rewriting a published history doesn't unpublish the old commits; they stay reachable by id and in the repository's Activity view. A clean history needs a new repository (phase 9).

## 15. Known limitations and ideas for next steps

**Known limitations, by design or accepted for now:**

- **Volleys:** one catch holds one ball. Two balls arriving within a few hundredths of a second can't both be caught; dodge through volleys instead.
- **Close ricochets:** a ricochet bouncing right at someone's feet can be unreactable. Tune with `RICOCHET_CURVE_KEEP`, `RICOCHET_MIN_SPEED` and `RICOCHET_CONE_DEG` if it feels unfair.
- **The perfect-dodge spin** starts when the server confirms it, about 0.1 s after the press, not instantly.
- **Movement is trusted** to each browser within the court limits: fine among friends, not for strangers.
- **One lobby per server:** no separate rooms.
- **No reconnect-with-state:** a reloaded tab rejoins as a fresh player with the same name and team (full HP, no cash). Only the host's rules persist between server runs.
- **The host is whoever plays on the server's PC** (or holds the host link). Anyone with access to that PC's browser has host powers, and with several local tabs, every one of them is a host.
- **Rule previews are illustrations, though computed with the game's formulas:**
  - top views ignore gravity;
  - side views may stretch distances up to 1.5×;
  - the bot previews show what the numbers mean, not a full bot simulation.
- **Lag:** analysed (`LAG_ANALYSIS.md`, with three office sessions of logs). The game-side fixes are settings now (view delay 0.10, press grace, sidestep compensation, the ricochet curve, the adjustable lockout). The worst cases were players' own Wi-Fi (mostly Linux laptops), which the game can't fix. QuickEdit is measured, not fixed.
- **Sidestep compensation favours the person dodging:** a thrower can see a ball pass through someone who had already stepped clear on their own screen, and a sidestepped ball hangs at the contact point for up to ~0.15 s before flying on.
- **Only the host can spectate**, and nobody can choose their own team.
- **Untested on a real GPU:** visual tuning (afterimage density, trail lengths, ring sizes) was judged from headless screenshots.
- **The standalone app is Windows-only and unsigned**, so SmartScreen warns and antivirus may flag it.
- **Phones/touch:** none yet. The user deferred them.

**Ideas, not started:**

- **The lag plan:** the next office session's logs will show what the new settings do (the report's FAIRNESS section). Still open: a per-player "your Wi-Fi is dropping out" notice; buffering a press made just before a lockout ends.
- Named rule presets (save/load several rule sets, e.g. "office lag-friendly").
- Kicking a player from the lobby.
- Touch controls for phones.
- Obstacles and cover.
- A short practice mode or tutorial for the timing windows.
- Spectating for everyone, not just the host.
- Recorded sound effects.
- Simple character colors/hats.
- Score history.
- A Mac build.
- Code signing.

## 16. Glossary

| Term | Meaning |
| --- | --- |
| **Perfect** | The ball arrives within the action's perfect zone after the press ("last moment"): refund plus bonus cash |
| **Window** | How long a dodge/catch/deflect stays active after the press |
| **Recovery** | Lockout after a missed window; mashing is punished. A press during it says "Still recovering" and is logged as `ignored`. `LOCKOUT_SCALE` scales the whole lockout (0 = none) |
| **Press grace** | A person's dodge/catch/deflect counts from this long before the press (`PRESS_GRACE`, 0.02 s) |
| **Sidestep compensation** | Stepping out of a ball's way judged by the player's own screen (`SIDESTEP_COMP`); a ball that misses that way gives a `sidestep` event |
| **Gap (hit)** | How far clear of the ball the player was on their own screen at contact; negative = touching |
| **Rally** | Number of deflections on a ball; each adds 15% speed and changes its color |
| **Ricochet / bank shot** | A bounce off the floor or a side wall (one per throw), then curving toward an enemy ahead, with less curve than before the bounce |
| **Assist** | Light aim assist: bending toward an enemy within the cone |
| **Slow-ball curve** | How much a tap-speed ball bends compared with a full-power one, per metre (`SLOW_BALL_CURVE`) |
| **Curve (ball)** | A ball's bend strength in rad/s at full power; a bounce multiplies it by `RICOCHET_CURVE_KEEP`, a deflect restores it |
| **wt / view time** | Server time of the world currently on a client's screen; sent with every press |
| **view_lag** | How far behind the server a client's screen is (smoothed `now − wt`) |
| **Pending** | A ball touching a player with no active defence, frozen briefly to wait for a late press |
| **tp** | Teleport counter. The server bumps it on spawn/revive; client inputs with an old `tp` are ignored |
| **Convergence** | Shifting balls near you onto your present position for display |
| **Handled ball** | A ball you already pressed for; the timing ring skips it to show the next one |
| **Afterimage (rule)** | During a dodge, a ball reaching the dodge's start point counts as dodged |
| **Bots per team** | `BOTS_RED` / `BOTS_BLUE`: set by the host, never balanced automatically (replaced "fill") |
| **Spectating / WATCHING** | The host watching instead of playing: team −1, not alive, free or follow camera |
| **The host's screen (hostview)** | What the host's browser shows (menu, rules page, rule in focus, unapplied edits), relayed live to everyone else |
| **Team cash** | With `TEAM_CASH`, one pot per team that everyone earns into and revives from |
| **Lobby / wait / count / play / over** | States: before a match (warm-up) / a match waiting for an empty team / countdown / playing / round result |
| **Free play** | `lobby` or `wait`: no round running; the downed stand up, and host changes apply at once |
| **Host** | The player who sets up the lobby: a browser on the server's PC, or anyone with the console's host link |
| **Rules** | The 117 host-editable numbers (`rules.py`); `game.rules` is the live set |
| **Pending / next rules** | Changes made during a match, waiting for the next round's countdown (`game.next_rules`) |
| **rv** | Rules version: bumps on every change; in snapshots, so a browser that missed an update asks again |
| **Draft** | The editor's unapplied edits; Apply sends them |
| **Preview lanes** | The rules editor's two side-by-side animations: the defaults and this lobby (or your draft) |
| **Session log** | One folder per server run under `logs/`: `server.jsonl` plus one `client-<run>-<name>.jsonl` per browser page load |
| **Frozen (picture)** | The view time is past the newest world update, so the others and the balls stand still. The log's measure of felt lag |
| **Late (update)** | How much later a world update arrived than the quickest one so far. Over ~50–80 ms, the picture freezes |
| **Input gap** | The longest wait between one player's inputs reaching the server. Gaps mean others see them stutter |
| **Stall** | The server's game loop paused for over 100 ms: every player freezes together |
| **Late press** | A defence that was in time on the player's screen but reached the server after the ball was already a hit |
| **Lag mark** | A press of L: "this felt laggy" |
| **run / tab** | A browser page load / a browser tab (the same across reloads) |
