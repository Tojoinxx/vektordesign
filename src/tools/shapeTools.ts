import type { ShapeNode, Vec2 } from '../model/types';
import { add, dist, dot, mid, mul, norm, sub, toDeg, toRad } from '../model/geometry';
import { circleThrough3 } from '../model/arc';
import { formatNumber } from '../params/expr';
import { THEME } from '../render/theme';
import { toScreen, type Viewport } from '../render/viewport';
import type { PlacedPoint } from '../store/editor';
import { DrawToolBase } from './drawTools';
import type { Tool, ToolPointer } from './types';

/**
 * Weitere Zeichenwerkzeuge: Bogen (3 Punkte / Mittelpunkt), Ellipse, Vieleck, Stern und
 * Zeichenstift für Bézierpfade. Alle mit direkter Werteingabe (Tab wechselt das Feld).
 */

const TAU = Math.PI * 2;

/** Bogen in Weltkoordinaten auf den Bildschirm (y nach unten → Winkel gespiegelt). */
function strokeArc(ctx: CanvasRenderingContext2D, vp: Viewport, c: Vec2, r: number, a0: number, sweep: number): void {
  const s = toScreen(vp, c);
  ctx.beginPath();
  ctx.arc(s.x, s.y, Math.max(0.5, r * vp.zoom), -a0, -(a0 + sweep), sweep > 0);
  ctx.stroke();
}

function strokePoly(ctx: CanvasRenderingContext2D, vp: Viewport, pts: Vec2[], closed: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = toScreen(vp, p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Bogen
// ---------------------------------------------------------------------------

export class ArcTool extends DrawToolBase implements Tool {
  readonly id = 'arc' as const;
  readonly snaps = true;
  private a: PlacedPoint | null = null;
  private b: PlacedPoint | null = null;
  private last: ToolPointer | null = null;
  /** Mittelpunktmodus: aufsummierter Drehwinkel seit dem Startpunkt (Vorzeichen = Richtung) */
  private swept = 0;
  private prevAng: number | null = null;

  private get mode() {
    return this.ed.s.arcMode;
  }

  hint(): string {
    if (this.mode === 'center') {
      if (!this.a) return 'Mittelpunkt wählen · Modus im Werkzeugmenü (3 Punkte / Mittelpunkt)';
      if (!this.b) return 'Startpunkt wählen (legt den Radius fest) · Radius eintippen';
      return 'Endpunkt wählen – die Drehrichtung folgt der Maus · Öffnungswinkel eintippen, Enter übernimmt';
    }
    if (!this.a) return 'Startpunkt wählen · Modus im Werkzeugmenü (3 Punkte / Mittelpunkt)';
    if (!this.b) return 'Endpunkt wählen';
    return 'Wölbung zeigen und klicken · Radius eintippen, Enter übernimmt';
  }

  /** 3-Punkt-Modus: Punkt auf dem Bogen (Maus bzw. aus eingetipptem Radius). */
  private apex(p: ToolPointer): Vec2 | null {
    const s = this.a!.pos;
    const e = this.b!.pos;
    const R = this.value('radius');
    if (R === null) return p.snap.pos;
    const m = mid(s, e);
    const half = dist(s, e) / 2;
    if (R < half - 1e-9) return null;
    const h = Math.sqrt(Math.max(0, R * R - half * half));
    const u = norm(sub(e, s));
    const n = { x: -u.y, y: u.x };
    const side = Math.sign(dot(sub(p.world, m), n)) || 1;
    return add(m, mul(n, side * (R - h)));
  }

  /** Mittelpunktmodus: Radius und Endwinkel. */
  private centerGeom(p: ToolPointer): { r: number; a0: number; sweep: number } {
    const c = this.a!.pos;
    const R = this.value('radius') ?? dist(c, this.b ? this.b.pos : p.snap.pos);
    const startPos = this.b ? this.b.pos : p.snap.pos;
    const a0 = Math.atan2(startPos.y - c.y, startPos.x - c.x);
    const deg = this.value('angle');
    let sweep = this.swept;
    if (deg !== null) sweep = (Math.sign(this.swept) || 1) * toRad(Math.min(359.999, Math.abs(deg)));
    return { r: R, a0, sweep };
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.track(p);
    this.last = p;
    if (!this.a) {
      this.a = this.placed(p);
      this.ctx.clearDynamicValues();
      this.updateInput(p);
      return;
    }
    if (!this.b) {
      if (this.mode === 'center') {
        const R = this.value('radius');
        const c = this.a.pos;
        let pos = p.snap.pos;
        let snap = p.snap.ref;
        if (R !== null && dist(pos, c) > 1e-9) {
          pos = add(c, mul(norm(sub(pos, c)), R));
          snap = null;
        }
        this.b = { pos, snap };
        this.swept = 0;
        this.prevAng = Math.atan2(pos.y - c.y, pos.x - c.x);
      } else {
        if (dist(p.snap.pos, this.a.pos) < 1e-6) return;
        this.b = this.placed(p);
      }
      this.updateInput(p);
      return;
    }
    this.commit(p);
  }

  private commit(p: ToolPointer): void {
    const noAuto = this.noAuto;
    const construction = this.ed.s.constructionMode;
    if (this.mode === 'center') {
      const g = this.centerGeom(p);
      if (Math.abs(g.sweep) < 1e-6) return;
      const c = this.a!.pos;
      const endAng = g.a0 + g.sweep;
      const usePointer = this.value('angle') === null && this.value('radius') === null;
      const endPos = { x: c.x + g.r * Math.cos(endAng), y: c.y + g.r * Math.sin(endAng) };
      const end: PlacedPoint = usePointer ? { pos: endPos, snap: p.snap.ref } : { pos: endPos };
      const out = this.ed.createArc(this.a!, this.b!, end, g.sweep > 0, { radius: this.raw('radius'), construction, noAuto });
      if (this.report(out)) {
        this.reset();
        if (out.arcId) this.ed.select([out.arcId]);
      }
      return;
    }
    const apex = this.apex(p);
    if (!apex) {
      this.ed.toast('Der Radius ist kleiner als der halbe Abstand der Endpunkte.', 'error');
      return;
    }
    const out = this.ed.createArc3(this.a!, this.b!, apex, { radius: this.raw('radius'), construction, noAuto });
    if (this.report(out)) {
      this.reset();
      if (out.arcId) this.ed.select([out.arcId]);
    }
  }

  pointerMove(p: ToolPointer): void {
    this.track(p);
    this.last = p;
    if (this.mode === 'center' && this.a && this.b) {
      const c = this.a.pos;
      const ang = Math.atan2(p.world.y - c.y, p.world.x - c.x);
      if (this.prevAng !== null) {
        let d = ang - this.prevAng;
        while (d > Math.PI) d -= TAU;
        while (d < -Math.PI) d += TAU;
        this.swept = Math.max(-TAU + 1e-6, Math.min(TAU - 1e-6, this.swept + d));
      }
      this.prevAng = ang;
    }
    if (this.a) this.updateInput(p);
  }

  private updateInput(p: ToolPointer): void {
    const at = { x: p.screen.x + 18, y: p.screen.y + 18 };
    if (this.mode === 'center') {
      if (!this.b) {
        this.ctx.setDynamicInput({ at, fields: [{ key: 'radius', label: 'R', unit: 'mm', live: formatNumber(dist(this.a!.pos, p.snap.pos), 2) }] });
        return;
      }
      const g = this.centerGeom(p);
      this.ctx.setDynamicInput({
        at,
        fields: [
          { key: 'radius', label: 'R', unit: 'mm', live: formatNumber(g.r, 2) },
          { key: 'angle', label: 'Winkel', unit: '°', live: formatNumber(Math.abs(toDeg(g.sweep)), 1) },
        ],
      });
      return;
    }
    if (!this.b) {
      this.ctx.setDynamicInput(null);
      return;
    }
    const apex = this.apex(p);
    const c = apex ? circleThrough3(this.a!.pos, apex, this.b.pos) : null;
    this.ctx.setDynamicInput({ at, fields: [{ key: 'radius', label: 'R', unit: 'mm', live: c ? formatNumber(c.r, 2) : '–' }] });
  }

  inputChanged(): void {
    if (this.last && this.a) this.updateInput(this.last);
    this.ctx.requestRender();
  }

  submitInput(): void {
    if (!this.last || !this.a) return;
    if (!this.b) {
      // Radius im Mittelpunktmodus bestätigt: Startpunkt in Mausrichtung setzen
      if (this.mode === 'center' && this.value('radius') !== null) this.pointerDown({ ...this.last, button: 0 });
      return;
    }
    this.commit(this.last);
  }

  cancel(): boolean {
    if (this.a) {
      this.reset();
      return true;
    }
    return false;
  }

  private reset(): void {
    this.a = null;
    this.b = null;
    this.swept = 0;
    this.prevAng = null;
    this.ctx.setDynamicInput(null);
    this.ctx.clearDynamicValues();
    this.ctx.requestRender();
  }

  deactivate(): void {
    this.reset();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const p = this.last;
    if (this.a && p) {
      ctx.save();
      this.previewStyle(ctx);
      if (this.mode === 'center') {
        const c = this.a.pos;
        if (!this.b) {
          strokePoly(ctx, vp, [c, p.snap.pos], false);
        } else {
          const g = this.centerGeom(p);
          strokeArc(ctx, vp, c, g.r, g.a0, g.sweep);
          ctx.globalAlpha = 0.5;
          strokePoly(ctx, vp, [this.b.pos, c, add(c, mul({ x: Math.cos(g.a0 + g.sweep), y: Math.sin(g.a0 + g.sweep) }, g.r))], false);
        }
      } else if (!this.b) {
        strokePoly(ctx, vp, [this.a.pos, p.snap.pos], false);
      } else {
        const apex = this.apex(p);
        const c = apex ? circleThrough3(this.a.pos, apex, this.b.pos) : null;
        if (c) {
          const a0 = Math.atan2(this.a.pos.y - c.c.y, this.a.pos.x - c.c.x);
          let a1 = Math.atan2(this.b.pos.y - c.c.y, this.b.pos.x - c.c.x);
          if (c.ccw) while (a1 <= a0) a1 += TAU;
          else while (a1 >= a0) a1 -= TAU;
          strokeArc(ctx, vp, c.c, c.r, a0, a1 - a0);
        } else strokePoly(ctx, vp, [this.a.pos, this.b.pos], false);
      }
      ctx.restore();
    }
    this.drawSnap(ctx, vp);
  }
}

// ---------------------------------------------------------------------------
// Ellipse
// ---------------------------------------------------------------------------

export class EllipseTool extends DrawToolBase implements Tool {
  readonly id = 'ellipse' as const;
  readonly snaps = true;
  private center: PlacedPoint | null = null;
  private last: ToolPointer | null = null;

  hint(): string {
    if (!this.center) return 'Mittelpunkt wählen';
    return 'Ecke des umschließenden Rechtecks wählen · Breite eintippen, Tab → Höhe, Enter übernimmt';
  }

  private radii(p: ToolPointer): { rx: number; ry: number } {
    const c = this.center!.pos;
    const W = this.value('width');
    const H = this.value('height');
    return { rx: W !== null ? W / 2 : Math.abs(p.snap.pos.x - c.x), ry: H !== null ? H / 2 : Math.abs(p.snap.pos.y - c.y) };
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
    const { rx, ry } = this.radii(p);
    const out = this.ed.createEllipse(this.center!, rx, ry, { width: this.raw('width'), height: this.raw('height'), noAuto: this.noAuto });
    if (this.report(out)) {
      this.reset();
      if (out.shapeId) this.ed.select([out.shapeId]);
    }
  }

  pointerMove(p: ToolPointer): void {
    this.track(p);
    this.last = p;
    if (this.center) this.updateInput(p);
  }

  private updateInput(p: ToolPointer): void {
    const { rx, ry } = this.radii(p);
    this.ctx.setDynamicInput({
      at: { x: p.screen.x + 18, y: p.screen.y + 18 },
      fields: [
        { key: 'width', label: 'Breite', unit: 'mm', live: formatNumber(rx * 2, 2) },
        { key: 'height', label: 'Höhe', unit: 'mm', live: formatNumber(ry * 2, 2) },
      ],
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
      const { rx, ry } = this.radii(this.last);
      const c = toScreen(vp, this.center.pos);
      ctx.save();
      this.previewStyle(ctx);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, Math.max(0.5, rx * vp.zoom), Math.max(0.5, ry * vp.zoom), 0, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.strokeRect(c.x - rx * vp.zoom, c.y - ry * vp.zoom, 2 * rx * vp.zoom, 2 * ry * vp.zoom);
      ctx.restore();
    }
    this.drawSnap(ctx, vp);
  }
}

// ---------------------------------------------------------------------------
// Vieleck und Stern
// ---------------------------------------------------------------------------

abstract class RadialTool extends DrawToolBase {
  protected center: PlacedPoint | null = null;
  protected last: ToolPointer | null = null;

  protected abstract countKey: string;
  protected abstract count(): number;
  protected abstract setCount(n: number): void;

  /** Lage des Bezugspunkts (Ecke/Spitze) aus Maus oder eingetipptem Durchmesser. */
  protected ref(p: ToolPointer): Vec2 {
    const c = this.center!.pos;
    const D = this.value('diameter');
    const pos = p.snap.pos;
    if (D === null) return pos;
    const d = dist(pos, c) > 1e-9 ? norm(sub(pos, c)) : { x: 0, y: 1 };
    return add(c, mul(d, D / 2));
  }

  protected typedCount(): number {
    const n = this.value(this.countKey);
    if (n !== null && n >= 3 && n <= 64) return Math.round(n);
    return this.count();
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
    this.commitAt(p);
  }

  protected abstract commitAt(p: ToolPointer): void;
  protected abstract updateInput(p: ToolPointer): void;

  pointerMove(p: ToolPointer): void {
    this.track(p);
    this.last = p;
    if (this.center) this.updateInput(p);
  }

  inputChanged(): void {
    if (this.center && this.last) this.updateInput(this.last);
    this.ctx.requestRender();
  }

  submitInput(): void {
    if (this.center && this.last) this.commitAt(this.last);
  }

  cancel(): boolean {
    if (this.center) {
      this.reset();
      return true;
    }
    return false;
  }

  protected reset(): void {
    this.center = null;
    this.ctx.setDynamicInput(null);
    this.ctx.clearDynamicValues();
    this.ctx.requestRender();
  }

  deactivate(): void {
    this.reset();
  }

  protected remember(): void {
    const n = this.value(this.countKey);
    if (n !== null && n >= 3 && n <= 64) this.setCount(Math.round(n));
  }
}

export function polygonPoints(c: Vec2, ref: Vec2, n: number, mode: 'circumscribed' | 'inscribed'): Vec2[] {
  const rr = dist(c, ref);
  const a0 = Math.atan2(ref.y - c.y, ref.x - c.x);
  const R = mode === 'inscribed' ? rr / Math.cos(Math.PI / n) : rr;
  const start = mode === 'inscribed' ? a0 - Math.PI / n : a0;
  return Array.from({ length: n }, (_, i) => ({ x: c.x + R * Math.cos(start + (TAU * i) / n), y: c.y + R * Math.sin(start + (TAU * i) / n) }));
}

export class PolygonTool extends RadialTool implements Tool {
  readonly id = 'polygon' as const;
  readonly snaps = true;
  protected countKey = 'sides';
  protected count() {
    return this.ed.s.polygonSides;
  }
  protected setCount(n: number) {
    this.ed.store.setState({ polygonSides: n });
  }

  hint(): string {
    const mode = this.ed.s.polygonMode === 'inscribed' ? 'Kantenmitte' : 'Ecke';
    if (!this.center) return 'Mittelpunkt wählen · Umkreis/Inkreis im Werkzeugmenü';
    return `${mode} wählen · Eckenzahl eintippen, Tab → Durchmesser, Enter übernimmt`;
  }

  protected commitAt(p: ToolPointer): void {
    this.remember();
    const out = this.ed.createPolygon(this.center!, this.ref(p), this.typedCount(), this.ed.s.polygonMode, { diameter: this.raw('diameter'), noAuto: this.noAuto });
    if (this.report(out)) {
      this.reset();
      if (out.pathId) this.ed.select([out.pathId]);
    }
  }

  protected updateInput(p: ToolPointer): void {
    this.ctx.setDynamicInput({
      at: { x: p.screen.x + 18, y: p.screen.y + 18 },
      fields: [
        { key: 'sides', label: 'Ecken', unit: '', live: String(this.typedCount()) },
        { key: 'diameter', label: 'Ø', unit: 'mm', live: formatNumber(dist(this.center!.pos, this.ref(p)) * 2, 2) },
      ],
    });
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (this.center && this.last) {
      const c = this.center.pos;
      const ref = this.ref(this.last);
      ctx.save();
      this.previewStyle(ctx);
      strokePoly(ctx, vp, polygonPoints(c, ref, this.typedCount(), this.ed.s.polygonMode), true);
      ctx.globalAlpha = 0.35;
      strokeArc(ctx, vp, c, dist(c, ref), 0, TAU);
      ctx.restore();
    }
    this.drawSnap(ctx, vp);
  }
}

export function starPoints(c: Vec2, tip: Vec2, n: number, ratio: number): Vec2[] {
  const R = dist(c, tip);
  const a0 = Math.atan2(tip.y - c.y, tip.x - c.x);
  return Array.from({ length: 2 * n }, (_, i) => {
    const r = i % 2 === 0 ? R : R * ratio;
    const a = a0 + (Math.PI * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

export class StarTool extends RadialTool implements Tool {
  readonly id = 'star' as const;
  readonly snaps = true;
  protected countKey = 'points';
  protected count() {
    return this.ed.s.starPoints;
  }
  protected setCount(n: number) {
    this.ed.store.setState({ starPoints: n });
  }

  hint(): string {
    if (!this.center) return 'Mittelpunkt wählen';
    return 'Spitze wählen · Zacken, Ø außen und Ø innen eintippen (Tab wechselt), Enter übernimmt';
  }

  private ratio(p: ToolPointer): number {
    const inner = this.value('inner');
    const R = dist(this.center!.pos, this.ref(p));
    if (inner !== null && R > 1e-9) return Math.min(0.95, Math.max(0.05, inner / 2 / R));
    return this.ed.s.starRatio;
  }

  protected commitAt(p: ToolPointer): void {
    this.remember();
    const ratio = this.ratio(p);
    if (this.value('inner') !== null) this.ed.store.setState({ starRatio: ratio });
    const out = this.ed.createStar(this.center!, this.ref(p), this.typedCount(), ratio, { diameter: this.raw('diameter'), innerDiameter: this.raw('inner'), noAuto: this.noAuto });
    if (this.report(out)) {
      this.reset();
      if (out.pathId) this.ed.select([out.pathId]);
    }
  }

  protected updateInput(p: ToolPointer): void {
    const R = dist(this.center!.pos, this.ref(p));
    this.ctx.setDynamicInput({
      at: { x: p.screen.x + 18, y: p.screen.y + 18 },
      fields: [
        { key: 'points', label: 'Zacken', unit: '', live: String(this.typedCount()) },
        { key: 'diameter', label: 'Ø außen', unit: 'mm', live: formatNumber(R * 2, 2) },
        { key: 'inner', label: 'Ø innen', unit: 'mm', live: formatNumber(R * 2 * this.ratio(p), 2) },
      ],
    });
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (this.center && this.last) {
      ctx.save();
      this.previewStyle(ctx);
      strokePoly(ctx, vp, starPoints(this.center.pos, this.ref(this.last), this.typedCount(), this.ratio(this.last)), true);
      ctx.restore();
    }
    this.drawSnap(ctx, vp);
  }
}

// ---------------------------------------------------------------------------
// Zeichenstift (Bézierpfad)
// ---------------------------------------------------------------------------

export class PenTool extends DrawToolBase implements Tool {
  readonly id = 'pen' as const;
  readonly snaps = true;
  private nodes: ShapeNode[] = [];
  private dragging = false;
  private downAt: Vec2 | null = null;
  private last: ToolPointer | null = null;
  private closing = false;

  hint(): string {
    if (!this.nodes.length) return 'Klicken setzt eine Ecke, Ziehen eine Kurve · Enter beendet, Klick auf den Start schließt';
    return 'Weiter: Klick = Ecke, Ziehen = Kurve · Klick auf den ersten Punkt schließt · Enter beendet offen · Rücktaste löscht den letzten Punkt · Esc verwirft';
  }

  private nearFirst(p: ToolPointer, vp: Viewport): boolean {
    if (this.nodes.length < 2) return false;
    return dist(toScreen(vp, this.nodes[0]), p.screen) < 9;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.track(p);
    this.last = p;
    if (this.nearFirst(p, this.ctx.vp())) {
      this.closing = true;
      this.dragging = true;
      this.downAt = { x: this.nodes[0].x, y: this.nodes[0].y };
      return;
    }
    const pos = p.snap.pos;
    this.nodes.push({ x: pos.x, y: pos.y });
    this.dragging = true;
    this.downAt = pos;
    this.ctx.requestRender();
  }

  pointerMove(p: ToolPointer): void {
    this.track(p);
    this.last = p;
    if (!this.dragging || !this.downAt) return;
    // Ziehen: Griffe symmetrisch um den Knoten
    const node = this.closing ? this.nodes[0] : this.nodes[this.nodes.length - 1];
    const w = p.world;
    if (dist(toScreen(this.ctx.vp(), w), toScreen(this.ctx.vp(), this.downAt)) < 3) return;
    node.ox = w.x;
    node.oy = w.y;
    node.ix = 2 * node.x - w.x;
    node.iy = 2 * node.y - w.y;
    this.ctx.requestRender();
  }

  pointerUp(p: ToolPointer): void {
    this.last = p;
    this.dragging = false;
    this.downAt = null;
    if (this.closing) {
      this.closing = false;
      this.finishPath(true);
    }
  }

  doubleClick(): void {
    // Doppelklick: der zweite Klick hat einen doppelten Knoten erzeugt
    if (this.nodes.length >= 2) {
      const a = this.nodes[this.nodes.length - 1];
      const b = this.nodes[this.nodes.length - 2];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) this.nodes.pop();
    }
    this.finishPath(false);
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key === 'Enter') {
      this.finishPath(false);
      return true;
    }
    if (e.key === 'Backspace' && this.nodes.length) {
      this.nodes.pop();
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  finish(): void {
    this.finishPath(false);
  }

  private finishPath(closed: boolean): void {
    const nodes = this.nodes.filter((n, i, arr) => i === 0 || Math.hypot(n.x - arr[i - 1].x, n.y - arr[i - 1].y) > 1e-6 || n.ox !== undefined);
    this.nodes = [];
    this.ctx.requestRender();
    if (nodes.length < 2) return;
    const out = this.ed.createBezier(nodes, closed && nodes.length >= 3);
    if (this.report(out) && out.shapeId) this.ed.select([out.shapeId]);
  }

  cancel(): boolean {
    if (this.nodes.length) {
      this.nodes = [];
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  deactivate(): void {
    if (this.nodes.length >= 2) this.finishPath(false);
    this.nodes = [];
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const T = (q: Vec2) => toScreen(vp, q);
    if (this.nodes.length) {
      ctx.save();
      ctx.strokeStyle = THEME.preview;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const s0 = T(this.nodes[0]);
      ctx.moveTo(s0.x, s0.y);
      const seg = (a: ShapeNode, b: { x: number; y: number; ix?: number; iy?: number }) => {
        const p1 = T({ x: a.ox ?? a.x, y: a.oy ?? a.y });
        const p2 = T({ x: b.ix ?? b.x, y: b.iy ?? b.y });
        const p3 = T(b);
        ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
      };
      for (let i = 1; i < this.nodes.length; i++) seg(this.nodes[i - 1], this.nodes[i]);
      ctx.stroke();
      // Gummiband zur Maus
      if (this.last && !this.dragging) {
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const lastN = this.nodes[this.nodes.length - 1];
        const ls = T(lastN);
        ctx.moveTo(ls.x, ls.y);
        seg(lastN, this.last.snap.pos);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Knoten und Griffe
      for (const [i, n] of this.nodes.entries()) {
        const s = T(n);
        if (n.ox !== undefined && n.ix !== undefined) {
          const a = T({ x: n.ix, y: n.iy! });
          const b = T({ x: n.ox, y: n.oy! });
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
          for (const h of [a, b]) {
            ctx.beginPath();
            ctx.arc(h.x, h.y, 3, 0, TAU);
            ctx.fillStyle = THEME.preview;
            ctx.fill();
          }
        }
        ctx.fillStyle = i === 0 && this.last && this.nearFirst(this.last, vp) ? THEME.snap : '#ffffff';
        ctx.strokeStyle = THEME.preview;
        ctx.fillRect(s.x - 3.5, s.y - 3.5, 7, 7);
        ctx.strokeRect(s.x - 3.5, s.y - 3.5, 7, 7);
      }
      ctx.restore();
    }
    this.drawSnap(ctx, vp);
  }
}
