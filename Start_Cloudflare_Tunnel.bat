@echo off
cd /d "%~dp0"
title CareersCloud LMS - Cloudflare Public Tunnel
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-tunnel.ps1"
