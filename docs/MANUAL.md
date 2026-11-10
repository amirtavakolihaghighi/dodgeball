# Dodgeball: the manual

Schoolyard dodgeball with Souls-style stamina, in 3D in the browser. One computer runs a small
Python server. Everyone on the same Wi-Fi opens a web page and plays. The host can add bots to
either team, so you can also play and tune it alone.

The server starts in a **lobby**. The **host**, whoever plays on the computer running the server, sets up the teams, the bots and every rule of the game, then presses **Start match**. Others can join at any time; only the host can change anything.

## Run it

Double-click **`run.bat`**. The first run creates a local Python environment (`.venv`), which needs Python 3.10+ on PATH. The game opens in your browser by itself.

No Python? Download the Windows app from the [latest release](https://github.com/amirtavakolihaghighi/dodgeball/releases/latest), unzip it and double-click `Dodgeball.exe` (more under "Share it with people who don't have Python").

Or run it by hand (on Mac/Linux, use `python3` and `.venv/bin/python`):

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python server.py          # --port 8080 to pick a port, --no-browser to not open one
```

The server window shows the addresses to open:

- **This computer:** `http://localhost:8000`. If 8000 is busy it uses the next free port and says so. The browser that opens here is **the host**.
- **Other devices on the same Wi-Fi:** `http://<the 192.168.x.x address it shows>:8000`. The in-game menu (Esc) shows it too.
- **Host from another device:** the window also shows a private host link (`...?host=...`). Whoever opens it gets the host's controls. Don't share it.

When playing together on one Wi-Fi, only the host runs the game. Everyone else just opens that address in a browser.

## The lobby (for the host)

The menu (Esc) is the lobby. As the host you get:

- **Start match** and **End match**. Ending takes a second click, because it ends the match for everyone.
- **Teams:** a newcomer joins the team with fewer people; after that nothing moves anyone but you. **⇄** moves someone to the other team, and **Shuffle teams** deals everyone into random, even teams. A player who reconnects gets their team back.
  - **Names may repeat:** the game knows each player by their browser, not their name. Two players with the same name get a small **#1** and **#2** in the team lists, in the order they joined, so you can tell whose gear is whose.
- **Bots:** each team has its own **− / +** (0–12 bots each), which adds the next built-in bot (RED: Ace, Comet, Echo…; BLUE: Blitz, Dash, Flick…) or takes the last one away. Nothing adds, removes or balances them but you. Bot skill sits under Match.
  - **Your own bots:** **Add a bot…** under a team's − / + puts one of your own bots on that team (or makes a new one). On a bot's row, **⇄** moves it to the other team and **✕** takes it off.
  - **Bots & flags…** (under Match) is where you make bots with a name, and give any bot **flags**: bundles of behaviour such as *Dodge master* (defends nearly every ball, almost always by dodging, with near-perfect timing) or *Berserker* (every throw at full power, as soon as it has a ball, from the front line). A new setup has eight: Dodge master, Berserker, Sniper, Catcher, Parry king, Trickster, Rookie and Tank. Change them, add your own and delete them on the same page: **What it changes…** opens the rules a flag sets, like a player's ⚙ page, with the bots' skill numbers shown once (they apply at whatever skill the bot plays).
  - A bot can carry several flags; where they overlap, the later one wins, and the bot's own settings (⚙) win over all of them. A bot keeps its name, flags and own settings wherever it plays, and they're saved with your setup.
- **Match length:** "first to N" round wins, or endless.
- **Round time:** how long a round can last, 20 s to 15 min (3:00 by default), in steps; any other length can be set in Game rules › Rounds & match.
- **Spectate:** watch instead of playing. The others (and the bots) play on; you keep all the host controls. Mouse looks, **W A S D** fly, **Space / Shift** go up and down, **left / right click** ride behind the next / previous player. **Join a team** brings you back to the team you had. During a match both take effect from the next round.
- **Game rules…**: every number of the game, 164 of them, in 18 groups. For example: throw speeds, charge time, damage, team health, gravity, ricochets, aim assist, every dodge/catch/deflect window, stamina, movement, hitboxes, ball colours, court size, cash and revives, rounds, the bots' skill numbers and the network smoothing.
  - Each rule has a plain description, its default, and an **animated preview**. The preview runs the default next to your value in real time, using the game's own formulas: you see the throw arc higher, the timing window widen, the ball bend harder, and so on.
  - Drag, type or reset values (the ball colours have a colour picker), then press **Apply**. **Undo my edits** and **Reset all to defaults** are there too.
  - **The search** looks through every tab at once: type a few words, in any order, and every rule with all of them somewhere in its name, description or tab is listed, tab by tab. **Every tab** at the top of the list says how many match, each tab shows its own count (click it to jump there), and the words are marked. Clear the search to go back to the tabs.
- **One player's own settings (⚙):** the gear next to every person and bot opens the rules editor for just them: a beginner with more health and a wider catch window, a bot with hard skill, a different ball colour. It lists only the rules that can differ per player, each either "same as everyone" or their own value, and the preview compares the two. **All the same as everyone** clears them. A player with their own settings has an "own settings: N" tag that everyone can see, and everyone can open the gear to look (read-only).
  - What can differ per player: health, stamina, movement, throwing, the damage their throws do, aim assist, dodge/catch/deflect, the cash they earn, how a revive treats them, health regeneration, their ball colour, the network fairness settings (people) and the skill and skill numbers (bots). The court, ball flight and ricochets, body and ball sizes, rounds, revive prices, team cash and team health, and the number of bots are the same for everyone.
  - Settings go by **who** someone is, not their name: a person keeps theirs when they reload, rename themselves or come back later on the same browser, and someone who picks the same name doesn't get them. Each bot keeps its own wherever it plays. Settings saved by an older version (they went by name) go to the first person who joins with that name.
  - **Their settings as a file** (at the bottom of each ⚙ page): **Export** saves just that player's own settings in your Downloads folder, and **Import…** loads such a file onto whoever's page is open: save a "beginner" profile once and load it onto anyone.
- **Export settings / Import settings…** (under Match): Export saves every rule and each player's own settings in one `.json` file in your Downloads folder (anyone can do that). Import loads such a file and **replaces** the whole setup: rules the file leaves out go back to their defaults, only the file's players keep own settings, and its bots and flags come with it. An older `saved_rules.json` loads too.

**When changes take effect:** in the lobby, at once. Everyone can warm up and feel them; in the warm-up, knocked-out players stand back up after 2 s. During a match, from the next round. The menu and the editor mark such values "next round (now X)", and **Cancel them** drops the waiting changes.

**Saved rules:** your rules, each player's own settings, and your bots and flags are saved in `saved_rules.json` next to the app and come back the next time you start it. To pass them to another host, export a settings file (or give them `saved_rules.json`). An older version of the game can't read the new `saved_rules.json` and starts with the default rules.

Everyone else sees the same lobby read-only: the teams, the bots, the settings, and the rules with their previews. They also see **what you're doing**, live: a line says which menu or rule you're on and any value you've changed but not applied yet ("Ricochets › Curve kept after a bounce 0.50× → 0.30× (not applied yet)"). With **Follow the host** ticked (the default), their own rules editor opens on the same page and highlights the rule you're on.

## Share it with people who don't have Python

Every [release](https://github.com/amirtavakolihaghighi/dodgeball/releases) has the Windows app ready-made: `Dodgeball-windows.zip`, built by GitHub Actions from that version's code, with its SHA-256 checksum. To build it yourself, double-click **`build_exe.bat`** (after running `run.bat` once). It builds **`dist\Dodgeball-windows.zip`**, about 19 MB. Send that zip: your friends unzip it and double-click `Dodgeball.exe`. No Python needed.

- Windows may say "Windows protected your PC", because the app isn't signed by a publisher: click **More info**, then **Run anyway**.
- Closing the app's window stops the game server.
- Rebuild after changing the code or `config.py`; the defaults are baked into the app. Rules the host sets in the lobby aren't baked in: they're saved in `saved_rules.json` next to `Dodgeball.exe`.
- It's Windows-only. Friends on a Mac need Python and the manual steps above.

If you share this source folder instead, leave out `.venv`, `build` and `dist`. They're made on your computer and are big. A copied `.venv` won't work elsewhere, but `run.bat` notices and rebuilds it.

If other devices can't connect, it's almost always Windows Firewall. **Don't turn the firewall off.** Instead, on the host's computer, either:

- double-click **`Allow friends to connect.bat`** (next to `Dodgeball.exe`, or in the project folder) once. It asks for administrator permission, then lets computers on your local network (never the internet) reach the game's ports 8000–8019, whether Windows calls the Wi-Fi Public or Private, and removes the old "block" rules Windows made when its "allow access" prompt was answered for private networks only. `Allow friends to connect.bat check` shows what it would do; `... undo` removes the rule; or
- set the Wi-Fi network to **Private** in Windows settings, and allow the app when Windows asks.

## Testing alone

- **Bots:** by default RED gets 1 and BLUE 2. Set each team's count (0–12) and the skill (easy/normal/hard) in the lobby. In the lobby that happens at once; during a match, from the next round.
- **Several players on one PC:** open more tabs or windows and join each with a different name. Move them between teams in the lobby. Two browser windows side by side work best, because background tabs stop drawing. The tab title shows who is who, and only the focused tab plays sound.
- **Every tab on the host's PC is a host.** To see what other players see, add `?guest` to the address, for example `http://localhost:8000/?guest`.
- **Simulate bad Wi-Fi:** add `?lag=120` to the URL for a 120 ms round trip. Timing stays fair up to about 150 ms; beyond that, presses start counting late. Add `&jitter=150` for uneven delay of up to 150 ms more, which is what makes the picture freeze and jump.

## Logs, for finding lag

Every session writes a diagnostics log, so lag can be traced to its cause instead of guessed.

- **The server** writes its own numbers into a `logs` folder next to the app, one folder per run:
  - its timing, including any moment it stalled;
  - the host computer's CPU, memory, power, Wi-Fi signal, network adapters (VPNs) and whether the console window was clicked into;
  - each player's connection as it arrives (input gaps, how far behind their screen runs);
  - presses that arrived after the ball had already hit, and presses that arrived past the lag compensation limit (they count a little later than they were made).
- **Every browser** keeps its own log and sends it to the host's computer every few seconds. Nobody has to collect anything from the other PCs. It contains:
  - frame rate and hitches, and how late world updates arrive;
  - how long the picture of the others stood frozen, and the ping;
  - the graphics card, CPU cores and screen;
  - how long the game took to load, and how much it downloaded.
- **Batteries:** only the host's own browser can say whether its laptop runs on battery. Browsers tell that only to secure pages, and the others open the game as a plain `http://` address. So when a laptop is slow, ask its player whether it was on battery saver.
- **Press L** in the game the moment something feels laggy. The log marks it, so the numbers around that moment can be read later.
- **After the session** the host opens the menu (Esc) and clicks **Download all logs (zip)**, then sends that zip. If someone's connection dropped, they can click **Save my log** to keep their own copy (it goes to their Downloads folder).
- **What's in it:** player names, LAN addresses, device details (browser, graphics card, CPU cores, screen) and performance numbers. Nothing else.
- **Housekeeping:** the 30 newest sessions are kept. `--no-log` turns logging off.

To read a session: `python tools\log_report.py <the zip or a session folder>`. It prints:

- the host computer's state and the server's stalls;
- a table of every player: frame rate, frozen time, late updates, ping, input gaps while playing, late presses, presses made while still recovering (the first seconds after joining and loading are left out: the game stutters while it builds the hall and the players);
- how long each browser took to load;
- what the press grace, sidestep compensation and the lag compensation limit did, and the hits that came just after a press or a defence (too early, second ball);
- for each frozen picture, whose it was: the host's (several players froze together), the player's own computer (it stalled meanwhile) or their Wi-Fi;
- freezes several players shared, which point at the host;
- the numbers just before every L (pressing it several times in a row counts once);
- when Auto graphics changed a player's level and why, and players whose browser held their key presses for a while (a busy computer).

## The players

- **Every player is an athlete** in their team's kit: red or blue shirt with white trims, navy shorts with stripes in the team's colour, white socks and shoes.
- **Two versions:** a sports helmet with a dark visor, or a face with hair. Each player gets one when they join, with one of six skin, hair and eye colours, and everyone sees them the same.
- **They move like athletes,** with real motion from free (public domain) animation libraries, and moves made for the game:
  - they run as fast as you go, legs towards where you're running while the chest keeps facing your aim; backwards, they backpedal;
  - during play they stand in a boxer's guard; holding a ball, they carry it in the right hand, in front of the hip.
- **Throws** come in three kinds, at random: overhead, side-arm at the stomach's height (the arm reaching further out as you charge), or underarm like bowling. While you charge, the left forearm covers the face.
- **Deflects** are a backhand parry with the left hand, swinging out to the left. **Catches** are one-handed: the left arm shoots out, palm forward, then pulls the ball in to the right hand.
- **Dodges:** sideways, a quick side step (the far foot pushes, the near foot lands); forwards, a half-crouched lunge; backwards, a jump back. Every dash leaves a faint trail of afterimages (not on Low graphics).
- **Perfect dodges:** a corkscrew, an aerial side flip or a butterfly twist, picked at random (everyone sees the same one), with afterimages; going backwards, a backflip.
- **Hits** make them flinch. **Knockouts** throw them down, away from the ball, harder the faster it came. **Revived**, they get up from the floor. **At a round's end** the winners celebrate and the losers kneel.
- **Low graphics** draw lighter versions (about a third of the detail).
- **Until they have loaded** (a moment at start), the stick figures of before stand in. The join screen and the line under the score bar say the game is still loading, so nobody takes it for broken; you can join and play meanwhile.

## The hall

- **You play in a sports hall** with tall windows, a low golden sun and a crowd in the stands. Its sunlight was worked out once, in advance, so drawing it costs laptops very little.
- **The court is painted on the hall's wooden floor**, in the team colours, and the hall stays the same whatever the court's size. A court too big for it (the host's settings) makes the whole hall bigger.
- **The crowd** sways, and jumps when a round ends or someone is knocked out.
- **Long shadows:** the sun is low, so players and balls cast long shadows away from it, wherever its light falls on the floor.
- **Walls never hide you:** back up to your end wall, or stand at a side and turn, and the camera ends up behind a wall or in the stands. They then fade until you can see through them, with a faint outline showing where the wall is, and come back when you step away.
- **Until the hall has loaded** (a second or two), or if it can't load, the game draws the plain dark court of before.

## Graphics

Each player picks their own in the menu (Esc), under **Your settings › Graphics**:

| Setting | What it draws |
| --- | --- |
| **Auto** (the default) | Starts at High and lowers itself when the game gets choppy |
| **High** | The sharpest picture and every effect |
| **Medium** | A softer picture (3/4 of the sharpness) and every effect |
| **Low** | A soft picture (half the sharpness) and fewer decorative effects: no afterimages after a perfect dodge, half as many behind deflected balls, a third of the crowd (standing still), no shafts of sunlight |

- **Auto** steps down a level when the frame rate stays under 45 a second for 3 seconds.
  - A step that doesn't help is followed by one more (Low halves the sharpness). If even that doesn't help, Auto goes back and leaves things alone: the game is held back by something else, like battery saver or a busy computer, and a softer picture wouldn't help.
  - After 20 smooth seconds it tries a level up again, only in the lobby (never during a match: a level that copes between rounds can fail in the next round) and at most twice a session, and never a level it already had to leave.
  - It judges nothing while the game is still loading: the picture stutters then whatever the level.
  - On the host's computer, which also runs the server, Auto stays at Medium or lower. Pick High there to override it.
- **The top-right corner** shows the level next to the frame rate, for example "1 ms · 60 fps · Medium". Low softens only the 3D picture: names, bars and the crosshair stay sharp.
- **Nothing that matters for play changes** with the setting: the balls, their trails, the timing ring and the throw preview look the same on every level, so a low setting is never a disadvantage.
- **Without the graphics card:** when the browser draws the game in software, the game runs at about 19 frames a second. The join screen and the menu then show a warning. The fix: in Chrome or Edge, open Settings › System, switch on "Use graphics acceleration when available", and restart the browser. Auto starts at Low there meanwhile.
- **Presses are timed from the key itself.** A slow laptop can handle a key press up to a frame late (50 ms at 20 frames a second), but the server is told when the key really went down.
- **Every effect is prepared while the game loads,** so nothing freezes the picture the first time it appears in a match.

## How impacts feel

- **A hit player freezes for a split second** (longer for a knockout) and shudders, flashing white, then flinches. Only their figure stops: the balls and everyone else keep moving.
- **Specks of light** fly from hits (white and the player's team colour), catches, deflects, ricochets and perfect dodges; perfect plays throw sparkles. Low graphics throw half as many.
- **Each impact has its own flash:** a white starburst and a shockwave ring in the team's colour on a hit, a swipe on a deflect, a six-point flare on someone's perfect catch, and a puff of dust where a ball bounces off the floor.
- **The ball** is grippy rubber with a bright edge in its colour, so you can pick it out against the colourful hall.
- **Balls stretch along their flight when they're fast** (up to 30% longer) and spin; their seams show the spin.
- **The camera** shakes when you're hit (harder for a knockout) and when a ball ricochets near you. It jolts when you throw (harder throws kick more), catch or deflect, punches in on a perfect press and on your own hits, and zooms in a little while you charge a throw.
- **Esc › Your settings › Screen shake** scales all of that camera motion; all the way left turns it off. It only moves the picture: your aim, the crosshair's target and the timing ring never move with it.

## Sound

- **Recorded sounds,** each with several takes and a little variation every time: a ball's thump and a body's smack on a hit, a slap on a catch, a crisp punch on a deflect (higher as the rally grows), and bounces off the floor and the walls.
- **Your dodge** whooshes the moment you press it, and your feet land hard as the dash ends. You hear other players' dashes when they dodge a ball.
- **Players have voices:** a grunt when hit, a cry and a fall when knocked out. Each player keeps one of four voices.
- **You pant when you're out of breath** (under about a third of your stamina), harder the more tired you are.
- **A revive is heard by everyone:** a grand entrance for that player's team, a sound of danger for the other team.
- **From where they happen:** sounds come from their side and get quieter far away, with the echo of a sports hall. Your own throw landing stays loud wherever it lands.
- **The rounds:** the announcer names the round, a whistle and "Fight!" start it, and a long whistle and the crowd end it. At the end of a match the announcer says "You win" or "You lose".
- **Music:** one tune in the lobby, and a faster version in the background during a match, quieter still while a round is played.
- **A ball coming at you** (under a second away) whooshes from its side, loudest as it arrives: that's the moment to press. **Esc › Your settings › Incoming-ball sound** can make it a short tick instead, or turn it off.
- **Esc › Your settings** has a volume for each kind: Volume (all of it), Music, Effects (including voices and breathing), Announcer, Interface (the incoming-ball sound, the countdown, the perfect chime and "not now") and Crowd. All the way left turns a kind off.
- **Hear every sound** (the link under the sliders) opens a page that plays every moment of the game and every recording, with your volumes. "Back to the game" closes it.
- **See every move** (under it) opens a page that plays every move of the players: running, throws, catches, deflects, dodges, knockouts, getting up, a round's end. Loop one, slow it down, step a frame at a time (← →), turn the camera round it (drag; the wheel zooms), and see the time of every moment on the timeline. "Copy a link to this moment" gives an address that opens that exact frame again. It's mainly for judging and fixing the animations (`docs/ANIMATIONS.md`).
  - **Edit this move** (top right of the move's box) changes the moves made by hand: the guard, holding the ball, the catch, the parry, the side-arm and underarm throws, the dashes. The list marks them "✎ edit"; on the other moves the button is greyed out. Drag the arrows on the athlete to move a hand, a foot or the hips; "Turn the hand" shows rings; drag an elbow's or knee's ball to say where it points. The timeline gets a row of key moments for each part: drag one to make it sooner or later, double-click a row to add one. Undo with Ctrl+Z.
  - **Save** works only in a browser on the computer the game runs on, when it runs from its source folder (run.bat), not the app. The game plays the change from its next start (reload its tab). Each save keeps the file it replaces in the `move_saves` folder; unsaved changes stay in the browser and are offered back the next time.
- **Only the focused tab or window makes sound,** so several test tabs on one computer don't all play at once.
- **If you hear only simple beeps and tones,** the recordings didn't load. The game then uses its old synthesized sounds, and the session log notes it.

## Controls

| Input | Action |
| --- | --- |
| WASD, Mouse | move, aim (over-the-shoulder camera, crosshair is the aim) |
| Hold / release left mouse | charge / throw. Longer = faster ball, more stamina |
| Space or Shift | **dodge**: a dash you can't be hit during |
| Right mouse or F | **catch**: the ball becomes yours, so you can throw right away |
| E | **deflect**: tighter timing, returns the ball instantly and faster |
| R | revive a fallen teammate (costs cash); with team health on, buy health for your team's bar |
| Tab / H / Esc | scoreboard / toggle timing ring / the lobby menu |
| L | something feels laggy right now: marks the moment in the log |
| Spectating (host) | mouse look, W A S D fly, Space / Shift up / down, left / right click follow the next / previous player |

## Rules

These are the **defaults** (they live in `config.py`). The host can change every one of them in the lobby.

- **Throwing:** holding longer throws faster, and **speed is what deals damage**.
  - A quick tap is 12 m/s for 6 stamina and does about 15 damage.
  - A full 0.9 s charge is 34 m/s for 34 stamina and does about 45 damage. Rally balls can reach 60.
  - Low stamina caps how hard you can throw.
  - While charging, the throw box shows the speed, expected damage and stamina cost.
  - A new ball appears 1.6 s after each throw.
- **Arcs:** balls follow a gentle gravity arc. Quick taps lob visibly, full-power throws fly almost flat. The ball still lands exactly where your crosshair points, and a dotted line previews the arc while you charge.
- **Aim assist:** if an enemy is within 10° of your crosshair, the ball bends gently toward them. That fixes small aim errors, but a slow ball can still be juked. The gold diamond shows who it would bend toward.
  - **The slower the ball, the less it curves:** over the same distance a quick tap bends half as much as a full-power throw ("Slow-ball curve" 0.5).
- **Ricochets:** a ball that hits the floor or a side wall bounces once and loses some speed (so it hits softer). It then curves toward the nearest enemy ahead of it, but only half as hard as a ball that never bounced ("Curve kept after a bounce" 0.5): a bank shot is about the angle, not homing.
  - Aim at the floor in front of someone, or at the side glass, for a bank shot. The preview shows the bounce point.
  - The second contact ends the ball, and the team-colored end walls always stop it.
  - Bots use bank shots too.
- **Defence:** press just before the ball arrives. Each action has a window. Arriving in its first fraction ("the last moment") is **perfect**: it refunds most of the stamina and pays extra cash. Pressing too early wastes the stamina, and there's a short recovery, so mashing is punished. A press during that recovery does nothing, and the game says **"Still recovering"** so you know why.
  - **When a ball gets through anyway, the hit says why.** **TOO EARLY (0.05 s)**: your dodge, catch or deflect had ended that long before the ball reached you. **SECOND BALL**: you had just stopped another ball. A catch or a deflect stops one ball, so a second one right behind it still hits; a dodge covers every ball during its dash, so dodge through volleys.
  - **Fairness on Wi-Fi** (Game rules › Network, each with its own explanation): your screen shows the world 0.10 s in the past to stay smooth; presses are judged against what your screen showed, up to the **lag compensation limit** (0.25 s; keep it at least 0.1 s above the view delay, or presses on uneven Wi-Fi count a little late), plus 0.02 s of **press grace** (your screen is drawn a moment before your finger moves); with **sidestep compensation** on, stepping out of a ball's way also counts by your screen ("SIDESTEPPED"); and **Lockout after a missed press** sets how long you wait before pressing again (0 = press again at once).

  | Action | Stamina (perfect) | Window | Perfect zone |
  | --- | --- | --- | --- |
  | Dodge | 25 (10) | 0.32 s | 0.12 s |
  | Catch | 20 (8) | 0.30 s | 0.10 s |
  | Deflect | 30 (12) | 0.18 s | 0.06 s |

- **Perfect dodge:** your character spins 360° out of the way, leaving glowing afterimages.
- **Rallies:** every deflect makes the ball 15% faster, up to 50 m/s.
  - **Ball colours:** a ball shows its thrower's colour: RED's people throw orange balls and RED's bots peach ones; BLUE's people royal blue and BLUE's bots periwinkle (all four are rules, under Game rules › Ball colours, and a player can have their own). The ball in a player's hand has the same colour.
  - Each deflect gives the ball a new colour: cyan → magenta → red → white-hot.
  - A deflected ball leaves a glowing path that lingers in the air, longer as the rally grows, plus afterimages.
  - The HUD warns "RALLY ×N".
- **Timing ring:** when a ball is about to reach you, a ring shrinks around the crosshair. When it touches the crosshair, the ball arrives. Press H to turn it off.
- **Health, cash, revives:** 100 HP; at 0 you're out. Cash comes from hits, knockouts, catches, deflects and perfect timing. Pressing R revives the teammate who has been down the longest. They return with 50 HP and 2 s of invulnerability. A team's revives cost 80, then 120, 160 and so on within a round; prices start over every round.
  - **Cash resets every round** by default. Turn "Cash resets each round" off (Game rules › Cash & revives) to keep it from round to round; a new match always starts at 0.
  - **Shared team cash** (off by default): everything anyone earns goes into one pot per team, and anyone on the team can spend it on revives.
- **Health regeneration** (off by default, Game rules › Damage & health): health comes back by itself, 2 a second by default, once nobody has hit you for 4 s, and every hit starts that pause again. It stops at a limit: half your full health by default, or a fixed amount if the host picks that. It never takes health away. A white marker on your health bar shows where it stops. A player can have their own (a beginner regenerating faster, say).
  - **Standing still** (2 s by default) makes it faster: +4 a second by default, or a percentage faster if the host picks that. The host can also make standing still *needed* (no regeneration while moving) or make it not matter. Standing still means not walking: turning, throwing, catching and deflecting are fine, and a dodge's dash doesn't count as moving, even with a direction held, as long as you let go of the key before the dash ends (keep holding it and you're walking from the moment the dash ends). A line under your bars says "Stand still to regenerate faster", then "Standing still: regenerating faster" once it counts.
  - Hurt bots stand still to regenerate too, which makes them easier to hit (Game rules › Bots, "Bots stand still to regenerate").
- **Team health** (off by default, Game rules › Team health): each team shares **one health bar**, shown under its score at the top. Every hit on anyone drains it, nobody is knocked out alone, and when it's empty the whole team falls at once and loses the round. There are no revives; **R spends cash on health for the bar** instead.
  - **Bar size:** everyone's health added up (the default: 3 players with 100 health = 300; someone joining mid-round brings their share, and someone leaving takes their share of what's left), or a fixed size for every team (300 by default).
  - **What R buys:** a pack per press (the default: +50 health for 80 cash, then 120, 160… within a round; prices start over every round), or all your cash at 0.5 health per cash, never more than the bar is missing. Bots buy health too.
  - When time runs out, the team with more of its bar left wins the round. In the warm-up a team that falls stands back up after 2 s with a full bar.
  - **Bar regeneration** (off by default): the bar fills back up by itself, 5 a second by default, once nobody on the team has been hit for 4 s, up to half the bar (or a fixed amount). The markers on the team bars show where it stops. Each teammate standing still (2 s) makes it faster, +4 a second each by default (or a percentage each); the host can make standing still needed or not matter, as for players' own.
- **Arena size:** the court is sized for the biggest team. Each player adds width and a little length:

  | Players per team | Court size |
  | --- | --- |
  | 2 | 26 × 14 m |
  | 4 | 28 × 21 m |
  | 6 | 30 × 28 m |

  It grows as soon as someone joins and only shrinks between rounds.
- **Rounds:**
  - Each team stays on its half.
  - A round ends when a team is wiped out. After 3 minutes, the team with more players standing wins it (with team health: the one with more of its bar left).
  - The match goes on round after round until a team reaches the match length (endless by default) or the host ends it. Then everyone is back in the lobby.
  - When everyone leaves, the score resets; the host's rules stay.

## How it works

- `server.py`: FastAPI web server and WebSocket endpoint. It runs the game at 60 Hz and sends the world to every browser 30 times a second. A slow device can't stall the game. It also decides who the host is, sends rule changes to everyone, and saves the host's rules.
- `sim.py`: the game, owned by the server (balls, hits, stamina, timing windows, revives, rounds, the lobby and the host's actions). It's plain Python with explicit timestamps, so the tests drive it directly.
- `rules.py`: every rule the host can change, with its name, description, allowed range and preview. `config.py` holds the defaults.
- `bots.py`: bots wander their half, throw with some aim error, and defend with imperfect timing.
- `static/`: the browser client, written in Three.js and bundled in `static/vendor`, so no internet is needed at the party.
  - Your browser moves your own player instantly, and the server keeps the movement legal.
  - The world is drawn about 0.1 s in the past, for smoothness.
  - Every button press tells the server which moment was on screen when the key went down. The server judges dodge, catch and deflect timing against that moment, so a parry that looked right on your screen counts.

## Tests

```powershell
.venv\Scripts\python tests\test_sim.py       # 76 rule tests
.venv\Scripts\python tests\test_server.py    # 12 server tests: real WebSockets, players' own settings, the host's screen, the session logs, the log report, the moves page
```

End-to-end browser tests (headless Chrome) are in `tests\browser\`; see its README. The full project history and technical reference is [PROJECT.md](PROJECT.md).

The tests cover:

- hits and damage, and harder throws hitting harder
- throw cost, power and cooldown
- arcs that still land where you aimed
- floor and wall ricochets: one bounce per throw, refreshed by a deflect
- slow balls curving less, and a bounce taking curve away
- the press grace, sidestep compensation, and the adjustable lockout after a missed press
- the court growing with players and only shrinking between rounds
- catch, deflect and dodge windows, including perfect presses, early presses and the deflect window being tighter than catch
- why a hit got through: a press that ended too early (and by how much), or a second ball right after a defence
- two balls waiting on one press: the catch meets the one that reached the player first, and the other is the second ball
- the rally speeding up to its cap
- late-arriving inputs, which still count if they were in time on screen
- no stamina, no defence
- aim assist and juking
- the centre line
- knockouts, revives and rounds
- each team's bots: set by the host, never balanced by people joining or leaving
- a full bot-only match
- the host spectating, and coming back to their own team; shared team cash; cash carrying over while revive prices start over
- health regeneration: the pause after a hit, the speed, both kinds of limit, never taking health away, a player's own regeneration, and the team bar's own (paused by a hit on anyone on the team)
- standing still: faster by extra health or a percentage, or needed; walking (even creeping) starting it over; a dodge's dash not counting unless the key is held on after it; each teammate standing still adding to the team bar; hurt bots standing still (and not with the setting off)
- team health: one bar that the whole team falls with, its size (added up, or fixed; people joining and leaving), buying health with a pack or all your cash, the time limit going to more of the bar left, and bots playing it
- each player's own settings: only the host sets them, they change how that player throws, defends and is hit, they wait for the next round during a match, they stay with a reconnecting player, and each bot keeps its name and settings and plays by its own profile
- who a player is: two players with the same name keep their own settings apart, settings saved by name go to the first person with that name, a second tab is someone else, a reconnecting tab takes over, and renaming keeps everything else
- the host's own bots and flags: making them, flags lying under a bot's own settings at its own skill, moving bots between teams, taking them off and back, and files keeping them
- settings files: an import replaces the whole setup (or one player's settings); bad values and unknown rules are ignored
- the ball colours as rules
- the lobby: only the host starts, ends, moves players or changes rules; lobby changes apply at once and match changes from the next round; a reconnecting player keeps their team; "first to N" ends the match
- the rules: bad values are rejected or clamped, every listed rule is really used by the game, and 20 matches with random rule values run without errors
- the host's screen reaching everyone else (and only the host's)
- the logs: the server and a browser's log end up in the host's zip, without duplicates, in whatever order a browser's pieces arrive
- the logs' detectors: server stalls, presses that arrived after the hit (the press grace included) or past the lag compensation limit, and console prints held up by a click
- the log report: it blames a freeze during a server stall on the host, a player's own freezes on their connection or on their computer stalling, and gives each lag mark the right cause; it keeps a browser whose clock is minutes off, leaves out pages from earlier sessions, joining and loading, shows renamed players under their new name, and counts L pressed several times in a row once

## Known limits

- Laptop/desktop only (keyboard and mouse), no touch controls yet.
- Movement is trusted to each browser, within the court limits. That's fine for friends on a LAN, not for strangers on the internet.
- No obstacles yet.
- One catch holds one ball. Against two balls arriving together, dodge instead (you can't be hit during the dash).
- Players' own settings follow their browser: someone on another computer, another browser or a private window is new to the game, and needs their settings given again.
- Uneven teams stay uneven: a team of 2 bots loses nearly every round to a team of 4, and team health with a fixed bar size hardly changes that (the bigger team throws twice as many balls).
