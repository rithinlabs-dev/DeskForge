import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { systemGlassTint, type Appearance, type GlassKind, type SystemTheme } from "./appearance";
import {
  diagnosticLine, fallbackDiagnostics, newTrials, recommend, trialPlan, trialText,
  type GlassDiagnostics, type GlassMethodKind, type Trial,
} from "./glassWizard";

const PAUSE_MS = 1600; // long enough to see the effect on the desktop widget before the next method replaces it
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Glass Effect Wizard. Asks Windows what it supports, shows every method on the real pinned widget one after another,
 * and lets the user pick the one that actually looks right. "Accepted" only means Windows did not refuse the call, so
 * the final choice is always the user's. If nothing looks right, the translucent sheen works on every PC.
 */
export default function GlassWizard(props: {
  widgetId: string;
  name: string;
  value: Appearance;
  systemTheme: SystemTheme;
  pinned: boolean;
  onChoose: (kind: GlassKind) => void;
}) {
  const { widgetId, name, value, systemTheme, pinned, onChoose } = props;
  const [diag, setDiag] = useState<GlassDiagnostics | null>(null);
  const [diagError, setDiagError] = useState("");
  const [trials, setTrials] = useState<Trial[]>([]);
  const [running, setRunning] = useState(false);
  const [suggested, setSuggested] = useState<GlassMethodKind | null>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    let off = false;
    api.desktop
      .glassDiagnostics()
      .then((d) => !off && setDiag(d))
      .catch((e: unknown) => {
        if (off) return;
        setDiagError(`Couldn’t read what this Windows supports (${String(e)}). You can still test every method.`);
        setDiag(fallbackDiagnostics());
      });
    return () => {
      off = true;
      cancelled.current = true; // stops a running test; the widget is put back the way it was
    };
  }, []);

  const run = async () => {
    if (!diag || running) return;
    const plan = trialPlan(diag);
    const results = newTrials(plan);
    const tint = value.glassTint ?? systemGlassTint(systemTheme);
    cancelled.current = false;
    setSuggested(null);
    setRunning(true);
    setTrials([...results]);
    for (let i = 0; i < plan.length && !cancelled.current; i++) {
      results[i] = { ...results[i], status: "trying" };
      setTrials([...results]);
      try {
        const effect = await api.desktop.setGlass(widgetId, true, value.glassTintOpacity, tint, plan[i]);
        results[i] = { kind: plan[i], status: "accepted", effect, error: null };
      } catch (e) {
        results[i] = { kind: plan[i], status: "rejected", effect: null, error: String(e) };
      }
      setTrials([...results]);
      if (results[i].status === "accepted") await sleep(PAUSE_MS);
    }
    try {
      // Put the widget back the way it was; the user's pick (if any) is applied by onChoose.
      await api.desktop.setGlass(widgetId, value.glassEnabled, value.glassTintOpacity, tint, value.glassKind);
    } catch {
      /* the status line in the Look panel reports it */
    }
    setRunning(false);
    if (!cancelled.current) setSuggested(recommend(results, diag));
  };

  const trialFor = (kind: string) => trials.find((t) => t.kind === kind);
  const blocked = !pinned
    ? "Pin this widget to the desktop first: the wizard tests the real desktop window."
    : !value.glassEnabled
      ? "Turn glass on above, then run the wizard."
      : "";

  return (
    <div className="look-form glass-wizard" role="group" aria-label={`Glass effect wizard for ${name}`}>
      {diag && <p className="muted">{diagnosticLine(diag)}</p>}
      {diagError && <p className="notice" role="status">{diagError}</p>}
      <p className="muted">
        The wizard shows each method on your desktop widget, one after another. Windows can accept a method without
        showing it, so judge by eye and press “Use this” on the one that looks frosted. Frosted wallpaper needs no
        test: DeskForge draws it itself.
      </p>
      <div className="row wrap">
        <button className="btn primary" type="button" onClick={run} disabled={!diag || running || !!blocked}>
          {running ? "Testing… watch your desktop widget" : "Test every method"}
        </button>
        {running && (
          <button className="btn" type="button" onClick={() => { cancelled.current = true; }}>
            stop
          </button>
        )}
      </div>
      {blocked && <p className="muted" role="status">{blocked}</p>}

      <ul className="media-list" aria-label="Glass methods">
        <li>
          <span>
            Automatic <span className="muted">· tries acrylic, then blur, then the Windows 11 materials</span>
            {value.glassKind === "auto" && <strong> · selected</strong>}
          </span>
          <button className="btn" type="button" onClick={() => onChoose("auto")} disabled={running}>Use this</button>
        </li>
        {diag?.methods.map((m) => {
          const trial = trialFor(m.kind);
          const canUse = m.supported || m.kind === "sheen";
          return (
            <li key={m.kind}>
              <span>
                {m.label}
                {value.glassKind === m.kind && <strong> · selected</strong>}
                {suggested === m.kind && <strong> · suggested</strong>}
                <span className="muted">
                  {" · "}
                  {!m.supported ? "not supported on this Windows build" : trial ? trialText(trial) : m.note}
                </span>
              </span>
              <button className="btn" type="button" onClick={() => onChoose(m.kind)} disabled={running || !canUse}>
                Use this
              </button>
            </li>
          );
        })}
      </ul>

      {suggested && (
        <p className="muted" role="status">
          {suggested === "wallpaper" || suggested === "sheen"
            ? "Windows accepted no native method, so the frosted wallpaper (drawn by DeskForge) is the safe choice."
            : `Suggested: ${diag?.methods.find((m) => m.kind === suggested)?.label ?? suggested}. If it didn’t look frosted on your desktop, pick another, or use the frosted wallpaper.`}
        </p>
      )}
    </div>
  );
}
