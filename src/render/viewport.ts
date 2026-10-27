import type { Vec2 } from '../model/types';

/** Ansicht: Weltkoordinaten (mm, Y nach oben) ↔ Bildschirm (CSS-Pixel, Y nach unten). */
export interface Viewport {
  cx: number;
  cy: number;
  zoom: number;
  width: number;
  height: number;
}

export function toScreen(vp: Viewport, p: Vec2): Vec2 {
  return { x: (p.x - vp.cx) * vp.zoom + vp.width / 2, y: vp.height / 2 - (p.y - vp.cy) * vp.zoom };
}

export function toWorld(vp: Viewport, s: Vec2): Vec2 {
  return { x: (s.x - vp.width / 2) / vp.zoom + vp.cx, y: (vp.height / 2 - s.y) / vp.zoom + vp.cy };
}

/** Sichtbarer Weltbereich. */
export function visibleWorld(vp: Viewport): { minX: number; minY: number; maxX: number; maxY: number } {
  const a = toWorld(vp, { x: 0, y: vp.height });
  const b = toWorld(vp, { x: vp.width, y: 0 });
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

/** Rasterabstand (1-2-5-Folge), sodass Linien mindestens `minPx` auseinander liegen. */
export function gridStep(zoom: number, minPx = 9): { minor: number; major: number } {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  let minor = steps[steps.length - 1];
  for (const s of steps) {
    if (s * zoom >= minPx) {
      minor = s;
      break;
    }
  }
  const lead = Math.round(minor / 10 ** Math.floor(Math.log10(minor) + 1e-9));
  const major = minor * (lead === 1 ? 10 : lead === 2 ? 5 : 2);
  return { minor, major };
}
