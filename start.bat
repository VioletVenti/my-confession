@echo off
rem ============================================================
rem  Pure-ASCII launcher.
rem  cmd.exe parses .bat files byte-by-byte in the OEM codepage,
rem  so ANY non-ASCII character here would corrupt the next line.
rem  All Chinese messages live in server.js (Node outputs UTF-8).
rem ============================================================
chcp 65001 >nul
cd /d "%~dp0"
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo [X] node.exe not found.
  echo     Install Node.js 22.5 or newer from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo [OK] Node %NODEVER%

if "%PORT%"=="" set PORT=8080
echo [OK] PORT=%PORT%   ^(to change: set PORT=9000 ^&^& run this file^)

if not exist "data" mkdir data
if not exist "config.json" echo [..] first run: generating admin token

echo.
node server.js

echo.
echo Server stopped.
pause
