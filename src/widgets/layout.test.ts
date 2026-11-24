import { describe, expect, it } from "vitest";
import { sanitizeElementLayout, sanitizeWidgetElements, sanitizeWidgetLayout, sanitizeWidgetLayoutMap } from "./layout";

describe("widget layout", () => {
  it("bounds layout values and ignores invalid element settings", () => {
    expect(sanitizeElementLayout({ x: -140, y: 120, order: 120, scale: 9, opacity: -1, fontSize: 200, color: "red", align: "center" }))
      .toEqual({ x: -100, y: 100, order: 100, scale: 3, opacity: 0, fontSize: 96, align: "center" });
    expect(sanitizeWidgetLayout({ "date": { x: 4 }, "__proto__": { x: 1 }, "bad id": { y: 2 } }))
      .toMatchObject({ date: { x: 4, y: 0, order: 0, scale: 1, opacity: 100 } });
  });

  it("keeps layouts per valid widget and sanitizes reported elements", () => {
    expect(sanitizeWidgetLayoutMap({ clock: { time: { x: 12 } }, "Bad Id": { time: { x: 30 } } }))
      .toMatchObject({ clock: { time: { x: 12 } } });
    expect(sanitizeWidgetElements([
      { id: "time", label: " Time ", kind: "text", x: 12, y: 8, width: 60, height: 20, fontSize: 24, color: "#AABBCC", align: "right" },
      { id: "time", label: "duplicate", kind: "visual" },
      { id: "__proto__", label: "invalid", kind: "text" },
    ])).toEqual([{
      id: "time", label: "Time", kind: "text", x: 12, y: 8, width: 60, height: 20, fontSize: 24, color: "#aabbcc", align: "right",
    }]);
  });
});
