@echo off
title FOLD Motion
cd /d "%~dp0"

rem First run on a PC without Node.js or FFmpeg: fetch portable copies into .runtime
rem (no installer, no admin rights). Existing installs of Node.js 20+ and FFmpeg are used as-is.
echo Checking Node.js and FFmpeg...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\setup-runtime.ps1" -Root "%~dp0."
if errorlevel 1 (
  echo.
  echo If this keeps failing, install the LTS version of Node.js from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem Portable copies (if downloaded) come first on PATH for this window only.
set "PATH=%~dp0.runtime\node;%~dp0.runtime\ffmpeg\bin;%PATH%"

where node >/dev/null 2>nul
if errorlevel 1 (
  echo Node.js could not be found. Install the LTS version from https://nodejs.org, then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node scripts\launch-studio.mjs
if errorlevel 1 pause
