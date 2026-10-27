import type { Dimension, Entity, Id, SketchDoc, Vec2 } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { lineOf, pathOfLine, pt } from '../model/doc';
import { measureText } from '../model/textMetrics';
import type { Analysis } from '../solver/analysis';
import type { Settings } from '../store/state';
import { drawDesign } from './drawDesign';
import { dimGeometry, type DimGeom } from './dimGeometry';
import { drawGlyphs, layoutGlyphs, type GlyphItem } from './glyphs';
import { RULER, THEME } from './theme';
import { gridStep, toScreen, toWorld, visibleWorld, type Viewport } from './viewport';
import { formatNumber } from '../params/expr';

type Ctx = CanvasRenderingContext2D;

export interface SceneState {
  doc: SketchDoc;
  analysis: Analysis;
  selection: Set<Id>;
  hover: Id | null;
  settings: Settings;
  vp: Viewport;
  /** Objekte, die nicht im Design gezeichnet werden (z. B. Text in Bearbeitung) */
  skip?: Set<Id>;
  /** Mausposition (Welt) für die Lineal-Markierung */
  cursor?: Vec2 | null;
}

/** Ergebnis des Zeichnens, das die Trefferprüfung wiederverwendet. */
export interface SceneLayout {
  glyphs: GlyphItem[];
  dims: { id: Id; geom: DimGeom; textBox: { x: number; y: number; w: number; h: number } }[];
}

const DIM_FONT = `500 12px ${THEME.uiFont}`;

export function renderScene(ctx: Ctx, s: SceneState, toolOverlay?: (ctx: Ctx, vp: Viewport) => void): SceneLayout {
  const { vp, doc, settings } = s;
  ctx.save();
  ctx.fillStyle = THEME.paper;
  ctx.fillRect(0, 0, vp.width, vp.height);

  if (settings.grid) drawGrid(ctx, vp);
  drawAxes(ctx, vp);

  const T = (p: Vec2) => toScreen(vp, p);
  drawDesign({ ctx, toScreen: T, scale: vp.zoom, minStrokePx: 0.6 }, doc, { skip: s.skip });

  const problems = problemSet(doc, s.analysis);
  if (settings.showOverlay) drawSketchOverlay(ctx, s, problems.entities);

  const layout: SceneLayout = { glyphs: [], dims: [] };
  if (settings.showDims) layout.dims = drawDimensions(ctx, s, problems.items);
  const only = settings.showGlyphs ? undefined : s.selection;
  if (settings.showGlyphs || s.selection.size) {
    layout.glyphs = layoutGlyphs(doc, vp, only);
    drawGlyphs(ctx, layout.glyphs, { hover: s.hover, selection: s.selection, problems: problems.items });
  }
  drawOrigin(ctx, vp, s.hover === ORIGIN_ID || s.selection.has(ORIGIN_ID));

  if (toolOverlay) {
    ctx.save();
    toolOverlay(ctx, vp);
    ctx.restore();
  }
  drawRulers(ctx, vp, s.cursor ?? null);
  ctx.restore();
  return layout;
}

// ---------------------------------------------------------------------------

function problemSet(doc: SketchDoc, a: Analysis): { items: Set<Id>; entities: Set<Id> } {
  const items = new Set<Id>([...a.conflicting, ...a.redundant]);
  const entities = new Set<Id>();
  for (const id of items) {
    const refs = doc.constraints[id]?.refs ?? doc.dims[id]?.refs ?? [];
    for (const r of refs) {
      entities.add(r);
      const p = doc.points[r];
      if (p?.owner) entities.add(p.owner);
    }
  }
  return { items, entities };
}

function drawGrid(ctx: Ctx, vp: Viewport): void {
  const { minor, major } = gridStep(vp.zoom);
  const w = visibleWorld(vp);
  const lines = (step: number, color: string) => {
    ctx.beginPath();
    const x0 = Math.ceil(w.minX / step) * step;
    for (let x = x0; x <= w.maxX; x += step) {
      const sx = Math.round(toScreen(vp, { x, y: 0 }).x) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, vp.height);
    }
    const y0 = Math.ceil(w.minY / step) * step;
    for (let y = y0; y <= w.maxY; y += step) {
      const sy = Math.round(toScreen(vp, { x: 0, y }).y) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(vp.width, sy);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  lines(minor, THEME.gridMinor);
  lines(major, THEME.gridMajor);
}

function drawAxes(ctx: Ctx, vp: Viewport): void {
  const o = toScreen(vp, { x: 0, y: 0 });
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = THEME.axisX;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(0, Math.round(o.y) + 0.5);
  ctx.lineTo(vp.width, Math.round(o.y) + 0.5);
  ctx.stroke();
  ctx.strokeStyle = THEME.axisY;
  ctx.beginPath();
  ctx.moveTo(Math.round(o.x) + 0.5, 0);
  ctx.lineTo(Math.round(o.x) + 0.5, vp.height);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawOrigin(ctx: Ctx, vp: Viewport, active: boolean): void {
  const o = toScreen(vp, { x: 0, y: 0 });
  ctx.save();
  ctx.fillStyle = active ? THEME.selected : THEME.ink;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(o.x, o.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Achsenkreuz-Pfeile
  ctx.lineWidth = 2;
  ctx.strokeStyle = THEME.axisX;
  ctx.beginPath();
  ctx.moveTo(o.x + 6, o.y);
  ctx.lineTo(o.x + 26, o.y);
  ctx.lineTo(o.x + 21, o.y - 3.5);
  ctx.moveTo(o.x + 26, o.y);
  ctx.lineTo(o.x + 21, o.y + 3.5);
  ctx.stroke();
  ctx.strokeStyle = THEME.axisY;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y - 6);
  ctx.lineTo(o.x, o.y - 26);
  ctx.lineTo(o.x - 3.5, o.y - 21);
  ctx.moveTo(o.x, o.y - 26);
  ctx.lineTo(o.x + 3.5, o.y - 21);
  ctx.stroke();
  ctx.restore();
}

/** Farbe für Skizzengeometrie je Zustand. */
function statusColor(s: SceneState, e: Entity, problems: Set<Id>): { color: string; width: number } {
  const sel = s.selection.has(e.id) || (e.kind === 'line' && pathSelected(s, e.id));
  const hov = s.hover === e.id;
  if (sel) return { color: THEME.selected, width: 2.4 };
  if (hov) return { color: THEME.hover, width: 2.4 };
  if (problems.has(e.id)) return { color: THEME.conflict, width: 1.8 };
  const free = isFree(s, e);
  if (e.construction) return { color: free ? THEME.constructionFree : THEME.construction, width: 1.1 };
  return { color: free ? THEME.free : THEME.ink, width: 1.3 };
}

function pathSelected(s: SceneState, lineId: Id): boolean {
  const p = pathOfLine(s.doc, lineId);
  return !!p && (s.selection.has(p.id) || s.hover === p.id);
}

function isFree(s: SceneState, e: Entity): boolean {
  const a = s.analysis;
  if (a.status === 'full' || a.status === 'empty') return false;
  if (!a.free) return a.status === 'under';
  const fp = a.free.points;
  switch (e.kind) {
    case 'line': {
      const l = lineOf(s.doc, e.id)!;
      return fp.has(l.p1) || fp.has(l.p2);
    }
    case 'circle':
      return fp.has(e.center) || a.free.circles.has(e.id);
    case 'text':
      return fp.has(e.anchor);
    case 'path':
      return false;
  }
}

function drawSketchOverlay(ctx: Ctx, s: SceneState, problems: Set<Id>): void {
  const { doc, vp } = s;
  const T = (p: Vec2) => toScreen(vp, p);
  ctx.save();
  ctx.lineCap = 'round';
  // Pfadinneres hervorheben, wenn ausgewählt/überfahren
  for (const e of Object.values(doc.entities)) {
    if (e.kind !== 'path') continue;
    if (!(s.selection.has(e.id) || s.hover === e.id)) continue;
    ctx.beginPath();
    e.edges.forEach((ed, i) => {
      const l = lineOf(doc, ed.id);
      if (!l) return;
      const a = T(pt(doc, ed.reversed ? l.p2 : l.p1));
      if (i === 0) ctx.moveTo(a.x, a.y);
      else ctx.lineTo(a.x, a.y);
    });
    ctx.closePath();
    ctx.fillStyle = s.selection.has(e.id) ? 'rgba(232,89,12,0.10)' : 'rgba(245,159,0,0.10)';
    ctx.fill();
  }

  for (const e of Object.values(doc.entities)) {
    if (e.kind === 'path') continue;
    const st = statusColor(s, e, problems);
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width;
    ctx.setLineDash(e.construction ? [6, 4] : []);
    if (e.kind === 'line') {
      const a = T(pt(doc, e.p1));
      const b = T(pt(doc, e.p2));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (e.kind === 'circle') {
      const c = T(pt(doc, e.center));
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(e.r * vp.zoom, 0.5), 0, Math.PI * 2);
      ctx.stroke();
    } else if (e.kind === 'text') {
      const sel = s.selection.has(e.id) || s.hover === e.id;
      const a = T(pt(doc, e.anchor));
      if (sel) {
        const m = measureText(e);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(a.x + m.left * vp.zoom - 2, a.y - m.ascent * vp.zoom - 2, (m.right - m.left) * vp.zoom + 4, (m.ascent + m.descent) * vp.zoom + 4);
      }
    }
  }
  ctx.setLineDash([]);

  // Punkte: Linienenden, Kreismittelpunkte, Textanker, freie Punkte
  const drawn = new Set<string>();
  const fp = s.analysis.free?.points;
  for (const p of Object.values(doc.points)) {
    if (p.id === ORIGIN_ID) continue;
    const sp = T(p);
    if (sp.x < -10 || sp.y < -10 || sp.x > vp.width + 10 || sp.y > vp.height + 10) continue;
    const key = `${Math.round(sp.x)}:${Math.round(sp.y)}`;
    const sel = s.selection.has(p.id);
    const hov = s.hover === p.id;
    if (drawn.has(key) && !sel && !hov) continue;
    drawn.add(key);
    const owner = p.owner ? doc.entities[p.owner] : undefined;
    const free = s.analysis.status === 'under' && (fp ? fp.has(p.id) : true);
    let color: string = free ? THEME.free : THEME.ink;
    if (problems.has(p.id)) color = THEME.conflict;
    if (hov) color = THEME.hover;
    if (sel) color = THEME.selected;
    const isCenter = owner?.kind === 'circle' || (p.construction && !owner) || owner?.kind === 'path';
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    const r = sel || hov ? 4 : 2.6;
    if (isCenter || p.construction) {
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(sp.x - r - 1.5, sp.y);
      ctx.lineTo(sp.x + r + 1.5, sp.y);
      ctx.moveTo(sp.x, sp.y - r - 1.5);
      ctx.lineTo(sp.x, sp.y + r + 1.5);
      ctx.stroke();
    } else if (owner?.kind === 'text') {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
    }
  }
  ctx.restore();
}

function drawArrow(ctx: Ctx, tip: Vec2, dir: Vec2, size = 9): void {
  // dir zeigt in Bildschirmkoordinaten zur Spitze
  const l = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / l;
  const uy = dir.y / l;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(bx - uy * size * 0.32, by + ux * size * 0.32);
  ctx.lineTo(bx + uy * size * 0.32, by - ux * size * 0.32);
  ctx.closePath();
  ctx.fill();
}

function drawDimensions(ctx: Ctx, s: SceneState, problems: Set<Id>): SceneLayout['dims'] {
  const { doc, vp } = s;
  const px = 1 / vp.zoom;
  const out: SceneLayout['dims'] = [];
  ctx.save();
  ctx.font = DIM_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const d of Object.values(doc.dims) as Dimension[]) {
    const g = dimGeometry(doc, d, px, s.settings.dimDisplay);
    if (!g) continue;
    const sel = s.selection.has(d.id);
    const hov = s.hover === d.id;
    const bad = problems.has(d.id);
    const color = bad ? THEME.conflict : sel ? THEME.selected : hov ? THEME.hover : d.driven ? THEME.dimDriven : THEME.dim;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = sel || hov ? 1.6 : 1;
    ctx.beginPath();
    for (const [a, b] of g.lines) {
      const sa = toScreen(vp, a);
      const sb = toScreen(vp, b);
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    for (const arc of g.arcs) {
      const c = toScreen(vp, arc.c);
      // Welt-Y nach oben → Bildschirmwinkel negieren
      ctx.moveTo(c.x + Math.cos(-arc.a0) * arc.r * vp.zoom, c.y + Math.sin(-arc.a0) * arc.r * vp.zoom);
      ctx.arc(c.x, c.y, arc.r * vp.zoom, -arc.a0, -arc.a1, true);
    }
    ctx.stroke();
    for (const a of g.arrows) {
      const tip = toScreen(vp, a.tip);
      drawArrow(ctx, tip, { x: a.dir.x, y: -a.dir.y });
    }
    const tp = toScreen(vp, g.text);
    const tw = ctx.measureText(g.label).width + 10;
    const th = 18;
    const box = { x: tp.x - tw / 2, y: tp.y - th / 2, w: tw, h: th };
    ctx.fillStyle = sel ? '#fff1e6' : THEME.dimHalo;
    ctx.fillRect(box.x, box.y, box.w, box.h);
    if (sel || hov) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    }
    ctx.fillStyle = color;
    ctx.fillText(g.label, tp.x, tp.y + 0.5);
    out.push({ id: d.id, geom: g, textBox: box });
  }
  ctx.restore();
  return out;
}

/** Lineale im Maßband-Stil (oben und links). */
function drawRulers(ctx: Ctx, vp: Viewport, cursor: Vec2 | null): void {
  const { minor, major } = gridStep(vp.zoom, 6);
  const w = visibleWorld(vp);
  ctx.save();
  // Bänder
  ctx.fillStyle = THEME.tape;
  ctx.fillRect(0, 0, vp.width, RULER);
  ctx.fillRect(0, 0, RULER, vp.height);
  ctx.fillStyle = THEME.tapeDark;
  ctx.fillRect(0, RULER - 1, vp.width, 1);
  ctx.fillRect(RULER - 1, 0, 1, vp.height);

  ctx.strokeStyle = THEME.tapeInk;
  ctx.fillStyle = THEME.tapeInk;
  ctx.lineWidth = 1;
  ctx.font = `500 10px ${THEME.uiFont}`;
  const labelEvery = major * (major * vp.zoom < 40 ? 5 : 1);

  // oben (X)
  ctx.beginPath();
  for (let x = Math.ceil(w.minX / minor) * minor; x <= w.maxX; x += minor) {
    const sx = Math.round(toScreen(vp, { x, y: 0 }).x) + 0.5;
    if (sx < RULER) continue;
    const isMajor = Math.abs(x / major - Math.round(x / major)) < 1e-6;
    const half = !isMajor && Math.abs(x / (major / 2) - Math.round(x / (major / 2))) < 1e-6;
    const len = isMajor ? 10 : half ? 6 : 4;
    ctx.moveTo(sx, RULER - 1);
    ctx.lineTo(sx, RULER - 1 - len);
  }
  ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let x = Math.ceil(w.minX / labelEvery) * labelEvery; x <= w.maxX; x += labelEvery) {
    const sx = toScreen(vp, { x, y: 0 }).x;
    if (sx < RULER + 2) continue;
    ctx.fillText(formatNumber(x, 2), sx + 2, 2);
  }

  // links (Y)
  ctx.beginPath();
  for (let y = Math.ceil(w.minY / minor) * minor; y <= w.maxY; y += minor) {
    const sy = Math.round(toScreen(vp, { x: 0, y }).y) + 0.5;
    if (sy < RULER) continue;
    const isMajor = Math.abs(y / major - Math.round(y / major)) < 1e-6;
    const half = !isMajor && Math.abs(y / (major / 2) - Math.round(y / (major / 2))) < 1e-6;
    const len = isMajor ? 10 : half ? 6 : 4;
    ctx.moveTo(RULER - 1, sy);
    ctx.lineTo(RULER - 1 - len, sy);
  }
  ctx.stroke();
  for (let y = Math.ceil(w.minY / labelEvery) * labelEvery; y <= w.maxY; y += labelEvery) {
    const sy = toScreen(vp, { x: 0, y }).y;
    if (sy < RULER + 2) continue;
    ctx.save();
    ctx.translate(2, sy - 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textBaseline = 'top';
    ctx.fillText(formatNumber(y, 2), 0, 0);
    ctx.restore();
  }

  // Mausmarkierung
  if (cursor) {
    const c = toScreen(vp, cursor);
    ctx.strokeStyle = THEME.conflict;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (c.x > RULER) {
      ctx.moveTo(c.x, 0);
      ctx.lineTo(c.x, RULER);
    }
    if (c.y > RULER) {
      ctx.moveTo(0, c.y);
      ctx.lineTo(RULER, c.y);
    }
    ctx.stroke();
  }
  // Ecke
  ctx.fillStyle = THEME.tapeDark;
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.fillStyle = THEME.tapeInk;
  ctx.font = `600 9px ${THEME.uiFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('mm', RULER / 2, RULER / 2);
  ctx.restore();
}

export { toWorld };
