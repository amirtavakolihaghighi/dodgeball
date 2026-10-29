"""Freezes the game server for a while, the way a click in its console window does (QuickEdit):
everyone's game should freeze at the same moment, and the session log should show a stall.

    python tests/browser/freeze_server.py <port> [seconds]      (Windows only)
"""
import ctypes
import subprocess
import sys
import time


def listening_pids(port):
    """The process listening on `port`: the server itself (not the venv's launcher above it)."""
    out = subprocess.run(["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True).stdout
    return {int(line.split()[-1]) for line in out.splitlines()
            if "LISTENING" in line and line.split()[1].endswith(f":{port}")}


def main():
    port, seconds = int(sys.argv[1]), float(sys.argv[2]) if len(sys.argv) > 2 else 1.5
    k32, ntdll = ctypes.WinDLL("kernel32"), ctypes.WinDLL("ntdll")
    k32.OpenProcess.restype = ctypes.c_void_p
    handles = [h for h in (k32.OpenProcess(0x0800, False, pid) for pid in listening_pids(port)) if h]  # SUSPEND_RESUME
    if not handles:
        sys.exit(f"no server is listening on port {port}")
    for h in handles:
        ntdll.NtSuspendProcess(ctypes.c_void_p(h))
    time.sleep(seconds)
    for h in handles:
        ntdll.NtResumeProcess(ctypes.c_void_p(h))
        k32.CloseHandle(ctypes.c_void_p(h))
    print(f"froze the server on port {port} for {seconds} s")


if __name__ == "__main__":
    main()
