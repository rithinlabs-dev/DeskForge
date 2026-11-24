# Builds DeskForge into a Windows installer (.exe). Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($t) { Write-Host "`n== $t" -ForegroundColor Green }
function Fail($t) { Write-Host "`nSTOP: $t" -ForegroundColor Red; exit 1 }

if (-not (Test-Path "package.json") -or -not (Test-Path "src-tauri\tauri.conf.json")) {
  Fail "Run this from the folder that contains package.json and src-tauri."
}
foreach ($cmd in "node", "npm", "cargo") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "'$cmd' not found. Install it and open a NEW PowerShell window." }
}

if (Get-Process deskforge -ErrorAction SilentlyContinue) {
  Write-Host "Closing the running DeskForge so it can't lock build files..." -ForegroundColor Yellow
  Get-Process deskforge | Stop-Process -Force
}

Step "1/5 npm packages"
if (-not (Test-Path "node_modules")) {
  npm install
  if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
} else { Write-Host "Already installed." }

Step "2/5 App icons"
if (-not (Test-Path "src-tauri\icons\icon.ico")) {
  if (-not (Test-Path "app-icon.png")) { Fail "app-icon.png is missing; put a square PNG (512x512+) in this folder." }
  npm run tauri icon app-icon.png
  if ($LASTEXITCODE -ne 0) { Fail "Icon generation failed." }
} else { Write-Host "Icons already exist." }

Step "3/5 Typecheck and tests (a failed build is cheaper to catch here)"
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Fail "TypeScript reported errors (see above). Paste them to get a fix." }
npm test
if ($LASTEXITCODE -ne 0) { Fail "Tests failed (see above)." }
cargo test --manifest-path src-tauri\Cargo.toml
if ($LASTEXITCODE -ne 0) { Fail "Rust tests failed (see above)." }

Step "4/5 Building the installer. First build takes 10-20 minutes; keep the window open."
npm run tauri build
if ($LASTEXITCODE -ne 0) { Fail "The build failed (see the red lines above). Paste them to get a fix." }

Step "5/5 Result"
$installer = Get-ChildItem "src-tauri\target\release\bundle\nsis" -Filter "*-setup.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$app = Join-Path $PWD "src-tauri\target\release\deskforge.exe"
if ($installer) {
  Write-Host "Installer: $($installer.FullName)" -ForegroundColor Green
  Write-Host ("Size: {0:N1} MB   SHA-256: {1}" -f ($installer.Length / 1MB), (Get-FileHash $installer.FullName -Algorithm SHA256).Hash)
  Start-Process explorer.exe -ArgumentList "/select,`"$($installer.FullName)`""
} else {
  Write-Host "No installer found in src-tauri\target\release\bundle\nsis (NSIS may have failed to download; see output above)." -ForegroundColor Yellow
}
if (Test-Path $app) { Write-Host "Standalone app (no installer): $app" }
Write-Host "Windows may show a 'protected your PC' warning: the installer isn't code-signed."
