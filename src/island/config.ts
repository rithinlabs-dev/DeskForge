// Island settings (stored under "island:config"). Rust reads `autostart`, `pauseOnFullscreen` and `position` from the
// same record. Everything here is pure and unit-tested; every value is clamped, so a hand-edited or old record can
// never produce a broken island.
import { FONT_STACKS, type FontKey } from "../shared/tokens";

export const ISLAND_CONFIG_KEY = "island:config";

// ---- the choices -------------------------------------------------------------------------------------------------

export type Anchor =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";
export const ANCHORS: readonly Anchor[] = [
  "top-left", "top-center", "top-right", "middle-left", "middle-right", "bottom-left", "bottom-center", "bottom-right",
];
export const ANCHOR_LABELS: Record<Anchor, string> = {
  "top-left": "Top left", "top-center": "Top centre", "top-right": "Top right",
  "middle-left": "Left edge, middle", "middle-right": "Right edge, middle",
  "bottom-left": "Bottom left", "bottom-center": "Bottom centre", "bottom-right": "Bottom right",
};

export type Tab = "music" | "focus" | "tools";
export const TABS: readonly Tab[] = ["music", "focus", "tools"];
export const TAB_LABELS: Record<Tab, string> = { music: "Music", focus: "Focus", tools: "Tools" };

/** What the collapsed pill can show. The first one in the user's list that applies wins. */
export type PillModule = "focus" | "music" | "clock" | "system";
export const PILL_MODULES: readonly PillModule[] = ["focus", "music", "clock", "system"];
export const PILL_LABELS: Record<PillModule, string> = {
  focus: "Focus timer (while it runs)",
  music: "Current song (while playing)",
  clock: "Clock",
  system: "CPU and memory",
};

export type AnimationKind = "smooth" | "snappy" | "none";
export const ANIMATIONS: readonly AnimationKind[] = ["smooth", "snappy", "none"];
export const ANIMATION_MS: Record<AnimationKind, number> = { smooth: 240, snappy: 120, none: 0 };
export const ANIMATION_LABELS: Record<AnimationKind, string> = { smooth: "Smooth", snappy: "Snappy", none: "None" };

export type Hour12 = "auto" | "12" | "24";

export const FONT_CHOICES: readonly (FontKey | "theme")[] = ["theme", ...(Object.keys(FONT_STACKS) as FontKey[])];

// ---- the shape ---------------------------------------------------------------------------------------------------

export interface IslandPosition {
  anchor: Anchor;
  /** Pixels from the anchored edge (for a centred axis: nudges right/down). */
  x: number;
  y: number;
  /** 0 = main display, 1.. = the others, left to right. */
  monitor: number;
  /** When false, you can drag the island with the mouse. */
  locked: boolean;
}

export interface IslandAppearance {
  /** Overall size multiplier. */
  scale: number;
  /** Width of the closed pill and of the open panel (before scaling). */
  pillWidth: number;
  panelWidth: number;
  bg: string;
  /** A second colour turns the background into a gradient. */
  bg2: string | null;
  bgAngle: number;
  /** Background opacity (text stays solid). */
  opacity: number;
  text: string;
  /** null = follow the app theme's accent colour. */
  accent: string | null;
  radius: number;
  borderWidth: number;
  borderColor: string;
  borderOpacity: number;
  shadow: number;
  /** "theme" = the app theme's font. */
  font: FontKey | "theme";
  animation: AnimationKind;
  /** How faded the closed pill is while nothing is happening (100 = not at all). */
  idleDim: number;
}

export interface IslandContent {
  pill: PillModule[];
  clock: { hour12: Hour12; seconds: boolean; date: boolean };
  tabs: Tab[];
  defaultTab: Tab;
  music: { art: boolean; progress: boolean; volume: boolean; app: boolean };
  focus: { task: boolean; stats: boolean; tips: boolean };
  tools: { meters: boolean; launchers: boolean; launcherCount: number };
}

export interface IslandBehavior {
  hoverExpand: boolean;
  /** Milliseconds the pointer must rest before the panel opens. */
  expandDelay: number;
  /** Milliseconds after the pointer leaves before the panel closes. */
  collapseDelay: number;
  peek: boolean;
  peekMs: number;
}

export interface IslandConfig {
  autostart: boolean;
  pauseOnFullscreen: boolean;
  position: IslandPosition;
  appearance: IslandAppearance;
  content: IslandContent;
  behavior: IslandBehavior;
}

export const DEFAULT_POSITION: IslandPosition = { anchor: "top-center", x: 0, y: 8, monitor: 0, locked: true };

export const DEFAULT_APPEARANCE: IslandAppearance = {
  scale: 1, pillWidth: 300, panelWidth: 420,
  bg: "#0a0c0f", bg2: null, bgAngle: 160, opacity: 100,
  text: "#f2f5f7", accent: null,
  radius: 22, borderWidth: 1, borderColor: "#ffffff", borderOpacity: 10, shadow: 50,
  font: "theme", animation: "smooth", idleDim: 100,
};

export const DEFAULT_CONTENT: IslandContent = {
  pill: ["focus", "music", "clock"],
  clock: { hour12: "auto", seconds: false, date: false },
  tabs: ["music", "focus", "tools"],
  defaultTab: "music",
  music: { art: true, progress: true, volume: true, app: true },
  focus: { task: true, stats: true, tips: true },
  tools: { meters: true, launchers: true, launcherCount: 6 },
};

export const DEFAULT_BEHAVIOR: IslandBehavior = { hoverExpand: true, expandDelay: 140, collapseDelay: 600, peek: true, peekMs: 3500 };

export const DEFAULT_ISLAND: IslandConfig = {
  autostart: false,
  pauseOnFullscreen: true,
  position: DEFAULT_POSITION,
  appearance: DEFAULT_APPEARANCE,
  content: DEFAULT_CONTENT,
  behavior: DEFAULT_BEHAVIOR,
};

// ---- reading saved values safely ---------------------------------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const int = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const dec = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v)) * 100) / 100 : fallback;
const hex = (v: unknown, fallback: string): string => (typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback);
const oneOf = <T extends string>(v: unknown, choices: readonly T[], fallback: T): T =>
  typeof v === "string" && (choices as readonly string[]).includes(v) ? (v as T) : fallback;
/** The valid, unique entries of a saved list, in order; null if it isn't a list at all. */
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T[] | null =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is T => typeof x === "string" && (allowed as readonly string[]).includes(x)))] : null;

export function sanitizePosition(raw: unknown): IslandPosition {
  const r = rec(raw);
  return {
    anchor: oneOf(r.anchor, ANCHORS, DEFAULT_POSITION.anchor),
    x: int(r.x, -2000, 2000, DEFAULT_POSITION.x),
    y: int(r.y, -2000, 2000, DEFAULT_POSITION.y),
    monitor: int(r.monitor, 0, 16, 0),
    locked: bool(r.locked, DEFAULT_POSITION.locked),
  };
}

export function sanitizeAppearance(raw: unknown): IslandAppearance {
  const r = rec(raw);
  const d = DEFAULT_APPEARANCE;
  return {
    scale: dec(r.scale, 0.6, 1.8, d.scale),
    pillWidth: int(r.pillWidth, 160, 520, d.pillWidth),
    panelWidth: int(r.panelWidth, 320, 640, d.panelWidth),
    bg: hex(r.bg, d.bg),
    bg2: typeof r.bg2 === "string" && HEX.test(r.bg2) ? r.bg2.toLowerCase() : null,
    bgAngle: int(r.bgAngle, 0, 360, d.bgAngle),
    opacity: int(r.opacity, 20, 100, d.opacity),
    text: hex(r.text, d.text),
    accent: typeof r.accent === "string" && HEX.test(r.accent) ? r.accent.toLowerCase() : null,
    radius: int(r.radius, 0, 40, d.radius),
    borderWidth: int(r.borderWidth, 0, 6, d.borderWidth),
    borderColor: hex(r.borderColor, d.borderColor),
    borderOpacity: int(r.borderOpacity, 0, 100, d.borderOpacity),
    shadow: int(r.shadow, 0, 100, d.shadow),
    font: oneOf(r.font, FONT_CHOICES, d.font),
    animation: oneOf(r.animation, ANIMATIONS, d.animation),
    idleDim: int(r.idleDim, 20, 100, d.idleDim),
  };
}

export function sanitizeContent(raw: unknown): IslandContent {
  const r = rec(raw);
  const d = DEFAULT_CONTENT;
  const pill = pick(r.pill, PILL_MODULES);
  const tabs = pick(r.tabs, TABS);
  const shownTabs: Tab[] = tabs && tabs.length > 0 ? tabs : [...d.tabs];
  const clock = rec(r.clock);
  const music = rec(r.music);
  const focus = rec(r.focus);
  const tools = rec(r.tools);
  return {
    pill: pill && pill.length > 0 ? pill : [...d.pill],
    clock: {
      hour12: oneOf(clock.hour12, ["auto", "12", "24"] as const, d.clock.hour12),
      seconds: bool(clock.seconds, d.clock.seconds),
      date: bool(clock.date, d.clock.date),
    },
    tabs: shownTabs,
    defaultTab: oneOf(r.defaultTab, shownTabs, shownTabs[0]),
    music: {
      art: bool(music.art, d.music.art),
      progress: bool(music.progress, d.music.progress),
      volume: bool(music.volume, d.music.volume),
      app: bool(music.app, d.music.app),
    },
    focus: {
      task: bool(focus.task, d.focus.task),
      stats: bool(focus.stats, d.focus.stats),
      tips: bool(focus.tips, d.focus.tips),
    },
    tools: {
      meters: bool(tools.meters, d.tools.meters),
      launchers: bool(tools.launchers, d.tools.launchers),
      launcherCount: int(tools.launcherCount, 0, 12, d.tools.launcherCount),
    },
  };
}

export function sanitizeBehavior(raw: unknown, legacy: Record<string, unknown> = {}): IslandBehavior {
  const r = rec(raw);
  const d = DEFAULT_BEHAVIOR;
  return {
    hoverExpand: bool(r.hoverExpand !== undefined ? r.hoverExpand : legacy.hoverExpand, d.hoverExpand),
    expandDelay: int(r.expandDelay, 0, 1500, d.expandDelay),
    collapseDelay: int(r.collapseDelay, 100, 5000, d.collapseDelay),
    peek: bool(r.peek !== undefined ? r.peek : legacy.peek, d.peek),
    peekMs: int(r.peekMs, 1000, 15000, d.peekMs),
  };
}

/** Reads a saved island record. Older records (before customisation existed) are upgraded, never rejected. */
export function sanitizeIslandConfig(raw: unknown): IslandConfig {
  const r = rec(raw);
  const savedContent = rec(r.content);
  // the first version had one choice: "collapsed": "clock" meant the pill always showed the clock
  const content = sanitizeContent(savedContent.pill === undefined && r.collapsed === "clock" ? { ...savedContent, pill: ["clock"] } : savedContent);
  return {
    autostart: bool(r.autostart, DEFAULT_ISLAND.autostart),
    pauseOnFullscreen: bool(r.pauseOnFullscreen, DEFAULT_ISLAND.pauseOnFullscreen),
    position: sanitizePosition(r.position),
    appearance: sanitizeAppearance(r.appearance),
    content,
    behavior: sanitizeBehavior(r.behavior, r),
  };
}

// ---- derived values ----------------------------------------------------------------------------------------------

/** Window sizes in logical pixels for the closed pill and the open panel. The page asks Rust for these. */
export function islandSizes(a: IslandAppearance): { collapsed: { width: number; height: number }; open: { width: number; height: number } } {
  const scaled = (v: number) => Math.round(v * a.scale);
  return {
    collapsed: { width: scaled(a.pillWidth + 20), height: scaled(56) },
    open: { width: scaled(a.panelWidth + 20), height: scaled(268) },
  };
}

export function anchorParts(anchor: Anchor): { v: "top" | "middle" | "bottom"; h: "left" | "center" | "right" } {
  const [v, h] = anchor.split("-") as ["top" | "middle" | "bottom", "left" | "center" | "right"];
  return { v, h };
}

/** New offsets after the pointer moved by (dx, dy), so the island follows the pointer whichever edge it hangs from. */
export function dragOffsets(anchor: Anchor, start: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  const { v, h } = anchorParts(anchor);
  const clamp = (n: number) => Math.min(2000, Math.max(-2000, Math.round(n)));
  return {
    x: clamp(h === "right" ? start.x - dx : start.x + dx),
    y: clamp(v === "bottom" ? start.y - dy : start.y + dy),
  };
}

/** Moves one entry of a list up (-1) or down (+1). Out-of-range moves return a copy unchanged. */
export function moveItem<T>(items: readonly T[], index: number, delta: number): T[] {
  const to = index + delta;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}
