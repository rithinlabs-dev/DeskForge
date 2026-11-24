import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE } from "react";
import { createRoot } from "react-dom/client";
import { api, type SystemSnapshot } from "./api";
import { nextPosition, nextSize } from "./desktopGeometry";
import { DEFAULT_TOKENS, applyTokens, sanitizeTokens, type Tokens } from "./tokens";
import { effectiveAppearance, systemGlassTint, type Appearance } from "./widgets/appearance";
import { customToManifest } from "./widgets/custom";
import { missingPermissions, type Grants } from "./widgets/grants";
import type { WidgetManifest } from "./widgets/manifest";
import { loadAppearance, loadCustom, loadGrants, loadLayouts, loadOpacity, loadRevs } from "./widgets/persistence";
import { sanitizeWidgetLayout, sanitizeWidgetLayoutMap, type WidgetElementInfo, type WidgetLayoutMap } from "./widgets/layout";
import { loadCatalog } from "./widgets/registry";
import useSystemTheme from "./widgets/useSystemTheme";
import useWallpaperBackdrop from "./widgets/useWallpaperBackdrop";
import WidgetFrame from "./widgets/WidgetFrame";
import WidgetLayoutHandles from "./widgets/WidgetLayoutHandles";
import "./desktop.css";

// This window's label is "dw-<widget id>" (set by the Rust side).
const win = getCurrentWindow();
const label = win.label;
const widgetId = label.startsWith("dw-") ? label.slice(3) : "";
const HIDE_DELAY_MS = 220; // bridges the gap when the pointer moves from the widget onto a control

type Op = "move" | "size";
interface Drag { kind: Op; sx: number; sy: number; a: number; b: number }

function DesktopWidget() {
  const [manifest, setManifest] = useState<WidgetManifest | null | undefined>(undefined); // undefined = loading
  const [grants, setGrants] = useState<Grants>({});
  const [tokens, setTokens] = useState<Tokens>(DEFAULT_TOKENS);
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [opacity, setOpacity] = useState(85);
  const [looks, setLooks] = useState<Record<string, Appearance>>({});
  const [layouts, setLayouts] = useState<WidgetLayoutMap>({});
  const [layoutElements, setLayoutElements] = useState<WidgetElementInfo[]>([]);
  const [editingLayout, setEditingLayout] = useState(false);
  const [layoutSelectedId, setLayoutSelectedId] = useState("");
  const systemTheme = useSystemTheme();
  const [nativeGlass, setNativeGlass] = useState(false);
  const [glassFailed, setGlassFailed] = useState(false); // Windows refused every native method for this widget
  const [rev, setRev] = useState(0);
  const [near, setNear] = useState(false); // pointer is over the widget or one of its controls
  const [busy, setBusy] = useState<Op | null>(null);
  const [error, setError] = useState("");

  const hideTimer = useRef<number | undefined>(undefined);
  const glassTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const layoutsRef = useRef(layouts);
  const layoutDirty = useRef(false);
  layoutsRef.current = layouts;
  const drag = useRef<Drag | null>(null);
  const holding = useRef(false);
  const frame = useRef(0);

  useEffect(() => applyTokens(tokens), [tokens]);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);
  useEffect(() => () => {
    if (!layoutDirty.current) return;
    clearTimeout(layoutSaveTimer.current);
    const widgetLayout = layoutsRef.current[widgetId] ?? {};
    api.desktop
      .saveLayout(widgetLayout)
      .catch((e) => console.error("Couldn’t save widget layout:", e));
  }, []);

  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];

    const reloadTokens = async () => {
      const raw = await api.settings.get("tokens");
      if (!off) setTokens(sanitizeTokens(raw));
    };
    const reloadGrants = async () => {
      const g = await loadGrants();
      if (!off) setGrants(g);
    };
    const reloadOpacity = async () => {
      const o = await loadOpacity();
      if (!off) setOpacity(o);
    };
    const reloadLooks = async () => {
      const m = await loadAppearance();
      if (!off) setLooks(m);
    };
    const reloadLayouts = async () => {
      const m = await loadLayouts();
      if (!off) {
        const next = layoutDirty.current
          ? sanitizeWidgetLayoutMap({ ...m, [widgetId]: layoutsRef.current[widgetId] ?? {} })
          : m;
        layoutsRef.current = next;
        setLayouts(next);
      }
    };
    const reloadRev = async () => {
      const r = await loadRevs();
      if (!off) setRev(r[widgetId] ?? 0);
    };

    (async () => {
      try {
        const [catalog, customs] = await Promise.all([
          loadCatalog(), loadCustom(), reloadTokens(), reloadGrants(), reloadOpacity(), reloadRev(), reloadLooks(), reloadLayouts(),
        ]);
        if (off) return;
        setManifest(
          catalog.widgets.find((m) => m.id === widgetId) ??
            customs.map(customToManifest).find((m) => m.id === widgetId) ??
            null,
        );
      } catch {
        if (!off) setManifest(null);
      }
      const subs = await Promise.all([
        api.settings.onChanged((key) => {
          if (key === "tokens") reloadTokens().catch(() => {});
          if (key === "widgets:grants") reloadGrants().catch(() => {});
          if (key === "widgets:opacity") reloadOpacity().catch(() => {});
          if (key === "widgets:rev") reloadRev().catch(() => {});
          if (key === "widgets:appearance") reloadLooks().catch(() => {});
          if (key === "widgets:layout") reloadLayouts().catch((e) => console.warn("DeskForge layout:", String(e)));
        }),
        api.system.onSnapshot(setSnap),
        api.desktop.onLayoutEditorChange((session) => {
          setEditingLayout(session?.widgetId === widgetId);
          if (session?.widgetId === widgetId) setLayoutSelectedId(session.selectedId);
        }),
      ]);
      subs.forEach((f) => (off ? f() : unlisten.push(f)));
    })();

    return () => {
      off = true;
      unlisten.forEach((f) => f());
    };
  }, []);

  const granted = manifest ? grants[manifest.id] : undefined;
  const ready = !!manifest && !!granted && missingPermissions(manifest, granted).length === 0;

  const look = effectiveAppearance(looks[widgetId], opacity);

  // Debounce native work during rapid setting changes; theme and appearance persist live.
  useEffect(() => {
    if (!ready) {
      setNativeGlass(false);
      return;
    }
    clearTimeout(glassTimer.current);
    setNativeGlass(false);
    setGlassFailed(false);
    glassTimer.current = setTimeout(() => {
      api.desktop
        .setGlass(widgetId, look.glassEnabled, look.glassTintOpacity, look.glassTint ?? systemGlassTint(systemTheme), look.glassKind)
        .then((effect) => setNativeGlass(effect !== "off"))
        .catch((e) => {
          setNativeGlass(false);
          setGlassFailed(true);
          console.warn("DeskForge glass:", String(e));
        });
    }, 140);
    return () => clearTimeout(glassTimer.current);
  }, [ready, look.glassEnabled, look.glassTintOpacity, look.glassKind, look.glassTint, systemTheme]);

  // Frosted wallpaper: chosen explicitly, or the automatic fallback when Windows refuses every native method.
  const wantsBackdrop = ready && look.glassEnabled && (look.glassKind === "wallpaper" || (look.glassKind === "auto" && glassFailed));
  const { backdrop, error: backdropError } = useWallpaperBackdrop(wantsBackdrop);
  useEffect(() => {
    if (backdropError) console.warn("DeskForge frosted wallpaper:", backdropError);
  }, [backdropError]);

  // Ask Rust to keep system snapshots flowing for as long as this window needs them.
  useEffect(() => {
    if (ready && manifest?.permissions.includes("system.read")) {
      api.system.setPollingVisible(true).catch(() => {});
    }
  }, [ready, manifest]);

  const setHover = (over: boolean) => {
    window.clearTimeout(hideTimer.current);
    if (over) setNear(true);
    else hideTimer.current = window.setTimeout(() => setNear(false), HIDE_DELAY_MS);
  };

  const fail = (what: string) => (err: unknown) => setError(`Couldn’t ${what}: ${String(err)}`);

  const selectLayoutElement = (id: string) => {
    setLayoutSelectedId(id);
    api.desktop.selectLayoutEditorElement(id).catch(fail("select widget element"));
  };

  useEffect(() => {
    if (!editingLayout) return;
    api.desktop.updateLayoutEditor(layoutElements).catch(fail("update widget layout details"));
  }, [editingLayout, layoutElements]);

  const persistWidgetLayout = async (widgetLayout: WidgetLayoutMap[string]) => {
    await api.desktop.saveLayout(widgetLayout);
    if (layoutsRef.current[widgetId] === widgetLayout) {
      const next = { ...layoutsRef.current, [widgetId]: widgetLayout };
      layoutsRef.current = next;
      setLayouts(next);
      layoutDirty.current = false;
    }
  };

  const changeWidgetLayout = (value: WidgetLayoutMap[string]) => {
    const widgetLayout = sanitizeWidgetLayout(value);
    const next = sanitizeWidgetLayoutMap({ ...layoutsRef.current, [widgetId]: widgetLayout });
    layoutsRef.current = next;
    setLayouts(next);
    layoutDirty.current = true;
    clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      layoutSaveTimer.current = undefined;
      persistWidgetLayout(widgetLayout).catch(fail("save widget layout"));
    }, 220);
  };

  const closeLayoutEditor = () => {
    setEditingLayout(false);
    api.desktop.stopLayoutEditor().catch(fail("close the layout editor"));
    if (!layoutDirty.current) return;
    clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = undefined;
    layoutDirty.current = false;
    persistWidgetLayout(layoutsRef.current[widgetId] ?? {}).catch((error: unknown) => {
      layoutDirty.current = true;
      fail("save widget layout")(error);
    });
  };

  const openLayoutEditor = async () => {
    setError("");
    try {
      await api.desktop.startLayoutEditor(layoutElements);
      setEditingLayout(true);
      setNear(true);
    } catch (error) {
      fail("bring the widget forward for editing")(error);
    }
  };

  // Move and resize are done explicitly (pointer capture + setPosition/setSize) and only ever start from the two
  // controls, so the rest of the widget stays fully interactive. Releasing the button commits the new bounds.
  const apply = (d: Drag, screenX: number, screenY: number) => {
    const dpr = window.devicePixelRatio || 1; // pointer deltas are CSS px; windows move in physical px
    const dx = screenX - d.sx;
    const dy = screenY - d.sy;
    if (d.kind === "move") {
      const p = nextPosition({ x: d.a, y: d.b }, dx, dy, dpr);
      return win.setPosition(new PhysicalPosition(p.x, p.y));
    }
    const s = nextSize({ w: d.a, h: d.b }, dx, dy, dpr);
    return win.setSize(new PhysicalSize(s.w, s.h));
  };

  const begin = (kind: Op) => async (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    holding.current = true;
    setBusy(kind);
    setError("");
    const { screenX: sx, screenY: sy } = e;
    try {
      if (kind === "move") {
        const p = await win.outerPosition(); // physical px
        if (holding.current) drag.current = { kind, sx, sy, a: p.x, b: p.y };
      } else {
        const s = await win.innerSize();
        if (holding.current) drag.current = { kind, sx, sy, a: s.width, b: s.height };
      }
    } catch (err) {
      holding.current = false;
      setBusy(null);
      fail("start")(err);
    }
  };

  const update = (e: RPE<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const { screenX, screenY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      apply(d, screenX, screenY).catch(fail(d.kind === "move" ? "move" : "resize"));
    });
  };

  const end = async (e: RPE<HTMLDivElement>) => {
    if (!holding.current) return;
    holding.current = false;
    cancelAnimationFrame(frame.current);
    const d = drag.current;
    drag.current = null;
    setBusy(null);
    if (!d) return;
    try {
      await apply(d, e.screenX, e.screenY); // land exactly where the button was released
      await api.desktop.commitBounds(); // persist position and size
    } catch (err) {
      fail("save the position")(err);
    }
  };

  if (manifest === undefined) return null;
  if (!manifest) return <div className="dw-note">The widget “{widgetId}” isn’t available.</div>;
  if (!ready || !granted) return <div className="dw-note">Open DeskForge and add “{manifest.name}” to allow it.</div>;

  const show = near || busy !== null;
  const hoverProps = { onPointerEnter: () => setHover(true), onPointerLeave: () => setHover(false) };

  return (
    <div
      className="dw-root"
      data-editing={editingLayout ? "true" : "false"}
      data-glass={look.glassEnabled ? "true" : "false"}
      data-system-theme={systemTheme}
      data-border={look.borderEnabled ? "true" : "false"}
      data-shadow={look.shadowEnabled ? "true" : "false"}
      data-glass-native={nativeGlass ? "true" : "false"}
      data-backdrop={backdrop ? "true" : "false"}
      style={{
        "--glass-level": look.glassLevel / 100,
        "--glass-tint": look.glassTint ?? systemGlassTint(systemTheme),
        "--glass-tint-opacity": `${look.glassTintOpacity}%`,
      } as CSSProperties}
      {...hoverProps}
    >
      {backdrop && (
        <div className="dw-backdrop" aria-hidden="true">
          <div
            className="dw-backdrop-img"
            style={{
              top: -backdrop.layout.pad,
              left: -backdrop.layout.pad,
              right: -backdrop.layout.pad,
              bottom: -backdrop.layout.pad,
              backgroundImage: `url("${backdrop.url}")`,
              backgroundSize: backdrop.layout.size,
              backgroundPosition: backdrop.layout.position,
            }}
          />
        </div>
      )}

      <WidgetFrame
        key={rev}
        manifest={manifest}
        granted={granted.permissions}
        tokens={tokens}
        snapshot={snap}
        appearance={look}
        layout={layouts[widgetId] ?? {}}
        systemTheme={systemTheme}
        fill
        onHover={setHover}
        onLayoutElements={setLayoutElements}
      />

      <button
        className={`dw-btn dw-edit${show || editingLayout ? " show" : ""}${editingLayout ? " active" : ""}`}
        type="button"
        aria-label={editingLayout ? "Exit layout editing" : "Edit widget layout"}
        aria-pressed={editingLayout}
        title={editingLayout ? "Done editing" : "Edit widget layout"}
        onClick={() => {
          if (editingLayout) closeLayoutEditor();
          else openLayoutEditor().catch((error: unknown) => fail("start layout editing")(error));
        }}
        {...hoverProps}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.04a1 1 0 000-1.42l-2.5-2.5a1 1 0 00-1.42 0l-1.83 1.83 3.75 3.75 2-1.66z" />
        </svg>
      </button>

      <div
        className={`dw-btn dw-move${show && !editingLayout ? " show" : ""}`}
        role="button"
        aria-label="Move widget: press and hold"
        title="Hold to move"
        onPointerDown={begin("move")}
        onPointerMove={update}
        onPointerUp={end}
        onPointerCancel={end}
        {...hoverProps}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M12 2l3 3h-2v4h-2V5H9l3-3zm0 20l-3-3h2v-4h2v4h2l-3 3zM2 12l3-3v2h4v2H5v2l-3-3zm20 0l-3 3v-2h-4v-2h4V9l3 3z" />
        </svg>
      </div>

      <div
        className={`dw-btn dw-size${show && !editingLayout ? " show" : ""}`}
        role="button"
        aria-label="Resize widget: press and hold"
        title="Hold to resize"
        onPointerDown={begin("size")}
        onPointerMove={update}
        onPointerUp={end}
        onPointerCancel={end}
        {...hoverProps}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M14 3h7v7h-2V6.4l-5.3 5.3-1.4-1.4L17.6 5H14V3zM10 21H3v-7h2v3.6l5.3-5.3 1.4 1.4L6.4 19H10v2z" />
        </svg>
      </div>

      {editingLayout && (
        <WidgetLayoutHandles
          elements={layoutElements}
          selectedId={layoutSelectedId}
          layout={layouts[widgetId] ?? {}}
          onSelect={selectLayoutElement}
          onChange={changeWidgetLayout}
        />
      )}

      {error && show && <small className="dw-error" role="alert">{error}</small>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<DesktopWidget />);
