@echo off
title Cloudflare Tunnel Launcher
cd /d "%~dp0"

echo [+] Checking environment...

:: FORCE DOWNGRADE: If the downloaded cloudflared.exe is the new version, we replace it with the stable v2024.4.0
:: We can check if a marker file exists. If not, delete the current exe to force download the stable version.
if exist cloudflared.exe (
    if not exist .stable_marker (
        echo [+] Replacing current cloudflared.exe with stable v2024.4.0...
        taskkill /f /im cloudflared.exe >nul 2>&1
        del /f /q cloudflared.exe
    )
)

:: Download stable cloudflared.exe if it doesn't exist
if not exist cloudflared.exe (
    echo [+] Downloading stable cloudflared.exe (v2024.4.0) from Cloudflare GitHub releases...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/cloudflare/cloudflared/releases/download/2024.4.0/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe'"
    
    if exist cloudflared.exe (
        echo stable_v2024.4.0 > .stable_marker
        echo [+] Download completed successfully!
    ) else (
        echo [ERROR] Failed to download cloudflared.exe. Please check your internet connection.
        pause
        exit /b
    )
)

:: Clear old logs and text links
if exist cloudflare.log del /f /q cloudflare.log
if exist donation-link.txt del /f /q donation-link.txt

:: Start cloudflared in the background and redirect output to cloudflare.log
echo [+] Starting Cloudflare Tunnel in the background...
start /b "" cloudflared.exe tunnel --protocol http2 --url http://localhost:3000 > cloudflare.log 2>&1

:: Poll cloudflare.log until trycloudflare.com URL appears, then extract it
echo [+] Waiting for Cloudflare to assign your public donation link...
powershell -Command "$count = 0; while (!(Select-String -Path 'cloudflare.log' -Pattern 'trycloudflare.com') -and $count -lt 30) { Start-Sleep -Milliseconds 500; $count++ }; if (Select-String -Path 'cloudflare.log' -Pattern 'trycloudflare.com') { $link = (Select-String -Path 'cloudflare.log' -Pattern 'https://[a-zA-Z0-9-]+\.trycloudflare\.com').Matches.Value; Set-Content -Path 'donation-link.txt' -Value $link; echo '========================================='; echo 'YOUR DONATION LINK IS CREATED:'; echo $link; echo '========================================='; Invoke-Item 'donation-link.txt' } else { echo '[ERROR] Failed to obtain tunnel link. Check cloudflare.log' }"

echo.
echo [+] Done! This command window will now automatically close.
echo [+] The tunnel will keep running in the background.
echo [+] To stop all processes, run 'stop-system.bat'.
echo.
timeout /t 5
exit
