@echo off
title Stop Donate Overlay System
cd /d "%~dp0"

echo ============================================================
echo      Stopping Donate Overlay Server and Cloudflare Tunnel
echo ============================================================
echo.

echo [+] Stopping Node.js processes...
taskkill /f /im node.exe >nul 2>&1

echo [+] Stopping Cloudflare Tunnel processes...
taskkill /f /im cloudflared.exe >nul 2>&1

echo.
echo [+] Cleaning up temporary files...
if exist cloudflare.log del /f /q cloudflare.log
if exist donation-link.txt del /f /q donation-link.txt

echo.
echo [SUCCESS] Both Web Server and Tunnel have been stopped!
echo ============================================================
echo.
timeout /t 3
exit
