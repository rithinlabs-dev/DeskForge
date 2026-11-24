import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, createHistory, redo, undo } from "./history";
import { handleAt, layerHandles, moveLayerTo, rotateFromDrag, sanitizeComposition, sanitizeLayer, scaleFromDrag } from "./model";

describe("composition history", () => {
  it("undoes and redoes one-off edits", () => {
    let h = createHistory(1);
    h = commit(h, 2);
    h = commit(h, 3);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canRedo(h)).toBe(false);
  });

  it("a new edit discards the redo branch", () => {
    let h = commit(commit(createHistory("a"), "b"), "c");
    h = undo(h);
    h = commit(h, "d");
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe("d");
    expect(undo(h).present).toBe("b");
  });

  it("merges a burst of changes in the same group into one step", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 50; i++) h = commit(h, i, "drag:1", 1000 + i * 10);
    expect(h.present).toBe(50);
    expect(h.past).toEqual([0]);
    expect(undo(h).present).toBe(0);
  });

  it("starts a new step for a different group or after a pause", () => {
    let h = createHistory(0);
    h = commit(h, 1, "drag:1", 1000);
    h = commit(h, 2, "drag:1", 1100);
    h = commit(h, 3, "drag:2", 1200);
    expect(h.past).toEqual([0, 2]);
    h = commit(h, 4, "drag:2", 5000); // long pause
    expect(h.past).toEqual([0, 2, 3]);
  });

  it("ignores edits that change nothing, and caps its size", () => {
    const h = createHistory({ a: 1 });
    expect(commit(h, h.present)).toBe(h);
    let big = createHistory(0);
    for (let i = 1; i <= 30; i++) big = commit(big, i, "", i, 700, 10);
    expect(big.past).toHaveLength(10);
    expect(big.past[0]).toBe(20);
  });
});

const layer = (over: object = {}) => sanitizeLayer({ image: "i-1", x: 100, y: 100, scale: 1, ...over })!;

describe("selection handles", () => {
  it("places the corners and a rotate handle above the top edge", () => {
    const h = layerHandles(layer(), 200, 100, 20);
    expect(h.corners).toEqual([[0, 50], [200, 50], [200, 150], [0, 150]]);
    expect(h.rotate[0]).toBeCloseTo(100, 6);
    expect(h.rotate[1]).toBeCloseTo(30, 6); // 50 above the centre to the edge, plus 20
  });

  it("turns the rotate handle with the layer", () => {
    const h = layerHandles(layer({ rotation: 90 }), 200, 100, 20);
    expect(h.rotate[0]).toBeCloseTo(170, 6); // "up" now points right
    expect(h.rotate[1]).toBeCloseTo(100, 6);
  });

  it("finds the handle under the pointer, rotate first", () => {
    const l = layer();
    expect(handleAt(l, 200, 100, 0, 50, 8, 20)).toBe("tl");
    expect(handleAt(l, 200, 100, 200, 50, 8, 20)).toBe("tr");
    expect(handleAt(l, 200, 100, 203, 148, 8, 20)).toBe("br");
    expect(handleAt(l, 200, 100, 0, 150, 8, 20)).toBe("bl");
    expect(handleAt(l, 200, 100, 100, 30, 8, 20)).toBe("rotate");
    expect(handleAt(l, 200, 100, 100, 100, 8, 20)).toBeNull();
    expect(handleAt(l, 200, 100, 30, 80, 8, 20)).toBeNull();
  });

  it("scales about the centre in proportion to the pointer distance", () => {
    const c = { x: 0, y: 0 };
    expect(scaleFromDrag(1, c, { x: 10, y: 0 }, { x: 20, y: 0 })).toBeCloseTo(2, 9);
    expect(scaleFromDrag(2, c, { x: 10, y: 0 }, { x: 5, y: 0 })).toBeCloseTo(1, 9);
    expect(scaleFromDrag(1, c, { x: 10, y: 0 }, { x: 1e6, y: 0 })).toBe(20);
    expect(scaleFromDrag(1, c, { x: 10, y: 0 }, { x: 0, y: 0 })).toBe(0.02);
    expect(scaleFromDrag(1.5, c, { x: 0.2, y: 0 }, { x: 50, y: 0 })).toBe(1.5); // grabbed at the centre: no jump
  });

  it("rotates by the angle the pointer sweeps, wraps, and snaps near multiples of 15", () => {
    const c = { x: 0, y: 0 };
    const at = (deg: number) => ({ x: Math.cos((deg * Math.PI) / 180) * 10, y: Math.sin((deg * Math.PI) / 180) * 10 });
    expect(rotateFromDrag(0, c, at(0), at(90))).toBe(90);
    expect(rotateFromDrag(0, c, at(0), at(91))).toBe(90); // snapped
    expect(rotateFromDrag(0, c, at(0), at(91), false)).toBe(91); // snapping off
    expect(rotateFromDrag(0, c, at(0), at(37))).toBe(37); // not near a multiple
    expect(rotateFromDrag(170, c, at(0), at(20))).toBe(-170); // wraps past 180
  });

  it("reorders layers by position", () => {
    const comp = sanitizeComposition({ layers: ["a", "b", "c", "d"].map((id) => ({ id, image: "i-1" })) });
    const ids = (c: typeof comp) => c.layers.map((l) => l.id);
    expect(ids(moveLayerTo(comp, "a", 3))).toEqual(["b", "c", "d", "a"]);
    expect(ids(moveLayerTo(comp, "d", 0))).toEqual(["d", "a", "b", "c"]);
    expect(ids(moveLayerTo(comp, "b", 99))).toEqual(["a", "c", "d", "b"]);
    expect(moveLayerTo(comp, "b", 1)).toBe(comp);
    expect(moveLayerTo(comp, "missing", 0)).toBe(comp);
  });
});
