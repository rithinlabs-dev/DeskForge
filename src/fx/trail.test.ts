import { describe, expect, it } from "vitest";
import { advanceTrail, createTrail } from "./engine";

const cfg = { length: 10, fade: 1 };

describe("advanceTrail (timestamped samples)", () => {
  it("places each sample at its true age", () => {
    const t = createTrail();
    advanceTrail(t, [{ x: 0, y: 0, t: 900 }, { x: 10, y: 0, t: 950 }], 1000, 0.016, cfg);
    expect(t.points.map((p) => Math.round(p.age * 1000) / 1000)).toEqual([0.1, 0.05]);
    expect(t.points.map((p) => p.x)).toEqual([0, 10]);
  });

  it("ages existing points by the real frame time", () => {
    const t = createTrail();
    advanceTrail(t, [{ x: 0, y: 0, t: 1000 }], 1000, 0.016, cfg);
    advanceTrail(t, [], 1016, 0.016, cfg);
    advanceTrail(t, [], 1032, 0.016, cfg);
    expect(t.points[0].age).toBeCloseTo(0.032, 5);
  });

  it("thins samples that are closer together than the minimum gap", () => {
    const t = createTrail();
    const samples = [0, 1, 2, 3, 4, 5].map((x, i) => ({ x, y: 0, t: 990 + i }));
    advanceTrail(t, samples, 1000, 0.016, cfg);
    expect(t.points.map((p) => p.x)).toEqual([0, 3]);
    expect(t.points).toHaveLength(2);
  });

  it("always keeps the first sample, even at the origin", () => {
    const t = createTrail();
    advanceTrail(t, [{ x: 0, y: 0, t: 5 }], 10, 0.016, cfg);
    expect(t.points).toHaveLength(1);
  });

  it("a still cursor fades the trail out and never re-creates points", () => {
    const t = createTrail();
    const fade = { length: 10, fade: 0.3 };
    advanceTrail(t, [{ x: 50, y: 50, t: 1000 }], 1000, 0.016, fade);
    for (let i = 0; i < 100; i++) advanceTrail(t, [], 1000 + i * 50, 0.05, fade);
    expect(t.points).toHaveLength(0);
    advanceTrail(t, [{ x: 50, y: 50, t: 9000 }], 9000, 0.016, fade); // same spot: nothing new
    expect(t.points).toHaveLength(0);
    advanceTrail(t, [{ x: 90, y: 50, t: 9010 }], 9010, 0.016, fade); // moved: a point again
    expect(t.points).toHaveLength(1);
  });

  it("drops samples that are already older than the fade time", () => {
    const t = createTrail();
    advanceTrail(t, [{ x: 0, y: 0, t: 0 }, { x: 40, y: 0, t: 1900 }], 2000, 0.016, { length: 10, fade: 0.5 });
    expect(t.points.map((p) => p.x)).toEqual([40]);
  });

  it("respects the length limit", () => {
    const t = createTrail();
    const samples = Array.from({ length: 50 }, (_, i) => ({ x: i * 5, y: 0, t: 950 + i }));
    advanceTrail(t, samples, 1000, 0.016, { length: 8, fade: 10 });
    expect(t.points).toHaveLength(8);
    expect(t.points[t.points.length - 1].x).toBe(245); // the newest survive
  });

  it("keeps points ordered oldest first across frames", () => {
    const t = createTrail();
    let now = 1000;
    for (let frame = 0; frame < 20; frame++) {
      now += 16;
      advanceTrail(t, [{ x: frame * 10, y: 0, t: now - 4 }, { x: frame * 10 + 5, y: 0, t: now - 1 }], now, 0.016, { length: 60, fade: 5 });
    }
    for (let i = 1; i < t.points.length; i++) expect(t.points[i - 1].age).toBeGreaterThanOrEqual(t.points[i].age);
  });
});
