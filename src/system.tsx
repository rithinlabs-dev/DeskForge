import { useEffect, useRef, useState } from "react";
import { api, type SystemSnapshot } from "./api";

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export interface SystemState {
  snap: SystemSnapshot | null;
  /** The last minute of processor use, one value per second. */
  cpu: number[];
  /** Network speed in bytes per second. */
  rate: { rx: number; tx: number };
}

/** Live system numbers. Tells Rust when this window is hidden so it can stop polling. */
export function useSystem(): SystemState {
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [cpu, setCpu] = useState<number[]>([]);
  const [rate, setRate] = useState({ rx: 0, tx: 0 });
  const prevTs = useRef<number | null>(null);

  useEffect(() => {
    let dead = false;
    let unlisten: (() => void) | undefined;

    const onSnap = (s: SystemSnapshot) => {
      if (prevTs.current !== null) {
        const dt = (s.timestampMs - prevTs.current) / 1000;
        if (dt > 0) setRate({ rx: s.netRxBytes / dt, tx: s.netTxBytes / dt });
      }
      prevTs.current = s.timestampMs;
      setSnap(s);
      setCpu((c) => [...c.slice(-59), s.cpuPercent]);
    };

    api.system.snapshot().then(onSnap).catch(() => {});
    api.system
      .onSnapshot(onSnap)
      .then((f) => (dead ? f() : (unlisten = f)))
      .catch(() => {});

    // Tell Rust when we're not on screen so it stops polling.
    const onVisibility = () => {
      prevTs.current = null;
      api.system.setPollingVisible(!document.hidden).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      dead = true;
      unlisten?.();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { snap, cpu, rate };
}

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="spark" viewBox="0 0 100 28" aria-hidden="true" />;
  const step = 100 / 59;
  const pts = values.map((v, i) => `${(i + 60 - values.length) * step},${27 - (Math.min(100, v) / 100) * 26}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function memoryPercent(snap: SystemSnapshot | null): number {
  return snap && snap.memTotal ? Math.round((snap.memUsed / snap.memTotal) * 100) : 0;
}
