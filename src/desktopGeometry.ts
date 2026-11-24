// Move/resize math for desktop widget windows. Pure, so the "no arbitrary limits" rule is testable.
//
// The only limits left are technical:
//  - MIN_LOGICAL: wide/tall enough that both hover controls (28 px each plus margins) fit and stay reachable.
//  - MAX_PHYSICAL: the largest surface WebView2 / GPU textures reliably handle.

export const MIN_LOGICAL = 68;
export const MAX_PHYSICAL = 16384;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** New window size (physical px) after the pointer moved (dx, dy) CSS px. Width and height are independent. */
export function nextSize(start: { w: number; h: number }, dx: number, dy: number, dpr: number) {
  const min = Math.ceil(MIN_LOGICAL * dpr);
  return {
    w: clamp(Math.round(start.w + dx * dpr), min, MAX_PHYSICAL),
    h: clamp(Math.round(start.h + dy * dpr), min, MAX_PHYSICAL),
  };
}

/** New window position (physical px) after the pointer moved (dx, dy) CSS px. Never clamped: widgets may sit anywhere. */
export function nextPosition(start: { x: number; y: number }, dx: number, dy: number, dpr: number) {
  return { x: Math.round(start.x + dx * dpr), y: Math.round(start.y + dy * dpr) };
}
