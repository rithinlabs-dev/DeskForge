// Small pure helpers for the island: formatting, the music position, and what the collapsed pill shows.
import type { Hour12, PillModule } from "./config";
import type { Status } from "./pomodoro";

/** 25:00, 04:59, 00:01. Rounds up so the display never shows 00:00 while time is left. */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export interface Playback {
  status: string;
  positionMs: number;
  durationMs: number;
  /** Unix ms when `positionMs` was true. */
  updatedMs: number;
}

/** Where the track is now: the last reported position plus the time since, while it is playing. */
export function playbackPosition(p: Playback, now: number): number {
  let position = p.positionMs;
  if (p.status === "playing") position += Math.max(0, now - p.updatedMs);
  if (p.durationMs > 0) position = Math.min(position, p.durationMs);
  return Math.max(0, position);
}

export function fraction(position: number, duration: number): number {
  return duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
}

export type CollapsedView = PillModule;

/**
 * What the closed pill shows: the first module in the user's list that applies. The timer applies while one is running
 * or paused, the song while music plays; the clock and the system readout always apply. If nothing applies it is the clock.
 */
export function collapsedView(a: { pill: readonly PillModule[]; pomodoro: Status; musicStatus: string; hasTrack: boolean }): CollapsedView {
  for (const module of a.pill) {
    if (module === "focus" && a.pomodoro !== "idle") return "focus";
    if (module === "music" && a.hasTrack && a.musicStatus === "playing") return "music";
    if (module === "clock" || module === "system") return module;
  }
  return "clock";
}

export function trackLabel(title: string, artist: string): string {
  if (title && artist) return `${title} \u2014 ${artist}`;
  return title || artist;
}

export interface ClockOptions {
  hour12: Hour12;
  seconds: boolean;
  date: boolean;
}

/** "14:05", "2:05 PM", "14:05:09", "Thu, Nov 19 · 14:05" - follows the system language unless a locale is given. */
export function formatClock(now: number, options: ClockOptions, locale?: string): string {
  const d = new Date(now);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" as const } : {}),
    ...(options.hour12 === "auto" ? {} : { hourCycle: options.hour12 === "24" ? ("h23" as const) : ("h12" as const) }),
  }).format(d);
  if (!options.date) return time;
  const date = new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric" }).format(d);
  return `${date} \u00b7 ${time}`;
}
