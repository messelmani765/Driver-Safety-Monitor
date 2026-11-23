<#
  Téléverse le code dans l'ESP32-CAM depuis un terminal (marche dans Antigravity, VS Code, PowerShell).
  Usage :   .\upload_esp32.ps1 -Port COM5
  Sans -Port : affiche la liste des ports pour que vous trouviez le bon.
  Avant le téléversement : GPIO 0 relié à GND, puis appuyez sur RST.
  Après le téléversement : retirez le fil GPIO 0 - GND, puis appuyez sur RST.
#>
param([string]$Port = "")

$ErrorActionPreference = "Stop"
$sketch = Join-Path $PSScriptRoot "esp32_cam_driver_safety"
$fqbn = "esp32:esp32:esp32cam"   # AI Thinker ESP32-CAM

if (-not (Get-Command arduino-cli -ErrorAction SilentlyContinue)) {
  Write-Host "arduino-cli est introuvable. Installez-le avec :  winget install ArduinoSA.CLI" -ForegroundColor Red
  Write-Host "(puis fermez et rouvrez le terminal)" -ForegroundColor Yellow
  exit 1
}

# 1ère fois seulement : ajoute la carte ESP32
arduino-cli config init 2>$null | Out-Null
arduino-cli config add board_manager.additional_urls https://espressif.github.io/arduino-esp32/package_esp32_index.json 2>$null | Out-Null
arduino-cli core update-index
if (-not (arduino-cli core list | Select-String "esp32:esp32")) {
  Write-Host "Installation de la carte ESP32 (long la 1ère fois)..." -ForegroundColor Cyan
  arduino-cli core install esp32:esp32
}

# Vérifie que le Wi-Fi a bien été renseigné
if (Select-String -Path (Join-Path $sketch "esp32_cam_driver_safety.ino") -Pattern "VOTRE_NOM_WIFI" -Quiet) {
  Write-Host "Ouvrez esp32_cam_driver_safety.ino et mettez votre nom Wi-Fi + mot de passe (lignes ssid / password)." -ForegroundColor Red
  exit 1
}

Write-Host "Compilation..." -ForegroundColor Cyan
arduino-cli compile --fqbn $fqbn $sketch

if (-not $Port) {
  Write-Host "`nPorts détectés :" -ForegroundColor Cyan
  arduino-cli board list
  Write-Host "`nRelancez avec :  .\upload_esp32.ps1 -Port COMx" -ForegroundColor Yellow
  exit 0
}

Write-Host "Téléversement sur $Port (GPIO 0 doit être relié à GND, puis RST)..." -ForegroundColor Cyan
arduino-cli upload -p $Port --fqbn $fqbn $sketch
Write-Host "`nTerminé. Retirez GPIO 0 de GND, appuyez sur RST, puis ouvrez le Moniteur Série (115200) pour lire l'IP." -ForegroundColor Green
Write-Host "Moniteur série :  arduino-cli monitor -p $Port -c baudrate=115200"
