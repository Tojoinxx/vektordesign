import Delaunator from 'delaunator';
import type { ExchangePiece } from '../pattern/exchange';

/**
 * Vernetzung eines Schnittteils: Kanten in gleichmäßigen Abständen abgetastet, das Innere mit einem
 * Dreiecksgitter gefüllt, dann Delaunay-trianguliert. Jede Randecke weiß, zu welcher Kante sie gehört
 * und an welcher Stelle (0…1 entlang der Kante) – daraus entstehen die Nähte in 3D.
 */

export interface PieceMesh {
  /** 2D-Koordinaten (mm) je Vertex: x, y */
  uv: Float64Array;
  /** Dreiecke (Indizes), gegen den Uhrzeigersinn im 2D */
  tris: Uint32Array;
  /** Vertices je Kante in Laufrichtung, inklusive beider Ecken */
  edgeVerts: number[][];
  /** Parameter 0…1 entlang der Kante je Eintrag in edgeVerts */
  edgeT: number[][];
  count: number;
}

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToPolyline(x: number, y: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t);
    if (d < best) best = d;
  }
  return best;
}

/** Polylinie gleichmäßig nach Bogenlänge abtasten (n Abschnitte). */
function resample(pts: [number, number][], n: number): [number, number][] {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  const out: [number, number][] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (s - cum[j]) / seg : 0;
    out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t]);
  }
  return out;
}

export function meshPiece(piece: ExchangePiece, h: number): PieceMesh {
  const poly = piece.polygon;
  const N = poly.length;
  // Kanten als Polylinien (aus den Indexbereichen des Austauschformats)
  const edgePolys: [number, number][][] = piece.edges.map((e) => {
    const pts: [number, number][] = [];
    let i = e.from;
    for (let guard = 0; guard <= N; guard++) {
      pts.push(poly[i]);
      if (i === e.to && pts.length > 1) break;
      i = (i + 1) % N;
    }
    return pts;
  });
  const xs: number[] = [];
  const edgeVerts: number[][] = [];
  const edgeT: number[][] = [];
  const boundary: [number, number][] = [];
  let first = -1;
  edgePolys.forEach((pts, ei) => {
    const L = piece.edges[ei].length;
    const n = Math.max(1, Math.round(L / h));
    const rs = resample(pts, n);
    const verts: number[] = [];
    const ts: number[] = [];
    for (let k = 0; k < n; k++) {
      let idx: number;
      if (k === 0 && ei > 0) idx = edgeVerts[ei - 1][edgeVerts[ei - 1].length - 1];
      else {
        idx = xs.length / 2;
        xs.push(rs[k][0], rs[k][1]);
        boundary.push(rs[k]);
        if (first < 0) first = idx;
      }
      verts.push(idx);
      ts.push(k / n);
    }
    // Endpunkt: Anfang der nächsten Kante (bzw. erster Punkt beim letzten)
    if (ei === edgePolys.length - 1) verts.push(first);
    else {
      const idx = xs.length / 2;
      xs.push(rs[n][0], rs[n][1]);
      boundary.push(rs[n]);
      verts.push(idx);
    }
    ts.push(1);
    edgeVerts.push(verts);
    edgeT.push(ts);
  });
  const nb = xs.length / 2;
  // Inneres: Dreiecksgitter
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const dy = h * 0.866;
  let row = 0;
  for (let y = minY + dy * 0.5; y < maxY; y += dy, row++) {
    for (let x = minX + (row % 2 ? h * 0.5 : 0) + h * 0.25; x < maxX; x += h) {
      if (!pointInPoly(x, y, poly)) continue;
      if (distToPolyline(x, y, boundary) < h * 0.55) continue;
      xs.push(x, y);
    }
  }
  const coords = Float64Array.from(xs);
  const d = new Delaunator(coords);
  const tris: number[] = [];
  for (let t = 0; t < d.triangles.length; t += 3) {
    const a = d.triangles[t];
    const b = d.triangles[t + 1];
    const c = d.triangles[t + 2];
    const cx = (coords[2 * a] + coords[2 * b] + coords[2 * c]) / 3;
    const cy = (coords[2 * a + 1] + coords[2 * b + 1] + coords[2 * c + 1]) / 3;
    if (!pointInPoly(cx, cy, poly)) continue;
    // Splitter an konkaven Rändern: alle drei auf dem Rand und sehr flach → weg
    if (a < nb && b < nb && c < nb) {
      const area = Math.abs((coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1]) - (coords[2 * c] - coords[2 * a]) * (coords[2 * b + 1] - coords[2 * a + 1])) / 2;
      if (area < h * h * 0.02) continue;
    }
    // Delaunator liefert im Uhrzeigersinn (bei y nach oben gegen den Uhrzeigersinn je nach Achse) – auf CCW normieren
    const cross = (coords[2 * b] - coords[2 * a]) * (coords[2 * c + 1] - coords[2 * a + 1]) - (coords[2 * c] - coords[2 * a]) * (coords[2 * b + 1] - coords[2 * a + 1]);
    if (cross > 0) tris.push(a, b, c);
    else tris.push(a, c, b);
  }
  return { uv: coords, tris: Uint32Array.from(tris), edgeVerts, edgeT, count: coords.length / 2 };
}
