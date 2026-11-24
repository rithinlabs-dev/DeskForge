import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { api, type SystemSnapshot } from "../api";
import { MAX_CSS_BYTES, sanitizeCss } from "../shared/customCss";
import type { Tokens } from "../shared/tokens";
import AppearanceForm from "./AppearanceForm";
import ConsentDialog from "./ConsentDialog";
import { DEFAULT_APPEARANCE, effectiveAppearance, systemGlassTint, type Appearance, type GlassStatus } from "./appearance";
import CustomHudForm from "./CustomHudForm";
import WidgetFrame from "./WidgetFrame";
import useSystemTheme from "./useSystemTheme";
import { customToManifest, type CustomHud } from "./custom";
import { missingPermissions, type Grants } from "./grants";
import type { WidgetManifest } from "./manifest";
import type { WidgetLayout } from "./layout";
import {
  loadAppearance, loadCustom, loadEnabled, loadGrants, loadLayouts, loadOpacity, loadRevs, saveAppearance, saveCustom, saveEnabled, saveGrants,
} from "./persistence";
import { desktopSize, loadCatalog } from "./registry";


export default function WidgetsPanel({ tokens, snapshot }: { tokens: Tokens; snapshot: SystemSnapshot | null }) {
  const [bundled, setBundled] = useState<WidgetManifest[]>([]);
  const [custom, setCustom] = useState<CustomHud[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [grants, setGrants] = useState<Grants>({});
  const [pinned, setPinned] = useState<string[]>([]);
  const [revs, setRevs] = useState<Record<string, number>>({});
  const [opacity, setOpacity] = useState(85);
  const [looks, setLooks] = useState<Record<string, Appearance>>({});
  const [layouts, setLayouts] = useState<Record<string, WidgetLayout>>({});
  const [glassModes, setGlassModes] = useState<Record<string, GlassStatus>>({});
  const [styleFor, setStyleFor] = useState("");
  const [pending, setPending] = useState<WidgetManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const cssTarget = useRef("");
  const nativeApplyTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const systemTheme = useSystemTheme();
  useEffect(() => () => {
    for (const timer of nativeApplyTimers.current.values()) clearTimeout(timer);
    nativeApplyTimers.current.clear();
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const [cat, en, gr, pins, cu, op, rv, lk, ly] = await Promise.all([
          loadCatalog(), loadEnabled(), loadGrants(),
          api.desktop.list().catch(() => [] as string[]),
          loadCustom(), loadOpacity(), loadRevs(), loadAppearance(), loadLayouts(),
        ]);
        if (off) return;
        setBundled(cat.widgets);
        setEnabled(en);
        setGrants(gr);
        setPinned(pins);
        setCustom(cu);
        setOpacity(op);
        setRevs(rv);
        setLooks(lk);
        setLayouts(ly);
        setGlassModes((current) => {
          const next = { ...current };
          for (const [id, appearance] of Object.entries(lk)) {
            if (appearance.glassEnabled && !pins.includes(id)) next[id] = "not-pinned";
            else if (!appearance.glassEnabled) next[id] = "off";
          }
          return next;
        });
        const statuses = await Promise.all(pins.map((id) =>
          api.desktop.glassStatus(id)
            .then((event) => ({ id, event }))
            .catch((error: unknown) => ({ id, error })),
        ));
        if (off) return;
        setGlassModes((current) => {
          const next = { ...current };
          for (const status of statuses) {
            if ("error" in status) {
              next[status.id] = "unavailable";
            } else if (status.event) {
              next[status.id] = status.event.error ? "unavailable" : status.event.effect;
            }
          }
          return next;
        });
        const failedStatus = statuses.find((status) => "error" in status);
        if (failedStatus && "error" in failedStatus) {
          setNotice(`Couldn’t read glass status for ${failedStatus.id}: ${String(failedStatus.error)}`);
        }
        const unavailable = statuses.find((status) => "event" in status && status.event?.error);
        if (unavailable && "event" in unavailable && unavailable.event?.error) {
          setNotice(`Glass failed for ${unavailable.id}: ${unavailable.event.error}`);
        }
        if (cat.errors.length) setNotice(cat.errors.join(" "));
      } catch (e) {
        if (!off) setNotice(`Couldn’t load widgets: ${String(e)}`);
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    let off = false;
    let unlisten: (() => void) | undefined;
    api.settings.onChanged((key) => {
      if (key === "widgets:layout") {
        loadLayouts()
          .then((value) => {
            if (!off) setLayouts(value);
          })
          .catch((error: unknown) => {
            if (!off) setNotice(`Couldn’t load widget layouts: ${String(error)}`);
          });
      }
    }).then((stop) => {
      if (off) stop();
      else unlisten = stop;
    }).catch((error: unknown) => {
      if (!off) setNotice(`Couldn’t monitor widget layouts: ${String(error)}`);
    });
    return () => {
      off = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let off = false;
    let unlisten: (() => void) | undefined;
    api.desktop.onGlass((event) => {
      setGlassModes((current) => ({ ...current, [event.id]: event.error ? "unavailable" : event.effect }));
      if (event.error) setNotice(`Glass failed: ${event.error}`);
    }).then((stop) => {
      if (off) stop();
      else unlisten = stop;
    }).catch((e) => {
      if (!off) setNotice(`Couldn’t monitor native glass status: ${String(e)}`);
    });
    return () => {
      off = true;
      unlisten?.();
    };
  }, []);

  // Widget background slider: saved shortly after you stop dragging; desktop windows pick it up live.
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => api.settings.set("widgets:opacity", opacity).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [opacity, loading]);

  const customIds = useMemo(() => new Set(custom.map((c) => c.id)), [custom]);
  const catalog = useMemo(() => [...bundled, ...custom.map(customToManifest)], [bundled, custom]);
  const byId = useMemo(() => new Map(catalog.map((m) => [m.id, m] as const)), [catalog]);
  const active = enabled.map((id) => byId.get(id)).filter((m): m is WidgetManifest => !!m);
  const available = bundled.filter((m) => !enabled.includes(m.id));
  const fail = (what: string) => (e: unknown) => setNotice(`Couldn’t ${what}: ${String(e)}`);

  const look = (id: string) => effectiveAppearance(looks[id], opacity);
  const applyGlass = (id: string, a: Appearance) => {
    setGlassModes((current) => ({ ...current, [id]: "applying" }));
    api.desktop
      .setGlass(id, a.glassEnabled, a.glassTintOpacity, a.glassTint ?? systemGlassTint(systemTheme), a.glassKind)
      .then((mode) => {
        setGlassModes((current) => ({ ...current, [id]: mode }));
        setNotice(a.glassEnabled ? (mode === "off" ? "Glass is on (drawn by DeskForge, no native effect)." : `Glass is on (${mode}).`) : "Glass is off.");
      })
      .catch((e) => {
        setGlassModes((current) => ({ ...current, [id]: "unavailable" }));
        setNotice(`Glass failed: ${String(e)}`);
      });
  };
  const scheduleGlassApply = (id: string, a: Appearance) => {
    const previous = nativeApplyTimers.current.get(id);
    if (previous) clearTimeout(previous);
    setGlassModes((current) => ({ ...current, [id]: "applying" }));
    nativeApplyTimers.current.set(id, setTimeout(() => {
      nativeApplyTimers.current.delete(id);
      applyGlass(id, a);
    }, 180));
  };
  const setLook = (id: string, patch: Partial<Appearance>) => {
    const cur = look(id);
    // Glass only shows through a mostly transparent background, so turning it on lowers a solid one.
    const p = patch.glassEnabled === true && !cur.glassEnabled && cur.opacity > 50 ? { ...patch, opacity: 30 } : patch;
    const next = { ...looks, [id]: { ...cur, ...p } };
    setLooks(next);
    saveAppearance(next).catch(fail("save the widget look"));
    if (!("glassEnabled" in p || "glassTintOpacity" in p || "glassKind" in p || "glassTint" in p)) return;
    const a = next[id];
    if (!pinned.includes(id)) {
      setGlassModes((current) => ({ ...current, [id]: a.glassEnabled ? "not-pinned" : "off" }));
      if (a.glassEnabled) setNotice("Pin this widget to the desktop to see the glass effect.");
      return;
    }
    scheduleGlassApply(id, a);
  };
  const resetLook = (id: string) => {
    const timer = nativeApplyTimers.current.get(id);
    if (timer) clearTimeout(timer);
    nativeApplyTimers.current.delete(id);
    const next = { ...looks };
    delete next[id];
    setLooks(next);
    saveAppearance(next).catch(fail("save the widget look"));
    if (pinned.includes(id)) applyGlass(id, { ...DEFAULT_APPEARANCE, opacity });
    else setGlassModes((current) => ({ ...current, [id]: "off" }));
  };

  const persistEnabled = (ids: string[]) => {
    setEnabled(ids);
    saveEnabled(ids).catch(fail("save your widgets"));
  };

  const bumpRev = (id: string) => {
    const next = { ...revs, [id]: (revs[id] ?? 0) + 1 };
    setRevs(next);
    api.settings.set("widgets:rev", next).catch(() => {});
  };

  const requestAdd = (m: WidgetManifest) => {
    if (missingPermissions(m, grants[m.id]).length > 0) setPending(m);
    else if (!enabled.includes(m.id)) persistEnabled([...enabled, m.id]);
  };

  const approve = async () => {
    if (!pending) return;
    const m = pending;
    const next: Grants = { ...grants, [m.id]: { version: m.version, permissions: m.permissions } };
    try {
      await saveGrants(next);
      setGrants(next);
      setPending(null);
      if (!enabled.includes(m.id)) persistEnabled([...enabled, m.id]);
      setNotice(`Added “${m.name}”`);
    } catch (e) {
      fail("save permissions")(e);
    }
  };

  // A HUD the user builds themselves is trusted by construction: permissions are granted on creation.
  const createHud = async (hud: CustomHud, css: string) => {
    try {
      const m = customToManifest(hud);
      await api.widgetStore.save(hud.id, { config: { parts: hud.parts }, css });
      const nextCustom = [...custom, hud];
      const nextGrants: Grants = { ...grants, [hud.id]: { version: m.version, permissions: m.permissions } };
      await saveCustom(nextCustom);
      await saveGrants(nextGrants);
      setCustom(nextCustom);
      setGrants(nextGrants);
      persistEnabled([...enabled, hud.id]);
      setNotice(`Created “${hud.name}”. Pin it to the desktop or replace its style with the css button.`);
    } catch (e) {
      fail("create the HUD")(e);
    }
  };

  const onCssFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    const id = cssTarget.current;
    if (!file || !id) return;
    if (file.size > MAX_CSS_BYTES * 2) return setNotice("That file is too large for a HUD stylesheet (limit 48 KB).");
    const res = sanitizeCss(await file.text());
    if (!res.ok) return setNotice(res.error);
    try {
      const store = await api.widgetStore.load(id);
      await api.widgetStore.save(id, { ...store, css: res.css });
      bumpRev(id);
      setNotice(`Updated the style from ${file.name}.`);
    } catch (err) {
      fail("update the style")(err);
    }
  };

  const unpin = async (m: WidgetManifest) => {
    try {
      const timer = nativeApplyTimers.current.get(m.id);
      if (timer) clearTimeout(timer);
      nativeApplyTimers.current.delete(m.id);
      await api.desktop.unpin(m.id);
      setPinned((p) => p.filter((id) => id !== m.id));
      setGlassModes((current) => ({ ...current, [m.id]: "off" }));
    } catch (e) {
      fail("unpin the widget")(e);
    }
  };

  const remove = async (m: WidgetManifest) => {
    if (pinned.includes(m.id)) await unpin(m);
    const next = { ...grants };
    delete next[m.id];
    setGrants(next);
    saveGrants(next).catch(fail("revoke permissions"));
    persistEnabled(enabled.filter((id) => id !== m.id));
    if (customIds.has(m.id)) {
      const nextCustom = custom.filter((c) => c.id !== m.id);
      setCustom(nextCustom);
      saveCustom(nextCustom).catch(fail("delete the HUD"));
      api.widgetStore.save(m.id, {}).catch(() => {});
      setNotice(`Deleted “${m.name}”.`);
    } else {
      setNotice(`Removed “${m.name}” and revoked its permissions. Its saved data is kept.`);
    }
  };

  const pin = async (m: WidgetManifest) => {
    try {
      const { width, height } = desktopSize(m);
      await api.desktop.pin(m.id, width, height);
      setPinned((p) => (p.includes(m.id) ? p : [...p, m.id]));
      if (look(m.id).glassEnabled) setGlassModes((current) => ({ ...current, [m.id]: "applying" }));
      setNotice(`“${m.name}” is on your desktop. Hover over it, then hold the move or resize icon.`);
    } catch (e) {
      fail("pin the widget")(e);
    }
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = enabled.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= enabled.length) return;
    const next = [...enabled];
    [next[i], next[j]] = [next[j], next[i]];
    persistEnabled(next);
  };

  return (
    <section aria-labelledby="h-widgets">
      <div className="widgets-head">
        <h2 id="h-widgets">Widgets</h2>
        <div className="row wrap" role="group" aria-label="Widget options">
          <label className="opacity">
            <span className="muted">widget background</span>
            <input type="range" min={0} max={100} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            <code className="muted">{opacity}%</code>
          </label>
          {available.map((m) => (
            <button key={m.id} className="btn" onClick={() => requestAdd(m)}>Add {m.name}</button>
          ))}
        </div>
      </div>

      {loading && <p className="muted">Loading widgets…</p>}
      {!loading && active.length === 0 && (
        <p className="muted">No widgets yet. Add one above, or create your own HUD below.</p>
      )}

      <ul className="widget-grid">
        {active.map((m, i) => {
          const needs = missingPermissions(m, grants[m.id]);
          const isPinned = pinned.includes(m.id);
          const isCustom = customIds.has(m.id);
          return (
            <li key={m.id} className={`widget${m.cols === 2 ? " span2" : ""}`}>
              <div className="widget-bar">
                <span>{m.name}</span>
                <span className="row wrap">
                  <button className="btn" onClick={() => setStyleFor(styleFor === m.id ? "" : m.id)} aria-expanded={styleFor === m.id} aria-label={`Appearance of ${m.name}`}>Look</button>
                  <button className="btn" onClick={() => move(m.id, -1)} disabled={i === 0} aria-label={`Move ${m.name} earlier`}>Earlier</button>
                  <button className="btn" onClick={() => move(m.id, 1)} disabled={i === active.length - 1} aria-label={`Move ${m.name} later`}>Later</button>
                  {isCustom && (
                    <button
                      className="btn"
                      onClick={() => {
                        cssTarget.current = m.id;
                        fileRef.current?.click();
                      }}
                      aria-label={`Replace the style of ${m.name} with a CSS file`}
                    >
                      css
                    </button>
                  )}
                  <button
                    className="btn"
                    onClick={() => (isPinned ? unpin(m) : pin(m))}
                    disabled={needs.length > 0}
                    aria-label={isPinned ? `Remove ${m.name} from the desktop` : `Pin ${m.name} to the desktop`}
                  >
                    {isPinned ? "Unpin" : "Pin to desktop"}
                  </button>
                  <button className="btn" onClick={() => remove(m)} aria-label={`${isCustom ? "Delete" : "Remove"} ${m.name}`}>
                    {isCustom ? "Delete" : "Remove"}
                  </button>
                </span>
              </div>
              {styleFor === m.id && <AppearanceForm name={m.name} value={look(m.id)} systemTheme={systemTheme} glassStatus={glassModes[m.id]} widgetId={m.id} pinned={isPinned} onChange={(p) => setLook(m.id, p)} onReset={() => resetLook(m.id)} />}
              {needs.length > 0 ? (
                <div className="panel widget-pending" style={{ minHeight: m.height }}>
                  <p>{m.name} needs new permissions.</p>
                  <button className="btn primary" onClick={() => setPending(m)}>Review</button>
                </div>
              ) : (
                <WidgetFrame
                  key={`${m.id}:${revs[m.id] ?? 0}`}
                  manifest={m}
                  granted={grants[m.id].permissions}
                  tokens={tokens}
                  snapshot={snapshot}
                  appearance={look(m.id)}
                  layout={layouts[m.id] ?? {}}
                  systemTheme={systemTheme}
                />
              )}
              {isPinned && <p className="muted">Hover the desktop widget and select the pencil to edit its layout in place.</p>}
            </li>
          );
        })}
      </ul>

      <CustomHudForm onCreate={createHud} />
      <input ref={fileRef} type="file" accept=".css,text/css" onChange={onCssFile} hidden />

      <p className="notice" role="status" aria-live="polite">{notice}</p>
      {pending && <ConsentDialog manifest={pending} onApprove={approve} onCancel={() => setPending(null)} />}
    </section>
  );
}
