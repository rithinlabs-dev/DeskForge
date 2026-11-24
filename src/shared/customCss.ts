// Validates user-uploaded CSS for custom HUDs. Pure (shared + testable).
// Policy: REJECT rather than repair. The CSS only ever runs inside the widget's sandboxed iframe,
// and the app CSP blocks remote loads too, but we refuse anything that could reach outside anyway.

export const MAX_CSS_BYTES = 48 * 1024;
export type CssResult = { ok: true; css: string } | { ok: false; error: string };

/** Decode CSS escapes (u\72l( === url() so checks can't be dodged. */
function decodeEscapes(s: string): string {
  return s
    .replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_m, hex: string) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return "";
      }
    })
    .replace(/\\([\s\S])/g, "$1");
}

const fail = (error: string): CssResult => ({ ok: false, error });
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/;

export function sanitizeCss(text: string): CssResult {
  if (text.length > MAX_CSS_BYTES) return fail("That CSS file is too large (limit 48 KB).");
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "").trim(); // comments can't hide anything
  if (!css) return fail("That CSS file is empty.");
  const norm = decodeEscapes(css).toLowerCase();

  if (norm.includes("@import")) return fail("@import isn’t allowed. Put everything in one file.");
  if (norm.includes("@font-face")) return fail("Custom fonts aren’t supported. Use the theme fonts (var(--font)).");
  if (/image-set\s*\(|(^|[^a-z-])src\s*\(/.test(norm)) return fail("image-set() and src() aren’t allowed.");
  if (/expression\s*\(|javascript:|vbscript:|-moz-binding|behavior\s*:/.test(norm)) return fail("That CSS contains unsafe code.");
  if (/<\/?\s*(style|script)/.test(norm)) return fail("HTML isn’t allowed in CSS.");

  const urls = norm.matchAll(/url\s*\(\s*(['"]?)\s*([^)'"]*)/g);
  for (const m of urls) {
    if (!DATA_IMAGE.test(m[2].trim())) {
      return fail("External and file URLs aren’t allowed. Embed images as data:image URLs instead.");
    }
  }
  return { ok: true, css };
}

/** Shown in the form; documents the class names a HUD exposes. */
export const STARTER_CSS = `/* DeskForge HUD starter. Everything is optional. */
.hud { gap: 10px; }
.part .value { color: var(--accent); }
.clock .value { font-size: 3.2em; font-weight: 300; text-shadow: 0 0 12px var(--accent); }
.bar { height: 6px; background: color-mix(in srgb, var(--accent) 18%, transparent); }
.bar i { background: var(--accent); box-shadow: 0 0 8px var(--accent); }

/* Parts:  .clock .date .cpu .memory .net .text   (inside: .label .value .bar > i)
   Theme:  --bg --surface --text --accent --radius --space --font
   Live:   --cpu --mem (0-100)
   Hide the corner frame:  body::before, body::after { display: none; } */
`;
