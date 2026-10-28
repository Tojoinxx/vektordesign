import type { Vec2 } from './types';

/**
 * Formerkennung für Freihandskizzen (iPad mit Apple Pencil oder Maus): ein grober Strich wird
 * zu sauberer Geometrie – Linie, Kreis, Rechteck, Dreieck/Vieleck oder Linienzug.
 * Danach wird die Geometrie wie gewohnt über Bemaßungen exakt festgelegt.
 */

export type Recognized =
  | { kind: 'line'; a: Vec2; b: Vec2; hv: 'h' | 'v' | null }
  | { kind: 'circle'; c: Vec2; r: number }
  | { kind: 'rect'; min: Vec2; max: Vec2 }
  | { kind: 'polygon'; pts: Vec2[]; closed: boolean }
  | { kind: 'none' };

export const RECOGNIZED_LABELS: Record<Recognized['kind'], string> = {
  line: 'Linie',
  circle: 'Kreis',
  rect: 'Rechteck',
  polygon: 'Linienzug',
  none: '–',
};

const d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(pts: Vec2[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += d(pts[i - 1], pts[i]);
  return L;
}

/** Gleichmäßig neu abtasten (n Punkte). */
export function resample(pts: Vec2[], n: number): Vec2[] {
  if (pts.length < 2) return pts.slice();
  const L = pathLength(pts);
  const step = L / (n - 1);
  const out: Vec2[] = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length && out.length < n; i++) {
    let cur = pts[i];
    let seg = d(prev, cur);
    while (acc + seg >= step && seg > 0) {
      const t = (step - acc) / seg;
      const q = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(q);
      prev = q;
      seg = d(prev, cur);
      acc = 0;
      if (out.length >= n) break;
    }
    acc += seg;
    prev = cur;
    cur = pts[i];
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out;
}

function segDist(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-18) return d(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return d(p, { x: a.x + dx * t, y: a.y + dy * t });
}

/** Ramer-Douglas-Peucker */
export function simplify(pts: Vec2[], eps: number): Vec2[] {
  if (pts.length < 3) return pts.slice();
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const dd = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (dd > maxD) {
      maxD = dd;
      idx = i;
    }
  }
  if (maxD <= eps) return [pts[0], pts[pts.length - 1]];
  const a = simplify(pts.slice(0, idx + 1), eps);
  const b = simplify(pts.slice(idx), eps);
  return [...a.slice(0, -1), ...b];
}

/** Kreis-Ausgleich (Kåsa): Mittelpunkt, Radius und relative Abweichung. */
export function fitCircle(pts: Vec2[]): { c: Vec2; r: number; err: number } | null {
  const n = pts.length;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (const p of pts) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let suu = 0;
  let svv = 0;
  let suv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const p of pts) {
    const u = p.x - mx;
    const v = p.y - my;
    suu += u * u;
    svv += v * v;
    suv += u * v;
    suuu += u * u * u;
    svvv += v * v * v;
    suvv += u * v * v;
    svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-12) return null;
  const bu = 0.5 * (suuu + suvv);
  const bv = 0.5 * (svvv + svuu);
  const uc = (bu * svv - bv * suv) / det;
  const vc = (suu * bv - suv * bu) / det;
  const c = { x: mx + uc, y: my + vc };
  const r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let e = 0;
  for (const p of pts) e += (d(p, c) - r) ** 2;
  return { c, r, err: Math.sqrt(e / n) / r };
}

function angleAt(a: Vec2, b: Vec2, c: Vec2): number {
  const u = { x: a.x - b.x, y: a.y - b.y };
  const v = { x: c.x - b.x, y: c.y - b.y };
  return (Math.acos(Math.max(-1, Math.min(1, (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1)))) * 180) / Math.PI;
}

const AXIS_TOL = 8; // Grad
const axisDev = (a: Vec2, b: Vec2) => {
  const ang = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) % 90;
  return Math.min(ang, 90 - ang);
};

export function recognize(raw: Vec2[]): Recognized {
  const pts = raw.filter((p, i) => i === 0 || d(p, raw[i - 1]) > 1e-6);
  if (pts.length < 2) return { kind: 'none' };
  const L = pathLength(pts);
  if (L < 1e-6) return { kind: 'none' };
  const first = pts[0];
  const last = pts[pts.length - 1];
  const chord = d(first, last);

  // Gerade: kaum Abweichung von der Sehne
  let maxDev = 0;
  for (const p of pts) maxDev = Math.max(maxDev, segDist(p, first, last));
  if (chord > 0.85 * L && maxDev < Math.max(0.06 * chord, 0.2)) {
    const ang = Math.abs((Math.atan2(last.y - first.y, last.x - first.x) * 180) / Math.PI);
    let hv: 'h' | 'v' | null = null;
    let b = last;
    if (Math.min(ang, 180 - ang) < AXIS_TOL) {
      hv = 'h';
      b = { x: last.x, y: first.y };
    } else if (Math.abs(ang - 90) < AXIS_TOL) {
      hv = 'v';
      b = { x: first.x, y: last.y };
    }
    return { kind: 'line', a: first, b, hv };
  }

  const closed = chord < Math.max(0.18 * L, 0.5);
  const rs = resample(pts, 64);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of rs) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);

  if (closed) {
    // Ecken suchen (geschlossene Kontur: Startpunkt liegt meist auf einer Seite)
    const loop = rs.slice(0, -1);
    const simple = simplifyClosed(loop, 0.07 * diag);
    const fit = fitCircle(rs);
    const aspect = (maxX - minX) / Math.max(maxY - minY, 1e-9);
    const sharp = simple.length >= 3 && simple.length <= 6 && simple.every((_, i) => angleAt(simple[(i + simple.length - 1) % simple.length], simple[i], simple[(i + 1) % simple.length]) < 135);
    if (fit && fit.err < 0.09 && aspect > 0.75 && aspect < 1.33 && !(sharp && simple.length <= 4)) {
      return { kind: 'circle', c: fit.c, r: fit.r };
    }
    if (simple.length === 4) {
      const angs = simple.map((_, i) => angleAt(simple[(i + 3) % 4], simple[i], simple[(i + 1) % 4]));
      if (angs.every((a) => Math.abs(a - 90) < 22)) {
        const edgesAxis = simple.every((p, i) => axisDev(p, simple[(i + 1) % 4]) < 14);
        if (edgesAxis) {
          const xs = simple.map((p) => p.x).sort((a, b) => a - b);
          const ys = simple.map((p) => p.y).sort((a, b) => a - b);
          // Mittel der jeweils zwei linken/rechten bzw. unteren/oberen Ecken
          return { kind: 'rect', min: { x: (xs[0] + xs[1]) / 2, y: (ys[0] + ys[1]) / 2 }, max: { x: (xs[2] + xs[3]) / 2, y: (ys[2] + ys[3]) / 2 } };
        }
        return { kind: 'polygon', pts: rectify(simple), closed: true };
      }
    }
    if (fit && fit.err < 0.12 && aspect > 0.7 && aspect < 1.43 && simple.length > 5) return { kind: 'circle', c: fit.c, r: fit.r };
    if (simple.length >= 3) return { kind: 'polygon', pts: simple.map(axisSnapEdges(simple)), closed: true };
  }
  const simple = simplify(pts, Math.max(0.04 * diag, 0.15));
  return { kind: 'polygon', pts: simple, closed: false };
}

/** Vereinfachung einer geschlossenen Kontur: an der vom Schwerpunkt entferntesten Stelle aufschneiden. */
function simplifyClosed(loop: Vec2[], eps: number): Vec2[] {
  const n = loop.length;
  if (n < 4) return loop;
  let far = 0;
  let best = -1;
  for (let i = 0; i < n; i++) {
    const dd = d(loop[i], loop[0]);
    if (dd > best) {
      best = dd;
      far = i;
    }
  }
  const a = simplify(loop.slice(0, far + 1), eps);
  const b = simplify([...loop.slice(far), loop[0]], eps);
  let out = [...a.slice(0, -1), ...b.slice(0, -1)];
  // Punkte auf fast gerader Strecke entfernen (auch den Startpunkt)
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[(i + out.length - 1) % out.length];
      const q = out[(i + 1) % out.length];
      if (angleAt(p, out[i], q) > 150 || segDist(out[i], p, q) < eps * 0.6) {
        out = out.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Vier Ecken eines schiefen Vierecks zum echten Rechteck machen (Mitte, Richtung, Seiten). */
function rectify(q: Vec2[]): Vec2[] {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const e0 = { x: q[1].x - q[0].x, y: q[1].y - q[0].y };
  const e2 = { x: q[2].x - q[3].x, y: q[2].y - q[3].y };
  const ux0 = e0.x + e2.x;
  const uy0 = e0.y + e2.y;
  const ul = Math.hypot(ux0, uy0) || 1;
  const u = { x: ux0 / ul, y: uy0 / ul };
  const v = { x: -u.y, y: u.x };
  const w = (d(q[0], q[1]) + d(q[3], q[2])) / 4;
  const h = (d(q[1], q[2]) + d(q[0], q[3])) / 4;
  const sgn = (q[2].x - q[1].x) * v.x + (q[2].y - q[1].y) * v.y >= 0 ? 1 : -1;
  return [
    { x: c.x - u.x * w - v.x * h * sgn, y: c.y - u.y * w - v.y * h * sgn },
    { x: c.x + u.x * w - v.x * h * sgn, y: c.y + u.y * w - v.y * h * sgn },
    { x: c.x + u.x * w + v.x * h * sgn, y: c.y + u.y * w + v.y * h * sgn },
    { x: c.x - u.x * w + v.x * h * sgn, y: c.y - u.y * w + v.y * h * sgn },
  ];
}

/** Fast waagrechte/senkrechte Kanten eines Vielecks ausrichten. */
function axisSnapEdges(poly: Vec2[]) {
  const out = poly.map((p) => ({ ...p }));
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    const ang = Math.abs((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
    if (Math.min(ang, 180 - ang) < 5) b.y = a.y;
    else if (Math.abs(ang - 90) < 5) b.x = a.x;
  }
  return (_: Vec2, i: number) => out[i];
}
