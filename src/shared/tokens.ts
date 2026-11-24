import { PATTERN_KEYS, patternCss, type PatternKey } from "./patterns";
export { PATTERN_KEYS, PATTERN_LABELS, type PatternKey } from "./patterns";

// Pure token schema (no DOM, no Tauri) so the Chrome extension can reuse it.
// sanitizeTokens() is the ONLY way untrusted data becomes Tokens, so a theme
// can never inject arbitrary CSS.

export const FONT_STACKS = {
  system: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
  grotesk: '"Bahnschrift", "Segoe UI", sans-serif',
  humanist: '"Trebuchet MS", "Segoe UI", sans-serif',
  serif: '"Georgia", "Cambria", serif',
  mono: '"Cascadia Mono", "Consolas", monospace',
} as const;

export type FontKey = keyof typeof FONT_STACKS;

export const FONT_LABELS: Record<FontKey, string> = {
  system: "Windows default",
  grotesk: "Bahnschrift",
  humanist: "Trebuchet",
  serif: "Georgia",
  mono: "Cascadia Mono",
};

export type BgStyle = "solid" | "gradient";

export interface Tokens {
  bg: string;
  bgStyle: BgStyle;
  bg2: string; // gradient end color
  angle: number; // gradient angle, 0-360
  pattern: PatternKey; // decorative background art
  surface: string;
  text: string;
  accent: string;
  radius: number; // px, 0-24
  space: number; // px base unit, 8-28
  fontSize: number; // px, 13-20
  font: FontKey;
}

export const DEFAULT_TOKENS: Tokens = {
  bg: "#050a07",
  bgStyle: "solid",
  bg2: "#0b1a12",
  angle: 160,
  pattern: "grid",
  surface: "#0a120d",
  text: "#7dffa8",
  accent: "#22f57a",
  radius: 2,
  space: 14,
  fontSize: 14,
  font: "mono",
};

const HEX = /^#[0-9a-f]{6}$/i;

function color(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

export function sanitizeTokens(raw: unknown): Tokens {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_TOKENS;
  const font =
    typeof r.font === "string" && Object.prototype.hasOwnProperty.call(FONT_STACKS, r.font)
      ? (r.font as FontKey)
      : d.font;
  return {
    bg: color(r.bg, d.bg),
    bgStyle: r.bgStyle === "gradient" ? "gradient" : "solid",
    bg2: color(r.bg2, d.bg2),
    angle: num(r.angle, 0, 360, d.angle),
    pattern:
      typeof r.pattern === "string" && (PATTERN_KEYS as readonly string[]).includes(r.pattern)
        ? (r.pattern as PatternKey)
        : d.pattern,
    surface: color(r.surface, d.surface),
    text: color(r.text, d.text),
    accent: color(r.accent, d.accent),
    radius: num(r.radius, 0, 24, d.radius),
    space: num(r.space, 8, 28, d.space),
    fontSize: num(r.fontSize, 13, 20, d.fontSize),
    font,
  };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Readable text color for content drawn on top of `hex`. */
export function onColor(hex: string): string {
  return luminance(hex) > 0.4 ? "#10161d" : "#ffffff";
}

/** Value for the CSS `background` property. Built only from sanitized values. */
export function backgroundCss(t: Tokens): string {
  return t.bgStyle === "gradient" ? `linear-gradient(${t.angle}deg, ${t.bg}, ${t.bg2})` : t.bg;
}

/** Every CSS variable a theme sets. Used by the app AND sent to widgets, so there is one source of truth. */
export function themeCssVars(t: Tokens): Record<string, string> {
  return {
    "--bg": t.bg,
    "--bg-fill": backgroundCss(t),
    "--bg-art": patternCss(t).image,
    "--bg-art-size": patternCss(t).size,
    "--surface": t.surface,
    "--text": t.text,
    "--accent": t.accent,
    "--on-accent": onColor(t.accent),
    "--radius": `${t.radius}px`,
    "--space": `${t.space}px`,
    "--font-size": `${t.fontSize}px`,
    "--font": FONT_STACKS[t.font],
  };
}
