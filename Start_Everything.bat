@echo off
cd /d "%~dp0"
title CareersCloud LMS - Server & Permanent Tunnel
cls
echo ================================================================
echo       CAREERSCLOUD LMS - ALL-IN-ONE LAUNCHER
echo ================================================================
echo.
echo 1. Starting Backend Server on port 3001...
start "LMS Backend Server (Port 3001)" cmd /k "node src/server.js"
timeout /t 2 >nul

echo 2. Starting Permanent Public Tunnel...
echo    Permanent Link: https://woozy-coil-flaring.ngrok-free.dev
echo.
node scripts/run-ngrok.js
pause
