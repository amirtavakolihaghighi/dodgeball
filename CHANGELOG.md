# Changelog

All notable changes to Dodgeball (called Dodge & Parry until 2.0.0). The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). For a game that means: a MAJOR
version changes how hosts or players use it (or settings saved by an older version stop
applying), a MINOR version adds features, a PATCH version fixes bugs.

## [Unreleased]

### Added

- **A hit says why it got through.** When a ball hits you just after your dodge, catch or deflect
  ended, the popup says **TOO EARLY** and by how much ("TOO EARLY (0.05 s)  −30 HP"). When it
  hits you just after you stopped another ball, it says **SECOND BALL**: a catch or a deflect
  stops one ball, so one right behind it still hits. The session logs keep both, and
  `tools/log_report.py` counts them per player.

## [2.0.0] - 2026-10-29

The second round of development, shaped by sessions with 6–10 players on an office Wi-Fi and by
the session logs they produced.

### Added

- **A lobby.** The server starts in a warm-up lobby; the host sets up the teams, the bots and
  the rules, then presses **Start match**. People can join at any time. Matches end when a team
  reaches the "first to N" round wins, or when the host ends them.
- **Host-only controls**, applied at once in the lobby and from the next round during a match:
  moving players between teams, shuffling, bots, match length, every rule. Everyone else sees
  the same menu read-only. A secret host link lets the host run things from another device.
- **The rules editor:** every number of the game (117 of them) with a plain name, a description
  and an animated preview that plays the default next to the lobby's value. The host's rules
  are saved and come back at the next start.
- **Each team's bots** are set separately by the host (0–12 per team).
- **Spectating** for the host: a free camera, or riding behind any player.
- **The host's screen, live:** everyone else sees which menu and rule the host is on and their
  unapplied edits; with "Follow the host", their rules editor follows along.
- **Shared team cash** (optional): one pot per team, and any teammate can spend it on revives.
- **Session logs** from the server and every browser, collected on the host's computer and
  downloadable as one zip; **L** marks a laggy moment; `tools/log_report.py` turns a
  session into a diagnosis.
- **Fairness settings** under Game rules › Network: press grace, sidestep compensation (a ball
  you stepped clear of on your own screen misses you) and the lockout after a missed press.
- **`Allow friends to connect.bat`**, so other computers can join without turning Windows
  Firewall off.
- An MIT licence, CI on Windows, macOS and Linux (Python 3.10–3.14) with a headless-browser
  match, and release builds of the Windows app made by GitHub Actions.
- Tests: 50 rule tests, 6 server tests, and browser tests for the lobby, the host's screen,
  spectating, timing, sidestep compensation, the clock estimate and the logs.

### Changed

- **The game is now called Dodgeball** (it was Dodge & Parry): on the join screen and the browser
  tab, the app (`Dodgeball.exe` in `Dodgeball-windows.zip`), the log downloads, and the firewall
  helper's rule, which replaces the old one when the helper runs again.
- **The game's files moved from `prototype/` to the top of the repository**, and its manual to
  `docs/MANUAL.md`.
- **The host starts every match**, and only the host changes settings; players no longer
  switch teams or add bots themselves.
- **"Team size with bots" is replaced by "RED bots" and "BLUE bots"**, and nothing balances
  teams automatically any more. A saved "team size with bots" no longer applies.
- **Ricochets curve less:** a bounce keeps half of the ball's curve ("Curve kept after a
  bounce"), replacing the strong homing after a bounce ("Ricochet curve strength", no longer
  used).
- **Slower throws curve less** ("Slow-ball curve"); a full-power throw curves as before.
- The view delay is 0.10 s instead of 0.08 s, for fewer stutters on uneven Wi-Fi.
- Join addresses list the likely LAN address first and skip unusable ones.

### Fixed

- A press during the short recovery after a missed dodge, catch or deflect used to do nothing
  silently; it now says "Still recovering".
- A player whose computer clock was corrected mid-game saw a frozen picture for minutes; the
  game now recovers within a second or two.
- On a Mac, the server could take a long time to start: it waited for a lookup of the computer's
  own network name. It now waits at most 2 seconds, and adds any addresses it finds later.

## [1.0.0] - 2026-10-22

The first stable version, released as Dodge & Parry: real-time 3D dodgeball for a local network, played in the browser.

### Added

- An authoritative Python server (FastAPI + uvicorn) and a three.js client; one computer hosts,
  everyone on the same Wi-Fi opens a web page.
- Charged throws (speed and stamina cost grow with the charge, damage comes from speed), gravity
  arcs with a throw preview, light aim assist, bank shots and one ricochet per throw.
- Dodge, catch and deflect, each with a timing window and a "perfect" zone; deflect rallies
  that get faster every time.
- Health, Souls-style stamina, knockouts, cash and revives with escalating prices, rounds with a
  countdown and a winner.
- Bots in three skill levels, an arena that grows with the teams, and lag compensation: presses
  are judged against what the player's screen showed, up to 0.25 s back.
- A standalone Windows app (`build_exe.bat`), `run.bat`, and 30 rule tests plus headless-browser
  tests.

[Unreleased]: https://github.com/amirtavakolihaghighi/dodgeball/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/amirtavakolihaghighi/dodgeball/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/amirtavakolihaghighi/dodgeball/releases/tag/v1.0.0
