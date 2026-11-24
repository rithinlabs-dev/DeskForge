// The app's sections and how to get to them. Pure and unit-tested: no DOM, no React.

export type SectionIcon = "home" | "palette" | "widgets" | "wallpaper" | "images" | "effects" | "island" | "system";
export type SectionGroup = "Home" | "Personalise" | "Device";

export type SectionId = "overview" | "appearance" | "widgets" | "wallpaper" | "images" | "effects" | "island" | "system";

export interface Section {
  id: SectionId;
  /** Short name in the sidebar. */
  label: string;
  /** Large heading at the top of the page. */
  title: string;
  /** One line under the heading. */
  blurb: string;
  group: SectionGroup;
  icon: SectionIcon;
}

export const DEFAULT_SECTION: SectionId = "overview";

export const SECTIONS: readonly Section[] = [
  { id: "overview", label: "Overview", title: "Overview", blurb: "Your desktop at a glance.", group: "Home", icon: "home" },
  { id: "appearance", label: "Appearance", title: "Appearance", blurb: "Colours, shape and type for the whole app. Pick a template or make your own.", group: "Personalise", icon: "palette" },
  { id: "widgets", label: "Widgets", title: "Widgets", blurb: "Add widgets, pin them to your desktop, and give each its own look.", group: "Personalise", icon: "widgets" },
  { id: "wallpaper", label: "Wallpaper", title: "Animated wallpaper", blurb: "Play a video behind your desktop icons, or render one from Blender.", group: "Personalise", icon: "wallpaper" },
  { id: "images", label: "Images", title: "Images and wallpaper", blurb: "Compose layered pictures and use them as your Windows wallpaper.", group: "Personalise", icon: "images" },
  { id: "effects", label: "Effects", title: "Cursor effects", blurb: "Trails and particles that follow your pointer.", group: "Personalise", icon: "effects" },
  { id: "island", label: "Island", title: "Floating island", blurb: "Music, focus timer and quick tools in a pill on your screen.", group: "Personalise", icon: "island" },
  { id: "system", label: "This PC", title: "This PC", blurb: "Live processor, memory and network.", group: "Device", icon: "system" },
];

const GROUP_ORDER: readonly SectionGroup[] = ["Home", "Personalise", "Device"];

export function isSectionId(value: unknown): value is SectionId {
  return typeof value === "string" && SECTIONS.some((s) => s.id === value);
}

export function sectionById(id: SectionId): Section {
  return SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
}

/** The sections in sidebar order, grouped under their headings. */
export function groupedSections(): { group: SectionGroup; items: Section[] }[] {
  return GROUP_ORDER.map((group) => ({ group, items: SECTIONS.filter((s) => s.group === group) })).filter((g) => g.items.length > 0);
}

/** `#/widgets` (or `#widgets`, any case, with a query) -> "widgets". Anything else, including text with no leading #, -> null. */
export function parseHash(hash: string): SectionId | null {
  if (!hash.startsWith("#")) return null;
  const name = hash.slice(1).replace(/^\//, "").split(/[?/#]/)[0].toLowerCase();
  return isSectionId(name) ? name : null;
}

export function hashFor(id: SectionId): string {
  return `#/${id}`;
}

/** Ctrl+1 .. Ctrl+8 jump to the section in that position. */
export function sectionForShortcut(key: string): SectionId | null {
  if (!/^[1-9]$/.test(key)) return null;
  return SECTIONS[Number(key) - 1]?.id ?? null;
}

export function shortcutFor(id: SectionId): string {
  const index = SECTIONS.findIndex((s) => s.id === id);
  return index >= 0 && index < 9 ? String(index + 1) : "";
}

export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  if (hour >= 17 && hour < 22) return "Good evening";
  return "Good night";
}
