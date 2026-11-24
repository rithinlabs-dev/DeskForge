import { api } from "../api";
import { useState } from "react";
import FxPanel from "../FxPanel";
import ImageComposer from "../ImageComposer";
import IslandPanel from "../IslandPanel";
import WallpaperPanel from "../WallpaperPanel";
import { trackLabel } from "../island/format";
import { Cell, Grid, Tile } from "../shell/Bento";
import { useFxRunning, useIslandRunning, useNowPlaying, usePinnedCount, useWallpaperState } from "../shell/live";
import type { SystemSnapshot } from "../api";
import type { Tokens } from "../tokens";
import WidgetsPanel from "../widgets/WidgetsPanel";

/** A tile with a short explanation, used beside the status tile at the top of a page. */
function Note({ title, children }: { title: string; children: string }) {
  return (
    <Tile label={title}>
      <p className="bt-note">{children}</p>
    </Tile>
  );
}

export function WidgetsPage({ tokens, snapshot }: { tokens: Tokens; snapshot: SystemSnapshot | null }) {
  const pinned = usePinnedCount();
  return (
    <Grid>
      <Cell span={4} index={0}>
        <Tile label="On your desktop" icon="widgets" value={pinned} hint={pinned === 1 ? "widget pinned" : "widgets pinned"} />
      </Cell>
      <Cell span={8} index={1}>
        <Note title="How it works">Add a widget to the list, then pin it to put it on your desktop. Hover a pinned widget to move or resize it. Each one can have its own glass, border and shadow.</Note>
      </Cell>
      <Cell span={12} index={2}>
        <WidgetsPanel tokens={tokens} snapshot={snapshot} />
      </Cell>
    </Grid>
  );
}

export function WallpaperPage() {
  const wallpaper = useWallpaperState();
  return (
    <Grid>
      <Cell span={4} index={0}>
        <Tile label="Status" icon="wallpaper" value={wallpaper.running ? "Playing" : "Off"} hint={wallpaper.running ? `Mode: ${wallpaper.mode || "running"}` : "Nothing is playing behind your icons."} />
      </Cell>
      <Cell span={8} index={1}>
        <Note title="Good to know">The wallpaper pauses while a fullscreen app runs and when your laptop is on battery, so it doesn’t get in the way of games or your charge.</Note>
      </Cell>
      <Cell span={12} index={2}>
        <WallpaperPanel />
      </Cell>
    </Grid>
  );
}

export function ImagesPage() {
  return (
    <Grid>
      <Cell span={12} index={0}>
        <ImageComposer />
      </Cell>
    </Grid>
  );
}

export function EffectsPage() {
  const running = useFxRunning();
  const [notice, setNotice] = useState("");
  return (
    <>
      <Grid>
        <Cell span={4} index={0}>
          <Tile
            label="Status"
            icon="effects"
            value={running ? "On" : "Off"}
            hint="Trails and particles follow your pointer."
            action={
              <button className="chip-btn" aria-pressed={running} onClick={() => (running ? api.fx.stop() : api.fx.start()).catch((e) => setNotice(`Couldn’t change the effects: ${String(e)}`))}>
                {running ? "Turn off" : "Turn on"}
              </button>
            }
          />
        </Cell>
        <Cell span={8} index={1}>
          <Note title="Good to know">The effects pause on their own while a fullscreen app runs, and use almost no power when your pointer is still.</Note>
        </Cell>
        <Cell span={12} index={2}>
          <FxPanel />
        </Cell>
      </Grid>
      {notice && <p className="notice" role="status">{notice}</p>}
    </>
  );
}

export function IslandPage() {
  const running = useIslandRunning();
  const playing = useNowPlaying();
  const [notice, setNotice] = useState("");
  const hasTrack = !!playing && (playing.title || playing.artist);
  return (
    <>
      <Grid>
        <Cell span={4} index={0}>
          <Tile
            label="Status"
            icon="island"
            value={running ? "On" : "Off"}
            hint={running ? "Look at the edge of your screen." : "Turn it on to see it."}
            action={
              <button className="chip-btn" aria-pressed={running} onClick={() => (running ? api.island.stop() : api.island.start()).catch((e) => setNotice(`Couldn’t change the island: ${String(e)}`))}>
                {running ? "Turn off" : "Turn on"}
              </button>
            }
          />
        </Cell>
        <Cell span={8} index={1}>
          <Tile label="Now playing" icon="play" value={running && hasTrack && playing ? trackLabel(playing.title, playing.artist) : "Nothing yet"} hint={running && hasTrack && playing ? playing.app : "Start Spotify or any player. No login needed."} className="bt-wide" />
        </Cell>
        <Cell span={12} index={2}>
          <IslandPanel />
        </Cell>
      </Grid>
      {notice && <p className="notice" role="status">{notice}</p>}
    </>
  );
}
