import { describe, expect, it } from "vitest";
import { FONT_STACKS } from "../shared/tokens";
import {
  DEFAULT_APPEARANCE, DEFAULT_CONTENT, DEFAULT_ISLAND, anchorParts, dragOffsets, islandSizes, moveItem, sanitizeAppearance, sanitizeBehavior,
  sanitizeContent, sanitizeIslandConfig, sanitizePosition, type PillModule,
} from "./config";
import { collapsedView, formatClock, fraction, mmss, playbackPosition, trackLabel } from "./format";
import { BUILTIN_PRESETS, MAX_PRESETS, applyPreset, makePreset, matchesPreset, parsePreset, sanitizePresetList, savePreset, serializePreset } from "./presets";
import { backgroundFill, hexToRgb, islandCssVars, readableOn, rgba, shadowCss } from "./style";

describe("timer text", () => {
  it("shows minutes and seconds, rounding up so it never says 00:00 early", () => {
    expect(mmss(25 * 60_000)).toBe("25:00");
    expect(mmss(4 * 60_000 + 59_000)).toBe("04:59");
    expect(mmss(1)).toBe("00:01");
    expect(mmss(1000)).toBe("00:01");
    expect(mmss(1001)).toBe("00:02");
    expect(mmss(0)).toBe("00:00");
    expect(mmss(-500)).toBe("00:00");
    expect(mmss(100 * 60_000)).toBe("100:00");
  });
});

describe("music position", () => {
  const playing = { status: "playing", positionMs: 10_000, durationMs: 200_000, updatedMs: 1_000_000 };

  it("keeps counting while playing, but not while paused", () => {
    expect(playbackPosition(playing, 1_005_000)).toBe(15_000);
    expect(playbackPosition({ ...playing, status: "paused" }, 1_005_000)).toBe(10_000);
  });

  it("never goes past the end or below zero, and ignores a clock that ran backwards", () => {
    expect(playbackPosition(playing, 1_000_000 + 9_999_999)).toBe(200_000);
    expect(playbackPosition(playing, 999_000)).toBe(10_000);
    expect(playbackPosition({ ...playing, positionMs: -5, status: "paused" }, 1_000_000)).toBe(0);
    expect(playbackPosition({ ...playing, durationMs: 0 }, 1_005_000)).toBe(15_000); // length unknown: no ceiling
  });

  it("turns a position into a 0..1 fraction", () => {
    expect(fraction(50, 200)).toBe(0.25);
    expect(fraction(500, 200)).toBe(1);
    expect(fraction(-1, 200)).toBe(0);
    expect(fraction(10, 0)).toBe(0);
  });

  it("labels a track from whatever is known", () => {
    expect(trackLabel("Song", "Artist")).toBe("Song \u2014 Artist");
    expect(trackLabel("Song", "")).toBe("Song");
    expect(trackLabel("", "Artist")).toBe("Artist");
    expect(trackLabel("", "")).toBe("");
  });
});

describe("what the collapsed pill shows", () => {
  const base = { pill: ["focus", "music", "clock"] as PillModule[], pomodoro: "idle" as const, musicStatus: "playing", hasTrack: true };

  it("takes the first module in your list that applies", () => {
    expect(collapsedView({ ...base, pomodoro: "running" })).toBe("focus");
    expect(collapsedView({ ...base, pomodoro: "paused" })).toBe("focus");
    expect(collapsedView(base)).toBe("music");
    expect(collapsedView({ ...base, musicStatus: "paused" })).toBe("clock");
    expect(collapsedView({ ...base, hasTrack: false })).toBe("clock");
  });

  it("follows the order you chose", () => {
    expect(collapsedView({ ...base, pill: ["music", "focus", "clock"], pomodoro: "running" })).toBe("music");
    expect(collapsedView({ ...base, pill: ["clock", "focus"], pomodoro: "running" })).toBe("clock");
    expect(collapsedView({ ...base, pill: ["system"] })).toBe("system");
  });

  it("falls back to the clock when nothing in the list applies", () => {
    expect(collapsedView({ ...base, pill: ["focus"] })).toBe("clock");
    expect(collapsedView({ ...base, pill: [] })).toBe("clock");
  });
});

describe("clock text", () => {
  const at = new Date(2026, 10, 19, 14, 5, 9).getTime(); // 19 Nov 2026, 14:05:09 local time

  it("follows the 12 or 24 hour choice", () => {
    expect(formatClock(at, { hour12: "24", seconds: false, date: false }, "en-US")).toBe("14:05");
    expect(formatClock(at, { hour12: "12", seconds: false, date: false }, "en-US")).toMatch(/^2:05\s?PM$/);
    expect(formatClock(at, { hour12: "auto", seconds: false, date: false }, "en-US")).toMatch(/^2:05\s?PM$/);
  });

  it("can show seconds and the date", () => {
    expect(formatClock(at, { hour12: "24", seconds: true, date: false }, "en-US")).toBe("14:05:09");
    const withDate = formatClock(at, { hour12: "24", seconds: false, date: true }, "en-US");
    expect(withDate).toContain("Nov");
    expect(withDate).toContain("14:05");
    expect(withDate).toContain("\u00b7");
  });

  it("shows 00:xx at midnight in 24 hour mode, not 24:xx", () => {
    const midnight = new Date(2026, 10, 19, 0, 7, 0).getTime();
    expect(formatClock(midnight, { hour12: "24", seconds: false, date: false }, "en-US")).toBe("00:07");
  });
});

describe("island settings", () => {
  it("an empty record gives the defaults", () => {
    expect(sanitizeIslandConfig(undefined)).toEqual(DEFAULT_ISLAND);
    expect(sanitizeIslandConfig(null)).toEqual(DEFAULT_ISLAND);
    expect(sanitizeIslandConfig("junk")).toEqual(DEFAULT_ISLAND);
    expect(sanitizeIslandConfig([])).toEqual(DEFAULT_ISLAND);
  });

  it("keeps a full valid record as it is", () => {
    const custom = sanitizeIslandConfig({
      autostart: true, pauseOnFullscreen: false,
      position: { anchor: "bottom-right", x: 30, y: 40, monitor: 1, locked: false },
      appearance: { ...DEFAULT_APPEARANCE, scale: 1.2, accent: "#ff3df2", bg2: "#112233", font: "mono", animation: "snappy" },
      content: { ...DEFAULT_CONTENT, pill: ["clock"], tabs: ["focus", "music"], defaultTab: "focus" },
      behavior: { hoverExpand: false, expandDelay: 0, collapseDelay: 2000, peek: false, peekMs: 8000 },
    });
    expect(sanitizeIslandConfig(custom)).toEqual(custom);
    expect(custom.position.anchor).toBe("bottom-right");
    expect(custom.content.defaultTab).toBe("focus");
  });

  it("ignores values of the wrong type", () => {
    const c = sanitizeIslandConfig({ autostart: "yes", pauseOnFullscreen: 0, position: "left", appearance: 5, content: [], behavior: "fast" });
    expect(c).toEqual(DEFAULT_ISLAND);
  });

  it("upgrades a record from before customisation existed", () => {
    const old = sanitizeIslandConfig({ autostart: true, pauseOnFullscreen: false, hoverExpand: false, peek: false, collapsed: "clock" });
    expect(old).toMatchObject({ autostart: true, pauseOnFullscreen: false });
    expect(old.behavior).toMatchObject({ hoverExpand: false, peek: false });
    expect(old.content.pill).toEqual(["clock"]);
    expect(sanitizeIslandConfig({ collapsed: "auto" }).content.pill).toEqual(DEFAULT_CONTENT.pill);
    // a new-style pill list wins over the old setting
    expect(sanitizeIslandConfig({ collapsed: "clock", content: { pill: ["music", "clock"] } }).content.pill).toEqual(["music", "clock"]);
  });
});

describe("island position", () => {
  it("clamps and falls back", () => {
    expect(sanitizePosition(undefined)).toEqual({ anchor: "top-center", x: 0, y: 8, monitor: 0, locked: true });
    expect(sanitizePosition({ anchor: "sideways", x: 99999, y: -99999, monitor: 99, locked: "no" })).toEqual({ anchor: "top-center", x: 2000, y: -2000, monitor: 16, locked: true });
    expect(sanitizePosition({ anchor: "bottom-left", x: 12.6, y: 4.4 })).toMatchObject({ anchor: "bottom-left", x: 13, y: 4 });
  });

  it("names the edges of an anchor", () => {
    expect(anchorParts("bottom-right")).toEqual({ v: "bottom", h: "right" });
    expect(anchorParts("middle-left")).toEqual({ v: "middle", h: "left" });
    expect(anchorParts("top-center")).toEqual({ v: "top", h: "center" });
  });

  it("dragging moves the island with the pointer whichever edge it hangs from", () => {
    expect(dragOffsets("top-center", { x: 0, y: 8 }, 30, 10)).toEqual({ x: 30, y: 18 });
    expect(dragOffsets("top-left", { x: 10, y: 10 }, 5, 5)).toEqual({ x: 15, y: 15 });
    expect(dragOffsets("top-right", { x: 10, y: 10 }, -20, 0)).toEqual({ x: 30, y: 10 }); // moving left = farther from the right edge
    expect(dragOffsets("bottom-right", { x: 10, y: 20 }, 5, 5)).toEqual({ x: 5, y: 15 });
    expect(dragOffsets("bottom-left", { x: 10, y: 20 }, 5, -5)).toEqual({ x: 15, y: 25 }); // moving up = farther from the bottom
    expect(dragOffsets("top-left", { x: 0, y: 0 }, 99999, -99999)).toEqual({ x: 2000, y: -2000 });
  });

  it("sizes the window from the pill and panel widths and the scale", () => {
    expect(islandSizes(DEFAULT_APPEARANCE)).toEqual({ collapsed: { width: 320, height: 56 }, open: { width: 440, height: 268 } });
    expect(islandSizes({ ...DEFAULT_APPEARANCE, scale: 2 })).toEqual({ collapsed: { width: 640, height: 112 }, open: { width: 880, height: 536 } });
    expect(islandSizes({ ...DEFAULT_APPEARANCE, scale: 0.8 })).toEqual({ collapsed: { width: 256, height: 45 }, open: { width: 352, height: 214 } });
    expect(islandSizes({ ...DEFAULT_APPEARANCE, pillWidth: 200, panelWidth: 500 }).collapsed.width).toBe(220);
  });
});

describe("island appearance", () => {
  it("clamps numbers and rejects bad colours and names", () => {
    const a = sanitizeAppearance({ scale: 9, pillWidth: 1, panelWidth: 9999, opacity: 5, radius: -3, bg: "red", accent: "#ABCDEF", font: "comic", animation: "wobble", idleDim: 0 });
    expect(a).toMatchObject({ scale: 1.8, pillWidth: 160, panelWidth: 640, opacity: 20, radius: 0, bg: DEFAULT_APPEARANCE.bg, accent: "#abcdef", font: "theme", animation: "smooth", idleDim: 20 });
  });

  it("rounds the scale to two decimals and keeps a valid second colour", () => {
    expect(sanitizeAppearance({ scale: 1.234 }).scale).toBe(1.23);
    expect(sanitizeAppearance({ bg2: "#112233" }).bg2).toBe("#112233");
    expect(sanitizeAppearance({ bg2: "url(x)" }).bg2).toBeNull();
    expect(sanitizeAppearance({ accent: "blue" }).accent).toBeNull();
  });

  it("accepts every font of the app theme", () => {
    for (const font of Object.keys(FONT_STACKS)) expect(sanitizeAppearance({ font }).font).toBe(font);
    expect(sanitizeAppearance({ font: "theme" }).font).toBe("theme");
  });
});

describe("island content", () => {
  it("keeps tabs in your order, without duplicates or unknown names", () => {
    expect(sanitizeContent({ tabs: ["tools", "music", "tools", "nope"] }).tabs).toEqual(["tools", "music"]);
    expect(sanitizeContent({ tabs: [] }).tabs).toEqual(DEFAULT_CONTENT.tabs);
    expect(sanitizeContent({ tabs: "music" }).tabs).toEqual(DEFAULT_CONTENT.tabs);
  });

  it("the default tab must be one that is shown", () => {
    expect(sanitizeContent({ tabs: ["focus", "tools"], defaultTab: "music" }).defaultTab).toBe("focus");
    expect(sanitizeContent({ tabs: ["focus", "tools"], defaultTab: "tools" }).defaultTab).toBe("tools");
  });

  it("keeps the pill list in order and never lets it be empty", () => {
    expect(sanitizeContent({ pill: ["clock", "music", "clock", "x"] }).pill).toEqual(["clock", "music"]);
    expect(sanitizeContent({ pill: [] }).pill).toEqual(DEFAULT_CONTENT.pill);
  });

  it("clamps the launcher count and reads the switches", () => {
    expect(sanitizeContent({ tools: { launcherCount: 99 } }).tools.launcherCount).toBe(12);
    expect(sanitizeContent({ tools: { launcherCount: -2 } }).tools.launcherCount).toBe(0);
    expect(sanitizeContent({ music: { art: false, volume: "no" } }).music).toEqual({ art: false, progress: true, volume: true, app: true });
    expect(sanitizeContent({ clock: { hour12: "24", seconds: true, date: true } }).clock).toEqual({ hour12: "24", seconds: true, date: true });
    expect(sanitizeContent({ clock: { hour12: "soon" } }).clock.hour12).toBe("auto");
  });

  it("limits the delays", () => {
    expect(sanitizeBehavior({ expandDelay: 99999, collapseDelay: 1, peekMs: 1 })).toMatchObject({ expandDelay: 1500, collapseDelay: 100, peekMs: 1000 });
  });
});

describe("reordering lists", () => {
  it("moves an entry up or down and ignores impossible moves", () => {
    expect(moveItem(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"]);
    expect(moveItem(["a", "b", "c"], 9, 1)).toEqual(["a", "b", "c"]);
    const original = ["a", "b"];
    expect(moveItem(original, 0, 1)).not.toBe(original);
  });
});

describe("island styling", () => {
  it("converts colours", () => {
    expect(hexToRgb("#0a0c0f")).toEqual([10, 12, 15]);
    expect(hexToRgb("nope")).toEqual([0, 0, 0]);
    expect(rgba("#0a0c0f", 85)).toBe("rgba(10, 12, 15, 0.85)");
    expect(rgba("#0a0c0f", 100)).toBe("rgba(10, 12, 15, 1)");
    expect(rgba("#0a0c0f", 500)).toBe("rgba(10, 12, 15, 1)");
    expect(readableOn("#ffffff")).toBe("#0b0f14");
    expect(readableOn("#000000")).toBe("#ffffff");
  });

  it("builds a solid or gradient background with the chosen opacity", () => {
    expect(backgroundFill(DEFAULT_APPEARANCE)).toBe("rgba(10, 12, 15, 1)");
    expect(backgroundFill({ ...DEFAULT_APPEARANCE, bg2: "#1a2650", bgAngle: 135, opacity: 90 })).toBe("linear-gradient(135deg, rgba(10, 12, 15, 0.9), rgba(26, 38, 80, 0.9))");
  });

  it("scales the shadow from none to deep", () => {
    expect(shadowCss(0)).toBe("none");
    expect(shadowCss(50)).toBe("0 6px 24px rgba(0, 0, 0, 0.45)");
    expect(shadowCss(100)).toBe("0 12px 48px rgba(0, 0, 0, 0.90)");
  });

  it("follows the app theme unless you choose your own accent and font", () => {
    const theme = islandCssVars(DEFAULT_APPEARANCE);
    expect(theme["--isl-accent"]).toBe("var(--accent, #4aa3ff)");
    expect(theme["--isl-on-accent"]).toBe("var(--on-accent, #ffffff)");
    expect(theme["--isl-font"]).toContain("var(--font");
    expect(theme).toMatchObject({ "--isl-scale": "1", "--isl-pill-w": "300px", "--isl-panel-w": "420px", "--isl-fg": "#f2f5f7", "--isl-radius": "22px", "--isl-border-w": "1px", "--isl-anim": "240ms", "--isl-idle": "1", "--isl-border-c": "rgba(255, 255, 255, 0.1)" });
    const custom = islandCssVars({ ...DEFAULT_APPEARANCE, accent: "#ff3df2", font: "mono", animation: "none", idleDim: 60 });
    expect(custom).toMatchObject({ "--isl-accent": "#ff3df2", "--isl-on-accent": "#ffffff", "--isl-font": FONT_STACKS.mono, "--isl-anim": "0ms", "--isl-idle": "0.6" });
  });
});

describe("island presets", () => {
  it("ships presets with unique names, all of them valid", () => {
    const names = BUILTIN_PRESETS.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const p of BUILTIN_PRESETS) {
      expect(sanitizeAppearance(p.appearance)).toEqual(p.appearance);
      expect(sanitizeContent(p.content)).toEqual(p.content);
    }
    expect(BUILTIN_PRESETS[0].appearance).toEqual(DEFAULT_APPEARANCE);
    expect(BUILTIN_PRESETS[0].content).toEqual(DEFAULT_CONTENT);
  });

  it("applying a preset changes the look but never the position, behaviour or autostart", () => {
    const mine = sanitizeIslandConfig({ autostart: true, position: { anchor: "bottom-left", x: 5, y: 6, monitor: 1, locked: false }, behavior: { peek: false } });
    const neon = BUILTIN_PRESETS.find((p) => p.name === "Neon")!;
    const next = applyPreset(mine, neon);
    expect(next.appearance).toEqual(neon.appearance);
    expect(next.position).toEqual(mine.position);
    expect(next.behavior).toEqual(mine.behavior);
    expect(next.autostart).toBe(true);
    expect(matchesPreset(next, neon)).toBe(true);
    expect(matchesPreset(DEFAULT_ISLAND, neon)).toBe(false);
    expect(matchesPreset(DEFAULT_ISLAND, BUILTIN_PRESETS[0])).toBe(true);
  });

  it("saves under a clean name, replacing one with the same name", () => {
    expect(makePreset("  my   look  ", DEFAULT_ISLAND).name).toBe("my look");
    expect(makePreset("   ", DEFAULT_ISLAND).name).toBe("My island");
    expect(makePreset("x".repeat(100), DEFAULT_ISLAND).name).toHaveLength(40);
    const a = makePreset("Mine", DEFAULT_ISLAND);
    const b = { ...makePreset("MINE", DEFAULT_ISLAND), appearance: { ...DEFAULT_APPEARANCE, scale: 1.5 } };
    const list = savePreset(savePreset([], a), b);
    expect(list).toHaveLength(1);
    expect(list[0].appearance.scale).toBe(1.5);
  });

  it("keeps at most 20 saved presets, newest first", () => {
    let list: ReturnType<typeof savePreset> = [];
    for (let i = 0; i < 30; i++) list = savePreset(list, makePreset(`look ${i}`, DEFAULT_ISLAND));
    expect(list).toHaveLength(MAX_PRESETS);
    expect(list[0].name).toBe("look 29");
  });

  it("reads a saved list defensively", () => {
    const out = sanitizePresetList([
      { name: "One", appearance: { scale: 99 } },
      { name: "one" }, // same name, ignoring case
      { name: "" },
      null,
      "text",
      { name: "Two", content: { tabs: ["tools"] } },
    ]);
    expect(out.map((p) => p.name)).toEqual(["One", "Two"]);
    expect(out[0].appearance.scale).toBe(1.8);
    expect(out[1].content.tabs).toEqual(["tools"]);
    expect(sanitizePresetList("nope")).toEqual([]);
  });

  it("round-trips through the copy/paste text", () => {
    const original = makePreset("Shared", { ...DEFAULT_ISLAND, appearance: { ...DEFAULT_APPEARANCE, accent: "#ff3df2", radius: 30 } });
    const parsed = parsePreset(serializePreset(original));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.preset).toEqual(original);
  });

  it("refuses text that isn't a preset, and says why", () => {
    for (const bad of ["", "   ", "{", "[]", "{\"a\":1}", "null", "x".repeat(20_000)]) {
      const r = parsePreset(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });

  it("cleans hostile values in a pasted preset", () => {
    const text = JSON.stringify({ format: "deskforge-island-preset", appearance: { bg: "url(javascript:alert(1))", scale: 99, font: "x; evil" } });
    const r = parsePreset(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.preset.name).toBe("Imported");
      expect(r.preset.appearance.bg).toBe(DEFAULT_APPEARANCE.bg);
      expect(r.preset.appearance.scale).toBe(1.8);
      expect(r.preset.appearance.font).toBe("theme");
    }
  });
});
