import { describe, expect, it } from "vitest";
import {
  MAX_LAYERS, addLayer, cropSize, duplicateLayer, fitScale, hitTest, layerCorners, moveLayer, newComposition, removeLayer,
  resizeComposition, sanitizeComposition, sanitizeCompositionLibrary, sanitizeCrop, sanitizeLayer, updateLayer, type Layer,
} from "./model";

const layer = (over: Partial<Layer> = {}): Layer =>
  sanitizeLayer({ id: "l-1", image: "i-1", name: "A", x: 100, y: 100, scale: 1, rotation: 0, opacity: 100, ...over })!;
const img = (id = "i-1", w = 200, h = 100) => ({ id, name: id, w, h });

describe("sanitizing", () => {
  it("rejects layers whose image id is not a plain id, and clamps the rest", () => {
    expect(sanitizeLayer({ image: "../etc/passwd" })).toBeNull();
    expect(sanitizeLayer({})).toBeNull();
    const l = sanitizeLayer({ image: "i-1", scale: 999, opacity: -5, rotation: 9999, x: 1e9 })!;
    expect([l.scale, l.opacity, l.rotation, l.x]).toEqual([20, 0, 360, 20000]);
  });

  it("always leaves something of the image visible after cropping", () => {
    const c = sanitizeCrop({ l: 90, r: 90, t: 90, b: 90 });
    expect(c.l + c.r).toBeLessThanOrEqual(95.0001);
    expect(c.t + c.b).toBeLessThanOrEqual(95.0001);
  });

  it("bounds compositions and de-duplicates the saved list", () => {
    const c = sanitizeComposition({ width: 99999, height: 1, bg: "red", layers: Array.from({ length: 100 }, () => ({ image: "i-1" })) });
    expect(c.width).toBe(7680);
    expect(c.height).toBe(360);
    expect(c.bg).toBe("#000000");
    expect(c.layers).toHaveLength(MAX_LAYERS);
    expect(sanitizeCompositionLibrary([{ id: "c-1" }, { id: "c-1" }, { id: "c-2" }])).toHaveLength(2);
    expect(sanitizeCompositionLibrary("x")).toEqual([]);
  });
});

describe("geometry", () => {
  it("hit-tests a plain layer", () => {
    const l = layer(); // 200x100 image centred at (100,100)
    expect(hitTest(l, 200, 100, 150, 120)).toBe(true);
    expect(hitTest(l, 200, 100, 210, 100)).toBe(false);
    expect(hitTest(l, 200, 100, 100, 160)).toBe(false);
  });

  it("follows rotation and scale", () => {
    const rotated = layer({ rotation: 90 }); // the long side now points up and down
    expect(hitTest(rotated, 200, 100, 100, 190)).toBe(true);
    expect(hitTest(rotated, 200, 100, 190, 100)).toBe(false);
    const big = layer({ scale: 2 });
    expect(hitTest(big, 200, 100, 290, 100)).toBe(true);
  });

  it("respects the crop", () => {
    const l = layer({ crop: { l: 50, t: 0, r: 0, b: 0 } }); // half the width is trimmed
    expect(cropSize(200, 100, l.crop).w).toBe(100);
    expect(hitTest(l, 200, 100, 140, 100)).toBe(true);
    expect(hitTest(l, 200, 100, 160, 100)).toBe(false);
  });

  it("computes fit and fill scales", () => {
    const zero = { l: 0, t: 0, r: 0, b: 0 };
    expect(fitScale(400, 200, zero, 800, 800, "fit")).toBe(2);
    expect(fitScale(400, 200, zero, 800, 800, "fill")).toBe(4);
  });

  it("gives rotated corners", () => {
    const c = layerCorners(layer({ rotation: 90 }), 200, 100);
    expect(Math.round(c[0][0])).toBe(150);
    expect(Math.round(c[0][1])).toBe(0);
  });
});

describe("editing", () => {
  it("the first image fills the screen, later ones are placed smaller and centred", () => {
    let comp = newComposition("t", 1920, 1080);
    comp = addLayer(comp, img("i-1", 3840, 2160));
    expect(comp.layers[0]).toMatchObject({ x: 960, y: 540, scale: 0.5 });
    comp = addLayer(comp, img("i-2", 400, 400));
    expect(comp.layers[1].scale).toBeCloseTo((1080 / 400) * 0.5);
    expect(comp.layers[1]).toMatchObject({ x: 960, y: 540 });
  });

  it("caps the number of layers", () => {
    let comp = newComposition();
    for (let i = 0; i < MAX_LAYERS + 5; i++) comp = addLayer(comp, img(`i-${i}`));
    expect(comp.layers).toHaveLength(MAX_LAYERS);
  });

  it("reorders, duplicates, removes and updates safely", () => {
    let comp = newComposition();
    comp = addLayer(addLayer(comp, img("i-1")), img("i-2"));
    const [a, b] = comp.layers.map((l) => l.id);
    comp = moveLayer(comp, a, 1);
    expect(comp.layers.map((l) => l.id)).toEqual([b, a]);
    expect(moveLayer(comp, a, 1).layers.map((l) => l.id)).toEqual([b, a]); // already on top
    comp = duplicateLayer(comp, a);
    expect(comp.layers).toHaveLength(3);
    expect(comp.layers[2].x).toBe(comp.layers[1].x + 30);
    comp = updateLayer(comp, a, { opacity: 500, crop: { l: 20 } });
    const updated = comp.layers.find((l) => l.id === a)!;
    expect([updated.opacity, updated.crop.l, updated.crop.r]).toEqual([100, 20, 0]);
    comp = removeLayer(comp, a);
    expect(comp.layers.find((l) => l.id === a)).toBeUndefined();
  });

  it("keeps layers in the same relative place when the canvas is resized", () => {
    let comp = addLayer(newComposition("t", 1920, 1080), img("i-1"));
    comp = updateLayer(comp, comp.layers[0].id, { x: 480, y: 270 });
    const big = resizeComposition(comp, 3840, 2160);
    expect([big.layers[0].x, big.layers[0].y]).toEqual([960, 540]);
  });
});
