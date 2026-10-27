import type { Id, Vec2 } from '../model/types';
import { lineOf, pt } from '../model/doc';
import { entityArea, areaOf } from '../model/boolean';
import { entityBBox } from '../model/bounds';
import { flattenContour, pointInPolys, polyLength, shapeWorldContours } from '../model/shape';
import { isHidden } from '../model/layers';
import { pathVertices } from '../model/doc';
import { formatNumber } from '../params/expr';
import { THEME } from '../render/theme';
import { toScreen, type Viewport } from '../render/viewport';
import type { ToolId } from '../store/state';
import { hitTest } from './hit';
import { drawSnapMarker, type SnapResult } from './snap';
import type { Tool, ToolContext, ToolPointer } from './types';

const mm = (v: number) => `${formatNumber(v, 2)} mm`;

/** Stutzen (X) bzw. Dehnen: Linie anklicken; das Werkzeug bleibt aktiv. */
export class TrimExtendTool implements Tool {
  readonly snaps = false;
  readonly cssCursor = 'crosshair';
  constructor(
    private ctx: ToolContext,
    readonly id: Extract<ToolId, 'trim' | 'extend'>,
  ) {}

  hint(): string {
    return this.id === 'trim' ? 'Stutzen: Linienstück anklicken, das bis zu den nächsten Schnittpunkten entfernt wird · Esc beendet' : 'Dehnen: Linie nahe dem Ende anklicken, das bis zur nächsten Geometrie verlängert wird · Esc beendet';
  }

  private pick(p: ToolPointer): Id | null {
    const hit = hitTest(this.ctx.editor.s.doc, this.ctx.vp(), this.ctx.layout(), p.screen, { curves: true });
    return hit && hit.kind === 'line' ? hit.id : null;
  }

  pointerMove(p: ToolPointer): void {
    const id = this.pick(p);
    if (id !== this.ctx.editor.s.hover) this.ctx.editor.store.setState({ hover: id });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const id = this.pick(p);
    if (!id) {
      this.ctx.editor.toast(this.id === 'trim' ? 'Zum Stutzen eine Linie anklicken.' : 'Zum Dehnen eine Linie anklicken.', 'info', 2500);
      return;
    }
    const out = this.id === 'trim' ? this.ctx.editor.trim(id, p.world) : this.ctx.editor.extend(id, p.world);
    if (!out.ok) this.ctx.editor.toast(out.message, 'error');
  }

  deactivate(): void {
    this.ctx.editor.store.setState({ hover: null });
  }
}

export interface MeasureResult {
  title: string;
  rows: [string, string][];
}

/**
 * Messen (M): zwei Punkte → Abstand; zwei Linien → Winkel; eine Fläche → Fläche und Umfang.
 * Die Zeichnung bleibt unverändert.
 */
export class MeasureTool implements Tool {
  readonly id: ToolId = 'measure';
  readonly snaps = true;
  readonly cssCursor = 'crosshair';
  private first: { kind: 'point'; p: Vec2 } | { kind: 'line'; id: Id } | null = null;
  private last: { a: Vec2; b: Vec2 } | null = null;
  private snap: SnapResult | null = null;

  constructor(
    private ctx: ToolContext,
    private show: (r: MeasureResult | null) => void,
  ) {}

  hint(): string {
    if (this.first?.kind === 'point') return 'Messen: zweiten Punkt wählen';
    if (this.first?.kind === 'line') return 'Messen: zweite Linie für den Winkel wählen – oder Punkt für den Abstand';
    return 'Messen: zwei Punkte (Abstand), zwei Linien (Winkel) oder eine Fläche (Fläche und Umfang) anklicken';
  }

  pointerMove(p: ToolPointer): void {
    this.snap = p.snap;
    this.ctx.requestRender();
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const ed = this.ctx.editor;
    const doc = ed.s.doc;
    const snapped = p.snap.kind && p.snap.kind !== 'grid' ? p.snap.pos : null;
    const hit = hitTest(doc, this.ctx.vp(), this.ctx.layout(), p.screen, { curves: true, fills: true, texts: true });
    // Zweiter Klick
    if (this.first) {
      const f = this.first;
      if (f.kind === 'line' && hit?.kind === 'line' && hit.id !== f.id) {
        this.showAngle(f.id, hit.id);
        this.first = null;
        return;
      }
      const a = f.kind === 'point' ? f.p : null;
      const b = snapped ?? p.world;
      if (a) {
        this.showDistance(a, b);
        this.first = null;
        return;
      }
      if (f.kind === 'line') {
        // Linie + Punkt: senkrechter Abstand
        const l = lineOf(doc, f.id);
        if (l) {
          const p1 = pt(doc, l.p1);
          const p2 = pt(doc, l.p2);
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.hypot(dx, dy) || 1;
          const t = ((b.x - p1.x) * dx + (b.y - p1.y) * dy) / (len * len);
          const foot = { x: p1.x + dx * t, y: p1.y + dy * t };
          this.last = { a: foot, b };
          this.show({ title: 'Abstand Punkt–Linie', rows: [['Abstand', mm(Math.abs((b.x - p1.x) * dy - (b.y - p1.y) * dx) / len)]] });
        }
        this.first = null;
        return;
      }
    }
    if (snapped) {
      this.first = { kind: 'point', p: snapped };
      this.last = null;
      return;
    }
    if (hit?.kind === 'line') {
      this.first = { kind: 'line', id: hit.id };
      const l = lineOf(doc, hit.id)!;
      const a = pt(doc, l.p1);
      const b = pt(doc, l.p2);
      this.last = { a, b };
      this.show({ title: 'Linie', rows: [['Länge', mm(Math.hypot(b.x - a.x, b.y - a.y))], ['Winkel zur X-Achse', `${formatNumber(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 360, 2)}°`]] });
      return;
    }
    if (hit && (hit.kind === 'circle' || hit.kind === 'path' || hit.kind === 'shape' || hit.kind === 'text')) {
      this.showArea(hit.id);
      return;
    }
    // Klick in eine Fläche ohne Füllung: innerste umschließende Fläche messen
    const inside = this.enclosing(p.world);
    if (inside) {
      this.showArea(inside);
      return;
    }
    this.first = { kind: 'point', p: p.world };
  }

  private enclosing(w: Vec2): Id | null {
    const doc = this.ctx.editor.s.doc;
    let best: Id | null = null;
    let bestArea = Infinity;
    for (const e of Object.values(doc.entities)) {
      if (e.construction || isHidden(doc, e.id) || (e.kind !== 'path' && e.kind !== 'circle' && e.kind !== 'shape')) continue;
      const polys = entityArea(doc, e);
      if (!polys || !pointInPolys(w, polys, e.kind === 'shape' ? e.fillRule : 'nonzero')) continue;
      const a = areaOf(polys);
      if (a < bestArea) {
        bestArea = a;
        best = e.id;
      }
    }
    return best;
  }

  private showDistance(a: Vec2, b: Vec2): void {
    this.last = { a, b };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    this.show({
      title: 'Abstand',
      rows: [
        ['Abstand', mm(Math.hypot(dx, dy))],
        ['Δx', mm(Math.abs(dx))],
        ['Δy', mm(Math.abs(dy))],
        ['Winkel', `${formatNumber(((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, 2)}°`],
      ],
    });
  }

  private showAngle(l1: Id, l2: Id): void {
    const doc = this.ctx.editor.s.doc;
    const a = lineOf(doc, l1)!;
    const b = lineOf(doc, l2)!;
    const u = { x: pt(doc, a.p2).x - pt(doc, a.p1).x, y: pt(doc, a.p2).y - pt(doc, a.p1).y };
    const v = { x: pt(doc, b.p2).x - pt(doc, b.p1).x, y: pt(doc, b.p2).y - pt(doc, b.p1).y };
    let ang = Math.abs((Math.atan2(u.x * v.y - u.y * v.x, u.x * v.x + u.y * v.y) * 180) / Math.PI);
    if (ang > 90) ang = 180 - ang;
    this.last = null;
    this.show({ title: 'Winkel zwischen Linien', rows: [['Winkel', `${formatNumber(ang, 2)}°`], ['Ergänzung', `${formatNumber(180 - ang, 2)}°`]] });
  }

  private showArea(id: Id): void {
    const doc = this.ctx.editor.s.doc;
    const e = doc.entities[id];
    if (!e) return;
    const b = entityBBox(doc, e);
    const rows: [string, string][] = [];
    const area = entityArea(doc, e);
    if (area) rows.push(['Fläche', `${formatNumber(areaOf(area), 2)} mm²`]);
    let perim = 0;
    if (e.kind === 'circle') perim = 2 * Math.PI * e.r;
    else if (e.kind === 'path') perim = polyLength(pathVertices(doc, e), e.closed);
    else if (e.kind === 'shape') for (const c of shapeWorldContours(doc, e)) perim += polyLength(flattenContour(c, 0.005), c.closed);
    if (perim) rows.push(['Umfang', mm(perim)]);
    rows.push(['Breite', mm(b.maxX - b.minX)], ['Höhe', mm(b.maxY - b.minY)]);
    if (e.kind === 'text') rows.push(['Hinweis', 'Fläche erst nach „Text in Pfade“']);
    this.last = null;
    this.first = null;
    this.show({ title: e.kind === 'circle' ? 'Kreis' : e.kind === 'text' ? 'Text' : 'Fläche', rows });
  }

  cancel(): boolean {
    if (this.first) {
      this.first = null;
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.first = null;
    this.last = null;
    this.show(null);
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const seg = this.last;
    ctx.strokeStyle = THEME.snap;
    ctx.fillStyle = THEME.snap;
    ctx.lineWidth = 1.5;
    if (seg) {
      const a = toScreen(vp, seg.a);
      const b = toScreen(vp, seg.b);
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.first?.kind === 'point' && this.snap) {
      const a = toScreen(vp, this.first.p);
      const b = toScreen(vp, this.snap.pos);
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.snap) drawSnapMarker(ctx, vp, this.snap, THEME.snap);
  }
}
