import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type PointerEvent as RPE } from "react";
import { createRoot } from "react-dom/client";
import { api, type SystemSnapshot, type WidgetLayoutEditorSession } from "./api";
import { DEFAULT_TOKENS, PRESETS, applyTokens, sanitizeTokens, type Tokens } from "./tokens";
import { customToManifest } from "./widgets/custom";
import { missingPermissions } from "./widgets/grants";
import type { WidgetManifest } from "./widgets/manifest";
import { loadCustom, loadEnabled, loadGrants, loadLayouts, loadOpacity } from "./widgets/persistence";
import { desktopSize, loadCatalog } from "./widgets/registry";
import WidgetLayoutEditor from "./widgets/WidgetLayoutEditor";
import { sanitizeWidgetLayout, type WidgetLayout, type WidgetLayoutMap } from "./widgets/layout";
import "./styles.css";
import "./menu.css";

const win = getCurrentWindow();
const same = (a: Tokens, b: Tokens) => (Object.keys(a) as (keyof Tokens)[]).every((k) => a[k] === b[k]);
const gb = (n: number) => `${(n / 1073741824).toFixed(1)} GB`;

function Menu() {
  const [tokens, setTokens] = useState<Tokens>(DEFAULT_TOKENS);
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [widgets, setWidgets] = useState<WidgetManifest[]>([]);
  const [pinned, setPinned] = useState<string[]>([]);
  const [opacity, setOpacity] = useState(85);
  const [layoutEditor, setLayoutEditor] = useState<WidgetLayoutEditorSession | null>(null);
  const [layouts, setLayouts] = useState<WidgetLayoutMap>({});
  const [onTop, setOnTop] = useState(false);
  const [notice, setNotice] = useState("");
  const layoutSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const layoutsRef = useRef(layouts);
  const pendingLayoutSave = useRef<{ id: string; layout: WidgetLayout } | null>(null);
  layoutsRef.current = layouts;

  // Dragging the whole menu by its header (explicit pointer capture, as with desktop widgets).
  const start = useRef<{ sx: number; sy: number; wx: number; wy: number } | null>(null);
  const down = useRef(false);
  const frame = useRef(0);

  useEffect(() => applyTokens(tokens), [tokens]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];
    const load = async () => {
      try {
        const [cat, customs, enabled, grants, pins, raw, op, savedLayouts] = await Promise.all([
          loadCatalog(), loadCustom(), loadEnabled(), loadGrants(),
          api.desktop.list(), api.settings.get("tokens"), loadOpacity(), loadLayouts(),
        ]);
        if (off) return;
        const all = [...cat.widgets, ...customs.map(customToManifest)];
        setWidgets(
          enabled
            .map((id) => all.find((m) => m.id === id))
            .filter((m): m is WidgetManifest => !!m && missingPermissions(m, grants[m.id]).length === 0),
        );
        setPinned(pins);
        setTokens(sanitizeTokens(raw));
        setOpacity(op);
        layoutsRef.current = savedLayouts;
        setLayouts(savedLayouts);
      } catch (e) {
        if (!off) setNotice(`Couldn’t load: ${String(e)}`);
      }
    };
    load();
    api.system.setPollingVisible(true).catch(() => {});
    Promise.all([
      api.settings.onChanged((k) => {
        if (["tokens", "widgets:enabled", "widgets:custom", "widgets:grants", "widgets:opacity", "widgets:layout"].includes(k)) load();
      }),
      api.system.onSnapshot(setSnap),
    ]).then((fs) => fs.forEach((f) => (off ? f() : unlisten.push(f))));
    return () => {
      off = true;
      unlisten.forEach((f) => f());
    };
  }, []);

  useEffect(() => {
    let off = false;
    let unlisten: (() => void) | undefined;
    api.desktop.onLayoutEditorChange((session) => setLayoutEditor(session)).then((stop) => {
      if (off) {
        stop();
        return;
      }
      unlisten = stop;
      api.menu.layoutEditorState()
        .then((session) => {
          if (!off) setLayoutEditor(session);
        })
        .catch((error) => {
          if (!off) setNotice(`Couldn’t load the widget editor: ${String(error)}`);
        });
    }).catch((error) => {
      if (!off) setNotice(`Couldn’t monitor the widget editor: ${String(error)}`);
    });
    return () => {
      off = true;
      unlisten?.();
      clearTimeout(layoutSaveTimer.current);
    };
  }, []);

  const applyTheme = (t: Tokens) => {
    setTokens(t);
    api.settings.set("tokens", t).catch((e) => setNotice(`Couldn’t save: ${String(e)}`));
  };

  const idx = PRESETS.findIndex((p) => same(p.tokens, tokens));
  const step = (d: 1 | -1) => {
    const i = idx < 0 ? (d === 1 ? 0 : PRESETS.length - 1) : (idx + d + PRESETS.length) % PRESETS.length;
    applyTheme(PRESETS[i].tokens);
  };

  // Widget background slider (debounced).
  const opTimer = useRef<ReturnType<typeof setTimeout>>();
  const setGlass = (v: number) => {
    setOpacity(v);
    clearTimeout(opTimer.current);
    opTimer.current = setTimeout(() => api.settings.set("widgets:opacity", v).catch(() => {}), 250);
  };

  const setWidgetLayout = (id: string, value: WidgetLayout) => {
    const layout = sanitizeWidgetLayout(value);
    const next = { ...layoutsRef.current, [id]: layout };
    layoutsRef.current = next;
    setLayouts(next);
    pendingLayoutSave.current = { id, layout };
    clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = setTimeout(() => {
      layoutSaveTimer.current = undefined;
      const pending = pendingLayoutSave.current;
      pendingLayoutSave.current = null;
      if (pending) {
        api.menu.saveWidgetLayout(pending.id, pending.layout)
          .catch((error) => setNotice(`Couldn’t save widget layout: ${String(error)}`));
      }
    }, 220);
  };

  const selectLayoutElement = (id: string) => {
    setLayoutEditor((session) => session ? { ...session, selectedId: id } : session);
    api.menu.selectLayoutEditorElement(id)
      .catch((error) => setNotice(`Couldn’t select widget element: ${String(error)}`));
  };

  const closeLayoutEditor = async () => {
    clearTimeout(layoutSaveTimer.current);
    layoutSaveTimer.current = undefined;
    const pending = pendingLayoutSave.current;
    pendingLayoutSave.current = null;
    try {
      if (pending) await api.menu.saveWidgetLayout(pending.id, pending.layout);
      await api.menu.stopLayoutEditor();
      setLayoutEditor(null);
    } catch (error) {
      setNotice(`Couldn’t close the widget editor: ${String(error)}`);
    }
  };

  const togglePin = async (m: WidgetManifest) => {
    try {
      if (pinned.includes(m.id)) {
        if (layoutEditor?.widgetId === m.id) await api.menu.stopLayoutEditor(false);
        await api.desktop.unpin(m.id);
        setPinned((p) => p.filter((x) => x !== m.id));
      } else {
        const { width, height } = desktopSize(m);
        await api.desktop.pin(m.id, width, height);
        setPinned((p) => [...p, m.id]);
        setNotice("Hover over it, then hold the move or resize icon.");
      }
    } catch (e) {
      setNotice(String(e));
    }
  };

  const toggleTop = async () => {
    try {
      await win.setAlwaysOnTop(!onTop);
      setOnTop(!onTop);
    } catch (e) {
      setNotice(String(e));
    }
  };

  const onDown = async (e: RPE<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current = true;
    const { screenX: sx, screenY: sy } = e;
    const pos = await win.outerPosition().catch(() => null);
    if (pos && down.current) start.current = { sx, sy, wx: pos.x, wy: pos.y };
  };
  const onMove = (e: RPE<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const { screenX, screenY } = e;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      win.setPosition(new PhysicalPosition(Math.round(s.wx + (screenX - s.sx) * dpr), Math.round(s.wy + (screenY - s.sy) * dpr))).catch(() => {});
    });
  };
  const onUp = () => {
    down.current = false;
    start.current = null;
  };

  const [fxOn, setFxOn] = useState(false);
  useEffect(() => {
    api.fx.status().then(setFxOn).catch(() => {});
    let un: (() => void) | undefined;
    let dead = false;
    api.fx.onState(setFxOn).then((f) => (dead ? f() : (un = f))).catch(() => {});
    return () => {
      dead = true;
      un?.();
    };
  }, []);
  const toggleFx = () => (fxOn ? api.fx.stop() : api.fx.start()).catch((e) => setNotice(String(e)));

  const cpu = snap ? Math.round(snap.cpuPercent) : 0;
  const mem = snap && snap.memTotal ? Math.round((snap.memUsed / snap.memTotal) * 100) : 0;

  return (
    <div className="menu">
      <div className="menu-head" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <h1><span className="prompt">&gt;</span>deskforge</h1>
        <button className="btn" onClick={toggleTop} aria-pressed={onTop} title="Keep this menu above other windows">
          {onTop ? "on top ✓" : "on top"}
        </button>
        <button className="btn primary" onClick={() => api.menu.showApp().catch((e) => setNotice(String(e)))}>open app</button>
      </div>

      {layoutEditor && (
        <WidgetLayoutEditor
          key={layoutEditor.widgetId}
          name={widgets.find((widget) => widget.id === layoutEditor.widgetId)?.name ?? layoutEditor.widgetId}
          elements={layoutEditor.elements}
          selectedId={layoutEditor.selectedId}
          layout={layouts[layoutEditor.widgetId] ?? {}}
          onSelect={selectLayoutElement}
          onChange={(value) => setWidgetLayout(layoutEditor.widgetId, value)}
          onClose={() => { void closeLayoutEditor(); }}
        />
      )}

      <section aria-label="Clock">
        <div className="menu-clock">{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
        <div className="muted menu-date">{now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}</div>
      </section>

      <section aria-label="System">
        <div className="meter"><span className="muted">cpu</span><div className="bar"><i style={{ width: `${cpu}%` }} /></div><code>{cpu}%</code></div>
        <div className="meter"><span className="muted">mem</span><div className="bar"><i style={{ width: `${mem}%` }} /></div><code>{mem}%</code></div>
        {snap && <p className="muted">{gb(snap.memUsed)} of {gb(snap.memTotal)}</p>}
      </section>

      <section aria-labelledby="m-theme">
        <h2 id="m-theme">Template</h2>
        <div className="menu-step">
          <button className="btn" onClick={() => step(-1)} aria-label="Previous template">‹</button>
          <select value={idx} onChange={(e) => applyTheme(PRESETS[Number(e.target.value)].tokens)} aria-label="Template">
            {idx < 0 && <option value={-1}>custom</option>}
            {PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
          </select>
          <button className="btn" onClick={() => step(1)} aria-label="Next template">›</button>
        </div>
        <label className="field">
          <span className="muted">widget background</span>
          <span className="row">
            <input type="range" min={0} max={100} value={opacity} onChange={(e) => setGlass(Number(e.target.value))} />
            <code className="muted">{opacity}%</code>
          </span>
        </label>
      </section>

      <section aria-labelledby="m-widgets">
        <h2 id="m-widgets">Desktop widgets</h2>
        {widgets.length === 0 ? (
          <p className="muted">No widgets yet. Add some in the full app.</p>
        ) : (
          <ul className="menu-list">
            {widgets.map((m) => (
              <li key={m.id}>
                <span>{m.name}</span>
                <button className="btn" onClick={() => togglePin(m)} aria-pressed={pinned.includes(m.id)}>
                  {pinned.includes(m.id) ? "unpin" : "pin"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="m-fx">
        <h2 id="m-fx">Cursor effects</h2>
        <button className="btn" onClick={toggleFx} aria-pressed={fxOn}>{fxOn ? "turn off" : "turn on"}</button>
      </section>

      <div className="menu-foot">
        <p className="muted" role="status" aria-live="polite">{notice}</p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Menu />);
