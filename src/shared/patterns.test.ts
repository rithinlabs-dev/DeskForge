import { describe, expect, it } from "vitest";
import { PATTERN_KEYS, patternCss } from "./patterns";
import { DEFAULT_TOKENS, sanitizeTokens } from "./tokens";
import { TEMPLATES } from "../templates";

describe("patterns", () => {
  it("every pattern yields safe, non-empty CSS", () => {
    for (const pattern of PATTERN_KEYS) {
      const art = patternCss({ ...DEFAULT_TOKENS, pattern });
      expect(art.image.length).toBeGreaterThan(0);
      expect(art.size.length).toBeGreaterThan(0);
      expect(art.image + art.size).not.toMatch(/[;{}]/);
    }
  });

  it("rejects unknown pattern names", () => {
    expect(sanitizeTokens({ pattern: "evil" }).pattern).toBe(DEFAULT_TOKENS.pattern);
    expect(sanitizeTokens({ pattern: "toString" }).pattern).toBe(DEFAULT_TOKENS.pattern);
    expect(sanitizeTokens({ pattern: "hex" }).pattern).toBe("hex");
  });
});

describe("templates", () => {
  it("has 36 valid, uniquely named templates", () => {
    expect(TEMPLATES).toHaveLength(36);
    expect(new Set(TEMPLATES.map((t) => t.name)).size).toBe(36);
    for (const t of TEMPLATES) expect(sanitizeTokens(t.tokens)).toEqual(t.tokens);
  });
});
