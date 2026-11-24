# Cursor effects (Phase 3)

## What works

- **Cursor trail**: four styles (dots, line, comet, sparkle), adjustable length, fade time, size, colour (or rainbow),
  optional glow. Instant on/off from the app, the desktop menu, or the tray ("Stop cursor effects").
- **Particles that follow the cursor**: five built-in effects (Sparks, Fireflies, Orbit, Fountain, Comet dust) and four
  motion models (sparks, fountain, drift, orbit). Controls: density, size, speed, lifetime, your own colour.
  Imported `.dfx` effects appear in the same list.
- Each effect (trail, particles) can be switched on and off independently.

## How it works and what it costs

One transparent, click-through window (`fx`) covers the primary monitor, above other windows. A click-through window
gets no mouse events, so Rust reports the global cursor position on request. The overlay:

- asks for the cursor only while an effect is enabled,
- sleeps (about 8 checks per second) when the cursor is still and nothing is left to animate,
- pauses completely while a fullscreen app runs (checked at most every 2 seconds),
- can be capped to 30 fps,
- draws on a canvas at CSS resolution, with a limit on particles (`maxParticles`).

The overlay is one pixel shorter than the monitor so Windows does not treat it as a fullscreen app.

## Unity: why not import directly, and the workflow instead

A Unity prefab or Particle System is not a standalone file format. It depends on Unity's engine, its renderer, shaders,
materials and scripts, none of which exist outside the Unity runtime. Embedding the Unity runtime in DeskForge is not
practical (size, licensing, GPU cost), so DeskForge does **not** import Unity assets directly.

Workflow instead:

1. Copy `tools/unity/DeskForgeExporter.cs` into an `Editor` folder of your Unity project.
2. Select a GameObject with a Particle System, then **DeskForge > Export selected Particle System...**
3. Import the `.dfx` file in DeskForge: Cursor effects > particles > "import a .dfx effect".

| Unity Particle System | DeskForge `.dfx` field |
|---|---|
| Start Color (and Color over Lifetime end) | `colors`, `endColor` |
| Start Size, Size over Lifetime | `size`, `sizeEnd` (x100 px per unit) |
| Start Speed | `speed` (x100 px per unit) |
| Start Lifetime | `lifetime` |
| Emission: Rate over Time | `rate` |
| Gravity Modifier | `gravity` (x9.81 x100, positive = down) |
| Shape: Cone angle | `spread` (full angle) |
| Max Particles | `maxParticles` (limited to 1500) |
| Renderer material "Additive" | `additive` |

Not carried over: textures and sprite sheets, custom shaders, 3D, sub-emitters, trails, noise, collision, force fields.
Treat the result as an approximation of the look, not a copy. The exporter script has not been run in Unity (it was
written without Unity available); if it fails to compile, the `.dfx` format below can be written by hand.

## The .dfx format

```json
{
  "format": "deskforge-effect",
  "version": 1,
  "effect": {
    "name": "My sparks",
    "behavior": "sparks",
    "colors": ["#ffd27a", "#ff9a3c"],
    "endColor": "#ff3c1a",
    "size": 5, "sizeEnd": 0, "speed": 220, "lifetime": 0.7, "rate": 90,
    "spread": 70, "gravity": 380, "fade": true, "additive": true,
    "emitWhen": "moving", "maxParticles": 300
  }
}
```

Every value is clamped on import (for example `size` 1-64, `rate` 1-500, `maxParticles` 10-1500); unknown fields are
ignored; invalid colours are dropped; files over 32 KB are rejected. No code or CSS can be loaded from a `.dfx` file.

## Limits

- Primary monitor only. The overlay sits above other windows; a "desktop layer only" option is not built yet.
- Effects are 2D dots and lines. No images or textures yet.
- Very fast mouse movement is sampled once per frame, so the trail is made of straight segments between samples.
