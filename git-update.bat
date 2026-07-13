@echo off
set GIT="C:\Program Files\Git\cmd\git.exe"
%GIT% add .
%GIT% commit -m "fix: remove duplicate const users declaration causing SyntaxError crash"
%GIT% push
echo Done!
