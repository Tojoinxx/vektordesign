import ImageTracerNS from 'imagetracerjs';
import type { Contour, ShapeNode, Vec2 } from './types';
import { rgbToHex } from './color';
import { polyArea } from './shape';

/**
 * Pixelbild → Vektorformen (eine Form je Farbe), mit ImageTracer.js (gemeinfrei):
 * Farben reduzieren, Konturen je Farbe verfolgen, Geraden und Kurven anpassen.
 */

interface TraceSeg {
  type: 'L' | 'Q';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3?: number;
  y3?: number;
}
interface TracePath {
  segments: TraceSeg[];
  isholepath: boolean;
  holechildren: number[];
}
interface TraceData {
  layers: TracePath[][];
  palette: { r: number; g: number; b: number; a: number }[];
  width: number;
  height: number;
}
interface ImageTracerApi {
  imagedataToTracedata(img: { width: number; height: number; data: Uint8ClampedArray }, options: Record<string, unknown>): TraceData;
}
const ImageTracer = ((ImageTracerNS as unknown as { default?: ImageTracerApi }).default ?? ImageTracerNS) as unknown as ImageTracerApi;

export type VectorizeDetail = 'fine' | 'medium' | 'coarse';

export interface VectorizeOptions {
  /** Anzahl Farben (2–16) */
  colors: number;
  detail: VectorizeDetail;
  /** Hintergrundfarbe (häufigste Randfarbe) weglassen */
  removeBackground: boolean;
}

export interface VectorLayer {
  color: string;
  contours: Contour[];
  /** Fläche in Pixeln² (zum Sortieren) */
  area: number;
}

const DETAIL: Record<VectorizeDetail, Record<string, number | boolean>> = {
  fine: { pathomit: 4, ltres: 0.6, qtres: 0.6, blurradius: 0 },
  medium: { pathomit: 10, ltres: 1, qtres: 1, blurradius: 0 },
  coarse: { pathomit: 24, ltres: 2, qtres: 2, blurradius: 2, blurdelta: 30 },
};

/**
 * Farbpalette per k-Means (deterministisch: Startwerte nach größtem Abstand). Zuverlässiger
 * als die eingebaute Stichprobe bei wenigen, klaren Farben wie in Logos.
 */
export function quantize(img: { width: number; height: number; data: Uint8ClampedArray }, k: number): { r: number; g: number; b: number; a: number }[] {
  const { data } = img;
  const n = img.width * img.height;
  const step = Math.max(1, Math.floor(n / 40000));
  const px: number[][] = [];
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    if (data[o + 3] < 128) continue;
    px.push([data[o], data[o + 1], data[o + 2]]);
  }
  if (!px.length) return [{ r: 0, g: 0, b: 0, a: 0 }];
  const d2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Start: häufigste grobe Farbe, dann jeweils der am weitesten entfernte Punkt
  const centers: number[][] = [px[0]];
  const bins = new Map<number, number>();
  let bestBin = 0;
  for (const p of px) {
    const key = ((p[0] >> 4) << 8) | ((p[1] >> 4) << 4) | (p[2] >> 4);
    const c = (bins.get(key) ?? 0) + 1;
    bins.set(key, c);
    if (c > (bins.get(bestBin) ?? 0)) bestBin = key;
  }
  centers[0] = [((bestBin >> 8) & 15) * 16 + 8, ((bestBin >> 4) & 15) * 16 + 8, (bestBin & 15) * 16 + 8];
  const dist = px.map((p) => d2(p, centers[0]));
  while (centers.length < k) {
    let fi = 0;
    for (let i = 1; i < px.length; i++) if (dist[i] > dist[fi]) fi = i;
    if (dist[fi] < 24 * 24) break; // keine weitere deutlich andere Farbe
    centers.push(px[fi].slice());
    for (let i = 0; i < px.length; i++) dist[i] = Math.min(dist[i], d2(px[i], px[fi]));
  }
  for (let it = 0; it < 8; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let b = 0;
      let bd = Infinity;
      centers.forEach((c, j) => {
        const d = d2(p, c);
        if (d < bd) {
          bd = d;
          b = j;
        }
      });
      sum[b][0] += p[0];
      sum[b][1] += p[1];
      sum[b][2] += p[2];
      sum[b][3]++;
    }
    centers.forEach((c, j) => {
      if (sum[j][3]) {
        c[0] = sum[j][0] / sum[j][3];
        c[1] = sum[j][1] / sum[j][3];
        c[2] = sum[j][2] / sum[j][3];
      }
    });
  }
  const pal = centers.map((c) => ({ r: Math.round(c[0]), g: Math.round(c[1]), b: Math.round(c[2]), a: 255 }));
  // Transparenz als eigene „Farbe“, damit sie nicht einer Druckfarbe zugeschlagen wird
  if (px.length < n / step - 1) pal.push({ r: 0, g: 0, b: 0, a: 0 });
  return pal;
}

/** Häufigste Farbe am Bildrand (Hintergrund) bzw. -1, wenn der Rand transparent ist. */
function borderColorIndex(img: { width: number; height: number; data: Uint8ClampedArray }, palette: TraceData['palette']): number {
  const counts = new Map<number, number>();
  const { width: w, height: h, data } = img;
  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) {
      counts.set(-1, (counts.get(-1) ?? 0) + 1);
      return;
    }
    let best = 0;
    let bd = Infinity;
    palette.forEach((p, k) => {
      const d = (p.r - data[i]) ** 2 + (p.g - data[i + 1]) ** 2 + (p.b - data[i + 2]) ** 2;
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    counts.set(best, (counts.get(best) ?? 0) + 1);
  };
  const step = Math.max(1, Math.floor((w + h) / 400));
  for (let x = 0; x < w; x += step) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    sample(0, y);
    sample(w - 1, y);
  }
  let best = -1;
  let n = -1;
  for (const [k, c] of counts) if (c > n) {
    n = c;
    best = k;
  }
  return best;
}

function pathToContour(p: TracePath, map: (x: number, y: number) => Vec2): Contour {
  const nodes: ShapeNode[] = [];
  const segs = p.segments;
  for (const s of segs) nodes.push({ ...map(s.x1, s.y1) });
  segs.forEach((s, i) => {
    if (s.type !== 'Q' || s.x3 === undefined || s.y3 === undefined) return;
    const p0 = map(s.x1, s.y1);
    const c = map(s.x2, s.y2);
    const p1 = map(s.x3, s.y3);
    const a = nodes[i];
    const b = nodes[(i + 1) % nodes.length];
    a.ox = p0.x + ((c.x - p0.x) * 2) / 3;
    a.oy = p0.y + ((c.y - p0.y) * 2) / 3;
    b.ix = p1.x + ((c.x - p1.x) * 2) / 3;
    b.iy = p1.y + ((c.y - p1.y) * 2) / 3;
  });
  return { closed: true, nodes };
}

/**
 * Verfolgt ein Bild. `map` rechnet Pixel (0…Breite, 0…Höhe, oben links) in Welt-mm um.
 * Ergebnis: eine Ebene je Farbe (Hintergrund und transparente Bereiche ausgelassen).
 */
export function vectorize(img: { width: number; height: number; data: Uint8ClampedArray }, opts: VectorizeOptions, map: (x: number, y: number) => Vec2): VectorLayer[] {
  const colors = Math.max(2, Math.min(16, Math.round(opts.colors)));
  const td = ImageTracer.imagedataToTracedata(img, {
    ...DETAIL[opts.detail],
    numberofcolors: colors,
    pal: quantize(img, colors),
    colorquantcycles: 1,
    mincolorratio: 0,
    rightangleenhance: true,
    layering: 0,
    linefilter: opts.detail !== 'fine',
  });
  const bg = opts.removeBackground ? borderColorIndex(img, td.palette) : -2;
  const out: VectorLayer[] = [];
  td.layers.forEach((layer, k) => {
    const pal = td.palette[k];
    if (!pal || pal.a < 128 || k === bg) return;
    const contours: Contour[] = [];
    let area = 0;
    layer.forEach((p) => {
      if (p.isholepath || p.segments.length < 2) return;
      const outer = pathToContour(p, map);
      contours.push(outer);
      const pts = p.segments.map((s) => ({ x: s.x1, y: s.y1 }));
      area += Math.abs(polyArea(pts));
      for (const h of p.holechildren) {
        const hp = layer[h];
        if (hp && hp.segments.length >= 2) contours.push(pathToContour(hp, map));
      }
    });
    if (contours.length) out.push({ color: rgbToHex({ r: pal.r, g: pal.g, b: pal.b }), contours, area });
  });
  // Große Flächen nach hinten
  out.sort((a, b) => b.area - a.area);
  return out;
}
