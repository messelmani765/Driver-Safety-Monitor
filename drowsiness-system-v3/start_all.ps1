# Lance TOUT le projet dans des fenêtres PowerShell séparées.
#   .\start_all.ps1                     -> serveur + 3 voitures simulées (sans webcam)
#   .\start_all.ps1 -Webcam             -> serveur + détecteur avec ta webcam (moteur auto)
#   .\start_all.ps1 -Webcam -Engine mediapipe
#   .\start_all.ps1 -Vehicles 5 -Fast   -> 5 voitures, scénario court (test rapide)
# Si Mosquitto n'est pas installé, tout marche quand même (envoi par HTTP).
param(
    [switch]$Webcam,
    [int]$Vehicles = 3,
    [switch]$Fast,
    [string]$Engine = "auto"
)
$root = $PSScriptRoot
$mosq = "C:\Program Files\mosquitto\mosquitto.exe"
$useMqtt = Test-Path $mosq
$py = "python"

if ($useMqtt) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$mosq' -c '$root\mosquitto\mosquitto.conf' -v"
    Start-Sleep -Seconds 2
} else {
    Write-Host "Mosquitto non trouvé: j'utilise HTTP à la place (ça marche pareil)." -ForegroundColor Yellow
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\server'; $py -m uvicorn server:app --host 0.0.0.0 --port 8000"
Start-Sleep -Seconds 4

$transport = if ($useMqtt) { "mqtt" } else { "http" }
if ($Webcam) {
    $cmd = "cd '$root\detector'; $py detector_eyes.py --show --engine $Engine --transport $transport"
} else {
    $flags = "--vehicles $Vehicles"
    if (-not $useMqtt) { $flags += " --http" }
    if ($Fast) { $flags += " --fast" }
    $cmd = "cd '$root\detector'; $py fake_driver.py $flags"
}
Start-Process powershell -ArgumentList "-NoExit", "-Command", $cmd

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))' } | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "Site sur le PC       : http://localhost:8000   (Ctrl+F5 pour recharger)" -ForegroundColor Green
if ($ip) {
    Write-Host "Site sur le téléphone: http://${ip}:8000" -ForegroundColor Green
    Write-Host "App Flutter, adresse : ${ip}:8000" -ForegroundColor Green
}
Write-Host "Première fois: Windows demande d'autoriser Python sur le réseau -> clique 'Autoriser' (réseau privé)." -ForegroundColor Yellow
