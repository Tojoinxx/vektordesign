import type { Contour, Vec2, WarpStyle } from './types';
export type { WarpSource, WarpStyle } from './types';
import { contoursBBox, flattenContour } from './shape';

/**
 * Text verformen (wie die Texteffekte in Kittl bzw. „Verkrümmen“ in Illustrator): Bogen, Wölbung, Welle, Flagge,
 * Ansteigen. Die Umrisse werden fein abgetastet und Punkt für Punkt verbogen; die Mitte bleibt an ihrem Platz.
 * Stärke −100 … 100 (negativ = Gegenrichtung).
 */

export const WARP_STYLES: { id: WarpStyle; label: string; hint: string }[] = [
  { id: 'arch', label: 'Bogen', hint: 'College-Schriftzug: Text läuft auf einem Kreisbogen' },
  { id: 'bulge', label: 'Wölbung', hint: 'Mitte höher als die Enden' },
  { id: 'squeeze', label: 'Taille', hint: 'Mitte schmaler, Enden höher' },
  { id: 'wave', label: 'Welle', hint: 'Eine ganze Welle über die Breite' },
  { id: 'flag', label: 'Flagge', hint: 'Wehende Fahne, eineinhalb Wellen' },
  { id: 'rise', label: 'Ansteigen', hint: 'Grundlinie steigt nach rechts an' },
];

/** Verformte Konturen; die Mitte des umschließenden Rechtecks bleibt erhalten. */
export function warpContours(contours: Contour[], style: WarpStyle, amount: number, tol = 0.01): Contour[] {
  const b = contoursBBox(contours);
  if (!b || !contours.length) return contours;
  const a = Math.max(-100, Math.min(100, amount)) / 100;
  const w = Math.max(1e-6, b.maxX - b.minX);
  const h = Math.max(1e-6, b.maxY - b.minY);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  // gerade Stücke fein unterteilen, damit sie mitgebogen werden
  const maxSeg = Math.max(w, h) / 160;
  let f: (p: Vec2) => Vec2;
  switch (style) {
    case 'arch': {
      if (Math.abs(a) < 1e-4) {
        f = (p) => p;
        break;
      }
      // Gesamtwinkel bis 300° (geschlossener Kreis wäre 360°)
      const theta = Math.abs(a) * (300 / 180) * Math.PI;
      const R = w / theta;
      if (a > 0) {
        // Mittelpunkt unter dem Text: Grundlinie (minY) auf Radius R
        const C = { x: cx, y: b.minY - R };
        f = (p) => {
          const phi = (p.x - cx) / R;
          const r = R + (p.y - b.minY);
          return { x: C.x + r * Math.sin(phi), y: C.y + r * Math.cos(phi) };
        };
      } else {
        // Mittelpunkt über dem Text: Oberkante (maxY) auf Radius R, Bogen nach unten
        const C = { x: cx, y: b.maxY + R };
        f = (p) => {
          const phi = (p.x - cx) / R;
          const r = R + (b.maxY - p.y);
          return { x: C.x + r * Math.sin(phi), y: C.y - r * Math.cos(phi) };
        };
      }
      break;
    }
    case 'bulge':
    case 'squeeze': {
      const k = (style === 'bulge' ? 1 : -1) * a;
      f = (p) => {
        const u = (p.x - cx) / (w / 2);
        const s = 1 + k * (1 - u * u);
        return { x: p.x, y: cy + (p.y - cy) * Math.max(0.05, s) };
      };
      break;
    }
    case 'wave': {
      const A = a * h * 0.6;
      f = (p) => ({ x: p.x, y: p.y + A * Math.sin((2 * Math.PI * (p.x - b.minX)) / w) });
      break;
    }
    case 'flag': {
      const A = a * h * 0.45;
      f = (p) => {
        const t = (p.x - b.minX) / w;
        return { x: p.x, y: p.y + A * Math.sin(3 * Math.PI * t) * (0.4 + 0.6 * t) };
      };
      break;
    }
    case 'rise': {
      // gebogene Grundlinie, steigt nach rechts an (Kittl „Rise“)
      const A = a * h * 1.2;
      f = (p) => {
        const t = (p.x - b.minX) / w;
        return { x: p.x, y: p.y + A * (t * t * (3 - 2 * t) - 0.5) };
      };
      break;
    }
  }
  const out: Contour[] = contours.map((c) => {
    const pts = flattenContour(c, tol);
    if (c.closed && pts.length > 2) {
      const f0 = pts[0];
      const l = pts[pts.length - 1];
      if (Math.abs(f0.x - l.x) < 1e-9 && Math.abs(f0.y - l.y) < 1e-9) pts.pop();
    }
    return { closed: c.closed, nodes: densify(pts, c.closed, maxSeg).map((p) => f(p)) };
  });
  // Mitte wieder an die alte Stelle
  const nb = contoursBBox(out);
  if (!nb) return out;
  const dx = cx - (nb.minX + nb.maxX) / 2;
  const dy = cy - (nb.minY + nb.maxY) / 2;
  return out.map((c) => ({ closed: c.closed, nodes: c.nodes.map((n) => ({ x: n.x + dx, y: n.y + dy })) }));
}

function densify(pts: Vec2[], closed: boolean, maxSeg: number): Vec2[] {
  if (pts.length < 2 || !(maxSeg > 0)) return pts;
  const out: Vec2[] = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push(a);
    const k = Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / maxSeg);
    for (let j = 1; j <= k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / (k + 1), y: a.y + ((b.y - a.y) * j) / (k + 1) });
  }
  if (!closed) out.push(pts[pts.length - 1]);
  return out;
}
