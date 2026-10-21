@echo off
rem Step 1/2: create the remote locally and push.
rem Prerequisite: the GitHub repository must already exist (see PUBLISH.md).
rem ASCII-only on purpose; paths come from %~dp0.
setlocal
set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"

echo Remote status:
git remote -v
echo.

git remote add origin https://github.com/ssstarl/dsh-pet-speak.git 2>nul
git branch -M main
echo Pushing to https://github.com/ssstarl/dsh-pet-speak ...
git push -u origin main
if errorlevel 1 (
  echo.
  echo Push failed. Most likely the remote repo does not exist yet, or you cancelled the login.
  echo Create it first: https://github.com/new  ^(name: dsh-pet-speak, Public, no README^)
  pause
  exit /b 1
)

echo.
echo Done. Next: run publish-npm.cmd
pause
