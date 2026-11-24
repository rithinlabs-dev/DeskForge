// Canvas drawing for compositions. The same function draws the live preview and the full-resolution wallpaper.
import { cropSize, layerHandles, type Composition, type Layer } from "./model";

export interface Bitmap { src: CanvasImageSource; width: number; height: number }

/** Screen-pixel sizes of the selection handles. The editor uses the same numbers to decide what the pointer grabbed. */
export const HANDLE_RADIUS_PX = 6;
export const HANDLE_REACH_PX = 28;

export function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, bmp: Bitmap): void {
  const { w, h } = cropSize(bmp.width, bmp.height, layer.crop);
  if (w < 1 || h < 1) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity / 100;
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.scale(layer.flipX ? -layer.scale : layer.scale, layer.scale);
  ctx.drawImage(bmp.src, (bmp.width * layer.crop.l) / 100, (bmp.height * layer.crop.t) / 100, w, h, -w / 2, -h / 2, w, h);
  ctx.restore();
}

export function drawComposition(
  ctx: CanvasRenderingContext2D,
  comp: Composition,
  images: Map<string, Bitmap>,
  opts: { selected?: string; scale?: number } = {},
): void {
  const s = opts.scale ?? 1;
  ctx.save();
  ctx.scale(s, s);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = comp.bg;
  ctx.fillRect(0, 0, comp.width, comp.height);
  for (const layer of comp.layers) {
    const b = images.get(layer.image);
    if (b) drawLayer(ctx, layer, b);
  }
  const sel = opts.selected ? comp.layers.find((l) => l.id === opts.selected) : undefined;
  const sb = sel ? images.get(sel.image) : undefined;
  if (sel && sb) {
    const { corners, rotate } = layerHandles(sel, sb.width, sb.height, HANDLE_REACH_PX / s);
    ctx.lineWidth = 2 / s;
    ctx.setLineDash([8 / s, 6 / s]);
    ctx.strokeStyle = "#22f57a";
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.stroke();

    // handles: a square on each corner (resize) and a circle floating above the top edge (rotate)
    ctx.setLineDash([]);
    const r = HANDLE_RADIUS_PX / s;
    const topMid: [number, number] = [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2];
    ctx.beginPath();
    ctx.moveTo(topMid[0], topMid[1]);
    ctx.lineTo(rotate[0], rotate[1]);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    for (const [x, y] of corners) {
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.strokeRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.beginPath();
    ctx.arc(rotate[0], rotate[1], r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
