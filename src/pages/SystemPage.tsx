import { Cell, Grid, Tile } from "../shell/Bento";
import { Sparkline, formatBytes, memoryPercent, type SystemState } from "../system";

/** Live processor, memory and network as a bento. */
export default function SystemPage({ sys }: { sys: SystemState }) {
  const { snap } = sys;
  const memory = memoryPercent(snap);
  return (
    <Grid>
      <Cell span={8} index={0}>
        <Tile label="Processor" icon="system" value={snap ? `${snap.cpuPercent.toFixed(0)}%` : "–"} hint="Use over the last minute">
          <Sparkline values={sys.cpu} />
        </Tile>
      </Cell>
      <Cell span={4} index={1}>
        <Tile label="Memory" icon="pulse" value={snap ? `${memory}%` : "–"} hint={snap ? `${formatBytes(snap.memUsed)} of ${formatBytes(snap.memTotal)}` : "Reading…"}>
          <div className="meter-bar" role="progressbar" aria-label="Memory in use" aria-valuemin={0} aria-valuemax={100} aria-valuenow={memory}>
            <i style={{ width: `${memory}%` }} />
          </div>
        </Tile>
      </Cell>
      <Cell span={6} index={2}>
        <Tile label="Download" icon="arrow" value={`${formatBytes(sys.rate.rx)}/s`} hint="Data coming in" />
      </Cell>
      <Cell span={6} index={3}>
        <Tile label="Upload" icon="arrow" value={`${formatBytes(sys.rate.tx)}/s`} hint="Data going out" />
      </Cell>
    </Grid>
  );
}
