import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { api, type ImageItem } from "../api";
import { DEFAULT_REMOVE, capPixels, pixelAt, removeBackground, rgbToHex, scaleToFit, type RemoveMode, type RemoveOptions, type RemoveResult } from "./removeBackground";

const PREVIEW_MAX = 900; // the preview is worked on at this size so the sliders feel instant
const MAX_PIXELS = 36_000_000; // very large pictures are reduced a little before saving
const SAVE_SCALES = [1, 0.75, 0.55]; // if the result is over the library's 25 MB limit, try smaller

/** Remove a plain background from a library image and save the result as a new PNG with transparency. */
export default function BackgroundRemover({ image, onSaved, onClose }: { image: ImageItem; onSaved: (item: ImageItem) => void; onClose: () => void }) {
  const [source, setSource] = useState<HTMLImageElement | null>(null);
  const [opts, setOpts] = useState<RemoveOptions>(DEFAULT_REMOVE);
  const [picking, setPicking] = useState(false);
  const [result, setResult] = useState<RemoveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const preview = useRef<HTMLCanvasElement>(null);
  const base = useRef<ImageData | null>(null); // the untouched preview pixels

  // load the picture and make the small copy the preview works on
  useEffect(() => {
    let off = false;
    base.current = null;
    setSource(null);
    setResult(null);
    setError("");
    (async () => {
      try {
        const img = new Image();
        img.src = await api.images.data(image.id);
        await img.decode();
        if (off) return;
        const size = scaleToFit(img.naturalWidth, img.naturalHeight, PREVIEW_MAX);
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no canvas available");
        ctx.drawImage(img, 0, 0, size.width, size.height);
        base.current = ctx.getImageData(0, 0, size.width, size.height);
        setSource(img);
      } catch (e) {
        if (!off) setError(`Couldn’t open the image: ${String(e)}`);
      }
    })();
    return () => {
      off = true;
    };
  }, [image.id]);

  // redraw the preview whenever a setting changes (a moment after the last change, so dragging stays smooth)
  useEffect(() => {
    const original = base.current;
    const canvas = preview.current;
    if (!source || !original || !canvas) return;
    const timer = setTimeout(() => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const copy = new ImageData(new Uint8ClampedArray(original.data), original.width, original.height);
      const outcome = removeBackground(copy.data, original.width, original.height, opts);
      canvas.width = original.width;
      canvas.height = original.height;
      ctx.putImageData(copy, 0, 0);
      setResult(outcome);
    }, 40);
    return () => clearTimeout(timer);
  }, [source, opts]);

  const set = (patch: Partial<RemoveOptions>) => setOpts((o) => ({ ...o, ...patch }));

  const pick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const original = base.current;
    if (!picking || !original) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.min(original.width - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * original.width)));
    const y = Math.min(original.height - 1, Math.max(0, Math.floor(((e.clientY - rect.top) / rect.height) * original.height)));
    set({ key: pixelAt(original.data, original.width, x, y) });
    setPicking(false);
  };

  const save = async () => {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    try {
      await new Promise((resolve) => setTimeout(resolve, 30)); // let "Working…" show before the heavy part
      const capped = capPixels(source.naturalWidth, source.naturalHeight, MAX_PIXELS);
      let last: unknown = null;
      for (const factor of SAVE_SCALES) {
        const w = Math.max(1, Math.floor(capped.width * factor));
        const h = Math.max(1, Math.floor(capped.height * factor));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no canvas available");
        ctx.drawImage(source, 0, 0, w, h);
        const pixels = ctx.getImageData(0, 0, w, h);
        removeBackground(pixels.data, w, h, opts);
        ctx.putImageData(pixels, 0, 0);
        const url = canvas.toDataURL("image/png");
        try {
          onSaved(await api.images.savePng(`${image.name} (no background)`, url.slice(url.indexOf(",") + 1)));
          return;
        } catch (e) {
          last = e;
          if (!String(e).includes("25 MB")) throw e; // only "too big" is worth retrying smaller
        }
      }
      throw last ?? new Error("the result was too large");
    } catch (e) {
      setError(`Couldn’t save the image: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const shown = opts.key ?? result?.key ?? null;
  const hint =
    !result ? "" :
    result.removedFraction > 0.985 ? "Almost everything was removed. Lower the tolerance, or choose “Pick from picture” and click the background." :
    result.removedFraction < 0.002 ? "Nothing was removed. Raise the tolerance, or choose “Pick from picture” and click the background." : "";

  return (
    <section className="panel remover" aria-labelledby="h-remover" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="remover-head">
        <h3 id="h-remover">Remove background: {image.name}</h3>
        <button className="btn" onClick={onClose}>Close</button>
      </div>
      <div className="remover-body">
        <div className="remover-stage">
          <div className="checker">
            <canvas
              ref={preview}
              className={picking ? "picking" : ""}
              aria-label={picking ? "Click the background colour in the picture" : "Preview of the picture with its background removed"}
              onPointerDown={pick}
            />
          </div>
          {!source && !error && <p className="muted" role="status">Opening the picture…</p>}
        </div>
        <div className="remover-controls">
          <label className="field">
            <span>What to remove</span>
            <select value={opts.mode} onChange={(e) => set({ mode: e.target.value as RemoveMode })}>
              <option value="edges">Background around the subject</option>
              <option value="everywhere">Every pixel of that colour</option>
            </select>
          </label>
          <label className="field">
            <span>Tolerance</span>
            <span className="row">
              <code className="muted">{opts.tolerance}</code>
              <input type="range" min={0} max={100} value={opts.tolerance} onChange={(e) => set({ tolerance: Number(e.target.value) })} />
            </span>
          </label>
          <label className="field">
            <span>Soft edge</span>
            <span className="row">
              <code className="muted">{opts.softness} px</code>
              <input type="range" min={0} max={8} value={opts.softness} onChange={(e) => set({ softness: Number(e.target.value) })} />
            </span>
          </label>
          <label className="field">
            <span>Trim the edge</span>
            <span className="row">
              <code className="muted">{opts.shrink} px</code>
              <input type="range" min={0} max={4} value={opts.shrink} onChange={(e) => set({ shrink: Number(e.target.value) })} />
            </span>
          </label>
          <div className="field">
            <span>Background colour</span>
            <span className="row wrap">
              {shown && <i className="swatch" style={{ background: rgbToHex(shown) }} aria-hidden="true" />}
              <code className="muted">{shown ? rgbToHex(shown) : "…"}{opts.key ? "" : " (auto)"}</code>
              <button className="btn" aria-pressed={picking} onClick={() => setPicking((p) => !p)}>{picking ? "Click the picture…" : "Pick from picture"}</button>
              {opts.key && <button className="btn" onClick={() => set({ key: null })}>Auto-detect</button>}
            </span>
          </div>
          {hint && <p className="notice" role="status">{hint}</p>}
          {image.kind === "gif" && <p className="muted">For an animated GIF only the first frame is used.</p>}
          {error && <p className="notice" role="alert">{error}</p>}
          <div className="row wrap">
            <button className="btn primary" onClick={save} disabled={!source || busy}>{busy ? "Working…" : "Save as new image"}</button>
            <button className="btn" onClick={() => setOpts(DEFAULT_REMOVE)} disabled={busy}>Reset</button>
          </div>
          <p className="muted">Works best on logos, products and drawings with a plain background. Everything happens on your PC. Your original is kept.</p>
        </div>
      </div>
    </section>
  );
}
