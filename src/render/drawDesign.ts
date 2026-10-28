import { imageElement } from '../model/image';
import type { Contour, Entity, Gradient, Id, SketchDoc, Style, Vec2 } from '../model/types';
import { lineOf, pathVertices, pt } from '../model/doc';
import { entityBBox } from '../model/bounds';
import { gradientToWorld, isGradient, sortedStops } from '../model/paint';
import { hexToRgb, rgbLuminance, rgba, type RGB } from '../model/color';
import { cssFont } from '../model/textMetrics';
import { bboxValid, dist } from '../model/geometry';
import { segments, shapeWorldContours } from '../model/shape';
import { visibleOrder } from '../model/layers';
import { arcContour, arcGeom, pathContour } from '../model/arc';

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
  /** Nur das Design (Export, Vorschauen): Vorlagenbilder weglassen */
  design?: boolean;
  /**
   * Nur Bildschirm: Motive, die sich kaum vom Hintergrund abheben (schwarz auf dunkler Fläche,
   * weiß auf weißer), bekommen einen feinen Umriss in `hint`. Nie im Export.
   */
  contrast?: { background: string; hint: string };
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

/** Zeichnet eine Kontur (mit Bézier-Segmenten) in den aktuellen Pfad. */
export function traceContour(ctx: Ctx, toScreen: (p: Vec2) => Vec2, c: Contour): void {
  if (!c.nodes.length) return;
  const s0 = toScreen(c.nodes[0]);
  ctx.moveTo(s0.x, s0.y);
  for (const seg of segments(c)) {
    const p3 = toScreen(seg.p3);
    if (seg.curved) {
      const p1 = toScreen(seg.p1);
      const p2 = toScreen(seg.p2);
      ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    } else ctx.lineTo(p3.x, p3.y);
  }
  if (c.closed) ctx.closePath();
}

function buildPath(t: DesignTarget, doc: SketchDoc, e: Entity): boolean {
  const ctx = t.ctx;
  ctx.beginPath();
  switch (e.kind) {
    case 'path': {
      if (pathVertices(doc, e).length < 2) return false;
      traceContour(ctx, t.toScreen, pathContour(doc, e));
      return true;
    }
    case 'arc': {
      traceContour(ctx, t.toScreen, arcContour(arcGeom(doc, e)));
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
    case 'shape': {
      for (const c of shapeWorldContours(doc, e)) traceContour(ctx, t.toScreen, c);
      return true;
    }
    case 'text':
    case 'image':
      return false;
  }
}

const rgbCache = new Map<string, RGB>();
function rgbOf(color: string): RGB {
  let v = rgbCache.get(color);
  if (v === undefined) {
    v = hexToRgb(color);
    if (rgbCache.size > 2000) rgbCache.clear();
    rgbCache.set(color, v);
  }
  return v;
}

/** Kontrastschwelle, unter der ein Objekt auf dem Bildschirm einen Hilfsumriss bekommt. */
export const LOW_CONTRAST = 1.6;

/**
 * Höchster Kontrast (WCAG-Verhältnis) der sichtbaren Farben eines Objekts zum Hintergrund,
 * Deckkraft eingerechnet. 1 = unsichtbar.
 */
export function paintContrast(e: Entity, background: string): number {
  const s = e.style;
  const opacity = Math.min(1, Math.max(0, s.opacity ?? 1));
  const bgRgb = rgbOf(background);
  const bg = rgbLuminance(bgRgb);
  let best = 1;
  const consider = (color: string, alpha: number) => {
    const a = Math.min(1, Math.max(0, alpha)) * opacity;
    if (a <= 0) return;
    // Mischen wie die Zeichenfläche (in sRGB), dann Kontrast nach WCAG
    const c = rgbOf(color);
    const l = rgbLuminance({ r: c.r * a + bgRgb.r * (1 - a), g: c.g * a + bgRgb.g * (1 - a), b: c.b * a + bgRgb.b * (1 - a) });
    const ratio = (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05);
    if (ratio > best) best = ratio;
  };
  const filled = e.kind === 'text' || e.kind === 'circle' || e.kind === 'shape' || (e.kind === 'path' && e.closed);
  if (s.fill && filled) {
    if (isGradient(s.fill)) for (const st of s.fill.stops) consider(st.color, st.opacity);
    else consider(s.fill, 1);
  }
  if (s.stroke && s.strokeWidth > 0) consider(s.stroke, 1);
  return best;
}

function needsHint(t: DesignTarget, e: Entity): string | null {
  if (!t.contrast) return null;
  return paintContrast(e, t.contrast.background) < LOW_CONTRAST ? t.contrast.hint : null;
}

/** Zeichnet ein einzelnes Objekt in seinem echten Stil. */
export function drawEntity(t: DesignTarget, doc: SketchDoc, e: Entity): void {
  if (e.construction) return;
  if (e.kind === 'image' && e.reference && t.design) return;
  const ctx = t.ctx;
  const s = e.style;
  ctx.save();
  ctx.globalAlpha = Math.min(1, Math.max(0, s.opacity ?? 1));
  if (e.kind === 'image') {
    const img = imageElement(e.src);
    if (img) {
      const c = t.toScreen(pt(doc, e.anchor));
      const w = e.width * t.scale;
      const h = e.height * t.scale;
      ctx.translate(c.x, c.y);
      // Welt: Drehung gegen den Uhrzeigersinn; Bildschirm: y nach unten
      ctx.rotate((-e.rotation * Math.PI) / 180);
      if (e.flipX) ctx.scale(-1, 1);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
    ctx.restore();
    return;
  }
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
    const hint = needsHint(t, e);
    if (hint) {
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = hint;
      ctx.strokeText(e.text, a.x, a.y);
    }
    ctx.restore();
    return;
  }
  if (!buildPath(t, doc, e)) {
    ctx.restore();
    return;
  }
  const closed = e.kind === 'circle' || e.kind === 'shape' || (e.kind === 'path' && e.closed);
  if (closed && s.fill) {
    ctx.fillStyle = isGradient(s.fill) ? makePaint(t, s.fill, doc, e) : s.fill;
    ctx.fill(e.kind === 'shape' ? e.fillRule : 'nonzero');
  }
  if (applyStroke(t, s)) ctx.stroke();
  const hint = needsHint(t, e);
  if (hint) {
    // Der Pfad ist noch aktiv: feiner Umriss entlang der Geometrie
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = hint;
    ctx.stroke();
  }
  ctx.restore();
}

/** Zeichnet alle sichtbaren Objekte in Zeichenreihenfolge (ohne Konstruktionsgeometrie). */
export function drawDesign(t: DesignTarget, doc: SketchDoc, opts: DesignOptions = {}): void {
  for (const id of visibleOrder(doc)) {
    const e = doc.entities[id];
    if (!e) continue;
    if (opts.only && !opts.only.has(id)) continue;
    if (opts.skip?.has(id)) continue;
    drawEntity(t, doc, e);
  }
}
