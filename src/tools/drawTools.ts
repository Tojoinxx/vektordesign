import type { Id, Vec2 } from '../model/types';
import { add, dist, mul, norm, sub, toDeg, toRad } from '../model/geometry';
import { formatNumber } from '../params/expr';
import { THEME } from '../render/theme';
import { toScreen, type Viewport } from '../render/viewport';
import { drawGlyphIcon } from '../render/glyphs';
import { tryEvaluate, type CommitOutcome, type PlacedPoint } from '../store/editor';
import { drawSnapMarker, SNAP_LABELS, type SnapResult } from './snap';
import { hitTest } from './hit';
import type { Tool, ToolContext, ToolPointer } from './types';

const HV_TOL = toRad(3);

/** Gemeinsame Basis: Fangmarke, Vorschaufarben, Meldungen. */
abstract class DrawToolBase {
  protected snap: SnapResult | null = null;
  protected cursor: Vec2 | null = null;
  protected noAuto = false;
  constructor(protected ctx: ToolContext) {}
  protected get ed() {
    return this.ctx.editor;
  }
  protected placed(p: ToolPointer): PlacedPoint {
    return { pos: p.snap.pos, snap: p.snap.ref };
  }
  protected track(p: ToolPointer): void {
    this.snap = p.snap;
    this.cursor = p.snap.pos;
    this.noAuto = p.ctrl;
    this.ctx.requestRender();
  }
  protected report(out: CommitOutcome): boolean {
    if (!out.ok) {
      this.ed.toast(out.message, 'error');
      return false;
    }
    return true;
  }
  protected value(key: string): number | null {
    const raw = this.ctx.dynamicValues()[key];
    if (!raw || !raw.trim()) return null;
    const v = tryEvaluate(raw, this.ed.s.doc);
    return v !== null && Number.isFinite(v) ? v : null;
  }
  protected raw(key: string): string | null {
    const r = this.ctx.dynamicValues()[key];
    return r && r.trim() ? r.trim() : null;
  }
  protected drawSnap(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (!this.snap?.kind) return;
    drawSnapMarker(ctx, vp, this.snap, THEME.snap);
    const s = toScreen(vp, this.snap.pos);
    ctx.save();
    ctx.font = `500 11px ${THEME.uiFont}`;
    ctx.fillStyle = THEME.snap;
    ctx.fillText(SNAP_LABELS[this.snap.kind], s.x + 10, s.y + 20);
    ctx.restore();
  }
  protected previewStyle(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = THEME.preview;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
  }
}

/** Ermittelt Horizontal/Vertikal-Folgerung für eine Richtung. */
export function inferHV(a: Vec2, b: Vec2): 'h' | 'v' | null {
  const d = sub(b, a);
  if (Math.hypot(d.x, d.y) < 1e-9) return null;
  const ang = Math.atan2(d.y, d.x);
  const m = Math.abs(((ang % Math.PI) + Math.PI) % Math.PI);
  if (m < HV_TOL || Math.PI - m < HV_TOL) return 'h';
  if (Math.abs(m - Math.PI / 2) < HV_TOL) return 'v';
  return null;
}

// ---------------------------------------------------------------------------
// Linie (Kettenmodus)
// ---------------------------------------------------------------------------

export class LineTool extends DrawToolBase implements Tool {
  readonly id = 'line' as const;
  readonly snaps = true;
  private start: PlacedPoint | null = null;
  private lastEnd: Id | null = null;
  private chainFirst: Id | null = null;
  private chainLines: Id[] = [];
  private construction = false;

  constructor(ctx: ToolContext, opts: { construction?: boolean } = {}) {
    super(ctx);
    this.construction = !!opts.construction;
  }

  hint(): string {
    if (!this.start) return 'Startpunkt wählen (Strg: ohne automatische Abhängigkeiten)';
    return 'Nächsten Punkt wählen · Länge eintippen, Tab → Winkel, Enter übernimmt · Esc beendet die Kette';
  }

  private endPoint(p: ToolPointer): { end: PlacedPoint; hv: 'h' | 'v' | null } {
    const s = this.start!;
    let end: PlacedPoint = { pos: p.snap.pos, snap: p.snap.ref };
    const L = this.value('length');
    const A = this.value('angle');
    if (L !== null || A !== null) {
      const cur = sub(p.world, s.pos);
      const ang = A !== null ? toRad(A) : Math.atan2(cur.y, cur.x);
      const len = L !== null ? L : Math.hypot(cur.x, cur.y);
      end = { pos: add(s.pos, { x: Math.cos(ang) * len, y: Math.sin(ang) * len }), snap: null };
      const hv = A !== null ? (Math.abs(Math.sin(ang)) < 1e-9 ? 'h' : Math.abs(Math.cos(ang)) < 1e-9 ? 'v' : null) : inferHV(s.pos, end.pos);
      return { end, hv: this.noAuto ? null : hv };
    }
    // Auf Punkt gefangen → keine H/V-Folgerung (die Lage bestimmt der Punkt)
    if (p.snap.ref && p.snap.ref.kind !== 'grid') return { end, hv: null };
    const hv = this.noAuto ? null : inferHV(s.pos, end.pos);
    if (hv === 'h') end = { pos: { x: end.pos.x, y: s.pos.y }, snap: end.snap?.kind === 'grid' ? null : end.snap };
    if (hv === 'v') end = { pos: { x: s.pos.x, y: end.pos.y }, snap: end.snap?.kind === 'grid' ? null : end.snap };
    return { end, hv };
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.track(p);
    if (!this.start) {
      this.start = this.placed(p);
      this.ctx.clearDynamicValues();
      this.updateInput(p);
      return;
    }
    this.commitSegment(p);
  }

  private commitSegment(p: ToolPointer): void {
    const { end, hv } = this.endPoint(p);
    const length = this.raw('length');
    const angle = this.raw('angle');
    const out = this.ed.createLine(this.start!, end, {
      construction: this.construction || this.ed.s.constructionMode,
      prevEnd: this.lastEnd,
      hv,
      length,
      angle: hv ? null : angle,
      noAuto: this.noAuto,
    });
    if (!this.report(out) || !out.line) return;
    const line = out.line;
    if (!this.chainFirst) this.chainFirst = line.p1;
    this.chainLines.push(line.id);
    this.ctx.clearDynamicValues();
    // Kette geschlossen? (Endpunkt auf Startpunkt der Kette gefangen)
    const doc = this.ed.s.doc;
    const closes =
      end.snap?.kind === 'point' &&
      this.chainLines.length >= 2 &&
      (end.snap.id === this.chainFirst || Object.values(doc.constraints).some((c) => c.kind === 'coincident' && c.refs.includes(end.snap!.kind === 'point' ? end.snap!.id : '') && c.refs.includes(this.chainFirst!)));
    if (closes && !this.construction && !this.ed.s.constructionMode) {
      const pathOut = this.ed.createPathFromLines(this.chainLines, true);
      if (pathOut.ok) this.ed.toast('Geschlossene Kontur erstellt – sie kann jetzt gefüllt werden.', 'success', 2500);
      this.reset();
      return;
    }
    this.start = { pos: doc.points[line.p2] ?? end.pos, snap: null };
    this.lastEnd = line.p2;
    this.updateInput(p);
  }

  pointerMove(p: ToolPointer): void {
    this.track(p);
    if (this.start) this.updateInput(p);
  }

  private updateInput(p: ToolPointer): void {
    if (!this.start) {
      this.ctx.setDynamicInput(null);
      return;
    }
    const { end } = this.endPoint(p);
    const d = sub(end.pos, this.start.pos);
    const len = Math.hypot(d.x, d.y);
    let ang = toDeg(Math.atan2(d.y, d.x));
    if (ang < 0) ang += 360;
    this.ctx.setDynamicInput({
      at: { x: p.screen.x + 18, y: p.screen.y + 18 },
      fields: [
        { key: 'length', label: 'Länge', unit: 'mm', live: formatNumber(len, 2) },
        { key: 'angle', label: 'Winkel', unit: '°', live: formatNumber(ang, 1) },
      ],
    });
  }

  inputChanged(): void {
    this.ctx.requestRender();
  }

  submitInput(): void {
    if (!this.start || !this.lastPointer) return;
    this.commitSegment(this.lastPointer);
  }

  private lastPointer: ToolPointer | null = null;
  private remember(p: ToolPointer) {
    this.lastPointer = p;
  }

  keyDown(): boolean {
    return false;
  }

  cancel(): boolean {
    if (this.start) {
      this.reset();
      return true;
    }
    return false;
  }

  finish(): void {
    this.reset();
  }

  private reset(): void {
    this.start = null;
    this.lastEnd = null;
    this.chainFirst = null;
    this.chainLines = [];
    this.ctx.setDynamicInput(null);
    this.ctx.clearDynamicValues();
    this.ctx.requestRender();
  }

  deactivate(): void {
    this.reset();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (this.start && this.lastPointer) {
      const { end, hv } = this.endPoint(this.lastPointer);
      const a = toScreen(vp, this.start.pos);
      const b = toScreen(vp, end.pos);
      this.previewStyle(ctx);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (hv) {
        const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = THEME.snap;
        ctx.lineWidth = 1;
        ctx.fillRect(m.x + 8, m.y - 22, 16, 16);
        ctx.strokeRect(m.x + 8.5, m.y - 21.5, 15, 15);
        drawGlyphIcon(ctx, hv === 'h' ? 'horizontal' : 'vertical', m.x + 16, m.y - 14, THEME.snap);
      }
    }
    this.drawSnap(ctx, vp);
  }

  // Zeiger merken, damit Enter in der Werteingabe den Punkt setzen kann
  protected override track(p: ToolPointer): void {
    this.remember(p);
    super.track(p);
  }
}

// ---------------------------------------------------------------------------
// Rechteck
// ---------------------------------------------------------------------------

export class RectTool extends DrawToolBase implements Tool {
  readonly id = 'rect' as const;
  readonly snaps = true;
  private first: PlacedPoint | null = null;
  private last: ToolPointer | null = null;

  hint(): string {
    const mode = this.ed.s.rectMode === 'center' ? 'Mittelpunkt' : 'erste Ecke';
    if (!this.first) return `${mode[0].toUpperCase()}${mode.slice(1)} wählen · Modus im Werkzeugmenü (2 Punkte / Mittelpunkt)`;
    return 'Gegenüberliegende Ecke wählen · Breite eintippen, Tab → Höhe, Enter übernimmt';
  }

  private secondPoint(p: ToolPointer): PlacedPoint {
    const f = this.first!;
    const W = this.value('width');
    const H = this.value('height');
    let pos = p.snap.pos;
    let snap = p.snap.ref;
    if (W !== null || H !== null) {
      const sx = Math.sign(p.world.x - f.pos.x) || 1;
      const sy = Math.sign(p.world.y - f.pos.y) || 1;
      const center = this.ed.s.rectMode === 'center';
      const dx = W !== null ? (center ? W / 2 : W) * sx : p.world.x - f.pos.x;
      const dy = H !== null ? (center ? H / 2 : H) * sy : p.world.y - f.pos.y;
      pos = { x: f.pos.x + dx, y: f.pos.y + dy };
      snap = null;
    }
    return { pos, snap };
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.track(p);
    this.last = p;
    if (!this.first) {
      this.first = this.placed(p);
      this.ctx.clearDynamicValues();
      this.updateInput(p);
      return;
    }
    this.commit(p);
  }

  private commit(p: ToolPointer): void {
    const second = this.secondPoint(p);
    const out = this.ed.createRectangle(this.first!, second, this.ed.s.rectMode, {
      width: this.raw('width'),
      height: this.raw('height'),
      noAuto: this.noAuto,
      construction: this.ed.s.constructionMode,
    });
    if (this.report(out)) {
      this.reset();
      if (out.pathId) this.ed.select([out.pathId]);
    }
  }

  pointerMove(p: ToolPointer): void {
    this.track(p);
    this.last = p;
    if (this.first) this.updateInput(p);
  }

  private updateInput(p: ToolPointer): void {
    const f = this.first!;
    const s = this.secondPoint(p).pos;
    const k = this.ed.s.rectMode === 'center' ? 2 : 1;
    this.ctx.setDynamicInput({
      at: { x: p.screen.x + 18, y: p.screen.y + 18 },
      fields: [
        { key: 'width', label: 'Breite', unit: 'mm', live: formatNumber(Math.abs(s.x - f.pos.x) * k, 2) },
        { key: 'height', label: 'Höhe', unit: 'mm', live: formatNumber(Math.abs(s.y - f.pos.y) * k, 2) },
      ],
    });
  }

  inputChanged(): void {
    this.ctx.requestRender();
  }

  submitInput(): void {
    if (this.first && this.last) this.commit(this.last);
  }

  cancel(): boolean {
    if (this.first) {
      this.reset();
      return true;
    }
    return false;
  }

  private reset(): void {
    this.first = null;
    this.ctx.setDynamicInput(null);
    this.ctx.clearDynamicValues();
    this.ctx.requestRender();
  }

  deactivate(): void {
    this.reset();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (this.first && this.last) {
      const f = this.first.pos;
      const s = this.secondPoint(this.last).pos;
      let x0: number, x1: number, y0: number, y1: number;
      if (this.ed.s.rectMode === 'center') {
        const hw = Math.abs(s.x - f.x);
        const hh = Math.abs(s.y - f.y);
        [x0, x1, y0, y1] = [f.x - hw, f.x + hw, f.y - hh, f.y + hh];
      } else {
        [x0, x1, y0, y1] = [Math.min(f.x, s.x), Math.max(f.x, s.x), Math.min(f.y, s.y), Math.max(f.y, s.y)];
      }
      const a = toScreen(vp, { x: x0, y: y1 });
      const b = toScreen(vp, { x: x1, y: y0 });
      this.previewStyle(ctx);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
      const c = toScreen(vp, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
      ctx.strokeStyle = THEME.preview;
      ctx.beginPath();
      ctx.moveTo(c.x - 5, c.y);
      ctx.lineTo(c.x + 5, c.y);
      ctx.moveTo(c.x, c.y - 5);
      ctx.lineTo(c.x, c.y + 5);
      ctx.stroke();
    }
    this.drawSnap(ctx, vp);
  }
}

// ---------------------------------------------------------------------------
// Kreis
// ---------------------------------------------------------------------------

export class CircleTool extends DrawToolBase implements Tool {
  readonly id = 'circle' as const;
  readonly snaps = true;
  private center: PlacedPoint | null = null;
  private last: ToolPointer | null = null;

  hint(): string {
    if (!this.center) return 'Mittelpunkt wählen';
    return 'Punkt auf dem Kreis wählen · Durchmesser eintippen, Enter übernimmt';
  }

  private radius(p: ToolPointer): number {
    const D = this.value('diameter');
    if (D !== null) return D / 2;
    return dist(p.snap.pos, this.center!.pos);
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.track(p);
    this.last = p;
    if (!this.center) {
      this.center = this.placed(p);
      this.ctx.clearDynamicValues();
      this.updateInput(p);
      return;
    }
    this.commit(p);
  }

  private commit(p: ToolPointer): void {
    const r = this.radius(p);
    const diameter = this.raw('diameter');
    const out = this.ed.createCircle(this.center!, r, {
      rim: diameter ? null : { pos: p.snap.pos, snap: p.snap.ref },
      diameter,
      noAuto: this.noAuto,
      construction: this.ed.s.constructionMode,
    });
    if (this.report(out)) {
      this.reset();
      if (out.circleId) this.ed.select([out.circleId]);
    }
  }

  pointerMove(p: ToolPointer): void {
    this.track(p);
    this.last = p;
    if (this.center) this.updateInput(p);
  }

  private updateInput(p: ToolPointer): void {
    this.ctx.setDynamicInput({
      at: { x: p.screen.x + 18, y: p.screen.y + 18 },
      fields: [{ key: 'diameter', label: 'Ø', unit: 'mm', live: formatNumber(this.radius(p) * 2, 2) }],
    });
  }

  inputChanged(): void {
    this.ctx.requestRender();
  }

  submitInput(): void {
    if (this.center && this.last) this.commit(this.last);
  }

  cancel(): boolean {
    if (this.center) {
      this.reset();
      return true;
    }
    return false;
  }

  private reset(): void {
    this.center = null;
    this.ctx.setDynamicInput(null);
    this.ctx.clearDynamicValues();
    this.ctx.requestRender();
  }

  deactivate(): void {
    this.reset();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (this.center && this.last) {
      const c = toScreen(vp, this.center.pos);
      const r = this.radius(this.last) * vp.zoom;
      this.previewStyle(ctx);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(r, 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const dir = norm(sub(this.last.snap.pos, this.center.pos));
      const e = toScreen(vp, add(this.center.pos, mul(dir, this.radius(this.last))));
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(e.x, e.y);
      ctx.stroke();
    }
    this.drawSnap(ctx, vp);
  }
}

// ---------------------------------------------------------------------------
// Punkt und Text
// ---------------------------------------------------------------------------

export class PointTool extends DrawToolBase implements Tool {
  readonly id = 'point' as const;
  readonly snaps = true;
  hint(): string {
    return 'Punkt setzen (Hilfspunkt für Bemaßungen und Abhängigkeiten)';
  }
  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.report(this.ed.createPoint(this.placed(p), p.ctrl));
  }
  pointerMove(p: ToolPointer): void {
    this.track(p);
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.drawSnap(ctx, vp);
  }
}

export class TextTool extends DrawToolBase implements Tool {
  readonly id = 'text' as const;
  readonly snaps = true;
  hint(): string {
    return 'Klicken, um Text zu setzen (Grundlinie) · vorhandenen Text anklicken zum Bearbeiten';
  }
  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const hit = hitTest(this.ed.s.doc, this.ctx.vp(), this.ctx.layout(), p.screen, { texts: true });
    if (hit?.kind === 'text') {
      this.ctx.openTextEditor(hit.id);
      return;
    }
    this.ctx.openTextEditor(null, this.placed(p));
  }
  pointerMove(p: ToolPointer): void {
    this.track(p);
  }
  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    this.drawSnap(ctx, vp);
  }
}
