import type { Id, LineEntity, SketchDoc, Vec2 } from '../model/types';
import { addLine, dissolvePath, lineOf, pathOfLine, pt } from '../model/doc';
import { shapeWorldPolys } from '../model/shape';
import { pathVertices } from '../model/doc';
import { isHidden } from '../model/layers';
import { angleOnArc, arcGeom } from '../model/arc';

/**
 * Stutzen und Dehnen von Linien (wie in Inventor): Schnittpunkte mit allen anderen sichtbaren
 * Linien, Kreisen, Flächen und Formen begrenzen das Stück.
 */

/** Parameter t (entlang a→b, 0…1 = auf der Linie) aller Schnittpunkte der Geraden a→b mit anderer Geometrie. */
export function intersectionParams(doc: SketchDoc, lineId: Id, a: Vec2, b: Vec2, segmentOnly = true): number[] {
  const out: number[] = [];
  const d = { x: b.x - a.x, y: b.y - a.y };
  const seg = (p: Vec2, q: Vec2) => {
    const e = { x: q.x - p.x, y: q.y - p.y };
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-12) return;
    const t = ((p.x - a.x) * e.y - (p.y - a.y) * e.x) / den;
    const u = ((p.x - a.x) * d.y - (p.y - a.y) * d.x) / den;
    if (u < -1e-9 || u > 1 + 1e-9) return;
    if (segmentOnly && (t < -1e-9 || t > 1 + 1e-9)) return;
    out.push(t);
  };
  for (const e of Object.values(doc.entities)) {
    if (e.id === lineId || isHidden(doc, e.id)) continue;
    if (e.kind === 'line') seg(pt(doc, e.p1), pt(doc, e.p2));
    else if (e.kind === 'circle' || e.kind === 'arc') {
      const ag = e.kind === 'arc' ? arcGeom(doc, e) : null;
      const c = pt(doc, e.center);
      const er = ag ? ag.r : (e as { r: number }).r;
      const fx = a.x - c.x;
      const fy = a.y - c.y;
      const A = d.x * d.x + d.y * d.y;
      const B = 2 * (fx * d.x + fy * d.y);
      const C = fx * fx + fy * fy - er * er;
      const disc = B * B - 4 * A * C;
      if (disc < 0 || A < 1e-18) continue;
      for (const s of [-1, 1]) {
        const t = (-B + s * Math.sqrt(disc)) / (2 * A);
        if (ag) {
          const q = lerp(a, b, t);
          if (!angleOnArc(ag, Math.atan2(q.y - ag.c.y, q.x - ag.c.x))) continue;
        }
        if (!segmentOnly || (t >= -1e-9 && t <= 1 + 1e-9)) out.push(t);
      }
    } else if (e.kind === 'shape') {
      for (const poly of shapeWorldPolys(doc, e)) for (let i = 0; i < poly.length; i++) seg(poly[i], poly[(i + 1) % poly.length]);
    } else if (e.kind === 'path' && !e.edges.some((ed) => ed.id === lineId)) {
      // Linien eines Pfads sind selbst Linien und werden oben erfasst
      void pathVertices;
    }
  }
  return out;
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Entfernt Abhängigkeiten und Bemaßungen, die an einem verschobenen Punkt hängen. */
function detachPoint(d: SketchDoc, pid: Id): void {
  for (const c of Object.values(d.constraints)) if (c.refs.includes(pid)) delete d.constraints[c.id];
  for (const m of Object.values(d.dims)) if (m.refs.includes(pid)) delete d.dims[m.id];
}

/** Bemaßungen über die ganze Linie passen nicht mehr. */
function detachLineDims(d: SketchDoc, l: LineEntity): void {
  for (const m of Object.values(d.dims)) {
    if (m.refs.includes(l.id) || (m.refs.includes(l.p1) && m.refs.includes(l.p2))) delete d.dims[m.id];
  }
}

export type TrimResult = { kind: 'none' } | { kind: 'delete' } | { kind: 'shorten' } | { kind: 'split'; newLine: Id };

/** Stutzt das angeklickte Stück einer Linie (Entwurf). */
export function trimLine(d: SketchDoc, lineId: Id, click: Vec2): TrimResult {
  const l = lineOf(d, lineId);
  if (!l) return { kind: 'none' };
  const a = { ...pt(d, l.p1) };
  const b = { ...pt(d, l.p2) };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return { kind: 'none' };
  const t = Math.min(1, Math.max(0, ((click.x - a.x) * dx + (click.y - a.y) * dy) / len2));
  const eps = 1e-6;
  const ts = intersectionParams(d, lineId, a, b).filter((x) => x > eps && x < 1 - eps);
  const lo = Math.max(0, ...ts.filter((x) => x < t));
  const hi = Math.min(1, ...ts.filter((x) => x > t));
  const path = pathOfLine(d, lineId);
  if (path) dissolvePath(d, path.id);
  if (lo <= 0 && hi >= 1) return { kind: 'delete' };
  if (lo <= 0) {
    detachPoint(d, l.p1);
    detachLineDims(d, l);
    Object.assign(d.points[l.p1], lerp(a, b, hi));
    return { kind: 'shorten' };
  }
  if (hi >= 1) {
    detachPoint(d, l.p2);
    detachLineDims(d, l);
    Object.assign(d.points[l.p2], lerp(a, b, lo));
    return { kind: 'shorten' };
  }
  // Mittelstück: Linie teilen, das Ende behält seine Verbindungen
  detachLineDims(d, l);
  const nl = addLine(d, lerp(a, b, hi), b, d.entities[lineId].style, l.construction);
  for (const c of Object.values(d.constraints)) {
    c.refs = c.refs.map((r) => (r === l.p2 ? nl.p2 : r));
    if ((c.kind === 'horizontal' || c.kind === 'vertical') && c.refs.length === 1 && c.refs[0] === lineId) {
      d.constraints[`${c.id}b`] = { ...c, id: `${c.id}b`, refs: [nl.id] };
    }
  }
  for (const m of Object.values(d.dims)) m.refs = m.refs.map((r) => (r === l.p2 ? nl.p2 : r));
  Object.assign(d.points[l.p2], lerp(a, b, lo));
  return { kind: 'split', newLine: nl.id };
}

/** Dehnt das näher am Klick liegende Ende einer Linie bis zur nächsten Geometrie (Entwurf). */
export function extendLine(d: SketchDoc, lineId: Id, click: Vec2): boolean {
  const l = lineOf(d, lineId);
  if (!l) return false;
  const a = { ...pt(d, l.p1) };
  const b = { ...pt(d, l.p2) };
  const atEnd = Math.hypot(click.x - b.x, click.y - b.y) <= Math.hypot(click.x - a.x, click.y - a.y);
  const ts = intersectionParams(d, lineId, a, b, false);
  const cand = atEnd ? ts.filter((t) => t > 1 + 1e-6).sort((x, y) => x - y) : ts.filter((t) => t < -1e-6).sort((x, y) => y - x);
  if (!cand.length) return false;
  const pid = atEnd ? l.p2 : l.p1;
  const path = pathOfLine(d, lineId);
  if (path) dissolvePath(d, path.id);
  detachPoint(d, pid);
  detachLineDims(d, l);
  Object.assign(d.points[pid], lerp(a, b, cand[0]));
  return true;
}
