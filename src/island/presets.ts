// Island presets: a named look (appearance + what it shows). Built-in ones, ones you save, and copy/paste sharing.
// Position, behaviour and autostart are not part of a preset, so trying a look never moves your island.
import {
  DEFAULT_APPEARANCE, DEFAULT_CONTENT, sanitizeAppearance, sanitizeContent,
  type IslandAppearance, type IslandConfig, type IslandContent,
} from "./config";

export interface IslandPreset {
  name: string;
  appearance: IslandAppearance;
  content: IslandContent;
}

export const PRESETS_KEY = "island:presets";
export const MAX_PRESETS = 20;
export const MAX_PRESET_NAME = 40;
export const MAX_PRESET_JSON = 16_384;
export const PRESET_FORMAT = "deskforge-island-preset";

const cleanName = (v: unknown, fallback: string): string => {
  const name = typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_PRESET_NAME) : "";
  return name || fallback;
};

function make(name: string, appearance: Partial<IslandAppearance> = {}, content: Partial<IslandContent> = {}): IslandPreset {
  return {
    name,
    appearance: sanitizeAppearance({ ...DEFAULT_APPEARANCE, ...appearance }),
    content: sanitizeContent({ ...DEFAULT_CONTENT, ...content }),
  };
}

export const BUILTIN_PRESETS: readonly IslandPreset[] = [
  make("Classic dark"),
  make("Light", { bg: "#f4f6f8", text: "#16202a", borderColor: "#000000", borderOpacity: 14, shadow: 35 }),
  make("Midnight", { bg: "#0b1226", bg2: "#1a2650", bgAngle: 135, accent: "#6ea8ff", radius: 24 }),
  make("Neon", { bg: "#05060a", text: "#f5e9ff", accent: "#ff3df2", borderColor: "#ff3df2", borderOpacity: 70, borderWidth: 2, shadow: 80, font: "mono" }),
  make("Frosted", { bg: "#10141a", opacity: 70, borderOpacity: 18, radius: 26, shadow: 40 }),
  make("Minimal", { scale: 0.9, pillWidth: 240, borderWidth: 0, shadow: 20, radius: 16, opacity: 90, idleDim: 70 }, { music: { art: true, progress: true, volume: false, app: false }, tools: { meters: false, launchers: true, launcherCount: 4 } }),
  make("Compact", { scale: 0.8, pillWidth: 260, panelWidth: 380, radius: 18 }),
];

/** Applies a preset's look to a config, leaving position, behaviour and autostart alone. */
export function applyPreset(config: IslandConfig, preset: IslandPreset): IslandConfig {
  return { ...config, appearance: preset.appearance, content: preset.content };
}

/** Does the config currently look exactly like this preset? (To mark the active one.) */
export function matchesPreset(config: IslandConfig, preset: IslandPreset): boolean {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return same(sanitizeAppearance(config.appearance), sanitizeAppearance(preset.appearance)) && same(sanitizeContent(config.content), sanitizeContent(preset.content));
}

export function makePreset(name: string, config: IslandConfig): IslandPreset {
  return { name: cleanName(name, "My island"), appearance: config.appearance, content: config.content };
}

/** Saved presets, read defensively: junk entries are dropped, names are unique (ignoring case) and the list is capped. */
export function sanitizePresetList(raw: unknown): IslandPreset[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: IslandPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = cleanName(r.name, "");
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, appearance: sanitizeAppearance(r.appearance), content: sanitizeContent(r.content) });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

/** Adds or replaces (by name, ignoring case) a saved preset, newest first, within the cap. */
export function savePreset(list: readonly IslandPreset[], preset: IslandPreset): IslandPreset[] {
  const others = list.filter((p) => p.name.toLowerCase() !== preset.name.toLowerCase());
  return [preset, ...others].slice(0, MAX_PRESETS);
}

export function serializePreset(preset: IslandPreset): string {
  return JSON.stringify({ format: PRESET_FORMAT, version: 1, name: preset.name, appearance: preset.appearance, content: preset.content }, null, 2);
}

export type ParsedPreset = { ok: true; preset: IslandPreset } | { ok: false; error: string };

/** Reads text pasted by the user. Never throws; anything unusable says why. */
export function parsePreset(text: string): ParsedPreset {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "Paste the preset text first." };
  if (trimmed.length > MAX_PRESET_JSON) return { ok: false, error: "That text is too long to be an island preset." };
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "That isn’t valid preset text." };
  }
  if (!raw || typeof raw !== "object" || (raw as Record<string, unknown>).format !== PRESET_FORMAT) {
    return { ok: false, error: "That isn’t a DeskForge island preset." };
  }
  const r = raw as Record<string, unknown>;
  return { ok: true, preset: { name: cleanName(r.name, "Imported"), appearance: sanitizeAppearance(r.appearance), content: sanitizeContent(r.content) } };
}
