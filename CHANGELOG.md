# Changelog

## 1.0.0

The first full release of DeskForge.

### The app
- A new layout: a sidebar with eight sections (Overview, Appearance, Widgets, Wallpaper, Images, Effects, Island, This PC), large page titles and a bento-grid dashboard. Cards fade in as they scroll into view. Ctrl+1 to Ctrl+8 jump between sections, Ctrl+B shrinks the sidebar, and the app remembers the page you were on.
- Overview with live tiles for processor, floating island, wallpaper, cursor effects, pinned widgets and theme.
- Design tokens (colours, gradient background, fonts, spacing, roundness) with live preview and undo/redo, 36 starter templates, saved themes, and `.dftheme` import and export.

### Floating island
- A pill on your screen with music controls for Spotify (or any player, no login), a Pomodoro focus timer with a task label and daily count, and quick tools (volume keys, launcher apps, CPU and memory).
- Fully customisable: looks and presets you can save and share, colours, size, shape, font, animation, any of eight anchor points on any monitor (or drag it), what the pill shows, which tabs exist and what is in them, and when it opens, closes and hides.

### Desktop
- Widgets in sandboxed iframes with a permission-checked bridge, pinned to the desktop as frameless transparent windows. Per-widget glass, border and shadow, and custom HUDs from your own CSS.
- Glass Effect Wizard: tests acrylic, blur and the Windows 11 backdrop and Mica on your PC and lets you pick what looks right, with a frosted-wallpaper fallback that works everywhere.
- Smoother cursor trail: the cursor is sampled in Rust and timestamped, so trails don't depend on message timing.
- Animated wallpapers (MP4 or WebM behind your icons), with optional Blender render-to-video.
- Image library with background removal (colour-based, entirely on your PC: pick the colour, set the tolerance, soften or trim the edge, preview on a checkerboard, save as a new transparent PNG) and a layered composition editor with on-canvas resize and rotate handles, drag-to-reorder layers, undo/redo, and "use as wallpaper" with "restore previous wallpaper".

### Under the hood
- Tauri 2, React, TypeScript, Rust and SQLite.
- An installer built with NSIS (current user, no administrator prompt), a GitHub workflow that builds it, and uninstall cleanup of the start-up entry.
- Unit tests for the TypeScript and Rust logic, run by CI on every push.

### Known limits
- Background removal is colour-based: it works well on logos, products and drawings with a plain background, but it cannot cut a subject out of a busy photograph (that needs an AI model).
- The installer is not code-signed, so Windows SmartScreen shows a warning until it builds reputation.
- The frosted-wallpaper glass assumes the "Fill" wallpaper position and shows the static wallpaper only.
- There are no automatic updates yet.
