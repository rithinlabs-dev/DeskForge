// Undo/redo for the composition editor. Pure and unit-tested.
//
// Every edit goes through `commit`. A burst of changes that share a `group` (dragging a layer, moving one slider) and
// arrive close together counts as ONE undo step, so a drag doesn't leave hundreds of steps behind.

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** The group of the most recent change ("" for a one-off edit such as deleting a layer). */
  group: string;
  /** When the most recent change happened (ms). */
  at: number;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 700;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], group: "", at: 0 };
}

export function commit<T>(h: History<T>, next: T, group = "", now: number = Date.now(), coalesceMs: number = COALESCE_MS, limit: number = HISTORY_LIMIT): History<T> {
  if (Object.is(next, h.present)) return h;
  const merge = group !== "" && group === h.group && now - h.at < coalesceMs && h.past.length > 0;
  const past = merge ? h.past : [...h.past, h.present].slice(-limit);
  return { past, present: next, future: [], group, at: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const present = h.past[h.past.length - 1];
  return { past: h.past.slice(0, -1), present, future: [h.present, ...h.future], group: "", at: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future;
  return { past: [...h.past, h.present], present, future, group: "", at: 0 };
}

export const canUndo = <T,>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T,>(h: History<T>): boolean => h.future.length > 0;
