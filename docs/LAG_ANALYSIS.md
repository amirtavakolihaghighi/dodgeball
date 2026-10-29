# Lag analysis: why some players lagged, and what we could do

**Status:** discussion draft for development cycle 2, written 2026-10-22, updated 2026-10-27 with the logs of three office sessions.

- **Built so far:** step A1, measuring first, as **session logs** (see [Update: your answers, and the logs](#update-your-answers-and-the-logs)); after the logs, slower balls and bounced balls curve less, and a press during a recovery says "Still recovering"; and then the five suggestions below, as settings under Game rules › Network (see [Applied as settings](#applied-as-settings-2026-10-27)).
- **What the logs showed** is in [Update 2: what three office sessions showed](#update-2-what-three-office-sessions-showed). The remaining game-side fixes wait for the user's decision.

**Evidence:** measured on the v1.0.0 code on the host PC (Windows 10, Python 3.14). The server ran with simulated players over real WebSockets, and the browser client ran in headless Chrome.

## Contents

- [Short version](#short-version)
- [What was measured](#what-was-measured)
- [How delay shows up in this game](#how-delay-shows-up-in-this-game)
- [1. Improvements that would reduce lag](#1-improvements-that-would-reduce-lag)
- [2. What each kind of shortage does](#2-what-each-kind-of-shortage-does)
- [3. Hotspot vs everyone on the office Wi-Fi](#3-hotspot-vs-everyone-on-the-office-wi-fi)
- [Proposed plan, for discussion](#proposed-plan-for-discussion)
- [Questions that would sharpen the plan](#questions-that-would-sharpen-the-plan)
- [Update: your answers, and the logs](#update-your-answers-and-the-logs)
- [Update 2: what three office sessions showed](#update-2-what-three-office-sessions-showed)

## Short version

- **The server is not the bottleneck.**
  - With 8 players it uses about 3% of one CPU core and about 60 MB of RAM.
  - It sends each player about 35 kbit/s.
  - In every test it sent each snapshot on time. The longest gap was 39 ms; the target is 33 ms.
- **So the lag almost certainly came from one of three places:**
  1. the laggy players' **Wi-Fi link**: delay spikes, short stalls, power saving;
  2. their **laptop drawing slowly**: Chrome without GPU acceleration, battery saver, a busy machine;
  3. something **pausing the host's server for a moment**. The prime suspect is a click inside the server's console window.
- **The client has very little tolerance for uneven Wi-Fi.**
  - A snapshot may arrive at most about 50–80 ms later than the fastest one so far.
  - Beyond that, other players and every ball freeze in mid-air, then jump forward.
  - Balls are never predicted forward, even though their flight is plain physics.
- **Order of attack:**
  1. Measure who lags and why, with a per-player network/FPS readout.
  2. Apply the cheap smoothing fixes.
  3. Use gameplay changes (wider windows, slower balls) as the last lever. The new lobby rules editor lets us try them live during a session, without rebuilding.

## What was measured

| What | Result |
| --- | --- |
| Server simulation cost, 8v8 bots (bots cost more than humans) | 0.19 ms per tick on average, 1.2 ms worst, so **1.4% of one core** |
| Live server, 8 simulated players over WebSockets | **3.0%** of one core; 4.6% with 12 players |
| Server memory | 52 MB idle, 57–65 MB under load |
| Snapshot size, 4v4 | ~0.9 KB of JSON, **~150 bytes on the wire** (compression is negotiated), so ~35 kbit/s per player |
| Snapshot size, 8v8 | ~1.8 KB, ~290 bytes on the wire, so ~70 kbit/s per player |
| Snapshot timing from the server (8 and 12 players, 30 s each) | every 33.3 ms on average, worst gap 39 ms, **0 of ~16,000 late** by more than 50 ms |
| A player whose connection stalls for 2 s | nothing is lost, but it then receives **59 two-second-old snapshots in one burst** |
| Rendering, 4v4 (Chrome) | 150 draw calls, 22,000 triangles, 1.7 ms of JavaScript per frame: light |
| Rendering when Chrome can't use the GPU (software, 1280×720) | **~19 fps** |
| TCP small-packet delays (Nagle) | not an issue: Python's asyncio turns them off |
| Console QuickEdit on the host | **on** (the Windows default) |
| Address lookup on every join (runs on the game thread) | 0.2–6 ms here |

The measurement scripts live in the session scratchpad, not the repo; they're easy to recreate on request.

## How delay shows up in this game

**How each part reaches the screen:**

- **Your own movement and camera** run in your own browser, so they never lag unless your FPS drops.
- **Everything else** (other players, balls) is drawn 80 ms in the past (`INTERP_DELAY`), blended between two server snapshots. Snapshots arrive 30 times a second.
- **Your dodge/catch/deflect presses** are judged by the server against what your screen showed, up to 0.25 s back (`MAX_LAG_COMP`).
- **Your throw:** the arm animation is instant, but the ball appears only after a round trip to the server. That's about 0.1 s on good Wi-Fi and more on bad.

**What breaks under bad conditions:**

- **Freeze-jumps.** A snapshot may be late by at most 47–80 ms (the 80 ms delay minus up to 33 ms between snapshots). Beyond that, the browser has nothing newer to draw: players and balls stop, then jump.
- **Held-up packets.** WebSockets run over TCP, so one lost packet holds up everything behind it until it's resent, typically 0.1–0.3 s on Wi-Fi.
- **Late presses.** If your screen runs more than 0.25 s behind the server, your presses count late: "I pressed in time and still got hit."
- **A slow device makes itself look laggy to others.** If your browser sends its position in bursts (a bad uplink or a stalling laptop), everyone else sees you stutter or teleport.
- **Hanging balls.** When a ball touches a laggy player, the server holds it at the contact point for up to ~0.28 s, waiting for a late press. Everyone else sees the ball hang on that player.
- **Bursts after a stall.**
  - Old snapshots arrive all at once.
  - Events (hits, catches) more than 1 s old are skipped by the browser, so some popups and sounds go missing.
  - In theory a slow link could also lose events: the server drops the oldest queued message when its 8-message queue fills. In practice the operating system buffers so much that this queue barely ever fills. Data arrives late rather than being lost.

## 1. Improvements that would reduce lag

Effort: **S** = hours, **M** = about a day, **L** = days.

### A. Find out who lags and why (do this first)

| # | Change | Effort | What it buys |
| --- | --- | --- | --- |
| A1 | **Per-player network and FPS readout** for the host: ping, jitter, stalls in the last minute, FPS, GPU or software drawing. Shown in the Tab scoreboard and the lobby, and logged to the server console when a player leaves | S–M | The next office session gives hard data instead of "it felt laggy". Today the top-right corner shows only your own ping and fps; asking coworkers to read those out is a zero-effort start |

### B. Smooth the network path (no gameplay change)

| # | Change | Effort | What it buys |
| --- | --- | --- | --- |
| B1 | **Adaptive interpolation delay.** Each browser measures how unevenly its snapshots arrive and draws a bit further in the past on jittery Wi-Fi: 60–200 ms instead of a fixed 80. Raise `MAX_LAG_COMP` to ~0.35 s with it | M | Smooth motion instead of freeze-jumps for exactly the players who lag. Lag compensation keeps timing fair. **The biggest single win for "some players lag"** |
| B2 | **Predict through gaps.** When the newest snapshot is used up, keep balls flying along their arcs and keep players moving with their last velocity for ~0.15 s, instead of freezing | S–M | Short hiccups become invisible |
| B3 | **Send only the newest snapshot.** Write to a player only when their connection has caught up, and carry events separately so none are ever lost | S–M | After a stall the browser jumps straight to the present instead of chewing through a backlog |
| B4 | **Timestamp presses with the key event's own time** (`event.timeStamp`) rather than when the frame got around to handling it | S | Removes up to one frame of unfairness: 50 ms on a 20 fps laptop |
| B5 | **Show your own throw instantly.** Your ball leaves your hand at once, and the server's ball takes over when it arrives | M | Throws feel instant even on bad Wi-Fi |
| B6 | **Fewer packets.** Wi-Fi pays per packet, not per byte. Send inputs at 20 Hz, or only when something changed. Send names and stats only when they change; today they're ~25% of every snapshot | S | Less airtime on a crowded office channel. A modest gain |

### C. Host fixes

| # | Change | Effort | What it buys |
| --- | --- | --- | --- |
| C1 | **Make the server window click-proof.** Turn off console QuickEdit at startup, and print from a background thread instead of the game loop | S | See below |
| C2 | Work out join addresses once at startup instead of on every join (a hostname lookup on the game thread). Also hide useless addresses: link-local `169.254.x`, VPN adapters | S | Removes a possible hiccup on joins. Today the join list on this PC shows 3 addresses, and only the 192.168.x.x one is reachable by others |
| C3 | **Host setup:** plugged in, on Ethernet if possible, power plan on High performance, no extra test tabs during a session. Turn off VPN/proxy tools during sessions; the host PC had two such tools, and they can route even local traffic through themselves | none | Removes host-side causes that hit everyone at once |

**Why C1 matters:**

- Clicking inside the server window starts a text selection.
- While a selection is active, Windows pauses the program the next time it prints. The server prints whenever someone joins or leaves.
- The whole game runs on that one thread, so **every player freezes until the host presses Esc** in that window.

### D. Rendering on players' laptops

| # | Change | Effort | What it buys |
| --- | --- | --- | --- |
| D1 | **Graphics option:** render scale 50–100%, antialiasing on or off, fewer effects. Scale down automatically when FPS stays under ~45 | S | Weak or high-resolution laptops get a steady frame rate. The game renders at up to 1.5× the page resolution with antialiasing, which is 2880×1620 on a QHD/4K laptop |
| D2 | **Warn when Chrome draws without the GPU:** "Turn on hardware acceleration in Chrome settings" | S | Measured at ~19 fps in that mode; one line of advice fixes it |
| D3 | Reuse effect objects. Afterimages and bursts currently create new materials each time | S | Less garbage-collection stutter. Low priority |

### E. Gameplay and mechanics changes that make delay matter less

These change how the game feels. With the new lobby rules editor, they can be tried live during a session and kept only if they feel better.

| # | Change | What it buys | Cost |
| --- | --- | --- | --- |
| E1 | **Slower top speeds:** full throw 34 → ~28 m/s, rally cap 50 → ~40 | A full throw crosses 14 m in ~0.4 s today. After 0.1–0.2 s of network and screen delay, a laggy player has almost nothing left | Less explosive throws |
| E2 | **Wider timing windows and perfect zones:** catch 0.30 → ~0.36 s, deflect 0.18 → ~0.22 s | Fewer "I pressed!" moments | Less skill expression |
| E3 | **More lag compensation:** `MAX_LAG_COMP` 0.25 → 0.35 s | Fairer for the laggy player | Others see balls hang on that player a little longer |
| E4 | **Bigger catch reach / hit radius** | Forgiving when positions disagree slightly | Easier catches and hits overall |
| E5 | **Gentler ricochet curve:** `RICOCHET_TURN_RATE_DEG` 150 → ~100 | Ricochets are the least reactable balls, and the worst under lag | Fewer surprise ricochet hits |
| E6 | **A release tell:** the ball leaves the hand ~0.1 s after release, and the animation plays first on every screen | A cue before every throw | Throws feel less snappy. Probably not worth it |

### F. Big changes not recommended now

- **UDP-style transport (WebRTC data channels).** It would remove TCP's hold-ups on packet loss, but it needs a heavy Python library and connection setup. That's a lot of work for a LAN game; revisit only if B doesn't fix the stutter.
- **Server-side rewind of player positions** (shooter-style lag compensation). Our throws are slow, visible physical balls with aim assist, so it isn't needed.
- **A faster server language or more server threads.** The server uses 3% of one core.

## 2. What each kind of shortage does

### On the host computer (affects everyone)

| Shortage | What players notice | How to recognize it |
| --- | --- | --- |
| **CPU starved** (busy apps, the host playing in several tabs, a laptop throttled on battery) | Snapshots leave unevenly, so **everyone sees the same freeze-jumps at the same moment**. Bots react late | Everyone complains at once. It takes a lot: the server needs ~3% of one core for 8 players |
| **RAM short** (Windows moves the server to disk) | Rare but brutal: **0.2–2 s freezes for everyone**, often when the host switches apps | Disk light busy, host PC sluggish. The server itself needs only ~60 MB |
| **Process paused** (a click in the console window, see C1; sleep; a debugger) | **Complete freeze for everyone** until it's released | Someone touched the server window; it shows "Select" in its title bar |
| **Network** (host on Wi-Fi with a weak signal or power saving) | Every packet to and from every player passes through the host's link, so **everyone lags, more so with more players**. On Wi-Fi each packet crosses the air twice: player → access point → host | Everyone's ping goes up together |
| **GPU** | Only the host's own view gets choppy | The host's fps |
| **Disk** | Irrelevant, except when RAM is short | |

### On each player's computer (affects mostly that player)

| Shortage | What that player notices | What others notice | How to recognize it |
| --- | --- | --- | --- |
| **Weak GPU, or Chrome drawing without the GPU** | Low FPS: a choppy picture, sluggish mouse, the timing ring jumps. Presses are still judged fairly, apart from up to one frame of delay | Nothing | Low fps in the corner (~19 fps means no GPU) |
| **CPU busy** (Teams, an antivirus scan, many tabs) | Stutters (long frames) | **They see this player teleport**, because position updates go out in bursts | fps dips |
| **RAM short** | Long stalls when Windows swaps the browser out | The same teleporting, worse | Laptop sluggish overall |
| **Wi-Fi weak, congested or power saving** | Others and balls **freeze and jump**. "Pressed in time but got hit" once the delay passes 0.25 s. Their own throws appear late | They stutter | Ping (ms in the corner) high or jumpy |
| **Battery saver / Chrome Energy Saver** | Lower frame rate, and Wi-Fi power saving delays packets (often by ~100 ms) | Some stutter | Happens on battery and goes away on the charger |
| **VPN or security software routing local traffic** | High ping for that player only | | Ping much higher than other players' |

### Symptom → likely cause

| What happened | Most likely cause |
| --- | --- |
| Everyone froze at the same moment | The host: console window, CPU, RAM or network |
| One player sees others and balls freeze and jump, while others see that player fine | That player's download (Wi-Fi) |
| Everyone sees one player teleport | That player's upload, or their laptop stalling |
| Low fps in a player's corner | Their graphics: GPU acceleration, battery saver, resolution |
| "I pressed in time but got hit", repeatedly | That player's delay above 0.25 s, or very low fps |

## 3. Hotspot vs everyone on the office Wi-Fi

**Yes, it changes things, mostly for the better, if it's set up right.**

| | Everyone on the office Wi-Fi (now) | Players on the host's hotspot |
| --- | --- | --- |
| Path of each packet | player → office access point → host. If the host is on Wi-Fi too, **every packet crosses the air twice** | player → host directly: **one radio hop** |
| Competing traffic | The whole office's traffic shares that access point and channel | Only the game, though nearby networks may still share the radio channel |
| Network equipment in between | Corporate networks can add delay (central controllers, VLANs, security inspection) or block devices from seeing each other | Nothing |
| Signal | Office access points have good antennas and coverage | One room; laptop antennas are weaker |
| Capacity | Fine for this traffic (a few hundred kbit/s in total) | **Windows Mobile Hotspot allows at most 8 connected devices** |
| Pitfalls | Power saving and distance from the access point vary per person | See below |

**Hotspot pitfalls to avoid:**

- **The host's Wi-Fi card usually has one radio.** If the host also uses Wi-Fi for its own internet, that one radio serves both networks, which can make things *worse* than the office Wi-Fi. Best: the host on an Ethernet cable, sharing that connection through the hotspot. Mobile Hotspot needs some connection to share.
- **Pick 5 GHz** in the hotspot settings if it's offered; 2.4 GHz is usually crowded.
- **The firewall** may treat the hotspot network as a different network type. If players can't connect, allow the app on that network too.
- **Address:** the hotspot address is usually `192.168.137.1`. The server lists it among the join addresses.

**Best option of all:** a cheap dedicated 5 GHz router (no internet needed), with the host plugged in by cable and players on the router's Wi-Fi.

**Recommendation:** try the hotspot (5 GHz, host on Ethernet) in the next session, together with the A1 readout, and compare.

## Proposed plan, for discussion

1. **Diagnose:** A1 (readout), C1 (click-proof server window), C2 (addresses).
2. **Smooth:** B1 (adaptive delay), B2 (predict through gaps), B3 (newest snapshot only), B4 (event timestamps).
3. **Feel:** B5 (instant own throw), D1 (graphics option), D2 (GPU warning).
4. **Then decide on gameplay forgiveness (E)** by trying values live in the lobby rules editor during a session. Keep what the group prefers as the new defaults.

## Questions that would sharpen the plan

1. Did the lag hit **everyone at the same moment**, or only certain people while others were fine?
2. What did the **numbers in the top-right corner** (ms · fps) show for the laggy players?
3. Was the host on **Wi-Fi or a cable**? Did anyone **click inside the server window** during play? Was a VPN or proxy tool running on the host?
4. Were the laggy players **on battery**, far from the access point, or on a VPN?
5. Which felt worst: **others stuttering**, **balls jumping**, **getting hit despite pressing**, or **the game itself running choppy** (low fps)?

## Update: your answers, and the logs

### What you answered

| Question | Answer | What it suggests |
| --- | --- | --- |
| Everyone at once, or some people? | Some people, going by what they said | Mostly each player's own Wi-Fi or computer. Host-side freezes aren't ruled out: people rarely notice that others froze at the same moment |
| The ms · fps numbers? | Unknown | Nobody watches the corner mid-game, hence the logs |
| Host on Wi-Fi? | Yes: your PC, and you played on it too | Every packet to and from every player crossed the air twice. Your own game drew on the same PC as the server |
| A click in the server window? | Maybe | That alone freezes everyone (QuickEdit). The logs now catch it |
| A VPN on the host? | Maybe | See below: it matters on this PC |
| Worst symptom? | Unknown | The L key now records the moments themselves |

**A finding on this PC (2026-10-22):**

- While the session logs were being built, a VPN/proxy tool was running on the host. Its tunnel adapter carried both the internet route and the route to any `10.x` address.
- So if the office network is `10.x` and that tool was on when you hosted, the game's traffic to coworkers may have gone through the VPN.
- The logs now record, for every player, which of this PC's addresses their traffic leaves from. The report flags any player reached through a VPN adapter.

### The logs (step A1, built)

Every session now writes a log; no setup is needed.

- **The server** writes into `logs\<date_time>\server.jsonl` next to the app, every second:
  - its own timing: game-loop stalls over 100 ms, each one noted with its length;
  - the host's CPU (the whole PC and the server), memory, power (battery, battery saver) and Wi-Fi signal and link rate;
  - its network adapters and routes (VPNs), and whether console QuickEdit is on;
  - each player's input rate and longest input gap, how far behind their screen runs, and the messages queued or dropped toward them.

  It also writes down every hit on a person, every press that arrived after the ball had already hit (with how far behind that player's screen was), and every console print Windows held up (a click in the server window).
- **Every browser** sends its own log to the host every few seconds. It's kept in the browser until the server confirms it, so a dropped connection loses nothing. Every second it records:
  - fps, hitches and code time per frame;
  - how late world updates arrived;
  - **how long the picture of the others stood frozen**;
  - ping and inputs sent.

  It also notes long freezes and hitches, presses and what came of them, disconnects, errors and the tab being hidden. And the device: graphics card (or software rendering), CPU cores, screen.
- **L in the game** marks "this felt laggy".
- **`tools\log_report.py`** turns a session into a diagnosis:
  - the host computer's state and the server's stalls;
  - per player: frame rate, frozen time, late updates, ping, late presses, upload gaps;
  - freezes several players shared (the host side) vs each player's own (their network or computer);
  - the numbers just before every L.

**Rehearsed before handing over.** On a test session with one player on simulated bad Wi-Fi, a forced 400 ms stall on that player's page and a 1.5 s freeze of the server, the report found:

- one server stall of 1,521 ms;
- that player's freezes as "on its own (this player's download: likely their Wi-Fi)";
- the 409 ms upload gap as "their computer stalling";
- the L mark as "world updates arrived late (network)".

A first rehearsal with two software-rendered browsers at once also showed the logs catching a starved host: whole-PC CPU at 98–100%, the server stalling up to 5 s, and everyone freezing. That's exactly the "host CPU" row in section 2.

### Checklist for the next office session

1. Start the game as usual. Logging is automatic, and the console says where it writes.
2. Tell everyone: **"press L when it feels laggy"**. It costs nothing and pins the moment.
3. If you can, note who is on battery, who sits far from the access point, and whether a VPN or proxy tool is on (yours especially).
4. Optional A/B test: play part of the session as before. Then play part with VPN tools off and nobody touching the server window, and if possible with the host on a cable or the hotspot (5 GHz). The logs will show the difference.
5. At the end: Esc → **Download all logs (zip)**, and send me that zip. Anyone whose game disconnected can also **Save my log** and send it.

## Update 2: what three office sessions showed

**The data:** 25 Oct (9 players, 20 min), 26 Oct (11, 28 min) and 27 Oct (7, 25 min), each with the server's log and every browser's, plus single-player runs. Numbers come from `tools\log_report.py` and one-off scripts over the raw records.

### The host and the server were fine

- No game-loop stall over 100 ms in any session. The server used 10–15% CPU.
- The host's own tab (on the server PC) froze 0.0–1.1% of the time. A server hiccup would freeze it too.
- The host PC's memory sat at 90–96% in use (0.5–1 GB free): worth closing other programs, though it caused no stalls yet.
- QuickEdit was on in the console every time; nobody clicked it during these sessions (no held-up prints).
- The host's VPN/proxy tool carried internet traffic only; game traffic went straight over the LAN.
- **One exception:** on the 26th, three times, every remote player's updates and inputs stopped for ~0.25 s at once while the host's own tab was fine. That is the host PC's Wi-Fi going quiet briefly. It didn't happen on the 25th or 27th, and it didn't follow rule changes (dozens of those passed cleanly).

### Everyone's computer was fast enough

All players ran at 60 fps or more (some at 140–165), with 0% of time under 30 fps. Shortages of CPU, GPU or memory on players' laptops are ruled out for these sessions.

### The worst lag was a few players' own Wi-Fi, mostly Linux laptops

Frozen picture, the share of time the others and the balls stood still:

| Session | Worst players (frozen) | Their system |
| --- | --- | --- |
| 25 Oct | Player A 17.6%, Player B 3.5%, Player C 3.2% | Linux, Windows, Linux |
| 26 Oct | Player C 3.6%, Player D 3.5% | Linux, Linux |
| 27 Oct | Player C 4.1%, Player E 3.7%, Player F 2.5% | Linux, Windows, Linux |

Most Windows players stayed under 1%. Two patterns:

- **Bursts (players C, D and F, all on Linux laptops): the same rhythm on three machines.** A 170–230 ms freeze roughly every 0.43 s, for 5–20 s, then clean for 30 s to 5 min. That is the signature of the Wi-Fi card scanning for other access points: it leaves the channel, comes back briefly, leaves again. Linux network managers do this when the signal is weak (often every 30 s below a threshold, every few minutes above it). Their uploads stopped too (input gaps of 0.5–1 s), so everyone else saw them jump.
- **Steady stutter (player A):** 200–300 ms frozen in most seconds, all game long. That fits Wi-Fi power saving better than scanning.

**Fixes, on the players' side** (not something the game can smooth over: the holes are 200 ms+):

- Sit closer to the access point, use 5 GHz, or use a cable.
- Linux, power saving: `sudo iw dev <wifi device> set power_save off` (until reboot), or set `wifi.powersave = 2` in a file under `/etc/NetworkManager/conf.d/` and restart NetworkManager.
- Linux, scanning: lock the connection to the access point, `nmcli connection modify "<network>" 802-11-wireless.bssid <access point MAC>` (find the MAC with `nmcli -f BSSID,SSID,SIGNAL dev wifi`). Undo with an empty value. Untested here; the logs will show whether the bursts stop.

### Ordinary office Wi-Fi jitter

The other players' updates typically arrived 35–50 ms later than their fastest, sometimes over 100 ms. With the 80 ms view delay that gives one-frame stops in about a quarter of the seconds for some players: slightly jerky motion, but not what people called lag.

### Button presses: lag compensation works

On the 25th, of 567 hits only 3 came after a press that was in time on the player's screen. The server logged 3, 0 and 0 "late presses" in the three sessions.

### "My press did nothing": the recovery lockout

After a dodge, catch or deflect that meets no ball, the browser ignored new presses for the window plus the recovery (about 0.5 s), silently. 8–11% of all hits (270 over the three sessions, mostly after a deflect) landed while the player was locked out like that, so a second press for that ball did nothing. **Changed:** such a press now says "Still recovering (0.3s)" with the deny sound and is logged as `ignored`, so the next logs count them directly.

### Ricochets

Bank shots were 50–66% of all hits and about two thirds of knockouts. One player's 15 L presses on the 25th came with normal network numbers, mostly right after dying to a bank shot. **Changed (the user's request):** a bounce now keeps only half of the ball's curve (it used to home at 150°/s), and slower balls curve less.

### Things the logs can't show yet

- **Sidestepping:** the server checks your latest position against the ball's real position, while you saw the ball about 0.1 s earlier (2–3 m at 25 m/s), so a ball you stepped away from on your screen can still hit. One log field per hit (how far you were from the ball on your own screen) would prove or rule it out.
- **Which press was ignored on a lockout:** now logged (`ignored`).

### Report tool fixes made along the way

- Browsers resend unsent chunks from earlier sessions to the next server they reach. The report now leaves those lines out (the 26th and 27th had looked like 25- and 50-hour sessions).
- Input gaps now count only while the player was really playing (the host's 4-minute "gap" was time spent in the menu).
- Times are on the host's clock (one player's PC clock was 98 s off), and lag marks are sorted by game time.

### UDP instead of WebSockets?

Not now. Browsers can't open raw UDP: the options are WebRTC data channels (needs a WebRTC stack on the Python side) or WebTransport (HTTP/3 with TLS certificates, awkward on a LAN). Either is a large change. What UDP fixes is one lost packet holding up the ones behind it (TCP head-of-line blocking): roughly a 100–300 ms stall becomes one skipped frame. The logs don't show that as the main problem: the big freezes were radio silences of 200 ms and more (scanning, power saving), where nothing arrives over UDP either. Revisit if, after the Wi-Fi fixes, short stalls on otherwise good connections remain.

### Applied as settings (2026-10-27)

The user approved all five suggestions, as settings with explanations (Game rules › Network (advanced)):

| Setting | Default | What a player notices |
| --- | --- | --- |
| View delay | 0.10 s (was 0.08) | Fewer one-frame stops when Wi-Fi is uneven; the picture is 0.02 s older |
| Press grace | 0.02 s | A press that looked perfect isn't judged a hair late |
| Sidestep compensation | On | A ball you stepped clear of on your screen misses you ("SIDESTEPPED") |
| Lockout after a missed press | 1× (0 = none) | How long after a whiffed dodge, catch or deflect before you can press again |
| Curve kept after a bounce | 0.5 (under Ricochets) | Bank shots no longer home in |

**Measured:** a scripted player who walks out of every incoming ball's path, with 150 ms of simulated lag, against two hard bots. Compensation on: 26 balls, 13 missed them, 7 hits, 0 hits while clear on their screen. Off: 16 balls, 14 hits, all 14 while clear on their own screen. The logs now record, for every hit, how far clear of the ball the player was on their own screen, every sidestep, and every defence that counted thanks to the grace; the report shows them under FAIRNESS.

**Still open:** a notice for a player whose own connection is bad ("your Wi-Fi is dropping out"), so others don't blame the game; and buffering a press made just before a lockout ends.

## Update 3: the 28 Oct session

- **Sidestep compensation, A/B in a real session:** the host turned it off halfway. On: 233 balls missed people who had stepped clear on their own screen, and no hit while clear on screen. Off: about 400 hits on people who were clear on their own screen (up to 0.9 m).
- **A new cause of a frozen picture: the player's own clock.** One Linux laptop's clock ran about 1% fast for 25 s (most likely the system correcting its time). Updates kept arriving normally, but the game's clock estimate only moved back 1 ms per second, so that player's picture stood still for about 5 minutes and their presses lost lag compensation. Fixed: the browser now re-anchors when every update of 1.5 s arrives over 40 ms late (tested: a +300 ms clock run now costs 2 s of frozen picture instead of minutes).
- The server and the host were healthy; no browser errors.
