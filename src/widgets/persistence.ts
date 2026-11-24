import { api } from "../api";
import { sanitizeGrants, type Grants } from "./grants";
import { isWidgetId } from "./manifest";

export async function loadGrants(): Promise<Grants> {
  return sanitizeGrants(await api.settings.get("widgets:grants"));
}
export const saveGrants = (g: Grants) => api.settings.set("widgets:grants", g);

export async function loadEnabled(): Promise<string[]> {
  const raw = await api.settings.get("widgets:enabled");
  return Array.isArray(raw) ? [...new Set(raw.filter(isWidgetId))] : [];
}
export const saveEnabled = (ids: string[]) => api.settings.set("widgets:enabled", ids);

import { sanitizeCustomList, type CustomHud } from "./custom";

export async function loadOpacity(): Promise<number> {
  const v = await api.settings.get("widgets:opacity");
  return typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 85;
}
export const loadCustom = async (): Promise<CustomHud[]> => sanitizeCustomList(await api.settings.get("widgets:custom"));
export const saveCustom = (list: CustomHud[]) => api.settings.set("widgets:custom", list);

/** Bumped whenever a widget's stored config/CSS changes, so every window reloads that widget. */
export async function loadRevs(): Promise<Record<string, number>> {
  const raw = await api.settings.get("widgets:rev");
  const out: Record<string, number> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (isWidgetId(k) && typeof v === "number") out[k] = v;
  }
  return out;
}

import { sanitizeAppearanceMap, type Appearance } from "./appearance";
import { sanitizeWidgetLayoutMap, type WidgetLayoutMap } from "./layout";

export async function loadAppearance(): Promise<Record<string, Appearance>> {
  return sanitizeAppearanceMap(await api.settings.get("widgets:appearance"));
}
export const saveAppearance = (m: Record<string, Appearance>) => api.settings.set("widgets:appearance", m);

export async function loadLayouts(): Promise<WidgetLayoutMap> {
  return sanitizeWidgetLayoutMap(await api.settings.get("widgets:layout"));
}
export const saveLayouts = (m: WidgetLayoutMap) => api.settings.set("widgets:layout", m);
