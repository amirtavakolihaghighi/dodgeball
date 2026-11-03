# Browser tests

End-to-end checks of the real client in headless Chrome (needs Chrome and Node 22+).

## Start the server first

Always use `--no-browser` and `--fresh`. Restart the server between suites, because it keeps any rules a test changed. Stop it with Ctrl+C, or kill the whole process tree: the venv's `python.exe` is a launcher with the real server as its child.

```powershell
.venv\Scripts\python server.py --port 8123 --no-browser --fresh
```

## The tests

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\smoke.json
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock&mode=deflect&lag=150" tests\browser\autodefend.json
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\lobby_controls.json
```

The browser on the server's PC is the host, so these tests run as the host.

- **`smoke.json`:** joins, checks the lobby and the host's Start button, starts the match, and prints the state. It saves `smoke_lobby.png` and `smoke.png` and fails loudly on any page error.
- **`autodefend.json` + `autodefend.js`:**
  - Starts the match, then presses catch/deflect/dodge (`&mode=`) just before every incoming ball for 40 s, and reports how many got through and why.
  - Healthy result: nearly every press is defended.
  - Expected misses: two balls arriving together (one catch holds one ball), and ricochets bouncing right at your feet.
- **`lobby_controls.json`:** the host's quick controls:
  - each team's bots +/− and match length, including rapid clicks; bot skill;
  - rules search; undo and reset-all in the editor; the "Slow balls curve less" and wall-ricochet previews (screenshots `rules_slow_ball_curve.png`, `rules_ricochet_curve.png`);
  - a press during the recovery saying "Still recovering" and landing in the log as `ignored`; then, with "Lockout after a missed press" at 0, two quick presses both going through (no ignored press, no "busy" refusal);
  - the Network previews: press grace and the lockout marker on the timing window, and stepping out of the way (`rules_press_grace.png`, `rules_sidestep.png`, `rules_lockout.png`);
  - a mid-match bot change shown as "next round"; cancelling the waiting changes;
  - spectating: asked for mid-match (from the next round), shuffle leaving the spectator out, the two-click End match, watching in the lobby, starting a match while watching, flying with W, following a player (`spectate_free.png`, `spectate_follow.png`), and coming back to a team from the next round.

## The two-browser lobby test

A host and a guest at the same time, on separate debug ports. Start the guest in the background first:

```powershell
Start-Process node -ArgumentList 'tests\browser\cdp.js', '"http://127.0.0.1:8123/?nolock&guest"', 'tests\browser\lobby_guest.json', '9452' -NoNewWindow
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\lobby_host.json 9451
```

- **The host:**
  - sets 20 s rounds and one bot per team;
  - opens the rules on Ricochets, focuses "Curve kept after a bounce" and drafts 0.3 without applying, then closes the editor;
  - opens Bot Ace's own settings (⚙), drafts Health 250 without applying, then closes them;
  - moves the guest to the other team, and starts the match;
  - changes gravity mid-match, and checks it stays 6 until round 2, then becomes 9;
  - ends the match and checks the lobby menu comes back.
- **The guest (`?guest`)**, checked in its own output:
  - sees no host controls (no bot buttons, no Spectate) and a read-only rules editor;
  - follows the host's screen: its editor opens on the same page by itself, outlines the host's rule, shows the host's 0.30 as "not applied yet" (`lobby_guest_follow.png`), and closes (dropping the 0.30) when the host closes theirs;
  - follows the host onto Bot Ace's own settings too: the page, the host's unapplied Health 250 next to "everyone: 100 HP", only an Export button for the guest (`lobby_guest_follow_player.png`), closing when the host's closes;
  - gets "deny: host" for its own change attempts (rules, start, spectate);
  - sees the pending change as "next round (now 6.0 m/s²)" and a pending notice;
  - gets gravity 9 when round 2 starts.

## Who players are, renaming, the search, bots with flags

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\people_bots.json
```

`people_bots.json` (+ `people_bots.js`), as the host:

- **The same name twice:** a second "browser" (a WebSocket from the page, with its own secret code) joins under the host's name. The two get different keys, the lobby numbers them #1 and #2 (`people_same_name.png`), and own settings given to the twin reach only the twin.
- **Renaming** with the menu's name box: a long name is cut at 32 letters, the key and team stay, a reload would rejoin under the new name, and the HUD and the tab's title follow, also back to a shorter name.
- **The search across every tab:** "dash time" (the Dodge tab), "network" (the whole Network tab, by its title) and "perfect catch" (three tabs), with "Every tab" and each tab's count in the nav and the words marked (`rules_search.png`).
- **The bots page:** Alex made on BLUE and given Dodge master and Berserker through the page's own controls (`bots_page.png`); Alex's ⚙ page shows its flags' values (reacts to 1.00×, every throw at full power, at the front) and the lobby its flags (`bots_alex_settings.png`); the Berserker flag's page shows the bot numbers once, under "Behaviour", and an edit applied changes the flag (`bots_flag_editor.png`); Alex moved to RED, taken off, and added back to BLUE with "Add a bot…" (`bots_lobby.png`).

## Team health

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\team_health.json
```

`team_health.json` switches team health on (free health packs, three hard BLUE bots, 20 s rounds) and checks:

- the bars: everyone's health added up (RED 200, BLUE 300), under the scores and in place of your own health;
- R buying a pack once the bar is down by 50 ("+50 TEAM HEALTH", `team_health.png`), and the name tags without health;
- round 1 running out of time: the team with more of its bar left wins;
- round 2 with a fixed bar of 60 (set during round 1, so it waits): RED's bar empties, and both RED players fall at once (`team_wipe.png`, "knocked out RED, the whole team").

## Health regeneration and the round-time buttons

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\regen.json
```

`regen.json` (+ `regen.js`):

- the lobby's Round time − / + (3:00 → 4:00 → 3:00 → 2:00, down to 0:20, then up to 0:30), with rapid clicks;
- the previews of both kinds of regeneration (`rules_regen.png`, `rules_team_regen.png`);
- round 1, own health, +12/s after 1.5 s up to 70%, against one easy BLUE bot: the marker at 70%, and health sampled ten times a second: after each hit it starts rising about 1.4 s later (samples are 0.1 s apart) at about 12/s, and stops at 70 (`regen_own.png`);
- round 2, team health with the same numbers for the bar: the markers at 70% on both team bars (BLUE's from its right end), and the bar doing the same (`regen_team.png`).

## Standing still and regeneration

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\still.json
```

`still.json` (+ `still.js`) sets own-health regeneration to "only while standing still" (1 s to count, 1 + 3 = 4 per second, up to 90%) and gives one BLUE bot its own settings so it hits for 40 every 20 s, dead on. After its hit, `still.js` holds keys like a player and reports the health gained in each part, and the HUD's hint:

- standing: about 4 per second ("Standing still: regenerating");
- walking (W held): nothing ("Stand still to regenerate");
- standing again: nothing in its first second, then 4 per second;
- a dodge with S held, let go 0.12 s in (before the 0.22 s dash ends): it keeps going, no restart;
- a dodge with W held on after it: only what came during the dash, then nothing until a second of standing.

Round 2 does the same for the team bar ("Standing still: filling the team's bar"; `still_own.png`, `still_team.png`). Measured: 0 while walking and in each first second, 6 in each 1.5 s after it, 6–7 after the early-release dodge, 1–2 for the held one.

## Players' own settings, ball colours, settings files

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\own_settings.json
```

`own_settings.json` (+ `own_settings.js`):

- opens Bot Ace's ⚙: only the rules a bot may have its own of, and the Hard profile's numbers once its skill is set to hard; Health 300 against "everyone: 100 HP" (`own_settings.png`); applied, Bot Ace has 300 health and an "own settings: 3" tag;
- the host's own ⚙: a run speed of 11 reaches their browser while everyone else's stays 6;
- the ball colours editor with BLUE bots' balls drafted green (`rules_colors.png`), then applied;
- Export settings, reset everything, Import the saved file: every rule and both players' own settings come back; Bot Ace's profile exported and imported onto Bot Blitz; wrong files refused with a message;
- a round: everyone's health as set, and the colour each ball in flight is drawn in (a RED person's orange, a RED bot's peach, BLUE bots' green), plus the ball in your hand (`ball_colors.png`).

## A computer clock that runs fast

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\clock.json
```

`clock.json` starts a match, then makes the page's clock run fast (+300 ms over 10 s, like the OS time correction seen on a Linux laptop in the 28 Oct office log) and prints the frozen time and the worst lateness for each second. Healthy: frozen only partly during the 10 s ramp, and nothing once it ends (measured: 2 s frozen in total; before the re-anchoring fix, about a second of every second, for minutes).

## Sidestep compensation

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock&lag=150" tests\browser\sidestep.json
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock&lag=150&comp=0" tests\browser\sidestep.json
```

`sidestep.js` walks out of the way of every incoming ball (holds A or D away from its line from ~0.25 s before it arrives) and never presses a defence, against two hard BLUE bots. It prints how many balls it tried to avoid, how many missed it thanks to the compensation, the hits, and the hits that came while it was clear on its own screen. With 150 ms of simulated lag, expect with compensation on (the default) about half the balls sidestepped and no hits while clear; with `&comp=0`, nearly every hit is one while clear on screen (measured: on 26/13/7/0, off 16/0/14/14).

## Why a hit got through

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\why_hit.json
```

`why_hit.js` plays alone against three hard bots, with free deflects and no lockout, and deflects every other incoming ball about 0.27 s too early (the rest on time). It prints the presses, the hits, how many hits the server marked `early` ("TOO EARLY") or `second` ("SECOND BALL"), and how many of those popups appeared on screen. Healthy: the marked hits and the popups match one for one (measured: 10 hits, 6 too early and 3 second ball, and the same 6 + 3 popups).

## Graphics, presses timed from their key, effects prepared in advance

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\graphics.json
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock&nowarm" tests\browser\graphics.json
```

Add `&noarena` to any test to draw the plain court instead of the sports hall, for comparing frame rates. With the hall, headless Chrome draws Low at about 30 frames a second (about 50 without).

`graphics.json` (+ `graphics.js`) checks:

- **In the lobby:** the warning for drawing without the graphics card (headless Chrome draws in software, so it shows), Auto starting at Low at half the sharpness, and the host's ceiling of Medium.
- **Auto's rules,** on a stand-in world fed made-up frame times:
  - slow at High steps down, and a step that helps is kept;
  - a step that doesn't help (30 → 31 fps) is followed by one more, to Low; when that doesn't help either, Auto goes back to High and stops changing things (`notHelped`: `medium, then low, then high, stuck true`); when Low helps, it stays there (`lowHelped`: `low, stuck false`);
  - 20 smooth seconds try a level up, but only between rounds (`rises`: `medium during a round, high after it`), and a level that was too slow after a step up isn't tried again (`failedNotRetried`: `medium, then medium after 30 smooth seconds`);
  - the host's ceiling lowers Auto but not a chosen High;
  - no graphics card starts at Low;
  - a paused page isn't counted as slow.
- **Presses timed from their key event:** a press the browser handled 40 ms or 120 ms late is logged as held that long, and its `wt` is the moment the key went down; a nonsense timestamp (2.5 s old) falls back to now.
- **No shader built mid-match:** 35 s of play, deflecting, dodging and catching every ball in turn (rally balls, perfect-dodge afterimages, bounces, hits). It prints the shader count in the lobby and after the match.
  - Healthy: none built mid-match. Measured: 10 in the lobby and none added.
  - With `&nowarm` (no warm-up), the same match built 3 mid-match (5 in the lobby, then 8). Each such build freezes the picture for a moment on a real laptop.

## The athletes

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\athletes.json
```

`athletes.json` (+ `athletes.js`) checks the athletes that replace the stick figures (`athlete.js`):

- **Everyone dressed:** 4 of 4 (you and three bots), the helmet and the face both among them (from the players' ids: 1 and 2 face, 3 and 4 helmet), each drawing two meshes (the body and its head).
- **Low:** the light meshes (`body_lo`, ...) show instead, and the shader count doesn't change (37).
- **No foot through the floor:** in the lobby and in a match, and with your own player held in a wind-up, a dodge, a catch and a deflect, no ankle goes under its resting height (7 cm). (Since step 8 the moves' clips place the hands, not the stick figure.)
- **Pictures** (`athletes_*.png`): your player from the front, back and side and its face close up, in each pose, a blue player, both heads close up, Low, and the game's own view. The camera is moved only while drawing (`world.render` wrapped), with everyone else hidden for that frame and the HUD faded.

## The athletes' moves

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\moves.json
```

`moves.json` (+ `moves.js`, and `athletes.js` for the pictures) holds your own player (standing in the lobby's warm-up) in each move, at a chosen moment, by overriding its state and timers each frame (a frame early, since the frame moves them on before the pose is made):

- **The moves:** standing; strafing right and left, a backpedal, and strafing right again right after it (the player walked steadily); each throw's wind-up and release (overhead, side-arm, underarm); the parry's start, peak and follow-through; the catch (from the front and the side); a caught ball pulled in; carrying; the dashes (right, its landing, left, forward, back); the corkscrew, the side flip, the butterfly and the backflip, and a corkscrew in the middle of a dash; the three knockouts, lying, getting up, and walking during a get-up; winning and losing.
- **Pictures:** `moves_*.png`, each from the side or the front.
- **Positions:** each move prints where the hands, feet, hips and head are, the legs' turn (`legYaw`) and the hips' turn measured from the bones (`hipsTurn`, + to the right). Healthy: strafing right and left, `hipsTurn` about +1.3 and −1.3, and +1.3 with `back` false right after the backpedal; the corkscrew in a dash, the hips about 1.5 m up like the corkscrew alone; walking during a get-up, the hips about 0.9 m up (standing still, 0.29); the side-arm wind-up's right hand 0.6 m out; the parry's left hand 0.4 m out at its peak; the catch's 0.6 m forward; the forward dash's hips about 0.8 m up; lying, the hips about 0.24 m up and the head 0.23; kneeling, the hips 0.49; the acrobatics, the hips about 1.5 m up.
- **Locked moves:** the moves the user approved (Locked in `docs/ANIMATIONS.md`) are checked after they're held: `__lock(name)` compares their key numbers (`LOCKS` in `moves.js`) with what the user approved, within a tolerance, and prints `locked ok: ...` or `FAIL locked move ... changed: ...`. Any `FAIL` makes the run exit with 1 (`cdp.js` does that for every test). Locked since 2026-11-03: strafing right and left (and right after a backpedal), the four acrobatics and a corkscrew in a dash, getting up, and walking during a get-up.
- **Running:** then a match, with pictures of a running player from each team.

## Juice: the camera never moves the aim

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\juice.json
```

`juice.json` (+ `juice.js`, and `graphics.js` for the match) checks:

- **The aim never moves:** with full shake and a strong jolt, the aim worked out in the shaken frame equals the aim from a freshly placed camera, while the camera that drew the frame had moved (measured: 21 cm and 0.75°, the view 5° wider).
- **The Screen shake slider at 0:** the camera doesn't move, the view stays at 62°, and the setting is saved.
- **The pooled specks** appear (20 of 40 on Low: half) and are all gone 1.6 s later.
- **The impact freeze:** frozen right after, shuddering about 1.7 cm, over by 0.4 s, the figure back in place.
- **See-through walls** (with the hall): at your end wall the camera is behind it, and the wall fades to 15% with its outline at 55%; in the middle it's solid again. At a side wall, facing across, that side's boards (20%), stands and crowd (15%) fade and the other side's don't. Skipped with `&noarena`.
- **A 25 s match** deflecting, dodging and catching every ball: the fastest balls stretch to the 30% cap, specks peak, and no shader is built mid-match.

## Sound: what comes out

```powershell
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock" tests\browser\sound.json
```

`sound.json` (+ `sound.js`) taps the output after the limiter with an analyser on each channel. Claude can't hear, so this checks that sound really comes out; whether it sounds good is the user's call, on the "Hear every sound" page.

- **The recordings load:** 43 sounds, 134 variants, decoded at 48 kHz; the six volume sliders exist.
- **Every moment makes sound** (−4 to −23 dBFS at the default volumes), and it's silent afterwards. The music is turned off first, or the meter would hear it.
- **The volumes:** the Announcer slider at 0 makes "Fight!" silent (−125 dB) while a hit still plays; the levels are saved.
- **Sides:** a bounce 6 m to the left is 14 dB louder on the left channel, and one to the right on the right. So is the incoming-ball whoosh.
- **A pile-up:** 300 bounces at once play as 2 (the same sound twice within 25 ms plays once), and at most 40 at once when forced, with no slower frames.
- **Breathing:** tired for 1.5 s, the panting sounds; it stops by itself a few seconds after.
- **The music:** the lobby track playing in the lobby; during play, the match track at 22%.
- **A 25 s match with bots and the auto-defender** (`graphics.js`): the announcer, the whistle, throws, hits with grunts, bounces, catches and your own dashes all play.
- **The sound check page** (`/static/sounds.html`) loads and lists all 43 recordings.

On this PC, Internet Download Manager gives Chrome an empty answer for `.ogg` files (and `.mp3`, `.wav`, `.zip`, ...), even headless and with extensions off. That's why the sounds are `.oga`. If the test reports `EncodingError: Unable to decode audio data`, look for that first.

## The session logs

`--fresh` turns logging off, so give the test server a log folder (`tests\browser\out\` is git-ignored):

```powershell
.venv\Scripts\python server.py --port 8123 --no-browser --fresh --log-dir tests\browser\out\logs
node tests\browser\cdp.js "http://127.0.0.1:8123/?nolock&jitter=200" tests\browser\logs.json
.venv\Scripts\python tests\browser\freeze_server.py 8123 1.5     # optional, in another terminal during the run
.venv\Scripts\python tools\log_report.py tests\browser\out\logs
```

**What `logs.json` does:**

- One player on simulated bad Wi-Fi (`jitter=200`) starts a match and presses L.
- It stalls its own page for 400 ms.
- It prints its log counts (seconds, freezes, hitches, marks), then downloads everyone's logs the way the host's button does. That should come back as `status 200` with a zip.

**`freeze_server.py`** suspends the server process for a while, like a click in its console window. Expect:

- in the report: one server stall of that length;
- the player's freezes split into "host side" (during the stall) and their own (the jitter);
- the L mark attributed to the network if it came before the freeze.

## Notes

- `&lag=150` makes the page add 150 ms of network round trip, to check lag compensation. `&jitter=200` adds up to 200 ms more, unevenly but in order, like Wi-Fi over TCP.
- `CDP_SIZE=640x360` (an environment variable) renders a smaller page. Each software-rendered headless Chrome keeps every CPU core busy, so with two or more at once the server they test gets starved. Even small ones max out this 16-thread PC, so rehearse with one browser where you can.
- To run two players at once, give each `cdp.js` run its own debug port (the third argument), for example 9401 and 9402.
- Headless Chrome renders in software: about 20 fps at High graphics. Auto starts at Low there (about 50 fps at the default size). Frame stalls still cause the odd late press that a real player at 60 fps wouldn't get.
- Screenshots land in the current folder and are git-ignored.
