# Roadmap

Status of DeskForge at version 1.0.0, and what comes next.

| # | Milestone | State |
|---|---|---|
| 1 | Repository and architecture review | done (this file, DECISIONS.md and ARCHITECTURE.md) |
| 2 | Shared customization engine (tokens, themes, templates, undo/redo, import/export) | done |
| 3 | Widget and theme system (SDK v1, permissions, custom CSS HUDs) | done |
| 4 | Layout and profile management | partial: desktop widget positions and sizes and the island's position are saved. No profiles, no per-monitor layouts |
| 5 | Animated wallpaper and environment engine | done: MP4/WebM behind the icons (experimental) or windowed, optional Blender render-to-video |
| 6 | Windows desktop integration | partial: tray, autostart, always-on-bottom windows, fullscreen and battery awareness. Attaching desktop widgets behind the icons is not built |
| 7 | Immersive Desktop Mode | not started. "Menu mode" is a compact control panel, not this |
| 8 | Installer and distribution | NSIS installer, built by GitHub when a version tag is pushed. Not code-signed, no automatic updates |
| 9 | Plugin/SDK ecosystem | widget SDK v1 only; no installable widget packages |

## Feature expansion plan

| Phase | Scope | State |
|---|---|---|
| 1 | Desktop widget behaviour: borderless at 0%, resizing, hover move/resize controls, works with the main window closed | done |
| 2 | Blender integration (pre-rendered MP4/WebM, plus a headless render-to-video job) | done. Live Blender on the desktop is not possible (see WALLPAPER.md) |
| 3 | Cursor trail and particle effects | done. Unity assets are imported through a `.dfx` export workflow (EFFECTS.md) |
| 4 | Spotify / media control, edge-triggered display, beat-sync | media control done through the floating island (Spotify or any player). Edge-triggered display and beat-sync not started |
| 5 | Image layering, glass widgets, date/time/weather, custom fonts | done, except custom fonts. Includes background removal and the Glass Effect Wizard |
| 6 | Voice typing in Notes | not started |
| 7 | AI workflow and local assistant | future version; deliberately not implemented |

## Added for 1.0

- A redesigned app: sidebar, large page titles, bento dashboard, scroll-triggered animations.
- The floating island: music controls, Pomodoro timer, quick tools, fully customisable.
- The Glass Effect Wizard and a frosted-wallpaper fallback.
- A smoother, timestamp-based cursor trail.
- Image composer handles, undo/redo, restore previous wallpaper, and background removal.

## Next

1. Code signing, so Windows SmartScreen stops warning about the installer.
2. Automatic updates.
3. Desktop widgets attached behind the icons (so Win+D does not hide them).
4. Profiles (whole-setup snapshots) and multi-monitor layouts.
5. Custom fonts, and installable widget packages.
6. Edge-triggered widgets, voice typing in Notes, and a local assistant.
