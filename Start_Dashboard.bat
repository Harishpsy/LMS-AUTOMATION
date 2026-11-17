@echo off
cd /d "%~dp0"
title LMS Quiz Automation Server
cls
echo ================================================================
echo       LMS QUIZ AUTOMATION DASHBOARD - INTERACTIVE DESKTOP
echo ================================================================
echo.
echo Starting server on your active Windows desktop...
echo Web UI will be accessible at: http://localhost:3001
echo.
echo Chrome windows will now open VISIBLY on your screen!
echo.
echo ================================================================
timeout /t 2 >nul
start http://localhost:3001
node src/server.js
pause
