# Third-party software

Dodgeball itself is under the [MIT licence](LICENSE). It builds on the work below; thank you
to everyone behind it.

## Included in this repository

| Software | Where | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org) r185 | `static/vendor/` | MIT. Copyright 2010-2026 Three.js Authors. The licence header is kept at the top of both files. |
| three.js r185 addons: `GLTFLoader.js`, `BufferGeometryUtils.js`, `SkeletonUtils.js`, `OrbitControls.js`, `TransformControls.js` (from `examples/jsm/`, unchanged) | `static/vendor/addons/` | MIT, the same licence and authors as three.js (these files carry no header of their own). |

## Sounds and music

All CC0 (public domain): no credit is required, but they deserve it. `art/sounds.py` downloads
them, cuts and levels them, and writes what the game loads into `static/sounds/`.

| Source | What the game uses it for | Licence |
| --- | --- | --- |
| [BigSoundBank](https://bigsoundbank.com) (LaSonotheque), recorded by Joseph Sardin: #1044 Ball kicked, #1045 Ball rebounds, #1825 and #1826 Ball against a wall, #0444 Punches, #2459–#2468 Punch #4–#13, #0597 Slaps, #1795–#1802 Whooshes, #0165 Man footsteps on the wooden floor, #1835 and #1836 Jumping on concrete, #1841 and #1842 Jumping on wooden pontoon, #2452–#2456 Body fall, #1103 Breathless man, #2339 and #2341 Bass tom, #2366 and #2367 Nepalese cymbal, #2520 and #2522 Horn, #1017 Plastic whistle, #0236 and #0237 Shouts and applause of teens, #2363 Applause, #0019 Applause: 150 people | Hits, throws, catches, deflects, bounces, the dodge's dash, knockouts, breathing when tired, revives, the referee's whistle and the crowd | CC0 |
| qubodup: [15 vocal male strain/hurt/pain/jump sounds](https://opengameart.org/content/15-vocal-male-strainhurtpainjump-sounds) (OpenGameArt) | One of the players' four voices: grunts when hit, cries when knocked out | CC0 |
| HaelDB: [Male Grunt/Yelling sounds](https://opengameart.org/content/male-gruntyelling-sounds) (OpenGameArt; offered under CC0 or OGA-BY 3.0, used under CC0) | Three of the players' four voices | CC0 |
| [Kenney](https://kenney.nl): Voiceover Pack: Fighter | The announcer ("Round 1", "Fight!", "You win", ...) | CC0 |
| [Kenney](https://kenney.nl): Interface Sounds | "Not now", reviving and buying team health | CC0 |
| MintoDog: [Sunny City](https://opengameart.org/content/sunny-city) and its climax version (OpenGameArt) | The music in the lobby and in a match | CC0 |

## Animation

CC0 (public domain). `art/moves.py` downloads them and retargets the clips the game uses onto the
athlete's skeleton, into `static/characters/athlete.glb`.

| Source | What the game uses it for | Licence |
| --- | --- | --- |
| [Mesh2Motion](https://github.com/Mesh2Motion/mesh2motion-app) by Scott Petrovic: its human animation library (`human-base-animations.glb`, `human-addon-animations.glb`, `human-mocap-animations.glb`), which includes Quaternius's [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) | The players' idle and boxer's guard, jogging and sprinting, the overhead throw, the acrobatics' backflip and mid-air pose, flinches, knockouts, getting up, celebrating and kneeling | CC0 (Mesh2Motion's art, and Quaternius's library) |

## Installed when you run the game

Installed by `pip install -r requirements.txt` (exact versions there), and bundled
into the Windows app, where each package's own licence file sits in its `*.dist-info` folder
inside `_internal\`.

| Package | Licence |
| --- | --- |
| FastAPI, Pydantic, pydantic-core, AnyIO, annotated-doc, annotated-types, h11, httptools, PyYAML, typing-inspection, watchfiles, exceptiongroup | MIT |
| Starlette, uvicorn, websockets, click, idna, python-dotenv | BSD-3-Clause |
| uvloop (not on Windows) | MIT or Apache-2.0 |
| typing-extensions | PSF-2.0 |
| opentelemetry-api | Apache-2.0 |

## Only in the Windows app

| Software | Licence |
| --- | --- |
| Python | PSF License |
| [PyInstaller](https://pyinstaller.org)'s bootloader | GPL-2.0 with an exception that allows bundling programs under any licence (the game's code stays MIT) |
