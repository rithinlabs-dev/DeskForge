// Trail and particle simulation. The maths is pure (testable with a seeded RNG); drawing takes a canvas context.
import type { ParticleEffect, TrailConfig } from "./config";

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RGB = [number, number, number];
export const hexToRgb = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

// ---- trail -----------------------------------------------------------------

export interface Pt { x: number; y: number; age: number }

export interface TrailState {
  points: Pt[]; // oldest first
  lastX: number; // where a point was last ADDED (not where the newest surviving point is)
  lastY: number;
  primed: boolean;
}

export function createTrail(): TrailState {
  return { points: [], lastX: 0, lastY: 0, primed: false };
}

/**
 * Ages the points, adds one when the cursor has actually moved (>= 2 px since the last point was added), and drops
 * what is too old or too many. A still cursor adds nothing, even after the whole trail has faded: otherwise a dot would
 * be re-created under it forever and the overlay could never go idle.
 */
export function updateTrail(t: TrailState, cur: { x: number; y: number }, dt: number, cfg: { length: number; fade: number }): void {
  const points = t.points;
  for (const p of points) p.age += dt;
  if (!t.primed || Math.hypot(cur.x - t.lastX, cur.y - t.lastY) >= 2) {
    points.push({ x: cur.x, y: cur.y, age: 0 });
    t.lastX = cur.x;
    t.lastY = cur.y;
    t.primed = true;
  }
  while (points.length > 0 && (points[0].age > cfg.fade || points.length > cfg.length)) points.shift();
}

/** A cursor position and when it was read, on any single clock in milliseconds (the page's own, after mapping). */
export interface Sample { x: number; y: number; t: number }

/**
 * Frame-rate independent trail update. Every existing point ages by the real frame time `dt`; every new sample becomes a
 * point whose age is how long ago it was read (`now - t`), so IPC timing jitter doesn't show in the trail. Samples closer
 * than `minGap` px to the last added point are thinned out, so the trail looks the same however fast the cursor is
 * sampled. A still cursor adds nothing, so the trail fades out completely and the overlay can go idle.
 */
export function advanceTrail(t: TrailState, samples: readonly Sample[], now: number, dt: number, cfg: { length: number; fade: number }, minGap = 3): void {
  const points = t.points;
  for (const p of points) p.age += dt;
  for (const s of samples) {
    if (!t.primed || Math.hypot(s.x - t.lastX, s.y - t.lastY) >= minGap) {
      points.push({ x: s.x, y: s.y, age: Math.max(0, (now - s.t) / 1000) });
      t.lastX = s.x;
      t.lastY = s.y;
      t.primed = true;
    }
  }
  while (points.length > 0 && (points[0].age > cfg.fade || points.length > cfg.length)) points.shift();
}

export function drawTrail(ctx: CanvasRenderingContext2D, pts: Pt[], cfg: TrailConfig, time: number): void {
  if (pts.length === 0) return;
  const base = hexToRgb(cfg.color);
  const color = (i: number, a: number) => (cfg.rainbow ? `hsla(${(time * 90 + i * 7) % 360},100%,60%,${a.toFixed(3)})` : rgba(base, a));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const life = Math.max(0, 1 - p.age / cfg.fade);
    const c = color(i, life);
    if (cfg.glow) {
      ctx.shadowBlur = cfg.size * 2;
      ctx.shadowColor = c;
    }
    ctx.fillStyle = c;
    ctx.strokeStyle = c;
    if (cfg.style === "dots") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, (cfg.size / 2) * (0.4 + 0.6 * life), 0, Math.PI * 2);
      ctx.fill();
    } else if (cfg.style === "line" || cfg.style === "comet") {
      if (i === 0) continue;
      const q = pts[i - 1];
      ctx.lineWidth = Math.max(0.5, cfg.style === "comet" ? cfg.size * (i / n) : (cfg.size / 2) * life);
      ctx.beginPath();
      ctx.moveTo(q.x, q.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (i % 2 === 0) {
      // sparkle: a small four-point star that shrinks as it fades
      const s = cfg.size * 0.7 * life;
      const rot = i * 0.7;
      ctx.lineWidth = Math.max(0.5, cfg.size / 8);
      ctx.beginPath();
      for (let k = 0; k < 2; k++) {
        const a = rot + (k * Math.PI) / 2;
        ctx.moveTo(p.x - Math.cos(a) * s, p.y - Math.sin(a) * s);
        ctx.lineTo(p.x + Math.cos(a) * s, p.y + Math.sin(a) * s);
      }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---- particles -------------------------------------------------------------

interface P {
  x: number; y: number; vx: number; vy: number; age: number; life: number;
  size0: number; size1: number; c0: RGB; c1: RGB;
  orbR: number; orbA: number; orbW: number; phase: number;
}
export interface Scales { density: number; size: number; speed: number; lifetime: number; color: string | null }
export interface CursorState { x: number; y: number; vx: number; vy: number }

export class ParticleSystem {
  list: P[] = [];
  private acc = 0;
  private rng: Rng;
  constructor(rng: Rng = Math.random) {
    this.rng = rng;
  }

  get count() {
    return this.list.length;
  }

  update(dt: number, cur: CursorState, e: ParticleEffect, s: Scales): void {
    const speedNow = Math.hypot(cur.vx, cur.vy);
    let rate = e.rate * s.density;
    if (e.emitWhen === "moving") rate *= Math.min(1, speedNow / 400);
    this.acc += rate * dt;
    let n = Math.min(12, Math.floor(this.acc)); // never a huge burst in one frame
    this.acc -= Math.floor(this.acc);
    while (n-- > 0 && this.list.length < e.maxParticles) this.list.push(this.spawn(cur, e, s, speedNow));

    let w = 0; // in-place compaction: no allocation per frame
    for (let i = 0; i < this.list.length; i++) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) continue;
      if (e.behavior === "orbit") {
        p.orbA += p.orbW * dt;
        p.x = cur.x + Math.cos(p.orbA) * p.orbR;
        p.y = cur.y + Math.sin(p.orbA) * p.orbR;
      } else {
        p.vy += e.gravity * dt;
        if (e.behavior === "drift") {
          p.vx += Math.cos(p.phase + p.age * 3) * 40 * dt;
          p.vy += Math.sin(p.phase * 1.3 + p.age * 2.4) * 40 * dt;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.list[w++] = p;
    }
    this.list.length = w;
  }

  private spawn(cur: CursorState, e: ParticleEffect, s: Scales, speedNow: number): P {
    const r = this.rng;
    const color = s.color ?? e.colors[Math.floor(r() * e.colors.length) % e.colors.length];
    const speed = e.speed * s.speed * (0.5 + r());
    const spread = (e.spread * Math.PI) / 180;
    let ang: number;
    if (e.behavior === "fountain") ang = -Math.PI / 2 + (r() - 0.5) * spread;
    else if (e.behavior === "sparks" && speedNow > 20) ang = Math.atan2(-cur.vy, -cur.vx) + (r() - 0.5) * spread;
    else ang = r() * Math.PI * 2;
    const jitter = e.behavior === "drift" ? 24 : 0;
    return {
      x: cur.x + (r() - 0.5) * 2 * jitter,
      y: cur.y + (r() - 0.5) * 2 * jitter,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      age: 0,
      life: e.lifetime * s.lifetime * (0.6 + 0.8 * r()),
      size0: e.size * s.size,
      size1: e.sizeEnd * s.size,
      c0: hexToRgb(color),
      c1: hexToRgb(e.endColor ?? color),
      orbR: 16 + r() * 48,
      orbA: r() * Math.PI * 2,
      orbW: (r() < 0.5 ? -1 : 1) * (1 + r() * 2.5),
      phase: r() * Math.PI * 2,
    };
  }

  draw(ctx: CanvasRenderingContext2D, e: ParticleEffect): void {
    ctx.save();
    ctx.globalCompositeOperation = e.additive ? "lighter" : "source-over";
    for (const p of this.list) {
      const t = p.age / p.life;
      const size = Math.max(0.1, p.size0 + (p.size1 - p.size0) * t);
      const c: RGB = [
        Math.round(p.c0[0] + (p.c1[0] - p.c0[0]) * t),
        Math.round(p.c0[1] + (p.c1[1] - p.c0[1]) * t),
        Math.round(p.c0[2] + (p.c1[2] - p.c0[2]) * t),
      ];
      ctx.fillStyle = rgba(c, e.fade ? 1 - t : 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
