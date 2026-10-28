import type { Id, SketchDoc, Vec2 } from '../model/types';
import { angleOnArc, arcGeom, arcMidpoint, arcOf, closestOnArc, roundOf } from '../model/arc';
import { ORIGIN_ID } from '../model/types';
import { pt } from '../model/doc';
import {
  circleCircleIntersections,
  closestOnSegment,
  dist,
  mid,
  segmentCircleIntersections,
  segmentIntersection,
} from '../model/geometry';
import type { Settings } from '../store/state';
import type { SnapRef } from '../store/editor';
import { gridStep, toScreen, toWorld, type Viewport } from '../render/viewport';

export type SnapKind = 'endpoint' | 'center' | 'origin' | 'point' | 'midpoint' | 'intersection' | 'onCurve' | 'grid';

export interface SnapResult {
  pos: Vec2;
  kind: SnapKind | null;
  ref: SnapRef | null;
}

export const SNAP_LABELS: Record<SnapKind, string> = {
  endpoint: 'Endpunkt',
  center: 'Mittelpunkt',
  origin: 'Ursprung',
  point: 'Punkt',
  midpoint: 'Linienmitte',
  intersection: 'Schnittpunkt',
  onCurve: 'Auf Kurve',
  grid: 'Raster',
};

const PRIORITY: Record<SnapKind, number> = {
  origin: 0,
  endpoint: 0,
  center: 0,
  point: 0,
  midpoint: 1,
  intersection: 2,
  onCurve: 3,
  grid: 4,
};

export interface SnapOptions {
  /** Ids von Punkten/Objekten, die gerade gezeichnet werden */
  exclude?: Set<Id>;
  tolerance?: number;
  /** Fang komplett aus (z. B. Alt gedrückt) */
  off?: boolean;
}

export function computeSnap(doc: SketchDoc, vp: Viewport, settings: Settings, s: Vec2, opts: SnapOptions = {}): SnapResult {
  const raw = toWorld(vp, s);
  if (opts.off) return { pos: raw, kind: null, ref: null };
  const tol = opts.tolerance ?? 10;
  const ex = opts.exclude;
  let best: { kind: SnapKind; pos: Vec2; ref: SnapRef | null; d: number } | null = null;
  const consider = (kind: SnapKind, pos: Vec2, ref: SnapRef | null) => {
    const d = dist(toScreen(vp, pos), s);
    if (d > tol) return;
    if (!best || PRIORITY[kind] < PRIORITY[best.kind] || (PRIORITY[kind] === PRIORITY[best.kind] && d < best.d)) {
      best = { kind, pos, ref, d };
    }
  };

  // Punkte
  for (const p of Object.values(doc.points)) {
    if (ex?.has(p.id)) continue;
    if (p.owner && ex?.has(p.owner)) continue;
    if (p.id === ORIGIN_ID) {
      consider('origin', p, { kind: 'point', id: p.id });
      continue;
    }
    const owner = p.owner ? doc.entities[p.owner] : undefined;
    const isCenter = owner?.kind === 'circle' || (owner?.kind === 'arc' && owner.center === p.id) || owner?.kind === 'path' || (!owner && p.construction);
    if (isCenter && !settings.snapCenter) continue;
    if (!isCenter && owner && !settings.snapEndpoint) continue;
    consider(isCenter ? 'center' : owner ? 'endpoint' : 'point', p, { kind: 'point', id: p.id });
  }

  const ents = Object.values(doc.entities).filter((e) => !ex?.has(e.id));
  const near: typeof ents = [];
  const w = toWorld(vp, s);
  const tolW = (tol * 1.5) / vp.zoom;
  for (const e of ents) {
    if (e.kind === 'line') {
      const a = pt(doc, e.p1);
      const b = pt(doc, e.p2);
      if (settings.snapMidpoint) consider('midpoint', mid(a, b), { kind: 'midpoint', id: e.id });
      const c = closestOnSegment(w, a, b).point;
      if (dist(c, w) <= tolW) {
        near.push(e);
        if (settings.snapOnCurve) consider('onCurve', c, { kind: 'onCurve', id: e.id });
      }
    } else if (e.kind === 'circle') {
      const c = pt(doc, e.center);
      const dd = dist(c, w);
      if (Math.abs(dd - e.r) <= tolW) {
        near.push(e);
        if (settings.snapOnCurve && dd > 1e-9) {
          const k = e.r / dd;
          consider('onCurve', { x: c.x + (w.x - c.x) * k, y: c.y + (w.y - c.y) * k }, { kind: 'onCurve', id: e.id });
        }
      }
    } else if (e.kind === 'arc') {
      const g = arcGeom(doc, e);
      // Bogenmitte wie die Mitte einer Linie (Hilfspunkt, keine Abhängigkeit)
      if (settings.snapMidpoint) consider('midpoint', arcMidpoint(g), null);
      const c = closestOnArc(w, g);
      if (dist(c, w) <= tolW) {
        near.push(e);
        if (settings.snapOnCurve) consider('onCurve', c, { kind: 'onCurve', id: e.id });
      }
    }
  }

  if (settings.snapIntersection && near.length >= 2) {
    for (let i = 0; i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const a = near[i];
        const b = near[j];
        let pts: Vec2[] = [];
        const ra = roundOf(doc, a.id);
        const rb = roundOf(doc, b.id);
        if (a.kind === 'line' && b.kind === 'line') {
          const x = segmentIntersection(pt(doc, a.p1), pt(doc, a.p2), pt(doc, b.p1), pt(doc, b.p2));
          if (x) pts = [x];
        } else if (a.kind === 'line' && rb) {
          pts = segmentCircleIntersections(pt(doc, a.p1), pt(doc, a.p2), pt(doc, rb.center), rb.r);
        } else if (ra && b.kind === 'line') {
          pts = segmentCircleIntersections(pt(doc, b.p1), pt(doc, b.p2), pt(doc, ra.center), ra.r);
        } else if (ra && rb) {
          pts = circleCircleIntersections(pt(doc, ra.center), ra.r, pt(doc, rb.center), rb.r);
        }
        // Schnittpunkte mit Bögen nur, wenn sie auf dem Bogen liegen
        const onArc = (id: Id, p: Vec2) => {
          const ar = arcOf(doc, id);
          if (!ar) return true;
          const g = arcGeom(doc, ar);
          return angleOnArc(g, Math.atan2(p.y - g.c.y, p.x - g.c.x));
        };
        pts = pts.filter((p) => onArc(a.id, p) && onArc(b.id, p));
        for (const p of pts) consider('intersection', p, { kind: 'intersection', ids: [a.id, b.id] });
      }
    }
  }

  if (best) {
    const b = best as { kind: SnapKind; pos: Vec2; ref: SnapRef | null };
    return { pos: b.pos, kind: b.kind, ref: b.ref };
  }
  if (settings.gridSnap) {
    const { minor } = gridStep(vp.zoom);
    const g = { x: Math.round(raw.x / minor) * minor, y: Math.round(raw.y / minor) * minor };
    return { pos: g, kind: 'grid', ref: { kind: 'grid' } };
  }
  return { pos: raw, kind: null, ref: null };
}

/** Zeichnet die Fangmarke. */
export function drawSnapMarker(ctx: CanvasRenderingContext2D, vp: Viewport, snap: SnapResult, color: string): void {
  if (!snap.kind) return;
  const s = toScreen(vp, snap.pos);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  const r = 6;
  ctx.beginPath();
  switch (snap.kind) {
    case 'endpoint':
    case 'point':
      ctx.rect(s.x - r, s.y - r, 2 * r, 2 * r);
      break;
    case 'origin':
    case 'center':
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.moveTo(s.x - 2, s.y);
      ctx.arc(s.x, s.y, 2, Math.PI, Math.PI * 3);
      break;
    case 'midpoint':
      ctx.moveTo(s.x, s.y - r);
      ctx.lineTo(s.x + r, s.y + r * 0.8);
      ctx.lineTo(s.x - r, s.y + r * 0.8);
      ctx.closePath();
      break;
    case 'intersection':
      ctx.moveTo(s.x - r, s.y - r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x + r, s.y - r);
      ctx.lineTo(s.x - r, s.y + r);
      break;
    case 'onCurve':
      ctx.moveTo(s.x - r, s.y + r);
      ctx.lineTo(s.x + r, s.y + r);
      ctx.moveTo(s.x, s.y + r);
      ctx.lineTo(s.x, s.y - r);
      break;
    case 'grid':
      ctx.moveTo(s.x - 4, s.y);
      ctx.lineTo(s.x + 4, s.y);
      ctx.moveTo(s.x, s.y - 4);
      ctx.lineTo(s.x, s.y + 4);
      break;
  }
  ctx.stroke();
  ctx.restore();
}
