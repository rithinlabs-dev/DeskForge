import { describe, expect, it } from "vitest";
import {
  DEFAULT_POMODORO, applyConfig, breakTip, initialState, pause, phaseMs, progress, remaining, reset, sanitizePomodoroConfig,
  sanitizePomodoroState, setTask, skip, start, tick, type PomodoroConfig, type PomodoroState,
} from "./pomodoro";

const NOW = new Date(2026, 10, 19, 10, 0, 0).getTime();
const MIN = 60_000;
const cfg: PomodoroConfig = DEFAULT_POMODORO;

describe("pomodoro config", () => {
  it("clamps durations and falls back to defaults", () => {
    expect(sanitizePomodoroConfig({ focusMin: 0, shortMin: 999, longMin: 5.4, longEvery: 1 })).toMatchObject({ focusMin: 1, shortMin: 60, longMin: 5, longEvery: 2 });
    expect(sanitizePomodoroConfig({ focusMin: "soon", autoStart: "yes" })).toEqual(DEFAULT_POMODORO);
    expect(sanitizePomodoroConfig(null)).toEqual(DEFAULT_POMODORO);
  });
});

describe("pomodoro timer", () => {
  it("starts idle with a full focus session", () => {
    const s = initialState(cfg, NOW);
    expect(s).toMatchObject({ phase: "focus", status: "idle", remainingMs: 25 * MIN, cycle: 0, todayFocus: 0 });
  });

  it("counts down from the moment it starts, and keeps its time across a pause", () => {
    let s = start(initialState(cfg, NOW), cfg, NOW);
    expect(s.status).toBe("running");
    expect(remaining(s, NOW + 5 * MIN)).toBe(20 * MIN);
    s = pause(s, NOW + 10 * MIN);
    expect(s).toMatchObject({ status: "paused", remainingMs: 15 * MIN, endsAt: 0 });
    expect(remaining(s, NOW + 99 * MIN)).toBe(15 * MIN); // a paused timer doesn't move
    s = start(s, cfg, NOW + 20 * MIN);
    expect(s.endsAt).toBe(NOW + 35 * MIN);
  });

  it("starting twice or pausing an idle timer changes nothing", () => {
    const running = start(initialState(cfg, NOW), cfg, NOW);
    expect(start(running, cfg, NOW + 1000)).toBe(running);
    const idle = initialState(cfg, NOW);
    expect(pause(idle, NOW)).toBe(idle);
  });

  it("reports progress from 0 to 1", () => {
    const s = start(initialState(cfg, NOW), cfg, NOW);
    expect(progress(s, cfg, NOW)).toBe(0);
    expect(progress(s, cfg, NOW + 12.5 * MIN)).toBeCloseTo(0.5, 9);
    expect(progress(s, cfg, NOW + 999 * MIN)).toBe(1);
  });

  it("does nothing before the phase ends, or while paused", () => {
    const running = start(initialState(cfg, NOW), cfg, NOW);
    expect(tick(running, cfg, running.endsAt - 1).completed).toBeNull();
    const paused = pause(running, NOW + MIN);
    expect(tick(paused, cfg, NOW + 999 * MIN).completed).toBeNull();
  });

  it("finishing a focus session counts it and waits for you to start the break", () => {
    const running = start(initialState(cfg, NOW), cfg, NOW);
    const { state, completed } = tick(running, cfg, running.endsAt);
    expect(completed).toBe("focus");
    expect(state).toMatchObject({ phase: "short", status: "idle", cycle: 1, todayFocus: 1, todayMinutes: 25, remainingMs: 5 * MIN });
  });

  it("with auto-start the next phase begins by itself", () => {
    const auto = { ...cfg, autoStart: true };
    const running = start(initialState(auto, NOW), auto, NOW);
    const at = running.endsAt + 3000; // noticed a few seconds late
    const { state } = tick(running, auto, at);
    expect(state).toMatchObject({ phase: "short", status: "running", endsAt: at + 5 * MIN });
  });

  it("takes a long break after every fourth focus session, then starts a new set", () => {
    let s = initialState(cfg, NOW);
    let now = NOW;
    for (let i = 1; i <= 4; i++) {
      s = start(s, cfg, now);
      now = s.endsAt;
      s = tick(s, cfg, now).state;
      expect(s.phase).toBe(i < 4 ? "short" : "long");
      s = start(s, cfg, now);
      now = s.endsAt;
      s = tick(s, cfg, now).state;
      expect(s.phase).toBe("focus");
    }
    expect(s).toMatchObject({ cycle: 0, todayFocus: 4, todayMinutes: 100 });
  });

  it("skipping moves on without counting", () => {
    const running = start(initialState(cfg, NOW), cfg, NOW);
    const skipped = skip(running, cfg, NOW + MIN);
    expect(skipped).toMatchObject({ phase: "short", status: "running", cycle: 0, todayFocus: 0 });
    expect(skip(initialState(cfg, NOW), cfg, NOW)).toMatchObject({ phase: "short", status: "idle" });
    expect(skip({ ...skipped, phase: "short", cycle: 2 }, cfg, NOW)).toMatchObject({ phase: "focus", cycle: 2 });
    expect(skip({ ...skipped, phase: "long", cycle: 4 }, cfg, NOW)).toMatchObject({ phase: "focus", cycle: 0 });
  });

  it("reset goes back to a fresh focus session but keeps the task and today's counters", () => {
    let s = setTask(initialState(cfg, NOW), "write report");
    s = { ...s, phase: "long", status: "running", endsAt: NOW + MIN, cycle: 3, todayFocus: 5, todayMinutes: 125 };
    expect(reset(s, cfg, NOW)).toMatchObject({ phase: "focus", status: "idle", endsAt: 0, remainingMs: 25 * MIN, cycle: 0, task: "write report", todayFocus: 5, todayMinutes: 125 });
  });

  it("a new day starts the daily counters from zero", () => {
    const yesterday: PomodoroState = { ...initialState(cfg, NOW), day: "2026-11-18", todayFocus: 3, todayMinutes: 75 };
    expect(tick(yesterday, cfg, NOW).state).toMatchObject({ day: "2026-11-19", todayFocus: 0, todayMinutes: 0 });
    // a session that ends after midnight counts toward the new day
    const overnight: PomodoroState = { ...yesterday, status: "running", endsAt: NOW - 1000, remainingMs: 1000 };
    expect(tick(overnight, cfg, NOW).state).toMatchObject({ day: "2026-11-19", todayFocus: 1, todayMinutes: 25 });
  });

  it("changing the durations updates an idle timer only", () => {
    const longer = { ...cfg, focusMin: 50 };
    expect(applyConfig(initialState(cfg, NOW), longer).remainingMs).toBe(50 * MIN);
    const paused = pause(start(initialState(cfg, NOW), cfg, NOW), NOW + MIN);
    expect(applyConfig(paused, longer)).toBe(paused);
    expect(phaseMs("long", longer)).toBe(15 * MIN);
  });

  it("limits the task text and ignores an unchanged task", () => {
    const s = initialState(cfg, NOW);
    expect(setTask(s, "x".repeat(500)).task).toHaveLength(80);
    const named = setTask(s, "report");
    expect(setTask(named, "report")).toBe(named);
  });

  it("suggests a break activity", () => {
    const s = initialState(cfg, NOW);
    expect(breakTip(s).length).toBeGreaterThan(5);
    expect(breakTip(s)).toBe(breakTip(s));
    expect(breakTip({ ...s, todayFocus: 1 })).not.toBe(breakTip(s));
  });
});

describe("reading saved pomodoro state", () => {
  it("falls back to a fresh timer for anything unusable", () => {
    for (const bad of [null, undefined, 5, "x", []]) {
      expect(sanitizePomodoroState(bad, cfg, NOW)).toEqual(initialState(cfg, NOW));
    }
  });

  it("keeps a running timer, but a running timer with no end time becomes paused", () => {
    const running = sanitizePomodoroState({ phase: "short", status: "running", endsAt: NOW + MIN, remainingMs: 5 * MIN, day: "2026-11-19" }, cfg, NOW);
    expect(running).toMatchObject({ phase: "short", status: "running", endsAt: NOW + MIN });
    const broken = sanitizePomodoroState({ status: "running", endsAt: 0, remainingMs: 7 * MIN, day: "2026-11-19" }, cfg, NOW);
    expect(broken).toMatchObject({ status: "paused", endsAt: 0, remainingMs: 7 * MIN });
  });

  it("an idle timer always shows the full phase for the current settings", () => {
    const s = sanitizePomodoroState({ phase: "focus", status: "idle", remainingMs: 3 * MIN }, { ...cfg, focusMin: 40 }, NOW);
    expect(s.remainingMs).toBe(40 * MIN);
  });

  it("trims the task, clamps counters and rolls an old day over", () => {
    const s = sanitizePomodoroState({ task: "y".repeat(300), todayFocus: -4, todayMinutes: 1e9, day: "2020-01-01", cycle: 500 }, cfg, NOW);
    expect(s.task).toHaveLength(80);
    expect(s.day).toBe("2026-11-19");
    expect(s.todayFocus).toBe(0);
    expect(s.cycle).toBe(99);
  });
});
