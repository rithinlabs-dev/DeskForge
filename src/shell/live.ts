// Small hooks that keep the Overview and the page status tiles in step with what is running.
import { useEffect, useState } from "react";
import { api, type NowPlaying } from "../api";

/** Reads a value once, then keeps it fresh from an event. Cleans up after itself. */
function useLive<T>(initial: T, read: () => Promise<T>, subscribe: (apply: (value: T) => void) => Promise<() => void>): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let off = false;
    let stop: (() => void) | undefined;
    read().then((v) => !off && setValue(v)).catch(() => {});
    subscribe((v) => !off && setValue(v)).then((f) => (off ? f() : (stop = f))).catch(() => {});
    return () => {
      off = true;
      stop?.();
    };
    // the three functions are module-level wrappers: reading them once is enough
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export function useIslandRunning(): boolean {
  return useLive(false, () => api.island.status(), (apply) => api.island.onState(apply));
}

export function useFxRunning(): boolean {
  return useLive(false, () => api.fx.status(), (apply) => api.fx.onState(apply));
}

export interface WallpaperState {
  running: boolean;
  mode: string;
}

export function useWallpaperState(): WallpaperState {
  return useLive<WallpaperState>(
    { running: false, mode: "" },
    async () => {
      const s = await api.wallpaper.status();
      return { running: s.running, mode: s.mode };
    },
    (apply) => api.wallpaper.onState((running, mode) => apply({ running, mode })),
  );
}

/** What the media player is playing (only known while the island is on, because that is what reads it). */
export function useNowPlaying(): NowPlaying | null {
  return useLive<NowPlaying | null>(null, () => api.nowPlaying.state(), (apply) => api.nowPlaying.onChange(apply));
}

/** How many widgets are pinned to the desktop right now. Checked every few seconds while this is on screen. */
export function usePinnedCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let off = false;
    const read = () => api.desktop.list().then((ids) => !off && setCount(ids.length)).catch(() => {});
    read();
    const id = setInterval(read, 4000);
    return () => {
      off = true;
      clearInterval(id);
    };
  }, []);
  return count;
}
