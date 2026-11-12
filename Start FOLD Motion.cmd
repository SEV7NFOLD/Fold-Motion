@echo off
title FOLD Motion
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from https://nodejs.org, then double-click this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
node scripts\launch-studio.mjs
if errorlevel 1 pause
