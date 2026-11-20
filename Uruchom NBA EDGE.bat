@echo off
title NBA EDGE
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Brak Node.js. Zainstaluj wersje LTS z https://nodejs.org i uruchom ponownie.
  pause
  exit /b 1
)
node scripts\run.mjs
pause
