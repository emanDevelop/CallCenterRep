@echo off
rem Starts the Pipecat OpenAI Realtime voice demo from any folder.
rem Then open http://localhost:7860/client/ in Chrome or Edge and click Connect.
netstat -ano | findstr /R /C:":7860 .*LISTENING" >nul && (
    echo The demo is already running. Open http://localhost:7860/client/
    exit /b
)
cd /d "C:\pipecat-demo\pipecat"
"%USERPROFILE%\.venvs\pipecat\Scripts\python.exe" examples\realtime\realtime-openai.py
