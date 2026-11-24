import { describe, expect, it } from "vitest";
import { DEFAULT_TOKENS, themeCssVars } from "../shared/tokens";
import { STORE_MAX_BYTES, createBridge, type HostServices, type Req } from "./bridge";
import { missingPermissions, sanitizeGrants } from "./grants";
import { parseManifest, type Permission, type WidgetManifest } from "./manifest";
import { RateLimiter } from "./rateLimit";

const manifest = (permissions: Permission[]): WidgetManifest => ({
  id: "demo", name: "Demo", version: "1.0.0", sdk: 1, description: "", entry: "index.html", permissions, cols: 1, height: 120,
});

function fakeServices() {
  const stores: Record<string, Record<string, unknown>> = {};
  const launched: string[] = [];
  const services: HostServices = {
    theme: () => ({ tokens: DEFAULT_TOKENS, cssVars: themeCssVars(DEFAULT_TOKENS) }),
    system: async () => ({ timestampMs: 1, cpuPercent: 5, memUsed: 1, memTotal: 2, netRxBytes: 0, netTxBytes: 0 }),
    loadStore: async (id) => structuredClone(stores[id] ?? {}),
    saveStore: async (id, d) => {
      stores[id] = structuredClone(d);
    },
    launcherList: async () => [{ id: "app-1", name: "Notepad" }],
    launcherLaunch: async (id) => {
      launched.push(id);
    },
    weatherSearch: async () => [],
    weatherGet: async (_lat, _lon, units) => ({ temperature: 1, apparent: 1, humidity: 1, windSpeed: 1, weatherCode: 0, isDay: true, units, updatedMs: 1 }),
  };
  return { services, stores, launched };
}

let n = 0;
const req = (method: string, params?: unknown): Req => ({ kind: "req", id: ++n, method, params });

function setup(perms: Permission[], limiter?: RateLimiter) {
  const f = fakeServices();
  const bridge = createBridge({ manifest: manifest(perms), granted: new Set(perms), services: f.services, limiter });
  return { ...f, bridge };
}

describe("bridge permissions", () => {
  it("denies methods the widget has no permission for", async () => {
    const { bridge } = setup([]);
    const res = await bridge.handle(req("theme.get"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("permission_denied");
  });

  it("ignores grants for permissions the manifest never declared", async () => {
    const f = fakeServices();
    const bridge = createBridge({ manifest: manifest([]), granted: new Set<Permission>(["system.read"]), services: f.services });
    const res = await bridge.handle(req("system.get"));
    expect(res.ok).toBe(false);
  });

  it("serves theme data with css variables", async () => {
    const { bridge } = setup(["theme.read"]);
    const res = await bridge.handle(req("theme.get"));
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.result as { cssVars: Record<string, string> }).cssVars["--accent"]).toBe(DEFAULT_TOKENS.accent);
  });

  it("rejects unknown methods, including prototype names", async () => {
    const { bridge } = setup(["theme.read"]);
    for (const m of ["nope", "constructor", "__proto__", "toString"]) {
      const res = await bridge.handle(req(m));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("unknown_method");
    }
  });

  it("rejects malformed requests", async () => {
    const { bridge } = setup(["theme.read"]);
    for (const bad of [null, "x", { kind: "req", id: "1", method: "theme.get" }, { kind: "res", id: 1 }]) {
      const res = await bridge.handle(bad);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe("bad_request");
    }
  });

  it("tracks subscriptions only after a permitted subscribe", async () => {
    const { bridge } = setup(["system.read"]);
    expect(bridge.subscribed("system")).toBe(false);
    await bridge.handle(req("theme.subscribe")); // denied
    expect(bridge.subscribed("theme")).toBe(false);
    await bridge.handle(req("system.subscribe"));
    expect(bridge.subscribed("system")).toBe(true);
  });
});

describe("bridge storage", () => {
  it("round-trips, returns null for missing keys, and deletes", async () => {
    const { bridge } = setup(["storage"]);
    expect((await bridge.handle(req("storage.get", { key: "text" }))).ok).toBe(true);
    await bridge.handle(req("storage.set", { key: "text", value: "hello" }));
    const got = await bridge.handle(req("storage.get", { key: "text" }));
    expect(got.ok && got.result).toBe("hello");
    await bridge.handle(req("storage.delete", { key: "text" }));
    const gone = await bridge.handle(req("storage.get", { key: "text" }));
    expect(gone.ok && gone.result).toBe(null);
  });

  it("rejects dangerous or malformed keys", async () => {
    const { bridge, stores } = setup(["storage"]);
    for (const key of ["__proto__", "has space", "", "a/b", "x".repeat(60), 5]) {
      const res = await bridge.handle(req("storage.set", { key, value: 1 }));
      expect(res.ok).toBe(false);
    }
    expect(stores.demo).toBeUndefined();
  });

  it("enforces the 32 KB quota", async () => {
    const { bridge } = setup(["storage"]);
    const res = await bridge.handle(req("storage.set", { key: "big", value: "x".repeat(STORE_MAX_BYTES + 1) }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("invalid_params");
  });

  it("keeps concurrent writes from clobbering each other", async () => {
    const { bridge } = setup(["storage"]);
    await Promise.all([
      bridge.handle(req("storage.set", { key: "a", value: 1 })),
      bridge.handle(req("storage.set", { key: "b", value: 2 })),
      bridge.handle(req("storage.set", { key: "c", value: 3 })),
    ]);
    for (const [k, v] of [["a", 1], ["b", 2], ["c", 3]] as const) {
      const r = await bridge.handle(req("storage.get", { key: k }));
      expect(r.ok && r.result).toBe(v);
    }
  });
});

describe("bridge launcher", () => {
  it("never exposes file paths", async () => {
    const f = fakeServices();
    f.services.launcherList = async () =>
      [{ id: "app-1", name: "Notepad", path: "C:\\Windows\\notepad.exe" }] as unknown as { id: string; name: string }[];
    const bridge = createBridge({ manifest: manifest(["launcher.use"]), granted: new Set<Permission>(["launcher.use"]), services: f.services });
    const res = await bridge.handle(req("launcher.list"));
    expect(res.ok && res.result).toEqual([{ id: "app-1", name: "Notepad" }]);
  });

  it("validates launch params", async () => {
    const { bridge, launched } = setup(["launcher.use"]);
    expect((await bridge.handle(req("launcher.launch", { id: 5 }))).ok).toBe(false);
    expect((await bridge.handle(req("launcher.launch", { id: "app-1" }))).ok).toBe(true);
    expect(launched).toEqual(["app-1"]);
  });
});

describe("rate limiting", () => {
  it("limits bursts and refills over time", async () => {
    let t = 0;
    const { bridge } = setup(["theme.read"], new RateLimiter(2, 1, () => t));
    expect((await bridge.handle(req("theme.get"))).ok).toBe(true);
    expect((await bridge.handle(req("theme.get"))).ok).toBe(true);
    const limited = await bridge.handle(req("theme.get"));
    expect(!limited.ok && limited.error.code).toBe("rate_limited");
    t = 1000;
    expect((await bridge.handle(req("theme.get"))).ok).toBe(true);
  });
});

describe("manifest", () => {
  const base = { id: "clock", name: "Clock", version: "1.0.0", sdk: 1, entry: "index.html", permissions: ["theme.read"] };

  it("accepts a valid manifest and applies layout defaults", () => {
    const r = parseManifest(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.manifest).toMatchObject({ cols: 1, height: 160 });
  });

  it("rejects bad ids, entries, permissions, sdk versions and layouts", () => {
    expect(parseManifest({ ...base, id: "Bad Id" }).ok).toBe(false);
    expect(parseManifest({ ...base, id: "__proto__" }).ok).toBe(false);
    expect(parseManifest({ ...base, entry: "../evil.html" }).ok).toBe(false);
    expect(parseManifest({ ...base, entry: "sub/index.html" }).ok).toBe(false);
    expect(parseManifest({ ...base, permissions: ["fs.write"] }).ok).toBe(false);
    expect(parseManifest({ ...base, sdk: 2 }).ok).toBe(false);
    expect(parseManifest({ ...base, layout: { cols: 3 } }).ok).toBe(false);
    expect(parseManifest({ ...base, layout: { height: 9999 } }).ok).toBe(false);
    expect(parseManifest(null).ok).toBe(false);
  });
});

describe("grants", () => {
  it("finds permissions that still need consent", () => {
    const m = manifest(["theme.read", "storage"]);
    expect(missingPermissions(m, undefined)).toEqual(["theme.read", "storage"]);
    expect(missingPermissions(m, { version: "1.0.0", permissions: ["theme.read"] })).toEqual(["storage"]);
    expect(missingPermissions(m, { version: "1.0.0", permissions: ["theme.read", "storage"] })).toEqual([]);
  });

  it("sanitizes stored grants", () => {
    const raw = JSON.parse('{"clock":{"version":"1.0.0","permissions":["theme.read","fs.write",5]},"__proto__":{"permissions":["storage"]},"Bad Id":{}}');
    const g = sanitizeGrants(raw);
    expect(Object.keys(g)).toEqual(["clock"]);
    expect(g.clock.permissions).toEqual(["theme.read"]);
  });
});
