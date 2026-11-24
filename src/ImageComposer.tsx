import { useCallback, useEffect, useRef, useState, type KeyboardEvent as RKE, type PointerEvent as RPE } from "react";
import { api, type ImageItem } from "./api";
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from "./compose/history";
import {
  MAX_LAYERS, RESOLUTIONS, addLayer, duplicateLayer, fitScale, handleAt, hitTest, moveLayer, moveLayerTo, newComposition, removeLayer,
  replaceImage, resizeComposition, rotateFromDrag, sanitizeComposition, sanitizeCompositionLibrary, scaleFromDrag, updateLayer,
  type Composition, type Layer,
} from "./compose/model";
import { HANDLE_RADIUS_PX, HANDLE_REACH_PX, drawComposition, type Bitmap } from "./compose/render";
import { formatBytes, parseResolution } from "./shared/wallpaperConfig";
import BackgroundRemover from "./images/BackgroundRemover";

const PREVIEW_W = 640;
const DRAFT_KEY = "compose:current";
const LIBRARY_KEY = "compose:library";
const GRAB_PX = HANDLE_RADIUS_PX + 4; // how close (in screen pixels) the pointer must be to grab a handle

type Pt = { x: number; y: number };
type Drag =
  | { kind: "move"; id: string; dx: number; dy: number; group: string }
  | { kind: "scale" | "rotate"; id: string; start: Layer; from: Pt; group: string };

export default function ImageComposer() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [hist, setHist] = useState<History<Composition>>(() => createHistory(newComposition()));
  const comp = hist.present;
  const [saved, setSaved] = useState<Composition[]>([]);
  const [sel, setSel] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<ImageItem | null>(null); // the image whose background is being removed
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0); // bumped when a bitmap finishes loading
  const [dragId, setDragId] = useState(""); // layer being dragged in the list
  const [overId, setOverId] = useState(""); // layer row the dragged one is hovering over
  const bitmaps = useRef(new Map<string, Bitmap>());
  const failed = useRef(new Set<string>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const gesture = useRef(0);
  const fail = (what: string) => (e: unknown) => setNotice(`Couldn’t ${what}: ${String(e)}`);

  /** Every edit goes through here. Edits that share a `group` and arrive close together become one undo step. */
  const change = useCallback((next: Composition | ((c: Composition) => Composition), group = "") => {
    setHist((h) => commit(h, typeof next === "function" ? next(h.present) : next, group));
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [list, lib, draft] = await Promise.all([api.images.list(), api.settings.get(LIBRARY_KEY), api.settings.get(DRAFT_KEY)]);
        if (off) return;
        setImages(list);
        setSaved(sanitizeCompositionLibrary(lib));
        if (draft) setHist(createHistory(sanitizeComposition(draft)));
      } catch (e) {
        if (!off) fail("load your images")(e);
      } finally {
        if (!off) setLoaded(true);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  // Your work is kept as you go, so closing the app never loses a composition.
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => api.settings.set(DRAFT_KEY, comp).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [comp, loaded]);

  const ensureBitmap = useCallback(async (id: string) => {
    if (bitmaps.current.has(id) || failed.current.has(id)) return;
    try {
      const img = new Image();
      img.src = await api.images.data(id);
      await img.decode();
      bitmaps.current.set(id, { src: img, width: img.naturalWidth, height: img.naturalHeight });
      setTick((t) => t + 1);
    } catch {
      failed.current.add(id); // missing or unreadable: the layer shows as "missing image"
      setTick((t) => t + 1);
    }
  }, []);

  useEffect(() => {
    comp.layers.forEach((l) => void ensureBitmap(l.image));
  }, [comp.layers, ensureBitmap]);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const s = PREVIEW_W / comp.width;
    c.width = PREVIEW_W;
    c.height = Math.max(1, Math.round(comp.height * s));
    drawComposition(ctx, comp, bitmaps.current, { selected: sel, scale: s });
  }, [comp, sel, tick]);

  const layer: Layer | undefined = comp.layers.find((l) => l.id === sel);
  const bm = layer ? bitmaps.current.get(layer.image) : undefined;
  const patch = (p: Parameters<typeof updateLayer>[2], group = "") =>
    layer && change((c) => updateLayer(c, layer.id, p), group ? `${group}:${layer.id}` : "");

  const pointer = (e: RPE<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * comp.width,
      y: ((e.clientY - r.top) / r.height) * comp.height,
      unit: comp.width / r.width, // composition pixels per screen pixel
    };
  };
  const topHit = (p: Pt): Layer | undefined => {
    for (let i = comp.layers.length - 1; i >= 0; i--) {
      const l = comp.layers[i];
      const b = bitmaps.current.get(l.image);
      if (b && hitTest(l, b.width, b.height, p.x, p.y)) return l;
    }
    return undefined;
  };
  const handleUnder = (p: Pt & { unit: number }) =>
    layer && bm ? handleAt(layer, bm.width, bm.height, p.x, p.y, GRAB_PX * p.unit, HANDLE_REACH_PX * p.unit) : null;

  const onDown = (e: RPE<HTMLCanvasElement>) => {
    const p = pointer(e);
    gesture.current += 1;
    const group = `drag:${gesture.current}`;
    const handle = handleUnder(p);
    if (layer && handle) {
      drag.current = { kind: handle === "rotate" ? "rotate" : "scale", id: layer.id, start: layer, from: { x: p.x, y: p.y }, group };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    const hit = topHit(p);
    if (hit) {
      setSel(hit.id);
      drag.current = { kind: "move", id: hit.id, dx: hit.x - p.x, dy: hit.y - p.y, group };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    setSel("");
  };
  const onMove = (e: RPE<HTMLCanvasElement>) => {
    const p = pointer(e);
    const d = drag.current;
    if (!d) {
      const h = handleUnder(p);
      e.currentTarget.style.cursor = h === "rotate" ? "grab" : h === "tl" || h === "br" ? "nwse-resize" : h ? "nesw-resize" : topHit(p) ? "move" : "default";
      return;
    }
    if (d.kind === "move") change((c) => updateLayer(c, d.id, { x: p.x + d.dx, y: p.y + d.dy }), d.group);
    else if (d.kind === "scale") change((c) => updateLayer(c, d.id, { scale: scaleFromDrag(d.start.scale, d.start, d.from, p) }), d.group);
    else change((c) => updateLayer(c, d.id, { rotation: rotateFromDrag(d.start.rotation, d.start, d.from, p, !e.altKey) }), d.group);
  };
  const onUp = () => {
    drag.current = null;
  };

  /** Ctrl+Z undoes, Ctrl+Y (or Ctrl+Shift+Z) redoes, except while typing in a text box or choosing from a list. */
  const onKey = (e: RKE<HTMLElement>) => {
    const t = e.target as HTMLElement;
    if (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || (t instanceof HTMLInputElement && t.type === "text")) return;
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      setHist(undo);
    } else if (k === "y" || (k === "z" && e.shiftKey)) {
      e.preventDefault();
      setHist(redo);
    }
  };

  const importImage = async () => {
    try {
      const item = await api.images.importImage();
      if (item) {
        setImages(await api.images.list());
        setNotice(`Imported “${item.name}” (${formatBytes(item.size)}).`);
      }
    } catch (e) {
      fail("import the image")(e);
    }
  };

  const add = async (item: ImageItem) => {
    await ensureBitmap(item.id);
    const b = bitmaps.current.get(item.id);
    if (!b) return setNotice("That image couldn’t be loaded.");
    const next = addLayer(comp, { id: item.id, name: item.name, w: b.width, h: b.height });
    change(next);
    setSel(next.layers[next.layers.length - 1]?.id ?? "");
  };

  const removeImage = async (item: ImageItem) => {
    try {
      await api.images.remove(item.id);
      bitmaps.current.delete(item.id);
      setImages(await api.images.list());
      setTick((t) => t + 1);
    } catch (e) {
      fail("remove the image")(e);
    }
  };

  const persistSaved = (list: Composition[]) => {
    setSaved(list);
    api.settings.set(LIBRARY_KEY, list).catch(fail("save the composition"));
  };
  const save = () => {
    persistSaved([comp, ...saved.filter((s) => s.id !== comp.id)].slice(0, 30));
    setNotice(`Saved “${comp.name}”.`);
  };

  const makeWallpaper = async () => {
    setBusy(true);
    try {
      await Promise.all(comp.layers.map((l) => ensureBitmap(l.image)));
      const c = document.createElement("canvas");
      c.width = comp.width;
      c.height = comp.height;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("no canvas available");
      drawComposition(ctx, comp, bitmaps.current); // full resolution, no selection outline
      const url = c.toDataURL("image/png"); // lossless
      await api.compose.setWallpaper(url.slice(url.indexOf(",") + 1));
      setNotice(`“${comp.name}” is now your Windows wallpaper (${comp.width}×${comp.height}). “Restore previous wallpaper” puts your old one back.`);
    } catch (e) {
      fail("set the wallpaper")(e);
    } finally {
      setBusy(false);
    }
  };

  const restoreWallpaper = async () => {
    setBusy(true);
    try {
      await api.compose.restoreWallpaper();
      setNotice("Your previous wallpaper is back.");
    } catch (e) {
      fail("restore the previous wallpaper")(e);
    } finally {
      setBusy(false);
    }
  };

  const dropOn = (targetId: string) => {
    if (dragId && dragId !== targetId) {
      const to = comp.layers.findIndex((x) => x.id === targetId);
      change((c) => moveLayerTo(c, dragId, to));
    }
    setDragId("");
    setOverId("");
  };

  const num = (label: string, value: number, min: number, max: number, step: number, unit: string, on: (v: number) => void) => (
    <label className="field">
      <span>{label}</span>
      <span className="row">
        <code className="muted">{Number.isInteger(value) ? value : value.toFixed(2)}{unit}</code>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => on(Number(e.target.value))} />
      </span>
    </label>
  );

  return (
    <section className="panel composer" aria-labelledby="h-compose" onKeyDown={onKey}>
      <h2 id="h-compose">Desktop images and composition</h2>

      <div className="row wrap">
        <button className="btn primary" onClick={importImage}>Import image</button>
        <span className="muted">PNG, JPEG, WebP or GIF, up to 25 MB each.</span>
      </div>
      {removing && (
        <BackgroundRemover
          image={removing}
          onClose={() => setRemoving(null)}
          onSaved={async (item) => {
            setRemoving(null);
            setImages(await api.images.list());
            setNotice(`Saved “${item.name}” (${formatBytes(item.size)}). It is in your library now: add it as a layer.`);
          }}
        />
      )}
      {images.length > 0 && (
        <ul className="media-list">
          {images.map((i) => (
            <li key={i.id}>
              <span>{i.name} <span className="muted">· {i.kind} · {formatBytes(i.size)}</span></span>
              <span className="row">
                <button className="btn" onClick={() => add(i)} disabled={comp.layers.length >= MAX_LAYERS}>Add as layer</button>
                <button className="btn" onClick={() => setRemoving(i)} aria-label={`Remove the background of ${i.name}`}>Remove background</button>
                <button className="btn" onClick={() => removeImage(i)} aria-label={`Remove ${i.name} from the library`}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="row wrap">
        <input type="text" value={comp.name} maxLength={48} onChange={(e) => change({ ...comp, name: e.target.value }, "name")} aria-label="Composition name" />
        <select value={`${comp.width}x${comp.height}`} aria-label="Resolution" onChange={(e) => { const r = parseResolution(e.target.value); if (r) change((c) => resizeComposition(c, r.width, r.height)); }}>
          {[...new Set([`${comp.width}x${comp.height}`, ...RESOLUTIONS])].map((r) => <option key={r}>{r}</option>)}
        </select>
        <label className="check">background <input type="color" value={comp.bg} onChange={(e) => change({ ...comp, bg: e.target.value }, "bg")} /></label>
        <button className="btn" onClick={() => setHist(undo)} disabled={!canUndo(hist)} aria-label="Undo (Ctrl+Z)">Undo</button>
        <button className="btn" onClick={() => setHist(redo)} disabled={!canRedo(hist)} aria-label="Redo (Ctrl+Y)">Redo</button>
      </div>

      <canvas
        ref={canvasRef}
        className="compose-canvas"
        tabIndex={0}
        aria-label="Composition preview. Drag a layer to move it. Drag a corner square to resize, or the circle above it to rotate. Hold Alt while rotating to skip snapping."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      {comp.layers.length === 0 ? (
        <p className="muted">Import an image, then “Add as layer”. The first image fills the screen; add more to place them on top.</p>
      ) : (
        <ul className="layer-list" aria-label="Layers, top first. Drag a row to reorder, or use the arrow buttons.">
          {[...comp.layers].reverse().map((l) => {
            const missing = failed.current.has(l.image);
            const cls = [l.id === sel ? "on" : "", l.id === dragId ? "dragging" : "", l.id === overId && dragId && l.id !== dragId ? "drop-target" : ""].filter(Boolean).join(" ");
            return (
              <li
                key={l.id}
                className={cls}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move"; setDragId(l.id); }}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(l.id); } }}
                onDrop={(e) => { e.preventDefault(); dropOn(l.id); }}
                onDragEnd={() => { setDragId(""); setOverId(""); }}
              >
                <button className="btn" onClick={() => setSel(l.id)} aria-pressed={l.id === sel}>{l.name}{missing ? " (missing image)" : ""}</button>
                <span className="row">
                  <button className="btn" onClick={() => change((c) => moveLayer(c, l.id, 1))} aria-label={`Move ${l.name} up`}>↑</button>
                  <button className="btn" onClick={() => change((c) => moveLayer(c, l.id, -1))} aria-label={`Move ${l.name} down`}>↓</button>
                  <button className="btn" onClick={() => change((c) => duplicateLayer(c, l.id))} aria-label={`Duplicate ${l.name}`}>copy</button>
                  <button className="btn" onClick={() => { change((c) => removeLayer(c, l.id)); if (sel === l.id) setSel(""); }} aria-label={`Delete ${l.name}`}>delete</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {layer && (
        <div className="look-form" role="group" aria-label={`Settings for ${layer.name}`}>
          <label className="field">
            <span>Image</span>
            <select value={layer.image} onChange={(e) => change((c) => replaceImage(c, layer.id, e.target.value))}>
              {!images.some((i) => i.id === layer.image) && <option value={layer.image}>(missing)</option>}
              {images.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          {num("Size", layer.scale, 0.05, 4, 0.01, "×", (v) => patch({ scale: v }, "size"))}
          <div className="row wrap">
            <button className="btn" disabled={!bm} onClick={() => bm && patch({ scale: fitScale(bm.width, bm.height, layer.crop, comp.width, comp.height, "fit"), x: comp.width / 2, y: comp.height / 2 })}>fit to screen</button>
            <button className="btn" disabled={!bm} onClick={() => bm && patch({ scale: fitScale(bm.width, bm.height, layer.crop, comp.width, comp.height, "fill"), x: comp.width / 2, y: comp.height / 2 })}>fill screen</button>
            <button className="btn" onClick={() => patch({ x: comp.width / 2, y: comp.height / 2 })}>centre</button>
          </div>
          {num("Left–right", Math.round(layer.x), -comp.width / 2, comp.width * 1.5, 1, " px", (v) => patch({ x: v }, "x"))}
          {num("Up–down", Math.round(layer.y), -comp.height / 2, comp.height * 1.5, 1, " px", (v) => patch({ y: v }, "y"))}
          {num("Rotation", layer.rotation, -180, 180, 1, "°", (v) => patch({ rotation: v }, "rotation"))}
          {num("Opacity", layer.opacity, 0, 100, 1, "%", (v) => patch({ opacity: v }, "opacity"))}
          <label className="check"><input type="checkbox" checked={layer.flipX} onChange={(e) => patch({ flipX: e.target.checked })} /> mirror</label>
          <details>
            <summary>crop</summary>
            {num("Trim left", layer.crop.l, 0, 90, 1, "%", (v) => patch({ crop: { l: v } }, "crop-l"))}
            {num("Trim right", layer.crop.r, 0, 90, 1, "%", (v) => patch({ crop: { r: v } }, "crop-r"))}
            {num("Trim top", layer.crop.t, 0, 90, 1, "%", (v) => patch({ crop: { t: v } }, "crop-t"))}
            {num("Trim bottom", layer.crop.b, 0, 90, 1, "%", (v) => patch({ crop: { b: v } }, "crop-b"))}
          </details>
        </div>
      )}

      <div className="row wrap">
        <button className="btn" onClick={save}>Save composition</button>
        <button className="btn" onClick={() => { change(newComposition()); setSel(""); }}>New</button>
        {saved.length > 0 && (
          <select value="" aria-label="Open a saved composition" onChange={(e) => { const s = saved.find((x) => x.id === e.target.value); if (s) { change(sanitizeComposition(s)); setSel(""); } }}>
            <option value="">open saved…</option>
            {saved.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.width}×{s.height})</option>)}
          </select>
        )}
        {saved.some((s) => s.id === comp.id) && (
          <button className="btn" onClick={() => persistSaved(saved.filter((s) => s.id !== comp.id))}>Delete saved copy</button>
        )}
      </div>

      <div className="row wrap">
        <button className="btn primary" onClick={makeWallpaper} disabled={busy || comp.layers.length === 0}>
          {busy ? "Working…" : "Use as desktop wallpaper"}
        </button>
        <button className="btn" onClick={restoreWallpaper} disabled={busy}>Restore previous wallpaper</button>
        <span className="muted">Renders at {comp.width}×{comp.height} as a lossless PNG and replaces your current Windows wallpaper. DeskForge keeps a copy of the one it replaces.</span>
      </div>

      {notice && <p className="notice" role="status" aria-live="polite">{notice}</p>}
    </section>
  );
}
