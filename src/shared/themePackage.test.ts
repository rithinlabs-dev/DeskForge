import { describe, expect, it } from "vitest";
import {
  MAX_PACKAGE_BYTES,
  PACKAGE_VERSION,
  createPackage,
  packageFileName,
  parsePackage,
  serializePackage,
} from "./themePackage";
import { DEFAULT_TOKENS } from "./tokens";

const roundtrip = (o: unknown) => parsePackage(JSON.stringify(o));

describe("theme package", () => {
  it("round-trips a package", () => {
    const pkg = createPackage("Midnight", { ...DEFAULT_TOKENS, accent: "#ff0000" }, { author: "Sam" });
    const res = parsePackage(serializePackage(pkg));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pkg.tokens.accent).toBe("#ff0000");
      expect(res.pkg.meta.author).toBe("Sam");
      expect(res.warnings).toEqual([]);
    }
  });

  it("rejects bad input with readable errors", () => {
    expect(parsePackage("nope").ok).toBe(false);
    expect(roundtrip({ hello: 1 }).ok).toBe(false);
    expect(roundtrip({ format: "deskforge-theme", version: 1, meta: {}, tokens: {} }).ok).toBe(false);
    expect(roundtrip({ format: "deskforge-theme", version: 1, meta: { name: "x" } }).ok).toBe(false);
    expect(parsePackage("x".repeat(MAX_PACKAGE_BYTES + 1)).ok).toBe(false);
  });

  it("rejects files from a newer version", () => {
    const res = roundtrip({ format: "deskforge-theme", version: PACKAGE_VERSION + 1, meta: { name: "x" }, tokens: {} });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("newer");
  });

  it("sanitizes hostile values and reports them", () => {
    const res = roundtrip({
      format: "deskforge-theme",
      version: 1,
      meta: { name: "Evil" },
      tokens: { accent: "red; background:url(http://x)", radius: 9999, font: "toString", extra: 1 },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pkg.tokens.accent).toBe(DEFAULT_TOKENS.accent);
      expect(res.pkg.tokens.radius).toBe(24);
      expect(res.pkg.tokens.font).toBe(DEFAULT_TOKENS.font);
      expect(res.warnings.join(" ")).toContain("Ignored unknown settings: extra");
    }
  });

  it("survives a __proto__ key", () => {
    const text = '{"format":"deskforge-theme","version":1,"meta":{"name":"p"},"tokens":{"__proto__":{"accent":"#000000"}}}';
    const res = parsePackage(text);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.pkg.tokens.accent).toBe(DEFAULT_TOKENS.accent);
  });

  it("makes safe file names", () => {
    expect(packageFileName("My Theme! ../x")).toBe("my-theme-x.dftheme");
    expect(packageFileName("???")).toBe("theme.dftheme");
  });
});
