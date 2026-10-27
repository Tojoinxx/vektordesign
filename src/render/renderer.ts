import type { Dimension, Entity, Id, SketchDoc, Vec2 } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { lineOf, pt } from '../model/doc';
import { measureText } from '../model/textMetrics';
import type { Analysis } from '../solver/analysis';
import type { Settings } from '../store/state';
import { drawDesign } from './drawDesign';
import { shapeWorldPolys } from '../model/shape';
import { isHidden } from '../model/layers';
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
const labelWidths = new Map<string, number>();
function labelWidth(ctx: Ctx, label: string): number {
  let w = labelWidths.get(label);
  if (w === undefined) {
    w = ctx.measureText(label).width;
    if (labelWidths.size > 5000) labelWidths.clear();
    labelWidths.set(label, w);
  }
  return w;
}

export function renderScene(ctx: Ctx, s: SceneState, toolOverlay?: (ctx: Ctx, vp: Viewport) => void): SceneLayout {
  const { vp, doc, settings } = s;
  ctx.save();
  ctx.fillStyle = THEME.paper;
  ctx.fillRect(0, 0, vp.width, vp.height);

  if (settings.grid) drawGrid(ctx, vp);
  drawAxes(ctx, vp);

  const T = (p: Vec2) => toScreen(vp, p);
  drawDesign({ ctx, toScreen: T, scale: vp.zoom, minStrokePx: 0.6, contrast: { background: THEME.paper, hint: THEME.contrastHint } }, doc, { skip: s.skip });

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

function offscreen(vp: Viewport, p: Vec2): boolean {
  const s = toScreen(vp, p);
  return s.x < -50 || s.y < -50 || s.x > vp.width + 50 || s.y > vp.height + 50;
}

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
  ctx.strokeStyle = THEME.originRing;
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

/** Linie → Pfad, einmal je Bild aufgebaut (statt für jede Linie alle Objekte zu durchsuchen). */
let lineToPathDoc: SketchDoc | null = null;
let lineToPath = new Map<Id, Id>();
function pathIdOfLine(doc: SketchDoc, lineId: Id): Id | undefined {
  if (lineToPathDoc !== doc) {
    lineToPath = new Map();
    for (const e of Object.values(doc.entities)) if (e.kind === 'path') for (const ed of e.edges) lineToPath.set(ed.id, e.id);
    lineToPathDoc = doc;
  }
  return lineToPath.get(lineId);
}

function pathSelected(s: SceneState, lineId: Id): boolean {
  const p = pathIdOfLine(s.doc, lineId);
  return !!p && (s.selection.has(p) || s.hover === p);
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
    case 'shape':
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
    if (e.kind !== 'path' || isHidden(doc, e.id)) continue;
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
    ctx.fillStyle = s.selection.has(e.id) ? THEME.selectedFill : THEME.hoverFill;
    ctx.fill();
  }

  // Linien und Kreise nach Stil gebündelt zeichnen (ein Strich-Aufruf je Farbe/Breite/Strichart)
  const batches = new Map<string, { color: string; width: number; dash: boolean; path: Path2D }>();
  const batch = (color: string, width: number, dash: boolean) => {
    const key = `${color}|${width}|${dash}`;
    let b = batches.get(key);
    if (!b) {
      b = { color, width, dash, path: new Path2D() };
      batches.set(key, b);
    }
    return b.path;
  };
  for (const e of Object.values(doc.entities)) {
    if (e.kind === 'path' || isHidden(doc, e.id)) continue;
    if (e.kind === 'text') {
      const sel = s.selection.has(e.id) || s.hover === e.id;
      if (!sel) continue;
      const a = T(pt(doc, e.anchor));
      const m = measureText(e);
      const st = statusColor(s, e, problems);
      ctx.strokeStyle = st.color;
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      ctx.strokeRect(a.x + m.left * vp.zoom - 2, a.y - m.ascent * vp.zoom - 2, (m.right - m.left) * vp.zoom + 4, (m.ascent + m.descent) * vp.zoom + 4);
      ctx.setLineDash([]);
      continue;
    }
    const st = statusColor(s, e, problems);
    if (e.kind === 'shape') {
      // Formen: Umriss nur bei Auswahl/Überfahren (die Form selbst ist das Design)
      if (!(s.selection.has(e.id) || s.hover === e.id)) continue;
      const p = batch(st.color, 1.4, false);
      for (const poly of shapeWorldPolys(doc, e)) {
        poly.forEach((q, i) => {
          const sq = T(q);
          if (i === 0) p.moveTo(sq.x, sq.y);
          else p.lineTo(sq.x, sq.y);
        });
        p.closePath();
      }
      continue;
    }
    const path = batch(st.color, st.width, e.construction);
    if (e.kind === 'line') {
      const a = T(pt(doc, e.p1));
      const b = T(pt(doc, e.p2));
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    } else {
      const c = T(pt(doc, e.center));
      const r = Math.max(e.r * vp.zoom, 0.5);
      path.moveTo(c.x + r, c.y);
      path.arc(c.x, c.y, r, 0, Math.PI * 2);
    }
  }
  // Ausgewählte/überfahrene Stile zuletzt, damit sie oben liegen
  const ordered = [...batches.values()].sort((x, y) => x.width - y.width);
  for (const b of ordered) {
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.width;
    ctx.setLineDash(b.dash ? [6, 4] : []);
    ctx.stroke(b.path);
  }
  ctx.setLineDash([]);

  // Punkte: Linienenden, Kreismittelpunkte, Textanker, freie Punkte – gebündelt je Farbe
  const drawn = new Set<number>();
  const fp = s.analysis.free?.points;
  const squares = new Map<string, Path2D>();
  const crosses = new Map<string, Path2D>();
  const dots = new Map<string, Path2D>();
  const get = (m: Map<string, Path2D>, c: string) => {
    let p = m.get(c);
    if (!p) {
      p = new Path2D();
      m.set(c, p);
    }
    return p;
  };
  for (const p of Object.values(doc.points)) {
    if (p.id === ORIGIN_ID || isHidden(doc, p.id)) continue;
    const sp = T(p);
    if (sp.x < -10 || sp.y < -10 || sp.x > vp.width + 10 || sp.y > vp.height + 10) continue;
    const key = Math.round(sp.x) * 100003 + Math.round(sp.y);
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
    const isCenter = owner?.kind === 'circle' || (p.construction && !owner) || owner?.kind === 'path' || owner?.kind === 'shape';
    const r = sel || hov ? 4 : 2.6;
    if (isCenter || p.construction) {
      const c = get(crosses, color);
      c.moveTo(sp.x - r - 1.5, sp.y);
      c.lineTo(sp.x + r + 1.5, sp.y);
      c.moveTo(sp.x, sp.y - r - 1.5);
      c.lineTo(sp.x, sp.y + r + 1.5);
    } else if (owner?.kind === 'text') {
      const d = get(dots, color);
      d.moveTo(sp.x + r, sp.y);
      d.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    } else {
      get(squares, color).rect(sp.x - r, sp.y - r, r * 2, r * 2);
    }
  }
  ctx.lineWidth = 1.3;
  for (const [c, p] of crosses) {
    ctx.strokeStyle = c;
    ctx.stroke(p);
  }
  for (const [c, p] of squares) {
    ctx.fillStyle = c;
    ctx.fill(p);
  }
  for (const [c, p] of dots) {
    ctx.fillStyle = c;
    ctx.fill(p);
  }
  ctx.restore();
}

function arrowPath(path: Path2D, tip: Vec2, dir: Vec2, size = 9): void {
  // dir zeigt in Bildschirmkoordinaten zur Spitze
  const l = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / l;
  const uy = dir.y / l;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  path.moveTo(tip.x, tip.y);
  path.lineTo(bx - uy * size * 0.32, by + ux * size * 0.32);
  path.lineTo(bx + uy * size * 0.32, by - ux * size * 0.32);
  path.closePath();
}

function drawDimensions(ctx: Ctx, s: SceneState, problems: Set<Id>): SceneLayout['dims'] {
  const { doc, vp } = s;
  const px = 1 / vp.zoom;
  const out: SceneLayout['dims'] = [];
  // Gebündelt je Farbe: Linien, Pfeile, Textfelder; Texte einzeln
  const groups = new Map<string, { lines: Path2D; arrows: Path2D; width: number }>();
  const labels: { x: number; y: number; text: string; color: string; box: { x: number; y: number; w: number; h: number }; sel: boolean; hov: boolean }[] = [];
  ctx.save();
  ctx.font = DIM_FONT;
  for (const d of Object.values(doc.dims) as Dimension[]) {
    if (d.refs.some((r) => isHidden(doc, r))) continue;
    const g = dimGeometry(doc, d, px, s.settings.dimDisplay);
    if (!g) continue;
    // Außerhalb des Bildes? (Text und Linien grob prüfen)
    const tps = toScreen(vp, g.text);
    if ((tps.x < -200 || tps.y < -60 || tps.x > vp.width + 200 || tps.y > vp.height + 60) && g.lines.every(([a, b]) => offscreen(vp, a) && offscreen(vp, b))) continue;
    const sel = s.selection.has(d.id);
    const hov = s.hover === d.id;
    const bad = problems.has(d.id);
    const color = bad ? THEME.conflict : sel ? THEME.selected : hov ? THEME.hover : d.driven ? THEME.dimDriven : THEME.dim;
    const key = `${color}|${sel || hov ? 1.6 : 1}`;
    let grp = groups.get(key);
    if (!grp) {
      grp = { lines: new Path2D(), arrows: new Path2D(), width: sel || hov ? 1.6 : 1 };
      groups.set(key, grp);
    }
    for (const [a, b] of g.lines) {
      const sa = toScreen(vp, a);
      const sb = toScreen(vp, b);
      grp.lines.moveTo(sa.x, sa.y);
      grp.lines.lineTo(sb.x, sb.y);
    }
    for (const arc of g.arcs) {
      const c = toScreen(vp, arc.c);
      // Welt-Y nach oben → Bildschirmwinkel negieren
      grp.lines.moveTo(c.x + Math.cos(-arc.a0) * arc.r * vp.zoom, c.y + Math.sin(-arc.a0) * arc.r * vp.zoom);
      grp.lines.arc(c.x, c.y, arc.r * vp.zoom, -arc.a0, -arc.a1, true);
    }
    for (const a of g.arrows) arrowPath(grp.arrows, toScreen(vp, a.tip), { x: a.dir.x, y: -a.dir.y });
    const tw = labelWidth(ctx, g.label) + 10;
    const th = 18;
    const box = { x: tps.x - tw / 2, y: tps.y - th / 2, w: tw, h: th };
    labels.push({ x: tps.x, y: tps.y, text: g.label, color, box, sel, hov });
    out.push({ id: d.id, geom: g, textBox: box });
  }
  for (const [key, grp] of groups) {
    const color = key.split('|')[0];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = grp.width;
    ctx.stroke(grp.lines);
    ctx.fill(grp.arrows);
  }
  // Textfelder (Hintergrund) in einem Zug, dann Texte
  const halo = new Path2D();
  for (const l of labels) if (!l.sel) halo.rect(l.box.x, l.box.y, l.box.w, l.box.h);
  ctx.fillStyle = THEME.dimHalo;
  ctx.fill(halo);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    if (l.sel) {
      ctx.fillStyle = THEME.dimSelectedBg;
      ctx.fillRect(l.box.x, l.box.y, l.box.w, l.box.h);
    }
    if (l.sel || l.hov) {
      ctx.strokeStyle = l.color;
      ctx.lineWidth = 1;
      ctx.strokeRect(l.box.x + 0.5, l.box.y + 0.5, l.box.w - 1, l.box.h - 1);
    }
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, l.y + 0.5);
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
  ctx.fillStyle = THEME.tapeEdge;
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
  ctx.fillStyle = THEME.tapeCorner;
  ctx.fillRect(0, 0, RULER, RULER);
  ctx.fillStyle = THEME.tapeCornerInk;
  ctx.font = `600 9px ${THEME.uiFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('mm', RULER / 2, RULER / 2);
  ctx.restore();
}

export { toWorld };
