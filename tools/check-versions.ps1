# Fails (exit code 1) when the three version numbers that must agree do not:
#   package.json, src-tauri\Cargo.toml and src-tauri\tauri.conf.json.
# The installer's file name and the "version" Windows shows come from tauri.conf.json, so a mismatch makes the
# installer, the Rust crate and the npm package disagree about which release this is.
# Used by build-exe.ps1 and by the CI workflows. Run it yourself from anywhere:
#   powershell -ExecutionPolicy Bypass -File tools\check-versions.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$package = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
$tauri = (Get-Content (Join-Path $root "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
$match = Select-String -Path (Join-Path $root "src-tauri\Cargo.toml") -Pattern '^version\s*=\s*"([^"]+)"' | Select-Object -First 1
if (-not $match) {
  Write-Host "Could not find a version line in src-tauri\Cargo.toml." -ForegroundColor Red
  exit 1
}
$cargo = $match.Matches[0].Groups[1].Value

Write-Host "package.json $package | Cargo.toml $cargo | tauri.conf.json $tauri"
if ($package -ne $tauri -or $package -ne $cargo) {
  Write-Host "The versions differ. Make all three the same before building a release." -ForegroundColor Red
  exit 1
}
Write-Host "Versions agree: $package" -ForegroundColor Green
exit 0
