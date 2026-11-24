# Decisions

Status: **decided** (built and in use), **open** (needs the owner's decision), **rejected**.

| # | Decision | Status |
|---|---|---|
| D1 | Stack: Tauri 2, React, TypeScript, Rust, Vite, CSS, NSIS installer | decided |
| D2 | Local-first: no cloud services, accounts or telemetry | decided |
| D3 | Widgets run in sandboxed iframes and reach the app only through a permission-checked bridge | decided |
| D4 | Custom CSS is validated and rejected (never "repaired") and only runs inside the widget sandbox | decided |
| D5 | Tauri commands are denied by default; each window gets its own small capability file | decided |
| D6 | Desktop widgets are separate frameless, transparent, always-on-bottom windows (interim: not yet behind icons) | decided (interim) |
| D7 | Chrome extension: dropped | rejected |
| D8 | **Storage format and location** (see below) | **open** |
| D9 | How animated wallpapers are rendered behind icons (WorkerW vs alternatives) | open |
| D10 | Media engine for MP4/WebM environments | open |

## D8: SQLite vs JSON files

The project instructions say "JSON-based local configuration initially" and "no databases unless requested".
The current build already uses SQLite (`rusqlite`, bundled) in `%APPDATA%\dev.deskforge.app\deskforge.db` for
settings, themes and the launcher list. It works and has migrations and tests, but it does not match those
instructions, and imported media will need real files on disk anyway.

Options:
- **A. Keep SQLite** for settings; add an `assets\` folder for media. Least work, nothing breaks.
- **B. Move to JSON files** under `%APPDATA%\DeskForge\` (`config.json`, `themes\`, `profiles\`, `assets\`), with
  a one-time import from the existing database. Matches the instructions, easier to back up and hand-edit.
- **C. Hybrid**: JSON for user-facing things (themes, profiles, layouts), SQLite only if it proves necessary.

Nothing has been changed. Choose before profiles and imported assets are built, because both depend on it.

## Phase 1 decisions

| # | Decision | Status |
|---|---|---|
| D11 | Desktop widgets use hover-only move/resize controls instead of an edit-mode overlay | decided |
| D12 | Move and resize stay explicit (pointer capture + `setPosition`/`setSize`), not the OS drag APIs. The earlier drag-region approach was unreliable on frameless, transparent windows; this one is confirmed to work | decided |
| D13 | Size limits: 68 px minimum, 16384 px maximum. Nothing else | decided |
| D14 | The SDK reports pointer hover to the host (one-way, no permission) because the host cannot see the pointer over a sandboxed iframe | decided |
| D15 | Widget frame (border, brackets) fades with the background slider, so 0% is fully clean. Per-widget glass/border options come in Phase 5 | decided |
| D16 | Legacy lock commands left in Rust, unused by the UI. Delete in a later cleanup | open |

## Phase 2 decisions

| # | Decision | Status |
|---|---|---|
| D17 | "Direct Blender rendering" is implemented as headless render-to-MP4 plus video playback, because Blender has no real-time desktop output and would need Blender on every PC | decided (changed from the brief, explained) |
| D18 | Wallpapers play in a normal WebView2 page via the `asset:` protocol (hardware-decoded H.264/VP9), scoped to `$APPDATA/media/**` | decided |
| D19 | Behind-icons placement uses WorkerW behind a mode setting, with a windowed fallback and a diagnostic | decided (experimental) |
| D20 | Win32 calls for the wallpaper window are hand-declared FFI, not the `windows` crate | decided |
| D21 | Wallpaper autostart is opt-in and skips itself once after an unfinished start | decided |
| D22 | Single (primary) monitor for now | open |

## Phase 3 decisions and the border fix

| # | Decision | Status |
|---|---|---|
| D23 | Root cause of the white widget border and the 300 px content width: the desktop window never styled the widget iframe (browser default 2px inset border, 300 px width). Fixed inline in `WidgetFrame` | decided |
| D24 | Unity assets are not imported directly (they need the Unity runtime). Replacement: DeskForge's own 2D particle engine plus a `.dfx` export workflow and an (untested) Unity editor script | decided (changed from the brief, explained) |
| D25 | Cursor position for a click-through overlay comes from Rust (`GetCursorPos`), requested by the overlay and only while an effect is enabled | decided |
| D26 | The overlay is always on top (a cursor trail belongs above windows); a "desktop layer only" option is deferred | open |

## Phase 5 (first part) decisions

| # | Decision | Status |
|---|---|---|
| D27 | Glass = Windows acrylic through `SetWindowCompositionAttribute`, because CSS cannot blur behind a transparent window. Blur radius is not adjustable (Windows decides); tint opacity is a separate native alpha setting and the glass-level slider controls frontend reflection | decided (changed from the brief, explained) |
| D28 | Appearance is per widget, with the global slider as the default for widgets that have no look of their own | decided |
| D29 | Weather: Open-Meteo (no account/key), fetched by the host only after the user approved `weather.read`; widgets still have no network. Place names and ~1 km coordinates are the only data sent | decided |
| D30 | CSP `connect-src` was widened to the two Open-Meteo hosts. Everything else stays blocked | decided |
| D31 | Image layering (5.1/5.2) and custom fonts (5.5) are next; both need a file pipeline like the media library | open |

## Fixes and Phase 5 images

| # | Decision | Status |
|---|---|---|
| D32 | Glass fix: Windows needs accent flag 2 with blur/acrylic (it was 0); acrylic falls back to plain blur; turning glass on lowers a solid background to 30% because glass shows through it; the result or error is now shown | decided |
| D33 | Cursor trail bug: a still cursor re-created a point after the trail faded (found by the owner's test run). The trail now tracks where a point was last added | decided |
| D34 | Compositions are drawn in the app (canvas) and only the finished PNG goes to Rust, validated by signature and size | decided |
| D35 | Library images reach the editor as data URLs so the canvas can be exported without depending on cross-origin headers | decided |
| D36 | Using a composition replaces the Windows wallpaper and is not undone by DeskForge; only the two newest renders are kept | decided |
| D37 | Custom fonts (5.5) are next; they need a file pipeline and a way to load a font inside the widget sandbox | open |
| D38 | Glass Effect Wizard: glass is a ladder of methods (acrylic, blur, Windows 11 backdrop, mica) plus a "sheen" kind meaning no native effect. Rust reports the real Windows build (RtlGetVersion) and which methods the build supports; the Look panel tests each method on the real widget and the user picks by eye, because "Windows accepted the call" does not prove the effect is visible. The translucent sheen (CSS) is the guaranteed fallback. Default stays acrylic so existing saved looks do not change | decided; needs a test on a real PC |
| D39 | "Frosted wallpaper" glass: when native glass is refused or not visible, DeskForge draws a blurred slice of the real wallpaper behind the widget itself. Rust copies the current wallpaper (found with SPI_GETDESKWALLPAPER, checked by file signature, max 48 MB) into the media folder so the page loads it through the asset protocol, and reports window and monitor geometry in physical pixels; only desktop widget windows may ask. CSP img-src gains http://asset.localhost for this. Limits: assumes the "Fill" picture position, uses the wallpaper of the primary display for every monitor, and shows the static wallpaper only (not windows, icons or the animated wallpaper) | decided; needs a test on a real PC |
| D40 | Cursor trail smoothness: asking Rust for the cursor once per drawn frame tied the trail to IPC timing. A sampler thread now reads the cursor about every 4 ms while the overlay runs (with 1 ms Windows timer resolution, restored when it stops), timestamps each change, and the page collects batches; polling and drawing are separate loops, so each sample lands in the trail at its true age and drawing happens once per display frame. Samples under 3 px apart are thinned. The old single-position command stays. Not changed: primary monitor only, canvas still at CSS-pixel resolution | decided; needs a test on a real PC |
| D41 | Image composer upgrades: on-canvas handles (corner squares resize about the layer centre, a circle above the top edge rotates and snaps to 15° unless Alt is held); drag-to-reorder in the layer list (the arrow buttons stay for keyboard use; the main window sets dragDropEnabled false because Tauri otherwise swallows HTML5 drag-and-drop on Windows); undo/redo for every edit with bursts from one gesture merged into a single step (Ctrl+Z, Ctrl+Y); and "Restore previous wallpaper": before replacing the Windows wallpaper DeskForge copies the old one to media/wallpapers/previous.<ext> (kept once, so restore always returns to the original) | decided; needs a test on a real PC |
| D42 | Floating island: a transparent always-on-top pill at the top-centre of the primary monitor that opens into Music, Focus (Pomodoro) and Tools tabs. Music uses the Windows media session API (SMTC) through the `windows` crate on a dedicated COM thread, not the Spotify Web API: no login, key or Premium, and it also works for any other player. The window is only as big as the page asks (collapsed or open), grows before the animation and shrinks after it, and hides while a fullscreen app runs. The Pomodoro state stores `endsAt` rather than a countdown, so it survives throttling and restarts. The island window is a trusted first-party page with its own capability (settings, launcher list/launch, volume and media keys) | decided; needs a test on a real PC |
| D43 | Island customisation: every look and behaviour choice lives in the one `island:config` record (position, appearance, content, behaviour), read through a sanitiser that clamps every value and upgrades old records, so nothing hand-edited can break it. Appearance becomes `--isl-*` CSS variables; surfaces and muted text are mixed from the text colour so light and dark looks both work. Position is one of eight anchors on a chosen monitor plus offsets, measured by Rust (so the window stays on its monitor and grows away from its edge; bottom anchors open the panel upwards); dragging the pill (when unlocked) rewrites the offsets. Presets cover appearance and content only, never position or behaviour, and are shared as pasted JSON (no file dialogs, no new commands) | decided; needs a test on a real PC |
| D44 | App shell: the single long page is now eight sections (Overview, Appearance, Widgets, Wallpaper, Images, Effects, Island, This PC) behind a sidebar that can shrink to icons, with Apple-style large page titles and a bento grid of cards (12 columns, folding to 6 and 1). The address (#/widgets) and the last page are remembered, and Ctrl+1..8 jump between pages. Cards reveal on scroll with an IntersectionObserver (visible from the start with reduced motion or no observer); the top bar shows a compact title once the big one scrolls away, using transforms and opacity only so the layout never jumps. All of it is scoped to `.shell` and `body.shell-mode`, so the desktop menu window that shares styles.css is unchanged, and every colour still comes from the theme tokens so all templates work. Undo/redo of the look is now only active on Appearance, which fixes it also undoing while the image composer was focused | decided; needs a test on a real PC |
| D45 | Background removal is colour-based and runs entirely in the webview on a plain RGBA array (flood fill from the border with a queue, so large pictures cannot overflow the stack; optional edge trim and a soft edge that only fades the subject inward, so no halo of background colour). No AI model, upload or online service: a model would be a large download and the feature would no longer be offline, and the limit (it cannot cut a subject out of a busy photograph) is stated in the UI, README and changelog. The result is saved as a NEW PNG through `image_save_png`, which checks the PNG signature and the 25 MB library limit, and the original is kept | decided |
