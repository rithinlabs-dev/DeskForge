// Widget manifest (widget.json) + the permission vocabulary.

export const SDK_VERSION = 1;

export const PERMISSIONS = ["theme.read", "system.read", "storage", "launcher.use", "weather.read"] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Plain-language text shown in the consent dialog. */
export const PERMISSION_INFO: Record<Permission, { title: string; detail: string }> = {
  "theme.read": {
    title: "See your theme",
    detail: "Reads your colors, fonts and spacing so it can match DeskForge.",
  },
  "system.read": {
    title: "See system activity",
    detail: "Reads processor, memory and network use while DeskForge is open.",
  },
  storage: {
    title: "Keep its own data",
    detail: "Saves up to 32 KB that only this widget can read.",
  },
  "launcher.use": {
    title: "Open your apps",
    detail: "Sees the names of apps you added to DeskForge and can start them. It never sees file paths.",
  },
  "weather.read": {
    title: "Look up the weather online",
    detail: "Sends the place you search for, and the coordinates you pick (rounded to about 1 km), to open-meteo.com to get the weather. Nothing else is sent.",
  },
};

export interface WidgetManifest {
  id: string;
  name: string;
  version: string;
  sdk: number;
  description: string;
  entry: string;
  permissions: Permission[];
  cols: 1 | 2;
  height: number;
  /** Host-set only (never parsed from a file): folder under /widgets/ when it differs from the id. */
  dir?: string;
}

export type ManifestResult = { ok: true; manifest: WidgetManifest } | { ok: false; error: string };

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;
const ENTRY_RE = /^[a-z0-9][a-z0-9._-]*\.html$/; // no slashes: cannot escape the widget folder
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export const isWidgetId = (v: unknown): v is string => typeof v === "string" && ID_RE.test(v);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function parseManifest(raw: unknown): ManifestResult {
  const fail = (error: string): ManifestResult => ({ ok: false, error });
  if (!isObj(raw)) return fail("Manifest must be a JSON object.");

  if (!isWidgetId(raw.id)) return fail("Manifest id must be 2-32 characters: a-z, 0-9 and dashes, starting with a letter.");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name || name.length > 48) return fail("Manifest name must be 1-48 characters.");
  if (typeof raw.version !== "string" || !VERSION_RE.test(raw.version)) return fail("Manifest version must look like 1.0.0.");
  if (raw.sdk !== SDK_VERSION) return fail(`This widget needs SDK v${String(raw.sdk)}; this app provides v${SDK_VERSION}.`);
  if (typeof raw.entry !== "string" || !ENTRY_RE.test(raw.entry)) return fail("Manifest entry must be a plain .html file name.");

  if (!Array.isArray(raw.permissions)) return fail("Manifest permissions must be a list.");
  const known = PERMISSIONS as readonly string[];
  const permissions: Permission[] = [];
  for (const p of raw.permissions) {
    if (typeof p !== "string" || !known.includes(p)) return fail(`Unknown permission “${String(p).slice(0, 40)}”.`);
    if (!permissions.includes(p as Permission)) permissions.push(p as Permission);
  }

  const layout = isObj(raw.layout) ? raw.layout : {};
  const cols = layout.cols === undefined ? 1 : layout.cols;
  const height = layout.height === undefined ? 160 : layout.height;
  if (cols !== 1 && cols !== 2) return fail("layout.cols must be 1 or 2.");
  if (typeof height !== "number" || !Number.isInteger(height) || height < 80 || height > 400) {
    return fail("layout.height must be a whole number from 80 to 400.");
  }

  return {
    ok: true,
    manifest: {
      id: raw.id,
      name,
      version: raw.version,
      sdk: SDK_VERSION,
      description: typeof raw.description === "string" ? raw.description.trim().slice(0, 200) : "",
      entry: raw.entry,
      permissions,
      cols,
      height,
    },
  };
}
