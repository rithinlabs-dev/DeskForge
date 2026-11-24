# Animated wallpaper (Phase 2)

## What works

- **Import** MP4 (H.264) and WebM (VP9/VP8). Files are checked by extension AND file signature, limited to 2 GB, and
  copied into `%APPDATA%\dev.deskforge.app\media\`. The webview never sees the original path (native file picker).
- **Playback** in a dedicated window (`wallpaper`) on the primary monitor: loop, mute/volume, fit (crop / bars /
  stretch), start with DeskForge. Video is decoded by WebView2, so it can use the GPU's hardware decoder.
- **Placement modes**
  - *Behind the desktop icons* (experimental, "WorkerW"): the window is attached to Explorer's wallpaper layer.
  - *Windowed* (safe fallback): a fullscreen, click-through, always-on-bottom window. It **covers your desktop icons**.
  - *Automatic*: try behind-icons, fall back to windowed and say why.
- **Widgets stay above the video** in both modes.
- **Performance**: a single thread wakes every 3 seconds (only while a wallpaper runs) and pauses playback while a
  fullscreen app is running and, optionally, on battery. A paused video costs almost nothing.
- **Safety**: Stop wallpaper (also in the tray) closes the window and restores the normal desktop. "Start with
  DeskForge" is off by default, and if a start never finished the next autostart is skipped once.

## Blender: what is and is not possible

Investigated question: can Blender's renderer run on the desktop layer without its interface?

- Blender can run **headless** (`blender -b file.blend -a`) but that mode only renders to FILES (images or video). It
  has no real-time output surface.
- The live 3D view exists only inside a Blender window. Embedding that window behind the desktop icons is not a
  supported feature; it would keep a full Blender process and GPU viewport busy permanently, and would require Blender
  on every user's PC (against the project rule that end users do not need Blender).

So, as explained before building: **DeskForge renders a .blend headlessly into an MP4 and plays the MP4.** This is
optional and only needs Blender on the PC that does the rendering.

- Blender is found in `C:\Program Files\Blender Foundation\*` or set manually (`blender.exe`).
- The .blend is opened with `--disable-autoexec` (no embedded scripts run). Still, only render files you trust.
- The Python given to Blender is generated from validated numbers and fixed values only (resolution, fps, quality,
  engine, samples). No user text reaches it.
- Output is H.264 MP4, no audio. Make the animation loop in Blender (matching first and last frame) for a seamless loop.
- Progress is shown frame by frame; Cancel kills the render. Rendering runs at below-normal priority.
- Real-time GLB / Three.js environments are a possible later step; nothing is built for that yet.

## Limits and risks (read these)

- **Behind-icons mode is unverified.** It relies on undocumented Explorer behaviour that changed in Windows 11 24H2.
  Two strategies are tried and the diagnostic ("classic WorkerW sibling" or "WorkerW child of Progman") is shown. If it
  misbehaves (black screen, no icons), use Stop and set Placement to "Windowed".
- **Primary monitor only.** Multi-monitor placement is not implemented.
- **Windowed mode hides desktop icons** (by design of the fallback).
- **Codecs**: H.264 MP4 and VP9 WebM are the safe choices. HEVC/AV1 may not play. An unsupported file shows an error.
- **Fullscreen detection** uses `SHQueryUserNotificationState`; it can occasionally treat other situations as
  "fullscreen". Turn the option off if it pauses when it shouldn't (the reason is shown in the panel).
- A static-poster fallback (set the first frame as the normal Windows wallpaper when integration is unavailable) is not
  built yet.
- Win+D ("Show desktop") may hide windowed-mode wallpapers and desktop widgets.
