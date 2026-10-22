"""Builds the standalone Windows app into dist/DodgeAndParry and zips it for sharing.

Players don't need Python to run the result. Run this again after changing the code or
config.py. Usually started through build_exe.bat.
"""
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "DodgeAndParry"


def main():
    print("Installing the packaging tool (PyInstaller)...")
    subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q", "pyinstaller"], check=True)
    import PyInstaller.__main__

    print("Building, this takes a minute...")
    PyInstaller.__main__.run([
        "--noconfirm", "--clean", "--log-level", "WARN",
        "--onedir", "--console", "--name", NAME, "--icon", str(ROOT / "icon.ico"),
        "--add-data", f"{ROOT / 'static'}{os.pathsep}static",
        # uvicorn, websockets and anyio pick their parts by name at runtime, so bundle them all
        "--collect-submodules", "uvicorn", "--collect-submodules", "websockets", "--collect-submodules", "anyio",
        "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"), "--specpath", str(ROOT / "build"),
        str(ROOT / "server.py"),
    ])
    shutil.rmtree(ROOT / "build", ignore_errors=True)     # temporary build files
    for _ in range(15):     # antivirus scanners briefly lock freshly built files
        try:
            archive = Path(shutil.make_archive(str(ROOT / "dist" / f"{NAME}-windows"), "zip", ROOT / "dist", NAME))
            break
        except OSError:
            time.sleep(2)
    else:
        sys.exit(f"The app is built in dist\\{NAME}, but zipping it failed (files locked). Zip that folder yourself.")
    size = archive.stat().st_size / 1e6
    print(f"\nDone: {archive.relative_to(ROOT)} ({size:.0f} MB)")
    print(f"Share that zip. Players unzip it and double-click {NAME}.exe; no Python needed.")


if __name__ == "__main__":
    main()
