// Finds bundled widgets (public/widgets/index.json) and validates each manifest.
import { isWidgetId, parseManifest, type WidgetManifest } from "./manifest";

export interface Catalog {
  widgets: WidgetManifest[];
  errors: string[];
}

export const widgetUrl = (m: WidgetManifest) => `/widgets/${m.dir ?? m.id}/${m.entry}`;

export async function loadCatalog(base = "/widgets"): Promise<Catalog> {
  const widgets: WidgetManifest[] = [];
  const errors: string[] = [];

  let ids: unknown[] = [];
  try {
    const res = await fetch(`${base}/index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    ids = Array.isArray(json?.widgets) ? json.widgets : [];
  } catch (e) {
    return { widgets, errors: [`Couldn’t load the widget list: ${String(e)}`] };
  }

  for (const id of ids.slice(0, 50)) {
    if (!isWidgetId(id)) {
      errors.push("Skipped a widget with an invalid id.");
      continue;
    }
    try {
      const res = await fetch(`${base}/${id}/widget.json`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseManifest(await res.json());
      if (!parsed.ok) throw new Error(parsed.error);
      if (parsed.manifest.id !== id) throw new Error("manifest id doesn’t match its folder");
      widgets.push(parsed.manifest);
    } catch (e) {
      errors.push(`Skipped widget “${id}”: ${String(e instanceof Error ? e.message : e)}`);
    }
  }
  return { widgets, errors };
}

/** Default desktop size of a widget; after that the user's resize wins. */
export const desktopSize = (m: WidgetManifest) => ({ width: m.cols === 2 ? 520 : 260, height: m.height });
