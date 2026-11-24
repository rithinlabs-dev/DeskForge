// Frosted-wallpaper glass: which slice of the wallpaper sits behind a desktop widget window. Pure and unit-tested.
//
// Rust reports where the window and its monitor are (physical pixels). Windows draws a "Fill" wallpaper scaled to
// cover the monitor and centred, so the same maths puts the matching slice behind the widget. The picture is blurred
// by CSS, which needs spare picture around the edges (`pad`), otherwise the blur fades to transparent at the border.

/** Mirrors `backdrop::Geometry` in Rust. */
export interface BackdropGeometry {
  winX: number;
  winY: number;
  winW: number;
  winH: number;
  monX: number;
  monY: number;
  monW: number;
  monH: number;
  /** Physical pixels per CSS pixel. */
  scale: number;
}

export interface BackdropLayout {
  /** CSS px the blurred layer extends beyond the widget on every side. */
  pad: number;
  /** CSS `background-size` of the wallpaper. */
  size: string;
  /** CSS `background-position`, already shifted by `pad`. */
  position: string;
}

export const BACKDROP_BLUR_PX = 28;

const px = (n: number) => `${Math.round(n * 10) / 10}px`;

export function backdropLayout(g: BackdropGeometry, imgW: number, imgH: number, blurPx: number = BACKDROP_BLUR_PX): BackdropLayout | null {
  const positive = [g.winW, g.winH, g.monW, g.monH, imgW, imgH, g.scale].every((n) => Number.isFinite(n) && n > 0);
  const finite = [g.winX, g.winY, g.monX, g.monY].every((n) => Number.isFinite(n));
  if (!positive || !finite) return null;
  const cover = Math.max(g.monW / imgW, g.monH / imgH); // "Fill": scale until the monitor is covered
  const drawW = imgW * cover;
  const drawH = imgH * cover;
  const offsetX = (g.monW - drawW) / 2; // centred: the overhang is cropped equally on both sides
  const offsetY = (g.monH - drawH) / 2;
  const pad = Math.ceil(blurPx * 2);
  const left = (offsetX - (g.winX - g.monX)) / g.scale + pad;
  const top = (offsetY - (g.winY - g.monY)) / g.scale + pad;
  return {
    pad,
    size: `${px(drawW / g.scale)} ${px(drawH / g.scale)}`,
    position: `${px(left)} ${px(top)}`,
  };
}
