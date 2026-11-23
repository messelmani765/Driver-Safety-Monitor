@echo off
REM Double-clic = lance TOUT le projet : serveur web + detecteur IA connecte a l'ESP32-CAM.

set SCRIPT=%~dp0start_all.ps1
if exist "%~dp0drowsiness-system-v3\start_all.ps1" set SCRIPT=%~dp0drowsiness-system-v3\start_all.ps1

REM IP de l'ESP32-CAM (10.55.27.200 sur le partage de connexion Redmi Note 13)
set ESP32_IP=10.55.27.200

echo ========================================================
echo   Lancement Driver Safety Monitor (ESP32-CAM + Web)
echo   IP ESP32-CAM : %ESP32_IP%
echo ========================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" -Esp32 %ESP32_IP%
pause
