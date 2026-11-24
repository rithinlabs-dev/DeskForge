import { describe, expect, it } from "vitest";
import { MAX_CSS_BYTES, STARTER_CSS, sanitizeCss } from "./customCss";

describe("sanitizeCss", () => {
  it("accepts normal CSS, variables, animations and the starter file", () => {
    expect(sanitizeCss(STARTER_CSS).ok).toBe(true);
    expect(sanitizeCss(".a{color:var(--accent);animation:x 1s infinite}@keyframes x{to{opacity:.5}}").ok).toBe(true);
    expect(sanitizeCss('.a::before{content:"\\2022"}').ok).toBe(true);
  });

  it("allows embedded data images only", () => {
    expect(sanitizeCss(".a{background:url(data:image/png;base64,AAAA)}").ok).toBe(true);
    expect(sanitizeCss(".a{background:url(https://evil.example/x.png)}").ok).toBe(false);
    expect(sanitizeCss(".a{background:url('/widgets/x.png')}").ok).toBe(false);
    expect(sanitizeCss('.a{background:image-set("https://x/y.png" 1x)}').ok).toBe(false);
  });

  it("rejects imports, fonts, scripts and HTML", () => {
    for (const bad of [
      '@import "x.css";',
      "@font-face{font-family:x}",
      ".a{width:expression(alert(1))}",
      ".a{background:javascript:x}",
      "</style><script>",
    ]) {
      expect(sanitizeCss(bad).ok).toBe(false);
    }
  });

  it("can't be fooled by escapes or comments", () => {
    expect(sanitizeCss(".a{background:u\\72l(https://evil.example/x)}").ok).toBe(false);
    expect(sanitizeCss(".a{background:ur/**/l(https://evil.example/x)}").ok).toBe(false);
    expect(sanitizeCss("@im/**/port 'x';").ok).toBe(false);
  });

  it("enforces size and non-empty", () => {
    expect(sanitizeCss("a".repeat(MAX_CSS_BYTES + 1)).ok).toBe(false);
    expect(sanitizeCss("   /* nothing */ ").ok).toBe(false);
  });
});
