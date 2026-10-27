import type { Vec2 } from './types';

export const EPS = 1e-9;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export function norm(a: Vec2): Vec2 {
  const l = len(a);
  return l < EPS ? { x: 1, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function rotate(a: Vec2, ang: number): Vec2 {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export const toRad = (deg: number) => (deg * Math.PI) / 180;
export const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Winkel normiert auf (−π, π] */
export function normAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** Winkel normiert auf [0, 2π) */
export function normAngle2pi(a: number): number {
  let r = a % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r;
}

/** Nächster Punkt auf der Strecke ab zu p und Parameter t (0…1). */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return { point: a, t: 0 };
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { point: lerp(a, b, t), t };
}

/** Lotfußpunkt auf der unendlichen Geraden durch a, b. */
export function projectOnLine(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < EPS) return a;
  const t = dot(sub(p, a), ab) / l2;
  return lerp(a, b, t);
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestOnSegment(p, a, b).point);
}

/** Senkrechter Abstand von p zur unendlichen Geraden durch a, b. */
export function distToLine(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l = len(ab);
  if (l < EPS) return dist(p, a);
  return Math.abs(cross(ab, sub(p, a))) / l;
}

/** Schnittpunkt zweier Strecken (nur innerhalb beider Strecken). */
export function segmentIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const qp = sub(b1, a1);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  const tol = 1e-9;
  if (t < -tol || t > 1 + tol || u < -tol || u > 1 + tol) return null;
  return add(a1, mul(r, t));
}

/** Schnittpunkt zweier unendlicher Geraden. */
export function lineIntersection(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = cross(r, s);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(b1, a1), s) / den;
  return add(a1, mul(r, t));
}

/** Schnittpunkte Strecke–Kreis. */
export function segmentCircleIntersections(a: Vec2, b: Vec2, c: Vec2, r: number): Vec2[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = dot(d, d);
  if (A < EPS) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out: Vec2[] = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t >= -1e-9 && t <= 1 + 1e-9) out.push(add(a, mul(d, t)));
  }
  if (out.length === 2 && dist(out[0], out[1]) < 1e-9) out.pop();
  return out;
}

/** Schnittpunkte Kreis–Kreis. */
export function circleCircleIntersections(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d < EPS || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const u = norm(sub(c2, c1));
  const p = add(c1, mul(u, a));
  if (h < 1e-9) return [p];
  const n = perp(u);
  return [add(p, mul(n, h)), add(p, mul(n, -h))];
}

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBBox = (): BBox => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

export function bboxAddPoint(b: BBox, p: Vec2, pad = 0): void {
  if (p.x - pad < b.minX) b.minX = p.x - pad;
  if (p.y - pad < b.minY) b.minY = p.y - pad;
  if (p.x + pad > b.maxX) b.maxX = p.x + pad;
  if (p.y + pad > b.maxY) b.maxY = p.y + pad;
}

export function bboxUnion(a: BBox, b: BBox): BBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export const bboxValid = (b: BBox) => Number.isFinite(b.minX) && b.maxX >= b.minX && b.maxY >= b.minY;
export const bboxWidth = (b: BBox) => b.maxX - b.minX;
export const bboxHeight = (b: BBox) => b.maxY - b.minY;

export function bboxContainsBox(outer: BBox, inner: BBox): boolean {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Strecke schneidet oder liegt in Rechteck (für Kreuzungsauswahl). */
export function segmentTouchesBox(a: Vec2, b: Vec2, box: BBox): boolean {
  const inside = (p: Vec2) => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
  if (inside(a) || inside(b)) return true;
  const c = [v(box.minX, box.minY), v(box.maxX, box.minY), v(box.maxX, box.maxY), v(box.minX, box.maxY)];
  for (let i = 0; i < 4; i++) {
    if (segmentIntersection(a, b, c[i], c[(i + 1) % 4])) return true;
  }
  return false;
}

export function circleTouchesBox(c: Vec2, r: number, box: BBox): boolean {
  // Kreislinie berührt Box, wenn nicht ganz innerhalb des Kreises und nicht ganz außerhalb.
  const nx = Math.max(box.minX, Math.min(c.x, box.maxX));
  const ny = Math.max(box.minY, Math.min(c.y, box.maxY));
  const nearest = Math.hypot(c.x - nx, c.y - ny);
  if (nearest > r) return false;
  const fx = Math.max(Math.abs(c.x - box.minX), Math.abs(c.x - box.maxX));
  const fy = Math.max(Math.abs(c.y - box.minY), Math.abs(c.y - box.maxY));
  const farthest = Math.hypot(fx, fy);
  return farthest >= r;
}

/** Fläche eines Polygons (positiv = gegen den Uhrzeigersinn). */
export function polygonArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Rundet Werte für die Ausgabe und entfernt −0 sowie Solver-Rauschen. */
export function clean(n: number, decimals = 6): number {
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
