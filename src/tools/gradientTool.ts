import type { Gradient, Id, Vec2 } from '../model/types';
import { entityBBox } from '../model/bounds';
import { bboxValid, dist } from '../model/geometry';
import { fadeGradient, gradientToWorld, isGradient, paintColor, sortedStops, worldToGradientPoint } from '../model/paint';
import { THEME } from '../render/theme';
import { toScreen, type Viewport } from '../render/viewport';
import { drawableTargets } from '../store/editor';
import { hitTest } from './hit';
import type { Tool, ToolContext, ToolPointer } from './types';

type Drag = { kind: 'new' | 'from' | 'to'; start: Vec2 };

/**
 * Verlaufswerkzeug: Strich durch die Form ziehen – Anfang = erste Farbe, Ende = letzte Farbe.
 * Bei kreisförmigem Verlauf ist der Anfang die Mitte und die Strichlänge der Radius.
 */
export class GradientTool implements Tool {
  readonly id = 'gradient' as const;
  readonly snaps = false;
  private drag: Drag | null = null;

  constructor(private ctx: ToolContext) {}

  private get ed() {
    return this.ctx.editor;
  }

  hint(): string {
    if (!this.target()) return 'Gefüllte Form oder Text anklicken, dann einen Strich hindurchziehen';
    return 'Strich durch die Form ziehen: Anfang = erste Farbe, Ende = letzte Farbe · Griffe verschieben die Enden';
  }

  /** Aktuelles Zielobjekt: die (einzige) ausgewählte Form mit Füllung. */
  private target(): Id | null {
    const doc = this.ed.s.doc;
    const t = drawableTargets(doc, this.ed.s.selection).filter((id) => {
      const e = doc.entities[id];
      return e && (e.kind === 'circle' || e.kind === 'text' || (e.kind === 'path' && e.closed));
    });
    return t.length === 1 ? t[0] : null;
  }

  private handles(id: Id): { from: Vec2; to: Vec2 } | null {
    const doc = this.ed.s.doc;
    const e = doc.entities[id];
    if (!e || !isGradient(e.style.fill)) return null;
    const box = entityBBox(doc, e);
    if (!bboxValid(box)) return null;
    return gradientToWorld(e.style.fill, box);
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const vp = this.ctx.vp();
    let target = this.target();
    if (target) {
      const h = this.handles(target);
      if (h) {
        if (dist(toScreen(vp, h.from), p.screen) < 10) {
          this.begin({ kind: 'from', start: p.world });
          return;
        }
        if (dist(toScreen(vp, h.to), p.screen) < 10) {
          this.begin({ kind: 'to', start: p.world });
          return;
        }
      }
    }
    // Form unter dem Zeiger wird zum Ziel
    const doc = this.ed.s.doc;
    const hit = hitTest(doc, vp, null, p.screen, { fills: true, texts: true, curves: true });
    if (hit) {
      const [t] = drawableTargets(doc, [hit.id]);
      if (t && t !== target) {
        this.ed.select([t]);
        target = t;
      }
    }
    if (!target) {
      this.ed.toast('Zuerst eine gefüllte Form, einen Kreis oder einen Text anklicken.', 'info');
      return;
    }
    this.begin({ kind: 'new', start: p.world });
  }

  private begin(d: Drag): void {
    this.drag = d;
    this.ed.beginDrag('Farbverlauf');
  }

  pointerMove(p: ToolPointer): void {
    const d = this.drag;
    const target = this.target();
    if (!d || !target) {
      this.ctx.requestRender();
      return;
    }
    const doc = this.ed.s.doc;
    const e = doc.entities[target];
    if (!e) return;
    const box = entityBBox(doc, e);
    if (!bboxValid(box)) return;
    const base: Gradient = isGradient(e.style.fill) ? e.style.fill : defaultGradient(paintColor(e.style.fill) ?? paintColor(this.ed.s.currentStyle.fill) ?? '#1e2328');
    const cur = gradientToWorld(base, box);
    let from = cur.from;
    let to = cur.to;
    if (d.kind === 'new') {
      if (dist(d.start, p.world) * this.ctx.vp().zoom < 3) return;
      from = d.start;
      to = p.world;
    } else if (d.kind === 'from') from = p.world;
    else to = p.world;
    // Mit Umschalt: auf 45°-Schritte einrasten
    if (p.shift) {
      const ang = Math.atan2(to.y - from.y, to.x - from.x);
      const snapAng = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      const L = dist(from, to);
      to = { x: from.x + Math.cos(snapAng) * L, y: from.y + Math.sin(snapAng) * L };
    }
    const g: Gradient = { ...base, from: worldToGradientPoint(from, box), to: worldToGradientPoint(to, box) };
    this.ed.dragDoc((dd) => {
      const t = dd.entities[target];
      if (t) t.style.fill = g;
    });
  }

  pointerUp(): void {
    if (!this.drag) return;
    this.drag = null;
    this.ed.endDrag();
  }

  cancel(): boolean {
    if (this.drag) {
      this.drag = null;
      this.ed.cancelDrag();
      return true;
    }
    return false;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const target = this.target();
    if (!target) return;
    const doc = this.ed.s.doc;
    const e = doc.entities[target];
    if (!e || !isGradient(e.style.fill)) return;
    const h = this.handles(target);
    if (!h) return;
    const a = toScreen(vp, h.from);
    const b = toScreen(vp, h.to);
    const stops = sortedStops(e.style.fill);
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = THEME.paper;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = THEME.ink;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (e.style.fill.kind === 'radial') {
      ctx.strokeStyle = THEME.ink;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(a.x, a.y, dist(a, b), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Zwischenstufen als kleine Rauten
    for (const s of stops.slice(1, -1)) {
      const x = a.x + (b.x - a.x) * s.offset;
      const y = a.y + (b.y - a.y) * s.offset;
      ctx.fillStyle = s.color;
      ctx.strokeStyle = THEME.ink;
      ctx.beginPath();
      ctx.moveTo(x, y - 5);
      ctx.lineTo(x + 5, y);
      ctx.lineTo(x, y + 5);
      ctx.lineTo(x - 5, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    const handle = (p: Vec2, color: string, square: boolean) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = THEME.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (square) ctx.rect(p.x - 6, p.y - 6, 12, 12);
      else ctx.arc(p.x, p.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = THEME.paper;
      ctx.stroke();
    };
    handle(a, stops[0]?.color ?? '#000', false);
    handle(b, stops[stops.length - 1]?.color ?? '#fff', true);
    ctx.restore();
  }
}

/** Vorgabe beim ersten Ziehen: Farbe verblasst in Transparenz. */
export function defaultGradient(color: string): Gradient {
  return fadeGradient(color, 'lr');
}
