# Custom HUDs

Build your own widget without writing a widget: pick the parts, upload a `.css` file.

1. Widgets > **create a custom hud**.
2. Name it, tick the parts (clock, date, processor, memory, network, text label), set the size.
3. **upload .css** (optional). Without it you get the built-in style.
4. **Create HUD**. Use the **css** button on a HUD any time to swap its style, **Pin to desktop** to put it on the desktop.

## Class names

```
.hud                      container
.part                     every part; plus one of .clock .date .cpu .memory .net .text
.part .label              small label (cpu, mem, net)
.part .value              the number or text
.bar > i                  meter bar for .cpu and .memory, width = var(--pct) %
```

Variables: `--bg --surface --text --accent --on-accent --radius --space --font-size --font`, live `--cpu --mem` (0-100),
`--bg-alpha` (the "widget background" slider, 0-100), and `--bg-opacity` (the same value as a CSS percentage). Adaptive
glass variables are also available when glass is enabled. Hide the corner frame with
`body::before, body::after { display: none; }`.

## What is not allowed

The file is rejected if it contains `@import`, `@font-face`, `image-set()`, any `url()` that isn't a `data:image/...`
URL, script-like constructs, or HTML. Limit 48 KB. This is checked after decoding CSS escapes and removing comments.
Your CSS only affects that one widget (it runs inside its own sandbox), never the DeskForge window.
