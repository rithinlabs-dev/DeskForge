// App-side token helpers: re-exports the shared schema, builds the template list, applies tokens to the DOM.
import { DEFAULT_TOKENS, themeCssVars, type Tokens } from "./shared/tokens";
import { TEMPLATES } from "./templates";

export * from "./shared/tokens";

const DAYLIGHT: Tokens = {
  bg: "#e6ebef", bgStyle: "solid", bg2: "#c9d6e3", angle: 160, pattern: "none", surface: "#f6f8fa",
  text: "#16202a", accent: "#2a6df4", radius: 10, space: 16, fontSize: 15, font: "system",
};

export const PRESETS: { name: string; tokens: Tokens }[] = [
  { name: "DeskForge", tokens: DEFAULT_TOKENS },
  ...TEMPLATES,
  { name: "Daylight", tokens: DAYLIGHT },
];

export function applyTokens(t: Tokens, el: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(themeCssVars(t))) el.style.setProperty(name, value);
}
