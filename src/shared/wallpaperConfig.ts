// Animated wallpaper settings. Pure, so the validation is unit-tested. Everything read from storage goes through
// sanitizeWallpaperConfig; the Rust side reads the same JSON (mode / pause* / autostart) with its own defaults.

export type Fit = "cover" | "contain" | "fill";
export type WallpaperMode = "auto" | "behind-icons" | "windowed";

export interface WallpaperConfig {
  loop: boolean;
  muted: boolean;
  volume: number; // 0-100
  fit: Fit;
  mode: WallpaperMode;
  pauseOnFullscreen: boolean;
  pauseOnBattery: boolean;
  autostart: boolean;
}

export const DEFAULT_WALLPAPER: WallpaperConfig = {
  loop: true,
  muted: true, // a desktop video should never blast sound by default
  volume: 0,
  fit: "cover",
  mode: "auto",
  pauseOnFullscreen: true,
  pauseOnBattery: false,
  autostart: false,
};

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

export function sanitizeWallpaperConfig(raw: unknown): WallpaperConfig {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_WALLPAPER;
  const vol = typeof r.volume === "number" && Number.isFinite(r.volume) ? Math.min(100, Math.max(0, Math.round(r.volume))) : d.volume;
  return {
    loop: bool(r.loop, d.loop),
    muted: bool(r.muted, d.muted),
    volume: vol,
    fit: r.fit === "contain" || r.fit === "fill" ? r.fit : "cover",
    mode: r.mode === "behind-icons" || r.mode === "windowed" ? r.mode : "auto",
    pauseOnFullscreen: bool(r.pauseOnFullscreen, d.pauseOnFullscreen),
    pauseOnBattery: bool(r.pauseOnBattery, d.pauseOnBattery),
    autostart: bool(r.autostart, d.autostart),
  };
}

/** "1920x1080" -> {1920, 1080}; anything else -> null. */
export function parseResolution(s: string): { width: number; height: number } | null {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(s);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width >= 64 && width <= 7680 && height >= 64 && height <= 4320 ? { width, height } : null;
}

export function formatBytes(n: number): string {
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
