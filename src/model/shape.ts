import type { Contour, Id, ShapeEntity, ShapeNode, SketchDoc, Style, Vec2 } from './types';
import { addPoint, newId, pt } from './doc';

/**
 * Freie Formen: Konturen aus Knoten mit optionalen kubischen Bézier-Griffen.
 * Ein Segment läuft von Knoten i (Griff „o“) nach Knoten i+1 (Griff „i“); ohne Griffe ist es gerade.
 */

export type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };

/** Lokal → Welt: Anker + Drehung · Maßstab · (Spiegelung) */
export function shapeMatrix(doc: SketchDoc, s: ShapeEntity): Mat {
  const o = pt(doc, s.anchor);
  const r = (s.rotation * Math.PI) / 180;
  const k = s.scale;
  const fx = s.flipX ? -1 : 1;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos * k * fx, b: sin * k * fx, c: -sin * k, d: cos * k, e: o.x, f: o.y };
}

export const apply = (m: Mat, p: Vec2): Vec2 => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });

export function mapNode(n: ShapeNode, f: (p: Vec2) => Vec2): ShapeNode {
  const p = f(n);
  const out: ShapeNode = { x: p.x, y: p.y };
  if (n.ix !== undefined && n.iy !== undefined) {
    const h = f({ x: n.ix, y: n.iy });
    out.ix = h.x;
    out.iy = h.y;
  }
  if (n.ox !== undefined && n.oy !== undefined) {
    const h = f({ x: n.ox, y: n.oy });
    out.ox = h.x;
    out.oy = h.y;
  }
  return out;
}

export function mapContours(cs: Contour[], f: (p: Vec2) => Vec2): Contour[] {
  return cs.map((c) => ({ closed: c.closed, nodes: c.nodes.map((n) => mapNode(n, f)) }));
}

/** Konturen in Weltkoordinaten (mm). */
export function shapeWorldContours(doc: SketchDoc, s: ShapeEntity): Contour[] {
  const m = shapeMatrix(doc, s);
  return mapContours(s.contours, (p) => apply(m, p));
}

function cubicAt(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Segmente einer Kontur als [Start, Griff1, Griff2, Ende] (gerade Segmente mit Griffen = Endpunkte). */
export function segments(c: Contour): { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2; curved: boolean }[] {
  const out: { p0: Vec2; p1: Vec2; p2: Vec2; p3: Vec2; curved: boolean }[] = [];
  const n = c.nodes.length;
  const count = c.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = c.nodes[i];
    const b = c.nodes[(i + 1) % n];
    const curved = a.ox !== undefined || b.ix !== undefined;
    const p1 = a.ox !== undefined && a.oy !== undefined ? { x: a.ox, y: a.oy } : { x: a.x, y: a.y };
    const p2 = b.ix !== undefined && b.iy !== undefined ? { x: b.ix, y: b.iy } : { x: b.x, y: b.y };
    out.push({ p0: { x: a.x, y: a.y }, p1, p2, p3: { x: b.x, y: b.y }, curved });
  }
  return out;
}

/** Kontur als Polylinie mit Toleranz (mm, bzw. Einheiten der Kontur). */
export function flattenContour(c: Contour, tol = 0.01): Vec2[] {
  const out: Vec2[] = [];
  if (!c.nodes.length) return out;
  out.push({ x: c.nodes[0].x, y: c.nodes[0].y });
  for (const s of segments(c)) {
    if (!s.curved) {
      out.push(s.p3);
      continue;
    }
    // Unterteilung nach Länge des Kontrollpolygons
    const len = Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) + Math.hypot(s.p2.x - s.p1.x, s.p2.y - s.p1.y) + Math.hypot(s.p3.x - s.p2.x, s.p3.y - s.p2.y);
    const steps = Math.min(400, Math.max(2, Math.ceil(Math.sqrt(len / tol) * 0.6)));
    for (let k = 1; k <= steps; k++) out.push(cubicAt(s.p0, s.p1, s.p2, s.p3, k / steps));
  }
  if (c.closed && out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.abs(f.x - l.x) < 1e-9 && Math.abs(f.y - l.y) < 1e-9) out.pop();
  }
  return out;
}

export function contoursBBox(cs: Contour[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cs) {
    for (const p of flattenContour(c, 0.02)) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return minX <= maxX ? { minX, minY, maxX, maxY } : null;
}

/** Breite und Höhe der Form (ohne Drehung, mit Maßstab). */
export function shapeSize(s: ShapeEntity): { w: number; h: number } {
  const b = contoursBBox(s.contours);
  if (!b) return { w: 0, h: 0 };
  return { w: (b.maxX - b.minX) * s.scale, h: (b.maxY - b.minY) * s.scale };
}

/** SVG-Pfaddaten; `f` bildet Konturpunkte auf Zielkoordinaten ab. */
export function contoursToSvgD(cs: Contour[], f: (p: Vec2) => Vec2, fmt: (n: number) => string = (n) => String(Math.round(n * 1000) / 1000)): string {
  const parts: string[] = [];
  for (const c of cs) {
    if (!c.nodes.length) continue;
    const s0 = f(c.nodes[0]);
    parts.push(`M${fmt(s0.x)} ${fmt(s0.y)}`);
    const segs = segments(c);
    // Geschlossen: die gerade Schlusskante übernimmt „Z“
    if (c.closed && segs.length && !segs[segs.length - 1].curved) segs.pop();
    for (const seg of segs) {
      const e = f(seg.p3);
      if (seg.curved) {
        const a = f(seg.p1);
        const b = f(seg.p2);
        parts.push(`C${fmt(a.x)} ${fmt(a.y)} ${fmt(b.x)} ${fmt(b.y)} ${fmt(e.x)} ${fmt(e.y)}`);
      } else parts.push(`L${fmt(e.x)} ${fmt(e.y)}`);
    }
    if (c.closed) parts.push('Z');
  }
  return parts.join(' ');
}

const KAPPA = 0.5522847498307936;

/** Kreis als vier Bézier-Segmente (gegen den Uhrzeigersinn, Y nach oben). */
export function circleContour(cx: number, cy: number, r: number): Contour {
  const k = r * KAPPA;
  return {
    closed: true,
    nodes: [
      { x: cx + r, y: cy, iy: cy - k, ix: cx + r, ox: cx + r, oy: cy + k },
      { x: cx, y: cy + r, ix: cx + k, iy: cy + r, ox: cx - k, oy: cy + r },
      { x: cx - r, y: cy, ix: cx - r, iy: cy + k, ox: cx - r, oy: cy - k },
      { x: cx, y: cy - r, ix: cx - k, iy: cy - r, ox: cx + k, oy: cy - r },
    ],
  };
}

export function polygonContour(pts: Vec2[], closed = true): Contour {
  return { closed, nodes: pts.map((p) => ({ x: p.x, y: p.y })) };
}

/**
 * Legt eine Form aus Weltkonturen an. Der Anker liegt in der Mitte des umschließenden Rechtecks.
 */
export function addShapeFromWorld(d: SketchDoc, world: Contour[], style: Style, opts: { name?: string; fillRule?: 'nonzero' | 'evenodd'; layer?: Id } = {}): ShapeEntity {
  const b = contoursBBox(world) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const id = newId(d, 's');
  const anchor = addPoint(d, { x: cx, y: cy }, { owner: id });
  const s: ShapeEntity = {
    id,
    kind: 'shape',
    anchor,
    contours: mapContours(world, (p) => ({ x: p.x - cx, y: p.y - cy })),
    fillRule: opts.fillRule ?? 'nonzero',
    scale: 1,
    rotation: 0,
    construction: false,
    style: { ...style },
  };
  if (opts.name) s.name = opts.name;
  if (opts.layer) s.layer = opts.layer;
  d.entities[id] = s;
  d.order.push(id);
  return s;
}

/** Punkt in Polygon (gerade/ungerade bzw. Umlaufzahl). */
export function pointInPolys(p: Vec2, polys: Vec2[][], rule: 'nonzero' | 'evenodd'): boolean {
  let winding = 0;
  let crossings = 0;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
      const b = poly[i];
      if (a.y <= p.y) {
        if (b.y > p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) > 0) {
          winding++;
          crossings++;
        }
      } else if (b.y <= p.y && (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y) < 0) {
        winding--;
        crossings++;
      }
    }
  }
  return rule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

/** Fläche (mit Vorzeichen) eines Polygons. */
export function polyArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return -a / 2;
}

export function polyLength(poly: Vec2[], closed: boolean): number {
  let l = 0;
  for (let i = 1; i < poly.length; i++) l += Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y);
  if (closed && poly.length > 1) l += Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y);
  return l;
}

const polyCache = new WeakMap<ShapeEntity, { anchor: object; tol: number; polys: Vec2[][] }>();

/** Abgeflachte Weltkonturen (zwischengespeichert, solange sich Form und Anker nicht ändern). */
export function shapeWorldPolys(doc: SketchDoc, s: ShapeEntity, tol = 0.02): Vec2[][] {
  const anchor = doc.points[s.anchor];
  const hit = polyCache.get(s);
  if (hit && hit.anchor === anchor && hit.tol === tol) return hit.polys;
  const polys = shapeWorldContours(doc, s).map((c) => flattenContour(c, tol));
  polyCache.set(s, { anchor, tol, polys });
  return polys;
}
