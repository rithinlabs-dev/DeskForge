import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { api, type AppEntry, type MediaControl, type NowPlaying, type SystemSnapshot } from "../api";
import { DEFAULT_TOKENS, applyTokens, sanitizeTokens, type Tokens } from "../tokens";
import {
  ANIMATION_MS, DEFAULT_ISLAND, ISLAND_CONFIG_KEY, TAB_LABELS, anchorParts, dragOffsets, islandSizes, sanitizeIslandConfig,
  type IslandConfig, type Tab,
} from "./config";
import { collapsedView, formatClock, fraction, mmss, playbackPosition, trackLabel } from "./format";
import {
  DEFAULT_POMODORO, MAX_TASK, PHASE_LABEL, POMODORO_CONFIG_KEY, POMODORO_STATE_KEY, applyConfig, breakTip, initialState, pause,
  progress, remaining, reset, sanitizePomodoroConfig, sanitizePomodoroState, setTask, skip, start, tick,
  type Phase, type PomodoroConfig, type PomodoroState,
} from "./pomodoro";
import { islandCssVars } from "./style";

const NO_MUSIC: NowPlaying = {
  available: false, app: "", title: "", artist: "", album: "", status: "none", positionMs: 0, durationMs: 0, art: null,
  canPlayPause: false, canNext: false, canPrevious: false, updatedMs: 0,
};

const RING = 2 * Math.PI * 9; // circumference of the small progress ring in the pill
const DRAG_THRESHOLD = 4; // pixels the pointer must travel before a press on the pill becomes a drag

let audio: AudioContext | null = null;
/** Two soft beeps. Silent (and harmless) if the page isn't allowed to make sound. */
function beep() {
  try {
    if (!audio) audio = new AudioContext();
    const ctx = audio;
    void ctx.resume();
    const t0 = ctx.currentTime;
    for (const offset of [0, 0.24]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t0 + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + offset);
      osc.stop(t0 + offset + 0.22);
    }
  } catch {
    /* no sound available */
  }
}

export default function Island() {
  const [tokens, setTokens] = useState<Tokens>(DEFAULT_TOKENS);
  const [cfg, setCfg] = useState<IslandConfig>(DEFAULT_ISLAND);
  const [pcfg, setPcfg] = useState<PomodoroConfig>(DEFAULT_POMODORO);
  const [p, setP] = useState<PomodoroState>(() => initialState(DEFAULT_POMODORO, Date.now()));
  const [np, setNp] = useState<NowPlaying>(NO_MUSIC);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [tab, setTab] = useState<Tab>("music");
  const [snap, setSnap] = useState<SystemSnapshot | null>(null);
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");

  // Timers and handlers read the latest values from refs, so they never act on stale state.
  const pRef = useRef(p);
  const pcfgRef = useRef(pcfg);
  const cfgRef = useRef(cfg);
  const pinnedRef = useRef(false);
  const hovering = useRef(false);
  const lastTrack = useRef<string | null>(null);
  const tabInit = useRef(false);
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRaf = useRef(0);
  const drag = useRef<{ sx: number; sy: number; x0: number; y0: number; x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  pinnedRef.current = pinned;

  const a = cfg.appearance;
  const c = cfg.content;
  const pos = cfg.position;
  const anchor = anchorParts(pos.anchor);
  const shownTab: Tab = c.tabs.includes(tab) ? tab : c.tabs[0];

  useEffect(() => applyTokens(tokens), [tokens]);

  /** Every change to the timer goes through here: show it, remember it, and keep it across restarts. */
  const commitP = useCallback((next: PomodoroState) => {
    pRef.current = next;
    setP(next);
    api.settings.set(POMODORO_STATE_KEY, next).catch(() => {});
  }, []);

  const peek = useCallback((ms: number) => {
    setOpen(true);
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => {
      if (!pinnedRef.current && !hovering.current) setOpen(false);
    }, ms);
  }, []);

  // Settings and saved timer state.
  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];
    const loadSettings = async () => {
      const [rawTokens, rawCfg, rawPcfg] = await Promise.all([
        api.settings.get("tokens"), api.settings.get(ISLAND_CONFIG_KEY), api.settings.get(POMODORO_CONFIG_KEY),
      ]);
      if (off) return;
      setTokens(sanitizeTokens(rawTokens));
      const nextCfg = sanitizeIslandConfig(rawCfg);
      cfgRef.current = nextCfg;
      setCfg(nextCfg);
      if (!tabInit.current) {
        tabInit.current = true;
        setTab(nextCfg.content.defaultTab);
      }
      const nextP = sanitizePomodoroConfig(rawPcfg);
      pcfgRef.current = nextP;
      setPcfg(nextP);
      const applied = applyConfig(pRef.current, nextP); // new durations show on an idle timer straight away
      if (applied !== pRef.current) {
        pRef.current = applied;
        setP(applied);
      }
    };
    (async () => {
      try {
        await loadSettings();
        const saved = sanitizePomodoroState(await api.settings.get(POMODORO_STATE_KEY), pcfgRef.current, Date.now());
        if (off) return;
        pRef.current = saved;
        setP(saved);
        setTaskDraft(saved.task);
        setLoaded(true);
      } catch (e) {
        if (!off) setNotice(`Couldn’t load the island’s settings: ${String(e)}`);
      }
    })();
    api.settings
      .onChanged((key) => {
        if (key === "tokens" || key === ISLAND_CONFIG_KEY || key === POMODORO_CONFIG_KEY) loadSettings().catch(() => {});
      })
      .then((stop) => (off ? stop() : unlisten.push(stop)))
      .catch(() => {});
    return () => {
      off = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);

  // What is playing. A new track makes the island peek open for a moment (if that is switched on).
  useEffect(() => {
    let off = false;
    const unlisten: Array<() => void> = [];
    const key = (s: NowPlaying) => `${s.app}\u0001${s.title}\u0001${s.artist}`;
    api.nowPlaying.state().then((s) => {
      if (off) return;
      lastTrack.current = key(s);
      setNp(s);
    }).catch(() => {});
    api.nowPlaying
      .onChange((s) => {
        if (off) return;
        const k = key(s);
        const changed = lastTrack.current !== null && k !== lastTrack.current;
        lastTrack.current = k;
        setNp(s);
        const behavior = cfgRef.current.behavior;
        if (changed && s.status === "playing" && s.title && behavior.peek) peek(behavior.peekMs);
      })
      .then((stop) => (off ? stop() : unlisten.push(stop)))
      .catch(() => {});
    return () => {
      off = true;
      unlisten.forEach((stop) => stop());
    };
  }, [peek]);

  // The clock the pill and the progress bars read.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // Hide while a fullscreen app runs (Rust decides; this just asks every couple of seconds).
  useEffect(() => {
    const id = setInterval(() => api.island.tick().catch(() => {}), 2000);
    return () => clearInterval(id);
  }, []);

  /** Tells Rust how big the window must be and where it goes (anchor, offsets, monitor from the settings). */
  const sendWindow = useCallback((openNow: boolean, offsets?: { x: number; y: number }) => {
    const conf = cfgRef.current;
    const size = islandSizes(conf.appearance)[openNow ? "open" : "collapsed"];
    const where = conf.position;
    return api.island.resize(size.width, size.height, where.anchor, offsets?.x ?? where.x, offsets?.y ?? where.y, where.monitor);
  }, []);

  // The window is as big as the island: grow it first, then animate; shrink it only after the animation is done.
  useEffect(() => {
    clearTimeout(resizeTimer.current);
    if (open) {
      sendWindow(true).catch(() => {});
    } else {
      resizeTimer.current = setTimeout(() => sendWindow(false).catch(() => {}), ANIMATION_MS[a.animation] + 60);
    }
    return () => clearTimeout(resizeTimer.current);
  }, [open, sendWindow, a.scale, a.pillWidth, a.panelWidth, a.animation, pos.anchor, pos.x, pos.y, pos.monitor]);

  const onPhaseDone = useCallback((phase: Phase) => {
    const content = cfgRef.current.content;
    setTab(content.tabs.includes("focus") ? "focus" : content.defaultTab);
    setNotice(phase === "focus" ? "Focus session done. Time for a break." : "Break over. Ready to focus?");
    peek(8000);
    if (pcfgRef.current.sound) beep();
  }, [peek]);

  // Pomodoro clock: advances the timer when a phase ends.
  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      const result = tick(pRef.current, pcfgRef.current, Date.now());
      if (result.state !== pRef.current) commitP(result.state);
      if (result.completed) onPhaseDone(result.completed);
    }, 500);
    return () => clearInterval(id);
  }, [loaded, commitP, onPhaseDone]);

  const hasTrack = !!(np.title || np.artist);
  const view = collapsedView({ pill: c.pill, pomodoro: p.status, musicStatus: np.status, hasTrack });

  // CPU and memory are only read while something on screen shows them.
  const needSnapshot = view === "system" || (open && shownTab === "tools" && c.tools.meters);
  useEffect(() => {
    if (!needSnapshot) return;
    let off = false;
    let stop: (() => void) | undefined;
    api.system.setPollingVisible(true).catch(() => {});
    api.system.snapshot().then((s) => !off && setSnap(s)).catch(() => {});
    api.system.onSnapshot(setSnap).then((f) => (off ? f() : (stop = f))).catch(() => {});
    return () => {
      off = true;
      stop?.();
      api.system.setPollingVisible(false).catch(() => {});
    };
  }, [needSnapshot]);

  const needApps = open && shownTab === "tools" && c.tools.launchers;
  useEffect(() => {
    if (!needApps) return;
    let off = false;
    api.launcher.list().then((list) => !off && setApps(list)).catch(() => {});
    return () => {
      off = true;
    };
  }, [needApps]);

  useEffect(() => setTaskDraft(p.task), [p.task]);

  // Opening and closing: hover opens after a short rest and closes after a short delay; a click pins it open.
  const onEnter = () => {
    hovering.current = true;
    setHover(true);
    clearTimeout(closeTimer.current);
    const behavior = cfgRef.current.behavior;
    if (behavior.hoverExpand && !open) {
      clearTimeout(openTimer.current);
      openTimer.current = setTimeout(() => setOpen(true), behavior.expandDelay);
    }
  };
  const onLeave = () => {
    hovering.current = false;
    setHover(false);
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!pinnedRef.current) setOpen(false);
    }, cfgRef.current.behavior.collapseDelay);
  };
  const togglePill = () => {
    if (suppressClick.current) {
      suppressClick.current = false; // this click was the end of a drag
      return;
    }
    if (open && pinned) {
      setPinned(false);
      setOpen(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  };

  // Dragging the pill moves the island (only when the position is unlocked in the settings).
  const onPillDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const where = cfgRef.current.position;
    if (where.locked || e.button !== 0) return;
    drag.current = { sx: e.screenX, sy: e.screenY, x0: where.x, y0: where.y, x: where.x, y: where.y, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPillMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.screenX - d.sx;
    const dy = e.screenY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    d.moved = true;
    const next = dragOffsets(cfgRef.current.position.anchor, { x: d.x0, y: d.y0 }, dx, dy);
    d.x = next.x;
    d.y = next.y;
    cancelAnimationFrame(dragRaf.current);
    dragRaf.current = requestAnimationFrame(() => sendWindow(open, next).catch(() => {}));
  };
  const onPillUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    suppressClick.current = true;
    const next: IslandConfig = { ...cfgRef.current, position: { ...cfgRef.current.position, x: d.x, y: d.y } };
    cfgRef.current = next;
    setCfg(next);
    api.settings.set(ISLAND_CONFIG_KEY, next).catch(() => {});
  };

  const control = (action: MediaControl) => {
    api.nowPlaying.control(action).catch((e) => setNotice(`Couldn’t control the player: ${String(e)}`));
    if (action === "play_pause") {
      // show the change at once; the next real reading from Windows confirms it
      setNp((s) => ({ ...s, status: s.status === "playing" ? "paused" : "playing", positionMs: playbackPosition(s, Date.now()), updatedMs: Date.now() }));
    }
  };
  const volume = (action: "up" | "down" | "mute") => api.island.volume(action).catch(() => {});
  const launch = (id: string) => api.launcher.launch(id).catch((e) => setNotice(`Couldn’t open it: ${String(e)}`));

  const commitTask = () => {
    if (taskDraft !== pRef.current.task) commitP(setTask(pRef.current, taskDraft));
  };

  const position = playbackPosition(np, now);
  const left = remaining(p, now);
  const done = progress(p, pcfg, now);
  const clock = formatClock(now, c.clock);
  const cpu = snap ? Math.round(snap.cpuPercent) : 0;
  const mem = snap && snap.memTotal ? Math.round((snap.memUsed / snap.memTotal) * 100) : 0;
  const pillLabel =
    view === "focus" ? `${PHASE_LABEL[p.phase]} ${mmss(left)}${p.status === "paused" ? ", paused" : ""}`
    : view === "music" ? trackLabel(np.title, np.artist)
    : view === "system" ? `CPU ${cpu}%, memory ${mem}%`
    : clock;

  return (
    <div
      className="island-wrap"
      style={islandCssVars(a) as unknown as CSSProperties}
      data-v={anchor.v}
      data-h={anchor.h}
      data-open={open}
      data-idle={!open && !hover}
      data-unlocked={!pos.locked}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className={`island${open ? " open" : ""}`} data-phase={p.phase} data-playing={np.status === "playing"}>
        <button
          className="pill"
          onClick={togglePill}
          onPointerDown={onPillDown}
          onPointerMove={onPillMove}
          onPointerUp={onPillUp}
          onPointerCancel={onPillUp}
          aria-expanded={open}
          aria-label={`Island: ${pillLabel}. ${open && pinned ? "Close" : "Open"} the panel.`}
        >
          {view === "focus" && (
            <>
              <svg className="ring" viewBox="0 0 22 22" aria-hidden="true">
                <circle cx="11" cy="11" r="9" className="ring-track" />
                <circle cx="11" cy="11" r="9" className="ring-fill" strokeDasharray={`${done * RING} ${RING}`} transform="rotate(-90 11 11)" />
              </svg>
              <span className="pill-time">{mmss(left)}</span>
              <span className="pill-text">{p.task || PHASE_LABEL[p.phase]}{p.status === "paused" ? " · paused" : ""}</span>
            </>
          )}
          {view === "music" && (
            <>
              {np.art ? <img className="pill-art" src={np.art} alt="" /> : <span className="pill-art pill-art-empty" aria-hidden="true">♪</span>}
              <span className="pill-text">{trackLabel(np.title, np.artist)}</span>
              <span className="eq" aria-hidden="true"><i /><i /><i /><i /></span>
            </>
          )}
          {view === "system" && <span className="pill-clock">CPU {cpu}% · RAM {mem}%</span>}
          {view === "clock" && <span className="pill-clock">{clock}</span>}
        </button>

        {open && (
          <div className="panel">
            <div className="panel-head">
              <div className="tabs" role="tablist" aria-label="Island sections">
                {c.tabs.map((t) => (
                  <button key={t} role="tab" aria-selected={shownTab === t} className={shownTab === t ? "on" : ""} onClick={() => setTab(t)}>
                    {TAB_LABELS[t]}
                  </button>
                ))}
              </div>
              <button className={`icon${pinned ? " on" : ""}`} onClick={() => setPinned((v) => !v)} aria-pressed={pinned} aria-label="Keep the island open" title="Keep open">
                ⌖
              </button>
            </div>

            {shownTab === "music" && (
              <div className="music" role="tabpanel">
                {np.available && hasTrack ? (
                  <>
                    <div className="music-top">
                      {c.music.art && (np.art ? <img className="art" src={np.art} alt="" /> : <div className="art art-empty" aria-hidden="true">♪</div>)}
                      <div className="meta">
                        <strong title={np.title}>{np.title || "Unknown track"}</strong>
                        <span title={np.artist}>{np.artist || np.album}</span>
                        {c.music.app && <small>{np.app}{np.status === "paused" ? " · paused" : ""}</small>}
                      </div>
                    </div>
                    {c.music.progress && (
                      <>
                        <div className="bar" role="progressbar" aria-label="Track progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction(position, np.durationMs) * 100)}>
                          <i style={{ width: `${fraction(position, np.durationMs) * 100}%` }} />
                        </div>
                        <div className="times"><span>{mmss(position)}</span><span>{np.durationMs > 0 ? mmss(np.durationMs) : ""}</span></div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="empty">Nothing is playing. Start Spotify (or any player) and it shows up here. No login needed.</p>
                )}
                <div className="controls">
                  {c.music.volume && (
                    <>
                      <button className="icon" onClick={() => volume("down")} aria-label="Volume down">−</button>
                      <button className="icon" onClick={() => volume("mute")} aria-label="Mute">🔇</button>
                      <button className="icon" onClick={() => volume("up")} aria-label="Volume up">+</button>
                    </>
                  )}
                  <span className="spacer" />
                  <button className="icon" onClick={() => control("previous")} disabled={!np.available || !np.canPrevious} aria-label="Previous track">⏮</button>
                  <button className="icon big" onClick={() => control("play_pause")} disabled={!np.available || !np.canPlayPause} aria-label={np.status === "playing" ? "Pause" : "Play"}>
                    {np.status === "playing" ? "⏸" : "▶"}
                  </button>
                  <button className="icon" onClick={() => control("next")} disabled={!np.available || !np.canNext} aria-label="Next track">⏭</button>
                </div>
              </div>
            )}

            {shownTab === "focus" && (
              <div className="focus" role="tabpanel">
                <div className="focus-top">
                  <span className="chip">{PHASE_LABEL[p.phase]}{p.status === "paused" ? " · paused" : ""}</span>
                  <span className="big-time">{mmss(left)}</span>
                </div>
                <div className="bar"><i style={{ width: `${done * 100}%` }} /></div>
                {c.focus.task && (
                  <input
                    className="task"
                    type="text"
                    value={taskDraft}
                    maxLength={MAX_TASK}
                    placeholder="What are you focusing on?"
                    aria-label="What you are focusing on"
                    onChange={(e) => setTaskDraft(e.target.value)}
                    onBlur={commitTask}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                )}
                <div className="controls">
                  {p.status === "running" ? (
                    <button className="btn" onClick={() => commitP(pause(pRef.current, Date.now()))}>Pause</button>
                  ) : (
                    <button className="btn primary" onClick={() => { commitP(start(pRef.current, pcfgRef.current, Date.now())); setNotice(""); }}>
                      {p.status === "paused" ? "Resume" : "Start"}
                    </button>
                  )}
                  <button className="btn" onClick={() => commitP(skip(pRef.current, pcfgRef.current, Date.now()))}>Skip</button>
                  <button className="btn" onClick={() => commitP(reset(pRef.current, pcfgRef.current, Date.now()))}>Reset</button>
                  <span className="spacer" />
                  <span className="dots" aria-label={`${p.cycle} of ${pcfg.longEvery} sessions done in this set`}>
                    {Array.from({ length: pcfg.longEvery }, (_, i) => <i key={i} className={i < p.cycle ? "on" : ""} />)}
                  </span>
                </div>
                <p className="muted" role="status" aria-live="polite">
                  {notice || (p.phase !== "focus" ? (c.focus.tips ? breakTip(p) : "") : c.focus.stats ? `Today: ${p.todayFocus} session${p.todayFocus === 1 ? "" : "s"} · ${p.todayMinutes} min` : "")}
                </p>
              </div>
            )}

            {shownTab === "tools" && (
              <div className="tools" role="tabpanel">
                {c.tools.meters && (
                  <>
                    <div className="meter"><span>cpu</span><div className="bar"><i style={{ width: `${cpu}%` }} /></div><code>{cpu}%</code></div>
                    <div className="meter"><span>mem</span><div className="bar"><i style={{ width: `${mem}%` }} /></div><code>{mem}%</code></div>
                  </>
                )}
                {c.tools.launchers && (
                  <>
                    <p className="label">Quick launch</p>
                    {apps.length === 0 ? (
                      <p className="empty">No apps yet. Add some in the DeskForge app (Apps).</p>
                    ) : (
                      <div className="apps">
                        {apps.slice(0, c.tools.launcherCount).map((app) => <button key={app.id} className="btn" onClick={() => launch(app.id)} title={app.name}>{app.name}</button>)}
                      </div>
                    )}
                  </>
                )}
                {!c.tools.meters && !c.tools.launchers && <p className="empty">Nothing is switched on for this tab. Turn things on in the DeskForge app (Floating island).</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
