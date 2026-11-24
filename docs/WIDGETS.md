# Writing a widget (SDK v1)

A widget is a folder with a manifest and an HTML entry point. It runs in a sandboxed iframe and can
only reach DeskForge through the SDK, and only with permissions the user approved.

```
public/widgets/my-widget/
  widget.json
  index.html
  widget.js
```
Register it by adding its folder name to `public/widgets/index.json`.

## widget.json

```json
{
  "id": "my-widget",
  "name": "My widget",
  "version": "1.0.0",
  "sdk": 1,
  "description": "One sentence shown in the consent dialog.",
  "entry": "index.html",
  "permissions": ["theme.read", "storage"],
  "layout": { "cols": 1, "height": 160 }
}
```
- `id`: 2-32 characters, `a-z 0-9 -`, starts with a letter. Must match the folder name.
- `entry`: a plain `.html` file name (no folders).
- `layout.cols`: 1 or 2. `layout.height`: 80-400 px.
- Adding a permission in a later version asks the user again.

## Permissions

| Permission | Allows | Methods |
|---|---|---|
| `theme.read` | Reading the current theme | `theme.get`, `theme.subscribe` |
| `system.read` | Processor, memory, network use | `system.get`, `system.subscribe` |
| `storage` | Up to 32 KB and 64 keys, private to the widget | `storage.get/set/delete` |
| `launcher.use` | App names and ids (never paths); starting them | `launcher.list`, `launcher.launch` |

## SDK

Include both scripts (relative paths, no inline scripts: the app's CSP blocks them):

```html
<link rel="stylesheet" href="../../sdk/deskforge-widget.css">
<script src="../../sdk/deskforge-sdk.js"></script>
<script src="widget.js"></script>
```

All calls return promises. Errors have `.code` (`permission_denied`, `invalid_params`,
`rate_limited`, `timeout`, ...) and a readable `.message`.

```js
deskforge.theme.follow();                       // keep CSS variables in sync with the app theme
deskforge.theme.get();                          // { tokens, cssVars }
deskforge.theme.subscribe(cb);                  // cb(payload) now and on every change; resolves an unsubscribe fn

deskforge.system.get();                         // { cpuPercent, memUsed, memTotal, netRxBytes, netTxBytes, timestampMs }
deskforge.system.subscribe(cb);

deskforge.storage.get("key");                   // value or null
deskforge.storage.set("key", { any: "json" });
deskforge.storage.delete("key");                // keys: start with a letter, a-z A-Z 0-9 . _ -, max 48

deskforge.launcher.list();                      // [{ id, name }]
deskforge.launcher.launch("app-1");
```

CSS variables available after `theme.follow()`: `--bg --surface --text --accent --on-accent --radius --space --font-size --font`
(plus `--muted` and `--line`, defined by `deskforge-widget.css`).

## Sandbox facts

- `sandbox="allow-scripts"` without `allow-same-origin`: the widget has an opaque origin. It cannot touch the app's DOM,
  cookies, storage, or Tauri IPC.
- Requests are limited to 30 per second sustained (burst 60).
- Widgets can't resize themselves, open windows, or submit forms.

## Not in SDK v1

Installable third-party packages (zip import and signing), wallpaper control, and background images. The
`sdk` field in the manifest exists so these can be added without breaking v1 widgets.

## Hover reporting

The SDK tells the host when the pointer is over the widget (a one-way notification, no permission needed). DeskForge
uses it to show the move and resize controls on desktop widgets. A widget that doesn't load the SDK still works, but
its controls only appear when the pointer is near them.

## Weather (permission `weather.read`)

```js
deskforge.weather.search("Paris");                 // [{ name, region, country, lat, lon }] (at most 5)
deskforge.weather.get(48.86, 2.35, "c");           // { temperature, apparent, humidity, windSpeed, weatherCode, isDay, units, updatedMs }
```

The host does the network request, not the widget. Search text must be 2-60 characters, coordinates are range-checked and
rounded to about 1 km, results are cached for 10 minutes. The user sees what the permission means before adding the widget.

## Look variables

Besides the theme variables, widgets receive `--bg-alpha` (the saved 0-100 background setting) and `--bg-opacity` (the
rendered CSS percentage, combining background and tint opacity while glass is enabled),
`--frame` (0 or 1, the border and corner marks), `--frame-opacity` (0% or 100%), `--body-shadow` and the adaptive
`--glass-*` surface, text, border, reflection, shadow and radius variables. Glass is disabled by default and each widget
stores its own look. A null widget tint follows the Windows/WebView light or dark scheme; a custom tint is used by both
the native window tint and the frontend glass surface. Tint opacity and reflection level are independent. `deskforge-widget.css`
uses these variables; custom HUD CSS can override them. If native composition is unavailable, the desktop widget window
uses the saved tint as a translucent CSS fallback and reports the native failure in the settings UI.

## Widget layout editing

Pinned widgets can be edited directly on the desktop: hover a widget and select the pencil control. Drag an outlined
element to reposition it; the in-widget panel can reorder layers and adjust scale, opacity, and text size, color, and
alignment. Changes save automatically. Layouts are stored per widget in `widgets:layout` and are sent to the sandbox
through the existing theme channel; the host never reads or mutates iframe DOM. Widget authors opt elements into editing
with `data-df-layout`, `data-df-layout-label`, and `data-df-layout-kind` (`text`, `visual`, or `interactive`). Unmarked
controls and content remain untouched. Existing built-in widgets and custom HUD parts have editable markers; outlined
elements are temporarily covered by drag handles while edit mode is active.
