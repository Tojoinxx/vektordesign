import type { ConstraintKind, Id, SketchDoc, Vec2 } from '../model/types';
import { circleOf, lineOf, pt } from '../model/doc';
import { THEME } from './theme';
import { toScreen, type Viewport } from './viewport';

type Ctx = CanvasRenderingContext2D;

export interface GlyphItem {
  constraintId: Id;
  kind: ConstraintKind;
  /** Bildschirmposition (Mitte) */
  pos: Vec2;
  /** Kleiner Punkt-Glyph (koinzident) statt Kästchen */
  small: boolean;
}

export const GLYPH = 16;

/**
 * Ordnet Glyphen an. `only` beschränkt auf Abhängigkeiten, die diese Ids betreffen
 * (z. B. Auswahl, wenn Glyphen ausgeblendet sind).
 */
export function layoutGlyphs(doc: SketchDoc, vp: Viewport, only?: Set<Id>): GlyphItem[] {
  const out: GlyphItem[] = [];
  const stack = new Map<string, number>();
  const nextIndex = (key: string) => {
    const n = stack.get(key) ?? 0;
    stack.set(key, n + 1);
    return n;
  };

  const lineAnchor = (lineId: Id): ((i: number) => Vec2) | null => {
    const l = lineOf(doc, lineId);
    if (!l) return null;
    const a = toScreen(vp, pt(doc, l.p1));
    const b = toScreen(vp, pt(doc, l.p2));
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // Sehr kurze Linien (weit herausgezoomt): Symbole würden die Geometrie verdecken
    if (len < 28 && !only) return null;
    dx /= len;
    dy /= len;
    // Normale auf die „obere/linke“ Seite
    let nx = -dy;
    let ny = dx;
    if (ny > 0 || (Math.abs(ny) < 1e-6 && nx > 0)) {
      nx = -nx;
      ny = -ny;
    }
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return (i) => ({ x: m.x + nx * 14 + dx * (i * (GLYPH + 3)), y: m.y + ny * 14 + dy * (i * (GLYPH + 3)) });
  };
  const circleAnchor = (cid: Id): ((i: number) => Vec2) | null => {
    const c = circleOf(doc, cid);
    if (!c) return null;
    const ctr = toScreen(vp, pt(doc, c.center));
    const r = c.r * vp.zoom;
    if (r < 10 && !only) return null;
    const base = { x: ctr.x + r * 0.7071 + 12, y: ctr.y + r * 0.7071 + 12 };
    return (i) => ({ x: base.x + i * (GLYPH + 3), y: base.y });
  };
  const pointAnchor = (pid: Id): ((i: number) => Vec2) | null => {
    const p = doc.points[pid];
    if (!p) return null;
    const s = toScreen(vp, p);
    return (i) => ({ x: s.x + 13 + i * (GLYPH + 3), y: s.y - 13 });
  };
  const anchorFor = (id: Id) => {
    if (doc.points[id]) return pointAnchor(id);
    if (lineOf(doc, id)) return lineAnchor(id);
    if (circleOf(doc, id)) return circleAnchor(id);
    return null;
  };

  for (const c of Object.values(doc.constraints)) {
    if (only && !c.refs.some((r) => only.has(r)) && !only.has(c.id)) continue;
    const r = c.refs;
    const push = (targetId: Id) => {
      const f = anchorFor(targetId);
      if (!f) return;
      out.push({ constraintId: c.id, kind: c.kind, pos: f(nextIndex(targetId)), small: false });
    };
    switch (c.kind) {
      case 'coincident': {
        const p = doc.points[r[0]];
        if (!p) break;
        if (doc.points[r[1]]) {
          out.push({ constraintId: c.id, kind: c.kind, pos: toScreen(vp, p), small: true });
        } else push(r[0]);
        break;
      }
      case 'concentric': {
        const ctr = circleOf(doc, r[0])?.center ?? r[0];
        push(ctr);
        break;
      }
      case 'midpoint':
      case 'fix':
        push(r[0]);
        break;
      case 'symmetric':
        push(r[0]);
        push(r[1]);
        break;
      default:
        for (const id of r) push(id);
    }
  }
  return out.filter((g) => g.pos.x > -20 && g.pos.y > -20 && g.pos.x < vp.width + 20 && g.pos.y < vp.height + 20);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Zeichnet das Symbol einer Abhängigkeit in ein 16×16-Feld um (cx, cy). */
export function drawGlyphIcon(ctx: Ctx, kind: ConstraintKind, cx: number, cy: number, color: string): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (kind) {
    case 'horizontal':
      line(-5, 0, 5, 0);
      break;
    case 'vertical':
      line(0, -5, 0, 5);
      break;
    case 'parallel':
      line(-4, 4, 0, -4);
      line(0, 4, 4, -4);
      break;
    case 'perpendicular':
      line(-5, 4, 5, 4);
      line(0, 4, 0, -5);
      break;
    case 'collinear':
      line(-6, 3, -1, -1);
      line(1, -2, 6, -6 + 2);
      break;
    case 'tangent':
      ctx.beginPath();
      ctx.arc(0, -1, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      line(-6, 3.5, 6, 3.5);
      break;
    case 'concentric':
      ctx.beginPath();
      ctx.arc(0, 0, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'equal':
      line(-4.5, -2, 4.5, -2);
      line(-4.5, 2, 4.5, 2);
      break;
    case 'symmetric':
      line(-2, -5, -5, -5);
      line(-5, -5, -5, 5);
      line(-5, 5, -2, 5);
      line(2, -5, 5, -5);
      line(5, -5, 5, 5);
      line(5, 5, 2, 5);
      break;
    case 'midpoint':
      ctx.beginPath();
      ctx.moveTo(0, -4.5);
      ctx.lineTo(4.5, 3.5);
      ctx.lineTo(-4.5, 3.5);
      ctx.closePath();
      ctx.stroke();
      break;
    case 'fix':
      ctx.beginPath();
      ctx.arc(0, -1.5, 2.8, Math.PI, 0);
      ctx.stroke();
      roundRect(ctx, -4.2, -1, 8.4, 6, 1);
      ctx.fill();
      break;
    case 'coincident':
      ctx.beginPath();
      ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
  }
  ctx.restore();
}

export function drawGlyphs(ctx: Ctx, items: GlyphItem[], opts: { hover: Id | null; selection: Set<Id>; problems: Set<Id> }): void {
  for (const g of items) {
    const sel = opts.selection.has(g.constraintId);
    const hov = opts.hover === g.constraintId;
    const bad = opts.problems.has(g.constraintId);
    const ink = bad ? THEME.conflict : sel ? THEME.selected : hov ? THEME.hover : THEME.glyphInk;
    if (g.small) {
      ctx.save();
      ctx.fillStyle = sel || hov || bad ? ink : '#fff7d6';
      ctx.strokeStyle = sel || hov || bad ? ink : THEME.tapeDark;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.rect(g.pos.x - 3, g.pos.y - 3, 6, 6);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      continue;
    }
    const x = g.pos.x - GLYPH / 2;
    const y = g.pos.y - GLYPH / 2;
    ctx.save();
    roundRect(ctx, x, y, GLYPH, GLYPH, 3);
    ctx.fillStyle = sel ? '#fff1e6' : hov ? '#fff8e1' : THEME.glyphBg;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = sel || hov || bad ? ink : THEME.glyphBorder;
    ctx.stroke();
    ctx.restore();
    drawGlyphIcon(ctx, g.kind, g.pos.x, g.pos.y, ink);
  }
}

/** Glyph unter dem Mauszeiger. */
export function hitGlyph(items: GlyphItem[], s: Vec2): GlyphItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const g = items[i];
    const h = g.small ? 5 : GLYPH / 2 + 1;
    if (Math.abs(s.x - g.pos.x) <= h && Math.abs(s.y - g.pos.y) <= h) return g;
  }
  return null;
}
