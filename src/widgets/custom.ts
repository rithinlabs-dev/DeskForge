// Custom HUDs: user-made widgets built from a chosen set of parts + an uploaded CSS file.
// Config and CSS live in the widget's own store; the list of HUDs lives in the "widgets:custom" setting.
import { isWidgetId, type Permission, type WidgetManifest } from "./manifest";

export const HUD_PART_TYPES = ["clock", "date", "cpu", "memory", "net", "text"] as const;
export type HudPartType = (typeof HUD_PART_TYPES)[number];
export const HUD_PART_LABELS: Record<HudPartType, string> = {
  clock: "clock", date: "date", cpu: "processor", memory: "memory", net: "network", text: "text label",
};

export interface HudPart { type: HudPartType; text?: string }
export interface CustomHud { id: string; name: string; cols: 1 | 2; height: number; parts: HudPart[] }

/** User-made HUDs may read the theme and system stats and read their own config. Granted on creation. */
export const CUSTOM_PERMISSIONS: Permission[] = ["theme.read", "system.read", "storage"];
export const CUSTOM_DIR = "custom-hud"; // folder under public/widgets/ that renders every custom HUD

export function newHudId(name: string, now = Date.now()): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16).replace(/-+$/, "");
  return `hud-${slug || "hud"}-${now.toString(36).slice(-5)}`;
}

export function sanitizeParts(raw: unknown): HudPart[] {
  if (!Array.isArray(raw)) return [];
  const out: HudPart[] = [];
  for (const p of raw.slice(0, 12)) {
    const type = (p as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || !(HUD_PART_TYPES as readonly string[]).includes(type)) continue;
    const t = type as HudPartType;
    if (t === "text") out.push({ type: t, text: String((p as { text?: unknown }).text ?? "").slice(0, 40) });
    else out.push({ type: t });
  }
  return out;
}

export function sanitizeCustomList(raw: unknown): CustomHud[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomHud[] = [];
  for (const r of raw.slice(0, 30)) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 32) : "";
    const height = typeof o.height === "number" && Number.isFinite(o.height) ? Math.min(400, Math.max(80, Math.round(o.height))) : 150;
    if (!isWidgetId(o.id) || !(o.id as string).startsWith("hud-") || !name) continue;
    out.push({ id: o.id as string, name, cols: o.cols === 2 ? 2 : 1, height, parts: sanitizeParts(o.parts) });
  }
  return out;
}

export function customToManifest(h: CustomHud): WidgetManifest {
  return {
    id: h.id, name: h.name, version: "1.0.0", sdk: 1, description: "Custom HUD", entry: "index.html",
    dir: CUSTOM_DIR, permissions: [...CUSTOM_PERMISSIONS], cols: h.cols, height: h.height,
  };
}
