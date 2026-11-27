@echo off
cd /d "%~dp0"
title LMS Quiz Automation Server
cls
echo ================================================================
echo       LMS QUIZ AUTOMATION DASHBOARD - INTERACTIVE DESKTOP
echo ================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

if not exist "node_modules\express" (
    echo [First-time setup] Installing Node.js dependencies ^(npm install^)...
    echo Please wait, this may take a minute...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. Check your internet connection and try again.
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed successfully!
    echo.
)

if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [Setup] Created .env from .env.example. Please update LMS_EMAIL and LMS_PASSWORD if needed.
        echo.
    )
)

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
