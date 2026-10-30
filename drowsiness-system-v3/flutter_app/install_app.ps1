# Copie l'app dans le projet Flutter, règle Android, puis installe sur le téléphone.
#   .\install_app.ps1                      (valeurs par défaut)
#   .\install_app.ps1 -Device 224592bc     (autre téléphone: flutter devices)
param(
    [string]$Dest = "C:\dev\drowsiness_app",
    [string]$Device = "224592bc"
)
$src = $PSScriptRoot
if (-not (Test-Path $Dest)) {
    Write-Host "Le dossier $Dest n'existe pas. Je crée le projet Flutter..." -ForegroundColor Yellow
    $parent = Split-Path $Dest -Parent
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Set-Location $parent
    flutter create --project-name drowsiness_app (Split-Path $Dest -Leaf)
}
New-Item -ItemType Directory -Force -Path "$Dest\lib", "$Dest\assets" | Out-Null
Remove-Item "$Dest\lib\*" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$src\lib\*" "$Dest\lib\" -Recurse -Force
Copy-Item "$src\assets\*" "$Dest\assets\" -Force
Copy-Item "$src\pubspec.yaml" "$Dest\pubspec.yaml" -Force
& "$src\patch_manifest.ps1" -Dest $Dest
Set-Location $Dest
flutter pub get
flutter run -d $Device
