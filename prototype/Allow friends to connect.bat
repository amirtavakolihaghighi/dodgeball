@echo off
rem Dodge & Parry: lets other computers on your network join the game, without turning
rem Windows Firewall off. Double-click it on the computer that runs the game (once is enough).
rem It asks Windows for administrator permission, then:
rem   1. allows connections to the game's ports (TCP 8000-8019) from your local network only,
rem      never from the internet, whether Windows calls this Wi-Fi "Public" or "Private";
rem   2. removes the "block" rules Windows made for the game's program earlier, when its
rem      "allow access" prompt was answered for private networks only (or cancelled).
rem "Allow friends to connect.bat check" only shows what it would do.
rem "Allow friends to connect.bat undo" removes the rule again.
setlocal
set "DP_DIR=%~dp0"
set "DP_MODE=%~1"
if /i "%DP_MODE%"=="check" goto run
net session >nul 2>&1
if not errorlevel 1 goto run
echo Asking Windows for administrator permission...
if "%DP_MODE%"=="" (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
) else (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -ArgumentList '%DP_MODE%' -Verb RunAs"
)
exit /b

:run
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s = [IO.File]::ReadAllText('%~f0'); Invoke-Expression $s.Substring($s.IndexOf('#PS' + 'START'))"
if /i not "%DP_MODE%"=="check" pause
exit /b

#PSSTART (PowerShell from here on; cmd never gets this far)
$ErrorActionPreference = 'Stop'
$name = 'Dodge & Parry'
$dir = $env:DP_DIR
$mode = "$env:DP_MODE".ToLowerInvariant()
$check = $mode -eq 'check'

# The programs that run the game's server here: the packaged app, or the Python behind .venv.
$programs = @()
foreach ($p in @((Join-Path $dir 'DodgeAndParry.exe'), (Join-Path $dir '.venv\Scripts\python.exe'))) {
  if (Test-Path -LiteralPath $p) { $programs += $p }
}
$cfg = Join-Path $dir '.venv\pyvenv.cfg'
if (Test-Path -LiteralPath $cfg) {
  $line = Get-Content -LiteralPath $cfg | Where-Object { $_ -match '^\s*home\s*=' } | Select-Object -First 1
  if ($line) {
    $python = Join-Path (($line -replace '^\s*home\s*=\s*', '').Trim()) 'python.exe'
    if (Test-Path -LiteralPath $python) { $programs += $python }
  }
}
$wanted = $programs | ForEach-Object { [IO.Path]::GetFullPath($_).ToLowerInvariant() }

$ours = @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)
$blocks = @(Get-NetFirewallRule -Direction Inbound -Action Block -ErrorAction SilentlyContinue | Where-Object {
  $app = ($_ | Get-NetFirewallApplicationFilter).Program
  $app -and $app -ne 'Any' -and ($wanted -contains [Environment]::ExpandEnvironmentVariables($app).ToLowerInvariant())
})
$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name): $($_.NetworkCategory)" })

if ($check) {
  Write-Host 'Programs that run the game here:'
  $programs | ForEach-Object { Write-Host "  $_" }
  Write-Host "Networks: $($profiles -join ', ')"
  Write-Host "Windows rules that block those programs: $($blocks.Count)"
  $blocks | ForEach-Object { Write-Host "  $($_.DisplayName) [$($_.Profile)]" }
  Write-Host "The '$name' rule exists already: $($ours.Count -gt 0)"
  return
}
$ours | Remove-NetFirewallRule
if ($mode -eq 'undo') {
  Write-Host "Removed the '$name' firewall rule."
  return
}
$blocks | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $name -Description 'Lets computers on your local network join Dodge & Parry (TCP 8000-8019). Made by "Allow friends to connect.bat".' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort '8000-8019' -RemoteAddress LocalSubnet -Profile Any | Out-Null
Write-Host ''
Write-Host 'Done. Computers on your local network can now join Dodge & Parry, and the firewall stays on.'
if ($blocks.Count) { Write-Host "Also removed $($blocks.Count) old Windows rule(s) that blocked the game's program." }
Write-Host 'To undo: run "Allow friends to connect.bat undo".'
