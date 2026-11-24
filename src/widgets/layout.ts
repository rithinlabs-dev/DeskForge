import { isWidgetId } from "./manifest";

export type LayoutElementKind = "text" | "visual" | "interactive";
export type TextAlignment = "left" | "center" | "right";

export interface WidgetElementInfo {
  id: string;
  label: string;
  kind: LayoutElementKind;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  color: string;
  align: TextAlignment;
}

export interface ElementLayout {
  x: number;
  y: number;
  order: number;
  scale: number;
  opacity: number;
  fontSize?: number;
  color?: string;
  align?: TextAlignment;
}

export type WidgetLayout = Record<string, ElementLayout>;
export type WidgetLayoutMap = Record<string, WidgetLayout>;

const ELEMENT_ID = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const numberIn = (v: unknown, fallback: number, min: number, max: number, integer = false): number =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, integer ? Math.round(v) : v))
    : fallback;

export function sanitizeElementLayout(raw: unknown): ElementLayout {
  const r = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
  const out: ElementLayout = {
    x: numberIn(r.x, 0, -100, 100),
    y: numberIn(r.y, 0, -100, 100),
    order: numberIn(r.order, 0, 0, 100, true),
    scale: numberIn(r.scale, 1, 0.25, 3),
    opacity: numberIn(r.opacity, 100, 0, 100, true),
  };
  if (typeof r.fontSize === "number" && Number.isFinite(r.fontSize)) {
    out.fontSize = numberIn(r.fontSize, 16, 8, 96, true);
  }
  if (typeof r.color === "string" && HEX_COLOR.test(r.color)) out.color = r.color.toLowerCase();
  if (r.align === "left" || r.align === "center" || r.align === "right") out.align = r.align;
  return out;
}

export function sanitizeWidgetLayout(raw: unknown): WidgetLayout {
  const out: WidgetLayout = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>).slice(0, 80)) {
    if (ELEMENT_ID.test(id)) out[id] = sanitizeElementLayout(value);
  }
  return out;
}

export function sanitizeWidgetLayoutMap(raw: unknown): WidgetLayoutMap {
  const out: WidgetLayoutMap = {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return out;
  for (const [id, layout] of Object.entries(raw as Record<string, unknown>).slice(0, 60)) {
    if (isWidgetId(id)) out[id] = sanitizeWidgetLayout(layout);
  }
  return out;
}

export function sanitizeWidgetElements(raw: unknown): WidgetElementInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: WidgetElementInfo[] = [];
  const seen = new Set<string>();
  for (const item of raw.slice(0, 80)) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || !ELEMENT_ID.test(r.id) || seen.has(r.id)) continue;
    if (r.kind !== "text" && r.kind !== "visual" && r.kind !== "interactive") continue;
    const color = typeof r.color === "string" && HEX_COLOR.test(r.color) ? r.color.toLowerCase() : "#ffffff";
    const align = r.align === "center" || r.align === "right" ? r.align : "left";
    seen.add(r.id);
    out.push({
      id: r.id,
      label: typeof r.label === "string" ? r.label.trim().slice(0, 48) || r.id : r.id,
      kind: r.kind,
      x: numberIn(r.x, 0, -10000, 10000),
      y: numberIn(r.y, 0, -10000, 10000),
      width: numberIn(r.width, 0, 0, 10000),
      height: numberIn(r.height, 0, 0, 10000),
      fontSize: numberIn(r.fontSize, 16, 1, 256),
      color,
      align,
    });
  }
  return out;
}
