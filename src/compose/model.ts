// Desktop composition model (Phase 5.2): layers of imported images arranged on a canvas the size of the screen.
// Pure and unit-tested: everything read from storage goes through the sanitizers, and no function here can throw.
import { parseResolution } from "../shared/wallpaperConfig";

export interface Crop { l: number; t: number; r: number; b: number } // percent trimmed from each side
export interface Layer {
  id: string;
  name: string;
  image: string; // id in the image library
  x: number; // centre, in composition pixels
  y: number;
  scale: number; // of the cropped image
  rotation: number; // degrees, clockwise
  opacity: number; // 0-100
  flipX: boolean;
  crop: Crop;
}
export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  bg: string;
  layers: Layer[]; // bottom first, top last
}

export const MAX_LAYERS = 40;
export const MAX_SAVED = 30;
export const RESOLUTIONS = ["1920x1080", "2560x1440", "3840x2160", "1366x768", "2560x1080", "3440x1440"] as const;

const ID = /^[A-Za-z0-9-]{1,40}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: unknown, min: number, max: number, fb: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb;
const text = (v: unknown, max: number, fb: string) =>
  (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, max) : "") || fb;

export const newId = (prefix: string): string =>
  prefix + Math.floor(Math.random() * 0xffffffff).toString(16) + Date.now().toString(36).slice(-4);

export function sanitizeCrop(raw: unknown): Crop {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  let l = clamp(r.l, 0, 90, 0), rr = clamp(r.r, 0, 90, 0), t = clamp(r.t, 0, 90, 0), b = clamp(r.b, 0, 90, 0);
  if (l + rr > 95) { const k = 95 / (l + rr); l *= k; rr *= k; } // always leave something to draw
  if (t + b > 95) { const k = 95 / (t + b); t *= k; b *= k; }
  return { l, t, r: rr, b };
}

export function sanitizeLayer(raw: unknown): Layer | null {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (typeof o.image !== "string" || !ID.test(o.image)) return null;
  return {
    id: typeof o.id === "string" && ID.test(o.id) ? o.id : newId("l-"),
    name: text(o.name, 48, "Layer"),
    image: o.image,
    x: clamp(o.x, -20000, 20000, 0),
    y: clamp(o.y, -20000, 20000, 0),
    scale: clamp(o.scale, 0.02, 20, 1),
    rotation: clamp(o.rotation, -360, 360, 0),
    opacity: clamp(o.opacity, 0, 100, 100),
    flipX: o.flipX === true,
    crop: sanitizeCrop(o.crop),
  };
}

export function sanitizeComposition(raw: unknown): Composition {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const layers: Layer[] = [];
  for (const l of (Array.isArray(o.layers) ? o.layers : []).slice(0, MAX_LAYERS)) {
    const s = sanitizeLayer(l);
    if (s) layers.push(s);
  }
  return {
    id: typeof o.id === "string" && ID.test(o.id) ? o.id : newId("c-"),
    name: text(o.name, 48, "Untitled"),
    width: Math.round(clamp(o.width, 640, 7680, 1920)),
    height: Math.round(clamp(o.height, 360, 4320, 1080)),
    bg: typeof o.bg === "string" && HEX.test(o.bg) ? o.bg.toLowerCase() : "#000000",
    layers,
  };
}

export function sanitizeCompositionLibrary(raw: unknown): Composition[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Composition[] = [];
  for (const item of raw.slice(0, MAX_SAVED)) {
    const c = sanitizeComposition(item);
    if (!seen.has(c.id)) {
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

export function newComposition(name = "Untitled", w = 1920, h = 1080): Composition {
  const res = parseResolution(`${w}x${h}`) ?? { width: 1920, height: 1080 };
  return { id: newId("c-"), name, width: res.width, height: res.height, bg: "#000000", layers: [] };
}

// ---- geometry -------------------------------------------------------------------------------------------------

export function cropSize(bw: number, bh: number, c: Crop) {
  return { w: bw * (1 - (c.l + c.r) / 100), h: bh * (1 - (c.t + c.b) / 100) };
}

/** Scale at which the (cropped) image fits inside, or fills, a canvas. */
export function fitScale(bw: number, bh: number, c: Crop, cw: number, ch: number, mode: "fit" | "fill"): number {
  const { w, h } = cropSize(bw, bh, c);
  if (w <= 0 || h <= 0) return 1;
  const sx = cw / w;
  const sy = ch / h;
  return Math.min(20, Math.max(0.02, mode === "fit" ? Math.min(sx, sy) : Math.max(sx, sy)));
}

/** Is the point (px, py), in composition pixels, on this layer? Handles rotation, scale and crop. */
export function hitTest(layer: Layer, bw: number, bh: number, px: number, py: number): boolean {
  const { w, h } = cropSize(bw, bh, layer.crop);
  const a = (-layer.rotation * Math.PI) / 180;
  const dx = px - layer.x;
  const dy = py - layer.y;
  const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / layer.scale;
  const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / layer.scale;
  return Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2;
}

/** The four corners of a layer in composition pixels (for the selection outline). */
export function layerCorners(layer: Layer, bw: number, bh: number): [number, number][] {
  const { w, h } = cropSize(bw, bh, layer.crop);
  const a = (layer.rotation * Math.PI) / 180;
  const hw = (w * layer.scale) / 2;
  const hh = (h * layer.scale) / 2;
  const rawCos = Math.cos(a);
  const cos = Math.abs(rawCos) < 1e-12 ? 0 : rawCos;
  const rawSin = Math.sin(a);
  const sin = Math.abs(rawSin) < 1e-12 ? 0 : rawSin;
  const clean = (value: number) => Object.is(value, -0) ? 0 : value;

  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as [number, number][]).map(([x, y]) => [
    clean(layer.x + x * cos - y * sin),
    clean(layer.y + x * sin + y * cos),
  ]);
}

// ---- editing (each returns a new composition) -----------------------------------------------------------------

// ---- on-canvas handles: resize and rotate the selected layer --------------------------------------------------

export type HandleKind = "tl" | "tr" | "br" | "bl" | "rotate";

/**
 * Where the four corner handles and the rotate handle sit, in composition pixels. `reach` is how far the rotate handle
 * floats beyond the layer's own top edge (it turns with the layer).
 */
export function layerHandles(layer: Layer, bw: number, bh: number, reach: number): { corners: [number, number][]; rotate: [number, number] } {
  const corners = layerCorners(layer, bw, bh);
  const { h } = cropSize(bw, bh, layer.crop);
  const a = (layer.rotation * Math.PI) / 180;
  const out = (h * layer.scale) / 2 + reach;
  return { corners, rotate: [layer.x + out * Math.sin(a), layer.y - out * Math.cos(a)] };
}

/** Which handle is under the point (px, py)? `tolerance` is the grab radius in composition pixels. */
export function handleAt(layer: Layer, bw: number, bh: number, px: number, py: number, tolerance: number, reach: number): HandleKind | null {
  const { corners, rotate } = layerHandles(layer, bw, bh, reach);
  if (Math.hypot(px - rotate[0], py - rotate[1]) <= tolerance) return "rotate";
  const kinds: HandleKind[] = ["tl", "tr", "br", "bl"];
  for (let i = 0; i < 4; i++) {
    if (Math.hypot(px - corners[i][0], py - corners[i][1]) <= tolerance) return kinds[i];
  }
  return null;
}

type Pt = { x: number; y: number };

/** Dragging a corner scales the layer about its centre by how much farther from (or nearer to) the centre the pointer is. */
export function scaleFromDrag(startScale: number, center: Pt, from: Pt, to: Pt): number {
  const d0 = Math.hypot(from.x - center.x, from.y - center.y);
  const d1 = Math.hypot(to.x - center.x, to.y - center.y);
  if (d0 < 1) return startScale;
  return Math.min(20, Math.max(0.02, startScale * (d1 / d0)));
}

/** Dragging the rotate handle turns the layer by the angle the pointer swept; snaps to every 15 degrees when close. */
export function rotateFromDrag(startRotation: number, center: Pt, from: Pt, to: Pt, snap = true): number {
  const a0 = Math.atan2(from.y - center.y, from.x - center.x);
  const a1 = Math.atan2(to.y - center.y, to.x - center.x);
  let deg = startRotation + ((a1 - a0) * 180) / Math.PI;
  deg = ((((deg + 180) % 360) + 360) % 360) - 180; // keep it in -180..180
  if (snap) {
    const nearest = Math.round(deg / 15) * 15;
    if (Math.abs(deg - nearest) <= 3) deg = nearest;
  }
  return Math.round(deg * 10) / 10;
}

/** Moves a layer to a position in the stack (0 = bottom). Used by drag-to-reorder. */
export function moveLayerTo(comp: Composition, id: string, toIndex: number): Composition {
  const from = comp.layers.findIndex((l) => l.id === id);
  if (from < 0) return comp;
  const to = Math.min(comp.layers.length - 1, Math.max(0, Math.round(toIndex)));
  if (from === to) return comp;
  const layers = [...comp.layers];
  const [item] = layers.splice(from, 1);
  layers.splice(to, 0, item);
  return { ...comp, layers };
}

export function addLayer(comp: Composition, img: { id: string; name: string; w: number; h: number }): Composition {
  if (comp.layers.length >= MAX_LAYERS) return comp;
  const first = comp.layers.length === 0; // the first image becomes the background: fill the screen
  const zero: Crop = { l: 0, t: 0, r: 0, b: 0 };
  const base = fitScale(img.w, img.h, zero, comp.width, comp.height, first ? "fill" : "fit");
  const layer = sanitizeLayer({ image: img.id, name: img.name, x: comp.width / 2, y: comp.height / 2, scale: first ? base : base * 0.5 });
  return layer ? { ...comp, layers: [...comp.layers, layer] } : comp;
}

type LayerPatch = Partial<Omit<Layer, "crop">> & { crop?: Partial<Crop> };

export function updateLayer(comp: Composition, id: string, patch: LayerPatch): Composition {
  return {
    ...comp,
    layers: comp.layers.map((l) => (l.id === id ? sanitizeLayer({ ...l, ...patch, crop: { ...l.crop, ...(patch.crop ?? {}) } }) ?? l : l)),
  };
}

export const replaceImage = (comp: Composition, id: string, image: string): Composition => updateLayer(comp, id, { image });

/** dir +1 moves the layer up (towards the top of the stack), -1 down. */
export function moveLayer(comp: Composition, id: string, dir: 1 | -1): Composition {
  const i = comp.layers.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= comp.layers.length) return comp;
  const layers = [...comp.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ...comp, layers };
}

export const removeLayer = (comp: Composition, id: string): Composition => ({ ...comp, layers: comp.layers.filter((l) => l.id !== id) });

export function duplicateLayer(comp: Composition, id: string): Composition {
  const i = comp.layers.findIndex((l) => l.id === id);
  if (i < 0 || comp.layers.length >= MAX_LAYERS) return comp;
  const copy = sanitizeLayer({ ...comp.layers[i], id: newId("l-"), x: comp.layers[i].x + 30, y: comp.layers[i].y + 30 });
  if (!copy) return comp;
  const layers = [...comp.layers];
  layers.splice(i + 1, 0, copy);
  return { ...comp, layers };
}

/** Change the canvas size and keep every layer in the same relative place. */
export function resizeComposition(comp: Composition, width: number, height: number): Composition {
  const sx = width / comp.width;
  const sy = height / comp.height;
  return sanitizeComposition({ ...comp, width, height, layers: comp.layers.map((l) => ({ ...l, x: l.x * sx, y: l.y * sy })) });
}
