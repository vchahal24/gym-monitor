@echo off
setlocal
title GymTracker - Live Zigbee Activity
cd /d "%~dp0"
uv run --python 3.11 coordinator.py %*
if errorlevel 1 pause
