# Running the game on a server, with Docker

The game was made for a local network: one computer hosts, and everyone who can reach it may
play. On a server on the internet it needs a **login in front of it**, because the game has no
accounts or passwords of its own: put it behind an HTTPS reverse proxy that asks for one. This
page is for whoever runs that server. The image and the Compose file are `Dockerfile` and
`compose.yaml` in the repository's root.

## At a glance

- **What runs:** one container: `python server.py` (FastAPI and uvicorn), with no database and no
  other services. The game lives in memory; the host's saved rules and the session logs are
  written to the volume at `/data`.
- **Network:** HTTP plus one WebSocket (`/ws`) on port 8000, without TLS. `compose.yaml`
  publishes it on `127.0.0.1:8000` only, for a proxy on the same machine.
- **The proxy** must pass WebSocket upgrades on `/ws`, and send each player's address in
  `X-Forwarded-For`, overwriting whatever the browser sent. The address decides who is the
  host: see [Who is the host](#who-is-the-host).
- **Resources:** light. Measured on a server with eight players and four bots: about 0.4 of a CPU
  core and 180 MB of memory. 35–70 kbit/s per player.
- **Security:** it runs as a user without rights (uid 10001): it can read the game and write only
  to `/data`. Docker checks its health every 30 s (`docker compose ps` shows `healthy`).
- **Tested:** on every push to `main`, GitHub Actions builds this image with `compose.yaml`,
  plays a match against it in headless Chrome, and replaces the container to check that the
  host's rules survive (the "Docker image" job in `.github/workflows/ci.yml`).

## First start

```sh
git clone https://github.com/amirtavakolihaghighi/dodgeball.git
cd dodgeball
DODGEBALL_VERSION=$(git describe --tags --always --dirty) docker compose up -d --build
```

Then point the proxy at `http://127.0.0.1:8000`. `DODGEBALL_VERSION` only labels the build in the
session logs (the image has no git); without it they say `unknown`.

If the proxy runs in a container of its own, its `127.0.0.1` is itself. Put the game on the
proxy's Docker network instead and point the proxy at `http://dodgeball:8000`, in a
`compose.override.yaml` next to `compose.yaml` (Compose reads it by itself, and git ignores it,
so `git pull` never touches it):

```yaml
services:
  dodgeball:
    networks: [proxy]
networks:
  proxy:
    external: true
    name: the-proxys-network     # docker network ls
```

## Updating to a new version

```sh
cd dodgeball
git pull
DODGEBALL_VERSION=$(git describe --tags --always --dirty) docker compose up -d --build
docker image prune -f      # optional: removes the image it replaced
```

- It builds the new image (about a minute; the dependencies are reused unless
  `requirements.txt` changed), then replaces the container. The saved rules and the logs stay:
  they're in the volume.
- **Do it when nobody is playing.** The game's state is in memory: a match in progress is lost,
  and everyone sees "Disconnected" with a Reconnect button, which brings them back under the
  same name, team and own settings.
- **To go back** to an earlier version: `git checkout v2.3.0` (any tag or commit), then the same
  `docker compose up -d --build`. `git checkout main` returns to the newest.
- `main` always holds the newest tested version. The releases (`v2.3.0`...) are tags on it, with
  their changes in `CHANGELOG.md`.

## Who is the host

The host sets up the lobby: teams, bots, every rule, starting and ending matches, and
downloading everyone's session logs (which hold the players' names and addresses). The game
decides who that is when a browser joins:

- **A browser on the server's own computer:** its address is `127.0.0.1` or the server's own
  address. Behind the proxy, the address is the one in `X-Forwarded-For`, believed only from the
  addresses in `FORWARDED_ALLOW_IPS` (`compose.yaml`: Docker's own networks, where the proxy's
  connections come from). So **a proxy that sends `127.0.0.1` makes that player the host.**
- **The host link:** `https://<your address>/?host=KEY`. The server prints it when it starts
  (`docker compose logs dodgeball | grep host=`), with a new key every start.

Several hosts at once is fine: each has the host's controls. For everyone else:

- the proxy must **overwrite** `X-Forwarded-For` with the player's real address, never append
  to the one the browser sent, or a player could send `127.0.0.1` themselves;
- never set `FORWARDED_ALLOW_IPS` to `*`: uvicorn then takes the first address in the header,
  the one a browser can write;
- keep the port on `127.0.0.1` (or on the proxy's network only). `"8000:8000"` would let anyone
  reach the game past the login, and Docker's published ports skip firewalls such as ufw.

## The data in `/data`

- `saved_rules.json`: the host's rules, bots and players' own settings, loaded at every start.
  Esc › Game rules › Reset all clears them from the game; deleting the file does it too.
- `logs/`: the session logs, a folder per server start (the 30 newest are kept). The host
  downloads them from the game (Esc › Download all logs), and `tools/log_report.py` reads them:
  `docker compose exec dodgeball python tools/log_report.py /data/logs/<folder>`. While the server
  runs, its folder grows by about 17 MB a day, most of it one line a second while nobody plays.
- A copy: `docker compose cp dodgeball:/data ./dodgeball-data`.

## Stopping it

| | |
| --- | --- |
| `docker compose stop` | stops the game at once; everyone is disconnected. `docker compose start` brings it back |
| `docker compose down` | also removes the container; the volume (rules and logs) stays |
| `docker compose down -v` | also deletes the volume: the saved rules and every log |

## If Docker Hub or PyPI is slow or blocked

- The image starts from `python:3.13-slim` on Docker Hub. A registry mirror in Docker's
  `daemon.json` (`"registry-mirrors"`) covers it.
- The Python packages come from PyPI, at the exact versions in `requirements.txt`. For a mirror:
  `docker compose build --build-arg PIP_INDEX_URL=https://<mirror>/simple`, then
  `docker compose up -d`.

## What the image holds

The server and what it serves (`static/`), the moves page's list (`docs/ANIMATIONS.md`) and
`tools/log_report.py`; not the tests, the Blender and sound scripts, the other docs or the Windows
files (`.dockerignore`). The moves page's editor can't save there: the game's files are
read-only in the container.
