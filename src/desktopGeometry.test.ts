import { describe, expect, it } from "vitest";
import { MAX_PHYSICAL, MIN_LOGICAL, nextPosition, nextSize } from "./desktopGeometry";

describe("desktop widget geometry", () => {
  it("allows any shape: wide, tall, square, far larger than the old 1600x1200 cap", () => {
    expect(nextSize({ w: 300, h: 200 }, 4000, 0, 1)).toEqual({ w: 4300, h: 200 });
    expect(nextSize({ w: 300, h: 200 }, 0, 3000, 1)).toEqual({ w: 300, h: 3200 });
    expect(nextSize({ w: 300, h: 200 }, -100, 100, 1)).toEqual({ w: 200, h: 300 });
  });

  it("keeps width and height independent (no aspect ratio)", () => {
    const a = nextSize({ w: 400, h: 400 }, 100, 0, 1);
    expect(a).toEqual({ w: 500, h: 400 });
  });

  it("only stops at the technical minimum, scaled for DPI", () => {
    expect(nextSize({ w: 300, h: 200 }, -9999, -9999, 1)).toEqual({ w: MIN_LOGICAL, h: MIN_LOGICAL });
    expect(nextSize({ w: 300, h: 200 }, -9999, -9999, 1.5)).toEqual({ w: Math.ceil(MIN_LOGICAL * 1.5), h: Math.ceil(MIN_LOGICAL * 1.5) });
  });

  it("stops at the rendering-surface limit", () => {
    expect(nextSize({ w: 300, h: 200 }, 99999, 99999, 1)).toEqual({ w: MAX_PHYSICAL, h: MAX_PHYSICAL });
  });

  it("converts pointer movement to physical pixels and never clamps position", () => {
    expect(nextPosition({ x: 100, y: 100 }, 10, -20, 1.5)).toEqual({ x: 115, y: 70 });
    expect(nextPosition({ x: 0, y: 0 }, -5000, -5000, 1)).toEqual({ x: -5000, y: -5000 });
  });
});
