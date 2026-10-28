"""Builds the standalone Windows app into dist/DodgeAndParry and zips it for sharing.

Players don't need Python to run the result. Run this again after changing the code or
config.py. Usually started through build_exe.bat.
"""
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAME = "DodgeAndParry"
FIREWALL_HELPER = "Allow friends to connect.bat"


def git_version():
    try:
        out = subprocess.run(["git", "describe", "--always", "--dirty", "--tags"], cwd=ROOT, capture_output=True,
                             text=True, timeout=5)
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def main():
    print("Installing the packaging tool (PyInstaller)...")
    subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q", "pyinstaller"], check=True)
    import PyInstaller.__main__

    print("Building, this takes a minute...")
    # Which code this build is: the app writes it into every session log.
    info = ROOT / "build_info.json"
    info.write_text(json.dumps({"commit": git_version(), "built": datetime.now().isoformat(timespec="seconds")}),
                    encoding="utf-8")
    try:
        PyInstaller.__main__.run([
            "--noconfirm", "--clean", "--log-level", "WARN",
            "--onedir", "--console", "--name", NAME, "--icon", str(ROOT / "icon.ico"),
            "--add-data", f"{ROOT / 'static'}{os.pathsep}static",
            "--add-data", f"{info}{os.pathsep}.",
            # uvicorn, websockets and anyio pick their parts by name at runtime, so bundle them all
            "--collect-submodules", "uvicorn", "--collect-submodules", "websockets", "--collect-submodules", "anyio",
            "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build"), "--specpath", str(ROOT / "build"),
            str(ROOT / "server.py"),
        ])
    finally:
        info.unlink(missing_ok=True)
    shutil.rmtree(ROOT / "build", ignore_errors=True)     # temporary build files
    shutil.copy2(ROOT / FIREWALL_HELPER, ROOT / "dist" / NAME / FIREWALL_HELPER)    # next to the .exe
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
