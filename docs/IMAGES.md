# Desktop images and compositions (Phase 5.1 / 5.2)

## What it does

- **Image library**: import PNG, JPEG, WebP or GIF (up to 25 MB each). Files are checked by extension AND file signature,
  then copied into `%APPDATA%\dev.deskforge.app\media\images\`. The webview never sees the original path.
- **Remove background**: beside each library image. The background colour is taken from the picture's border (or
  clicked on the picture); pixels close to it become transparent. "Background around the subject" only removes what
  touches the edge (so white inside the subject stays); "every pixel of that colour" removes all of it. Tolerance, a soft
  edge and edge trimming are adjustable, with a checkerboard preview. The result is saved as a new PNG with
  transparency and the original is kept. It is colour-based, entirely local, and works best on logos, products and
  drawings with a plain background; it cannot cut a person out of a busy photograph (that needs an AI model).
- **Composition editor**: a canvas the size of your screen (1920x1080, 2560x1440, 3840x2160, 1366x768, 2560x1080,
  3440x1440). Up to 40 layers. For each layer: drag to move, size (with "fit to screen" and "fill screen"), left-right and
  up-down position, rotation, opacity, mirror, crop (trim each side), swap the image, move up or down, duplicate, delete.
  Changing the canvas size keeps every layer in the same relative place.
- **Save and restore**: "Save composition" keeps up to 30 named compositions; your current work is also kept
  automatically, so closing DeskForge never loses it.
- **Use as desktop wallpaper**: the composition is drawn at its full resolution and sent as a lossless PNG. DeskForge
  stores it (only the two newest are kept) and asks Windows to use it as the wallpaper.

Example: add a background photo (first layer, fills the screen), then a transparent PNG of an arc reactor on top; drag it
into place, resize it, set its opacity, and press "Use as desktop wallpaper".

## How it works

- Images reach the editor as `data:` URLs from Rust (`image_data`). A data URL never taints a canvas, so the finished
  composition can be exported. Loading images from the asset protocol instead would depend on cross-origin headers.
- The preview and the final wallpaper use the same drawing code (`compose/render.ts`); the final render just uses the full
  resolution and no selection outline.
- Only the finished PNG crosses back to Rust (`compose_set_wallpaper`), which checks the PNG signature and a size limit
  before writing it and setting the wallpaper (the existing `SystemParametersInfoW` path).

## Limits

- Using a composition **replaces your current Windows wallpaper**. DeskForge keeps a copy of the wallpaper it replaces (the first time, so it is always your original), and "Restore previous wallpaper" puts it back.
- One monitor image: the composition is a single picture set as the Windows wallpaper. Per-monitor compositions are not built.
- Memory: every image used is decoded in full. A few 25 MB photos are fine; dozens of huge layers at 4K will be slow.
- No SVG (it can contain scripts) and no layer effects such as blur or masks yet.
- Animated GIFs show their first frame.
- The animated wallpaper (video) and a composition are separate: the video plays above the Windows wallpaper.
