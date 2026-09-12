@echo off
title MythosTree Server
echo ================================================================
echo   MythosTree - Greek Mythology Genealogical Archive
echo ================================================================
echo   Starting local server at http://localhost:8000
echo   Direct auto-saving to data/characters.json is ACTIVE.
echo.
echo   - To test public Read-Only mode: http://localhost:8000/?readonly=1
echo   - To stop the server: Press Ctrl+C in this window.
echo ================================================================
echo.

:: Launch the user's default browser after half a second
start "" http://localhost:8000

:: Run the MythosTree Python server with direct save support
python server.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Server stopped or Python was not found.
    pause
)
