import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "./icons";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scroll-triggered reveal: `visible` turns true the first time the element scrolls into view, and stays true.
 * With reduced motion (or no IntersectionObserver) it is visible from the start, so nothing is ever hidden for good.
 */
export function useReveal<T extends HTMLElement>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(() => prefersReducedMotion() || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.06, rootMargin: "0px 0px -5% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);
  return [ref, visible];
}

/** The bento grid: 12 columns that fold to 6 and then 1 on narrower windows. */
export function Grid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`bento ${className}`.trim()}>{children}</div>;
}

export interface CellProps {
  /** Columns out of 12 on a wide window. */
  span?: number;
  /** Columns out of 12 on a medium window (default: half width for small cells, full width for big ones). */
  md?: number;
  /** Rows to span, for tall tiles. */
  row?: number;
  /** Position in the entrance sequence: later cells appear a little after earlier ones. */
  index?: number;
  className?: string;
  children: ReactNode;
}

/** One cell of the grid. It fades and slides in when it scrolls into view. */
export function Cell({ span = 12, md, row, index = 0, className = "", children }: CellProps) {
  const [ref, visible] = useReveal<HTMLDivElement>();
  const style = {
    "--span": span,
    "--md": md ?? (span <= 6 ? 6 : 12),
    ...(row ? { "--row": row } : {}),
    "--i": Math.min(10, Math.max(0, Math.round(index))),
  } as unknown as CSSProperties;
  return (
    <div ref={ref} className={`cell reveal ${className}`.trim()} style={style} data-visible={visible}>
      {children}
    </div>
  );
}

export interface TileProps {
  label?: string;
  value?: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  /** Filled with the accent colour. */
  accent?: boolean;
  /** A control in the top-right corner (a button or toggle). */
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** A bento tile: a small label, a big value and a hint, with room for anything else. */
export function Tile({ label, value, hint, icon, accent, action, className = "", children }: TileProps) {
  return (
    <div className={`bt${accent ? " accent" : ""} ${className}`.trim()}>
      {(label || icon || action) && (
        <div className="bt-head">
          <span className="bt-label">{icon && <Icon name={icon} size={16} />}{label}</span>
          {action}
        </div>
      )}
      {value !== undefined && <div className="bt-value">{value}</div>}
      {hint !== undefined && <div className="bt-hint">{hint}</div>}
      {children}
    </div>
  );
}
