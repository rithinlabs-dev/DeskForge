import { describe, expect, it } from "vitest";
import { DEFAULT_TOKENS, themeCssVars } from "../shared/tokens";
import { DEFAULT_APPEARANCE, appearanceVars, effectiveAppearance, sanitizeAppearance, sanitizeAppearanceMap, systemGlassTint } from "./appearance";
import { createBridge, type HostServices, type Req } from "./bridge";
import type { Permission, WidgetManifest } from "./manifest";
import { parseForecast, parseGeocoding } from "./weather";

const manifest = (permissions: Permission[]): WidgetManifest => ({
  id: "wx", name: "Wx", version: "1.0.0", sdk: 1, description: "", entry: "index.html", permissions, cols: 1, height: 120,
});
const calls: string[] = [];
const services: HostServices = {
  theme: () => ({ tokens: DEFAULT_TOKENS, cssVars: themeCssVars(DEFAULT_TOKENS) }),
  system: async () => ({ timestampMs: 1, cpuPercent: 1, memUsed: 1, memTotal: 2, netRxBytes: 0, netTxBytes: 0 }),
  loadStore: async () => ({}),
  saveStore: async () => {},
  launcherList: async () => [],
  launcherLaunch: async () => {},
  weatherSearch: async (q) => {
    calls.push("search:" + q);
    return Array.from({ length: 9 }, (_, i) => ({ name: "P" + i, region: "", country: "", lat: 1, lon: 2 }));
  },
  weatherGet: async (lat, lon, units) => {
    calls.push(`get:${lat},${lon},${units}`);
    return { temperature: 20, apparent: 19, humidity: 50, windSpeed: 5, weatherCode: 0, isDay: true, units, updatedMs: 1 };
  },
};
let n = 100;
const req = (method: string, params?: unknown): Req => ({ kind: "req", id: ++n, method, params });
const bridge = (perms: Permission[]) => createBridge({ manifest: manifest(perms), granted: new Set(perms), services });

describe("weather through the bridge", () => {
  it("needs the weather.read permission", async () => {
    const res = await bridge(["theme.read"]).handle(req("weather.search", { query: "Paris" }));
    expect(!res.ok && res.error.code).toBe("permission_denied");
  });

  it("validates the query and coordinates before anything leaves the PC", async () => {
    const b = bridge(["weather.read"]);
    calls.length = 0;
    for (const [m, p] of [
      ["weather.search", { query: "a" }], ["weather.search", { query: "x".repeat(61) }], ["weather.search", {}],
      ["weather.get", { lat: 91, lon: 0 }], ["weather.get", { lat: 0, lon: 181 }], ["weather.get", { lat: "1", lon: 2 }], ["weather.get", { lat: NaN, lon: 2 }],
    ] as const) {
      const res = await b.handle(req(m, p));
      expect(res.ok).toBe(false);
    }
    expect(calls).toEqual([]);
  });

  it("caps search results and rounds coordinates to about 1 km", async () => {
    const b = bridge(["weather.read"]);
    const s = await b.handle(req("weather.search", { query: " Paris " }));
    expect(s.ok && (s.result as unknown[]).length).toBe(5);
    calls.length = 0;
    const g = await b.handle(req("weather.get", { lat: 48.856614, lon: 2.352222, units: "f" }));
    expect(g.ok).toBe(true);
    expect(calls).toEqual(["get:48.86,2.35,f"]);
  });
});

describe("weather parsing", () => {
  it("reads good data and ignores junk", () => {
    const places = parseGeocoding({ results: [{ name: "Paris", admin1: "Île-de-France", country: "France", latitude: 48.85, longitude: 2.35 }, { name: "Bad", latitude: 999, longitude: 0 }, null] });
    expect(places).toEqual([{ name: "Paris", region: "Île-de-France", country: "France", lat: 48.85, lon: 2.35 }]);
    expect(parseGeocoding("x")).toEqual([]);
    const w = parseForecast({ current: { temperature_2m: 20.4, weather_code: 3, is_day: 1, wind_speed_10m: 12.2 } }, "c", 5);
    expect(w).toMatchObject({ temperature: 20, weatherCode: 3, isDay: true, windSpeed: 12, units: "c" });
    expect(parseForecast({ current: {} }, "c", 1)).toBeNull();
    expect(parseForecast(null, "c", 1)).toBeNull();
  });
});

describe("per-widget appearance", () => {
  it("clamps and falls back", () => {
    expect(DEFAULT_APPEARANCE.glassEnabled).toBe(false);
    expect(DEFAULT_APPEARANCE.glassTintOpacity).toBe(35);
    expect(sanitizeAppearance({ opacity: 500, blur: -3, glass: "yes", kind: "weird" })).toMatchObject({ opacity: 100, glassEnabled: false, glassLevel: 0, glassTintOpacity: 6 });
    expect(sanitizeAppearance({ glass: true, blur: 97 }).glassTintOpacity).toBe(33);
    expect(sanitizeAppearance({ glass: true, kind: "blur", blur: 97, border: false, shadow: true })).toMatchObject({
      glassEnabled: true, glassKind: "blur", glassLevel: 97, borderEnabled: false, shadowEnabled: true,
    });
    expect(sanitizeAppearance({ kind: "blur" }).glassKind).toBe("blur");
    expect(sanitizeAppearance({ glass: true, opacity: 100 }).opacity).toBe(70);
    expect(sanitizeAppearance({ glassEnabled: true, glassTintOpacity: 999 }).glassTintOpacity).toBe(100);
    expect(sanitizeAppearance({ glassTint: "#AABBCC" }).glassTint).toBe("#aabbcc");
    expect(sanitizeAppearance({ glassTint: "url(#bad)" }).glassTint).toBeNull();
    expect(sanitizeAppearance({ glassEnabled: true, glassTintOpacity: 35, glassLevel: 100 }).glassLevel).toBe(100);
    expect(Object.keys(sanitizeAppearanceMap({ clock: { opacity: 0 }, "Bad Id": {}, __proto__: { x: 1 } }))).toEqual(["clock"]);
  });

  it("follows the global slider until a widget has its own look", () => {
    expect(effectiveAppearance(undefined, 40).opacity).toBe(40);
    expect(effectiveAppearance({ ...DEFAULT_APPEARANCE, opacity: 10 }, 40).opacity).toBe(10);
  });

  it("opacity 0 with the border off yields a completely clean widget", () => {
    const v = appearanceVars({ ...DEFAULT_APPEARANCE, opacity: 0, borderEnabled: false, shadowEnabled: false }, "dark");
    expect(v).toMatchObject({ "--bg-alpha": "0", "--bg-opacity": "0%", "--frame": "0", "--frame-opacity": "0%", "--body-shadow": "none" });
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, opacity: 30 }, "dark")["--bg-opacity"]).toBe("30%");
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, glassEnabled: true }, "light")["--glass-text"]).toBe("#202328");
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, glassEnabled: true, opacity: 100 }, "dark")["--bg-opacity"]).toBe("35%");
    expect(appearanceVars({ ...DEFAULT_APPEARANCE, glassEnabled: true, glassTint: "#18243a" }, "dark")["--glass-surface"]).toBe("#18243a");
    const lowReflection = appearanceVars({ ...DEFAULT_APPEARANCE, glassEnabled: true, opacity: 70, glassLevel: 0 }, "dark");
    const highReflection = appearanceVars({ ...DEFAULT_APPEARANCE, glassEnabled: true, opacity: 70, glassLevel: 100 }, "dark");
    expect(lowReflection["--bg-opacity"]).toBe("25%");
    expect(lowReflection["--bg-opacity"]).toBe(highReflection["--bg-opacity"]);
    expect(lowReflection["--glass-reflection"]).not.toBe(highReflection["--glass-reflection"]);
    expect(systemGlassTint("dark")).not.toBe(systemGlassTint("light"));
    expect(Object.values(appearanceVars(DEFAULT_APPEARANCE, "dark")).join(" ")).not.toMatch(/[;{}]|url\(/);
  });
});
