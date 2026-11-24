import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  BUILTIN_EFFECTS, DEFAULT_FX, FX_CONFIG_KEY, FX_EFFECTS_KEY, MAX_EFFECT_FILE, MAX_LIBRARY, TRAIL_STYLES,
  parseEffectFile, sanitizeEffectLibrary, sanitizeFxConfig, type FxConfig, type ParticleEffect, type TrailStyle,
} from "./fx/config";

const slider = (label: string, value: number, min: number, max: number, step: number, unit: string, onChange: (v: number) => void) => (
  <label className="field">
    <span>{label}</span>
    <span className="row">
      <code className="muted">{Number.isInteger(value) ? value : value.toFixed(2)}{unit}</code>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </span>
  </label>
);

export default function FxPanel() {
  const [cfg, setCfg] = useState<FxConfig>(DEFAULT_FX);
  const [library, setLibrary] = useState<ParticleEffect[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const fail = (what: string) => (e: unknown) => setNotice(`Couldn’t ${what}: ${String(e)}`);

  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];
    (async () => {
      try {
        const [raw, lib, on] = await Promise.all([api.settings.get(FX_CONFIG_KEY), api.settings.get(FX_EFFECTS_KEY), api.fx.status()]);
        if (off) return;
        setCfg(sanitizeFxConfig(raw));
        setLibrary(sanitizeEffectLibrary(lib));
        setRunning(on);
      } catch (e) {
        if (!off) fail("load the effects settings")(e);
      }
      const un = await api.fx.onState((r) => setRunning(r));
      off ? un() : unlisten.push(un);
    })();
    return () => {
      off = true;
      unlisten.forEach((f) => f());
    };
  }, []);

  const update = (next: FxConfig) => {
    const clean = sanitizeFxConfig(next);
    setCfg(clean);
    api.settings.set(FX_CONFIG_KEY, clean).catch(fail("save settings"));
  };
  const setTrail = (p: Partial<FxConfig["trail"]>) => update({ ...cfg, trail: { ...cfg.trail, ...p } });
  const setParticles = (p: Partial<FxConfig["particles"]>) => update({ ...cfg, particles: { ...cfg.particles, ...p } });

  const toggle = () => (running ? api.fx.stop() : api.fx.start()).catch(fail(running ? "stop the effects" : "start the effects"));

  const importEffect = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_EFFECT_FILE * 2) return setNotice("That file is too large to be an effect (limit 32 KB).");
    const res = parseEffectFile(await file.text());
    if (!res.ok) return setNotice(res.error);
    const next = sanitizeEffectLibrary([res.effect, ...library.filter((e) => e.name !== res.effect.name)]).slice(0, MAX_LIBRARY);
    setLibrary(next);
    api.settings.set(FX_EFFECTS_KEY, next).catch(fail("save the effect"));
    setParticles({ effect: res.effect.name, enabled: true });
    setNotice(`Imported “${res.effect.name}”.`);
  };

  const removeEffect = (name: string) => {
    const next = library.filter((e) => e.name !== name);
    setLibrary(next);
    api.settings.set(FX_EFFECTS_KEY, next).catch(fail("remove the effect"));
  };

  const names = [...library.map((e) => e.name), ...BUILTIN_EFFECTS.map((e) => e.name).filter((n) => !library.some((e) => e.name === n))];

  return (
    <section className="panel fx" aria-labelledby="h-fx">
      <h2 id="h-fx">Cursor effects</h2>
      <p className="muted" role="status" aria-live="polite">{running ? "Effects are on." : "Effects are off."} They pause while a fullscreen app runs.</p>
      <div className="row wrap">
        <button className="btn primary" onClick={toggle} aria-pressed={running}>{running ? "Turn effects off" : "Turn effects on"}</button>
      </div>

      <details className="hud-form" open>
        <summary>cursor trail</summary>
        <label className="check"><input type="checkbox" checked={cfg.trail.enabled} onChange={(e) => setTrail({ enabled: e.target.checked })} /> trail enabled</label>
        <label className="field">
          <span>Style</span>
          <select value={cfg.trail.style} onChange={(e) => setTrail({ style: e.target.value as TrailStyle })}>
            {TRAIL_STYLES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {slider("Length", cfg.trail.length, 4, 120, 1, " pts", (v) => setTrail({ length: v }))}
        {slider("Fade time", cfg.trail.fade, 0.1, 3, 0.1, " s", (v) => setTrail({ fade: v }))}
        {slider("Size", cfg.trail.size, 1, 40, 1, " px", (v) => setTrail({ size: v }))}
        <label className="field">
          <span>Colour</span>
          <span className="row"><code className="muted">{cfg.trail.rainbow ? "rainbow" : cfg.trail.color}</code>
            <input type="color" value={cfg.trail.color} disabled={cfg.trail.rainbow} onChange={(e) => setTrail({ color: e.target.value })} /></span>
        </label>
        <label className="check"><input type="checkbox" checked={cfg.trail.rainbow} onChange={(e) => setTrail({ rainbow: e.target.checked })} /> rainbow</label>
        <label className="check"><input type="checkbox" checked={cfg.trail.glow} onChange={(e) => setTrail({ glow: e.target.checked })} /> glow (uses more GPU)</label>
      </details>

      <details className="hud-form">
        <summary>particles that follow the cursor</summary>
        <label className="check"><input type="checkbox" checked={cfg.particles.enabled} onChange={(e) => setParticles({ enabled: e.target.checked })} /> particles enabled</label>
        <label className="field">
          <span>Effect</span>
          <select value={cfg.particles.effect} onChange={(e) => setParticles({ effect: e.target.value })}>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        {slider("Density", cfg.particles.density, 0.1, 3, 0.1, "×", (v) => setParticles({ density: v }))}
        {slider("Size", cfg.particles.sizeScale, 0.25, 3, 0.05, "×", (v) => setParticles({ sizeScale: v }))}
        {slider("Speed", cfg.particles.speedScale, 0.1, 3, 0.05, "×", (v) => setParticles({ speedScale: v }))}
        {slider("Lifetime", cfg.particles.lifetimeScale, 0.2, 3, 0.05, "×", (v) => setParticles({ lifetimeScale: v }))}
        <label className="check">
          <input type="checkbox" checked={cfg.particles.colorOverride !== null} onChange={(e) => setParticles({ colorOverride: e.target.checked ? "#ffffff" : null })} /> use my own colour
          {cfg.particles.colorOverride !== null && (
            <input type="color" value={cfg.particles.colorOverride} onChange={(e) => setParticles({ colorOverride: e.target.value })} />
          )}
        </label>

        <div className="row wrap">
          <button className="btn" onClick={() => fileRef.current?.click()}>import a .dfx effect</button>
          <input ref={fileRef} type="file" accept=".dfx,.json,application/json" hidden onChange={(e) => { importEffect(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {library.length > 0 && (
          <ul className="media-list">
            {library.map((e) => (
              <li key={e.name}><span>{e.name} <span className="muted">· imported</span></span>
                <button className="btn" onClick={() => removeEffect(e.name)} aria-label={`Remove ${e.name}`}>Remove</button></li>
            ))}
          </ul>
        )}
        <p className="muted">Unity particle systems can’t run inside DeskForge. Export one with the Unity script in tools/unity (see docs/EFFECTS.md) and import the .dfx file here.</p>
      </details>

      <details className="hud-form">
        <summary>performance</summary>
        <label className="field">
          <span>Frame rate</span>
          <select value={cfg.fps} onChange={(e) => update({ ...cfg, fps: e.target.value === "30" ? 30 : 60 })}>
            <option value={60}>60 fps (smoothest)</option><option value={30}>30 fps (lighter)</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={cfg.pauseOnFullscreen} onChange={(e) => update({ ...cfg, pauseOnFullscreen: e.target.checked })} /> pause while a fullscreen app runs</label>
        <label className="check"><input type="checkbox" checked={cfg.autostart} onChange={(e) => update({ ...cfg, autostart: e.target.checked })} /> start with DeskForge</label>
        <p className="muted">When nothing is moving and no effect is visible, the overlay checks the cursor only about 8 times a second. Primary monitor only.</p>
      </details>

      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}
