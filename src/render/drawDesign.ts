import type { Entity, Gradient, Id, SketchDoc, Style, Vec2 } from '../model/types';
import { lineOf, pathVertices, pt } from '../model/doc';
import { entityBBox } from '../model/bounds';
import { gradientToWorld, isGradient, sortedStops } from '../model/paint';
import { rgba } from '../model/color';
import { cssFont } from '../model/textMetrics';
import { bboxValid, dist } from '../model/geometry';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Ziel der Designdarstellung: Bildschirm oder Export-Bitmap. */
export interface DesignTarget {
  ctx: Ctx;
  /** Welt (mm) → Zeichenfläche (px) */
  toScreen: (p: Vec2) => Vec2;
  /** px pro mm */
  scale: number;
  /** Mindestkonturstärke in px (Bildschirm), 0 beim Export */
  minStrokePx: number;
}

export interface DesignOptions {
  /** Nur diese Objekte zeichnen */
  only?: Set<Id>;
  /** Objekte auslassen (z. B. während der Textbearbeitung) */
  skip?: Set<Id>;
}

/** Strichmuster in mm (auch für SVG-Export). */
export function dashPattern(style: Style): number[] | null {
  const w = Math.max(style.strokeWidth, 0.05);
  if (style.dash === 'dashed') return [Math.max(1.5, 4 * w), Math.max(0.75, 2 * w)];
  if (style.dash === 'dotted') return [0.001, Math.max(0.6, 2 * w)];
  return null;
}

function makePaint(t: DesignTarget, g: Gradient, doc: SketchDoc, e: Entity): CanvasGradient | string {
  const box = entityBBox(doc, e);
  if (!bboxValid(box)) return sortedStops(g)[0]?.color ?? '#000';
  const { from, to } = gradientToWorld(g, box);
  const a = t.toScreen(from);
  const b = t.toScreen(to);
  let grad: CanvasGradient;
  if (g.kind === 'radial') {
    const r = Math.max(dist(a, b), 0.5);
    grad = t.ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
  } else {
    grad = t.ctx.createLinearGradient(a.x, a.y, b.x, b.y);
  }
  for (const s of sortedStops(g)) grad.addColorStop(Math.min(1, Math.max(0, s.offset)), rgba(s.color, s.opacity));
  return grad;
}

function applyStroke(t: DesignTarget, s: Style): boolean {
  if (!s.stroke || s.strokeWidth <= 0) return false;
  const ctx = t.ctx;
  ctx.strokeStyle = s.stroke;
  ctx.lineWidth = Math.max(s.strokeWidth * t.scale, t.minStrokePx);
  ctx.lineCap = s.lineCap ?? 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  const dash = dashPattern(s);
  if (dash) {
    ctx.setLineDash(dash.map((v) => v * t.scale));
    if (s.dash === 'dotted') ctx.lineCap = 'round';
  } else ctx.setLineDash([]);
  return true;
}

function buildPath(t: DesignTarget, doc: SketchDoc, e: Entity): boolean {
  const ctx = t.ctx;
  ctx.beginPath();
  switch (e.kind) {
    case 'path': {
      const vs = pathVertices(doc, e);
      if (vs.length < 2) return false;
      vs.forEach((v, i) => {
        const s = t.toScreen(v);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      if (e.closed) ctx.closePath();
      return true;
    }
    case 'line': {
      const l = lineOf(doc, e.id)!;
      const a = t.toScreen(pt(doc, l.p1));
      const b = t.toScreen(pt(doc, l.p2));
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      return true;
    }
    case 'circle': {
      const c = t.toScreen(pt(doc, e.center));
      ctx.arc(c.x, c.y, e.r * t.scale, 0, Math.PI * 2);
      return true;
    }
    case 'text':
      return false;
  }
}

/** Zeichnet ein einzelnes Objekt in seinem echten Stil. */
export function drawEntity(t: DesignTarget, doc: SketchDoc, e: Entity): void {
  if (e.construction) return;
  const ctx = t.ctx;
  const s = e.style;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, s.opacity ?? 1));
  if (e.kind === 'text') {
    const a = t.toScreen(pt(doc, e.anchor));
    const size = e.fontSize * t.scale;
    if (size < 0.5) {
      ctx.restore();
      return;
    }
    ctx.font = cssFont(e, size);
    ctx.textAlign = e.align;
    ctx.textBaseline = 'alphabetic';
    if (s.fill) {
      ctx.fillStyle = isGradient(s.fill) ? makePaint(t, s.fill, doc, e) : s.fill;
      ctx.fillText(e.text, a.x, a.y);
    }
    if (applyStroke(t, s)) ctx.strokeText(e.text, a.x, a.y);
    ctx.restore();
    return;
  }
  if (!buildPath(t, doc, e)) {
    ctx.restore();
    return;
  }
  const closed = e.kind === 'circle' || (e.kind === 'path' && e.closed);
  if (closed && s.fill) {
    ctx.fillStyle = isGradient(s.fill) ? makePaint(t, s.fill, doc, e) : s.fill;
    ctx.fill('nonzero');
  }
  if (applyStroke(t, s)) ctx.stroke();
  ctx.restore();
}

/** Zeichnet alle sichtbaren Objekte in Zeichenreihenfolge (ohne Konstruktionsgeometrie). */
export function drawDesign(t: DesignTarget, doc: SketchDoc, opts: DesignOptions = {}): void {
  for (const id of doc.order) {
    const e = doc.entities[id];
    if (!e) continue;
    if (opts.only && !opts.only.has(id)) continue;
    if (opts.skip?.has(id)) continue;
    drawEntity(t, doc, e);
  }
}
