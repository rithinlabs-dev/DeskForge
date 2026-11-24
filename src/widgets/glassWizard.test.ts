import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, GLASS_KINDS, sanitizeAppearance } from "./appearance";
import {
  diagnosticLine, fallbackDiagnostics, newTrials, recommend, trialPlan, trialText,
  type GlassDiagnostics, type Trial,
} from "./glassWizard";

const win11: GlassDiagnostics = {
  build: 22631,
  windows: "Windows 11 (build 22631)",
  nativeBlurApi: true,
  methods: [
    { kind: "acrylic", label: "Acrylic (frosted)", supported: true, tintControl: true, note: "" },
    { kind: "blur", label: "Plain blur", supported: true, tintControl: true, note: "" },
    { kind: "backdrop", label: "Windows 11 backdrop", supported: true, tintControl: false, note: "" },
    { kind: "mica", label: "Mica", supported: true, tintControl: false, note: "" },
    { kind: "wallpaper", label: "Frosted wallpaper", supported: true, tintControl: true, note: "" },
    { kind: "sheen", label: "Translucent sheen", supported: true, tintControl: true, note: "" },
  ],
};
const win10: GlassDiagnostics = {
  ...win11,
  build: 19045,
  windows: "Windows 10 (build 19045)",
  methods: win11.methods.map((m) => (m.kind === "backdrop" || m.kind === "mica" ? { ...m, supported: false } : m)),
};

const accepted = (kind: Trial["kind"]): Trial => ({ kind, status: "accepted", effect: kind === "sheen" || kind === "wallpaper" ? "off" : kind, error: null });
const rejected = (kind: Trial["kind"]): Trial => ({ kind, status: "rejected", effect: null, error: "nope" });

describe("glass wizard plan", () => {
  it("tests only the supported native methods and never the DeskForge-drawn looks", () => {
    expect(trialPlan(win11)).toEqual(["acrylic", "blur", "backdrop", "mica"]);
    expect(trialPlan(win10)).toEqual(["acrylic", "blur"]);
    expect(trialPlan(fallbackDiagnostics())).toEqual(["acrylic", "blur", "backdrop", "mica"]);
  });

  it("starts every trial as pending", () => {
    const trials = newTrials(["acrylic", "mica"]);
    expect(trials.map((t) => t.status)).toEqual(["pending", "pending"]);
    expect(trials.every((t) => t.effect === null && t.error === null)).toBe(true);
  });

  it("describes the PC in one line", () => {
    const line = diagnosticLine(win10);
    expect(line).toContain("Windows 10 (build 19045)");
    expect(line).toContain("Acrylic (frosted)");
    expect(line).not.toContain("Mica");
    expect(diagnosticLine({ ...win10, nativeBlurApi: false, methods: [win10.methods[4]] })).toContain("none");
  });
});

describe("glass wizard recommendation", () => {
  it("prefers an accepted method that honours the tint sliders", () => {
    expect(recommend([rejected("acrylic"), accepted("blur"), accepted("backdrop")], win11)).toBe("blur");
    expect(recommend([accepted("backdrop"), accepted("acrylic")], win11)).toBe("acrylic");
  });

  it("takes any accepted method when none honours the tint", () => {
    expect(recommend([rejected("acrylic"), rejected("blur"), accepted("mica")], win11)).toBe("mica");
  });

  it("falls back to the frosted wallpaper when nothing was accepted", () => {
    expect(recommend([rejected("acrylic"), rejected("blur")], win10)).toBe("wallpaper");
    expect(recommend([], null)).toBe("wallpaper");
  });

  it("explains each trial status", () => {
    expect(trialText({ kind: "acrylic", status: "pending", effect: null, error: null })).toBe("waiting");
    expect(trialText({ kind: "acrylic", status: "trying", effect: null, error: null })).toContain("look");
    expect(trialText(accepted("acrylic"))).toBe("accepted by Windows");
    expect(trialText({ kind: "acrylic", status: "accepted", effect: "blur", error: null })).toBe("accepted by Windows (as blur)");
    expect(trialText(rejected("mica"))).toBe("rejected: nope");
  });
});

describe("glass kinds in a widget look", () => {
  it("accepts every kind the wizard can choose", () => {
    for (const kind of GLASS_KINDS) {
      expect(sanitizeAppearance({ glassKind: kind }).glassKind).toBe(kind);
    }
  });

  it("still falls back to the default for anything else", () => {
    expect(sanitizeAppearance({ glassKind: "weird" }).glassKind).toBe(DEFAULT_APPEARANCE.glassKind);
    expect(sanitizeAppearance({ glassKind: 4 }).glassKind).toBe(DEFAULT_APPEARANCE.glassKind);
    expect(sanitizeAppearance({ kind: "mica" }).glassKind).toBe("mica");
  });
});
