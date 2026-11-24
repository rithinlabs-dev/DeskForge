// Cursor effects: settings, particle effect definitions (.dfx files) and their validation. Pure and unit-tested.
// Everything read from storage or from an imported file goes through a sanitizer; nothing here can throw.

export const FX_CONFIG_KEY = "fx:config";
export const FX_EFFECTS_KEY = "fx:effects";
export const EFFECT_FORMAT = "deskforge-effect";
export const MAX_EFFECT_FILE = 32 * 1024;
export const MAX_LIBRARY = 20;

const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, fb: string) => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fb);
const optHex = (v: unknown): string | null => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null);
const num = (v: unknown, min: number, max: number, fb: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export const BEHAVIORS = ["sparks", "fountain", "drift", "orbit"] as const;
export type Behavior = (typeof BEHAVIORS)[number];
export const TRAIL_STYLES = ["dots", "line", "comet", "sparkle"] as const;
export type TrailStyle = (typeof TRAIL_STYLES)[number];

export interface ParticleEffect {
  name: string;
  behavior: Behavior;
  colors: string[]; // 1-4 start colors, one picked per particle
  endColor: string | null; // fade towards this color over the particle's life
  size: number; // px at birth
  sizeEnd: number; // px at death
  speed: number; // px per second
  lifetime: number; // seconds
  rate: number; // particles per second
  spread: number; // cone angle in degrees
  gravity: number; // px/s^2, positive = down
  fade: boolean;
  additive: boolean; // glowing blend
  emitWhen: "moving" | "always";
  maxParticles: number;
}

export function sanitizeEffect(raw: unknown, fallbackName = "Imported effect"): ParticleEffect {
  const r = obj(raw);
  const colors = (Array.isArray(r.colors) ? r.colors : []).map(optHex).filter((c): c is string => !!c).slice(0, 4);
  return {
    name: (typeof r.name === "string" ? r.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 40) : "") || fallbackName,
    behavior: (BEHAVIORS as readonly string[]).includes(r.behavior as string) ? (r.behavior as Behavior) : "sparks",
    colors: colors.length ? colors : ["#ffffff"],
    endColor: optHex(r.endColor),
    size: num(r.size, 1, 64, 6),
    sizeEnd: num(r.sizeEnd, 0, 64, 0),
    speed: num(r.speed, 0, 2000, 120),
    lifetime: num(r.lifetime, 0.1, 10, 1),
    rate: num(r.rate, 1, 500, 40),
    spread: num(r.spread, 0, 360, 60),
    gravity: num(r.gravity, -2000, 2000, 0),
    fade: bool(r.fade, true),
    additive: bool(r.additive, false),
    emitWhen: r.emitWhen === "always" ? "always" : "moving",
    maxParticles: Math.round(num(r.maxParticles, 10, 1500, 300)),
  };
}

export type EffectParse = { ok: true; effect: ParticleEffect } | { ok: false; error: string };

export function parseEffectFile(text: string): EffectParse {
  if (text.length > MAX_EFFECT_FILE) return { ok: false, error: "That file is too large to be an effect (limit 32 KB)." };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn’t valid JSON." };
  }
  const r = obj(raw);
  if (r.format !== EFFECT_FORMAT) return { ok: false, error: "That isn’t a DeskForge effect file (.dfx)." };
  if (typeof r.version !== "number" || r.version !== 1) return { ok: false, error: "Unsupported effect file version." };
  if (typeof r.effect !== "object" || r.effect === null) return { ok: false, error: "The effect file has no effect inside it." };
  return { ok: true, effect: sanitizeEffect(r.effect) };
}

export const BUILTIN_EFFECTS: ParticleEffect[] = [
  { name: "Sparks", behavior: "sparks", colors: ["#ffd27a", "#ff9a3c"], endColor: "#ff3c1a", size: 5, sizeEnd: 0, speed: 220, lifetime: 0.7, rate: 90, spread: 70, gravity: 380, fade: true, additive: true, emitWhen: "moving", maxParticles: 300 },
  { name: "Fireflies", behavior: "drift", colors: ["#d8ff7a", "#8dffb0"], endColor: null, size: 4, sizeEnd: 2, speed: 25, lifetime: 2.4, rate: 14, spread: 360, gravity: -6, fade: true, additive: true, emitWhen: "always", maxParticles: 80 },
  { name: "Orbit", behavior: "orbit", colors: ["#7aa8ff", "#c07aff"], endColor: null, size: 4, sizeEnd: 4, speed: 0, lifetime: 2.2, rate: 10, spread: 360, gravity: 0, fade: true, additive: true, emitWhen: "always", maxParticles: 40 },
  { name: "Fountain", behavior: "fountain", colors: ["#7ad7ff", "#ffffff"], endColor: "#3a7aff", size: 4, sizeEnd: 1, speed: 260, lifetime: 1.1, rate: 70, spread: 35, gravity: 520, fade: true, additive: false, emitWhen: "moving", maxParticles: 300 },
  { name: "Comet dust", behavior: "sparks", colors: ["#ffffff", "#bfe6ff"], endColor: "#5aa0ff", size: 3, sizeEnd: 0, speed: 60, lifetime: 0.9, rate: 120, spread: 25, gravity: 0, fade: true, additive: true, emitWhen: "moving", maxParticles: 400 },
];

export interface TrailConfig {
  enabled: boolean;
  style: TrailStyle;
  length: number; // max points
  fade: number; // seconds until a point disappears
  size: number;
  color: string;
  rainbow: boolean;
  glow: boolean;
}
export interface ParticleConfig {
  enabled: boolean;
  effect: string; // name of a built-in or imported effect
  density: number; // multiplies the emission rate
  sizeScale: number;
  speedScale: number;
  lifetimeScale: number;
  colorOverride: string | null;
}
export interface FxConfig {
  trail: TrailConfig;
  particles: ParticleConfig;
  pauseOnFullscreen: boolean;
  autostart: boolean;
  fps: 30 | 60;
}

export const DEFAULT_FX: FxConfig = {
  trail: { enabled: true, style: "comet", length: 40, fade: 0.6, size: 8, color: "#22f57a", rainbow: false, glow: false },
  particles: { enabled: false, effect: "Sparks", density: 1, sizeScale: 1, speedScale: 1, lifetimeScale: 1, colorOverride: null },
  pauseOnFullscreen: true,
  autostart: false,
  fps: 60,
};

export function sanitizeFxConfig(raw: unknown): FxConfig {
  const r = obj(raw);
  const t = obj(r.trail);
  const p = obj(r.particles);
  const d = DEFAULT_FX;
  return {
    trail: {
      enabled: bool(t.enabled, d.trail.enabled),
      style: (TRAIL_STYLES as readonly string[]).includes(t.style as string) ? (t.style as TrailStyle) : d.trail.style,
      length: Math.round(num(t.length, 4, 120, d.trail.length)),
      fade: num(t.fade, 0.1, 3, d.trail.fade),
      size: num(t.size, 1, 40, d.trail.size),
      color: hex(t.color, d.trail.color),
      rainbow: bool(t.rainbow, d.trail.rainbow),
      glow: bool(t.glow, d.trail.glow),
    },
    particles: {
      enabled: bool(p.enabled, d.particles.enabled),
      effect: typeof p.effect === "string" && p.effect.length <= 40 ? p.effect : d.particles.effect,
      density: num(p.density, 0.1, 3, 1),
      sizeScale: num(p.sizeScale, 0.25, 3, 1),
      speedScale: num(p.speedScale, 0.1, 3, 1),
      lifetimeScale: num(p.lifetimeScale, 0.2, 3, 1),
      colorOverride: optHex(p.colorOverride),
    },
    pauseOnFullscreen: bool(r.pauseOnFullscreen, d.pauseOnFullscreen),
    autostart: bool(r.autostart, d.autostart),
    fps: r.fps === 30 ? 30 : 60,
  };
}

export function sanitizeEffectLibrary(raw: unknown): ParticleEffect[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ParticleEffect[] = [];
  for (const item of raw.slice(0, MAX_LIBRARY)) {
    const e = sanitizeEffect(item);
    if (!seen.has(e.name)) {
      seen.add(e.name);
      out.push(e);
    }
  }
  return out;
}

/** Imported effects win over built-ins with the same name; unknown names fall back to the first built-in. */
export function findEffect(name: string, library: ParticleEffect[]): ParticleEffect {
  return library.find((e) => e.name === name) ?? BUILTIN_EFFECTS.find((e) => e.name === name) ?? BUILTIN_EFFECTS[0];
}
