// Turns the island's appearance settings into CSS custom properties. Pure and unit-tested.
import { FONT_STACKS } from "../shared/tokens";
import { ANIMATION_MS, type IslandAppearance } from "./config";

export function hexToRgb(hex: string): [number, number, number] {
  const h = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : "000000";
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** `rgba(10, 12, 15, 0.85)`. `percent` is 0-100. */
export function rgba(hex: string, percent: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(Math.min(100, Math.max(0, percent))) / 100})`;
}

/** Black or white text, whichever reads better on this colour (for text on the accent colour). */
export function readableOn(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? "#0b0f14" : "#ffffff";
}

/** The island's background: one colour, or a gradient when a second colour is set. */
export function backgroundFill(a: IslandAppearance): string {
  const first = rgba(a.bg, a.opacity);
  return a.bg2 ? `linear-gradient(${a.bgAngle}deg, ${first}, ${rgba(a.bg2, a.opacity)})` : first;
}

/** 0 = no shadow, 50 = the standard one, 100 = a deep, wide one. */
export function shadowCss(strength: number): string {
  if (strength <= 0) return "none";
  const k = strength / 50;
  return `0 ${Math.round(6 * k)}px ${Math.round(24 * k)}px rgba(0, 0, 0, ${Math.min(0.9, 0.45 * k).toFixed(2)})`;
}

export function islandCssVars(a: IslandAppearance): Record<string, string> {
  return {
    "--isl-scale": String(a.scale),
    "--isl-pill-w": `${a.pillWidth}px`,
    "--isl-panel-w": `${a.panelWidth}px`,
    "--isl-bg": backgroundFill(a),
    "--isl-fg": a.text,
    "--isl-accent": a.accent ?? "var(--accent, #4aa3ff)",
    "--isl-on-accent": a.accent ? readableOn(a.accent) : "var(--on-accent, #ffffff)",
    "--isl-radius": `${a.radius}px`,
    "--isl-border-w": `${a.borderWidth}px`,
    "--isl-border-c": rgba(a.borderColor, a.borderOpacity),
    "--isl-shadow": shadowCss(a.shadow),
    "--isl-font": a.font === "theme" ? "var(--font, 'Segoe UI', system-ui, sans-serif)" : FONT_STACKS[a.font],
    "--isl-anim": `${ANIMATION_MS[a.animation]}ms`,
    "--isl-idle": String(a.idleDim / 100),
  };
}
