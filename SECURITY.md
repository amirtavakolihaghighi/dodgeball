# Security policy

Dodgeball is a party game for people on the same local network. One computer runs a small
web server, and everyone else plays in a browser. It was built to be played among friends, and
this page says plainly what that means for security.

## Reporting a problem

Please report security problems **privately**: on GitHub, open the **Security** tab of this
repository and choose **Report a vulnerability**. Say what an attacker can do, how to reproduce
it, and which version you tried (a release tag, or a commit). Please don't open a public issue
for it.

This is a hobby project maintained by one person: expect an answer within about a week.
Fixes go into the next release; only the latest release is supported.

## What the game does on your computer and your network

**The server (the host's computer):**

- It listens on **TCP port 8000** (or the next free port up to 8019) on **every network
  interface**, so anyone who can reach that computer on the network can open the game.
- There are **no accounts and no passwords**. Anyone who connects can join and play.
- **Host powers** (rules, teams, bots, starting and ending matches, downloading the session
  logs) go to browsers on the host's own computer, and to anyone who opens the **host link**
  shown in the server window (`...?host=KEY`; the key is random for every run). Treat that link
  like a password for the evening.
- Traffic is **plain HTTP and WebSocket, not encrypted**. Anyone on the same network can read
  it: player names, inputs and the game state.
- **Files it writes**, next to the app (or `server.py`):
  - `saved_rules.json`: the host's game rules;
  - `logs/`: one folder per run (the 30 newest are kept) with the server's numbers and every
    browser's own log. These contain **player names, LAN IP addresses, browser and device
    details** (graphics card, CPU cores, screen size), and the host computer's CPU, memory, power,
    network adapters (names and IPv4 addresses, so a VPN shows up) and Wi-Fi signal (network
    names and hardware addresses are left out).
- Every browser that joins can make the server store log data, up to 30 MB per page load, so a
  hostile player could fill some disk space.
- On Windows it runs `netsh wlan show interfaces` and `ipconfig` (read-only, fixed arguments)
  to record the host's network state in the log.
- It **never contacts the internet**: three.js is bundled, and there are no update checks,
  analytics or telemetry.

**The browsers (the players):**

- Each browser moves its own player, and the server only keeps the movement within the court.
  A modified browser can therefore **cheat** (move faster, for example). Fine among friends,
  not for strangers.
- Player names are always shown as plain text, never as HTML.

**`Allow friends to connect.bat` (Windows, optional):** after asking for administrator
permission it adds **one inbound Windows Firewall rule**: TCP ports 8000-8019, from the **local
subnet only**, on any network profile. It also **deletes Windows' inbound "block" rules for the
game's program** (made when an earlier "allow access" prompt was answered for private networks
only). `Allow friends to connect.bat undo` removes the rule again; the deleted block rules are
not restored. `... check` only shows what it would do.

**The Windows app** is not code-signed, so Windows SmartScreen warns about it. Release builds are
made by GitHub Actions from the tagged source (`.github/workflows/release.yml`), and every
release lists the SHA-256 checksum of its zip.

## What it cannot protect you from

- Hostile people on the same network: there is no authentication and no encryption.
- Cheating with a modified browser.
- Anyone who gets the host link, or who can use the host's computer (and read its log folder).

**Don't expose the game to the internet** (no port forwarding, no public cloud server). It is
made for a room full of people you know.
