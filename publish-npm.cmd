@echo off
rem Step 2/2: publish to npm. Run publish-git.cmd first.
setlocal
set "REPO=%~dp0"
if "%REPO:~-1%"=="\" set "REPO=%REPO:~0,-1%"
cd /d "%REPO%"

echo Checking npm login...
call npm whoami
if errorlevel 1 (
  echo.
  echo Not logged in. A browser window will open for npm login.
  call npm login
  if errorlevel 1 (
    echo npm login failed.
    pause
    exit /b 1
  )
)

echo.
echo Publishing dsh-pet-speak to npm...
call npm publish --access public
if errorlevel 1 (
  echo.
  echo Publish failed. Common causes:
  echo   - the version already exists on npm  ^(bump "version" in package.json^)
  echo   - the package name is taken
  pause
  exit /b 1
)

echo.
echo Published. Verify with: npm view dsh-pet-speak version
pause
