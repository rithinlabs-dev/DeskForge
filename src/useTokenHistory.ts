import { useCallback, useReducer } from "react";
import type { Tokens } from "./tokens";

interface State {
  past: Tokens[];
  present: Tokens;
  future: Tokens[];
  lastKey: string | null;
  lastAt: number;
}

type Action =
  | { type: "edit"; patch: Partial<Tokens>; key: string; now: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; tokens: Tokens };

const MAX_HISTORY = 100;
const COALESCE_MS = 800; // dragging one slider = one undo step

function same(a: Tokens, b: Tokens): boolean {
  return (Object.keys(a) as (keyof Tokens)[]).every((k) => a[k] === b[k]);
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "edit": {
      const next = { ...s.present, ...a.patch };
      if (same(next, s.present)) return s;
      const coalesce = a.key === s.lastKey && a.now - s.lastAt < COALESCE_MS;
      return {
        past: coalesce ? s.past : [...s.past.slice(-(MAX_HISTORY - 1)), s.present],
        present: next,
        future: [],
        lastKey: a.key,
        lastAt: a.now,
      };
    }
    case "undo": {
      if (s.past.length === 0) return s;
      return {
        past: s.past.slice(0, -1),
        present: s.past[s.past.length - 1],
        future: [s.present, ...s.future],
        lastKey: null,
        lastAt: 0,
      };
    }
    case "redo": {
      if (s.future.length === 0) return s;
      return {
        past: [...s.past, s.present],
        present: s.future[0],
        future: s.future.slice(1),
        lastKey: null,
        lastAt: 0,
      };
    }
    case "load":
      return { past: [], present: a.tokens, future: [], lastKey: null, lastAt: 0 };
  }
}

export function useTokenHistory(initial: Tokens) {
  const [s, dispatch] = useReducer(reducer, {
    past: [],
    present: initial,
    future: [],
    lastKey: null,
    lastAt: 0,
  });

  const edit = useCallback(
    (patch: Partial<Tokens>, key: string) => dispatch({ type: "edit", patch, key, now: Date.now() }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  /** Replace everything and clear history (used for the initial load from storage). */
  const load = useCallback((tokens: Tokens) => dispatch({ type: "load", tokens }), []);

  return { tokens: s.present, canUndo: s.past.length > 0, canRedo: s.future.length > 0, edit, undo, redo, load };
}
