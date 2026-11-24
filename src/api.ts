// Typed wrappers over the Tauri commands. The UI never calls invoke directly.
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GlassEffect, GlassKind } from "./widgets/appearance";
import type { GlassDiagnostics } from "./widgets/glassWizard";
import type { BackdropGeometry } from "./widgets/backdrop";
import type { WidgetElementInfo, WidgetLayout } from "./widgets/layout";

export interface WidgetLayoutEditorSession {
  widgetId: string;
  elements: WidgetElementInfo[];
  selectedId: string;
}

export interface SystemSnapshot {
  timestampMs: number;
  cpuPercent: number;
  memUsed: number;
  memTotal: number;
  netRxBytes: number;
  netTxBytes: number;
}

export interface AppEntry {
  id: string;
  name: string;
  path: string;
}

export interface Theme {
  id: number;
  name: string;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface MediaItem { id: string; name: string; file: string; kind: string; size: number; addedMs: number; source: string }
export interface WallpaperStatus { running: boolean; mode: string; activeId: string | null }
export interface WallpaperStart { mode: string; message: string }
export interface BlenderOpts {
  width: number; height: number; fps: number;
  quality: "LOW" | "MEDIUM" | "HIGH"; engine: "default" | "cycles"; samples: number | null;
}

export interface FxCursor { x: number; y: number; suspended: boolean }

/** What the media player (Spotify or any other) is playing. Mirrors `nowplaying::NowPlaying` in Rust. */
export interface NowPlaying {
  available: boolean;
  app: string;
  title: string;
  artist: string;
  album: string;
  status: "playing" | "paused" | "stopped" | "none";
  positionMs: number;
  durationMs: number;
  art: string | null;
  canPlayPause: boolean;
  canNext: boolean;
  canPrevious: boolean;
  /** Unix ms when positionMs was true. */
  updatedMs: number;
}
export type MediaControl = "play_pause" | "next" | "previous";
export interface FxCursorBatch { samples: { x: number; y: number; t: number }[]; now: number; x: number; y: number; suspended: boolean }
export interface ImageItem { id: string; name: string; file: string; kind: string; size: number; addedMs: number }
export interface GlassEffectEvent { id: string; effect: GlassEffect | "unavailable"; error: string | null }

export interface BackdropWallpaper { path: string; key: string }

export const api = {
  system: {
    snapshot: () => invoke<SystemSnapshot>("get_snapshot"),
    setPollingVisible: (visible: boolean) => invoke<void>("set_polling_visible", { visible }),
    setPollInterval: (ms: number) => invoke<void>("set_poll_interval", { ms }),
    onSnapshot: (cb: (s: SystemSnapshot) => void): Promise<UnlistenFn> =>
      listen<SystemSnapshot>("system://snapshot", (e) => cb(e.payload)),
  },
  wallpaper: {
    /** Legacy: set a static image as the Windows wallpaper. */
    set: (path: string) => invoke<void>("set_wallpaper", { path }),
    start: (id: string) => invoke<WallpaperStart>("wallpaper_start", { id }),
    stop: () => invoke<void>("wallpaper_stop"),
    status: () => invoke<WallpaperStatus>("wallpaper_status"),
    onState: (cb: (running: boolean, mode: string) => void): Promise<UnlistenFn> =>
      listen<{ running: boolean; mode?: string }>("wallpaper://state", (e) => cb(e.payload.running, e.payload.mode ?? "")),
    onSuspend: (cb: (suspended: boolean, reason: string) => void): Promise<UnlistenFn> =>
      listen<{ suspended: boolean; reason: string }>("wallpaper://suspend", (e) => cb(e.payload.suspended, e.payload.reason)),
    onError: (cb: (message: string) => void): Promise<UnlistenFn> => listen<string>("wallpaper://error", (e) => cb(e.payload)),
  },
  /** Frosted-wallpaper glass (desktop widget windows only). */
  backdrop: {
    /** DeskForge's copy of the current Windows wallpaper; `key` changes when the wallpaper does. */
    wallpaper: () => invoke<BackdropWallpaper>("backdrop_wallpaper"),
    /** Where this widget window sits on its monitor, in physical pixels. */
    geometry: () => invoke<BackdropGeometry>("backdrop_geometry"),
  },
  media: {
    list: () => invoke<MediaItem[]>("media_list"),
    /** Native file picker; the app never sees the original path. */
    importVideo: () => invoke<MediaItem | null>("media_import_video"),
    remove: (id: string) => invoke<void>("media_remove", { id }),
  },
  images: {
    list: () => invoke<ImageItem[]>("image_list"),
    /** Native file picker; validated by extension and file signature. Resolves null if cancelled. */
    importImage: () => invoke<ImageItem | null>("image_import"),
    remove: (id: string) => invoke<void>("image_remove", { id }),
    /** The image as a data: URL (never taints a canvas). */
    data: (id: string) => invoke<string>("image_data", { id }),
    /** Adds a PNG (base64, no data: prefix) to the library, for example a picture with its background removed. */
    savePng: (name: string, png: string) => invoke<ImageItem>("image_save_png", { name, png }),
  },
  compose: {
    /** `png` is the base64 of a PNG (no data: prefix). Saves it and makes it the Windows wallpaper. */
    setWallpaper: (png: string) => invoke<string>("compose_set_wallpaper", { png }),
    /** Puts back the wallpaper that was in place before DeskForge first replaced it. Resolves the restored file's name. */
    restoreWallpaper: () => invoke<string>("compose_restore_wallpaper"),
  },
  /** The floating island (the pill at the top of the screen). */
  island: {
    start: () => invoke<void>("island_start"),
    stop: () => invoke<void>("island_stop"),
    status: () => invoke<boolean>("island_status"),
    onState: (cb: (running: boolean) => void): Promise<UnlistenFn> =>
      listen<{ running: boolean }>("island://state", (e) => cb(e.payload.running)),
    /** Island window: ask for the size the page needs (logical pixels) and where it sits; the window follows. */
    resize: (width: number, height: number, anchor: string, offsetX: number, offsetY: number, monitor: number) =>
      invoke<void>("island_resize", { width, height, anchor, offsetX, offsetY, monitor }),
    /** Names of the connected monitors, main display first (for the position picker). */
    monitors: () => invoke<string[]>("island_monitors"),
    /** Island window: hides it while a fullscreen app runs. Resolves whether it is hidden now. */
    tick: () => invoke<boolean>("island_tick"),
    /** Island window: press the system volume key. */
    volume: (action: "up" | "down" | "mute") => invoke<void>("island_volume", { action }),
  },
  nowPlaying: {
    state: () => invoke<NowPlaying>("nowplaying_state"),
    /** Island window: press play/pause, next or previous on the current player. */
    control: (action: MediaControl) => invoke<void>("nowplaying_control", { action }),
    onChange: (cb: (state: NowPlaying) => void): Promise<UnlistenFn> =>
      listen<NowPlaying>("nowplaying://state", (e) => cb(e.payload)),
  },
  fx: {
    start: () => invoke<void>("fx_start"),
    stop: () => invoke<void>("fx_stop"),
    status: () => invoke<boolean>("fx_status"),
    /** Overlay window only: the global cursor position in physical pixels, relative to the overlay. */
    cursor: () => invoke<FxCursor>("fx_cursor"),
    /** Every cursor change since the last call, timestamped by Rust's sampler (overlay window only). */
    cursorBatch: () => invoke<FxCursorBatch>("fx_cursor_batch"),
    onState: (cb: (running: boolean) => void): Promise<UnlistenFn> =>
      listen<{ running: boolean }>("fx://state", (e) => cb(e.payload.running)),
  },
  blender: {
    detect: () => invoke<string | null>("blender_detect"),
    setPath: () => invoke<string | null>("blender_set_path"),
    /** Opens a native picker for the .blend, then renders it in the background. Resolves its name, or null if cancelled. */
    render: (opts: BlenderOpts) => invoke<string | null>("blender_render_start", { opts }),
    cancel: () => invoke<void>("blender_cancel"),
    onProgress: (cb: (frame: number, total: number) => void): Promise<UnlistenFn> =>
      listen<{ frame: number; total: number }>("blender://progress", (e) => cb(e.payload.frame, e.payload.total)),
    onDone: (cb: (ok: boolean, error: string | null) => void): Promise<UnlistenFn> =>
      listen<{ ok: boolean; error: string | null }>("blender://done", (e) => cb(e.payload.ok, e.payload.error)),
  },
  launcher: {
    list: () => invoke<AppEntry[]>("launcher_list"),
    register: (name: string, path: string) => invoke<AppEntry>("launcher_register", { name, path }),
    remove: (id: string) => invoke<void>("launcher_remove", { id }),
    launch: (id: string) => invoke<void>("launcher_launch", { id }),
  },
  settings: {
    get: <T = unknown>(key: string) => invoke<T | null>("settings_get", { key }),
    set: (key: string, value: unknown) => invoke<void>("settings_set", { key, value }),
    /** Fires in every window whenever a setting is written (by key). */
    onChanged: (cb: (key: string) => void): Promise<UnlistenFn> =>
      listen<string>("settings://changed", (e) => cb(e.payload)),
  },
  /** Per-widget private data. Desktop widget windows can only reach their own. */
  widgetStore: {
    load: (id: string) => invoke<Record<string, unknown>>("widget_store_load", { id }),
    save: (id: string, data: Record<string, unknown>) => invoke<void>("widget_store_save", { id, data }),
  },
  desktop: {
    list: () => invoke<string[]>("desktop_list"),
    pin: (id: string, width: number, height: number) => invoke<void>("desktop_pin", { id, width, height }),
    unpin: (id: string) => invoke<void>("desktop_unpin", { id }),
    /** Main window: lock (true) or unlock for dragging (false) every desktop widget. */
    setAllLocked: (locked: boolean) => invoke<void>("desktop_set_all_locked", { locked }),
    /** Desktop widget window: lock itself and remember its position. */
    setLocked: (locked: boolean) => invoke<void>("desktop_set_locked", { locked }),
    /** Desktop widget window: save its current position and size (called when a move/resize control is released). */
    commitBounds: () => invoke<void>("desktop_commit_bounds"),
    /** Desktop widget window: save only its own validated layout. */
    saveLayout: (layout: WidgetLayout) => invoke<void>("widget_layout_set", { layout }),
    /** Open menu mode and start editing this widget's layout on the desktop. */
    startLayoutEditor: (elements: WidgetElementInfo[]) => invoke<void>("widget_layout_editor_start", { elements }),
    /** Refresh the editable-element bounds shown by menu mode. */
    updateLayoutEditor: (elements: WidgetElementInfo[]) => invoke<void>("widget_layout_editor_update", { elements }),
    /** Keep the menu inspector selection in sync with direct selection on the widget. */
    selectLayoutEditorElement: (selectedId: string) => invoke<void>("desktop_layout_editor_select", { selectedId }),
    /** Stop layout editing and return this widget to the desktop layer. */
    stopLayoutEditor: (restoreView = true) => invoke<void>("desktop_layout_editor_stop", { restoreView }),
    onLayoutEditorChange: (cb: (session: WidgetLayoutEditorSession | null) => void): Promise<UnlistenFn> =>
      listen<WidgetLayoutEditorSession | null>("desktop://layout-editor", (e) => cb(e.payload)),
    /** Native frosted glass for one pinned widget; resolves with the effect Windows accepted. */
    setGlass: (id: string, enabled: boolean, tintOpacity: number, tint: string, kind: GlassKind) =>
      invoke<GlassEffect>("desktop_set_glass", { id, enabled, tintOpacity, tint, kind }),
    glassStatus: (id: string) => invoke<GlassEffectEvent | null>("desktop_glass_status", { id }),
    /** What this Windows build supports (for the glass wizard). Touches no window. */
    glassDiagnostics: () => invoke<GlassDiagnostics>("desktop_glass_diagnostics"),
    onGlass: (cb: (event: GlassEffectEvent) => void): Promise<UnlistenFn> =>
      listen<GlassEffectEvent>("desktop://glass", (e) => cb(e.payload)),
    state: () => invoke<boolean>("desktop_state"),
    onLocked: (cb: (label: string, locked: boolean) => void): Promise<UnlistenFn> =>
      listen<{ label: string; locked: boolean }>("desktop://locked", (e) => cb(e.payload.label, e.payload.locked)),
  },
  /** Menu mode: collapse into the small docked menu, and back. */
  menu: {
    open: () => invoke<void>("menu_open"),
    showApp: () => invoke<void>("menu_show_app"),
    layoutEditorState: () => invoke<WidgetLayoutEditorSession | null>("desktop_layout_editor_state"),
    selectLayoutEditorElement: (selectedId: string) => invoke<void>("desktop_layout_editor_select", { selectedId }),
    stopLayoutEditor: (restoreView = true) => invoke<void>("desktop_layout_editor_stop", { restoreView }),
    saveWidgetLayout: (id: string, layout: WidgetLayout) => invoke<void>("menu_widget_layout_set", { id, layout }),
  },
  themes: {
    list: () => invoke<Theme[]>("themes_list"),
    save: (name: string, data: Record<string, unknown>, id?: number) =>
      invoke<Theme>("theme_save", { id: id ?? null, name, data }),
    delete: (id: number) => invoke<void>("theme_delete", { id }),
    /** Opens a native save dialog. Resolves true if saved, false if cancelled. */
    exportFile: (suggestedName: string, json: string) =>
      invoke<boolean>("theme_export_file", { suggestedName, json }),
    /** Opens a native open dialog. Resolves the file text, or null if cancelled. */
    importFile: () => invoke<string | null>("theme_import_file"),
  },
};
