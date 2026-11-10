import type { Contour, Vec2 } from './types';
import { flattenContour, polygonContour } from './shape';
import { unionArea } from './boolean';

/**
 * Text- und Formeffekte wie in Kittl bzw. Illustrator („Verkrümmen“): Verformen innerhalb der
 * gemeinsamen Box, Text entlang eines beliebigen Pfads und langer Schatten (Extrusion).
 * Alles arbeitet auf fein abgetasteten Umrissen – exakt genug für Druck und Plotter.
 */

export type WarpMode = 'arc' | 'arch' | 'bulge' | 'wave' | 'perspective' | 'rise';

export const WARP_LABELS: Record<WarpMode, string> = {
  arc: 'Bogen (Kreis)',
  arch: 'Bogen (gerade Buchstaben)',
  bulge: 'Wölbung',
  wave: 'Welle',
  perspective: 'Perspektive',
  rise: 'Ansteigend',
};

const TOL = 0.02;

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Umrisse fein abtasten (gerade Stücke werden unterteilt, damit sie sich biegen lassen). */
export function densify(cs: Contour[], maxSeg: number): Vec2[][] {
  return cs.map((c) => {
    const pts = flattenContour(c, TOL);
    const out: Vec2[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      out.push(a);
      if (!c.closed && i === n - 1) break;
      const b = pts[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const k = Math.ceil(len / maxSeg);
      for (let j = 1; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k });
    }
    if (c.closed && out.length > 1) {
      const f = out[0];
      const l = out[out.length - 1];
      if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-9) out.pop();
    }
    return out;
  });
}

/**
 * Abbildung eines Punkts für die Verformung. `bend` von −1 bis 1 (−100 … 100 %).
 * Die Box bleibt in Breite und Grundlinien-Mitte erhalten.
 */
export function warpPoint(p: Vec2, box: Box, mode: WarpMode, bend: number): Vec2 {
  const w = Math.max(1e-9, box.maxX - box.minX);
  const h = Math.max(1e-9, box.maxY - box.minY);
  const u = (p.x - box.minX) / w; // 0 … 1
  const cy = (box.minY + box.maxY) / 2;
  const para = 1 - (2 * u - 1) ** 2; // 0 am Rand, 1 in der Mitte
  switch (mode) {
    case 'arch':
      return { x: p.x, y: p.y + bend * h * 0.6 * para };
    case 'bulge': {
      const s = 1 + bend * 0.6 * para;
      return { x: p.x, y: cy + (p.y - cy) * s };
    }
    case 'wave':
      return { x: p.x, y: p.y + bend * h * 0.35 * Math.sin(2 * Math.PI * u) };
    case 'perspective': {
      const s = 1 + bend * (u - 0.5) * 1.2;
      return { x: p.x, y: cy + (p.y - cy) * Math.max(0.05, s) };
    }
    case 'rise':
      return { x: p.x, y: p.y + bend * h * (u - 0.5) * 1.2 };
    case 'arc': {
      if (Math.abs(bend) < 1e-6) return { ...p };
      // Grundlinie wird zum Kreisbogen über `bend · 180°`, Buchstaben stehen radial
      const theta = bend * Math.PI;
      const R = w / Math.abs(theta);
      const sign = Math.sign(bend);
      const base = box.minY;
      const a = (u - 0.5) * Math.abs(theta);
      const r = R + sign * (p.y - base);
      // Mittelpunkt unter (bend > 0) bzw. über der Box
      const cx0 = (box.minX + box.maxX) / 2;
      const cyc = base - sign * R;
      return { x: cx0 + r * Math.sin(a), y: cyc + sign * r * Math.cos(a) };
    }
  }
}

/** Verformt alle Umrisse gemeinsam in ihrer Box. Ergebnis: Polygone als Konturen. */
export function warpContours(cs: Contour[], box: Box, mode: WarpMode, bend: number): Contour[] {
  const seg = Math.max(0.05, (box.maxX - box.minX) / 400);
  return densify(cs, seg).map((poly, i) =>
    polygonContour(
      poly.map((p) => warpPoint(p, box, mode, bend)),
      cs[i].closed,
    ),
  );
}

// ---------------------------------------------------------------------------
// Text entlang eines Pfads
// ---------------------------------------------------------------------------

export interface PathWalker {
  length: number;
  closed: boolean;
  /** Bogenlänge des obersten Punkts (geschlossene Pfade: dort steht mittiger Text) */
  top: number;
  /** Punkt und Einheits-Tangente bei Bogenlänge s (außerhalb wird geradlinig verlängert) */
  at(s: number): { p: Vec2; t: Vec2 };
}

/**
 * Bereitet einen Pfad (Polylinie) zum Ablaufen vor. Offene Pfade laufen von links nach rechts,
 * geschlossene im Uhrzeigersinn ab dem linken Punkt – so steht Text oben aufrecht.
 */
export function pathWalker(polyIn: Vec2[], closed: boolean): PathWalker {
  let poly = polyIn.slice();
  if (closed) {
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    if (area > 0) poly.reverse(); // gegen den Uhrzeigersinn → umdrehen
    let k = 0;
    poly.forEach((p, i) => {
      if (p.x < poly[k].x - 1e-9 || (Math.abs(p.x - poly[k].x) < 1e-9 && p.y > poly[k].y)) k = i;
    });
    poly = [...poly.slice(k), ...poly.slice(0, k), poly[k]];
  } else if (poly[poly.length - 1].x < poly[0].x) poly.reverse();
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  const length = cum[cum.length - 1];
  let top = 0;
  poly.forEach((p, i) => {
    if (p.y > poly[top].y) top = i;
  });
  const tan = (i: number): Vec2 => {
    const a = poly[Math.max(0, Math.min(poly.length - 2, i))];
    const b = poly[Math.max(1, Math.min(poly.length - 1, i + 1))];
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  return {
    length,
    closed,
    top: cum[top],
    at(sIn: number) {
      const s = closed && length > 0 ? ((sIn % length) + length) % length : sIn;
      if (s <= 0) {
        const t = tan(0);
        return { p: { x: poly[0].x + t.x * s, y: poly[0].y + t.y * s }, t };
      }
      if (s >= length) {
        const t = tan(poly.length - 2);
        const e = poly[poly.length - 1];
        return { p: { x: e.x + t.x * (s - length), y: e.y + t.y * (s - length) }, t };
      }
      let lo = 0;
      let hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= s) lo = mid;
        else hi = mid;
      }
      const f = (s - cum[lo]) / Math.max(1e-12, cum[hi] - cum[lo]);
      const a = poly[lo];
      const b = poly[hi];
      // Tangente weich zwischen Nachbarstücken überblenden (keine Knicke in den Buchstaben)
      const t0 = tan(lo);
      const t1 = f < 0.5 ? tan(lo - 1) : tan(lo + 1);
      const wgt = f < 0.5 ? 0.5 - f : f - 0.5;
      const tx = t0.x * (1 - wgt) + t1.x * wgt;
      const ty = t0.y * (1 - wgt) + t1.y * wgt;
      const tl = Math.hypot(tx, ty) || 1;
      return { p: { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, t: { x: tx / tl, y: ty / tl } };
    },
  };
}

/**
 * Legt Text-Umrisse (Grundlinie y = 0, x ab 0, Breite `width`) auf einen Pfad.
 * `offset` hebt den Text vom Pfad ab (positiv = links der Laufrichtung, also oben).
 */
export function textOnPath(cs: Contour[], width: number, walker: PathWalker, align: 'start' | 'center' | 'end', offset: number): Contour[] {
  // Offene Pfade: am Anfang/mittig/am Ende. Geschlossene: bezogen auf den obersten Punkt.
  const ref = walker.closed ? walker.top : 0;
  const span = walker.closed ? 0 : walker.length;
  const start = walker.closed ? (align === 'start' ? ref : align === 'end' ? ref - width : ref - width / 2) : align === 'start' ? 0 : align === 'end' ? span - width : (span - width) / 2;
  const seg = Math.max(0.05, width / 600);
  return densify(cs, seg).map((poly, i) =>
    polygonContour(
      poly.map((q) => {
        const { p, t } = walker.at(start + q.x);
        const n = { x: -t.y, y: t.x };
        const d = q.y + offset;
        return { x: p.x + n.x * d, y: p.y + n.y * d };
      }),
      cs[i].closed,
    ),
  );
}

// ---------------------------------------------------------------------------
// Langer Schatten / 3D-Tiefe
// ---------------------------------------------------------------------------

/**
 * Fläche, die die Polygone überstreichen, wenn man sie um (dx, dy) schiebt: Original, Ziel und
 * je Kante das Viereck dazwischen – exakt, ohne Treppen.
 */
export function sweepArea(polys: Vec2[][], dx: number, dy: number): Vec2[][] {
  const parts: Vec2[][][] = [polys, polys.map((p) => p.map((q) => ({ x: q.x + dx, y: q.y + dy })))];
  const quads: Vec2[][] = [];
  for (const poly of polys)
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const q = [a, b, { x: b.x + dx, y: b.y + dy }, { x: a.x + dx, y: a.y + dy }];
      // gleiche Umlaufrichtung für die Vereinigung (nonzero)
      let ar = 0;
      for (let k = 0; k < 4; k++) ar += q[k].x * q[(k + 1) % 4].y - q[(k + 1) % 4].x * q[k].y;
      if (Math.abs(ar) > 1e-12) quads.push(ar < 0 ? q.reverse() : q);
    }
  parts.push(quads);
  return unionArea(...parts);
}
