import type { Vec2 } from '../model/types';
import { recognize, RECOGNIZED_LABELS } from '../model/recognize';
import { THEME } from '../render/theme';
import { toScreen, type Viewport } from '../render/viewport';
import type { PlacedPoint } from '../store/editor';
import { drawSnapMarker, type SnapResult } from './snap';
import type { Tool, ToolContext, ToolPointer } from './types';

/**
 * Freihandskizze (S): mit Apple Pencil, Finger oder Maus grob zeichnen – beim Absetzen wird
 * daraus eine Linie, ein Kreis, ein Rechteck oder ein Vieleck. Anfang und Ende fangen an
 * vorhandenen Punkten. Danach wie gewohnt bemaßen.
 */
export class SketchTool implements Tool {
  readonly id = 'sketch' as const;
  readonly snaps = true;
  readonly cssCursor = 'crosshair';
  private stroke: Vec2[] = [];
  private startSnap: SnapResult | null = null;
  private hover: SnapResult | null = null;
  private last: string | null = null;

  constructor(private ctx: ToolContext) {}

  hint(): string {
    if (this.stroke.length) return 'Zeichnen … beim Absetzen wird die Form erkannt';
    return `Freihand: Linie, Kreis oder Rechteck grob zeichnen – wird zu sauberer Geometrie${this.last ? ` · zuletzt erkannt: ${this.last}` : ''} · Esc beendet`;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.stroke = [p.snap.ref ? p.snap.pos : p.world];
    this.startSnap = p.snap.ref ? p.snap : null;
    this.ctx.requestRender();
  }

  pointerMove(p: ToolPointer): void {
    this.hover = p.snap.ref ? p.snap : null;
    if (this.stroke.length) {
      const q = p.world;
      const prev = this.stroke[this.stroke.length - 1];
      // ein Punkt pro Bildschirmpixel genügt
      if (Math.hypot(q.x - prev.x, q.y - prev.y) * this.ctx.vp().zoom >= 1.5) this.stroke.push(q);
    }
    this.ctx.requestRender();
  }

  pointerUp(p: ToolPointer): void {
    if (!this.stroke.length) return;
    const endSnap = p.snap.ref ? p.snap : null;
    const pts = [...this.stroke, endSnap ? endSnap.pos : p.world];
    this.stroke = [];
    this.ctx.requestRender();
    const zoom = this.ctx.vp().zoom;
    // Zu kurz (Antippen) → nichts
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (len * zoom < 12) return;
    const r = recognize(pts);
    const ed = this.ctx.editor;
    const start: PlacedPoint | undefined = this.startSnap ? { pos: this.startSnap.pos, snap: this.startSnap.ref } : undefined;
    const end: PlacedPoint | undefined = endSnap ? { pos: endSnap.pos, snap: endSnap.ref } : undefined;
    let out: { ok: boolean; message?: string } = { ok: false, message: 'Form nicht erkannt' };
    switch (r.kind) {
      case 'line':
        out = ed.createLine(start ?? { pos: r.a }, end && !r.hv ? end : { pos: r.b }, { hv: r.hv });
        break;
      case 'circle':
        out = ed.createCircle({ pos: r.c }, r.r);
        break;
      case 'rect':
        out = ed.createRectangle({ pos: r.min }, { pos: r.max }, 'corner');
        break;
      case 'polygon':
        out = ed.createPolyline(r.pts, r.closed, { start, end });
        break;
      case 'none':
        return;
    }
    if (out.ok) {
      this.last = RECOGNIZED_LABELS[r.kind];
      ed.toast(`${this.last} erkannt`, 'success', 1400);
    } else if (out.message) ed.toast(out.message, 'error');
  }

  cancel(): boolean {
    if (this.stroke.length) {
      this.stroke = [];
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.stroke = [];
    this.hover = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (this.stroke.length > 1) {
      ctx.save();
      ctx.strokeStyle = THEME.preview;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this.stroke.forEach((w, i) => {
        const s = toScreen(vp, w);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.stroke();
      ctx.restore();
    }
    const snap = this.stroke.length ? null : this.hover;
    if (snap) drawSnapMarker(ctx, vp, snap, THEME.snap);
  }
}
