import { describe, expect, it } from "vitest";
import { DEFAULT_SECTION, SECTIONS, greeting, groupedSections, hashFor, isSectionId, parseHash, sectionById, sectionForShortcut, shortcutFor } from "./nav";

describe("app sections", () => {
  it("has unique ids and a heading, blurb and icon for each", () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SECTIONS) {
      expect(s.label.length).toBeGreaterThan(1);
      expect(s.title.length).toBeGreaterThan(1);
      expect(s.blurb.length).toBeGreaterThan(5);
    }
    expect(isSectionId(DEFAULT_SECTION)).toBe(true);
  });

  it("groups every section exactly once, in sidebar order", () => {
    const groups = groupedSections();
    expect(groups.map((g) => g.group)).toEqual(["Home", "Personalise", "Device"]);
    const flat = groups.flatMap((g) => g.items.map((s) => s.id));
    expect(flat).toHaveLength(SECTIONS.length);
    expect(new Set(flat).size).toBe(SECTIONS.length);
    expect(groups[0].items[0].id).toBe("overview");
  });

  it("looks sections up by id, and recognises only real ones", () => {
    expect(sectionById("widgets").label).toBe("Widgets");
    expect(isSectionId("widgets")).toBe(true);
    expect(isSectionId("nope")).toBe(false);
    expect(isSectionId(3)).toBe(false);
    expect(isSectionId(null)).toBe(false);
  });
});

describe("addresses", () => {
  it("turns every section into an address and back", () => {
    for (const s of SECTIONS) expect(parseHash(hashFor(s.id))).toBe(s.id);
    expect(hashFor("island")).toBe("#/island");
  });

  it("reads the usual ways of writing one", () => {
    expect(parseHash("#/widgets")).toBe("widgets");
    expect(parseHash("#widgets")).toBe("widgets");
    expect(parseHash("#/Widgets")).toBe("widgets");
    expect(parseHash("#/widgets?tab=1")).toBe("widgets");
    expect(parseHash("#/widgets/extra")).toBe("widgets");
  });

  it("ignores anything else", () => {
    for (const bad of ["", "#", "#/", "#/nowhere", "widgets", "#/%20", "#/constructor", "#/__proto__"]) expect(parseHash(bad)).toBeNull();
  });
});

describe("keyboard shortcuts", () => {
  it("Ctrl+1.. jumps to the section in that position", () => {
    expect(sectionForShortcut("1")).toBe(SECTIONS[0].id);
    expect(sectionForShortcut("2")).toBe(SECTIONS[1].id);
    expect(sectionForShortcut(String(SECTIONS.length))).toBe(SECTIONS[SECTIONS.length - 1].id);
  });

  it("ignores keys that don't map to a section", () => {
    expect(sectionForShortcut("0")).toBeNull();
    expect(sectionForShortcut("9")).toBeNull(); // more than the number of sections
    expect(sectionForShortcut("a")).toBeNull();
    expect(sectionForShortcut("12")).toBeNull();
    expect(sectionForShortcut("")).toBeNull();
  });

  it("tells each section its own key", () => {
    expect(shortcutFor("overview")).toBe("1");
    for (const s of SECTIONS) expect(sectionForShortcut(shortcutFor(s.id))).toBe(s.id);
  });
});

describe("greeting", () => {
  it("follows the time of day", () => {
    expect(greeting(5)).toBe("Good morning");
    expect(greeting(11)).toBe("Good morning");
    expect(greeting(12)).toBe("Good afternoon");
    expect(greeting(16)).toBe("Good afternoon");
    expect(greeting(17)).toBe("Good evening");
    expect(greeting(21)).toBe("Good evening");
    expect(greeting(22)).toBe("Good night");
    expect(greeting(0)).toBe("Good night");
    expect(greeting(4)).toBe("Good night");
  });
});
