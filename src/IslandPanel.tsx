import { useEffect, useState } from "react";
import { api, type NowPlaying } from "./api";
import { FONT_LABELS, type FontKey } from "./tokens";
import {
  ANCHORS, ANCHOR_LABELS, ANIMATIONS, ANIMATION_LABELS, DEFAULT_ISLAND, DEFAULT_POSITION, FONT_CHOICES, ISLAND_CONFIG_KEY, PILL_LABELS,
  PILL_MODULES, TABS, TAB_LABELS, moveItem, sanitizeIslandConfig,
  type Anchor, type AnimationKind, type Hour12, type IslandAppearance, type IslandBehavior, type IslandConfig, type IslandContent, type IslandPosition,
  type PillModule, type Tab,
} from "./island/config";
import { trackLabel } from "./island/format";
import { DEFAULT_POMODORO, POMODORO_CONFIG_KEY, sanitizePomodoroConfig, type PomodoroConfig } from "./island/pomodoro";
import {
  BUILTIN_PRESETS, PRESETS_KEY, applyPreset, makePreset, matchesPreset, parsePreset, sanitizePresetList, savePreset, serializePreset,
  type IslandPreset,
} from "./island/presets";

function Slider(props: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const { label, value, min, max, step = 1, unit = "", onChange } = props;
  return (
    <label className="field">
      <span>{label}</span>
      <span className="row">
        <code className="muted">{value}{unit}</code>
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </span>
    </label>
  );
}

function Check(props: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="check">
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} /> {props.label}
    </label>
  );
}

function ColorField(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      <span className="row">
        <input type="color" value={props.value} aria-label={props.label} onChange={(e) => props.onChange(e.target.value)} />
        <code className="muted">{props.value}</code>
      </span>
    </label>
  );
}

/** An ordered list of choices: the ones that are on (with up/down/remove) and buttons to add the ones that are off. */
function OrderedChoices<T extends string>(props: {
  title: string; all: readonly T[]; labels: Record<T, string>; value: T[]; onChange: (next: T[]) => void;
}) {
  const { title, all, labels, value, onChange } = props;
  const off = all.filter((x) => !value.includes(x));
  return (
    <div className="field">
      <span>{title}</span>
      <ol className="media-list" aria-label={title}>
        {value.map((item, i) => (
          <li key={item}>
            <span>{labels[item]}</span>
            <span className="row">
              <button className="btn" onClick={() => onChange(moveItem(value, i, -1))} disabled={i === 0} aria-label={`Move ${labels[item]} up`}>↑</button>
              <button className="btn" onClick={() => onChange(moveItem(value, i, 1))} disabled={i === value.length - 1} aria-label={`Move ${labels[item]} down`}>↓</button>
              <button className="btn" onClick={() => onChange(value.filter((x) => x !== item))} disabled={value.length === 1} aria-label={`Remove ${labels[item]}`}>remove</button>
            </span>
          </li>
        ))}
      </ol>
      {off.length > 0 && (
        <span className="row wrap">
          <span className="muted">Add:</span>
          {off.map((item) => <button key={item} className="btn" onClick={() => onChange([...value, item])}>{labels[item]}</button>)}
        </span>
      )}
    </div>
  );
}

export default function IslandPanel() {
  const [cfg, setCfg] = useState<IslandConfig>(DEFAULT_ISLAND);
  const [pcfg, setPcfg] = useState<PomodoroConfig>(DEFAULT_POMODORO);
  const [saved, setSaved] = useState<IslandPreset[]>([]);
  const [monitors, setMonitors] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [playing, setPlaying] = useState<NowPlaying | null>(null);
  const [presetName, setPresetName] = useState("");
  const [shareText, setShareText] = useState("");
  const [importText, setImportText] = useState("");
  const [notice, setNotice] = useState("");
  const fail = (what: string) => (e: unknown) => setNotice(`Couldn’t ${what}: ${String(e)}`);

  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];
    (async () => {
      try {
        const [rawCfg, rawPcfg, rawPresets, on, np, names] = await Promise.all([
          api.settings.get(ISLAND_CONFIG_KEY), api.settings.get(POMODORO_CONFIG_KEY), api.settings.get(PRESETS_KEY),
          api.island.status(), api.nowPlaying.state(), api.island.monitors().catch(() => [] as string[]),
        ]);
        if (off) return;
        setCfg(sanitizeIslandConfig(rawCfg));
        setPcfg(sanitizePomodoroConfig(rawPcfg));
        setSaved(sanitizePresetList(rawPresets));
        setRunning(on);
        setPlaying(np);
        setMonitors(names);
      } catch (e) {
        if (!off) fail("load the island’s settings")(e);
      }
      const stops = await Promise.all([
        api.island.onState(setRunning),
        api.nowPlaying.onChange(setPlaying),
        // the island saves its own position when you drag it: keep these controls in step
        api.settings.onChanged((key) => {
          if (key === ISLAND_CONFIG_KEY) api.settings.get(ISLAND_CONFIG_KEY).then((raw) => !off && setCfg(sanitizeIslandConfig(raw))).catch(() => {});
        }),
      ]);
      stops.forEach((stop) => (off ? stop() : unlisten.push(stop)));
    })();
    return () => {
      off = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);

  const save = (next: IslandConfig) => {
    const clean = sanitizeIslandConfig(next);
    setCfg(clean);
    api.settings.set(ISLAND_CONFIG_KEY, clean).catch(fail("save the island’s settings"));
  };
  const setA = (p: Partial<IslandAppearance>) => save({ ...cfg, appearance: { ...cfg.appearance, ...p } });
  const setC = (p: Partial<IslandContent>) => save({ ...cfg, content: { ...cfg.content, ...p } });
  const setPos = (p: Partial<IslandPosition>) => save({ ...cfg, position: { ...cfg.position, ...p } });
  const setB = (p: Partial<IslandBehavior>) => save({ ...cfg, behavior: { ...cfg.behavior, ...p } });
  const updatePomodoro = (next: PomodoroConfig) => {
    const clean = sanitizePomodoroConfig(next);
    setPcfg(clean);
    api.settings.set(POMODORO_CONFIG_KEY, clean).catch(fail("save the timer settings"));
  };
  const persistPresets = (list: IslandPreset[]) => {
    setSaved(list);
    api.settings.set(PRESETS_KEY, list).catch(fail("save your looks"));
  };

  const a = cfg.appearance;
  const c = cfg.content;
  const pos = cfg.position;
  const b = cfg.behavior;
  const toggle = () => (running ? api.island.stop() : api.island.start()).catch(fail(running ? "close the island" : "open the island"));
  const hasTrack = !!playing && (playing.title || playing.artist);

  const copyLook = async () => {
    const text = serializePreset(makePreset(presetName || "My island", cfg));
    setShareText(text);
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied. Paste it into a message to share this look.");
    } catch {
      setNotice("Couldn’t copy automatically: select the text below and copy it.");
    }
  };
  const importLook = () => {
    const result = parsePreset(importText);
    if (!result.ok) return setNotice(result.error);
    persistPresets(savePreset(saved, result.preset));
    save(applyPreset(cfg, result.preset));
    setImportText("");
    setNotice(`Imported “${result.preset.name}” and applied it.`);
  };

  const monitorOptions = monitors.length > 0 ? monitors : ["Main display"];

  return (
    <section className="panel island-panel" aria-labelledby="h-island">
      <h2 id="h-island">Floating island</h2>
      <p className="muted" role="status" aria-live="polite">
        {running ? "The island is on. Every setting below changes it live." : "A pill on your screen that opens into music controls, a focus timer and quick tools. Everything about it can be changed here."}
      </p>
      <div className="row wrap">
        <button className="btn primary" onClick={toggle} aria-pressed={running}>{running ? "Turn the island off" : "Turn the island on"}</button>
      </div>
      {running && (
        <p className="muted">
          {hasTrack && playing ? `Now playing in ${playing.app || "your player"}: ${trackLabel(playing.title, playing.artist)}` : "Nothing is playing. Start Spotify (or any player) and it will appear."}
        </p>
      )}

      <details className="hud-form" open>
        <summary>looks: presets, save, share</summary>
        <label className="field">
          <span>Try a look</span>
          <select
            value=""
            aria-label="Apply a look"
            onChange={(e) => {
              const [kind, ...rest] = e.target.value.split(":");
              const name = rest.join(":");
              const preset = (kind === "b" ? BUILTIN_PRESETS : saved).find((p) => p.name === name);
              if (preset) save(applyPreset(cfg, preset));
            }}
          >
            <option value="">choose…</option>
            <optgroup label="Built in">
              {BUILTIN_PRESETS.map((p) => <option key={p.name} value={`b:${p.name}`}>{p.name}{matchesPreset(cfg, p) ? " (current)" : ""}</option>)}
            </optgroup>
            {saved.length > 0 && (
              <optgroup label="Mine">
                {saved.map((p) => <option key={p.name} value={`m:${p.name}`}>{p.name}{matchesPreset(cfg, p) ? " (current)" : ""}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <p className="muted">A look is the colours, size, shape and what the island shows. Trying one never moves your island or changes how it behaves.</p>
        <div className="row wrap">
          <input type="text" value={presetName} maxLength={40} placeholder="name this look" aria-label="Name for this look" onChange={(e) => setPresetName(e.target.value)} />
          <button className="btn" onClick={() => { const p = makePreset(presetName, cfg); persistPresets(savePreset(saved, p)); setNotice(`Saved “${p.name}”.`); setPresetName(""); }}>Save this look</button>
          <button className="btn" onClick={copyLook}>Copy to share</button>
        </div>
        {saved.length > 0 && (
          <ul className="media-list" aria-label="Your saved looks">
            {saved.map((p) => (
              <li key={p.name}>
                <span>{p.name}</span>
                <span className="row">
                  <button className="btn" onClick={() => save(applyPreset(cfg, p))}>Use</button>
                  <button className="btn" onClick={() => persistPresets(saved.filter((x) => x.name !== p.name))} aria-label={`Delete ${p.name}`}>Delete</button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {shareText && <textarea readOnly rows={4} value={shareText} aria-label="Look text to copy" onFocus={(e) => e.currentTarget.select()} style={{ width: "100%" }} />}
        <label className="field">
          <span>Got a look from someone? Paste it here</span>
          <textarea rows={3} value={importText} aria-label="Paste a look" placeholder="paste the text of a look" onChange={(e) => setImportText(e.target.value)} style={{ width: "100%" }} />
        </label>
        <button className="btn" onClick={importLook} disabled={!importText.trim()}>Import and use</button>
      </details>

      <details className="hud-form">
        <summary>appearance: colours, size, shape</summary>
        <Slider label="Overall size" value={a.scale} min={0.6} max={1.8} step={0.05} unit="×" onChange={(v) => setA({ scale: v })} />
        <Slider label="Closed pill width" value={a.pillWidth} min={160} max={520} unit=" px" onChange={(v) => setA({ pillWidth: v })} />
        <Slider label="Open panel width" value={a.panelWidth} min={320} max={640} unit=" px" onChange={(v) => setA({ panelWidth: v })} />
        <ColorField label="Background" value={a.bg} onChange={(v) => setA({ bg: v })} />
        <Check label="gradient background" checked={a.bg2 !== null} onChange={(on) => setA({ bg2: on ? (a.bg2 ?? "#1a2650") : null })} />
        {a.bg2 !== null && (
          <>
            <ColorField label="Gradient end colour" value={a.bg2} onChange={(v) => setA({ bg2: v })} />
            <Slider label="Gradient angle" value={a.bgAngle} min={0} max={360} unit="°" onChange={(v) => setA({ bgAngle: v })} />
          </>
        )}
        <Slider label="Background opacity" value={a.opacity} min={20} max={100} unit="%" onChange={(v) => setA({ opacity: v })} />
        <ColorField label="Text colour" value={a.text} onChange={(v) => setA({ text: v })} />
        <Check label="use my theme’s accent colour" checked={a.accent === null} onChange={(on) => setA({ accent: on ? null : "#4aa3ff" })} />
        {a.accent !== null && <ColorField label="Accent colour" value={a.accent} onChange={(v) => setA({ accent: v })} />}
        <Slider label="Corner roundness" value={a.radius} min={0} max={40} unit=" px" onChange={(v) => setA({ radius: v })} />
        <Slider label="Border thickness" value={a.borderWidth} min={0} max={6} unit=" px" onChange={(v) => setA({ borderWidth: v })} />
        {a.borderWidth > 0 && (
          <>
            <ColorField label="Border colour" value={a.borderColor} onChange={(v) => setA({ borderColor: v })} />
            <Slider label="Border strength" value={a.borderOpacity} min={0} max={100} unit="%" onChange={(v) => setA({ borderOpacity: v })} />
          </>
        )}
        <Slider label="Shadow" value={a.shadow} min={0} max={100} unit="%" onChange={(v) => setA({ shadow: v })} />
        <label className="field">
          <span>Font</span>
          <select value={a.font} onChange={(e) => setA({ font: e.target.value as FontKey | "theme" })}>
            {FONT_CHOICES.map((f) => <option key={f} value={f}>{f === "theme" ? "Same as my theme" : FONT_LABELS[f]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Animation</span>
          <select value={a.animation} onChange={(e) => setA({ animation: e.target.value as AnimationKind })}>
            {ANIMATIONS.map((x) => <option key={x} value={x}>{ANIMATION_LABELS[x]}</option>)}
          </select>
        </label>
        <Slider label="Fade the closed pill when idle" value={a.idleDim} min={20} max={100} unit="%" onChange={(v) => setA({ idleDim: v })} />
        <p className="muted">100% means it never fades. It brightens as soon as you point at it.</p>
      </details>

      <details className="hud-form">
        <summary>position: where it sits</summary>
        <label className="field">
          <span>Hangs from</span>
          <select value={pos.anchor} onChange={(e) => setPos({ anchor: e.target.value as Anchor })}>
            {ANCHORS.map((x) => <option key={x} value={x}>{ANCHOR_LABELS[x]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Screen</span>
          <select value={Math.min(pos.monitor, monitorOptions.length - 1)} onChange={(e) => setPos({ monitor: Number(e.target.value) })}>
            {monitorOptions.map((name, i) => <option key={name} value={i}>{name}</option>)}
          </select>
        </label>
        <Slider label="Distance sideways" value={pos.x} min={-300} max={900} unit=" px" onChange={(v) => setPos({ x: v })} />
        <Slider label="Distance up/down" value={pos.y} min={-100} max={900} unit=" px" onChange={(v) => setPos({ y: v })} />
        <Check label="lock the position" checked={pos.locked} onChange={(v) => setPos({ locked: v })} />
        <p className="muted">Untick the lock, then drag the closed pill with your mouse to put it exactly where you want it. It remembers the spot.</p>
        <button className="btn" onClick={() => setPos({ ...DEFAULT_POSITION, locked: pos.locked })}>Reset position</button>
      </details>

      <details className="hud-form">
        <summary>pill: what the closed island shows</summary>
        <OrderedChoices<PillModule> title="Shows the first of these that applies" all={PILL_MODULES} labels={PILL_LABELS} value={c.pill} onChange={(pill) => setC({ pill })} />
        <label className="field">
          <span>Clock</span>
          <select value={c.clock.hour12} onChange={(e) => setC({ clock: { ...c.clock, hour12: e.target.value as Hour12 } })}>
            <option value="auto">Follow Windows</option>
            <option value="12">12 hour</option>
            <option value="24">24 hour</option>
          </select>
        </label>
        <Check label="show seconds" checked={c.clock.seconds} onChange={(seconds) => setC({ clock: { ...c.clock, seconds } })} />
        <Check label="show the date" checked={c.clock.date} onChange={(date) => setC({ clock: { ...c.clock, date } })} />
      </details>

      <details className="hud-form">
        <summary>panel: tabs and what is in them</summary>
        <OrderedChoices<Tab> title="Tabs, in order" all={TABS} labels={TAB_LABELS} value={c.tabs} onChange={(tabs) => setC({ tabs })} />
        <label className="field">
          <span>Opens on</span>
          <select value={c.defaultTab} onChange={(e) => setC({ defaultTab: e.target.value as Tab })}>
            {c.tabs.map((t) => <option key={t} value={t}>{TAB_LABELS[t]}</option>)}
          </select>
        </label>
        <p className="label">Music tab</p>
        <Check label="album art" checked={c.music.art} onChange={(art) => setC({ music: { ...c.music, art } })} />
        <Check label="progress bar" checked={c.music.progress} onChange={(progress) => setC({ music: { ...c.music, progress } })} />
        <Check label="volume buttons" checked={c.music.volume} onChange={(volume) => setC({ music: { ...c.music, volume } })} />
        <Check label="name of the player" checked={c.music.app} onChange={(app) => setC({ music: { ...c.music, app } })} />
        <p className="label">Focus tab</p>
        <Check label="“what are you focusing on” box" checked={c.focus.task} onChange={(task) => setC({ focus: { ...c.focus, task } })} />
        <Check label="today’s sessions and minutes" checked={c.focus.stats} onChange={(stats) => setC({ focus: { ...c.focus, stats } })} />
        <Check label="break tips" checked={c.focus.tips} onChange={(tips) => setC({ focus: { ...c.focus, tips } })} />
        <p className="label">Tools tab</p>
        <Check label="CPU and memory" checked={c.tools.meters} onChange={(meters) => setC({ tools: { ...c.tools, meters } })} />
        <Check label="quick launch apps" checked={c.tools.launchers} onChange={(launchers) => setC({ tools: { ...c.tools, launchers } })} />
        {c.tools.launchers && <Slider label="How many apps" value={c.tools.launcherCount} min={0} max={12} onChange={(launcherCount) => setC({ tools: { ...c.tools, launcherCount } })} />}
      </details>

      <details className="hud-form">
        <summary>behaviour: when it opens, closes and hides</summary>
        <Check label="show it when DeskForge starts" checked={cfg.autostart} onChange={(autostart) => save({ ...cfg, autostart })} />
        <Check label="hide while a fullscreen app or game runs" checked={cfg.pauseOnFullscreen} onChange={(pauseOnFullscreen) => save({ ...cfg, pauseOnFullscreen })} />
        <Check label="open when I rest the pointer on it (clicking always works)" checked={b.hoverExpand} onChange={(hoverExpand) => setB({ hoverExpand })} />
        {b.hoverExpand && <Slider label="Wait before opening" value={b.expandDelay} min={0} max={1500} step={10} unit=" ms" onChange={(expandDelay) => setB({ expandDelay })} />}
        <Slider label="Wait before closing" value={b.collapseDelay} min={100} max={5000} step={50} unit=" ms" onChange={(collapseDelay) => setB({ collapseDelay })} />
        <Check label="open briefly when the song changes or a timer ends" checked={b.peek} onChange={(peek) => setB({ peek })} />
        {b.peek && <Slider label="How long it stays open" value={b.peekMs} min={1000} max={15000} step={250} unit=" ms" onChange={(peekMs) => setB({ peekMs })} />}
      </details>

      <details className="hud-form">
        <summary>focus timer (Pomodoro)</summary>
        <Slider label="Focus" value={pcfg.focusMin} min={1} max={90} unit=" min" onChange={(v) => updatePomodoro({ ...pcfg, focusMin: v })} />
        <Slider label="Short break" value={pcfg.shortMin} min={1} max={30} unit=" min" onChange={(v) => updatePomodoro({ ...pcfg, shortMin: v })} />
        <Slider label="Long break" value={pcfg.longMin} min={1} max={60} unit=" min" onChange={(v) => updatePomodoro({ ...pcfg, longMin: v })} />
        <Slider label="Long break after" value={pcfg.longEvery} min={2} max={8} unit=" sessions" onChange={(v) => updatePomodoro({ ...pcfg, longEvery: v })} />
        <Check label="start the next phase by itself" checked={pcfg.autoStart} onChange={(autoStart) => updatePomodoro({ ...pcfg, autoStart })} />
        <Check label="play a soft beep when a phase ends" checked={pcfg.sound} onChange={(sound) => updatePomodoro({ ...pcfg, sound })} />
        <p className="muted">Your timer, task and today’s count are kept when you close DeskForge. Changing a duration updates a timer that isn’t running straight away.</p>
      </details>

      <div className="row wrap">
        <button className="btn" onClick={() => { save(DEFAULT_ISLAND); setNotice("The island is back to its original settings."); }}>Reset everything to the original</button>
      </div>
      <p className="muted">Music controls use the Windows media session, so they work with Spotify, Apple Music, VLC and browser tabs without any login. The volume buttons press your keyboard’s volume keys.</p>
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
  );
}
