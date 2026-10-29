"""Internet mode (server.py --internet): who may come in, and how much anyone may send.

On a local network the game trusts everyone who can reach it. On the internet that's everyone,
so in internet mode:

- friends join with a password, and the host with the host password. Nobody is the host
  because of where they connect from: behind a proxy (which HTTPS needs) every player seems to
  connect from the server itself;
- an address that keeps getting the password wrong has to wait a minute;
- one address can't hold many connections open, nor everyone together more than the game needs;
- a new connection must join within a few seconds, with a small message;
- after that it can't send more than a browser ever does: a burst when it resends its stored
  log, then a trickle.

The session log keeps only the network part of a player's address (`masked`): a home address is
personal, and the network part is enough to tell connections apart.
"""
from __future__ import annotations

import collections
import ipaddress
import secrets

DEFAULT_MAX_PLAYERS = 16    # people at once (bots don't count); the host may always come in
WRONG_TRIES = 5             # wrong passwords from one address within WRONG_WINDOW s, then it waits
WRONG_WINDOW = 60.0
PER_ADDRESS = 10            # connections open at once from one address (friends sharing a home, extra tabs)
JOIN_TIMEOUT = 5.0          # a new connection must join this soon (browsers join the moment they connect)...
JOIN_MAX = 4096             # ...with a message no bigger than this (bytes)
BYTES_PER_S, BYTES_BURST = 512 * 1024, 16 * 1024 * 1024     # what a joined connection may send
MSGS_PER_S, MSGS_BURST = 300, 5000                          # (the bursts: a browser resending its log)


def same(given, wanted) -> bool:
    """Is `given` the password `wanted`? Takes as long for a near miss as for a wild guess."""
    return isinstance(given, str) and secrets.compare_digest(given.strip().encode(), wanted.encode())


def masked(ip) -> str | None:
    """A player's address for the logs: its network part only (203.0.x.x)."""
    try:
        address = ipaddress.ip_address(str(ip))
    except ValueError:
        return None
    if address.version == 6 and address.ipv4_mapped:
        address = address.ipv4_mapped
    if address.version == 4:
        return ".".join(str(address).split(".")[:2] + ["x", "x"])
    return ":".join(address.exploded.split(":")[:3] + ["x"])


class Budget:
    """How much one connection may send: `rate` a second, after a `burst` at once."""

    def __init__(self, rate, burst, now):
        self.rate, self.burst, self.left, self.at = rate, burst, float(burst), now

    def take(self, amount, now) -> bool:
        self.left = min(self.burst, self.left + (now - self.at) * self.rate)
        self.at = now
        self.left -= amount
        return self.left >= 0


class Door:
    """Who may come in. Addresses are as uvicorn reports them: the player's own address behind
    a proxy that passes it on (X-Forwarded-For from this computer; Caddy does). `now` is
    time.perf_counter()."""

    def __init__(self, password, host_password, max_players=DEFAULT_MAX_PLAYERS):
        self.password, self.host_password, self.max_players = password, host_password, max_players
        self.max_open = max(64, max_players + 16)
        self.open = collections.Counter()       # address -> connections open now
        self.total = 0
        self.wrong = {}                         # address -> times of its recent wrong passwords

    def arrive(self, ip) -> str | None:
        """A connection opened: None if it may stay, else why not ("busy")."""
        if self.open[ip] >= PER_ADDRESS or self.total >= self.max_open:
            return "busy"
        self.open[ip] += 1
        self.total += 1
        return None

    def depart(self, ip):
        """A connection that arrive() let in closed."""
        self.total -= 1
        self.open[ip] -= 1
        if self.open[ip] <= 0:
            del self.open[ip]

    def join(self, msg, ip, people, now) -> tuple[bool, str | None]:
        """A join message from `ip`, with `people` (not bots) already in: (is the host, None), or
        (False, why not: "wait", "password" or "full")."""
        if len(self.wrong) > 1000:              # many addresses guessing: forget those done waiting
            self.wrong = {a: t for a, t in self.wrong.items() if now - t[-1] <= WRONG_WINDOW}
        tries = self.wrong.get(ip)
        while tries and now - tries[0] > WRONG_WINDOW:
            tries.popleft()
        if tries and len(tries) >= WRONG_TRIES:
            return False, "wait"
        given = (msg.get("password"), msg.get("hostKey"))     # typed in, or the ?host= link
        if any(same(g, self.host_password) for g in given):
            self.wrong.pop(ip, None)
            return True, None
        if not any(same(g, self.password) for g in given):
            self.wrong.setdefault(ip, collections.deque()).append(now)
            return False, "password"
        self.wrong.pop(ip, None)
        if people >= self.max_players:
            return False, "full"
        return False, None
