@echo off
setlocal
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer: https://nodejs.org/en/download
  echo Then close this window and run Start-POTOK.cmd again.
  pause
  exit /b 1
)
node "%~dp0app\scripts\review-start.mjs" %*
set "potokExit=%ERRORLEVEL%"
if not "%potokExit%"=="0" pause
exit /b %potokExit%
