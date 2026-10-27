import type { Id, SketchDoc, Vec2 } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { circleOf, lineOf, pathOfLine, pt } from '../model/doc';
import { entityBBox } from '../model/bounds';
import { bboxContainsBox, bboxIntersects, bboxValid, circleTouchesBox, dist, dot, segmentTouchesBox, sub, type BBox } from '../model/geometry';
import { dimGeometry } from '../render/dimGeometry';
import { THEME } from '../render/theme';
import { toScreen, toWorld, type Viewport } from '../render/viewport';
import { hitTest, pointsOf, type Hit } from './hit';
import type { Tool, ToolContext, ToolPointer } from './types';

type Mode =
  | { kind: 'idle' }
  | { kind: 'press'; hit: Hit | null; start: ToolPointer; additive: boolean }
  | { kind: 'drag'; targets: { id: Id; x: number; y: number }[]; start: Vec2 }
  | { kind: 'radius'; circle: Id; center: Vec2 }
  | { kind: 'dim'; id: Id }
  | { kind: 'box'; start: Vec2; end: Vec2 };

const DRAG_THRESHOLD = 4;

export class SelectTool implements Tool {
  readonly id = 'select' as const;
  readonly snaps = false;
  private mode: Mode = { kind: 'idle' };

  constructor(private ctx: ToolContext) {}

  hint(): string {
    if (this.mode.kind === 'box') return 'Von links nach rechts: ganz enthaltene Objekte · von rechts nach links: berührte Objekte';
    return 'Klicken wählt aus, Ziehen verschiebt freie Geometrie · Doppelklick auf eine Bemaßung ändert den Wert';
  }

  private get ed() {
    return this.ctx.editor;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const hit = hitTest(this.ed.s.doc, this.ctx.vp(), this.ctx.layout(), p.screen);
    this.mode = { kind: 'press', hit, start: p, additive: p.shift || p.ctrl };
    if (hit) {
      const id = selectableId(this.ed.s.doc, hit);
      const sel = this.ed.s.selection;
      if (p.shift || p.ctrl) this.ed.select([id], 'toggle');
      else if (!sel.includes(id)) this.ed.select([id]);
    }
  }

  pointerMove(p: ToolPointer): void {
    const m = this.mode;
    const doc = this.ed.s.doc;
    if (m.kind === 'idle') {
      const hit = hitTest(doc, this.ctx.vp(), this.ctx.layout(), p.screen);
      const hov = hit ? selectableId(doc, hit) : null;
      if (hov !== this.ed.s.hover) this.ed.store.setState({ hover: hov });
      return;
    }
    if (m.kind === 'press') {
      if (dist(p.screen, m.start.screen) < DRAG_THRESHOLD) return;
      this.startDrag(m, p);
      return;
    }
    if (m.kind === 'drag') {
      const dx = p.world.x - m.start.x;
      const dy = p.world.y - m.start.y;
      this.ed.dragTo({ kind: 'points', targets: m.targets.map((t) => ({ id: t.id, x: t.x + dx, y: t.y + dy })) });
      return;
    }
    if (m.kind === 'radius') {
      this.ed.dragTo({ kind: 'radius', circle: m.circle, r: Math.max(0.01, dist(p.world, m.center)) });
      return;
    }
    if (m.kind === 'dim') {
      this.moveDimension(m.id, p.world);
      return;
    }
    if (m.kind === 'box') {
      m.end = p.screen;
      this.ctx.requestRender();
    }
  }

  private startDrag(m: Extract<Mode, { kind: 'press' }>, p: ToolPointer): void {
    const doc = this.ed.s.doc;
    const hit = m.hit;
    if (!hit) {
      this.mode = { kind: 'box', start: m.start.screen, end: p.screen };
      return;
    }
    if (hit.kind === 'dim') {
      this.ed.beginDrag('Bemaßung verschieben');
      this.mode = { kind: 'dim', id: hit.id };
      return;
    }
    if (hit.kind === 'glyph') {
      this.mode = { kind: 'idle' };
      return;
    }
    if (hit.kind === 'circle' && hit.dist > 0) {
      // Kreislinie gegriffen → Radius ändern
      const c = circleOf(doc, hit.id)!;
      this.ed.beginDrag('Radius ändern');
      this.mode = { kind: 'radius', circle: c.id, center: pt(doc, c.center) };
      return;
    }
    // Zu verschiebende Punkte: getroffenes Element bzw. ganze Auswahl
    const sel = this.ed.s.selection;
    const grabbedId = selectableId(doc, hit);
    const ids = sel.includes(grabbedId) ? sel : [grabbedId];
    const pts = new Set<Id>();
    for (const id of ids) for (const pid of pointsOf(doc, id)) pts.add(pid);
    pts.delete(ORIGIN_ID);
    if (!pts.size) {
      this.mode = { kind: 'idle' };
      return;
    }
    this.ed.beginDrag('Verschieben');
    this.mode = {
      kind: 'drag',
      start: m.start.world,
      targets: [...pts].map((id) => ({ id, x: doc.points[id].x, y: doc.points[id].y })),
    };
    this.pointerMove(p);
  }

  private moveDimension(id: Id, w: Vec2): void {
    const doc = this.ed.s.doc;
    const d = doc.dims[id];
    if (!d) return;
    const vp = this.ctx.vp();
    const g = dimGeometry(doc, d, 1 / vp.zoom);
    if (!g) return;
    if (d.kind === 'radius' || d.kind === 'diameter') {
      const c = circleOf(doc, d.refs[0]);
      if (!c) return;
      const C = pt(doc, c.center);
      const ang = Math.atan2(w.y - C.y, w.x - C.x);
      const off = Math.max(0, dist(w, C) - c.r - 14 / vp.zoom);
      this.ed.dragDoc((dd) => {
        dd.dims[id].angle = ang;
        dd.dims[id].offset = off;
      });
    } else if (d.kind === 'angle' || d.kind === 'angleX') {
      const r = Math.max(dist(w, g.base), 8 / vp.zoom);
      this.ed.dragDoc((dd) => void (dd.dims[id].offset = r));
    } else {
      const off = dot(sub(w, g.base), g.normal);
      // Textverschiebung entlang der Maßlinie relativ zur Mitte
      const midA = g.text;
      const shiftNow = d.shift + dot(sub(w, midA), g.along);
      const lineLen = Math.abs(dot(sub(g.lines[g.lines.length - 1][1], g.lines[g.lines.length - 1][0]), g.along));
      const shift = Math.abs(shiftNow) < lineLen / 2 ? 0 : shiftNow;
      this.ed.dragDoc((dd) => {
        dd.dims[id].offset = off;
        dd.dims[id].shift = shift;
      });
    }
  }

  pointerUp(p: ToolPointer): void {
    const m = this.mode;
    this.mode = { kind: 'idle' };
    if (m.kind === 'press') {
      if (!m.hit && !m.additive) this.ed.select([]);
      return;
    }
    if (m.kind === 'drag' || m.kind === 'radius' || m.kind === 'dim') {
      this.ed.endDrag();
      return;
    }
    if (m.kind === 'box') {
      const ids = this.boxSelect(m.start, p.screen);
      this.ed.select(ids, p.shift || p.ctrl ? 'add' : 'replace');
      this.ctx.requestRender();
    }
  }

  doubleClick(p: ToolPointer): void {
    const doc = this.ed.s.doc;
    const hit = hitTest(doc, this.ctx.vp(), this.ctx.layout(), p.screen);
    if (!hit) return;
    if (hit.kind === 'dim') {
      const d = doc.dims[hit.id];
      if (d?.driven) {
        this.ed.toast(`${d.name} ist getrieben (Referenz). Im Kontextmenü auf „Treibend“ umschalten, um den Wert zu ändern.`);
        return;
      }
      this.ctx.openDimEditor(hit.id, false);
    } else if (hit.kind === 'text') {
      this.ctx.openTextEditor(hit.id);
    }
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.ed.s.selection.length) {
        const out = this.ed.deleteSelection();
        if (!out.ok) this.ed.toast(out.message, 'error');
        return true;
      }
    }
    return false;
  }

  cancel(): boolean {
    if (this.mode.kind === 'drag' || this.mode.kind === 'radius' || this.mode.kind === 'dim') {
      this.ed.cancelDrag();
      this.mode = { kind: 'idle' };
      return true;
    }
    if (this.mode.kind === 'box') {
      this.mode = { kind: 'idle' };
      this.ctx.requestRender();
      return true;
    }
    if (this.ed.s.selection.length) {
      this.ed.select([]);
      return true;
    }
    return false;
  }

  private boxSelect(a: Vec2, b: Vec2): Id[] {
    const vp = this.ctx.vp();
    const doc = this.ed.s.doc;
    const wa = toWorld(vp, a);
    const wb = toWorld(vp, b);
    const box: BBox = { minX: Math.min(wa.x, wb.x), maxX: Math.max(wa.x, wb.x), minY: Math.min(wa.y, wb.y), maxY: Math.max(wa.y, wb.y) };
    const crossing = b.x < a.x;
    const out = new Set<Id>();
    const take = (id: Id, inside: boolean, touching: boolean) => {
      if (crossing ? touching : inside) out.add(id);
    };
    for (const e of Object.values(doc.entities)) {
      const eb = entityBBox(doc, e);
      if (!bboxValid(eb)) continue;
      const inside = bboxContainsBox(box, eb);
      if (e.kind === 'line') {
        if (pathOfLine(doc, e.id)) continue;
        take(e.id, inside, segmentTouchesBox(pt(doc, e.p1), pt(doc, e.p2), box));
      } else if (e.kind === 'circle') {
        take(e.id, inside, circleTouchesBox(pt(doc, e.center), e.r, box));
      } else if (e.kind === 'path') {
        const touching = e.edges.some((ed) => {
          const l = lineOf(doc, ed.id);
          return !!l && segmentTouchesBox(pt(doc, l.p1), pt(doc, l.p2), box);
        });
        take(e.id, inside, touching);
      } else {
        take(e.id, inside, bboxIntersects(box, eb));
      }
    }
    for (const p of Object.values(doc.points)) {
      if (p.owner || p.locked) continue;
      const inside = p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
      take(p.id, inside, inside);
    }
    return [...out];
  }

  drawOverlay(ctx: CanvasRenderingContext2D, _vp: Viewport): void {
    const m = this.mode;
    if (m.kind !== 'box') return;
    const crossing = m.end.x < m.start.x;
    const x = Math.min(m.start.x, m.end.x);
    const y = Math.min(m.start.y, m.end.y);
    const w = Math.abs(m.end.x - m.start.x);
    const h = Math.abs(m.end.y - m.start.y);
    ctx.fillStyle = crossing ? THEME.selectBoxCross : THEME.selectBoxWindow;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = crossing ? THEME.axisY : THEME.free;
    ctx.lineWidth = 1;
    ctx.setLineDash(crossing ? [5, 4] : []);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.setLineDash([]);
  }
}

/** Welche Id wird beim Klick ausgewählt? Glyph → Abhängigkeit, Fläche → Pfad. */
export function selectableId(_doc: SketchDoc, hit: Hit): Id {
  return hit.id;
}

export function screenOf(vp: Viewport, p: Vec2): Vec2 {
  return toScreen(vp, p);
}
