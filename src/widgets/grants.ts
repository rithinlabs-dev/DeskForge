// Pure permission-grant helpers (persistence lives in persistence.ts).
import { PERMISSIONS, isWidgetId, type Permission, type WidgetManifest } from "./manifest";

export interface Grant {
  version: string;
  permissions: Permission[];
}
export type Grants = Record<string, Grant>;

/** Permissions the manifest asks for that the user has not approved yet. */
export function missingPermissions(m: WidgetManifest, g: Grant | undefined): Permission[] {
  return m.permissions.filter((p) => !g || !g.permissions.includes(p));
}

/** Storage is untrusted input too: keep only valid ids and known permissions. */
export function sanitizeGrants(raw: unknown): Grants {
  const out: Grants = {};
  if (typeof raw !== "object" || raw === null) return out;
  const known = PERMISSIONS as readonly string[];
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isWidgetId(id) || typeof v !== "object" || v === null) continue;
    const g = v as Record<string, unknown>;
    const perms = Array.isArray(g.permissions)
      ? g.permissions.filter((p): p is Permission => typeof p === "string" && known.includes(p))
      : [];
    out[id] = {
      version: typeof g.version === "string" ? g.version.slice(0, 32) : "0.0.0",
      permissions: [...new Set(perms)],
    };
  }
  return out;
}
