@echo off
rem Builds the standalone Windows app (players don't need Python): dist\DodgeAndParry-windows.zip
rem Run it again after changing the code or config.py.
cd /d "%~dp0"
".venv\Scripts\python.exe" -c "import fastapi, uvicorn" >nul 2>&1 || goto novenv
".venv\Scripts\python.exe" build_exe.py || goto fail
pause
exit /b

:novenv
echo Run run.bat once first: it sets up the Python environment this build uses.
pause
exit /b 1

:fail
echo.
echo The build failed (see the messages above).
pause
exit /b 1
