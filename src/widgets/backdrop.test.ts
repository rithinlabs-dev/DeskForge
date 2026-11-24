import { describe, expect, it } from "vitest";
import { backdropLayout, type BackdropGeometry } from "./backdrop";

const base: BackdropGeometry = { winX: 100, winY: 50, winW: 300, winH: 200, monX: 0, monY: 0, monW: 1920, monH: 1080, scale: 1 };

describe("frosted wallpaper layout", () => {
  it("aligns a wallpaper that exactly fits the monitor", () => {
    // pad is 56 for the default 28 px blur; the window's top-left is (100, 50) on the screen
    expect(backdropLayout(base, 1920, 1080)).toEqual({ pad: 56, size: "1920px 1080px", position: "-44px 6px" });
  });

  it("with no blur there is no padding", () => {
    expect(backdropLayout(base, 1920, 1080, 0)).toEqual({ pad: 0, size: "1920px 1080px", position: "-100px -50px" });
  });

  it("crops a wider picture equally on both sides", () => {
    const layout = backdropLayout({ ...base, winX: 0, winY: 0 }, 2560, 1080);
    expect(layout).toEqual({ pad: 56, size: "2560px 1080px", position: "-264px 56px" });
  });

  it("scales a tall picture up to cover the monitor and centres it", () => {
    const layout = backdropLayout({ ...base, winX: 0, winY: 0 }, 1000, 2000);
    expect(layout).toEqual({ pad: 56, size: "1920px 3840px", position: "56px -1324px" });
  });

  it("converts physical pixels to CSS pixels on a scaled display", () => {
    const hidpi: BackdropGeometry = { winX: 300, winY: 150, winW: 450, winH: 300, monX: 0, monY: 0, monW: 2880, monH: 1620, scale: 1.5 };
    expect(backdropLayout(hidpi, 1920, 1080)).toEqual({ pad: 56, size: "1920px 1080px", position: "-144px -44px" });
  });

  it("measures from the monitor the widget is on, not from the screen origin", () => {
    const second: BackdropGeometry = { ...base, monX: 1920, winX: 2020 };
    expect(backdropLayout(second, 1920, 1080)).toEqual(backdropLayout(base, 1920, 1080));
    const above: BackdropGeometry = { ...base, monX: -1920, winX: -1820 };
    expect(backdropLayout(above, 1920, 1080)).toEqual(backdropLayout(base, 1920, 1080));
  });

  it("refuses unusable numbers", () => {
    expect(backdropLayout(base, 0, 1080)).toBeNull();
    expect(backdropLayout(base, 1920, Number.NaN)).toBeNull();
    expect(backdropLayout({ ...base, scale: 0 }, 1920, 1080)).toBeNull();
    expect(backdropLayout({ ...base, winW: 0 }, 1920, 1080)).toBeNull();
    expect(backdropLayout({ ...base, winX: Number.NaN }, 1920, 1080)).toBeNull();
  });
});
