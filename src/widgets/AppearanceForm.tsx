import { useEffect, useState } from "react";
import { MAX_GLASS_OPACITY, isGlassKind, systemGlassTint, type Appearance, type GlassKind, type GlassStatus, type SystemTheme } from "./appearance";
import GlassWizardPanel from "./GlassWizardPanel";

const TINT_PRESETS = [
  { name: "Midnight", color: "#18243A" },
  { name: "Frost", color: "#E8EEF5" },
  { name: "Aurora", color: "#7054A3" },
];
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const EFFECT_LABEL: Record<string, string> = {
  acrylic: "Acrylic",
  blur: "Blur",
  backdrop: "Windows 11 backdrop",
  mica: "Mica",
};

/** What the status line says: the effect Windows actually accepted, and whether it is a fallback. */
function nativeEffectText(status: GlassStatus, kind: GlassKind, glassEnabled: boolean): string {
  if (status === "applying") return "Native effect: Applying…";
  if (status === "not-pinned") return "Native effect: pin this widget to enable";
  if (status === "unavailable") return "Native effect: unavailable (using the translucent sheen)";
  if (status === "off") {
    if (glassEnabled && kind === "sheen") return "Native effect: none (translucent sheen)";
    if (glassEnabled && kind === "wallpaper") return "Native effect: none (frosted wallpaper drawn by DeskForge)";
    return "Native effect: Off";
  }
  const label = EFFECT_LABEL[status] ?? status;
  if (kind === "auto") return `Native effect: ${label} (automatic)`;
  if (kind === "acrylic" && status === "blur") return "Native effect: Blur fallback";
  return `Native effect: ${label}`;
}

export default function AppearanceForm(props: {
  name: string;
  value: Appearance;
  systemTheme: SystemTheme;
  glassStatus?: GlassStatus;
  /** Set for a widget in the Widgets panel; enables the glass wizard (it needs the real desktop window). */
  widgetId?: string;
  pinned?: boolean;
  onChange: (patch: Partial<Appearance>) => void;
  onReset: () => void;
}) {
  const { name, value, systemTheme, glassStatus, widgetId, pinned = false, onChange, onReset } = props;
  const selectedTint = value.glassTint ?? systemGlassTint(systemTheme);
  const [hexDraft, setHexDraft] = useState(selectedTint);
  useEffect(() => setHexDraft(selectedTint), [selectedTint]);
  const status = glassStatus ?? (value.glassEnabled ? "applying" : "off");
  const statusText = nativeEffectText(status, value.glassKind, value.glassEnabled);
  const tintIgnored = value.glassKind === "backdrop" || value.glassKind === "mica";
  return (
    <div className="look-form" role="group" aria-label={`Appearance of ${name}`}>
      <label className="field">
        <span>Background</span>
        <span className="row">
          <code className="muted">{value.opacity === 0 ? "transparent" : `${value.opacity}%`}</code>
          <input type="range" min={0} max={value.glassEnabled ? MAX_GLASS_OPACITY : 100} value={value.opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) })} />
        </span>
      </label>
      <label className="check">
        <input type="checkbox" checked={value.glassEnabled} onChange={(e) => onChange({ glassEnabled: e.target.checked })} /> glass (blurs your wallpaper behind it)
      </label>
      {value.glassEnabled && (
        <label className="field">
          <span>Glass type</span>
          <select value={value.glassKind} onChange={(e) => onChange({ glassKind: isGlassKind(e.target.value) ? e.target.value : "acrylic" })}>
            <option value="acrylic">Acrylic (frosted)</option>
            <option value="blur">Plain blur (clear)</option>
            <option value="backdrop">Windows 11 backdrop (22H2+)</option>
            <option value="mica">Mica (22H2+)</option>
            <option value="wallpaper">Frosted wallpaper (works everywhere)</option>
            <option value="sheen">Translucent sheen (no blur)</option>
            <option value="auto">Automatic</option>
          </select>
        </label>
      )}
      {value.glassEnabled && widgetId && (
        <details className="glass-wizard-details">
          <summary>Glass wizard: not seeing the effect? Test every method</summary>
          <GlassWizardPanel
            widgetId={widgetId}
            name={name}
            value={value}
            systemTheme={systemTheme}
            pinned={pinned}
            onChoose={(kind) => onChange({ glassKind: kind })}
          />
        </details>
      )}
      {value.glassEnabled && (
        <label className="field">
          <span>Glass intensity (reflection)</span>
          <span className="row">
            <code className="muted">{value.glassLevel}%</code>
            <input type="range" min={0} max={100} value={value.glassLevel} onChange={(e) => onChange({ glassLevel: Number(e.target.value) })} />
          </span>
        </label>
      )}
      {value.glassEnabled && (
        <label className="field">
          <span>Tint</span>
          <span className="row">
            <input
              type="color"
              value={selectedTint}
              aria-label={`Glass tint for ${name}`}
              onChange={(e) => onChange({ glassTint: e.target.value })}
            />
            <input
              type="text"
              value={hexDraft}
              aria-label={`Tint hex color for ${name}`}
              aria-invalid={!HEX_COLOR.test(hexDraft)}
              maxLength={7}
              spellCheck={false}
              onChange={(e) => {
                const color = e.target.value;
                setHexDraft(color);
                if (HEX_COLOR.test(color)) onChange({ glassTint: color.toLowerCase() });
              }}
            />
            {value.glassTint ? (
              <button className="btn" type="button" onClick={() => onChange({ glassTint: null })}>use system tint</button>
            ) : (
              <span className="muted">follows system</span>
            )}
          </span>
          <span className="row wrap" aria-label="Tint presets">
            {TINT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                className="btn"
                type="button"
                aria-pressed={value.glassTint?.toLowerCase() === preset.color.toLowerCase()}
                onClick={() => onChange({ glassTint: preset.color.toLowerCase() })}
              >
                {preset.name}
              </button>
            ))}
          </span>
          <span className="muted">Current tint: {selectedTint.toUpperCase()}</span>
        </label>
      )}
      {value.glassEnabled && (
        <label className="field">
          <span>Tint opacity</span>
          <span className="row">
            <code className="muted">{value.glassTintOpacity}%</code>
            <input type="range" min={0} max={100} value={value.glassTintOpacity} onChange={(e) => onChange({ glassTintOpacity: Number(e.target.value) })} />
          </span>
          {tintIgnored && <span className="muted">Windows chooses the tint for this material, so tint opacity has no effect here (the tint colour only picks light or dark).</span>}
        </label>
      )}
      <label className="check"><input type="checkbox" checked={value.borderEnabled} onChange={(e) => onChange({ borderEnabled: e.target.checked })} /> border and corner marks</label>
      <label className="check"><input type="checkbox" checked={value.shadowEnabled} onChange={(e) => onChange({ shadowEnabled: e.target.checked })} /> soft shadow</label>
      <p className="muted" role="status" aria-live="polite">
        {statusText}
      </p>
      <p className="muted">Glass works on pinned desktop widgets (Windows 10/11). Tint opacity controls the native color alpha; glass intensity controls the reflection. Windows sets the native blur amount. The system tint follows the light or dark theme until you choose a color or preset. If glass doesn’t show on your PC, run the glass wizard, or choose the translucent sheen.</p>
      <button className="btn" onClick={onReset}>use the default look</button>
    </div>
  );
}
