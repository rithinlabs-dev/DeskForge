import type { CSSProperties } from "react";
import { PRESETS, themeCssVars, type Tokens } from "./tokens";

const same = (a: Tokens, b: Tokens) => (Object.keys(a) as (keyof Tokens)[]).every((k) => a[k] === b[k]);

/** Each card is painted with its own template's variables, so it previews the real look. */
export default function TemplateGallery({ current, onPick }: { current: Tokens; onPick: (t: Tokens) => void }) {
  return (
    <div className="tpl-grid">
      {PRESETS.map((p) => {
        const on = same(p.tokens, current);
        return (
          <button
            key={p.name}
            className={`tpl${on ? " on" : ""}`}
            aria-pressed={on}
            onClick={() => onPick(p.tokens)}
            style={themeCssVars(p.tokens) as CSSProperties}
          >
            <span className="tpl-time">02:41</span>
            <span className="tpl-name">{p.name}</span>
            <span className="tpl-chip" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
