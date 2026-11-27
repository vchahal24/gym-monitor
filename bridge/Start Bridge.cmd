@echo off
setlocal
title GymTracker - Bridge
cd /d "%~dp0"
uv run --python 3.11 server.py %*
if errorlevel 1 pause
