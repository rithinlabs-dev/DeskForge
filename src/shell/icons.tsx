import type { SectionIcon } from "./nav";

export type IconName = SectionIcon | "chevron-left" | "chevron-right" | "undo" | "redo" | "menu" | "arrow" | "play" | "pulse";

// Simple outline icons on a 24x24 grid, drawn with the current text colour.
const PATHS: Record<IconName, string> = {
  home: "M3 11.5 12 4l9 7.5M5.5 10v9.5h4.5v-5.5h4v5.5h4.5V10",
  palette: "M12 3.5a8.5 8.5 0 1 0 0 17c1.1 0 1.9-.8 1.9-1.8 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17A4 4 0 0 0 21 8.5C21 5.6 16.9 3.5 12 3.5zM7.5 11.5h.01M10 8h.01M14.5 8h.01",
  widgets: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  wallpaper: "M4 5h16v14H4zM4 16l4.5-4.5 4 4 2.5-2.5 5 5M16 9.5h.01",
  images: "M12 3 3 8l9 5 9-5-9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5",
  effects: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z",
  island: "M7 8h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8zM8.5 12h.01",
  system: "M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
  "chevron-left": "M15 6l-6 6 6 6",
  "chevron-right": "M9 6l6 6-6 6",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  menu: "M4 6h16M4 12h16M4 18h16",
  arrow: "M5 12h14M13 6l6 6-6 6",
  play: "M8 5v14l11-7z",
  pulse: "M3 12h4l2.5-6 4 12 2.5-6H21",
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}
