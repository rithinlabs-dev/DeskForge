import { convertFileSrc } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { DEFAULT_WALLPAPER, sanitizeWallpaperConfig } from "./shared/wallpaperConfig";
import "./wallpaper.css";

/** Plays the active video. The window is created, placed and closed by Rust; this page only decodes video. */
function Wallpaper() {
  const video = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [cfg, setCfg] = useState(DEFAULT_WALLPAPER);
  const [suspended, setSuspended] = useState(false);
  const [error, setError] = useState("");

  const report = (msg: string) => {
    setError(msg);
    emit("wallpaper://error", msg).catch(() => {}); // lets the main window show it
  };

  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];
    const reload = async () => {
      const active = await api.settings.get<{ path?: unknown }>("wallpaper:active");
      const c = sanitizeWallpaperConfig(await api.settings.get("wallpaper:config"));
      if (off) return;
      setCfg(c);
      setError("");
      setSrc(active && typeof active.path === "string" ? convertFileSrc(active.path) : null);
    };
    reload().catch((e) => report(`Couldn’t read the wallpaper settings: ${String(e)}`));
    Promise.all([
      api.settings.onChanged((k) => {
        if (k === "wallpaper:active" || k === "wallpaper:config") reload().catch(() => {});
      }),
      listen<{ suspended: boolean }>("wallpaper://suspend", (e) => setSuspended(!!e.payload.suspended)),
    ]).then((fs) => fs.forEach((f) => (off ? f() : unlisten.push(f))));
    return () => {
      off = true;
      unlisten.forEach((f) => f());
    };
  }, []);

  // Playback settings.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.loop = cfg.loop;
    v.muted = cfg.muted;
    v.volume = Math.min(1, Math.max(0, cfg.volume / 100));
  }, [cfg, src]);

  // A paused video costs almost nothing, so suspend = pause (fullscreen app, battery).
  useEffect(() => {
    const v = video.current;
    if (!v || !src) return;
    if (suspended) v.pause();
    else v.play().catch((e) => report(`Playback couldn’t start: ${e instanceof Error ? e.message : String(e)}`));
  }, [suspended, src]);

  const onError = () => {
    const code = video.current?.error?.code;
    report(
      code === 4
        ? "This video’s format isn’t supported. Use an H.264 MP4 or a VP9 WebM."
        : `The video couldn’t be played (error ${code ?? "unknown"}).`,
    );
  };

  return (
    <>
      {src && (
        <video
          ref={video}
          src={src}
          autoPlay
          muted
          playsInline
          disablePictureInPicture
          preload="auto"
          style={{ objectFit: cfg.fit }}
          onError={onError}
        />
      )}
      {error && <div className="wp-note" role="alert">{error}</div>}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Wallpaper />);
