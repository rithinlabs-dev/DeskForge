import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { backdropLayout, type BackdropGeometry, type BackdropLayout } from "./backdrop";

export interface WallpaperBackdrop {
  url: string;
  layout: BackdropLayout;
}

const REFRESH_MS = 30_000; // picks up a changed wallpaper; Rust only copies the file again when it really changed

function loadSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("the wallpaper picture couldn’t be loaded"));
    img.src = url;
  });
}

/**
 * For a desktop widget window: the current wallpaper and where this window sits on it, so the page can draw the
 * matching blurred slice behind the widget. `null` until both are known (the widget shows the plain sheen meanwhile).
 */
export default function useWallpaperBackdrop(active: boolean): { backdrop: WallpaperBackdrop | null; error: string } {
  const [image, setImage] = useState<{ url: string; w: number; h: number } | null>(null);
  const [geometry, setGeometry] = useState<BackdropGeometry | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active) {
      setImage(null);
      setError("");
      return;
    }
    let off = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastKey = "";
    const refresh = async () => {
      try {
        const wallpaper = await api.backdrop.wallpaper();
        if (off) return;
        if (wallpaper.key !== lastKey) {
          const url = convertFileSrc(wallpaper.path);
          const size = await loadSize(url);
          if (off) return;
          lastKey = wallpaper.key;
          setImage({ url, w: size.w, h: size.h });
        }
        setError("");
      } catch (e) {
        if (!off) setError(String(e));
      }
      if (!off) timer = setTimeout(refresh, REFRESH_MS);
    };
    refresh();
    return () => {
      off = true;
      clearTimeout(timer);
    };
  }, [active]);

  useEffect(() => {
    if (!active) {
      setGeometry(null);
      return;
    }
    const win = getCurrentWindow();
    let off = false;
    let frame = 0;
    const unlisten: Array<() => void> = [];
    const read = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        api.backdrop
          .geometry()
          .then((g) => {
            if (!off) setGeometry(g);
          })
          .catch((e: unknown) => {
            if (!off) setError(String(e));
          });
      });
    };
    read();
    Promise.all([win.onMoved(read), win.onResized(read), win.onScaleChanged(read)])
      .then((stops) => stops.forEach((stop) => (off ? stop() : unlisten.push(stop))))
      .catch((e: unknown) => {
        if (!off) setError(String(e));
      });
    return () => {
      off = true;
      cancelAnimationFrame(frame);
      unlisten.forEach((stop) => stop());
    };
  }, [active]);

  const backdrop = useMemo<WallpaperBackdrop | null>(() => {
    if (!active || !image || !geometry) return null;
    const layout = backdropLayout(geometry, image.w, image.h);
    return layout ? { url: image.url, layout } : null;
  }, [active, image, geometry]);

  return { backdrop, error };
}
