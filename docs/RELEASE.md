# Releasing DeskForge

This is the path from "it works in `tauri dev`" to an installer you can give to someone else.

## 1. Before you build

- **Version:** the same number must be in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
  (the installer's file name comes from `tauri.conf.json`). They are all `1.0.0` now. Change all three together.
- **Checks:** `npx tsc --noEmit`, `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml` all pass.
  `build-exe.ps1` runs these for you and stops if one fails.
- **Icons:** `src-tauri/icons` exists (generated from `app-icon.png` by `npm run tauri icon app-icon.png`).

## 2. Build

Either on your PC:

```powershell
powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
```

or on GitHub: **Actions → Build installer → Run workflow** (or push a tag like `v1.0.0`). Download the
`deskforge-installer` artifact when it finishes.

The first local build takes 10–20 minutes (release builds use link-time optimisation). The script prints the installer
path, size and SHA-256 when it is done.

## 3. Test the built app, not just `tauri dev`

The built app differs from `tauri dev` in ways that matter: the real Content-Security-Policy applies, the pages are
served from the app itself instead of Vite, there is no F12 developer console, and a panic closes the app
(`panic = "abort"`). Use the checklists in the README, and in particular:

1. Install on a clean user account or a PC that has never had DeskForge.
2. The main window is not blank; templates, widgets, glass, the frosted wallpaper, cursor effects and the composer work.
3. Close and reopen: settings, pinned widgets and the composition draft come back.
4. Start-with-Windows (autostart) works and stops working after you turn it off.
5. Uninstall. DeskForge disappears from Settings → Apps, and the start-up entry is gone.

**Before uninstalling**, press "Restore previous wallpaper" in the composer if you used "Use as desktop wallpaper".
The composition file lives in DeskForge's data folder; if you also delete the app data when uninstalling, Windows is
left pointing at a file that no longer exists.

## 4. What the installer does

- Installs for the current user only (no administrator prompt) into `%LOCALAPPDATA%`.
- Needs the Microsoft WebView2 runtime. Windows 11 and up-to-date Windows 10 have it; if it is missing the installer
  downloads it (it needs internet in that case; `tauri.conf.json` → `bundle.windows.webviewInstallMode`).
- On uninstall, removes the start-up entry through `src-tauri/installer-hooks.nsh`.

## 5. Not done yet

- **Code signing.** The installer is unsigned, so Windows SmartScreen shows "Windows protected your PC" until the
  file builds reputation. Signing needs a code-signing certificate (or a signing service) and the Tauri `bundle.windows`
  signing settings; check the current Tauri and Microsoft documentation for the options available to you.
- **Automatic updates.** Needs `tauri-plugin-updater`, an update signing key, and somewhere to host the update manifest.
- **Release builds in CI on every change.** The `Build installer` workflow only runs when you ask it to, because a
  release build takes a long time.
