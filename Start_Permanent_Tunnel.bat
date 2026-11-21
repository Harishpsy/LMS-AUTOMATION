@echo off
cd /d "%~dp0"
title CareersCloud LMS - Permanent Public Tunnel
cls
echo ================================================================
echo       CAREERSCLOUD LMS - PERMANENT PUBLIC TUNNEL
echo ================================================================
echo.
echo Starting permanent tunnel on your static domain...
echo.
node scripts/run-ngrok.js
pause
