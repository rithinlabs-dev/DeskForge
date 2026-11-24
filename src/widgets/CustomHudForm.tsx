import { useState, type ChangeEvent } from "react";
import { MAX_CSS_BYTES, STARTER_CSS, sanitizeCss } from "../shared/customCss";
import { HUD_PART_LABELS, HUD_PART_TYPES, newHudId, type CustomHud, type HudPart, type HudPartType } from "./custom";

export default function CustomHudForm({ onCreate }: { onCreate: (hud: CustomHud, css: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [on, setOn] = useState<Record<HudPartType, boolean>>({ clock: true, date: true, cpu: true, memory: true, net: false, text: false });
  const [text, setText] = useState("");
  const [cols, setCols] = useState<1 | 2>(1);
  const [height, setHeight] = useState(150);
  const [css, setCss] = useState("");
  const [cssNote, setCssNote] = useState("No CSS file: the built-in HUD style is used.");
  const chosen = HUD_PART_TYPES.filter((t) => on[t]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_CSS_BYTES * 2) {
      setCss("");
      setCssNote("That file is too large for a HUD stylesheet (limit 48 KB).");
      return;
    }
    const res = sanitizeCss(await file.text());
    if (res.ok) {
      setCss(res.css);
      setCssNote(`Loaded ${file.name} (${(res.css.length / 1024).toFixed(1)} KB).`);
    } else {
      setCss("");
      setCssNote(res.error);
    }
  };

  const create = async () => {
    const parts: HudPart[] = chosen.map((t) => (t === "text" ? { type: t, text: text.trim().slice(0, 40) } : { type: t }));
    await onCreate({ id: newHudId(name), name: name.trim(), cols, height, parts }, css);
    setName("");
    setCss("");
    setCssNote("No CSS file: the built-in HUD style is used.");
  };

  return (
    <details className="hud-form">
      <summary>create a custom hud</summary>
      <label className="field">
        <span>Name</span>
        <input type="text" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="My HUD" />
      </label>

      <fieldset>
        <legend>Parts</legend>
        {HUD_PART_TYPES.map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={on[t]} onChange={(e) => setOn({ ...on, [t]: e.target.checked })} />
            {HUD_PART_LABELS[t]}
          </label>
        ))}
        {on.text && (
          <input type="text" value={text} maxLength={40} onChange={(e) => setText(e.target.value)} placeholder="Label text" aria-label="Label text" />
        )}
      </fieldset>

      <label className="field">
        <span>Width</span>
        <select value={cols} onChange={(e) => setCols(e.target.value === "2" ? 2 : 1)}>
          <option value={1}>1 column</option>
          <option value={2}>2 columns</option>
        </select>
      </label>
      <label className="field">
        <span>Height</span>
        <span className="row">
          <code className="muted">{height}px</code>
          <input type="range" min={80} max={400} step={10} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
        </span>
      </label>

      <div className="field">
        <span>Style</span>
        <label className="btn">
          upload .css
          <input type="file" accept=".css,text/css" onChange={onFile} hidden />
        </label>
      </div>
      <p className="muted" role="status">{cssNote}</p>

      <details>
        <summary>starter css and class names</summary>
        <pre className="starter">{STARTER_CSS}</pre>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(STARTER_CSS).catch(() => {})}>copy</button>
      </details>

      <button className="btn primary" onClick={create} disabled={!name.trim() || chosen.length === 0}>Create HUD</button>
    </details>
  );
}
