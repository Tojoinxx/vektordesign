import type { ArcEntity, Contour, Id, PathEntity, ShapeNode, SketchDoc, Vec2 } from './types';
import { dist } from './geometry';

/**
 * Kreisbögen: Geometrie, Bézier-Annäherung (für Darstellung/Export) und Hilfen für
 * „kreisartige“ Objekte (Kreis oder Bogen), die viele Abhängigkeiten gleich behandeln.
 */

const TAU = Math.PI * 2;

export interface ArcGeom {
  c: Vec2;
  r: number;
  /** Startwinkel (rad) */
  a0: number;
  /** Überstrichener Winkel gegen den Uhrzeigersinn, 0 < sweep ≤ 2π */
  sweep: number;
  p1: Vec2;
  p2: Vec2;
}

export const arcOf = (doc: SketchDoc, id: Id): ArcEntity | undefined => {
  const e = doc.entities[id];
  return e?.kind === 'arc' ? e : undefined;
};

export function arcGeomFromPoints(c: Vec2, p1: Vec2, p2: Vec2): ArcGeom {
  const r = dist(c, p1);
  const a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
  const a1 = Math.atan2(p2.y - c.y, p2.x - c.x);
  let sweep = a1 - a0;
  while (sweep <= 1e-12) sweep += TAU;
  while (sweep > TAU + 1e-12) sweep -= TAU;
  return { c, r, a0, sweep, p1, p2 };
}

export function arcGeom(doc: SketchDoc, a: ArcEntity): ArcGeom {
  return arcGeomFromPoints(doc.points[a.center], doc.points[a.p1], doc.points[a.p2]);
}

export const arcRadius = (doc: SketchDoc, a: ArcEntity) => dist(doc.points[a.center], doc.points[a.p1]);

export function arcPointAt(g: ArcGeom, t: number): Vec2 {
  const a = g.a0 + g.sweep * t;
  return { x: g.c.x + g.r * Math.cos(a), y: g.c.y + g.r * Math.sin(a) };
}

export const arcMidpoint = (g: ArcGeom) => arcPointAt(g, 0.5);

/** Liegt der Winkel (rad) im Bogen? */
export function angleOnArc(g: ArcGeom, ang: number): boolean {
  let d = ang - g.a0;
  while (d < 0) d += TAU;
  while (d >= TAU) d -= TAU;
  return d <= g.sweep + 1e-9;
}

/** Nächster Punkt auf dem Bogen. */
export function closestOnArc(p: Vec2, g: ArcGeom): Vec2 {
  const ang = Math.atan2(p.y - g.c.y, p.x - g.c.x);
  if (angleOnArc(g, ang)) return { x: g.c.x + g.r * Math.cos(ang), y: g.c.y + g.r * Math.sin(ang) };
  return dist(p, g.p1) < dist(p, g.p2) ? g.p1 : g.p2;
}

export const distToArc = (p: Vec2, g: ArcGeom) => dist(p, closestOnArc(p, g));

/** Umschließendes Rechteck (inkl. der Achsenextreme, die im Bogen liegen). */
export function arcBBox(g: ArcGeom): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts = [g.p1, g.p2];
  for (let k = 0; k < 4; k++) {
    const ang = (k * Math.PI) / 2;
    if (angleOnArc(g, ang)) pts.push({ x: g.c.x + g.r * Math.cos(ang), y: g.c.y + g.r * Math.sin(ang) });
  }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

/**
 * Bogen als Bézier-Knoten (höchstens 90° je Segment). Der erste Knoten hat nur einen
 * Ausgangsgriff, der letzte nur einen Eingangsgriff. `reverse` durchläuft vom Ende zum Start.
 */
export function arcNodes(g: ArcGeom, reverse = false): ShapeNode[] {
  const n = Math.max(1, Math.ceil(g.sweep / (Math.PI / 2) - 1e-9));
  const step = g.sweep / n;
  const k = (4 / 3) * Math.tan(step / 4) * g.r;
  const nodes: ShapeNode[] = [];
  for (let i = 0; i <= n; i++) {
    const a = g.a0 + step * i;
    const p = i === 0 ? g.p1 : i === n ? g.p2 : { x: g.c.x + g.r * Math.cos(a), y: g.c.y + g.r * Math.sin(a) };
    const t = { x: -Math.sin(a) * k, y: Math.cos(a) * k };
    const node: ShapeNode = { x: p.x, y: p.y };
    if (i > 0) {
      node.ix = p.x - t.x;
      node.iy = p.y - t.y;
    }
    if (i < n) {
      node.ox = p.x + t.x;
      node.oy = p.y + t.y;
    }
    nodes.push(node);
  }
  if (!reverse) return nodes;
  return nodes.reverse().map((nd) => {
    const out: ShapeNode = { x: nd.x, y: nd.y };
    if (nd.ox !== undefined) {
      out.ix = nd.ox;
      out.iy = nd.oy;
    }
    if (nd.ix !== undefined) {
      out.ox = nd.ix;
      out.oy = nd.iy;
    }
    return out;
  });
}

export const arcContour = (g: ArcGeom): Contour => ({ closed: false, nodes: arcNodes(g) });

/**
 * Kontur eines Pfads aus Linien und Bögen (mit Bézier-Griffen an den Bögen).
 */
export function pathContour(doc: SketchDoc, path: PathEntity): Contour {
  const nodes: ShapeNode[] = [];
  const pushNodes = (ns: ShapeNode[]) => {
    if (!ns.length) return;
    const last = nodes[nodes.length - 1];
    let start = 0;
    if (last && Math.hypot(last.x - ns[0].x, last.y - ns[0].y) < 1e-6) {
      // Knoten verschmelzen: Ausgangsgriff übernehmen
      if (ns[0].ox !== undefined) {
        last.ox = ns[0].ox;
        last.oy = ns[0].oy;
      }
      start = 1;
    }
    for (let i = start; i < ns.length; i++) nodes.push({ ...ns[i] });
  };
  for (const edge of path.edges) {
    const e = doc.entities[edge.id];
    if (!e) continue;
    if (e.kind === 'line') {
      const a = doc.points[edge.reversed ? e.p2 : e.p1];
      const b = doc.points[edge.reversed ? e.p1 : e.p2];
      pushNodes([
        { x: a.x, y: a.y },
        { x: b.x, y: b.y },
      ]);
    } else if (e.kind === 'arc') {
      pushNodes(arcNodes(arcGeom(doc, e), edge.reversed));
    }
  }
  if (path.closed && nodes.length > 1) {
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
      if (last.ix !== undefined) {
        first.ix = last.ix;
        first.iy = last.iy;
      }
      nodes.pop();
    }
  }
  return { closed: path.closed, nodes };
}

/** Enthält der Pfad Bögen? */
export const pathHasArcs = (doc: SketchDoc, path: PathEntity) => path.edges.some((e) => doc.entities[e.id]?.kind === 'arc');

/** Start- und Endpunkt-Id einer Kante (Linie oder Bogen) in Durchlaufrichtung. */
export function edgeEnds(doc: SketchDoc, id: Id, reversed: boolean): [Id, Id] | null {
  const e = doc.entities[id];
  if (!e || (e.kind !== 'line' && e.kind !== 'arc')) return null;
  return reversed ? [e.p2, e.p1] : [e.p1, e.p2];
}

/** Kreis oder Bogen mit Mittelpunkt und Radius (für Abhängigkeiten und Bemaßungen). */
export interface Round {
  id: Id;
  kind: 'circle' | 'arc';
  center: Id;
  r: number;
}

export function roundOf(doc: SketchDoc, id: Id): Round | undefined {
  const e = doc.entities[id];
  if (e?.kind === 'circle') return { id, kind: 'circle', center: e.center, r: e.r };
  if (e?.kind === 'arc') return { id, kind: 'arc', center: e.center, r: arcRadius(doc, e) };
  return undefined;
}

/**
 * Kreis durch drei Punkte (Start, ein Punkt auf dem Bogen, Ende). Gibt Mittelpunkt und die
 * Richtung zurück, in der der Bogen vom Start über `m` zum Ende läuft.
 */
export function circleThrough3(a: Vec2, m: Vec2, b: Vec2): { c: Vec2; r: number; ccw: boolean } | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const m2 = m.x * m.x + m.y * m.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c = { x: (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d, y: (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d };
  // Orientierung von a → m → b: gegen den Uhrzeigersinn, wenn das Kreuzprodukt positiv ist
  const ccw = (m.x - a.x) * (b.y - a.y) - (m.y - a.y) * (b.x - a.x) > 0;
  return { c, r: dist(c, a), ccw };
}
