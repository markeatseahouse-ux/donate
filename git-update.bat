@echo off
set "GIT_PATH=C:\Program Files\Git\cmd\git.exe"
if not exist "%GIT_PATH%" (
    set "GIT_PATH=C:\Program Files (x86)\Git\cmd\git.exe"
)

echo [+] Staging updates...
"%GIT_PATH%" add .

echo [+] Committing updates...
"%GIT_PATH%" commit -m "fix profanity filter false positives on safe words like yom and remove short pronouns from defaults"

echo [+] Pushing to GitHub...
"%GIT_PATH%" push

echo [+] Done!
