# Third-party software

Dodgeball itself is under the [MIT licence](LICENSE). It builds on the work below; thank you
to everyone behind it.

## Included in this repository

| Software | Where | Licence |
| --- | --- | --- |
| [three.js](https://threejs.org) r185 | `static/vendor/` | MIT. Copyright 2010-2026 Three.js Authors. The licence header is kept at the top of both files. |

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
