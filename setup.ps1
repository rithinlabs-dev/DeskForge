# DeskForge one-click setup. Run from the deskforge folder:
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($t) { Write-Host "`n== $t" -ForegroundColor Green }
function Fail($t) { Write-Host "`nSTOP: $t" -ForegroundColor Red; exit 1 }

Step "1/6 Checking project files"
$required = @(
  "package.json", "index.html", "desktop.html", "menu.html", "vite.config.ts", "tsconfig.json", "app-icon.png",
  "src\main.tsx", "src\App.tsx", "src\api.ts", "src\desktop.tsx", "src\menu.tsx", "src\tokens.ts",
  "src-tauri\Cargo.toml", "src-tauri\build.rs", "src-tauri\tauri.conf.json",
  "src-tauri\src\main.rs", "src-tauri\src\lib.rs", "src-tauri\src\desktop.rs", "src-tauri\src\menu.rs", "src-tauri\src\animated.rs", "src-tauri\src\blender.rs", "wallpaper.html", "fx.html", "src-tauri\src\images.rs", "src-tauri\src\b64.rs", "src\compose\model.ts", "src\ImageComposer.tsx", "src-tauri\src\glass.rs", "src\widgets\appearance.ts", "public\widgets\datetime\widget.js", "src-tauri\src\fx.rs", "src\fx\engine.ts", "src-tauri\src\backdrop.rs", "src-tauri\installer-hooks.nsh", "src-tauri\capabilities\fx-window.json", "src\widgets\glassWizard.ts", "src\widgets\GlassWizardPanel.tsx", "src\widgets\backdrop.ts", "src\widgets\useWallpaperBackdrop.ts", "src\compose\history.ts", "island.html", "src\images\removeBackground.ts", "src\images\BackgroundRemover.tsx", "src\shell.css", "src\system.tsx", "src\shell\Shell.tsx", "src\shell\nav.ts", "src\shell\Bento.tsx", "src\pages\OverviewPage.tsx", "src\island.tsx", "src\island\Island.tsx", "src\island\pomodoro.ts", "src\island\presets.ts", "src\island\style.ts", "src\island\config.ts", "src-tauri\src\island.rs", "src-tauri\src\nowplaying.rs", "src-tauri\capabilities\island-window.json",
  "src-tauri\capabilities\main.json", "src-tauri\capabilities\desktop-widget.json", "src-tauri\capabilities\menu-window.json",
  "public\sdk\deskforge-sdk.js", "public\widgets\index.json"
)
$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing) {
  Write-Host ($missing -join "`n")
  Fail "Those files are missing. Re-extract deskforge-full.zip into an EMPTY folder (don't mix in the smaller update archives)."
}
Write-Host "All $($required.Count) required files are present."

Step "2/6 Checking tools"
foreach ($cmd in "node", "npm", "cargo", "rustc") {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "'$cmd' not found. Install it, then open a NEW PowerShell window." }
}
Write-Host ("node " + (node --version) + " | npm " + (npm --version) + " | " + (rustc --version))
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$cpp = if (Test-Path $vswhere) { & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath } else { $null }
if (-not $cpp) { Fail "Visual Studio C++ Build Tools (Desktop development with C++) are not installed. Rust can't build without them." }
Write-Host "C++ build tools found."

Step "3/6 Installing npm packages (downloads from the internet)"
npm install
if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }

Step "4/6 Generating app icons"
if (-not (Test-Path "src-tauri\icons\icon.ico")) {
  npm run tauri icon app-icon.png
  if ($LASTEXITCODE -ne 0) { Fail "Icon generation failed." }
} else { Write-Host "Icons already exist." }

Step "5/6 Typecheck and tests"
npx tsc --noEmit
if ($LASTEXITCODE -ne 0) { Fail "TypeScript reported errors (see above)." }
npm test
if ($LASTEXITCODE -ne 0) { Fail "Tests failed (see above)." }

Step "6/6 Done"
Write-Host "Ready. Start the app with:  npm run tauri dev" -ForegroundColor Green
Write-Host "(The first run compiles Rust dependencies and takes several minutes.)"
