@echo off
REM Double-clic = lance SEULEMENT le site web (serveur). Pas de detection, pas d'ESP32.
REM Pour la detection avec l'ESP32-CAM, utilisez demarrer_esp32.bat a la place.

set SERVER_DIR=%~dp0server
if exist "%~dp0drowsiness-system-v3\server" set SERVER_DIR=%~dp0drowsiness-system-v3\server

cd /d "%SERVER_DIR%"
echo.
echo === Site web Driver Safety Monitor ===
echo Sur ce PC       : http://localhost:8000
echo Sur le telephone : http://IP_DU_PC:8000  (IP du PC ci-dessous)
echo Application APK  : IP_DU_PC:8000
echo.
ipconfig | findstr /c:"IPv4"
echo.
echo Pour arreter : fermez cette fenetre.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:8000"
python -m uvicorn server:app --host 0.0.0.0 --port 8000
pause
