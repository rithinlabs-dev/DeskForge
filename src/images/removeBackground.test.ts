import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMOVE, buildMask, capPixels, estimateBackground, growMask, pixelAt, removeBackground, rgbToHex, sanitizeRemoveOptions, scaleToFit,
  thresholdFor, type Rgb,
} from "./removeBackground";

const WHITE: Rgb = [255, 255, 255];
const RED: Rgb = [255, 0, 0];

function image(w: number, h: number, fill: Rgb): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) d.set([fill[0], fill[1], fill[2], 255], i * 4);
  return d;
}
function paint(d: Uint8ClampedArray, w: number, x0: number, y0: number, rw: number, rh: number, c: Rgb, alpha = 255) {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) d.set([c[0], c[1], c[2], alpha], (y * w + x) * 4);
}
const alphaAt = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];
const countAlpha = (d: Uint8ClampedArray, value: number) => {
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] === value) n++;
  return n;
};

describe("removing a plain background", () => {
  it("clears the background and keeps the subject", () => {
    const d = image(10, 10, WHITE);
    paint(d, 10, 3, 3, 4, 4, RED);
    const result = removeBackground(d, 10, 10, { softness: 0 });
    expect(result.key).toEqual(WHITE);
    expect(result.removedFraction).toBeCloseTo(0.84, 6);
    expect(alphaAt(d, 10, 0, 0)).toBe(0);
    expect(alphaAt(d, 10, 9, 9)).toBe(0);
    expect(alphaAt(d, 10, 3, 3)).toBe(255);
    expect(alphaAt(d, 10, 6, 6)).toBe(255);
    expect(alphaAt(d, 10, 7, 7)).toBe(0);
  });

  it("leaves the colours of the subject untouched", () => {
    const d = image(10, 10, WHITE);
    paint(d, 10, 3, 3, 4, 4, RED);
    removeBackground(d, 10, 10, { softness: 0 });
    expect(pixelAt(d, 10, 4, 4)).toEqual(RED);
  });

  it("keeps same-coloured areas inside the subject in edges mode, and removes them in everywhere mode", () => {
    const edges = image(12, 12, WHITE);
    paint(edges, 12, 2, 2, 8, 8, RED);
    paint(edges, 12, 5, 5, 2, 2, WHITE); // a white hole inside the red square
    const everywhere = new Uint8ClampedArray(edges);

    removeBackground(edges, 12, 12, { mode: "edges", softness: 0 });
    expect(alphaAt(edges, 12, 5, 5)).toBe(255);
    expect(alphaAt(edges, 12, 0, 0)).toBe(0);

    removeBackground(everywhere, 12, 12, { mode: "everywhere", softness: 0 });
    expect(alphaAt(everywhere, 12, 5, 5)).toBe(0);
    expect(alphaAt(everywhere, 12, 3, 3)).toBe(255);
  });

  it("removes a uniform picture entirely, even a large one", () => {
    const d = image(600, 500, WHITE);
    const result = removeBackground(d, 600, 500, { softness: 0 });
    expect(result.removedFraction).toBe(1);
    expect(countAlpha(d, 0)).toBe(600 * 500);
  });

  it("works on a picture one pixel wide or tall", () => {
    const d = image(1, 5, WHITE);
    expect(removeBackground(d, 1, 5, { softness: 0 }).removedFraction).toBe(1);
    const e = image(5, 1, WHITE);
    expect(removeBackground(e, 5, 1, { softness: 0 }).removedFraction).toBe(1);
  });
});

describe("tolerance and the background colour", () => {
  it("a low tolerance is strict and a high one is generous", () => {
    const strict = image(10, 10, WHITE);
    paint(strict, 10, 0, 0, 2, 2, [250, 250, 250]);
    paint(strict, 10, 4, 4, 2, 2, RED);
    const generous = new Uint8ClampedArray(strict);
    removeBackground(strict, 10, 10, { key: WHITE, tolerance: 2, softness: 0 });
    removeBackground(generous, 10, 10, { key: WHITE, tolerance: 10, softness: 0 });
    expect(alphaAt(strict, 10, 0, 0)).toBe(255); // off-white is left alone
    expect(alphaAt(generous, 10, 0, 0)).toBe(0); // off-white goes too
    expect(alphaAt(generous, 10, 4, 4)).toBe(255); // red stays either way
  });

  it("turns a tolerance into a colour distance", () => {
    expect(thresholdFor(0)).toBe(0);
    expect(thresholdFor(100)).toBe(220);
    expect(thresholdFor(50)).toBe(110);
    expect(thresholdFor(-5)).toBe(0);
    expect(thresholdFor(500)).toBe(220);
  });

  it("guesses the background from the most common colour along the border", () => {
    const d = image(20, 20, [0, 160, 0]);
    paint(d, 20, 0, 0, 1, 1, RED);
    paint(d, 20, 8, 8, 4, 4, RED);
    expect(estimateBackground(d, 20, 20)).toEqual([0, 160, 0]);
  });

  it("treats slightly different shades along the border as one colour", () => {
    const d = image(20, 20, [200, 200, 200]);
    paint(d, 20, 0, 0, 20, 1, [203, 203, 203]); // the top edge is a touch lighter
    const [r, g, b] = estimateBackground(d, 20, 20);
    expect(r).toBeGreaterThanOrEqual(200);
    expect(r).toBeLessThanOrEqual(203);
    expect([g, b]).toEqual([r, r]);
  });

  it("falls back to white when the whole border is transparent", () => {
    const d = new Uint8ClampedArray(8 * 8 * 4); // all zero: fully transparent
    expect(estimateBackground(d, 8, 8)).toEqual(WHITE);
  });

  it("can remove a colour you choose, and only touches the border background in edges mode", () => {
    const edges = image(10, 10, WHITE);
    paint(edges, 10, 4, 4, 2, 2, RED);
    const everywhere = new Uint8ClampedArray(edges);
    const result = removeBackground(edges, 10, 10, { key: RED, mode: "edges", softness: 0 });
    expect(result.removedFraction).toBe(0); // the red isn't touching the border, so nothing is reached
    expect(countAlpha(edges, 255)).toBe(100);
    removeBackground(everywhere, 10, 10, { key: RED, mode: "everywhere", softness: 0 });
    expect(alphaAt(everywhere, 10, 4, 4)).toBe(0);
    expect(alphaAt(everywhere, 10, 0, 0)).toBe(255);
  });

  it("removes nothing when no pixel matches", () => {
    const d = image(6, 6, RED);
    const result = removeBackground(d, 6, 6, { key: [0, 0, 255], softness: 0 });
    expect(result.removedFraction).toBe(0);
    expect(countAlpha(d, 255)).toBe(36);
  });

  it("counts already transparent pixels as background", () => {
    const d = image(6, 6, RED);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) if (x === 0 || y === 0 || x === 5 || y === 5) d[(y * 6 + x) * 4 + 3] = 0;
    }
    const result = removeBackground(d, 6, 6, { softness: 0 });
    expect(result.removedFraction).toBeCloseTo(20 / 36, 6);
    expect(alphaAt(d, 6, 2, 2)).toBe(255);
    expect(alphaAt(d, 6, 0, 3)).toBe(0);
  });
});

describe("edges", () => {
  it("fades the subject's edge inward without growing the background into it", () => {
    const d = image(21, 21, WHITE);
    paint(d, 21, 6, 6, 9, 9, RED);
    removeBackground(d, 21, 21, { softness: 1 });
    const edge = alphaAt(d, 21, 6, 10); // on the square's left edge
    expect(edge).toBeGreaterThan(100);
    expect(edge).toBeLessThan(255);
    expect(alphaAt(d, 21, 10, 10)).toBe(255); // deep inside: solid
    expect(alphaAt(d, 21, 5, 10)).toBe(0); // just outside: still fully clear
    expect(alphaAt(d, 21, 0, 0)).toBe(0);
  });

  it("trims the edge inward by the number of pixels asked for", () => {
    const d = image(10, 10, WHITE);
    paint(d, 10, 3, 3, 4, 4, RED);
    removeBackground(d, 10, 10, { shrink: 1, softness: 0 });
    expect(countAlpha(d, 255)).toBe(4); // a 4x4 square loses its outer ring and keeps the 2x2 middle
    expect(alphaAt(d, 10, 4, 4)).toBe(255);
    expect(alphaAt(d, 10, 3, 3)).toBe(0);
  });

  it("keeps the transparency the subject already had", () => {
    const d = image(10, 10, WHITE);
    paint(d, 10, 3, 3, 4, 4, RED, 128);
    removeBackground(d, 10, 10, { softness: 0 });
    expect(alphaAt(d, 10, 4, 4)).toBe(128);
  });

  it("grows a mask one step at a time", () => {
    const mask = new Uint8Array(25);
    mask[12] = 1; // the middle of a 5x5 picture
    const grown = growMask(mask, 5, 5, 1);
    expect([...grown].reduce((a, b) => a + b, 0)).toBe(5); // the middle and its four neighbours
    expect(grown[7]).toBe(1);
    expect(grown[0]).toBe(0);
    expect([...growMask(mask, 5, 5, 0)]).toEqual([...mask]);
    expect(growMask(mask, 5, 5, 2).reduce((a, b) => a + b, 0)).toBe(13);
  });

  it("builds a mask the same size as the picture", () => {
    const d = image(7, 4, WHITE);
    const { mask, key } = buildMask(d, 7, 4, DEFAULT_REMOVE);
    expect(mask).toHaveLength(28);
    expect(key).toEqual(WHITE);
  });
});

describe("options and sizes", () => {
  it("clamps every option and falls back to the defaults", () => {
    expect(sanitizeRemoveOptions({ tolerance: 500, shrink: 9, softness: 99 })).toMatchObject({ tolerance: 100, shrink: 4, softness: 8 });
    expect(sanitizeRemoveOptions({ tolerance: -5, shrink: -1, softness: -3 })).toMatchObject({ tolerance: 0, shrink: 0, softness: 0 });
    expect(sanitizeRemoveOptions({ mode: "sideways" as never }).mode).toBe("edges");
    expect(sanitizeRemoveOptions({ mode: "everywhere" }).mode).toBe("everywhere");
    expect(sanitizeRemoveOptions({ tolerance: Number.NaN }).tolerance).toBe(DEFAULT_REMOVE.tolerance);
    expect(sanitizeRemoveOptions(undefined)).toEqual(DEFAULT_REMOVE);
    expect(sanitizeRemoveOptions(null)).toEqual(DEFAULT_REMOVE);
  });

  it("accepts a clean colour and rejects anything else", () => {
    expect(sanitizeRemoveOptions({ key: [300, -5, 10.4] }).key).toEqual([255, 0, 10]);
    expect(sanitizeRemoveOptions({ key: [1, 2] as never }).key).toBeNull();
    expect(sanitizeRemoveOptions({ key: "red" as never }).key).toBeNull();
    expect(sanitizeRemoveOptions({ key: [1, 2, Number.NaN] }).key).toBeNull();
  });

  it("writes colours as hex and reads pixels", () => {
    expect(rgbToHex([255, 0, 10])).toBe("#ff000a");
    expect(rgbToHex([0, 0, 0])).toBe("#000000");
    const d = image(3, 3, WHITE);
    paint(d, 3, 1, 2, 1, 1, [1, 2, 3]);
    expect(pixelAt(d, 3, 1, 2)).toEqual([1, 2, 3]);
  });

  it("scales a picture down to fit, keeping its shape, and never up", () => {
    expect(scaleToFit(4000, 3000, 1000)).toEqual({ width: 1000, height: 750, scale: 0.25 });
    expect(scaleToFit(3000, 4000, 1000)).toEqual({ width: 750, height: 1000, scale: 0.25 });
    expect(scaleToFit(500, 300, 1000)).toEqual({ width: 500, height: 300, scale: 1 });
  });

  it("caps the number of pixels", () => {
    expect(capPixels(1000, 1000, 2_000_000)).toEqual({ width: 1000, height: 1000, scale: 1 });
    const big = capPixels(4000, 3000, 6_000_000);
    expect(big.width * big.height).toBeLessThanOrEqual(6_000_000);
    expect(big.width / big.height).toBeCloseTo(4 / 3, 1);
    expect(big.scale).toBeLessThan(1);
  });
});
