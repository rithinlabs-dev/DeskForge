// Decorative background art for templates. Pure: built only from sanitized tokens and fixed shapes,
// never from user-supplied CSS.
import type { Tokens } from "./tokens";

export const PATTERN_KEYS = [
  "none", "grid", "fine", "dots", "stars", "hex", "scan", "diagonal", "rings", "aurora", "mesh", "matrix", "horizon",
] as const;
export type PatternKey = (typeof PATTERN_KEYS)[number];

export const PATTERN_LABELS: Record<PatternKey, string> = {
  none: "None", grid: "Grid", fine: "Fine grid", dots: "Dots", stars: "Starfield", hex: "Hex grid", scan: "Scanlines",
  diagonal: "Diagonal lines", rings: "Rings", aurora: "Aurora glow", mesh: "Gradient mesh", matrix: "Matrix columns", horizon: "Horizon",
};

export interface Art {
  image: string; // CSS background-image layers
  size: string; // one background-size entry per layer
}

const mix = (p: number) => `color-mix(in srgb, var(--accent) ${p}%, transparent)`;
const soft = (p: number) => `color-mix(in srgb, var(--text) ${p}%, transparent)`;
const full = (n: number) => Array(n).fill("100% 100%").join(", ");

function hexTile(accent: string): string {
  const a = /^#[0-9a-f]{6}$/i.test(accent) ? accent : "#22f57a";
  const poly = (cx: number, cy: number) =>
    `<polygon points='${cx},${cy - 15} ${cx + 13},${cy - 7.5} ${cx + 13},${cy + 7.5} ${cx},${cy + 15} ${cx - 13},${cy + 7.5} ${cx - 13},${cy - 7.5}'/>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='45'><g fill='none' stroke='${a}' stroke-opacity='0.22'>${poly(13, 15)}${poly(0, 37.5)}${poly(26, 37.5)}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export function patternCss(t: Tokens): Art {
  switch (t.pattern) {
    case "grid":
      return { image: `linear-gradient(${mix(6)} 1px, transparent 1px), linear-gradient(90deg, ${mix(6)} 1px, transparent 1px)`, size: "32px 32px, 32px 32px" };
    case "fine":
      return { image: `linear-gradient(${mix(7)} 1px, transparent 1px), linear-gradient(90deg, ${mix(7)} 1px, transparent 1px)`, size: "16px 16px, 16px 16px" };
    case "dots":
      return { image: `radial-gradient(${mix(26)} 1px, transparent 1.6px)`, size: "22px 22px" };
    case "stars":
      return {
        image: [
          `radial-gradient(1px 1px at 20px 30px, ${soft(85)}, transparent)`,
          `radial-gradient(1.4px 1.4px at 90px 120px, ${mix(90)}, transparent)`,
          `radial-gradient(1px 1px at 150px 60px, ${soft(70)}, transparent)`,
          `radial-gradient(1.2px 1.2px at 60px 170px, ${soft(60)}, transparent)`,
        ].join(", "),
        size: "200px 200px, 200px 200px, 200px 200px, 200px 200px",
      };
    case "hex":
      return { image: hexTile(t.accent), size: "26px 45px" };
    case "scan":
      return { image: `repeating-linear-gradient(0deg, transparent 0 2px, ${mix(6)} 2px 3px)`, size: "auto" };
    case "diagonal":
      return { image: `repeating-linear-gradient(45deg, transparent 0 14px, ${mix(8)} 14px 15px)`, size: "auto" };
    case "rings":
      return { image: `repeating-radial-gradient(circle at 85% 18%, transparent 0 26px, ${mix(11)} 26px 27px)`, size: "auto" };
    case "aurora":
      return {
        image: [
          `radial-gradient(60% 45% at 15% 15%, ${mix(28)}, transparent)`,
          `radial-gradient(55% 50% at 85% 25%, ${soft(14)}, transparent)`,
          `radial-gradient(70% 50% at 50% 100%, ${mix(22)}, transparent)`,
        ].join(", "),
        size: full(3),
      };
    case "mesh":
      return {
        image: [
          `radial-gradient(40% 40% at 10% 20%, ${mix(30)}, transparent)`,
          `radial-gradient(35% 45% at 90% 15%, ${soft(14)}, transparent)`,
          `radial-gradient(45% 40% at 75% 90%, ${mix(24)}, transparent)`,
          `radial-gradient(30% 35% at 20% 85%, ${soft(10)}, transparent)`,
        ].join(", "),
        size: full(4),
      };
    case "matrix":
      return {
        image: `repeating-linear-gradient(90deg, transparent 0 15px, ${mix(10)} 15px 16px), repeating-linear-gradient(0deg, transparent 0 7px, ${mix(5)} 7px 8px)`,
        size: "auto, auto",
      };
    case "horizon":
      return {
        image: `radial-gradient(circle at 50% 70%, ${mix(34)} 0 12%, transparent 13%), repeating-linear-gradient(0deg, transparent 0 15px, ${mix(10)} 15px 16px)`,
        size: "100% 100%, auto",
      };
    default:
      return { image: "linear-gradient(transparent, transparent)", size: "auto" };
  }
}
