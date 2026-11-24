import { useEffect, useState } from "react";
import type { SystemSnapshot, Theme } from "../api";
import { Cell, Grid } from "../shell/Bento";
import TemplateGallery from "../TemplateGallery";
import {
  DEFAULT_TOKENS, FONT_LABELS, PATTERN_KEYS, PATTERN_LABELS, sanitizeTokens,
  type BgStyle, type FontKey, type PatternKey, type Tokens,
} from "../tokens";

type ColorKey = "bg" | "bg2" | "surface" | "text" | "accent";
type NumKey = "radius" | "space" | "fontSize" | "angle";

const COLOR_FIELDS: { key: ColorKey; label: string; gradientOnly?: boolean }[] = [
  { key: "bg", label: "Background" },
  { key: "bg2", label: "Gradient end", gradientOnly: true },
  { key: "surface", label: "Panels" },
  { key: "text", label: "Text" },
  { key: "accent", label: "Accent" },
];

const SLIDERS: { key: NumKey; label: string; min: number; max: number; unit: string; gradientOnly?: boolean }[] = [
  { key: "angle", label: "Gradient angle", min: 0, max: 360, unit: "°", gradientOnly: true },
  { key: "radius", label: "Corner roundness", min: 0, max: 24, unit: "px" },
  { key: "space", label: "Spacing", min: 8, max: 28, unit: "px" },
  { key: "fontSize", label: "Text size", min: 13, max: 20, unit: "px" },
];

function Preview({ snap }: { snap: SystemSnapshot | null }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const memPct = snap && snap.memTotal ? Math.round((snap.memUsed / snap.memTotal) * 100) : 0;
  return (
    <section className="panel preview" aria-label="Start page preview">
      <p className="preview-time">{time}</p>
      <p className="muted">{date}</p>
      <div className="fake-search" aria-hidden="true">Search the web</div>
      <div className="tiles">
        <div className="tile"><span className="muted">CPU</span><strong>{snap ? `${Math.round(snap.cpuPercent)}%` : "–"}</strong></div>
        <div className="tile"><span className="muted">Memory</span><strong>{snap ? `${memPct}%` : "–"}</strong></div>
        <div className="tile accent"><span>Accent</span><strong>Aa</strong></div>
      </div>
    </section>
  );
}

export interface AppearanceProps {
  tokens: Tokens;
  /** Change some tokens as one undoable step (steps with the same key merge while you drag a slider). */
  set: (patch: Partial<Tokens>, key: string) => void;
  themes: Theme[];
  themeName: string;
  onThemeName: (name: string) => void;
  onSave: () => void;
  onDelete: (theme: Theme) => void;
  onImport: () => void;
  onExport: (name: string, tokens: Tokens) => void;
  notice: string;
  snap: SystemSnapshot | null;
}

/** Templates, a live preview, colours, shape and type, and saved themes, laid out as a bento. */
export default function AppearancePage(p: AppearanceProps) {
  const { tokens, set } = p;
  const gradient = tokens.bgStyle === "gradient";
  return (
    <>
      <Grid>
        <Cell span={7} index={0}>
          <section className="panel" aria-labelledby="h-templates">
            <h2 id="h-templates">Templates</h2>
            <TemplateGallery current={tokens} onPick={(t) => set(t, "preset")} />
          </section>
        </Cell>

        <Cell span={5} index={1}>
          <Preview snap={p.snap} />
        </Cell>

        <Cell span={6} index={2}>
          <section className="panel" aria-labelledby="h-colours">
            <h2 id="h-colours">Colours</h2>
            <label className="field">
              <span>Background style</span>
              <select value={tokens.bgStyle} onChange={(e) => set({ bgStyle: e.target.value as BgStyle }, "bgStyle")}>
                <option value="solid">Solid color</option>
                <option value="gradient">Gradient</option>
              </select>
            </label>
            <label className="field">
              <span>Pattern</span>
              <select value={tokens.pattern} onChange={(e) => set({ pattern: e.target.value as PatternKey }, "pattern")}>
                {PATTERN_KEYS.map((k) => <option key={k} value={k}>{PATTERN_LABELS[k]}</option>)}
              </select>
            </label>
            {COLOR_FIELDS.filter((f) => !f.gradientOnly || gradient).map(({ key, label }) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <span className="row">
                  <code className="muted">{tokens[key]}</code>
                  <input type="color" value={tokens[key]} onChange={(e) => set({ [key]: e.target.value }, key)} />
                </span>
              </label>
            ))}
          </section>
        </Cell>

        <Cell span={6} index={3}>
          <section className="panel" aria-labelledby="h-shape">
            <h2 id="h-shape">Shape and type</h2>
            {SLIDERS.filter((f) => !f.gradientOnly || gradient).map(({ key, label, min, max, unit }) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <span className="row">
                  <code className="muted">{tokens[key]}{unit}</code>
                  <input type="range" min={min} max={max} value={tokens[key]} onChange={(e) => set({ [key]: Number(e.target.value) }, key)} />
                </span>
              </label>
            ))}
            <label className="field">
              <span>Font</span>
              <select value={tokens.font} onChange={(e) => set({ font: e.target.value as FontKey }, "font")}>
                {(Object.keys(FONT_LABELS) as FontKey[]).map((k) => <option key={k} value={k}>{FONT_LABELS[k]}</option>)}
              </select>
            </label>
            <div className="row end">
              <button className="btn" onClick={() => set(DEFAULT_TOKENS, "reset")}>Reset to default</button>
            </div>
          </section>
        </Cell>

        <Cell span={12} index={4}>
          <section className="panel" aria-labelledby="h-themes">
            <h2 id="h-themes">Saved themes</h2>
            <div className="row grow">
              <input
                type="text"
                placeholder="Name this look"
                value={p.themeName}
                maxLength={64}
                onChange={(e) => p.onThemeName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && p.onSave()}
              />
              <button className="btn primary" onClick={p.onSave} disabled={!p.themeName.trim()}>Save theme</button>
            </div>
            <div className="row share">
              <button className="btn" onClick={p.onImport}>Import theme file</button>
              <button className="btn" onClick={() => p.onExport(p.themeName.trim() || "My theme", tokens)}>Export current look</button>
            </div>
            {p.themes.length === 0 ? (
              <p className="muted">No saved themes yet. Name the current look and save it.</p>
            ) : (
              <ul className="themes">
                {p.themes.map((t) => (
                  <li key={t.id}>
                    <span>{t.name}</span>
                    <span className="row">
                      <button className="btn" onClick={() => set(sanitizeTokens(t.data), `theme:${t.id}`)}>Apply</button>
                      <button className="btn" onClick={() => p.onExport(t.name, sanitizeTokens(t.data))} aria-label={`Export ${t.name}`}>Export</button>
                      <button className="btn" onClick={() => p.onDelete(t)} aria-label={`Delete ${t.name}`}>Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="notice" role="status" aria-live="polite">{p.notice}</p>
          </section>
        </Cell>
      </Grid>
    </>
  );
}
