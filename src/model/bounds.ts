import type { Entity, Id, SketchDoc } from './types';
import { lineOf, pathVertices, pt } from './doc';
import { bboxAddPoint, bboxValid, emptyBBox, type BBox } from './geometry';
import { measureText } from './textMetrics';
import { contoursBBox, shapeWorldContours } from './shape';
import { visibleOrder } from './layers';
import { imageCorners, isReferenceImage } from './image';

/** Umschließendes Rechteck eines Objekts in mm (ohne Konturstärke, außer includeStroke). */
export function entityBBox(doc: SketchDoc, e: Entity, includeStroke = false): BBox {
  const b = emptyBBox();
  const pad = includeStroke && e.style.stroke ? e.style.strokeWidth / 2 : 0;
  switch (e.kind) {
    case 'line': {
      bboxAddPoint(b, pt(doc, e.p1), pad);
      bboxAddPoint(b, pt(doc, e.p2), pad);
      break;
    }
    case 'circle': {
      const c = pt(doc, e.center);
      bboxAddPoint(b, { x: c.x - e.r, y: c.y - e.r }, pad);
      bboxAddPoint(b, { x: c.x + e.r, y: c.y + e.r }, pad);
      break;
    }
    case 'text': {
      const a = pt(doc, e.anchor);
      const m = measureText(e);
      bboxAddPoint(b, { x: a.x + m.left, y: a.y - m.descent }, pad);
      bboxAddPoint(b, { x: a.x + m.right, y: a.y + m.ascent }, pad);
      break;
    }
    case 'path': {
      for (const v of pathVertices(doc, e)) bboxAddPoint(b, v, pad);
      break;
    }
    case 'image': {
      for (const q of imageCorners(doc, e)) bboxAddPoint(b, q);
      break;
    }
    case 'shape': {
      const sb = contoursBBox(shapeWorldContours(doc, e));
      if (sb) {
        bboxAddPoint(b, { x: sb.minX, y: sb.minY }, pad);
        bboxAddPoint(b, { x: sb.maxX, y: sb.maxY }, pad);
      }
      break;
    }
  }
  return b;
}

/** Box eines zeichenbaren Objekts per Id (Linie im Pfad → Pfad). */
export function bboxOf(doc: SketchDoc, id: Id, includeStroke = false): BBox | null {
  const e = doc.entities[id];
  if (!e) return null;
  const b = entityBBox(doc, e, includeStroke);
  return bboxValid(b) ? b : null;
}

export interface DocBBoxOptions {
  /** Konstruktionsgeometrie einbeziehen */
  construction?: boolean;
  /** Konturstärke einbeziehen */
  includeStroke?: boolean;
  /** Nur diese Objekte */
  only?: Set<Id>;
}

/** Box aller zeichenbaren Objekte (Pfade, freie Linien, Kreise, Texte). */
export function docBBox(doc: SketchDoc, opts: DocBBoxOptions = {}): BBox | null {
  const b = emptyBBox();
  for (const id of visibleOrder(doc)) {
    const e = doc.entities[id];
    if (!e) continue;
    if (opts.only && !opts.only.has(id)) continue;
    if ((e.construction || isReferenceImage(e)) && !opts.construction) continue;
    const eb = entityBBox(doc, e, opts.includeStroke);
    if (bboxValid(eb)) {
      bboxAddPoint(b, { x: eb.minX, y: eb.minY });
      bboxAddPoint(b, { x: eb.maxX, y: eb.maxY });
    }
  }
  if (opts.construction) {
    for (const e of Object.values(doc.entities)) {
      if (!e.construction || doc.order.includes(e.id)) continue;
      const eb = entityBBox(doc, e);
      if (bboxValid(eb)) {
        bboxAddPoint(b, { x: eb.minX, y: eb.minY });
        bboxAddPoint(b, { x: eb.maxX, y: eb.maxY });
      }
    }
    for (const p of Object.values(doc.points)) if (!p.owner && !p.locked) bboxAddPoint(b, p);
  }
  return bboxValid(b) ? b : null;
}

/** Linien-Ids eines Pfads in Reihenfolge. */
export function pathLineIds(doc: SketchDoc, pathId: Id): Id[] {
  const p = doc.entities[pathId];
  if (!p || p.kind !== 'path') return [];
  return p.edges.map((e) => e.id).filter((id) => !!lineOf(doc, id));
}
