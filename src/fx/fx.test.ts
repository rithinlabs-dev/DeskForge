import { describe, expect, it } from "vitest";
import {
  BUILTIN_EFFECTS, DEFAULT_FX, MAX_EFFECT_FILE, findEffect, parseEffectFile, sanitizeEffect, sanitizeEffectLibrary, sanitizeFxConfig,
} from "./config";
import { ParticleSystem, createTrail, mulberry32, updateTrail } from "./engine";

const effect = (over: object = {}) => ({ ...BUILTIN_EFFECTS[0], ...over });
const scales = { density: 1, size: 1, speed: 1, lifetime: 1, color: null };

describe("effect validation", () => {
  it("clamps every number and drops bad colours", () => {
    const e = sanitizeEffect({ size: 9999, speed: -5, lifetime: 0, rate: 1e9, colors: ["red", "#12345", "#AABBCC", 5], behavior: "nuke", spread: 720 });
    expect(e.size).toBe(64);
    expect(e.speed).toBe(0);
    expect(e.lifetime).toBe(0.1);
    expect(e.rate).toBe(500);
    expect(e.colors).toEqual(["#aabbcc"]);
    expect(e.behavior).toBe("sparks");
    expect(e.spread).toBe(360);
  });

  it("never throws on junk", () => {
    for (const junk of [null, undefined, 5, "x", [], { colors: "no" }]) expect(() => sanitizeEffect(junk)).not.toThrow();
    expect(sanitizeEffect(null).colors).toEqual(["#ffffff"]);
  });

  it("parses only well-formed .dfx files", () => {
    const good = JSON.stringify({ format: "deskforge-effect", version: 1, effect: { name: "Mine", rate: 10 } });
    const r = parseEffectFile(good);
    expect(r.ok && r.effect.name).toBe("Mine");
    expect(parseEffectFile("nope").ok).toBe(false);
    expect(parseEffectFile(JSON.stringify({ format: "other", version: 1, effect: {} })).ok).toBe(false);
    expect(parseEffectFile(JSON.stringify({ format: "deskforge-effect", version: 2, effect: {} })).ok).toBe(false);
    expect(parseEffectFile("x".repeat(MAX_EFFECT_FILE + 1)).ok).toBe(false);
  });

  it("de-duplicates and caps the library, and falls back to a built-in", () => {
    const lib = sanitizeEffectLibrary([{ name: "A" }, { name: "A" }, { name: "B" }]);
    expect(lib.map((e) => e.name)).toEqual(["A", "B"]);
    expect(findEffect("A", lib).name).toBe("A");
    expect(findEffect("missing", lib).name).toBe(BUILTIN_EFFECTS[0].name);
  });
});

describe("fx config", () => {
  it("defaults are lightweight and off by default for autostart and particles", () => {
    expect(sanitizeFxConfig(null)).toEqual(DEFAULT_FX);
    expect(DEFAULT_FX.autostart).toBe(false);
    expect(DEFAULT_FX.particles.enabled).toBe(false);
  });
  it("rejects bad values", () => {
    const c = sanitizeFxConfig({ trail: { length: 9999, fade: 0, style: "x", color: "nope" }, fps: 144, particles: { density: 99 } });
    expect(c.trail.length).toBe(120);
    expect(c.trail.fade).toBe(0.1);
    expect(c.trail.style).toBe("comet");
    expect(c.trail.color).toBe(DEFAULT_FX.trail.color);
    expect(c.fps).toBe(60);
    expect(c.particles.density).toBe(3);
  });
});

describe("engine", () => {
  it("trail adds points only when the cursor moves, then fades them out", () => {
    const t = createTrail();
    const cfg = { length: 10, fade: 0.5 };
    updateTrail(t, { x: 0, y: 0 }, 0.016, cfg);
    updateTrail(t, { x: 0.5, y: 0 }, 0.016, cfg); // moved < 2px
    expect(t.points).toHaveLength(1);
    updateTrail(t, { x: 10, y: 0 }, 0.016, cfg);
    expect(t.points).toHaveLength(2);
    for (let i = 0; i < 40; i++) updateTrail(t, { x: 10, y: 0 }, 0.05, cfg); // cursor still, time passes
    expect(t.points).toHaveLength(0);
  });

  it("a still cursor never re-creates points after the trail faded (so the overlay can go idle)", () => {
    const t = createTrail();
    const cfg = { length: 10, fade: 0.3 };
    updateTrail(t, { x: 50, y: 50 }, 0.016, cfg);
    for (let i = 0; i < 200; i++) updateTrail(t, { x: 50, y: 50 }, 0.05, cfg);
    expect(t.points).toHaveLength(0);
    updateTrail(t, { x: 80, y: 50 }, 0.016, cfg); // moving again adds a point again
    expect(t.points).toHaveLength(1);
  });

  it("trail respects the length limit", () => {
    const t = createTrail();
    for (let i = 0; i < 50; i++) updateTrail(t, { x: i * 5, y: 0 }, 0.001, { length: 8, fade: 10 });
    expect(t.points.length).toBeLessThanOrEqual(8);
  });

  it("particles are deterministic with a seeded RNG, capped, and die", () => {
    const run = () => {
      const ps = new ParticleSystem(mulberry32(42));
      const e = sanitizeEffect(effect({ maxParticles: 50, emitWhen: "always", rate: 200 }));
      for (let i = 0; i < 120; i++) ps.update(0.016, { x: 100 + i, y: 100, vx: 500, vy: 0 }, e, scales);
      return ps;
    };
    const a = run();
    const b = run();
    expect(a.count).toBe(b.count);
    expect(a.list[0]?.x).toBe(b.list[0]?.x);
    expect(a.count).toBeLessThanOrEqual(50);
    const ps = new ParticleSystem(mulberry32(1));
    const e = sanitizeEffect(effect({ emitWhen: "always", lifetime: 0.1 }));
    ps.update(0.5, { x: 0, y: 0, vx: 0, vy: 0 }, e, scales);
    for (let i = 0; i < 60; i++) ps.update(0.05, { x: 0, y: 0, vx: 0, vy: 0 }, { ...e, rate: 1 }, { ...scales, density: 0.1 });
    expect(ps.count).toBeLessThan(5);
  });

  it("emits nothing while the cursor is still when set to 'moving'", () => {
    const ps = new ParticleSystem(mulberry32(7));
    const e = sanitizeEffect(effect({ emitWhen: "moving" }));
    for (let i = 0; i < 60; i++) ps.update(0.016, { x: 0, y: 0, vx: 0, vy: 0 }, e, scales);
    expect(ps.count).toBe(0);
  });
});
