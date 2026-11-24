// M4: the .dftheme file format. Pure and dependency-free (shared with the extension).
//
// {
//   "format": "deskforge-theme",
//   "version": 1,
//   "meta":   { "name": "...", "author": "...", "description": "..." },
//   "tokens": { ...see tokens.ts }
// }
//
// Versioning: files from a NEWER version are rejected with a clear message;
// older versions are upgraded in parseVersioned() as the format evolves.
// Planned for v2: embedded background images (needs an asset store).

import { DEFAULT_TOKENS, sanitizeTokens, type Tokens } from "./tokens";

export const PACKAGE_FORMAT = "deskforge-theme";
export const PACKAGE_VERSION = 1;
export const MAX_PACKAGE_BYTES = 64 * 1024;

export interface ThemePackage {
  format: typeof PACKAGE_FORMAT;
  version: number;
  meta: { name: string; author?: string; description?: string };
  tokens: Tokens;
}

export type ParseResult =
  | { ok: true; pkg: ThemePackage; warnings: string[] }
  | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function createPackage(
  name: string,
  tokens: Tokens,
  extra: { author?: string; description?: string } = {},
): ThemePackage {
  const meta: ThemePackage["meta"] = { name: name.trim().slice(0, 64) };
  if (extra.author?.trim()) meta.author = extra.author.trim().slice(0, 64);
  if (extra.description?.trim()) meta.description = extra.description.trim().slice(0, 280);
  return { format: PACKAGE_FORMAT, version: PACKAGE_VERSION, meta, tokens: sanitizeTokens(tokens) };
}

export function serializePackage(pkg: ThemePackage): string {
  return JSON.stringify(pkg, null, 2) + "\n";
}

export function packageFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "theme"}.dftheme`;
}

export function parsePackage(text: string): ParseResult {
  if (text.length > MAX_PACKAGE_BYTES) return fail("That file is too large to be a theme.");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("That file isn’t valid JSON.");
  }

  if (!isObj(raw) || raw.format !== PACKAGE_FORMAT) return fail("That isn’t a DeskForge theme file.");

  const v = raw.version;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return fail("The theme file has no valid version.");
  if (v > PACKAGE_VERSION) {
    return fail(`This theme was made with a newer DeskForge (format v${v}). Update the app to import it.`);
  }

  const meta = isObj(raw.meta) ? raw.meta : {};
  const name = typeof meta.name === "string" ? meta.name.trim().slice(0, 64) : "";
  if (!name) return fail("The theme file has no name.");
  if (!isObj(raw.tokens)) return fail("The theme file has no settings.");

  const tokens = sanitizeTokens(raw.tokens);

  // Tell the user when we changed or ignored something instead of silently fixing it.
  const known = Object.keys(DEFAULT_TOKENS) as (keyof Tokens)[];
  const rawTokens = raw.tokens;
  const missing: string[] = [];
  const adjusted: string[] = [];
  for (const k of known) {
    const rv = rawTokens[k];
    if (rv === undefined) missing.push(k);
    else if (String(rv).toLowerCase() !== String(tokens[k]).toLowerCase()) adjusted.push(k);
  }
  const unknown = Object.keys(rawTokens).filter((k) => !(known as string[]).includes(k));

  const warnings: string[] = [];
  if (adjusted.length) warnings.push(`Adjusted invalid values: ${adjusted.join(", ")}.`);
  if (missing.length) warnings.push(`Used defaults for: ${missing.join(", ")}.`);
  if (unknown.length) warnings.push(`Ignored unknown settings: ${unknown.slice(0, 5).join(", ")}.`);

  const pkg = createPackage(name, tokens, {
    author: typeof meta.author === "string" ? meta.author : undefined,
    description: typeof meta.description === "string" ? meta.description : undefined,
  });
  return { ok: true, pkg, warnings };
}
