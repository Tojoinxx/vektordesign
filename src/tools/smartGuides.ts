import type { BBox } from '../model/geometry';

/**
 * Smarte Hilfslinien beim Verschieben (wie in Figma/Illustrator): Kanten und Mitten des gezogenen Objekts rasten an
 * Kanten und Mitten anderer Objekte und an den Achsen ein; gleiche Abstände zu Nachbarn in einer Reihe/Spalte werden
 * erkannt. Rein rechnerisch (Welt-mm), damit testbar; gezeichnet wird in {@link drawSmartGuides}.
 */

export interface GuideLine {
  /** 'x' = senkrechte Linie bei x = at, von a bis b (y); 'y' = waagrechte Linie bei y = at, von a bis b (x) */
  axis: 'x' | 'y';
  at: number;
  a: number;
  b: number;
}

export interface GapMark {
  /** 'x' = waagrechter Abstand (von a bis b in x) auf Höhe at; 'y' = senkrechter Abstand */
  axis: 'x' | 'y';
  at: number;
  a: number;
  b: number;
  /** Abstand ist gleich einem vorhandenen Abstand (rot hervorheben) */
  equal: boolean;
}

export interface SmartSnap {
  dx: number;
  dy: number;
  lines: GuideLine[];
  gaps: GapMark[];
}

const EPS = 1e-6;

function xs(b: BBox): number[] {
  return [b.minX, (b.minX + b.maxX) / 2, b.maxX];
}
function ys(b: BBox): number[] {
  return [b.minY, (b.minY + b.maxY) / 2, b.maxY];
}
const shift = (b: BBox, dx: number, dy: number): BBox => ({ minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy });
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > EPS;

/** Mögliche Verschiebungen auf einer Achse durch gleiche Abstände in einer Reihe. */
function spacingCandidates(m: BBox, row: BBox[], axis: 'x' | 'y'): number[] {
  const lo = (b: BBox) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: BBox) => (axis === 'x' ? b.maxX : b.maxY);
  const sorted = [...row].sort((p, q) => lo(p) - lo(q));
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = lo(sorted[i]) - hi(sorted[i - 1]);
    if (g > EPS) gaps.push(g);
  }
  const mid = (lo(m) + hi(m)) / 2;
  const before = sorted.filter((b) => (lo(b) + hi(b)) / 2 < mid && hi(b) <= lo(m) + (hi(m) - lo(m)) / 2);
  const after = sorted.filter((b) => (lo(b) + hi(b)) / 2 > mid && lo(b) >= hi(m) - (hi(m) - lo(m)) / 2);
  const prev = before.length ? before.reduce((p, q) => (hi(q) > hi(p) ? q : p)) : null;
  const next = after.length ? after.reduce((p, q) => (lo(q) < lo(p) ? q : p)) : null;
  const out: number[] = [];
  for (const g of gaps) {
    if (prev) out.push(hi(prev) + g - lo(m));
    if (next) out.push(lo(next) - g - hi(m));
  }
  // genau mittig zwischen zwei Nachbarn
  if (prev && next) {
    const free = lo(next) - hi(prev) - (hi(m) - lo(m));
    if (free > EPS) out.push(hi(prev) + free / 2 - lo(m));
  }
  return out;
}

/**
 * Verschiebung (dx, dy) für das gezogene Objekt so anpassen, dass es an anderen Objekten einrastet.
 * @param start Box des Objekts zu Beginn des Ziehens
 * @param dx/dy rohe Verschiebung (Maus)
 * @param others Boxen der übrigen Objekte
 * @param tol Fangweite in mm (≈ 6 Bildschirmpixel)
 * @param axes zusätzliche Fanglinien (z. B. Ursprung x = 0, y = 0)
 */
export function smartSnap(start: BBox, dx: number, dy: number, others: BBox[], tol: number, axes: { x: number[]; y: number[] } = { x: [], y: [] }): SmartSnap {
  const m = shift(start, dx, dy);
  const tx = [...axes.x];
  const ty = [...axes.y];
  for (const o of others) {
    tx.push(...xs(o));
    ty.push(...ys(o));
  }
  let bestX: number | null = null;
  for (const t of tx) for (const v of xs(m)) if (Math.abs(t - v) <= tol && (bestX === null || Math.abs(t - v) < Math.abs(bestX))) bestX = t - v;
  let bestY: number | null = null;
  for (const t of ty) for (const v of ys(m)) if (Math.abs(t - v) <= tol && (bestY === null || Math.abs(t - v) < Math.abs(bestY))) bestY = t - v;

  // gleiche Abstände: Reihe = Objekte, die sich in der anderen Richtung überlappen
  const rowX = others.filter((o) => overlap(o.minY, o.maxY, m.minY, m.maxY));
  const rowY = others.filter((o) => overlap(o.minX, o.maxX, m.minX, m.maxX));
  for (const c of spacingCandidates(m, rowX, 'x')) if (Math.abs(c) <= tol && (bestX === null || Math.abs(c) < Math.abs(bestX) - EPS)) bestX = c;
  for (const c of spacingCandidates(m, rowY, 'y')) if (Math.abs(c) <= tol && (bestY === null || Math.abs(c) < Math.abs(bestY) - EPS)) bestY = c;

  const fdx = dx + (bestX ?? 0);
  const fdy = dy + (bestY ?? 0);
  const f = shift(start, fdx, fdy);
  const lines: GuideLine[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  // Linien für alle Übereinstimmungen nach dem Einrasten
  for (const v of xs(f)) {
    const hits = others.filter((o) => xs(o).some((t) => near(t, v)));
    if (hits.length) {
      const all = [f, ...hits];
      lines.push({ axis: 'x', at: v, a: Math.min(...all.map((b) => b.minY)), b: Math.max(...all.map((b) => b.maxY)) });
    } else if (axes.x.some((t) => near(t, v))) lines.push({ axis: 'x', at: v, a: f.minY - tol * 4, b: f.maxY + tol * 4 });
  }
  for (const v of ys(f)) {
    const hits = others.filter((o) => ys(o).some((t) => near(t, v)));
    if (hits.length) {
      const all = [f, ...hits];
      lines.push({ axis: 'y', at: v, a: Math.min(...all.map((b) => b.minX)), b: Math.max(...all.map((b) => b.maxX)) });
    } else if (axes.y.some((t) => near(t, v))) lines.push({ axis: 'y', at: v, a: f.minX - tol * 4, b: f.maxX + tol * 4 });
  }
  return { dx: fdx, dy: fdy, lines, gaps: [...gapMarks(f, others, 'x'), ...gapMarks(f, others, 'y')] };
}

/** Abstände zu den direkten Nachbarn in Reihe/Spalte; gleiche Abstände in der Reihe werden mit markiert. */
function gapMarks(f: BBox, others: BBox[], axis: 'x' | 'y'): GapMark[] {
  const lo = (b: BBox) => (axis === 'x' ? b.minX : b.minY);
  const hi = (b: BBox) => (axis === 'x' ? b.maxX : b.maxY);
  const clo = (b: BBox) => (axis === 'x' ? b.minY : b.minX);
  const chi = (b: BBox) => (axis === 'x' ? b.maxY : b.maxX);
  const row = others.filter((o) => overlap(clo(o), chi(o), clo(f), chi(f)));
  const prev = row.filter((b) => hi(b) <= lo(f) + EPS).reduce<BBox | null>((p, q) => (!p || hi(q) > hi(p) ? q : p), null);
  const next = row.filter((b) => lo(b) >= hi(f) - EPS).reduce<BBox | null>((p, q) => (!p || lo(q) < lo(p) ? q : p), null);
  const mid = (a: BBox, b: BBox) => (Math.max(clo(a), clo(b)) + Math.min(chi(a), chi(b))) / 2;
  const out: GapMark[] = [];
  const mine: number[] = [];
  if (prev) {
    mine.push(lo(f) - hi(prev));
    out.push({ axis, at: mid(prev, f), a: hi(prev), b: lo(f), equal: false });
  }
  if (next) {
    mine.push(lo(next) - hi(f));
    out.push({ axis, at: mid(f, next), a: hi(f), b: lo(next), equal: false });
  }
  // gleiche Abstände unter den übrigen Objekten der Reihe
  const sorted = [...row].sort((p, q) => lo(p) - lo(q));
  for (let i = 1; i < sorted.length; i++) {
    const g = lo(sorted[i]) - hi(sorted[i - 1]);
    if (g > EPS && mine.some((x) => Math.abs(x - g) < 1e-3)) out.push({ axis, at: mid(sorted[i - 1], sorted[i]), a: hi(sorted[i - 1]), b: lo(sorted[i]), equal: true });
  }
  if (out.filter((g) => g.equal).length) for (const g of out) if (mine.some((x) => Math.abs(x - (g.b - g.a)) < 1e-3)) g.equal = true;
  if (prev && next && Math.abs(mine[0] - mine[1]) < 1e-3) for (const g of out) g.equal = true;
  return out.filter((g) => g.b - g.a > EPS);
}

const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });

/** Hilfslinien und Abstände zeichnen (Bildschirm-Koordinaten über `S`). */
export function drawSmartGuides(ctx: CanvasRenderingContext2D, snap: SmartSnap, S: (x: number, y: number) => { x: number; y: number }, color: string, font: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  for (const l of snap.lines) {
    const p = l.axis === 'x' ? S(l.at, l.a) : S(l.a, l.at);
    const q = l.axis === 'x' ? S(l.at, l.b) : S(l.b, l.at);
    ctx.beginPath();
    ctx.moveTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
    ctx.lineTo(Math.round(q.x) + 0.5, Math.round(q.y) + 0.5);
    ctx.stroke();
  }
  ctx.font = `600 10.5px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const g of snap.gaps) {
    if (!g.equal && snap.gaps.some((o) => o.equal)) continue;
    const p = g.axis === 'x' ? S(g.a, g.at) : S(g.at, g.a);
    const q = g.axis === 'x' ? S(g.b, g.at) : S(g.at, g.b);
    if (Math.hypot(q.x - p.x, q.y - p.y) < 14) continue;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    // Endstriche
    const nx = g.axis === 'x' ? 0 : 4;
    const ny = g.axis === 'x' ? 4 : 0;
    ctx.moveTo(p.x - nx, p.y - ny);
    ctx.lineTo(p.x + nx, p.y + ny);
    ctx.moveTo(q.x - nx, q.y - ny);
    ctx.lineTo(q.x + nx, q.y + ny);
    ctx.stroke();
    const text = fmt(g.b - g.a);
    const w = ctx.measureText(text).width + 8;
    const cx = (p.x + q.x) / 2;
    const cy = (p.y + q.y) / 2;
    ctx.beginPath();
    ctx.roundRect?.(cx - w / 2, cy - 8, w, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, cx, cy + 0.5);
    ctx.fillStyle = color;
  }
  ctx.restore();
}
