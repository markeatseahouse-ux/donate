@echo off
set "GIT_PATH=C:\Program Files\Git\cmd\git.exe"
"%GIT_PATH%" add .
"%GIT_PATH%" commit -m "move minDonateAmount into standalone form with own save button so it saves independently"
"%GIT_PATH%" push
echo [+] Done!
