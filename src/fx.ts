// The cursor-effects overlay: a transparent, click-through, fullscreen window. The webview can't see the mouse while it
// is click-through, so Rust samples the global cursor position about 250 times a second and timestamps every change
// (api.fx.cursorBatch hands over what is new). Two loops run independently so the trail doesn't depend on IPC timing:
//   * poll:   asks Rust for the new samples and maps their timestamps onto this page's clock;
//   * render: draws once per display frame, ages the trail by real frame time and adds each sample at its true age.
// Both slow right down when nothing is moving.
import { api } from "./api";
import { DEFAULT_FX, FX_CONFIG_KEY, FX_EFFECTS_KEY, findEffect, sanitizeEffectLibrary, sanitizeFxConfig, type ParticleEffect } from "./fx/config";
import { ParticleSystem, advanceTrail, createTrail, drawTrail, type Sample } from "./fx/engine";
import "./fx.css";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const resize = () => {
  canvas.width = window.innerWidth; // CSS pixels: cheaper than physical, and trails are soft anyway
  canvas.height = window.innerHeight;
};
resize();
window.addEventListener("resize", resize);

let cfg = DEFAULT_FX;
let library: ParticleEffect[] = [];
const reload = async () => {
  cfg = sanitizeFxConfig(await api.settings.get(FX_CONFIG_KEY));
  library = sanitizeEffectLibrary(await api.settings.get(FX_EFFECTS_KEY));
};
reload().catch(() => {});
api.settings.onChanged((k) => (k === FX_CONFIG_KEY || k === FX_EFFECTS_KEY) && reload().catch(() => {})).catch(() => {});

const trail = createTrail();
const particles = new ParticleSystem();
let cur = { x: 0, y: 0, vx: 0, vy: 0 };
let haveCursor = false; // false until the first sample, so the first move doesn't count as a huge jump
let pending: Sample[] = []; // samples from Rust not drawn yet, oldest first, times on this page's clock
let suspended = false; // a fullscreen app is running
let prevT = performance.now();
let lastMove = 0;
let sleeping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let raf = 0;

const wantsAny = () => cfg.trail.enabled || cfg.particles.enabled;
const clear = () => ctx.clearRect(0, 0, canvas.width, canvas.height);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Draw the next frame now (ms = 0) or after a pause (ms > 0). */
function schedule(ms: number) {
  clearTimeout(timer);
  cancelAnimationFrame(raf);
  sleeping = ms > 0;
  if (ms > 0) {
    timer = setTimeout(() => {
      sleeping = false;
      raf = requestAnimationFrame(frame);
    }, ms);
  } else {
    raf = requestAnimationFrame(frame);
  }
}
const wake = () => {
  if (sleeping) schedule(0);
};

function frame(now: number) {
  if (!wantsAny()) {
    clear();
    trail.points.length = 0;
    trail.primed = false;
    particles.list.length = 0;
    pending = [];
    return schedule(400); // nothing to do: don't even ask for the cursor
  }
  if (suspended) {
    clear();
    pending = [];
    return schedule(500);
  }
  if (cfg.fps === 30 && now - prevT < 30) return schedule(0);

  const dt = Math.min(0.05, Math.max(0.001, (now - prevT) / 1000));
  prevT = now;
  const samples = pending;
  pending = [];
  const last = samples[samples.length - 1];
  if (last) {
    const moved = haveCursor ? Math.hypot(last.x - cur.x, last.y - cur.y) : 0;
    if (moved > 1) lastMove = now;
    cur = haveCursor ? { x: last.x, y: last.y, vx: (last.x - cur.x) / dt, vy: (last.y - cur.y) / dt } : { x: last.x, y: last.y, vx: 0, vy: 0 };
    haveCursor = true;
  } else {
    cur = { ...cur, vx: 0, vy: 0 };
  }

  clear();
  if (cfg.trail.enabled) {
    advanceTrail(trail, samples, now, dt, cfg.trail);
    drawTrail(ctx, trail.points, cfg.trail, now / 1000);
  } else {
    trail.points.length = 0;
    trail.primed = false;
  }
  if (cfg.particles.enabled) {
    const effect = findEffect(cfg.particles.effect, library);
    particles.update(dt, cur, effect, {
      density: cfg.particles.density,
      size: cfg.particles.sizeScale,
      speed: cfg.particles.speedScale,
      lifetime: cfg.particles.lifetimeScale,
      color: cfg.particles.colorOverride,
    });
    particles.draw(ctx, effect);
  }

  // Idle: cursor still, nothing left to animate -> draw rarely instead of spinning at 60 Hz. A move wakes it at once.
  const idle = now - lastMove > 1000 && trail.points.length === 0 && particles.count === 0;
  schedule(idle ? 120 : 0);
}

/** Collects the cursor samples. IPC timing jitters; every sample carries the moment it was read, so that doesn't matter. */
async function poll() {
  for (;;) {
    if (!wantsAny()) {
      await sleep(400);
      continue;
    }
    try {
      const batch = await api.fx.cursorBatch();
      const offset = performance.now() - batch.now; // Rust's clock -> this page's clock
      const dpr = window.devicePixelRatio || 1;
      const wasSuspended = suspended;
      suspended = batch.suspended;
      for (const s of batch.samples) pending.push({ x: s.x / dpr, y: s.y / dpr, t: s.t + offset });
      if (pending.length > 600) pending.splice(0, pending.length - 600);
      if (batch.samples.length > 0 || wasSuspended !== suspended) wake();
      await sleep(suspended ? 500 : sleeping ? 120 : 8);
    } catch {
      await sleep(500);
    }
  }
}

schedule(0);
void poll();
