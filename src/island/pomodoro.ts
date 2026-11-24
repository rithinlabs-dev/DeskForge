// Pomodoro timer logic for the floating island. Pure and unit-tested: no timers, no DOM.
//
// The state stores the moment the current phase ends (`endsAt`), not a countdown, so it stays right when the window is
// hidden or throttled and when the app is restarted. The page just asks `remaining(state, now)` as often as it likes.

export type Phase = "focus" | "short" | "long";
export type Status = "idle" | "running" | "paused";

export interface PomodoroConfig {
  focusMin: number;
  shortMin: number;
  longMin: number;
  /** A long break after this many focus sessions. */
  longEvery: number;
  /** Start the next phase by itself when one ends. */
  autoStart: boolean;
  /** A short beep when a phase ends. */
  sound: boolean;
}

export const DEFAULT_POMODORO: PomodoroConfig = { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStart: false, sound: true };
export const POMODORO_CONFIG_KEY = "island:pomodoro-config";
export const POMODORO_STATE_KEY = "island:pomodoro";
export const MAX_TASK = 80;

const clampInt = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

export function sanitizePomodoroConfig(raw: unknown): PomodoroConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    focusMin: clampInt(r.focusMin, 1, 180, DEFAULT_POMODORO.focusMin),
    shortMin: clampInt(r.shortMin, 1, 60, DEFAULT_POMODORO.shortMin),
    longMin: clampInt(r.longMin, 1, 120, DEFAULT_POMODORO.longMin),
    longEvery: clampInt(r.longEvery, 2, 12, DEFAULT_POMODORO.longEvery),
    autoStart: typeof r.autoStart === "boolean" ? r.autoStart : DEFAULT_POMODORO.autoStart,
    sound: typeof r.sound === "boolean" ? r.sound : DEFAULT_POMODORO.sound,
  };
}

export interface PomodoroState {
  phase: Phase;
  status: Status;
  /** Unix ms when the running phase ends (0 unless running). */
  endsAt: number;
  /** Time left when not running (the full phase when idle). */
  remainingMs: number;
  /** Focus sessions finished in the current set (resets after a long break). */
  cycle: number;
  /** What the user is working on. */
  task: string;
  /** The local day (yyyy-mm-dd) the two counters below belong to. */
  day: string;
  todayFocus: number;
  todayMinutes: number;
}

/** The local calendar day of a timestamp, as yyyy-mm-dd. */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function phaseMs(phase: Phase, cfg: PomodoroConfig): number {
  const minutes = phase === "focus" ? cfg.focusMin : phase === "short" ? cfg.shortMin : cfg.longMin;
  return minutes * 60_000;
}

export function initialState(cfg: PomodoroConfig, now: number): PomodoroState {
  return { phase: "focus", status: "idle", endsAt: 0, remainingMs: phaseMs("focus", cfg), cycle: 0, task: "", day: dayKey(now), todayFocus: 0, todayMinutes: 0 };
}

/** A new day starts the daily counters from zero. */
export function rollDay(s: PomodoroState, now: number): PomodoroState {
  const today = dayKey(now);
  return s.day === today ? s : { ...s, day: today, todayFocus: 0, todayMinutes: 0 };
}

/** Reads saved state defensively: anything odd falls back to a fresh, idle timer. */
export function sanitizePomodoroState(raw: unknown, cfg: PomodoroConfig, now: number): PomodoroState {
  const base = initialState(cfg, now);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;
  const phase: Phase = r.phase === "short" || r.phase === "long" ? r.phase : "focus";
  const endsAt = typeof r.endsAt === "number" && Number.isFinite(r.endsAt) ? r.endsAt : 0;
  const wanted = r.status === "running" || r.status === "paused" ? r.status : "idle";
  const status: Status = wanted === "running" && endsAt <= 0 ? "paused" : wanted;
  const remainingMs = clampInt(r.remainingMs, 0, 24 * 3600_000, phaseMs(phase, cfg));
  return rollDay(
    {
      phase,
      status,
      endsAt: status === "running" ? endsAt : 0,
      remainingMs: status === "idle" ? phaseMs(phase, cfg) : remainingMs,
      cycle: clampInt(r.cycle, 0, 99, 0),
      task: typeof r.task === "string" ? r.task.slice(0, MAX_TASK) : "",
      day: typeof r.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : dayKey(now),
      todayFocus: clampInt(r.todayFocus, 0, 9999, 0),
      todayMinutes: clampInt(r.todayMinutes, 0, 99999, 0),
    },
    now,
  );
}

export function remaining(s: PomodoroState, now: number): number {
  return s.status === "running" ? Math.max(0, s.endsAt - now) : s.remainingMs;
}

/** 0 at the start of a phase, 1 at the end. */
export function progress(s: PomodoroState, cfg: PomodoroConfig, now: number): number {
  const total = phaseMs(s.phase, cfg);
  return total > 0 ? Math.min(1, Math.max(0, 1 - remaining(s, now) / total)) : 0;
}

export function start(s: PomodoroState, cfg: PomodoroConfig, now: number): PomodoroState {
  if (s.status === "running") return s;
  const rolled = rollDay(s, now);
  const left = rolled.remainingMs > 0 ? rolled.remainingMs : phaseMs(rolled.phase, cfg);
  return { ...rolled, status: "running", remainingMs: left, endsAt: now + left };
}

export function pause(s: PomodoroState, now: number): PomodoroState {
  if (s.status !== "running") return s;
  return { ...s, status: "paused", remainingMs: remaining(s, now), endsAt: 0 };
}

/** Back to a fresh focus session. The task and today's counters stay. */
export function reset(s: PomodoroState, cfg: PomodoroConfig, now: number): PomodoroState {
  const rolled = rollDay(s, now);
  return { ...rolled, phase: "focus", status: "idle", endsAt: 0, remainingMs: phaseMs("focus", cfg), cycle: 0 };
}

export function setTask(s: PomodoroState, task: string): PomodoroState {
  const clean = task.slice(0, MAX_TASK);
  return clean === s.task ? s : { ...s, task: clean };
}

/** Changing the durations updates an idle timer straight away; a running or paused one keeps its time. */
export function applyConfig(s: PomodoroState, cfg: PomodoroConfig): PomodoroState {
  if (s.status !== "idle") return s;
  const ms = phaseMs(s.phase, cfg);
  return ms === s.remainingMs ? s : { ...s, remainingMs: ms };
}

function nextPhaseAfter(phase: Phase, focusDone: number, cfg: PomodoroConfig): Phase {
  if (phase !== "focus") return "focus";
  return focusDone % cfg.longEvery === 0 ? "long" : "short";
}

function enter(s: PomodoroState, phase: Phase, cycle: number, run: boolean, cfg: PomodoroConfig, now: number): PomodoroState {
  const ms = phaseMs(phase, cfg);
  return { ...s, phase, cycle, status: run ? "running" : "idle", endsAt: run ? now + ms : 0, remainingMs: ms };
}

/** Skips to the next phase without counting the one skipped. Keeps running if it was running. */
export function skip(s: PomodoroState, cfg: PomodoroConfig, now: number): PomodoroState {
  const rolled = rollDay(s, now);
  const run = rolled.status === "running";
  if (rolled.phase === "focus") return enter(rolled, "short", rolled.cycle, run, cfg, now);
  return enter(rolled, "focus", rolled.phase === "long" ? 0 : rolled.cycle, run, cfg, now);
}

/** Advances a running timer whose phase has ended. `completed` is the phase that just finished, if any. */
export function tick(s: PomodoroState, cfg: PomodoroConfig, now: number): { state: PomodoroState; completed: Phase | null } {
  const rolled = rollDay(s, now);
  if (rolled.status !== "running" || now < rolled.endsAt) return { state: rolled, completed: null };
  const completed = rolled.phase;
  if (completed === "focus") {
    const done = rolled.cycle + 1;
    const counted = { ...rolled, todayFocus: rolled.todayFocus + 1, todayMinutes: rolled.todayMinutes + cfg.focusMin };
    return { state: enter(counted, nextPhaseAfter("focus", done, cfg), done, cfg.autoStart, cfg, now), completed };
  }
  return { state: enter(rolled, "focus", completed === "long" ? 0 : rolled.cycle, cfg.autoStart, cfg, now), completed };
}

export const PHASE_LABEL: Record<Phase, string> = { focus: "Focus", short: "Short break", long: "Long break" };

const BREAK_TIPS = [
  "Stand up and stretch your back.",
  "Look at something far away for 20 seconds.",
  "Drink a glass of water.",
  "Roll your shoulders and unclench your jaw.",
  "Walk to another room and back.",
  "Take five slow breaths.",
];

/** A break suggestion that changes from break to break but is stable while one break is showing. */
export function breakTip(s: PomodoroState): string {
  return BREAK_TIPS[(s.todayFocus + s.cycle) % BREAK_TIPS.length];
}
