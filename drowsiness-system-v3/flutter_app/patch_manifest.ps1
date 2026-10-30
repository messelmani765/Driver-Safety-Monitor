# Ajoute dans AndroidManifest.xml: INTERNET, VIBRATE, WAKE_LOCK et usesCleartextTraffic (http:// et ws://)
param([string]$Dest = "C:\dev\drowsiness_app")
$mf = Join-Path $Dest "android\app\src\main\AndroidManifest.xml"
if (-not (Test-Path $mf)) { Write-Host "Manifest introuvable: $mf" -ForegroundColor Red; exit 1 }
$x = Get-Content $mf -Raw -Encoding UTF8
$changed = $false
foreach ($p in @("android.permission.INTERNET", "android.permission.VIBRATE", "android.permission.WAKE_LOCK")) {
    if ($x -notmatch [regex]::Escape($p)) {
        $line = '    <uses-permission android:name="' + $p + '"/>' + "`r`n    "
        $idx = $x.IndexOf("<application")
        $x = $x.Insert($idx, $line)
        $changed = $true
    }
}
if ($x -notmatch "usesCleartextTraffic") {
    $idx = $x.IndexOf("<application")
    $x = $x.Insert($idx + "<application".Length, ' android:usesCleartextTraffic="true"')
    $changed = $true
}
if ($changed) {
    Set-Content -Path $mf -Value $x -Encoding UTF8
    Write-Host "AndroidManifest.xml modifié (permissions + http autorisé)." -ForegroundColor Green
} else {
    Write-Host "AndroidManifest.xml déjà prêt." -ForegroundColor Green
}
