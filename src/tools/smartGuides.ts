import type { Id, SketchDoc, Vec2 } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { entityBBox } from '../model/bounds';
import { entityPointIds } from '../model/doc';
import { groupMembers, visibleOrder } from '../model/layers';
import type { BBox } from '../model/geometry';

/**
 * Smarte Hilfslinien wie in Figma: Beim Verschieben rasten Kanten und Mitten an anderen Objekten
 * und am Ursprung ein, gleiche Abstände zu Nachbarn werden erkannt. Alles in Weltkoordinaten (mm).
 */

export interface GuideLine {
  a: Vec2;
  b: Vec2;
  /** Abstandsmaß (mm), wird mittig an die Linie geschrieben */
  gap?: number;
}

export interface GuideSnap {
  dx: number;
  dy: number;
  lines: GuideLine[];
}

const MAX_CANDIDATES = 1500;

/** Boxen aller anderen sichtbaren Objekte (Gruppen als Einheit) plus Ursprung als Punkt. */
export function guideCandidates(doc: SketchDoc, moving: Set<Id>): BBox[] {
  const out: BBox[] = [{ minX: 0, maxX: 0, minY: 0, maxY: 0 }];
  const seen = new Set<Id>();
  for (const id of visibleOrder(doc)) {
    if (seen.has(id) || out.length > MAX_CANDIDATES) continue;
    const members = groupMembers(doc, id);
    members.forEach((m) => seen.add(m));
    let b: BBox | null = null;
    let touches = false;
    for (const m of members) {
      const e = doc.entities[m];
      if (!e || e.construction) continue;
      for (const pid of entityPointIds(doc, e)) if (moving.has(pid) && pid !== ORIGIN_ID) touches = true;
      const eb = entityBBox(doc, e);
      if (!Number.isFinite(eb.minX)) continue;
      b = b ? { minX: Math.min(b.minX, eb.minX), maxX: Math.max(b.maxX, eb.maxX), minY: Math.min(b.minY, eb.minY), maxY: Math.max(b.maxY, eb.maxY) } : eb;
    }
    if (b && !touches) out.push(b);
  }
  // Hilfslinien aus dem Lineal als unendlich lange Kanten
  for (const g of doc.guides ?? []) out.push(g.axis === 'x' ? { minX: g.pos, maxX: g.pos, minY: -1e5, maxY: 1e5 } : { minX: -1e5, maxX: 1e5, minY: g.pos, maxY: g.pos });
  return out;
}

const xs = (b: BBox) => [b.minX, (b.minX + b.maxX) / 2, b.maxX];
const ys = (b: BBox) => [b.minY, (b.minY + b.maxY) / 2, b.maxY];
const shift = (b: BBox, dx: number, dy: number): BBox => ({ minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy });
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

/** Bester Einrast-Versatz auf einer Achse (null = nichts in Reichweite). */
function bestAlign(mv: number[], cands: BBox[], get: (b: BBox) => number[], tol: number): number | null {
  let best: number | null = null;
  for (const c of cands)
    for (const cv of get(c))
      for (const m of mv) {
        const d = cv - m;
        if (Math.abs(d) <= tol && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
  return best;
}

/** Gleiche Abstände: zwischen zwei Nachbarn mittig oder wie der Abstand der beiden nächsten. */
function bestSpacing(m: BBox, cands: BBox[], axis: 'x' | 'y', tol: number): { d: number; lines: GuideLine[] } | null {
  const lo = (b: BBox) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: BBox) => (axis === 'x' ? b.maxX : b.maxY);
  const plo = (b: BBox) => (axis === 'x' ? b.minY : b.minX);
  const phi = (b: BBox) => (axis === 'x' ? b.maxY : b.maxX);
  const row = cands.filter((c) => hi(c) > lo(c) && phi(c) > plo(c) && phi(c) - plo(c) < 1e4 && overlaps(plo(c), phi(c), plo(m), phi(m)));
  const before = row.filter((c) => hi(c) <= lo(m) + tol).sort((a, b) => hi(b) - hi(a));
  const after = row.filter((c) => lo(c) >= hi(m) - tol).sort((a, b) => lo(a) - lo(b));
  const mid = (a: BBox, b: BBox) => (Math.max(plo(a), plo(b)) + Math.min(phi(a), phi(b))) / 2;
  const seg = (from: number, to: number, at: number): GuideLine =>
    axis === 'x' ? { a: { x: from, y: at }, b: { x: to, y: at }, gap: to - from } : { a: { x: at, y: from }, b: { x: at, y: to }, gap: to - from };
  const options: { d: number; lines: (mm: BBox) => GuideLine[] }[] = [];
  const L = before[0];
  const R = after[0];
  if (L && R) {
    const gap = (lo(R) - hi(L) - (hi(m) - lo(m))) / 2;
    if (gap > 0) options.push({ d: hi(L) + gap - lo(m), lines: (mm) => [seg(hi(L), lo(mm), mid(L, mm)), seg(hi(mm), lo(R), mid(mm, R))] });
  }
  if (L && before[1] && hi(before[1]) <= lo(L)) {
    const g = lo(L) - hi(before[1]);
    if (g > 0) options.push({ d: hi(L) + g - lo(m), lines: (mm) => [seg(hi(before[1]), lo(L), mid(before[1], L)), seg(hi(L), lo(mm), mid(L, mm))] });
  }
  if (R && after[1] && lo(after[1]) >= hi(R)) {
    const g = lo(after[1]) - hi(R);
    if (g > 0) options.push({ d: lo(R) - g - hi(m), lines: (mm) => [seg(hi(mm), lo(R), mid(mm, R)), seg(hi(R), lo(after[1]), mid(R, after[1]))] });
  }
  let best: { d: number; lines: (mm: BBox) => GuideLine[] } | null = null;
  for (const o of options) if (Math.abs(o.d) <= tol && (!best || Math.abs(o.d) < Math.abs(best.d))) best = o;
  if (!best) return null;
  const moved = axis === 'x' ? shift(m, best.d, 0) : shift(m, 0, best.d);
  return { d: best.d, lines: best.lines(moved) };
}

/**
 * Rastet die verschobene Box `moving` (bereits um den Mausweg versetzt) ein.
 * `tol` ist die Fangweite in mm (typisch 6 Pixel / Zoom).
 */
export function smartSnap(moving: BBox, cands: BBox[], tol: number): GuideSnap {
  const lines: GuideLine[] = [];
  let dx = bestAlign(xs(moving), cands, xs, tol);
  let dy = bestAlign(ys(moving), cands, ys, tol);
  let spX: GuideLine[] = [];
  let spY: GuideLine[] = [];
  // Gleiche Abstände nur, wenn keine Kante näher einrastet
  const sx = bestSpacing(moving, cands, 'x', tol);
  if (sx && (dx === null || Math.abs(sx.d) < Math.abs(dx) - 1e-9)) {
    dx = sx.d;
    spX = sx.lines;
  }
  const sy = bestSpacing(moving, cands, 'y', tol);
  if (sy && (dy === null || Math.abs(sy.d) < Math.abs(dy) - 1e-9)) {
    dy = sy.d;
    spY = sy.lines;
  }
  const m = shift(moving, dx ?? 0, dy ?? 0);
  const eps = 1e-6;
  if (dx !== null && !spX.length)
    for (const v of xs(m)) {
      const hits = cands.filter((c) => xs(c).some((cv) => Math.abs(cv - v) < eps));
      if (!hits.length) continue;
      const y0 = Math.min(m.minY, ...hits.map((c) => c.minY));
      const y1 = Math.max(m.maxY, ...hits.map((c) => c.maxY));
      lines.push({ a: { x: v, y: y0 }, b: { x: v, y: y1 } });
    }
  if (dy !== null && !spY.length)
    for (const v of ys(m)) {
      const hits = cands.filter((c) => ys(c).some((cv) => Math.abs(cv - v) < eps));
      if (!hits.length) continue;
      const x0 = Math.min(m.minX, ...hits.map((c) => c.minX));
      const x1 = Math.max(m.maxX, ...hits.map((c) => c.maxX));
      lines.push({ a: { x: x0, y: v }, b: { x: x1, y: v } });
    }
  lines.push(...spX, ...spY);
  return { dx: dx ?? 0, dy: dy ?? 0, lines };
}
