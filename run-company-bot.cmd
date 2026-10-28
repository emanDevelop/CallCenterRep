@echo off
rem Starts the company customer-service voice bot (answers from company-info.txt).
rem Then open http://localhost:7860/ in Chrome or Edge and press the call button.
netstat -ano | findstr /R /C:":7860 .*LISTENING" >nul && (
    echo A demo is already running on port 7860. Close it first, then run this again.
    exit /b
)
cd /d "C:\pipecat-demo"
"%USERPROFILE%\.venvs\pipecat\Scripts\python.exe" server\bot.py
