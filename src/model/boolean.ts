import * as ClipperNS from 'clipper-lib';
import type { Contour, Entity, SketchDoc, Vec2 } from './types';
import { pathVertices, pt } from './doc';
import { circleContour, flattenContour, polyArea, polygonContour, shapeWorldContours } from './shape';

/**
 * Flächenoperationen (Clipper): Vereinigen, Subtrahieren, Schnittmenge, Ausschließen, Versatz.
 * Gerechnet wird in ganzen Zahlen (0,1 µm), Kurven werden vorher fein abgeflacht (0,005 mm).
 */

// CommonJS-Modul: je nach Bündler als default oder als Namensraum
const CL: typeof ClipperNS = ((ClipperNS as unknown as { default?: typeof ClipperNS }).default ?? ClipperNS) as typeof ClipperNS;

const SCALE = 10000;
export const CURVE_TOL = 0.005;

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export const BOOL_LABELS: Record<BoolOp, string> = {
  union: 'Vereinigen',
  subtract: 'Subtrahieren',
  intersect: 'Schnittmenge',
  exclude: 'Ausschließen',
};

type Paths = ClipperNS.Paths;
const toPaths = (polys: Vec2[][]): Paths => polys.filter((p) => p.length >= 3).map((poly) => poly.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) })));
const fromPaths = (ps: Paths): Vec2[][] => ps.map((p) => p.map((q) => ({ x: q.X / SCALE, y: q.Y / SCALE }))).filter((p) => p.length >= 3);

function exec(type: ClipperNS.ClipType, subject: Paths, clip: Paths, rule: ClipperNS.PolyFillType): Paths {
  const c = new CL.Clipper();
  c.AddPaths(subject, CL.PolyType.ptSubject, true);
  if (clip.length) c.AddPaths(clip, CL.PolyType.ptClip, true);
  const out: Paths = [];
  c.Execute(type, out, rule, rule);
  return out;
}

/** Geschlossene Weltkonturen eines Objekts (Kreis, geschlossener Pfad, Form). Null = keine Fläche. */
export function entityContours(doc: SketchDoc, e: Entity): Contour[] | null {
  switch (e.kind) {
    case 'circle': {
      const c = pt(doc, e.center);
      return [circleContour(c.x, c.y, e.r)];
    }
    case 'path':
      return e.closed ? [polygonContour(pathVertices(doc, e))] : null;
    case 'shape':
      return shapeWorldContours(doc, e).filter((c) => c.closed);
    default:
      return null;
  }
}

/** Fläche eines Objekts als bereinigte Polygone (eigene Füllregel angewandt). */
export function entityArea(doc: SketchDoc, e: Entity): Vec2[][] | null {
  const cs = entityContours(doc, e);
  if (!cs || !cs.length) return null;
  const polys = cs.map((c) => flattenContour(c, CURVE_TOL));
  const rule = e.kind === 'shape' && e.fillRule === 'evenodd' ? CL.PolyFillType.pftEvenOdd : CL.PolyFillType.pftNonZero;
  return fromPaths(exec(CL.ClipType.ctUnion, toPaths(polys), [], rule));
}

/** Verknüpft Flächen in Zeichenreihenfolge (hinten zuerst). */
export function booleanAreas(op: BoolOp, areas: Vec2[][][]): Vec2[][] {
  if (!areas.length) return [];
  const nz = CL.PolyFillType.pftNonZero;
  if (op === 'union') return fromPaths(exec(CL.ClipType.ctUnion, toPaths(areas.flat()), [], nz));
  if (op === 'subtract') return fromPaths(exec(CL.ClipType.ctDifference, toPaths(areas[0]), toPaths(areas.slice(1).flat()), nz));
  let acc = toPaths(areas[0]);
  for (const a of areas.slice(1)) acc = exec(op === 'intersect' ? CL.ClipType.ctIntersection : CL.ClipType.ctXor, acc, toPaths(a), nz);
  return fromPaths(acc);
}

/** Versatz einer Fläche um `delta` mm (negativ = nach innen). */
export function offsetArea(polys: Vec2[][], delta: number, join: 'round' | 'miter' | 'bevel' = 'round'): Vec2[][] {
  const jt = join === 'round' ? CL.JoinType.jtRound : join === 'miter' ? CL.JoinType.jtMiter : CL.JoinType.jtSquare;
  const co = new CL.ClipperOffset(4, 0.002 * SCALE);
  co.AddPaths(toPaths(polys), jt, CL.EndType.etClosedPolygon);
  const out: Paths = [];
  co.Execute(out, delta * SCALE);
  return fromPaths(out);
}

/** Rundet (bzw. fast) alle Ecken einer Fläche mit Radius r. */
export function roundCorners(polys: Vec2[][], r: number, mode: 'fillet' | 'chamfer'): Vec2[][] {
  const join = mode === 'fillet' ? 'round' : 'bevel';
  // Konvexe Ecken: schrumpfen (scharf) und wieder wachsen (rund/gefast); konkave umgekehrt
  const a = offsetArea(offsetArea(polys, -r, 'miter'), r, join);
  return offsetArea(offsetArea(a, r, 'miter'), -r, join);
}

/** Polygone als geschlossene Konturen. */
export function polysToContours(polys: Vec2[][]): Contour[] {
  return polys.map((p) => polygonContour(p, true));
}

export function areaOf(polys: Vec2[][]): number {
  return Math.abs(polys.reduce((s, p) => s + polyArea(p), 0));
}
