// The 36 starter templates. Each row: name, bg, bg2 (gradient end), surface, text, accent, pattern, font, angle, radius.
import { DEFAULT_TOKENS, type FontKey, type PatternKey, type Tokens } from "./shared/tokens";

type Row = [
  name: string, bg: string, bg2: string, surface: string, text: string, accent: string,
  pattern: PatternKey, font?: FontKey, angle?: number, radius?: number,
];

const ROWS: Row[] = [
  ["Liquid Glass", "#04100d", "#0b3b2c", "#0a1a16", "#d8fff0", "#2cf5a0", "aurora", "system", 160, 12],
  ["Particle Field", "#0b0716", "#1d0f3a", "#120c24", "#e8dcff", "#a855f7", "stars"],
  ["Holographic Grid", "#031318", "#06303a", "#07202a", "#c9fbff", "#22d3ee", "grid", "grotesk", 160, 4],
  ["Aurora Theme", "#050b1c", "#0f2a4a", "#0a1530", "#dff3ff", "#3ee0c0", "aurora", "system", 150, 12],
  ["Minimal Glass", "#0d0f14", "#1a1d26", "#151821", "#e6e8ef", "#b8c0d8", "none", "system", 160, 12],
  ["Terminal+", "#020a04", "#04140a", "#061209", "#5dff8c", "#1fe05a", "matrix", "mono", 160, 2],
  ["Monochrome Grid", "#0b0b0b", "#141414", "#101010", "#e8e8e8", "#bdbdbd", "grid", "mono", 160, 2],
  ["Neon Pulse", "#12030c", "#2a0618", "#1a0510", "#ffd6ea", "#ff3d9a", "scan"],
  ["Orbital Rings", "#05060f", "#0b1030", "#0b0e20", "#d9defc", "#7b8cff", "rings"],
  ["Dual Tone", "#04141a", "#1a0f3a", "#081c24", "#d7fbff", "#a855f7", "diagonal", "grotesk", 135],
  ["Dynamic Blur", "#0c0e13", "#1c2030", "#141824", "#dfe3ee", "#9aa5c8", "mesh", "system", 160, 12],
  ["Cyber Noir", "#0a0305", "#1c050a", "#12050a", "#ff6b6b", "#ff2a3d", "diagonal", "mono", 160, 2],
  ["Floating Panels", "#070b12", "#131c2c", "#0d1522", "#dbe7ff", "#6aa8ff", "dots", "system", 160, 12],
  ["Pixel Terminal", "#03100a", "#062014", "#06180f", "#44ff9a", "#00e070", "fine", "mono", 160, 0],
  ["Sakura Theme", "#150a1c", "#3a1540", "#1d0d26", "#ffe3f1", "#ff8fc7", "dots", "humanist", 160, 12],
  ["Ocean Depths", "#031428", "#05325a", "#06213c", "#d4f0ff", "#2aa6ff", "mesh", "system", 180, 8],
  ["Solar Flare", "#120700", "#4a1a00", "#1c0d03", "#ffc27a", "#ff7a1a", "rings", "grotesk", 150],
  ["Forest Tech", "#060f0a", "#12301f", "#0b1a12", "#d6f5e0", "#5bd68a", "fine", "grotesk", 160, 4],
  ["Crystal UI", "#0a0820", "#231a5a", "#120e2e", "#e3dcff", "#8e7bff", "diagonal", "system", 135, 10],
  ["Matrix Flow", "#010a03", "#03180a", "#041208", "#35ff78", "#00ff55", "matrix", "mono", 160, 0],
  ["Hand Drawn", "#0b0d10", "#161a20", "#11141a", "#e9e6dc", "#f0e6c8", "dots", "humanist", 160, 3],
  ["Soft Gradient", "#120a2a", "#3d1a6e", "#1a1038", "#efe4ff", "#c084fc", "mesh", "system", 160, 14],
  ["Glassmorphism+", "#08101f", "#1d3a66", "#101c33", "#e3efff", "#8fb8ff", "mesh", "system", 150, 14],
  ["Grid Lines", "#050a1a", "#0a1638", "#0a1228", "#d9e6ff", "#4f8dff", "grid", "grotesk", 160, 2],
  ["Vaporwave", "#160528", "#5a1260", "#200a38", "#ffd0f0", "#ff6ec7", "horizon", "grotesk", 180],
  ["Arc Reactor", "#031018", "#05303f", "#06202c", "#c8f7ff", "#19d9ff", "rings", "grotesk", 160, 4],
  ["Fluid Morph", "#070b18", "#131c3c", "#0d1226", "#dbe3ff", "#5d7bff", "mesh", "system", 160, 14],
  ["Hex Grid", "#0b0618", "#1c0f40", "#120a28", "#e6d9ff", "#9b6bff", "hex", "grotesk", 160, 4],
  ["Starfield", "#03050f", "#0a1030", "#080c1c", "#dbe4ff", "#6aa0ff", "stars"],
  ["Gradient Mesh", "#120824", "#4a1a7a", "#1a0e34", "#f2e3ff", "#d56bff", "mesh", "system", 160, 12],
  ["Retro 8-bit", "#170a22", "#4a1a30", "#20102e", "#ffb066", "#ff8a3a", "fine", "mono", 180, 0],
  ["Neon Wireframe", "#0a0618", "#240a50", "#120a2a", "#e0cfff", "#b36bff", "diagonal", "grotesk", 160, 2],
  ["Dreamy Clouds", "#0e0a28", "#3a2f8a", "#171238", "#e6e0ff", "#9d8cff", "aurora", "humanist", 160, 16],
  ["Light Trails", "#040a18", "#0a2a55", "#09152e", "#d6ecff", "#2a9dff", "scan", "grotesk", 200],
  ["Digital Blur", "#0a0a1e", "#1f1f5a", "#121230", "#e0e0ff", "#7a7aff", "dots", "system", 160, 12],
  ["Ultra Minimal", "#05070b", "#0a0e16", "#0a0d14", "#e9edf5", "#c9d3e8", "none", "system", 160, 4],
];

export const TEMPLATES: { name: string; tokens: Tokens }[] = ROWS.map(
  ([name, bg, bg2, surface, text, accent, pattern, font = "grotesk", angle = 160, radius = 6]) => ({
    name,
    tokens: { ...DEFAULT_TOKENS, bg, bgStyle: "gradient", bg2, angle, surface, text, accent, pattern, font, radius, space: 14, fontSize: 14 },
  }),
);
