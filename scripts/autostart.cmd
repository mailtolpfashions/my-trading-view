@echo off
rem Starts My Trading View (feed + platform) without rebuilding, for the Windows scheduled task
rem "My Trading View autostart" (weekdays 08:35, wakes the PC from sleep). Does nothing if the feed is already
rem running on port 4001. Output goes to .userdata\autostart.log.
netstat -ano | findstr /R /C:":4001 .*LISTENING" >nul && exit /b 0
cd /d "%~dp0.."
if not exist .userdata mkdir .userdata
echo ===== %date% %time% start >> .userdata\autostart.log
call npm run platform:start >> .userdata\autostart.log 2>&1
