# Dodgeball over the internet

On a local network the game trusts everyone who can reach it: there are no passwords. That's
fine in an office or at home, and not on the internet, where anyone can reach a server.
**Internet mode** is for playing with friends who aren't in the same room. You run the game on
a small cloud server, behind HTTPS. Friends join with a password, and you, the host, type the
host password instead.

This page covers what internet mode does, how to try it on your own computer, how to set up a
cloud server step by step, and how to check the lag after the first game night.

## At a glance, for whoever sets up the server

- **What runs:** one Python 3.10+ process (`server.py`: FastAPI and uvicorn), with no database
  and no other services. The game state lives in memory. It writes `saved_rules.json` and
  `logs/` next to `server.py`.
- **Network:** HTTP plus one WebSocket (`/ws`) on `127.0.0.1:8000`. It has no TLS of its own:
  put a reverse proxy in front of it for HTTPS, one that passes WebSocket upgrades through.
- **Client addresses:** the proxy must send each player's address in `X-Forwarded-For`. uvicorn
  trusts that header only from 127.0.0.1 and ::1 (set `FORWARDED_ALLOW_IPS` if the proxy runs
  elsewhere). Without it, the limits per address count every player as one. Host rights never
  depend on addresses, only on the host password. Caddy sends the header by default
  (`deploy/Caddyfile`).
- **Configuration:** `--internet`, plus the two passwords in `DODGEBALL_PASSWORD` and
  `DODGEBALL_HOST_PASSWORD` (or `--password` and `--host-password`); `--max-players` (default
  16). It refuses to start, with exit code 2, without both passwords or with equal ones.
- **Health check:** `GET /join-info` answers `{"password": true}`.
- **Resources:** light. About 60 MB of memory and a fraction of one CPU core with ten players and
  bots; 35–70 kbit/s per player.
- **Files:** `deploy/dodgeball.service` (systemd: user `dodgeball`, `/opt/dodgeball`, the
  passwords in `/etc/dodgeball.env`) and `deploy/Caddyfile`.
- **Tests:** `.venv/bin/python tests/test_sim.py` and `.venv/bin/python tests/test_server.py`
  run on the server too (the second starts its own server on a free port).
- **Not tried on a real server yet:** the steps below, the service file and Caddy in front of
  the game were written but not run on Linux. Please report anything that doesn't work as
  written.

## What changes in internet mode

- **Joining:** the join screen asks for a password. Friends type the password; the host types
  the host password in the same box. Being on the server's computer doesn't make anyone the host.
- **The host's controls** (rules, teams, bots, Start match, everyone's logs) go to whoever joined
  with the host password, and to nobody else.
- **Limits against abuse**, which friends never notice:
  - at most 16 people at once (bots don't count; the host always gets in; `--max-players`
    changes it);
  - an address that gets the password wrong 5 times within a minute waits until the minute is
    up;
  - one address can have at most 10 connections open (several friends in one home, extra tabs);
  - a connection must join within 5 seconds, and one that sends far more than the game ever does
    is closed.
- **The server listens only on itself** (`127.0.0.1:8000`). Caddy, a web server in front of it,
  gives friends the `https://` address and the encryption.
- **Logs:** a folder per game night. It starts when the first person joins and closes once
  nobody has been on for 30 minutes, so a server that runs for weeks writes nothing while it
  waits. Players' addresses are kept only in part (`203.0.x.x`), and the passwords are never
  written down.
- **The lobby** (Esc) shows the address to send your friends: the one you opened.

What internet mode doesn't do:

- There are no accounts: anyone with the password can join. To keep someone out, change the
  password (below).
- Each browser still moves its own player, so a modified browser could cheat. That's fine
  among friends, and it's why the password matters.
- One server runs one lobby.

## Try it on your own computer first

From the project folder (Windows shown; on Mac and Linux use `.venv/bin/python`):

```powershell
.venv\Scripts\python server.py --internet --password orange-tiger-42 --host-password my-long-host-password
```

The Windows app takes the same options from a terminal:
`Dodgeball.exe --internet --password ... --host-password ...`.

Open `http://localhost:8000` and join with the host password: you get **Start match** and the
other host controls. In a second window, join with the other password: you're a player, without
them. A wrong password says "Wrong password." and lets you try again.

Started like this, the game is reachable from this computer only. Friends elsewhere need the
cloud server below.

## Put it on a cloud server

You need:

- a small Linux server from any cloud provider: the cheapest plan is enough, and costs a few
  euros or dollars a month;
- a name for it: your own domain, or a free one (DuckDNS, for example);
- about 30 to 45 minutes, and a terminal that can connect with SSH (Windows has `ssh` built in).

### 1. Rent a server

- Pick the smallest plan (1 CPU and 1 GB of memory are plenty), with **Ubuntu 24.04**.
- Pick a data centre close to your players: every 1,000 km adds about 10 ms of ping, and no
  setting can take that back.
- Add your SSH key when you create it (the provider's guide shows how), and note the server's
  IPv4 address.

### 2. Give it a name

HTTPS needs a name; Caddy gets a free certificate for it.

- **Your own domain:** add an `A` record, for example `game` pointing to the server's address,
  which makes `game.example.com`.
- **A free name:** at [duckdns.org](https://www.duckdns.org), sign in, add a subdomain and put the
  server's address in.

`ping game.example.com` on your computer should then show the server's address. (A new name can
take a few minutes to appear.)

### 3. Install the game

Connect (`ssh root@<the address>`, or the user your provider set up), then:

```bash
sudo apt update && sudo apt install -y git python3-venv
sudo useradd --system --home-dir /opt/dodgeball --shell /usr/sbin/nologin dodgeball
sudo git clone --branch internet-mode https://github.com/amirtavakolihaghighi/dodgeball.git /opt/dodgeball
sudo chown -R dodgeball:dodgeball /opt/dodgeball
sudo -u dodgeball python3 -m venv /opt/dodgeball/.venv
sudo -u dodgeball /opt/dodgeball/.venv/bin/python -m pip install --no-cache-dir -r /opt/dodgeball/requirements.txt
```

The game runs as its own user, `dodgeball`, which can't log in and owns only the game's folder.
Internet mode is on the `internet-mode` branch while it's being tested, hence `--branch`.

### 4. Choose the passwords

```bash
sudo install -m 600 /dev/null /etc/dodgeball.env
sudo nano /etc/dodgeball.env
```

Write two lines, with your own words (letters, digits and dashes; no spaces or quotes):

```text
DODGEBALL_PASSWORD=orange-tiger-42
DODGEBALL_HOST_PASSWORD=a-longer-one-only-you-know
```

The first is for your friends. The second makes you the host: keep it to yourself. Save with
Ctrl+O and Enter, and leave with Ctrl+X. Only the system can read this file.

### 5. Start the game as a service

```bash
sudo cp /opt/dodgeball/deploy/dodgeball.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dodgeball
systemctl status dodgeball --no-pager
```

The status says `active (running)`. From now on the game starts with the server and comes back
if it crashes. To watch its console: `journalctl -u dodgeball -f` (Ctrl+C stops watching, not the
game).

### 6. Add HTTPS with Caddy

Install Caddy from its own repository (these are the commands from
[caddyserver.com/docs/install](https://caddyserver.com/docs/install); Ubuntu's own copy is from
2022 and misses security fixes):

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

Then put the game behind it:

```bash
sudo cp /opt/dodgeball/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Replace `game.example.com` with your name, save, and reload Caddy:

```bash
sudo systemctl reload caddy
```

Caddy gets the certificate within a minute or so, once the name points at the server (step 2)
and ports 80 and 443 are open (step 7).

### 7. Open only what's needed

In your provider's firewall (its web console), allow incoming **TCP 22** (SSH), **80** and
**443**, and nothing else. On the server itself, `ufw` can do the same:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80,443/tcp
sudo ufw enable
```

Allow SSH first, or you lock yourself out. The game's own port, 8000, stays closed: the game
only listens on the server itself.

### 8. Play

- **You:** open `https://game.example.com`, type your name and the host password.
- **Friends:** the same address, their name and the password.
- **Check it once:** a friend's screen has no **Start match** button, and their lobby says
  "Waiting for …" (or "Waiting for the host: whoever joins with the host password.").

## The first game night: check the lag

Over the internet, ping is higher than on an office Wi-Fi: usually 10–50 ms to a server in your
region. Everyone sees their own in the top right corner.

- Your own movement stays instant.
- What the server confirms comes about one ping later than at the office: the ball leaving your
  hand, the CATCH and DEFLECT popups, the perfect-dodge spin.
- Dodges, catches and deflects are judged against what your screen showed, up to the
  **Lag compensation limit** (0.25 s). Your screen runs about your ping plus the view delay
  (0.10 s) behind the server, so up to about 150 ms of ping every press is judged fairly.

To see how it went:

1. Play a first session with 2–3 people. Whoever feels lag presses **L** at that moment.
2. Afterwards, as the host: **Esc › Download all logs**.
3. On your computer, in the project folder: `python tools/log_report.py <the zip>`. It shows each
   player's ping, how often their picture froze, and presses that came too late to count.
4. If needed, change these in **Game rules › Network (advanced)**: **View delay** (more cushion,
   for example 0.12–0.15 s, means fewer stutters on uneven connections, at the cost of an older
   picture) and **Lag compensation limit** (higher is fairer for a player with high ping, but
   others see balls hang on them a little longer).

## Everyday things

- **New passwords** (also how to keep someone out): edit `/etc/dodgeball.env`, then
  `sudo systemctl restart dodgeball`. A restart ends a match in progress, and everyone joins
  again with the new password.
- **More than 16 people:** add `--max-players 24` (or another number) at the end of the
  `ExecStart` line in `/etc/systemd/system/dodgeball.service`, then
  `sudo systemctl daemon-reload` and `sudo systemctl restart dodgeball`.
- **Update the game:**

  ```bash
  sudo -u dodgeball git -C /opt/dodgeball pull
  sudo -u dodgeball /opt/dodgeball/.venv/bin/python -m pip install --no-cache-dir -r /opt/dodgeball/requirements.txt
  sudo systemctl restart dodgeball
  ```

- **Your rules** are kept in `/opt/dodgeball/saved_rules.json`, and **the logs** in
  `/opt/dodgeball/logs/`, a folder per game night (the 30 newest are kept).

## When something's wrong

| What you see | What to check |
| --- | --- |
| The address doesn't open | `systemctl status caddy` and `journalctl -u caddy -n 50`. Certificate errors mean the name doesn't point at the server yet, or ports 80 and 443 are closed. |
| "502" in the browser | The game isn't running: `systemctl status dodgeball` and `journalctl -u dodgeball -n 50`. |
| The game's console says it needs a password | `/etc/dodgeball.env` is missing a line. Fix it, then `sudo systemctl restart dodgeball`. |
| Everyone gets "Wrong password." | The passwords in `/etc/dodgeball.env`; after a change, restart the game. |
| "Too many wrong passwords from your network." | Wait a minute, then type it carefully. |
| "The game is full." | More than 16 people: see "More than 16 people" above. |
| The console says "A player connected from this computer itself" | Expected when you test on the server itself. Otherwise the web server in front of the game isn't passing on players' addresses. The Caddyfile here does. |

What internet mode protects, and what it doesn't, is also in [SECURITY.md](../SECURITY.md).
