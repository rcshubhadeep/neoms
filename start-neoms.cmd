@echo off
setlocal
cd /d "%~dp0"
if exist "%~dp0.local\node-v24.7.0-win-x64\node.exe" set "PATH=%~dp0.local\node-v24.7.0-win-x64;%PATH%"
set "PATH=%LOCALAPPDATA%\Programs\DockerDesktop\resources\bin;%USERPROFILE%\.cargo\bin;%PATH%"
call npm run db:start >nul
if errorlevel 1 exit /b 1
call npm run setup:env
if errorlevel 1 exit /b 1
call npm run db:migrate
if errorlevel 1 exit /b 1
call npm run dev
