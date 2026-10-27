import type { Id, SketchDoc, Vec2 } from '../model/types';
import { lineOf, pathVertices, pt } from '../model/doc';
import { measureText } from '../model/textMetrics';
import { closestOnSegment, dist, pointInPolygon } from '../model/geometry';
import { pointInPolys, shapeWorldPolys } from '../model/shape';
import { isInert } from '../model/layers';
import type { SceneLayout } from '../render/renderer';
import { hitGlyph } from '../render/glyphs';
import { toScreen, toWorld, type Viewport } from '../render/viewport';

export type HitKind = 'point' | 'line' | 'circle' | 'text' | 'path' | 'shape' | 'dim' | 'glyph';

export interface Hit {
  kind: HitKind;
  id: Id;
  /** Abstand in Pixeln */
  dist: number;
}

export interface HitOptions {
  points?: boolean;
  curves?: boolean;
  texts?: boolean;
  /** gefüllte Flächen (Pfade, Kreise) */
  fills?: boolean;
  dims?: boolean;
  glyphs?: boolean;
  /** Konstruktions-Hilfspunkte (Rechteckmitte) und Ursprung */
  helperPoints?: boolean;
  exclude?: Set<Id>;
  pointTol?: number;
  curveTol?: number;
}

const ALL: HitOptions = { points: true, curves: true, texts: true, fills: true, dims: true, glyphs: true, helperPoints: true };

export function hitTest(doc: SketchDoc, vp: Viewport, layout: SceneLayout | null, s: Vec2, optsIn: HitOptions = ALL): Hit | null {
  const opts = { ...optsIn };
  // Ausgeblendete und gesperrte Ebenen sind nicht auswählbar
  const exIn = opts.exclude;
  const ex = { has: (id: Id) => !!exIn?.has(id) || isInert(doc, id) };
  const pointTol = opts.pointTol ?? 8;
  const curveTol = opts.curveTol ?? 6;

  // 1. Bemaßungstexte und Glyphen (liegen oben)
  if (opts.dims && layout) {
    for (let i = layout.dims.length - 1; i >= 0; i--) {
      const d = layout.dims[i];
      const b = d.textBox;
      if (s.x >= b.x - 2 && s.x <= b.x + b.w + 2 && s.y >= b.y - 2 && s.y <= b.y + b.h + 2) return { kind: 'dim', id: d.id, dist: 0 };
    }
  }
  if (opts.glyphs && layout) {
    const g = hitGlyph(layout.glyphs, s);
    if (g) return { kind: 'glyph', id: g.constraintId, dist: 0 };
  }

  // 2. Punkte
  if (opts.points) {
    let best: Hit | null = null;
    for (const p of Object.values(doc.points)) {
      if (ex?.has(p.id)) continue;
      const helper = p.locked || (p.construction && !p.owner) || (p.owner && doc.entities[p.owner]?.kind === 'path');
      if (helper && !opts.helperPoints) continue;
      const d = dist(toScreen(vp, p), s);
      if (d <= pointTol && (!best || d < best.dist - 0.01)) best = { kind: 'point', id: p.id, dist: d };
    }
    if (best) return best;
  }

  // 3. Kurven
  if (opts.curves) {
    let best: Hit | null = null;
    for (const e of Object.values(doc.entities)) {
      if (ex?.has(e.id)) continue;
      let d = Infinity;
      if (e.kind === 'line') {
        const a = toScreen(vp, pt(doc, e.p1));
        const b = toScreen(vp, pt(doc, e.p2));
        d = dist(closestOnSegment(s, a, b).point, s);
      } else if (e.kind === 'circle') {
        const c = toScreen(vp, pt(doc, e.center));
        d = Math.abs(dist(c, s) - e.r * vp.zoom);
      }
      if (d <= curveTol && (!best || d < best.dist)) best = { kind: e.kind as HitKind, id: e.id, dist: d };
    }
    if (best) return best;
  }

  // 4. Texte und Flächen (oberstes Objekt zuerst)
  const w = toWorld(vp, s);
  for (let i = doc.order.length - 1; i >= 0; i--) {
    const e = doc.entities[doc.order[i]];
    if (!e || ex?.has(e.id)) continue;
    if (opts.texts && e.kind === 'text') {
      const a = pt(doc, e.anchor);
      const m = measureText(e);
      const pad = 3 / vp.zoom;
      if (w.x >= a.x + m.left - pad && w.x <= a.x + m.right + pad && w.y >= a.y - m.descent - pad && w.y <= a.y + m.ascent + pad) {
        return { kind: 'text', id: e.id, dist: 0 };
      }
    }
    if ((opts.fills || opts.curves) && e.kind === 'shape' && !e.construction) {
      const polys = shapeWorldPolys(doc, e);
      if (opts.fills && e.style.fill && pointInPolys(w, polys, e.fillRule)) return { kind: 'shape', id: e.id, dist: 0 };
      // Nähe zur Kontur (auch ohne Füllung auswählbar)
      const tol = (opts.curveTol ?? 6) / vp.zoom;
      for (const poly of polys) {
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k];
          const b = poly[(k + 1) % poly.length];
          if (dist(closestOnSegment(w, a, b).point, w) <= tol) return { kind: 'shape', id: e.id, dist: 0 };
        }
      }
    }
    if (opts.fills) {
      if (e.kind === 'path' && e.closed && (e.style.fill || e.construction === false)) {
        const vs = pathVertices(doc, e);
        if (vs.length >= 3 && pointInPolygon(w, vs) && e.style.fill) return { kind: 'path', id: e.id, dist: 0 };
      } else if (e.kind === 'circle' && e.style.fill && !e.construction) {
        if (dist(pt(doc, e.center), w) <= e.r) return { kind: 'circle', id: e.id, dist: 0 };
      }
    }
  }
  return null;
}

/** Punkte eines Objekts (für Ziehen). */
export function pointsOf(doc: SketchDoc, id: Id): Id[] {
  if (doc.points[id]) return [id];
  const e = doc.entities[id];
  if (!e) return [];
  switch (e.kind) {
    case 'line':
      return [e.p1, e.p2];
    case 'circle':
      return [e.center];
    case 'text':
    case 'shape':
      return [e.anchor];
    case 'path': {
      const out: Id[] = [];
      for (const ed of e.edges) {
        const l = lineOf(doc, ed.id);
        if (l) out.push(l.p1, l.p2);
      }
      for (const p of Object.values(doc.points)) if (p.owner === e.id) out.push(p.id);
      return out;
    }
  }
}
