// Weather for the host (never for widgets directly). Open-Meteo: free, no account or key.
// Only a place NAME (search) or coordinates rounded to ~1 km (forecast) ever leave the PC, and only after the user
// approved the widget's weather.read permission. Parsers are pure and defensive: unknown shapes become "no data".

export interface GeoResult { name: string; region: string; country: string; lat: number; lon: number }
export interface WeatherNow {
  temperature: number; apparent: number; humidity: number; windSpeed: number;
  weatherCode: number; isDay: boolean; units: "c" | "f"; updatedMs: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 60) => (typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").slice(0, max) : "");

export function parseGeocoding(json: unknown): GeoResult[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  const out: GeoResult[] = [];
  for (const r of results.slice(0, 5)) {
    const o = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
    const lat = num(o.latitude);
    const lon = num(o.longitude);
    const name = str(o.name);
    if (lat === null || lon === null || !name || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    out.push({ name, region: str(o.admin1), country: str(o.country), lat, lon });
  }
  return out;
}

export function parseForecast(json: unknown, units: "c" | "f", now: number): WeatherNow | null {
  const c = (json as { current?: unknown } | null)?.current;
  if (typeof c !== "object" || c === null) return null;
  const o = c as Record<string, unknown>;
  const t = num(o.temperature_2m);
  const code = num(o.weather_code);
  if (t === null || code === null) return null;
  return {
    temperature: Math.round(t),
    apparent: Math.round(num(o.apparent_temperature) ?? t),
    humidity: Math.round(num(o.relative_humidity_2m) ?? 0),
    windSpeed: Math.round(num(o.wind_speed_10m) ?? 0),
    weatherCode: Math.round(code),
    isDay: o.is_day === 1,
    units,
    updatedMs: now,
  };
}

async function getJson(url: string, f: typeof fetch): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await f(url, { signal: ctrl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) throw new Error(`The weather service answered HTTP ${res.status}.`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function searchPlaces(query: string, f: typeof fetch = fetch): Promise<GeoResult[]> {
  const url = "https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=" + encodeURIComponent(query);
  return parseGeocoding(await getJson(url, f));
}

const cache = new Map<string, WeatherNow>();
const FRESH_MS = 10 * 60 * 1000;

/** lat/lon must already be validated numbers (the bridge does that). Cached for 10 minutes. */
export async function currentWeather(lat: number, lon: number, units: "c" | "f", f: typeof fetch = fetch, now = Date.now()): Promise<WeatherNow> {
  const key = `${lat},${lon},${units}`;
  const hit = cache.get(key);
  if (hit && now - hit.updatedMs < FRESH_MS) return hit;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m` +
    `&temperature_unit=${units === "f" ? "fahrenheit" : "celsius"}&wind_speed_unit=${units === "f" ? "mph" : "kmh"}&timezone=auto`;
  const parsed = parseForecast(await getJson(url, f), units, now);
  if (!parsed) throw new Error("The weather service returned data DeskForge couldn’t read.");
  cache.set(key, parsed);
  return parsed;
}
