# Security policy

Dodgeball is a party game for people on the same local network. One computer runs a small
web server, and everyone else plays in a browser. It was built to be played among friends, and
this page says plainly what that means for security. For friends elsewhere it has an internet
mode, behind a password (below).

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
- There are **no accounts and no passwords** (except in internet mode, below). Anyone who
  connects can join and play.
- **Host powers** (rules, teams, bots, starting and ending matches, downloading the session
  logs) go to browsers on the host's own computer, and to anyone who opens the **host link**
  shown in the server window (`...?host=KEY`; the key is random for every run). Treat that link
  like a password for the evening.
- Traffic is **plain HTTP and WebSocket, not encrypted**. Anyone on the same network can read
  it: player names, inputs and the game state.
- **Files it writes**, next to the app (or `server.py`):
  - `saved_rules.json`: the host's game rules, and each player's own settings by player name;
  - `logs/`: one folder per run (the 30 newest are kept) with the server's numbers and every
    browser's own log. These contain **player names, LAN IP addresses, browser and device
    details** (graphics card, CPU cores, screen size), and the host computer's CPU, memory, power,
    network adapters (names and IPv4 addresses, so a VPN shows up) and Wi-Fi signal (network
    names and hardware addresses are left out).
- Every browser that joins can make the server store log data: up to 30 MB per page load, 200
  page loads and 300 MB for all browsers together per session (a session is one server run; in
  internet mode, one game night). So a hostile player could fill some disk space, within those
  limits.
- No message may be bigger than 1 MiB (a whole settings file is about 150 KB).
- On Windows it runs `netsh wlan show interfaces` and `ipconfig` (read-only, fixed arguments)
  to record the host's network state in the log.
- It **never contacts the internet**: three.js is bundled, and there are no update checks,
  analytics or telemetry.

**The browsers (the players):**

- Each browser moves its own player, and the server only keeps the movement within the court.
  A modified browser can therefore **cheat** (move faster, for example). Fine among friends,
  not for strangers.
- Player names are always shown as plain text, never as HTML.
- **Export settings** saves a `.json` file in that browser's Downloads folder: every rule and the
  own settings of players by name. **Import settings** (host only) sends such a file to the
  server, which checks every value like any rule edit: unknown rules are ignored, numbers are
  clamped to their range, and at most 64 players' settings are kept.

**`Allow friends to connect.bat` (Windows, optional):** after asking for administrator
permission it adds **one inbound Windows Firewall rule**: TCP ports 8000-8019, from the **local
subnet only**, on any network profile. It also **deletes Windows' inbound "block" rules for the
game's program** (made when an earlier "allow access" prompt was answered for private networks
only). `Allow friends to connect.bat undo` removes the rule again; the deleted block rules are
not restored. `... check` only shows what it would do.

**The Windows app** is not code-signed, so Windows SmartScreen warns about it. Release builds are
made by GitHub Actions from the tagged source (`.github/workflows/release.yml`), and every
release lists the SHA-256 checksum of its zip.

## Internet mode

`server.py --internet` ([docs/INTERNET.md](docs/INTERNET.md)) is for a server on the internet,
with HTTPS in front of it (the guide uses Caddy).

- **Passwords:** a connection must join with the players' password within 5 seconds. The host's
  controls, and everyone's logs, need the host password. Nobody is the host because of the
  address they connect from. The passwords come from the command line or the environment
  (`DODGEBALL_PASSWORD`, `DODGEBALL_HOST_PASSWORD`), must differ, are compared in constant time,
  and are never written to the logs.
- **Guessing:** after 5 wrong passwords from one address within a minute, that address waits.
- **Limits:** at most 16 people (bots don't count; the host always gets in), 10 open
  connections per address and 64 in all (or the people allowed plus 16, if that's more), and per connection about 512 KB/s and 300 messages a
  second after a burst (a browser resending its stored log). A connection over them is closed.
- **Listening:** on `127.0.0.1:8000` only, unless `--host` says otherwise (then the server warns
  that nothing is encrypted).
- **Players' addresses** come from uvicorn: the connecting address, or the `X-Forwarded-For`
  header when the connection comes from this computer (a proxy such as Caddy). A proxy must pass
  players' addresses on, or the limits count everyone as one address; the server notes it when a
  player seems to connect from the server itself. Whatever the address, it never makes anyone
  the host.
- **Logs:** a folder per game night; players' addresses only in part (`203.0.x.x`); refused
  connections (wrong passwords, floods) are noted with that partial address.

## What it cannot protect you from

- On a LAN: hostile people on the same network. There is no authentication and no encryption.
- In internet mode: anyone who has the password can join and play; a flood from many addresses
  at once (that's for the cloud provider's network to stop).
- Cheating with a modified browser.
- Anyone who gets the host link or the host password, or who can use the host's computer or the
  server (and read its log folder).

**Don't expose the game to the internet without internet mode** (no port forwarding, no public
cloud server). It is made for people you know: in internet mode, give the password only to them.
