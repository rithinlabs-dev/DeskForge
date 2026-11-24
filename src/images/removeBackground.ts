// Background removal for imported images. Pure and unit-tested: it works on plain RGBA pixel arrays, so it needs no
// canvas to test, and it never leaves the PC (no upload, no online service, no downloaded model).
//
// How it works: the background colour is taken from the picture's border (or from a colour you click). Pixels close
// enough to that colour count as background. In "edges" mode only the background that touches the picture's border
// is removed (so a white shirt inside a white-background photo stays), in "everywhere" mode every pixel of that
// colour goes. The cut edge can be trimmed inward and softened.
//
// Honest limit: this is colour-based. It works very well on logos, products, drawings and anything on a plain or
// near-plain background. It cannot cut a person out of a busy photograph; that needs an AI model.

export type Rgb = [number, number, number];
export type RemoveMode = "edges" | "everywhere";

export interface RemoveOptions {
  /** The colour to remove; null = guess it from the picture's border. */
  key: Rgb | null;
  /** 0-100: how far from the key colour a pixel may be and still count as background. */
  tolerance: number;
  mode: RemoveMode;
  /** Pixels to eat into the subject's edge to cut away colour fringe (0-4). */
  shrink: number;
  /** Pixels of soft fade along the edge (0-8). */
  softness: number;
}

export const DEFAULT_REMOVE: RemoveOptions = { key: null, tolerance: 30, mode: "edges", shrink: 0, softness: 1 };

/** Pixels more transparent than this already count as background. */
const TRANSPARENT_BELOW = 16;
/** The largest colour distance a tolerance of 100 allows (the whole RGB cube is about 441). */
const MAX_THRESHOLD = 220;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

function cleanKey(v: unknown): Rgb | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  if (!v.every((c) => typeof c === "number" && Number.isFinite(c))) return null;
  return v.map((c) => Math.min(255, Math.max(0, Math.round(c)))) as Rgb;
}

export function sanitizeRemoveOptions(raw: Partial<RemoveOptions> | null | undefined): RemoveOptions {
  const r = raw ?? {};
  return {
    key: cleanKey(r.key),
    tolerance: clampInt(r.tolerance, 0, 100, DEFAULT_REMOVE.tolerance),
    mode: r.mode === "everywhere" ? "everywhere" : "edges",
    shrink: clampInt(r.shrink, 0, 4, DEFAULT_REMOVE.shrink),
    softness: clampInt(r.softness, 0, 8, DEFAULT_REMOVE.softness),
  };
}

export function thresholdFor(tolerance: number): number {
  return (Math.min(100, Math.max(0, tolerance)) / 100) * MAX_THRESHOLD;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function pixelAt(data: Uint8ClampedArray, width: number, x: number, y: number): Rgb {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

/**
 * The most common colour along the picture's border (similar shades count together), ignoring transparent pixels.
 * Falls back to white when the whole border is transparent.
 */
export function estimateBackground(data: Uint8ClampedArray, width: number, height: number): Rgb {
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < TRANSPARENT_BELOW) return;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.count++;
      bucket.r += data[i];
      bucket.g += data[i + 1];
      bucket.b += data[i + 2];
    } else {
      buckets.set(key, { count: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
    }
  };
  const stepX = Math.max(1, Math.floor(width / 400));
  const stepY = Math.max(1, Math.floor(height / 400));
  for (let x = 0; x < width; x += stepX) {
    take(x, 0);
    take(x, height - 1);
  }
  for (let y = 0; y < height; y += stepY) {
    take(0, y);
    take(width - 1, y);
  }
  let best: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) if (!best || bucket.count > best.count) best = bucket;
  if (!best) return [255, 255, 255];
  return [Math.round(best.r / best.count), Math.round(best.g / best.count), Math.round(best.b / best.count)];
}

/** 1 where a pixel is background, 0 where it stays. */
export function buildMask(data: Uint8ClampedArray, width: number, height: number, options: RemoveOptions): { mask: Uint8Array; key: Rgb } {
  const key = options.key ?? estimateBackground(data, width, height);
  const limit = thresholdFor(options.tolerance) ** 2;
  const total = width * height;
  const mask = new Uint8Array(total);

  const isBackground = (p: number): boolean => {
    const i = p * 4;
    if (data[i + 3] < TRANSPARENT_BELOW) return true;
    const dr = data[i] - key[0];
    const dg = data[i + 1] - key[1];
    const db = data[i + 2] - key[2];
    return dr * dr + dg * dg + db * db <= limit;
  };

  if (options.mode === "everywhere") {
    for (let p = 0; p < total; p++) if (isBackground(p)) mask[p] = 1;
    return { mask, key };
  }

  // flood fill inward from the border; a plain queue (no recursion) so big pictures can't overflow the stack
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const visit = (p: number) => {
    if (mask[p] === 0 && isBackground(p)) {
      mask[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % width;
    if (x > 0) visit(p - 1);
    if (x < width - 1) visit(p + 1);
    if (p >= width) visit(p - width);
    if (p < total - width) visit(p + width);
  }
  return { mask, key };
}

/** Grows the background by `steps` pixels (which trims the subject's edge). Returns a new mask. */
export function growMask(mask: Uint8Array, width: number, height: number, steps: number): Uint8Array {
  let current = mask;
  for (let s = 0; s < steps; s++) {
    const next = new Uint8Array(current);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x;
        if (current[p]) continue;
        if ((x > 0 && current[p - 1]) || (x < width - 1 && current[p + 1]) || (y > 0 && current[p - width]) || (y < height - 1 && current[p + width])) next[p] = 1;
      }
    }
    current = next;
  }
  return current;
}

function boxBlur(src: Float32Array, width: number, height: number, radius: number): Float32Array {
  const size = 2 * radius + 1;
  const clamp = (v: number, max: number) => (v < 0 ? 0 : v > max ? max : v);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + clamp(k, width - 1)];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / size;
      sum += src[row + clamp(x + radius + 1, width - 1)] - src[row + clamp(x - radius, width - 1)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[clamp(k, height - 1) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / size;
      sum += tmp[clamp(y + radius + 1, height - 1) * width + x] - tmp[clamp(y - radius, height - 1) * width + x];
    }
  }
  return out;
}

/**
 * Makes the background transparent. With softness the subject's edge fades out over that many pixels, but the
 * background never grows into the subject's side, so no halo of background colour appears.
 */
export function applyMask(data: Uint8ClampedArray, mask: Uint8Array, width: number, height: number, softness: number): void {
  const total = width * height;
  if (softness <= 0) {
    for (let p = 0; p < total; p++) if (mask[p]) data[p * 4 + 3] = 0;
    return;
  }
  const keep = new Float32Array(total);
  for (let p = 0; p < total; p++) keep[p] = mask[p] ? 0 : 1;
  const blurred = boxBlur(keep, width, height, Math.round(softness));
  for (let p = 0; p < total; p++) {
    const fade = Math.min(blurred[p], keep[p]);
    data[p * 4 + 3] = Math.round(data[p * 4 + 3] * fade);
  }
}

export interface RemoveResult {
  /** The colour that was removed (the guess, or the one you gave). */
  key: Rgb;
  /** 0-1: how much of the picture became transparent. */
  removedFraction: number;
}

/** Removes the background in place. `data` is RGBA pixels, row by row. */
export function removeBackground(data: Uint8ClampedArray, width: number, height: number, options: Partial<RemoveOptions> = {}): RemoveResult {
  const opts = sanitizeRemoveOptions(options);
  const { mask, key } = buildMask(data, width, height, opts);
  const final = opts.shrink > 0 ? growMask(mask, width, height, opts.shrink) : mask;
  applyMask(data, final, width, height, opts.softness);
  let removed = 0;
  for (let p = 0; p < final.length; p++) if (final[p]) removed++;
  return { key, removedFraction: final.length ? removed / final.length : 0 };
}

/** Size that fits inside `maxSide` pixels on its longest side, keeping the shape. Never enlarges. */
export function scaleToFit(width: number, height: number, maxSide: number): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide || longest <= 0) return { width, height, scale: 1 };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale };
}

/** Size reduced (keeping the shape) so it has at most `maxPixels` pixels. Never enlarges. */
export function capPixels(width: number, height: number, maxPixels: number): { width: number; height: number; scale: number } {
  if (width * height <= maxPixels) return { width, height, scale: 1 };
  const scale = Math.sqrt(maxPixels / (width * height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), scale };
}
