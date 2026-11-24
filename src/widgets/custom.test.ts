import { describe, expect, it } from "vitest";
import { customToManifest, newHudId, sanitizeCustomList, sanitizeParts } from "./custom";
import { isWidgetId } from "./manifest";

describe("custom HUDs", () => {
  it("makes valid, bounded ids", () => {
    for (const n of ["My HUD!", "???", "x".repeat(80), "  "]) {
      const id = newHudId(n);
      expect(isWidgetId(id)).toBe(true);
      expect(id.startsWith("hud-")).toBe(true);
    }
  });

  it("filters bad parts and entries", () => {
    expect(sanitizeParts([{ type: "clock" }, { type: "evil" }, null, { type: "text", text: "x".repeat(99) }])).toEqual([
      { type: "clock" },
      { type: "text", text: "x".repeat(40) },
    ]);
    const list = sanitizeCustomList([
      { id: "hud-ok-12345", name: "Good", cols: 2, height: 9999, parts: [{ type: "cpu" }] },
      { id: "clock", name: "Hijack", parts: [] },
      { id: "hud-noname-1", name: "  ", parts: [] },
      "nope",
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "hud-ok-12345", cols: 2, height: 400 });
  });

  it("builds a manifest that points at the shared template", () => {
    const m = customToManifest({ id: "hud-a-1", name: "A", cols: 1, height: 150, parts: [] });
    expect(m.dir).toBe("custom-hud");
    expect(m.permissions).toContain("storage");
  });
});
