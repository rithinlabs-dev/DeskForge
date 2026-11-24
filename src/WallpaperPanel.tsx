import { useEffect, useState } from "react";
import { api, type BlenderOpts, type MediaItem, type WallpaperStatus } from "./api";
import {
  DEFAULT_WALLPAPER, formatBytes, parseResolution, sanitizeWallpaperConfig,
  type Fit, type WallpaperConfig, type WallpaperMode,
} from "./shared/wallpaperConfig";

const MODES: { value: WallpaperMode; label: string }[] = [
  { value: "auto", label: "Automatic (try behind the icons, else windowed)" },
  { value: "behind-icons", label: "Behind the desktop icons (experimental)" },
  { value: "windowed", label: "Windowed (safe, covers the icons)" },
];

export default function WallpaperPanel() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [cfg, setCfg] = useState<WallpaperConfig>(DEFAULT_WALLPAPER);
  const [status, setStatus] = useState<WallpaperStatus>({ running: false, mode: "", activeId: null });
  const [notice, setNotice] = useState("");
  const [paused, setPaused] = useState("");
  const [blender, setBlender] = useState<string | null>(null);
  const [job, setJob] = useState<{ frame: number; total: number } | null>(null);
  const [res, setRes] = useState("1920x1080");
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<BlenderOpts["quality"]>("MEDIUM");
  const [engine, setEngine] = useState<BlenderOpts["engine"]>("default");
  const [samples, setSamples] = useState(64);

  const fail = (what: string) => (e: unknown) => setNotice(`Couldn’t ${what}: ${String(e)}`);
  const refresh = async () => {
    setItems(await api.media.list());
    setStatus(await api.wallpaper.status());
  };

  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];
    (async () => {
      try {
        const [list, raw, st, bl] = await Promise.all([
          api.media.list(), api.settings.get("wallpaper:config"), api.wallpaper.status(), api.blender.detect(),
        ]);
        if (off) return;
        setItems(list);
        setCfg(sanitizeWallpaperConfig(raw));
        setStatus(st);
        setBlender(bl);
      } catch (e) {
        if (!off) fail("load the wallpaper settings")(e);
      }
      const subs = await Promise.all([
        api.wallpaper.onState((running, mode) => setStatus((s) => ({ ...s, running, mode, activeId: running ? s.activeId : null }))),
        api.wallpaper.onSuspend((suspended, reason) => setPaused(suspended ? reason : "")),
        api.wallpaper.onError((m) => setNotice(m)),
        api.blender.onProgress((frame, total) => setJob({ frame, total })),
        api.blender.onDone((ok, error) => {
          setJob(null);
          setNotice(ok ? "Render finished and added to your library." : error ?? "The render failed.");
          if (ok) refresh().catch(() => {});
        }),
      ]);
      subs.forEach((f) => (off ? f() : unlisten.push(f)));
    })();
    return () => {
      off = true;
      unlisten.forEach((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<WallpaperConfig>) => {
    const next = sanitizeWallpaperConfig({ ...cfg, ...patch });
    setCfg(next);
    api.settings.set("wallpaper:config", next).catch(fail("save settings"));
  };

  const importVideo = async () => {
    try {
      const item = await api.media.importVideo();
      if (item) {
        await refresh();
        setNotice(`Imported “${item.name}”.`);
      }
    } catch (e) {
      fail("import the video")(e);
    }
  };

  const start = async (m: MediaItem) => {
    try {
      const info = await api.wallpaper.start(m.id);
      setStatus(await api.wallpaper.status());
      setNotice(info.message);
    } catch (e) {
      fail("start the wallpaper")(e);
    }
  };

  const stop = () => api.wallpaper.stop().then(() => setNotice("Wallpaper stopped.")).catch(fail("stop the wallpaper"));
  const remove = async (m: MediaItem) => {
    try {
      await api.media.remove(m.id);
      await refresh();
    } catch (e) {
      fail("remove the video")(e);
    }
  };

  const render = async () => {
    const r = parseResolution(res);
    if (!r) return setNotice("Choose a valid resolution.");
    try {
      const started = await api.blender.render({ ...r, fps, quality, engine, samples });
      if (started) {
        setJob({ frame: 0, total: 0 });
        setNotice(`Rendering “${started}” with Blender in the background…`);
      }
    } catch (e) {
      fail("start the render")(e);
    }
  };

  return (
    <section className="panel wp" aria-labelledby="h-wp">
      <h2 id="h-wp">Animated wallpaper</h2>

      <p className="muted" role="status" aria-live="polite">
        {status.running ? `Playing (${status.mode}).` : "Not running."} {paused && `Paused: ${paused}.`}
      </p>

      <div className="row wrap">
        <button className="btn primary" onClick={importVideo}>Import MP4 / WebM</button>
        {status.running && <button className="btn" onClick={stop}>Stop wallpaper</button>}
      </div>

      {items.length === 0 ? (
        <p className="muted">No videos yet. Import an MP4 (H.264) or WebM (VP9), or render one from a Blender file below.</p>
      ) : (
        <ul className="media-list">
          {items.map((m) => (
            <li key={m.id}>
              <span>
                {m.name} <span className="muted">· {m.kind} · {formatBytes(m.size)}{m.source === "blender" ? " · Blender" : ""}</span>
                {status.activeId === m.id && <strong> · playing</strong>}
              </span>
              <span className="row">
                <button className="btn" onClick={() => start(m)}>{status.activeId === m.id ? "Restart" : "Set as wallpaper"}</button>
                <button className="btn" onClick={() => remove(m)} aria-label={`Remove ${m.name}`}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <details className="hud-form">
        <summary>playback and performance</summary>
        <label className="check"><input type="checkbox" checked={cfg.loop} onChange={(e) => update({ loop: e.target.checked })} /> loop</label>
        <label className="check"><input type="checkbox" checked={cfg.muted} onChange={(e) => update({ muted: e.target.checked })} /> muted</label>
        <label className="field">
          <span>Volume</span>
          <span className="row">
            <code className="muted">{cfg.volume}%</code>
            <input type="range" min={0} max={100} value={cfg.volume} disabled={cfg.muted} onChange={(e) => update({ volume: Number(e.target.value) })} />
          </span>
        </label>
        <label className="field">
          <span>Fit</span>
          <select value={cfg.fit} onChange={(e) => update({ fit: e.target.value as Fit })}>
            <option value="cover">Fill the screen (crop)</option>
            <option value="contain">Show everything (bars)</option>
            <option value="fill">Stretch</option>
          </select>
        </label>
        <label className="field">
          <span>Placement</span>
          <select value={cfg.mode} onChange={(e) => update({ mode: e.target.value as WallpaperMode })}>
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={cfg.pauseOnFullscreen} onChange={(e) => update({ pauseOnFullscreen: e.target.checked })} /> pause while a fullscreen app runs</label>
        <label className="check"><input type="checkbox" checked={cfg.pauseOnBattery} onChange={(e) => update({ pauseOnBattery: e.target.checked })} /> pause on battery</label>
        <label className="check"><input type="checkbox" checked={cfg.autostart} onChange={(e) => update({ autostart: e.target.checked })} /> start with DeskForge</label>
        <p className="muted">Placement and pause options apply the next time the wallpaper starts (pause options apply within 3 seconds). Only the primary monitor is supported for now.</p>
      </details>

      <details className="hud-form">
        <summary>render a Blender file (optional)</summary>
        <p className="muted">
          Blender can’t run live on the desktop. DeskForge renders your .blend in the background (no Blender window) into an
          MP4, then plays that. Needs Blender installed; only render files you trust.
        </p>
        <p>{blender ? <code>{blender}</code> : <span className="muted">Blender not found.</span>}</p>
        <button className="btn" onClick={() => api.blender.setPath().then((p) => p && setBlender(p)).catch(fail("set Blender’s location"))}>
          {blender ? "change Blender location" : "set Blender location"}
        </button>
        <label className="field"><span>Resolution</span>
          <select value={res} onChange={(e) => setRes(e.target.value)}>
            <option>1920x1080</option><option>2560x1440</option><option>3840x2160</option>
          </select>
        </label>
        <label className="field"><span>Frame rate</span>
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
            <option value={24}>24</option><option value={30}>30</option><option value={60}>60</option>
          </select>
        </label>
        <label className="field"><span>Quality</span>
          <select value={quality} onChange={(e) => setQuality(e.target.value as BlenderOpts["quality"])}>
            <option value="LOW">Low (small file)</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option>
          </select>
        </label>
        <label className="field"><span>Engine</span>
          <select value={engine} onChange={(e) => setEngine(e.target.value as BlenderOpts["engine"])}>
            <option value="default">Use the file’s engine</option><option value="cycles">Cycles</option>
          </select>
        </label>
        <label className="field"><span>Samples</span>
          <input type="number" min={1} max={4096} value={samples} onChange={(e) => setSamples(Math.max(1, Math.min(4096, Number(e.target.value) || 1)))} />
        </label>
        <div className="row wrap">
          <button className="btn primary" onClick={render} disabled={!blender || !!job}>choose a .blend and render</button>
          {job && <button className="btn" onClick={() => api.blender.cancel().catch(fail("cancel"))}>cancel</button>}
        </div>
        {job && (
          <p>
            <progress value={job.frame} max={job.total || undefined} aria-label="Render progress" />{" "}
            <span className="muted">{job.total ? `frame ${job.frame} of ${job.total}` : "starting…"}</span>
          </p>
        )}
      </details>

      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}
