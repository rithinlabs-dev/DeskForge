# DeskForge

**Version 1.0.0** · see [CHANGELOG.md](CHANGELOG.md)

A modular desktop customization app for Windows: live theming, system monitoring, and sandboxed widgets.
Built with Tauri 2, React, TypeScript and Rust.

## Download

Get the latest installer from the [Releases page](https://github.com/rithinlabs-dev/DeskForge/releases/latest): `DeskForge_<version>_x64-setup.exe`. It installs for the current user and needs no administrator rights. Windows may show a SmartScreen warning because the installer is not code-signed yet: choose "More info", then "Run anyway". You can check the download against `SHA256SUMS.txt` on the same page.

## Features

- A clean app layout: a sidebar with eight sections (Overview, Appearance, Widgets, Wallpaper, Images, Effects, Island, This PC), large page titles, a bento-grid dashboard and scroll-triggered animations
- Design tokens (colors, gradient background, fonts, spacing, roundness) with live preview and undo/redo
- Saved themes, plus import/export as `.dftheme` files
- Live system stats that only poll while the window is visible
- Widgets running in sandboxed iframes behind a permission-checked bridge ([SDK docs](docs/WIDGETS.md))
- Pin widgets to the desktop: frameless, transparent windows below your other windows, restored at login
- Floating island: a pill on your screen that opens into music controls for Spotify (or any player, no login), a Pomodoro focus timer with a task label and daily count, and quick tools (volume keys, your launcher apps, CPU and memory). Fully customisable: looks and presets you can save and share, colours, size, shape, font and animation, any of eight anchor points on any monitor (or drag it where you want), what the pill shows, which tabs exist and what is in them, and how it opens, closes and hides
- Desktop image library with background removal (on your PC, nothing is uploaded) and a layered composition editor (drag handles to resize and rotate, drag layers to reorder, crop, opacity, undo/redo) that can become your Windows wallpaper, with "restore previous wallpaper" ([guide](docs/IMAGES.md))
- Per-widget glass (opacity, border, shadow) and a date/time/weather widget with independent toggles
- Glass Effect Wizard: tests acrylic, blur and the Windows 11 backdrop/Mica on your PC and lets you pick what looks right, with a "frosted wallpaper" fallback DeskForge draws itself that works on every Windows version
- Cursor effects: trail styles and particles that follow the pointer, with Unity-effect import via .dfx files ([guide](docs/EFFECTS.md))
- Animated wallpapers: play MP4/WebM behind your windows, optional Blender render-to-video ([guide](docs/WALLPAPER.md))
- 36 starter templates with live preview cards and background art (aurora, hex grid, starfield, matrix, ...)
- Menu mode: collapse the app into a small docked desktop menu (clock, stats, template switcher, widget pins)
- Custom HUDs from your own CSS file ([guide](docs/CUSTOM_HUDS.md)), resizable desktop widgets, adjustable glass background
- Local SQLite storage

## Privacy
DeskForge keeps everything on your PC. It has no account, no telemetry and no analytics.
The only network requests it makes come from the weather widget, which sends the city name or
coordinates you enter to Open-Meteo to look up a forecast. Music information is read locally from
Windows, and background removal runs locally. Your settings, images and themes are stored in
%APPDATA%\dev.deskforge.app.

## Getting started

Requires Windows 10/11, [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs), and the Visual Studio C++ Build Tools.

```powershell
npm install
npm run tauri icon path\to\icon.png   # first time only; commit the generated src-tauri\icons
npm run tauri dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run tauri dev` | Run the app with hot reload |
| `npm test` | Unit tests for the TypeScript (themes, widget bridge) |
| `npx tsc --noEmit` | Typecheck |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust tests (storage, glass, images, cursor sampler, wallpaper copy) |
| `npm run tauri build` | Build the Windows installer (`src-tauri\target\release\bundle\nsis`) |

## Project layout

```
src/                 React app
  shared/            pure TypeScript: token schema, .dftheme format
  widgets/           widget host: bridge, permissions, iframe glue
public/
  sdk/               widget SDK + base stylesheet
  widgets/           bundled widgets
src-tauri/           Rust: shell, services, storage
docs/                architecture and widget SDK
```

## Status

| Module | State |
|---|---|
| M0 Shell | done |
| M1 Core services | done |
| M2 Design tokens + settings UI | done |
| M3 Storage | done |
| M4 Theme packages | done |
| M5 Widget host + SDK | done |
| M6 Desktop widgets | done |
| M7 Glass wizard, frosted wallpaper | working in development builds |
| M8 Smoother cursor trail | working in development builds |
| M9 Composer handles, undo/redo, restore wallpaper, background removal | working in development builds |
| M10 Floating island (Spotify, Pomodoro, tools, customisation) | working in development builds |
| Installer | built by GitHub when a version tag is pushed (see [docs/RELEASE.md](docs/RELEASE.md)); not code-signed |

Next: build and test the installer, widgets attached behind the desktop icons, profiles and multi-monitor support, custom fonts, a media widget, installable widget packages.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it fits together.

## Build the Windows installer (.exe)

```powershell
powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
```

Output: `src-tauri\target\release\bundle\nsis\DeskForge_<version>_x64-setup.exe` (installs for the current user, no
admin prompt) and the standalone `src-tauri\target\release\deskforge.exe`. The first build takes 10-20 minutes and
needs internet (Rust crates and the NSIS tools). The installer is not code-signed, so Windows SmartScreen may warn.

Check the built app, not just `tauri dev`, because production applies the real Content-Security-Policy:

1. Templates apply and the background art shows.
2. Add Clock and Quick notes; they render and Quick notes keeps text after a restart.
3. Pin a widget to the desktop. Hover over it: a move icon (top right) and a resize icon (bottom right) appear. Hold either one to move or resize, release to save. With the background slider at 0% nothing but the content should be visible. Close the main window: the widget keeps working.
4. Menu mode opens, changes a template, and "open app" returns.
5. The tray icon works; closing the window keeps the app running.

## Check the animated wallpaper (built app or `tauri dev`)

1. Animated wallpaper > Import MP4 / WebM > Set as wallpaper. Leave Placement on "Automatic".
2. Read the message under the buttons: it says whether it ran "behind the desktop icons" or fell back to "windowed".
3. Your pinned widgets must stay visible above the video, and the move/resize icons must still work.
4. Open a fullscreen video or game: the wallpaper should pause within about 3 seconds and resume afterwards.
5. Stop wallpaper (or the tray item "Stop animated wallpaper") must bring your normal desktop back.

## Check the cursor effects

1. Cursor effects > Turn effects on. Move the mouse: a trail follows it. Turn effects off: it disappears.
2. Change the trail style, length, fade and colour; the overlay should update live.
3. Open Particles, enable them, pick "Sparks" and move the mouse. Try an imported .dfx effect.
4. Click through the desktop and other windows normally: the overlay must never block clicks.
5. Open a fullscreen video or game: the effects should vanish within about 2 seconds and return afterwards.
6. Leave the mouse still: Task Manager should show DeskForge using almost no CPU.

## Check glass and the date/time/weather widget

1. Add "Date, time & weather", pin it to the desktop, then open **Look** on its card in the app.
2. Set Background to 0%, tick off "border and corner marks": only the text should remain on the desktop.
3. Tick "glass": the wallpaper behind the widget should look frosted. Move the "Frosted tint" slider.
   Dragging or resizing a glass widget may feel slower; untick glass if it does.
4. Hover the widget and click the gear (top left). Untick time/date/weather one at a time; try 12-hour, seconds, fonts, colour.
5. Search for your city and pick it. DeskForge asks nothing more: you approved the weather permission when adding the widget.
6. Two widgets can have different looks (Look is per widget).

## Check the app layout

1. The window has a sidebar with eight sections (Overview, Appearance, Widgets, Wallpaper, Images, Effects, Island, This PC) and a large title for each page. Click through them: each page's cards fade and rise in as they scroll into view, and a compact title appears in the top bar once the big one scrolls away.
2. Ctrl+1 to Ctrl+8 jump between sections, and Ctrl+B shrinks the sidebar to icons only. Close and reopen DeskForge: it comes back on the same page.
3. Overview shows live tiles (processor, island, wallpaper, effects, pinned widgets, theme). The island and effects tiles have working on/off buttons.
4. Appearance: pick templates and change colours, shape and type; Undo and Redo (Ctrl+Z, Ctrl+Y) appear at the top right of that page only.
5. Turn off "Animation effects" in Windows (Settings, Accessibility, Visual effects): the cards then appear at once, without moving.

## Check the floating island

1. Open the **Floating island** panel and press "Turn the island on": a dark pill appears at the top centre of the screen showing the clock.
2. Start Spotify and play a song: the pill shows the track with moving bars. Rest the pointer on it (or click it): it opens with album art, progress and play/pause, next, previous. The volume buttons change your system volume.
3. Change song in Spotify: the island peeks open for a few seconds.
4. Focus tab: type a task, press Start. The pill turns into a countdown ring. Use a short focus time in the panel (for example 1 minute) to see a phase end: the island opens and beeps.
5. Tools tab: CPU and memory update, and your saved launcher apps open when clicked.
6. Start a fullscreen game or video: the island hides, and comes back afterwards.
7. Close and reopen DeskForge: the timer, task and today's count are still there.
8. Customising: in the Floating island panel try a built-in look, change the accent colour, size and corner roundness (the island changes live), move it to the bottom right (the panel should open upwards), and choose another monitor if you have one.
9. Untick "lock the position", then drag the closed pill somewhere else and release: it stays there after you close and reopen DeskForge. Press "Reset position" to put it back.
10. Remove the clock from the pill list, put "Current song" first, drop a tab, and "Save this look", then "Copy to share" and paste the text into the import box on the same panel.

## Check the glass wizard and frosted wallpaper

1. Pin a widget, open **Look**, tick glass, then open "Glass wizard" and press "Test every method". Watch the desktop widget:
   each method is shown for about a second and a half. Press "Use this" on the one that looks frosted.
2. Choose "Frosted wallpaper" as the glass type. The blur behind the widget should match your wallpaper at that spot.
3. Drag the widget around: the blurred slice should follow it. (It assumes the "Fill" wallpaper position, and shows the
   static wallpaper, not open windows.)
4. Change your Windows wallpaper: within about 30 seconds the frosted slice updates.

## Check the cursor trail

1. Turn cursor effects on and move the mouse in circles and fast lines: the trail should be smooth, with no flicker at its head.
2. Stop moving: the trail fades out completely and the CPU use drops to almost nothing.
3. Turn effects off: the overlay disappears.

## Check images and compositions

1. Desktop images and composition > Import image (try a large photo), then "Add as layer": it should fill the preview.
2. Import a second image (for example a logo with a transparent background) and add it: it appears centred and smaller, on top.
3. Drag the top layer in the preview to move it. Use Size, Rotation, Opacity, mirror and crop; use "fit to screen" and "fill screen".
4. Move layers up and down, duplicate one, delete one, and swap its image from the Image list.
5. Save composition, press New, then open the saved one from "open saved...". Close and reopen DeskForge: your last work is still there.
6. Use as desktop wallpaper: Windows should show the composition. Check sharpness at your screen's resolution.
7. Select a layer: squares appear on its corners and a circle above it. Drag a corner to resize, the circle to rotate
   (hold Alt to skip snapping to 15 degrees).
8. Drag a layer row in the list onto another to reorder it.
9. Press Undo (or Ctrl+Z) after a drag: the whole drag should undo in one step. Redo brings it back.
10. Press "Restore previous wallpaper": your wallpaper from before DeskForge changed it returns.
11. Import a logo or product photo on a plain background, press "Remove background" beside it, and watch the preview on the checkerboard. Raise or lower the tolerance, try "Pick from picture" and click the background, then "Save as new image": a new "(no background)" PNG appears in the library and your original is kept.
