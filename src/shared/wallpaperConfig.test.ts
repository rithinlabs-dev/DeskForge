import { describe, expect, it } from "vitest";
import { DEFAULT_WALLPAPER, formatBytes, parseResolution, sanitizeWallpaperConfig } from "./wallpaperConfig";

describe("wallpaper config", () => {
  it("falls back to safe defaults (muted, looping, no autostart)", () => {
    expect(sanitizeWallpaperConfig(null)).toEqual(DEFAULT_WALLPAPER);
    expect(DEFAULT_WALLPAPER).toMatchObject({ muted: true, volume: 0, loop: true, autostart: false });
  });

  it("rejects bad values field by field", () => {
    const c = sanitizeWallpaperConfig({ volume: 9999, fit: "stretch", mode: "kernel", loop: "yes", autostart: true });
    expect(c.volume).toBe(100);
    expect(c.fit).toBe("cover");
    expect(c.mode).toBe("auto");
    expect(c.loop).toBe(true);
    expect(c.autostart).toBe(true);
    expect(sanitizeWallpaperConfig({ volume: -5 }).volume).toBe(0);
  });

  it("parses only sane resolutions", () => {
    expect(parseResolution("1920x1080")).toEqual({ width: 1920, height: 1080 });
    expect(parseResolution("9999x9999")).toBeNull();
    expect(parseResolution("1920x1080; rm")).toBeNull();
    expect(parseResolution("12x12")).toBeNull();
  });

  it("formats sizes", () => {
    expect(formatBytes(512 * 1024)).toBe("512 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
  });
});
