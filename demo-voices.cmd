@echo off
rem Demo: speak the same sentence with every installed zh-CN OneCore voice,
rem so you can pick the one you like. ASCII-only file on purpose.
cd /d "%~dp0"
echo Listing installed voices...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\speak-onecore.ps1" -ListVoices
echo.
echo Playing each zh-CN voice in turn (press ESC to skip one)...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\speak-onecore.ps1" -Demo
echo.
echo Done. Tell the assistant which voice you prefer.
pause
