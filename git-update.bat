@echo off
set GIT="C:\Program Files\Git\cmd\git.exe"
%GIT% add .
%GIT% commit -m "fix: toggleVerifyFields always re-enforces role-based API key visibility"
%GIT% push
echo Done!
