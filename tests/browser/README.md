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
- Headless Chrome renders in software (~20 fps), so frame stalls cause the odd late press that a real player at 60 fps wouldn't get.
- Screenshots land in the current folder and are git-ignored.
