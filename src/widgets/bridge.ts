// The ONLY thing a widget can reach. Transport-agnostic and pure, so it is unit-tested
// without a browser. Every request is: validated -> rate limited -> permission checked.

import type { SystemSnapshot } from "../api";
import type { Tokens } from "../shared/tokens";
import type { Permission, WidgetManifest } from "./manifest";
import type { WidgetLayout } from "./layout";
import { RateLimiter } from "./rateLimit";
import type { GeoResult, WeatherNow } from "./weather";

export interface ThemePayload {
  tokens: Tokens;
  cssVars: Record<string, string>;
  layout?: WidgetLayout;
}

export interface HostServices {
  theme(): ThemePayload;
  system(): Promise<SystemSnapshot>;
  loadStore(widgetId: string): Promise<Record<string, unknown>>;
  saveStore(widgetId: string, data: Record<string, unknown>): Promise<void>;
  launcherList(): Promise<{ id: string; name: string }[]>;
  launcherLaunch(id: string): Promise<void>;
  weatherSearch(query: string): Promise<GeoResult[]>;
  weatherGet(lat: number, lon: number, units: "c" | "f"): Promise<WeatherNow>;
}

export type Topic = "theme" | "system";
export interface Req { kind: "req"; id: number; method: string; params?: unknown }
export type Res =
  | { kind: "res"; id: number; ok: true; result: unknown }
  | { kind: "res"; id: number; ok: false; error: { code: string; message: string } };

export interface Bridge {
  handle(raw: unknown): Promise<Res>;
  subscribed(topic: Topic): boolean;
}

export const STORE_MAX_BYTES = 32 * 1024;
export const STORE_MAX_KEYS = 64;

const METHOD_PERMISSION: Record<string, Permission> = {
  "theme.get": "theme.read",
  "theme.subscribe": "theme.read",
  "system.get": "system.read",
  "system.subscribe": "system.read",
  "storage.get": "storage",
  "storage.set": "storage",
  "storage.delete": "storage",
  "launcher.list": "launcher.use",
  "launcher.launch": "launcher.use",
  "weather.search": "weather.read",
  "weather.get": "weather.read",
};

// Must start with a letter, so "__proto__" can never be a key.
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,47}$/;

class BridgeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const ok = (id: number, result: unknown): Res => ({ kind: "res", id, ok: true, result });
const err = (id: number, code: string, message: string): Res => ({ kind: "res", id, ok: false, error: { code, message } });

function isReq(v: unknown): v is Req {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.kind === "req" &&
    typeof r.id === "number" &&
    Number.isSafeInteger(r.id) &&
    typeof r.method === "string" &&
    r.method.length <= 64
  );
}

function param(params: unknown, name: string): unknown {
  return typeof params === "object" && params !== null ? (params as Record<string, unknown>)[name] : undefined;
}

function keyParam(params: unknown): string {
  const k = param(params, "key");
  if (typeof k !== "string" || !KEY_RE.test(k)) {
    throw new BridgeError("invalid_params", "key must start with a letter and use only letters, digits, . _ - (max 48).");
  }
  return k;
}

export function createBridge(opts: {
  manifest: WidgetManifest;
  granted: ReadonlySet<Permission>;
  services: HostServices;
  limiter?: RateLimiter;
}): Bridge {
  const { manifest, services } = opts;
  const limiter = opts.limiter ?? new RateLimiter();
  // A widget can only use what it DECLARED and the user APPROVED.
  const allowed = new Set([...opts.granted].filter((p) => manifest.permissions.includes(p)));
  const subs = new Set<Topic>();

  // Read-modify-write on the store must not interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  async function dispatch(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case "theme.get":
        return services.theme();
      case "theme.subscribe":
        subs.add("theme");
        return services.theme();
      case "system.get":
        return services.system();
      case "system.subscribe":
        subs.add("system");
        return services.system();

      case "storage.get": {
        const key = keyParam(params);
        return serialize(async () => {
          const store = await services.loadStore(manifest.id);
          return own(store, key) ? store[key] : null;
        });
      }
      case "storage.set": {
        const key = keyParam(params);
        const value = param(params, "value");
        let encoded: string | undefined;
        try {
          encoded = JSON.stringify(value);
        } catch {
          encoded = undefined;
        }
        if (encoded === undefined) throw new BridgeError("invalid_params", "value must be JSON-serializable.");
        return serialize(async () => {
          const next: Record<string, unknown> = { ...(await services.loadStore(manifest.id)) };
          next[key] = JSON.parse(encoded as string);
          if (Object.keys(next).length > STORE_MAX_KEYS) {
            throw new BridgeError("invalid_params", `Storage allows at most ${STORE_MAX_KEYS} keys.`);
          }
          if (JSON.stringify(next).length > STORE_MAX_BYTES) {
            throw new BridgeError("invalid_params", "Storage limit reached (32 KB).");
          }
          await services.saveStore(manifest.id, next);
          return true;
        });
      }
      case "storage.delete": {
        const key = keyParam(params);
        return serialize(async () => {
          const next: Record<string, unknown> = { ...(await services.loadStore(manifest.id)) };
          delete next[key];
          await services.saveStore(manifest.id, next);
          return true;
        });
      }

      case "launcher.list": {
        const list = await services.launcherList();
        return list.map(({ id, name }) => ({ id, name })); // strip anything else, notably paths
      }
      case "launcher.launch": {
        const id = param(params, "id");
        if (typeof id !== "string" || id.length < 1 || id.length > 64) {
          throw new BridgeError("invalid_params", "id must be a string.");
        }
        await services.launcherLaunch(id);
        return true;
      }
      case "weather.search": {
        const q = param(params, "query");
        if (typeof q !== "string" || q.trim().length < 2 || q.length > 60) {
          throw new BridgeError("invalid_params", "query must be 2-60 characters.");
        }
        return (await services.weatherSearch(q.trim())).slice(0, 5);
      }
      case "weather.get": {
        const lat = param(params, "lat");
        const lon = param(params, "lon");
        const ok = (v: unknown, lim: number): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= lim;
        if (!ok(lat, 90) || !ok(lon, 180)) throw new BridgeError("invalid_params", "lat/lon are out of range.");
        // About 1 km: enough for weather, and less precise than the user's actual location.
        return services.weatherGet(Math.round(lat * 100) / 100, Math.round(lon * 100) / 100, param(params, "units") === "f" ? "f" : "c");
      }
      default:
        throw new BridgeError("unknown_method", "Unknown method.");
    }
  }

  return {
    subscribed: (topic) => subs.has(topic),

    async handle(raw) {
      if (!isReq(raw)) return err(-1, "bad_request", "Malformed request.");
      const { id, method, params } = raw;
      if (!limiter.take()) return err(id, "rate_limited", "Too many requests. Slow down.");
      if (!own(METHOD_PERMISSION, method)) return err(id, "unknown_method", "Unknown method.");
      const need = METHOD_PERMISSION[method];
      if (!allowed.has(need)) {
        return err(id, "permission_denied", `This widget doesn’t have the “${need}” permission.`);
      }
      try {
        return ok(id, await dispatch(method, params));
      } catch (e) {
        if (e instanceof BridgeError) return err(id, e.code, e.message);
        return err(id, "internal", "The host couldn’t complete that request.");
      }
    },
  };
}
