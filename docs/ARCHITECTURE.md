# Architecture

DeskForge is a Windows desktop customization app: Tauri 2 (Rust) + React + TypeScript.

```
React UI (main window, trusted)
  |  api.ts: typed wrappers, the only place that calls invoke()
  v
Tauri commands (src-tauri/src/commands.rs)   <- each one denied by default, granted in capabilities/main.json
  |
  +-- services/   monitor, wallpaper, launcher (traits; Windows implementations)
  +-- storage/    SQLite (WAL): settings, themes, launcher entries; append-only migrations
  +-- perf.rs     snapshot emitter thread, runs only while a window is visible

Widgets (untrusted-by-design, sandboxed iframes)
  iframe sandbox="allow-scripts"  --MessageChannel-->  widgets/bridge.ts  --> api.ts
```

## Modules

| Module | Where |
|---|---|
| M0 Shell | `src-tauri/src/lib.rs`, `tray.rs`, `tauri.conf.json`, `capabilities/` |
| M1 Core services | `src-tauri/src/services/`, `perf.rs` |
| M2 Design tokens + settings UI | `src/shared/tokens.ts`, `src/useTokenHistory.ts`, `src/App.tsx` |
| M3 Storage | `src-tauri/src/storage/` |
| M4 Theme packages | `src/shared/themePackage.ts` (`.dftheme` files) |
| M5 Widget host + SDK | `src/widgets/`, `public/sdk/`, `public/widgets/` |

## Security rules

1. Commands are declared in `build.rs` and granted per window. New window, no access.
2. Anything read from storage or a file passes a sanitizer (`sanitizeTokens`, `parsePackage`, `sanitizeGrants`, `parseManifest`) before use.
3. File dialogs run in Rust. The webview never chooses or sees a path.
4. Widgets never get `invoke`. They get the bridge: validated, rate limited, permission checked.
5. The launcher only runs registered `.exe` entries by id.

## Conventions

- Schema changes: append to `MIGRATIONS` in `storage/mod.rs`. Never edit old entries.
- Shared, pure TypeScript lives in `src/shared/` (no DOM, no Tauri) so it stays easy to test and reuse.
- Add a command: write it in `commands.rs`, list it in `build.rs`, grant it in `capabilities/main.json`, wrap it in `api.ts`.

## Desktop widgets (M6)

Pinning a widget opens a window labelled `dw-<widget id>` (`src-tauri/src/desktop.rs`) that loads `desktop.html`.
It is frameless, transparent, hidden from the taskbar and kept below other windows. That page runs the same
sandboxed `WidgetFrame` and bridge as the main window.

- Capabilities: `capabilities/desktop-widget.json` matches `dw-*` and grants read-only settings, scoped widget
  storage and the launcher. Nothing that writes settings, changes wallpaper or reads files.
- Widget data goes through `widget_store_load/save`, which reject any widget id other than the window's own.
- Layout lives in the `desktop:widgets` setting: logical size, physical position. Position and size are saved when you release the move or resize control.
- Polling: each window reports visibility under its own label, so system stats keep flowing for desktop widgets
  even while the main window is hidden in the tray.
- Known limits: Win+D may hide the windows; they sit below other windows but above the wallpaper layer and
  icons. Attaching to the desktop's `WorkerW` window is the planned follow-up.

### Per-widget look and glass (Phase 5.3)

See the Phase 5 section at the end of this file.

### Desktop widget iframe (root-cause note)

An unstyled iframe gets the browser's default `2px inset` border (in the text colour) and a 300 px width. The desktop
window never loaded the stylesheet that fixed this for the main window, which showed up as a white line around widgets
and content stuck at 300 px while the window grew. `WidgetFrame` now sets `border: 0; width: 100%` inline, so every
host page is correct without depending on a stylesheet.

### Desktop widget interaction (Phase 1)

- There is no edit mode and no overlay. Each desktop widget shows two small controls on hover: move (top right) and
  resize (bottom right). They are `pointer-events: none` while hidden, so they never block the widget.
- The pointer is invisible to the host while it is over the widget's iframe, so the SDK reports hover over the
  MessagePort (`{kind: "notify", name: "hover"}`); the host adds a 220 ms hide delay.
- Move and resize are explicit: pointer capture on the control, `setPosition` / `setSize` per animation frame, and one
  `desktop_commit_bounds` call on release to save position and size.
- Size limits are technical only: 68 px minimum (both controls must stay reachable), 16384 px maximum (WebView2/GPU
  surface). No aspect ratio, no cap at the old 1600x1200.
- Transparent means transparent: the widget frame (border and corner brackets) fades with the widget-background
  slider, so at 0% nothing but the widget's content is drawn. The window itself is already frameless, transparent
  and shadowless.
- Widgets are windows of the DeskForge process. Closing or minimizing the main window hides it and the process
  keeps running, so desktop widgets keep working. Only "Quit" in the tray exits the process.
- Legacy: `desktop_set_locked`, `desktop_set_all_locked` and `desktop_state` still exist in Rust but nothing in the UI
  calls them any more and they are no longer granted to any window except where listed in the capability files.

## Animated wallpaper and media (Phase 2)

- `media.rs`: the video library (`wallpaper:library` setting + files in the app data `media\` folder). Validates
  extension and file signature, enforces the size limit, uses a native picker. IDs are restricted; stored file names
  are re-checked to be plain names.
- `animated.rs`: owns the `wallpaper` window, the placement modes, the suspend thread and autostart. State: the active
  video in `wallpaper:active`, options in `wallpaper:config`.
- `desktop_layer.rs`: the WorkerW attach and z-order calls. Declared by hand (`extern "system"`) so they cannot be
  broken by a `windows` crate signature change.
- `sysstate.rs`: fullscreen-app and battery checks.
- `blender.rs`: optional headless render-to-video job (one at a time), progress events, cancel.
- `src/wallpaper.tsx` (page for the `wallpaper` window) only plays video from the `asset:` protocol, whose scope is
  limited to `$APPDATA/media/**`. The `wallpaper` window's capability grants `settings_get` and nothing else.
- CSP gained `media-src 'self' asset: http://asset.localhost`.

## Cursor effects (Phase 3)

- `fx.rs`: owns the `fx` overlay window (transparent, click-through, always on top, primary monitor, 1 px short of the
  monitor). `fx_cursor` returns the global cursor position relative to the overlay and a cached fullscreen flag.
  Only the `fx` window may call it (checked in the command and by capability).
- `src/fx.ts` is the overlay page; `src/fx/engine.ts` the pure simulation; `src/fx/config.ts` the settings, `.dfx`
  parser and sanitizers. The `fx` window's capability grants `settings_get` and `fx_cursor` only.

## Glass widgets and weather (Phase 5.3 / 5.4)

- `widgets/appearance.ts`: per-widget look (opacity, glass enable/type/level, tint and tint opacity, border, shadow) stored
  in `widgets:appearance`. Legacy `glass`, `kind`, `blur`, `border` and `shadow` values are sanitized into the current
  field names. A widget with no entry follows the global background slider.
- `glass.rs`: native frosted glass for pinned desktop windows. CSS cannot blur what is behind a transparent window, so it
  asks Windows for acrylic through `SetWindowCompositionAttribute` (looked up at run time; undocumented but widely used).
  Tint opacity is converted independently to the API's ABGR color; Windows chooses the blur radius, while glass level
  controls the frontend reflection. Acrylic falls back to blur, and a widget window can change only its own glass
  (`check_widget_scope`).
- `widgets/layout.ts` and `WidgetLayoutEditor.tsx`: sanitized, persistent per-widget element transforms. The SDK reports
  only explicitly marked element bounds over the existing private `MessageChannel`; the editor overlays those handles
  on the pinned desktop widget and sends per-widget layout data through the theme subscription without crossing the
  iframe security boundary.
- Weather never reaches a widget directly. A widget with the `weather.read` permission calls `weather.search` /
  `weather.get` over the bridge; the HOST window fetches from open-meteo.com (`widgets/weather.ts`), validates the answer,
  caches it for 10 minutes and returns only normalized fields. Coordinates are rounded to about 1 km. The CSP's
  `connect-src` allows exactly `api.open-meteo.com` and `geocoding-api.open-meteo.com`.
- The `datetime` widget keeps its settings (what to show, format, style, font, colour, place) in its own widget storage and
  edits them in an in-widget settings panel (hover, gear), so it works on the desktop without the main window.

## Images and compositions (Phase 5.1 / 5.2)

- `images.rs`: the image library (`images:library` setting + files in `media\images\`), validated by extension and
  signature, 25 MB limit. `image_data` returns a data URL; `compose_set_wallpaper` validates a PNG and sets it as the
  wallpaper. Heavy commands are `async` so they never block the UI thread. `b64.rs` is a small, tested base64 codec
  (no extra dependency).
- `compose/model.ts`: the pure, tested model (layers, sanitizers, hit-testing with rotation/scale/crop, reordering).
  `compose/render.ts` draws it. `ImageComposer.tsx` is the editor. Drafts live in `compose:current`, saved ones in
  `compose:library`.
- The earlier cursor-trail fix: a still cursor used to re-create a trail point forever after the trail faded, which
  also stopped the overlay from going idle. `TrailState` now remembers where a point was last added.
