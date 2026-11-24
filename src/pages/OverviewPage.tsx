import { useEffect, useState } from "react";
import { api } from "../api";
import { Cell, Grid, Tile } from "../shell/Bento";
import { useFxRunning, useIslandRunning, useNowPlaying, usePinnedCount, useWallpaperState } from "../shell/live";
import { greeting, type SectionId } from "../shell/nav";
import { Sparkline, memoryPercent, type SystemState } from "../system";
import { PRESETS, type Tokens } from "../tokens";
import { trackLabel } from "../island/format";

const sameTokens = (a: Tokens, b: Tokens) => (Object.keys(a) as (keyof Tokens)[]).every((k) => a[k] === b[k]);

function OpenButton({ to, label, onNavigate }: { to: SectionId; label: string; onNavigate: (id: SectionId) => void }) {
  return (
    <button className="chip-btn" onClick={() => onNavigate(to)} aria-label={label}>
      Open
    </button>
  );
}

/** The home page: a bento of what is running and where to go next. */
export default function OverviewPage({ sys, tokens, onNavigate }: { sys: SystemState; tokens: Tokens; onNavigate: (id: SectionId) => void }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(id);
  }, []);

  const island = useIslandRunning();
  const fx = useFxRunning();
  const wallpaper = useWallpaperState();
  const playing = useNowPlaying();
  const pinned = usePinnedCount();
  const [notice, setNotice] = useState("");
  const fail = (what: string) => (e: unknown) => setNotice(`Couldn’t ${what}: ${String(e)}`);

  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
  const themeName = PRESETS.find((p) => sameTokens(p.tokens, tokens))?.name ?? "Custom";
  const hasTrack = !!playing && (playing.title || playing.artist);
  const cpu = sys.snap ? Math.round(sys.snap.cpuPercent) : null;

  return (
    <>
      <Grid>
        <Cell span={8} row={2} index={0} className="hero-cell">
          <Tile accent className="hero">
            <p className="hero-greeting">{greeting(now.getHours())}</p>
            <p className="hero-time">{time}</p>
            <p className="hero-date">{date}</p>
          </Tile>
        </Cell>

        <Cell span={4} index={1}>
          <Tile
            label="Processor"
            icon="system"
            value={cpu === null ? "–" : `${cpu}%`}
            hint={`Memory ${memoryPercent(sys.snap)}% in use`}
            action={<OpenButton to="system" label="Open This PC" onNavigate={onNavigate} />}
          >
            <Sparkline values={sys.cpu} />
          </Tile>
        </Cell>

        <Cell span={4} index={2}>
          <Tile
            label="Floating island"
            icon="island"
            value={island ? "On" : "Off"}
            hint={island && hasTrack && playing ? `Playing: ${trackLabel(playing.title, playing.artist)}` : "Music, focus timer and quick tools in a pill on your screen."}
            action={
              <button className="chip-btn" onClick={() => (island ? api.island.stop() : api.island.start()).catch(fail(island ? "turn the island off" : "turn the island on"))} aria-pressed={island}>
                {island ? "Turn off" : "Turn on"}
              </button>
            }
          />
        </Cell>

        <Cell span={4} index={3}>
          <Tile
            label="Wallpaper"
            icon="wallpaper"
            value={wallpaper.running ? "Playing" : "Off"}
            hint={wallpaper.running ? `Animated wallpaper (${wallpaper.mode || "running"})` : "Play a video behind your icons."}
            action={<OpenButton to="wallpaper" label="Open Wallpaper" onNavigate={onNavigate} />}
          />
        </Cell>

        <Cell span={4} index={4}>
          <Tile
            label="Cursor effects"
            icon="effects"
            value={fx ? "On" : "Off"}
            hint="Trails and particles that follow your pointer."
            action={
              <button className="chip-btn" onClick={() => (fx ? api.fx.stop() : api.fx.start()).catch(fail(fx ? "turn the effects off" : "turn the effects on"))} aria-pressed={fx}>
                {fx ? "Turn off" : "Turn on"}
              </button>
            }
          />
        </Cell>

        <Cell span={4} index={5}>
          <Tile
            label="Widgets"
            icon="widgets"
            value={pinned}
            hint={pinned === 1 ? "widget pinned to your desktop" : "widgets pinned to your desktop"}
            action={<OpenButton to="widgets" label="Open Widgets" onNavigate={onNavigate} />}
          />
        </Cell>

        <Cell span={4} index={6}>
          <Tile
            label="Appearance"
            icon="palette"
            value={themeName}
            hint="The look of the whole app."
            action={<OpenButton to="appearance" label="Open Appearance" onNavigate={onNavigate} />}
          >
            <div className="swatches" aria-hidden="true">
              {[tokens.bg, tokens.surface, tokens.text, tokens.accent].map((c, i) => <i key={i} style={{ background: c }} />)}
            </div>
          </Tile>
        </Cell>

        <Cell span={4} index={7}>
          <Tile
            label="Images"
            icon="images"
            value="Compose"
            hint="Layer pictures and use them as your Windows wallpaper."
            action={<OpenButton to="images" label="Open Images" onNavigate={onNavigate} />}
          />
        </Cell>

        <Cell span={4} index={8}>
          <Tile label="Shortcuts" icon="pulse">
            <dl className="keys">
              <div><dt><kbd>Ctrl</kbd> <kbd>1</kbd>–<kbd>8</kbd></dt><dd>jump between sections</dd></div>
              <div><dt><kbd>Ctrl</kbd> <kbd>B</kbd></dt><dd>collapse the sidebar</dd></div>
              <div><dt><kbd>Ctrl</kbd> <kbd>Z</kbd> / <kbd>Y</kbd></dt><dd>undo / redo</dd></div>
            </dl>
          </Tile>
        </Cell>
      </Grid>
      {notice && <p className="notice" role="status">{notice}</p>}
    </>
  );
}
