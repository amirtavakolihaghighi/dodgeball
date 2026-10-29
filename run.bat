@echo off
rem Starts the Dodgeball server. The first run sets up a local Python environment (.venv).
cd /d "%~dp0"

rem A .venv copied from another computer points at that computer's Python and fails here,
rem so check that it actually works, and rebuild it if it doesn't.
if not exist ".venv\Scripts\python.exe" goto setup
".venv\Scripts\python.exe" -c "import fastapi, uvicorn" >nul 2>&1 && goto run
echo The Python environment in this folder came from another computer. Rebuilding it for this one...
rmdir /s /q .venv

:setup
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3"
if not defined PY (python --version >nul 2>&1 && set "PY=python")
if not defined PY goto nopython
echo Setting up the Python environment, first run only...
%PY% -m venv .venv || goto fail
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || goto fail

:run
".venv\Scripts\python.exe" server.py %*
pause
exit /b

:nopython
echo.
echo Python was not found. Install Python 3.10 or newer from https://www.python.org/downloads/
echo and tick "Add python.exe to PATH" in the installer. Then run this file again.
pause
exit /b 1

:fail
echo.
echo Setup failed. The first run downloads two small packages, so check the internet connection,
echo then run this file again.
pause
exit /b 1
