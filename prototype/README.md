# Dodge & Parry: LAN prototype

Schoolyard dodgeball with Souls-style stamina, in 3D in the browser. One computer runs a small
Python server. Everyone on the same Wi-Fi opens a web page and plays. Bots fill empty spots, so
you can also play and tune it alone.

## Run it

Double-click **`run.bat`**. The first run creates a local Python environment (`.venv`), which needs Python 3.10+ on PATH. The game opens in your browser by itself.

Or run it by hand (on Mac/Linux, use `python3` and `.venv/bin/python`):

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python server.py          # --port 8080 to pick a port, --no-browser to not open one
```

The server window shows the addresses to open:

- **This computer:** `http://localhost:8000`. If 8000 is busy it uses the next free port and says so.
- **Other devices on the same Wi-Fi:** `http://<the 192.168.x.x address it shows>:8000`. The in-game menu (Esc) shows it too.

When playing together on one Wi-Fi, only the host runs the game. Everyone else just opens that address in a browser.

## Share it with people who don't have Python

Double-click **`build_exe.bat`** (after running `run.bat` once). It builds **`dist\DodgeAndParry-windows.zip`**, about 19 MB. Send that zip: your friends unzip it and double-click `DodgeAndParry.exe`. No Python needed.

- Windows may say "Windows protected your PC", because the app isn't signed by a publisher: click **More info**, then **Run anyway**.
- Closing the app's window stops the game server.
- Rebuild after changing the code or `config.py`; the settings are baked into the app.
- It's Windows-only. Friends on a Mac need Python and the manual steps above.

If you share this source folder instead, leave out `.venv`, `build` and `dist`. They're made on your computer and are big. A copied `.venv` won't work elsewhere, but `run.bat` notices and rebuilds it.

If other devices can't connect, it's almost always Windows Firewall:

- Allow Python when Windows asks.
- Make sure the Wi-Fi network is set to **Private**, not Public.

## Testing alone

- **Bots** fill each team up to 2 players by default. Change the count (0–6) and skill (easy/normal/hard) in the Esc menu. Extra bots join right away and the court grows with them; fewer bots apply at the next round.
- **Several players on one PC:** open more tabs or windows and join each with a different name and team. Two browser windows side by side work best, because background tabs stop drawing. The tab title shows who is who, and only the focused tab plays sound.
- **Simulate bad Wi-Fi:** add `?lag=120` to the URL for a 120 ms round trip. Timing stays fair up to about 150 ms; beyond that, presses start counting late.

## Controls

| Input | Action |
| --- | --- |
| WASD, Mouse | move, aim (over-the-shoulder camera, crosshair is the aim) |
| Hold / release left mouse | charge / throw. Longer = faster ball, more stamina |
| Space or Shift | **dodge**: a dash you can't be hit during |
| Right mouse or F | **catch**: the ball becomes yours, so you can throw right away |
| E | **deflect**: tighter timing, returns the ball instantly and faster |
| R | revive a fallen teammate (costs cash) |
| Tab / H / Esc | scoreboard / toggle timing ring / menu |

## Rules

All numbers live in **`config.py`**. These are the defaults.

- **Throwing:** holding longer throws faster, and **speed is what deals damage**.
  - A quick tap is 12 m/s for 6 stamina and does about 15 damage.
  - A full 0.9 s charge is 34 m/s for 34 stamina and does about 45 damage. Rally balls can reach 60.
  - Low stamina caps how hard you can throw.
  - While charging, the throw box shows the speed, expected damage and stamina cost.
  - A new ball appears 1.6 s after each throw.
- **Arcs:** balls follow a gentle gravity arc. Quick taps lob visibly, full-power throws fly almost flat. The ball still lands exactly where your crosshair points, and a dotted line previews the arc while you charge.
- **Aim assist:** if an enemy is within 10° of your crosshair, the ball bends gently toward them. That fixes small aim errors, but a slow ball can still be juked. The gold diamond shows who it would bend toward.
- **Ricochets:** a ball that hits the floor or a side wall bounces once and loses some speed (so it hits softer). It then curves toward the nearest enemy ahead of it.
  - Aim at the floor in front of someone, or at the side glass, for a bank shot. The preview shows the bounce point.
  - The second contact ends the ball, and the team-colored end walls always stop it.
  - Bots use bank shots too.
- **Defence:** press just before the ball arrives. Each action has a window. Arriving in its first fraction ("the last moment") is **perfect**: it refunds most of the stamina and pays extra cash. Pressing too early wastes the stamina, and there's a short recovery, so mashing is punished.

  | Action | Stamina (perfect) | Window | Perfect zone |
  | --- | --- | --- | --- |
  | Dodge | 25 (10) | 0.32 s | 0.12 s |
  | Catch | 20 (8) | 0.30 s | 0.10 s |
  | Deflect | 30 (12) | 0.18 s | 0.06 s |

- **Perfect dodge:** your character spins 360° out of the way, leaving glowing afterimages.
- **Rallies:** every deflect makes the ball 15% faster, up to 50 m/s.
  - Each deflect gives the ball a new color: yellow → cyan → magenta → red → white-hot.
  - A deflected ball leaves a glowing path that lingers in the air, longer as the rally grows, plus afterimages.
  - The HUD warns "RALLY ×N".
- **Timing ring:** when a ball is about to reach you, a ring shrinks around the crosshair. When it touches the crosshair, the ball arrives. Press H to turn it off.
- **Health, cash, revives:** 100 HP; at 0 you're out. Cash comes from hits, knockouts, catches, deflects and perfect timing. Pressing R revives the teammate who has been down the longest. They return with 50 HP and 2 s of invulnerability. A team's revives cost 80, then 120, 160 and so on within a round. Cash resets every round.
- **Arena size:** the court is sized for the biggest team. Each player adds width and a little length:

  | Players per team | Court size |
  | --- | --- |
  | 2 | 26 × 14 m |
  | 4 | 28 × 21 m |
  | 6 | 30 × 28 m |

  It grows as soon as someone joins and only shrinks between rounds.
- **Rounds:** each team stays on its half. The round ends when a team is wiped out; after 3 minutes, the team with more players standing wins. When everyone leaves, the match resets.

## How it works

- `server.py`: FastAPI web server and WebSocket endpoint. It runs the game at 60 Hz and sends the world to every browser 30 times a second. A slow device can't stall the game.
- `sim.py`: the rules, owned by the server (balls, hits, stamina, timing windows, revives, rounds). It's plain Python with explicit timestamps, so the tests drive it directly.
- `bots.py`: bots wander their half, throw with some aim error, and defend with imperfect timing.
- `static/`: the browser client, written in Three.js and bundled in `static/vendor`, so no internet is needed at the party.
  - Your browser moves your own player instantly, and the server keeps the movement legal.
  - The world is drawn about 0.1 s in the past, for smoothness.
  - Every button press tells the server which moment was on screen. The server judges dodge, catch and deflect timing against that moment, so a parry that looked right on your screen counts.

## Tests

```powershell
.venv\Scripts\python tests\test_sim.py
```

End-to-end browser tests (headless Chrome) are in `tests\browser\`; see its README. The full project history and technical reference is `..\PROJECT.md`.

The tests cover:

- hits and damage, and harder throws hitting harder
- throw cost, power and cooldown
- arcs that still land where you aimed
- floor and wall ricochets: one bounce per throw, refreshed by a deflect
- the court growing with players and only shrinking between rounds
- extra bots joining mid-round
- catch, deflect and dodge windows, including perfect presses, early presses and the deflect window being tighter than catch
- the rally speeding up to its cap
- late-arriving inputs, which still count if they were in time on screen
- no stamina, no defence
- aim assist and juking
- the centre line
- knockouts, revives and rounds
- bot filling
- a full bot-only match

## Known limits

- Laptop/desktop only (keyboard and mouse), no touch controls yet.
- Movement is trusted to each browser, within the court limits. That's fine for friends on a LAN, not for strangers on the internet.
- No obstacles yet, and no sound files: the effects are synthesized.
- One catch holds one ball. Against two balls arriving together, dodge instead (you can't be hit during the dash).
