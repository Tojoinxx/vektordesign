import type { BBox } from '../model/geometry';
import { bboxAddPoint, distToSegment, emptyBBox, polygonArea } from '../model/geometry';
import type { Contour, EdgeRef, Id, Pattern, PatternPiece, Seam, SketchDoc, Vec2 } from '../model/types';
import { pt } from '../model/doc';
import { arcGeom, arcNodes } from '../model/arc';
import { flattenContour, polyLength, segments, shapeWorldContours } from '../model/shape';
import { offsetArea } from '../model/boolean';

/**
 * Geometrie der Schnittteile: Kanten (für Nähte), Umriss, Nahtzugabe, Fadenlauf und Nahtlängen.
 * Alles in Weltkoordinaten (mm, Y nach oben), direkt aus der Zeichnung abgeleitet – die Schnittteile
 * folgen also Bemaßungen und Bearbeitungen ohne Kopie.
 */

const FLAT_TOL = 0.05;

export interface PieceEdge {
  index: number;
  /** Polylinie der Kante in Laufrichtung (Welt, mm) */
  pts: Vec2[];
  length: number;
}

export interface PieceGeom {
  piece: PatternPiece;
  /** Geschlossener Umriss (ohne doppelten Endpunkt) */
  polygon: Vec2[];
  edges: PieceEdge[];
  /** Umlaufsinn gegen den Uhrzeigersinn */
  ccw: boolean;
  area: number;
  box: BBox;
  /** Flächenschwerpunkt (für Beschriftung und Fadenlauf) */
  center: Vec2;
}

export function emptyPattern(): Pattern {
  return {
    pieces: [],
    seams: [],
    materials: [],
    body: { height: 1790, chest: 1000, waist: 880, hip: 1010, neck: 390, shoulder: 460, arm: 625, upperArm: 320, wrist: 170, backLength: 440, head: 570 },
    bodySize: 'H-M',
  };
}

/** Kann dieses Objekt Schnittteil werden? (geschlossener Pfad oder Form mit geschlossener Kontur) */
export function canBePiece(doc: SketchDoc, id: Id): boolean {
  const e = doc.entities[id];
  if (!e || e.construction) return false;
  if (e.kind === 'path') return e.closed && e.edges.length >= 2;
  if (e.kind === 'shape') return e.contours.some((c) => c.closed && c.nodes.length >= 2);
  if (e.kind === 'circle') return false;
  return false;
}

function flattenSegment(c: Contour): Vec2[] {
  return flattenContour(c, FLAT_TOL);
}

/** Kanten eines Schnittteils in Laufrichtung. */
export function pieceEdges(doc: SketchDoc, piece: PatternPiece): PieceEdge[] | null {
  const e = doc.entities[piece.outline];
  if (!e) return null;
  const out: PieceEdge[] = [];
  if (e.kind === 'path') {
    if (!e.closed) return null;
    e.edges.forEach((edge, index) => {
      const g = doc.entities[edge.id];
      let pts: Vec2[] = [];
      if (g?.kind === 'line') {
        const a = pt(doc, g.p1);
        const b = pt(doc, g.p2);
        pts = edge.reversed
          ? [
              { x: b.x, y: b.y },
              { x: a.x, y: a.y },
            ]
          : [
              { x: a.x, y: a.y },
              { x: b.x, y: b.y },
            ];
      } else if (g?.kind === 'arc') {
        pts = flattenSegment({ closed: false, nodes: arcNodes(arcGeom(doc, g), edge.reversed) });
      }
      if (pts.length >= 2) out.push({ index, pts, length: polyLength(pts, false) });
    });
    return out.length >= 2 ? out : null;
  }
  if (e.kind === 'shape') {
    const c = shapeWorldContours(doc, e).find((k) => k.closed && k.nodes.length >= 2);
    if (!c) return null;
    segments(c).forEach((sg, index) => {
      const node0 = { x: sg.p0.x, y: sg.p0.y, ...(sg.curved ? { ox: sg.p1.x, oy: sg.p1.y } : {}) };
      const node1 = { x: sg.p3.x, y: sg.p3.y, ...(sg.curved ? { ix: sg.p2.x, iy: sg.p2.y } : {}) };
      const pts = flattenSegment({ closed: false, nodes: [node0, node1] });
      out.push({ index, pts, length: polyLength(pts, false) });
    });
    return out.length >= 2 ? out : null;
  }
  return null;
}

const geomCache = new WeakMap<SketchDoc, Map<Id, PieceGeom | null>>();

/** Umriss und Kanten eines Schnittteils (zwischengespeichert je Dokumentstand). */
export function pieceGeom(doc: SketchDoc, piece: PatternPiece): PieceGeom | null {
  let m = geomCache.get(doc);
  if (!m) {
    m = new Map();
    geomCache.set(doc, m);
  }
  const key = `${piece.id}:${piece.outline}`;
  if (m.has(key)) {
    const hit = m.get(key)!;
    if (hit === null || hit.piece === piece) return hit;
  }
  const edges = pieceEdges(doc, piece);
  let g: PieceGeom | null = null;
  if (edges) {
    const polygon: Vec2[] = [];
    for (const ed of edges) polygon.push(...ed.pts.slice(0, -1));
    const signed = polygonArea(polygon);
    const box = emptyBBox();
    for (const p of polygon) bboxAddPoint(box, p);
    g = { piece, polygon, edges, ccw: signed > 0, area: Math.abs(signed), box, center: centroid(polygon) };
  }
  m.set(key, g);
  return g;
}

export function centroid(poly: Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(1, poly.length);
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function patternOf(doc: SketchDoc): Pattern | undefined {
  return doc.pattern;
}

export function pieceById(doc: SketchDoc, id: Id): PatternPiece | undefined {
  return doc.pattern?.pieces.find((p) => p.id === id);
}

export function pieceOfOutline(doc: SketchDoc, outline: Id): PatternPiece | undefined {
  return doc.pattern?.pieces.find((p) => p.outline === outline);
}

export function edgeOf(doc: SketchDoc, ref: EdgeRef): PieceEdge | null {
  const piece = pieceById(doc, ref.piece);
  if (!piece) return null;
  return pieceGeom(doc, piece)?.edges[ref.edge] ?? null;
}

/** Nächste Schnittteil-Kante zu einem Weltpunkt (innerhalb `tol` mm). */
export function nearestEdge(doc: SketchDoc, p: Vec2, tol: number): (EdgeRef & { dist: number }) | null {
  let best: (EdgeRef & { dist: number }) | null = null;
  for (const piece of doc.pattern?.pieces ?? []) {
    const g = pieceGeom(doc, piece);
    if (!g) continue;
    if (p.x < g.box.minX - tol || p.x > g.box.maxX + tol || p.y < g.box.minY - tol || p.y > g.box.maxY + tol) continue;
    for (const ed of g.edges) {
      for (let i = 0; i + 1 < ed.pts.length; i++) {
        const d = distToSegment(p, ed.pts[i], ed.pts[i + 1]);
        if (d <= tol && (!best || d < best.dist)) best = { piece: piece.id, edge: ed.index, dist: d };
      }
    }
  }
  return best;
}

export const sameEdge = (a: EdgeRef, b: EdgeRef) => a.piece === b.piece && a.edge === b.edge && (a.copy ?? 0) === (b.copy ?? 0);

/** Nähte, an denen eine Kante beteiligt ist. */
export function seamsAt(pattern: Pattern, ref: EdgeRef, anyCopy = true): Seam[] {
  return pattern.seams.filter((s) => [s.a, s.b].some((r) => r.piece === ref.piece && r.edge === ref.edge && (anyCopy || (r.copy ?? 0) === (ref.copy ?? 0))));
}

/** Nahtzugabe als geschlossene Polygone (Welt). */
export function seamAllowanceOutline(g: PieceGeom): Vec2[][] {
  if (g.piece.seamAllowance <= 0) return [];
  return offsetArea([g.polygon], g.piece.seamAllowance, 'miter');
}

/** Fadenlauf-Pfeil: zwei Endpunkte durch den Schwerpunkt. */
export function grainLine(g: PieceGeom): [Vec2, Vec2] {
  const h = (g.box.maxY - g.box.minY) * 0.55;
  const w = (g.box.maxX - g.box.minX) * 0.55;
  const L = Math.max(20, Math.min(h || w, 400));
  const a = (g.piece.grain * Math.PI) / 180;
  const d = { x: Math.sin(a) * (L / 2), y: Math.cos(a) * (L / 2) };
  return [
    { x: g.center.x - d.x, y: g.center.y - d.y },
    { x: g.center.x + d.x, y: g.center.y + d.y },
  ];
}

export interface SeamCheck {
  seam: Seam;
  lenA: number;
  lenB: number;
  /** lenA − lenB in mm */
  diff: number;
  /** Ein Teil ist Bündchen/Rippe: Längenunterschied gewollt (wird gedehnt) */
  ribbed: boolean;
  /** Dehnung des kürzeren Teils in % */
  stretch: number;
  ok: boolean;
  message: string;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 });

export function pieceLabel(doc: SketchDoc, ref: EdgeRef): string {
  const p = pieceById(doc, ref.piece);
  const copy = p?.cut === 2 ? (ref.copy ? ' (Gegenstück)' : ' (wie gezeichnet)') : '';
  return `${p?.name ?? '?'}${copy} · Kante ${ref.edge + 1}`;
}

/** Nahtlängen prüfen: beide Kanten einer Naht sollten gleich lang sein (Toleranz 2 mm). */
export function checkSeams(doc: SketchDoc, tol = 2): SeamCheck[] {
  const pat = doc.pattern;
  if (!pat) return [];
  const isRib = (id: Id) => {
    const p = pieceById(doc, id);
    if (!p) return false;
    if (p.role === 'cuff' || p.role === 'hem' || p.role === 'neckband') return true;
    const m = pat.materials.find((x) => x.id === p.material);
    return m?.fabric === 'rib';
  };
  const out: SeamCheck[] = [];
  for (const seam of pat.seams) {
    const a = edgeOf(doc, seam.a);
    const b = edgeOf(doc, seam.b);
    if (!a || !b) continue;
    const diff = a.length - b.length;
    const ribbed = isRib(seam.a.piece) !== isRib(seam.b.piece);
    const short = Math.min(a.length, b.length);
    const stretch = short > 0 ? (Math.max(a.length, b.length) / short - 1) * 100 : 0;
    let ok = Math.abs(diff) <= tol;
    let message: string;
    if (ok) message = `Passt (${fmt(a.length)} mm)`;
    else if (ribbed) {
      ok = stretch <= 35;
      message = ok ? `Bündchen wird um ${fmt(stretch)} % gedehnt` : `Bündchen müsste um ${fmt(stretch)} % gedehnt werden – zu viel (max. ca. 35 %)`;
    } else message = `Kanten unterschiedlich lang: ${fmt(a.length)} mm zu ${fmt(b.length)} mm (Differenz ${fmt(Math.abs(diff))} mm)`;
    out.push({ seam, lenA: a.length, lenB: b.length, diff, ribbed, stretch, ok, message });
  }
  return out;
}

/** Kanten eines Teils, die zu keiner Naht gehören (offene Kanten: Saum, Halsausschnitt …). */
export function freeEdges(doc: SketchDoc, piece: PatternPiece): number[] {
  const g = pieceGeom(doc, piece);
  const pat = doc.pattern;
  if (!g || !pat) return [];
  return g.edges.filter((e) => !seamsAt(pat, { piece: piece.id, edge: e.index }).length).map((e) => e.index);
}

/** Zuschnittfläche aller Teile inkl. Nahtzugabe und Anzahl (m²). */
export function fabricArea(doc: SketchDoc): number {
  let sum = 0;
  for (const p of doc.pattern?.pieces ?? []) {
    const g = pieceGeom(doc, p);
    if (!g) continue;
    const sa = seamAllowanceOutline(g);
    const a = sa.length ? Math.abs(sa.reduce((s, poly) => s + polygonArea(poly), 0)) : g.area;
    sum += a * p.cut;
  }
  return sum / 1e6;
}
