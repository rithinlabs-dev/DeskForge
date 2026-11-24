// Per-widget look (Phase 5.3): background opacity, native glass blur, border and shadow. Pure and unit-tested.
import { isWidgetId } from "./manifest";

export type GlassKind = "auto" | "acrylic" | "blur" | "backdrop" | "mica" | "wallpaper" | "sheen";
export const GLASS_KINDS: readonly GlassKind[] = ["auto", "acrylic", "blur", "backdrop", "mica", "wallpaper", "sheen"];
export const isGlassKind = (v: unknown): v is GlassKind => typeof v === "string" && (GLASS_KINDS as readonly string[]).includes(v);
export type GlassEffect = "acrylic" | "blur" | "backdrop" | "mica" | "off";
export type GlassStatus = GlassEffect | "applying" | "unavailable" | "not-pinned";
export type SystemTheme = "light" | "dark";

export interface Appearance {
  opacity: number; // 0 = fully transparent, 100 = solid panel
  glassEnabled: boolean; // native Windows acrylic blur behind the widget (desktop windows only)
  glassLevel: number; // 0-100: CSS reflection strength; Windows controls native blur radius
  glassKind: GlassKind; // auto, acrylic, blur, Windows 11 backdrop, mica, frosted wallpaper, or sheen (no blur)
  glassTint: string | null; // null follows the system light/dark tint
  glassTintOpacity: number; // 0-100: native tint alpha, independent of glassLevel
  borderEnabled: boolean; // the widget frame (border and corner marks)
  shadowEnabled: boolean; // soft inner shadow for depth
}

export const MAX_GLASS_OPACITY = 70;
export const DEFAULT_APPEARANCE: Appearance = {
  opacity: 85,
  glassEnabled: false,
  glassLevel: 55,
  glassKind: "acrylic",
  glassTint: null,
  glassTintOpacity: 35,
  borderEnabled: true,
  shadowEnabled: true,
};

const num = (v: unknown, fb: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : fb);
const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function systemGlassTint(theme: SystemTheme): string {
  return theme === "dark" ? "#25282d" : "#f1f3f5";
}

export function sanitizeAppearance(raw: unknown, fb: Appearance = DEFAULT_APPEARANCE): Appearance {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawKind = r.glassKind ?? r.kind;
  const glassKind = isGlassKind(rawKind) ? rawKind : fb.glassKind;
  const glassEnabled = bool(r.glassEnabled, bool(r.glass, fb.glassEnabled));
  const opacity = num(r.opacity, fb.opacity);
  const legacyLevel = num(r.blur, fb.glassLevel);
  const legacyTintOpacity = typeof r.blur === "number" && Number.isFinite(r.blur)
    ? Math.round((16 + Math.floor(legacyLevel * 72 / 100)) * 100 / 255)
    : fb.glassTintOpacity;
  const glassTint = r.glassTint === null
    ? null
    : typeof r.glassTint === "string" && HEX_COLOR.test(r.glassTint)
      ? r.glassTint.toLowerCase()
      : fb.glassTint;
  return {
    opacity: glassEnabled ? Math.min(MAX_GLASS_OPACITY, opacity) : opacity,
    glassEnabled,
    glassLevel: num(r.glassLevel, legacyLevel),
    glassKind,
    glassTint,
    glassTintOpacity: num(r.glassTintOpacity, legacyTintOpacity),
    borderEnabled: bool(r.borderEnabled, bool(r.border, fb.borderEnabled)),
    shadowEnabled: bool(r.shadowEnabled, bool(r.shadow, fb.shadowEnabled)),
  };
}

export function sanitizeAppearanceMap(raw: unknown): Record<string, Appearance> {
  const out: Record<string, Appearance> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 60)) {
    if (isWidgetId(id)) out[id] = sanitizeAppearance(v);
  }
  return out;
}

/** A widget without its own look follows the global "widget background" slider. */
export function effectiveAppearance(own: Appearance | undefined, globalOpacity: number): Appearance {
  return own ?? { ...DEFAULT_APPEARANCE, opacity: globalOpacity };
}

/** CSS variables sent to the widget. The base widget stylesheet turns these into the actual look. */
export function appearanceVars(a: Appearance, systemTheme: SystemTheme): Record<string, string> {
  const dark = systemTheme === "dark";
  const level = a.glassLevel / 100;
  const tint = a.glassTint ?? systemGlassTint(systemTheme);
  const cssBackgroundOpacity = a.glassEnabled
    ? Math.round(a.opacity * a.glassTintOpacity / 100)
    : a.opacity;
  return {
    "--bg-alpha": String(a.opacity),
    "--bg-opacity": `${cssBackgroundOpacity}%`,
    "--frame": a.borderEnabled ? "1" : "0",
    "--frame-opacity": a.borderEnabled ? "100%" : "0%",
    "--body-shadow": a.shadowEnabled ? "inset 0 0 28px rgba(0, 0, 0, 0.35)" : "none",
    "--glass-surface": a.glassEnabled ? tint : "var(--surface)",
    "--glass-text": a.glassEnabled ? (dark ? "#f7f8fa" : "#202328") : "var(--text)",
    "--glass-border": a.glassEnabled
      ? a.borderEnabled
        ? (dark ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.62)")
        : "transparent"
      : "var(--edge)",
    "--glass-reflection": a.glassEnabled
      ? (dark
        ? `linear-gradient(145deg, rgba(255, 255, 255, ${(0.15 * level).toFixed(3)}), rgba(255, 255, 255, ${(0.025 * level).toFixed(3)}) 42%, transparent 68%)`
        : `linear-gradient(145deg, rgba(255, 255, 255, ${(0.62 * level).toFixed(3)}), rgba(255, 255, 255, ${(0.12 * level).toFixed(3)}) 48%, transparent 76%)`)
      : "none",
    "--glass-shadow": a.glassEnabled && a.shadowEnabled
      ? (dark
        ? "inset 0 1px 0 rgba(255, 255, 255, 0.16), inset 0 0 24px rgba(255, 255, 255, 0.025), 0 12px 30px rgba(0, 0, 0, 0.24)"
        : "inset 0 1px 0 rgba(255, 255, 255, 0.72), inset 0 0 22px rgba(255, 255, 255, 0.16), 0 10px 26px rgba(30, 42, 56, 0.14)")
      : "none",
    "--glass-radius": a.glassEnabled ? "14px" : "var(--radius)",
  };
}
