import type { Dimension, Id, SketchDoc, Vec2 } from '../model/types';
import { circleOf, entityOf, lineOf, pt } from '../model/doc';
import { contoursBBox, shapeWorldContours } from '../model/shape';
import { measureDim } from '../model/measure';
import { cross, dist, dot, lineIntersection, norm, normAngle2pi, sub, toDeg } from '../model/geometry';
import { dimGeometry } from '../render/dimGeometry';
import { THEME } from '../render/theme';
import { toScreen, type Viewport } from '../render/viewport';
import type { DimensionSpec } from '../store/editor';
import { hitTest, type Hit } from './hit';
import type { Tool, ToolContext, ToolPointer } from './types';

type Pick = { kind: 'point' | 'line' | 'circle' | 'shape'; id: Id };

/**
 * Bemaßungswerkzeug wie in Inventor: Geometrie wählen, Maß mit der Maus platzieren,
 * Wert eintippen. Die Mausposition bestimmt horizontal/vertikal/ausgerichtet.
 */
export class DimensionTool implements Tool {
  readonly id = 'dimension' as const;
  readonly snaps = false;
  private picks: Pick[] = [];
  private cursor: Vec2 | null = null;
  private hover: Hit | null = null;
  /** Erzwingt ausgerichtet (Kontextmenü) */
  forceAligned = false;

  constructor(private ctx: ToolContext) {}

  private get ed() {
    return this.ctx.editor;
  }

  hint(): string {
    if (!this.picks.length) return 'Linie, Kreis, Punkt oder Form wählen (zwei Elemente für Abstand oder Winkel)';
    return 'Maß platzieren · oder zweites Element wählen · Esc bricht ab';
  }

  private hitPick(p: ToolPointer): Pick | null {
    const doc = this.ed.s.doc;
    const hit = hitTest(doc, this.ctx.vp(), this.ctx.layout(), p.screen, { points: true, curves: true, helperPoints: true, dims: true, fills: true });
    this.hover = hit;
    if (!hit) return null;
    if (hit.kind === 'point') return { kind: 'point', id: hit.id };
    if (hit.kind === 'line') return { kind: 'line', id: hit.id };
    if (hit.kind === 'circle' && hit.dist > 0) return { kind: 'circle', id: hit.id };
    if (hit.kind === 'shape') return { kind: 'shape', id: hit.id };
    return null;
  }

  pointerMove(p: ToolPointer): void {
    this.cursor = p.world;
    const pick = this.hitPick(p);
    const hov = pick?.id ?? (this.hover?.kind === 'dim' ? this.hover.id : null);
    if (hov !== this.ed.s.hover) this.ed.store.setState({ hover: hov });
    this.ctx.requestRender();
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const doc = this.ed.s.doc;
    // Vorhandene Bemaßung anklicken → bearbeiten
    if (!this.picks.length) {
      const h = hitTest(doc, this.ctx.vp(), this.ctx.layout(), p.screen, { dims: true });
      if (h?.kind === 'dim') {
        if (!doc.dims[h.id]?.driven) this.ctx.openDimEditor(h.id, false);
        return;
      }
    }
    const pick = this.hitPick(p);
    if (pick && !this.picks.some((x) => x.id === pick.id) && this.picks.length < 2 && this.combinable([...this.picks, pick])) {
      this.picks.push(pick);
      this.ed.select(this.picks.map((x) => x.id));
      this.ctx.requestRender();
      return;
    }
    if (this.picks.length) this.place(p.world);
  }

  private combinable(picks: Pick[]): boolean {
    if (picks.length === 1) return true;
    const [a, b] = picks;
    if (a.kind === 'shape' || b.kind === 'shape') return false;
    if (a.kind === 'point' || b.kind === 'point') return true;
    if (a.kind === 'line' && b.kind === 'line') return true;
    if (a.kind === 'circle' && b.kind === 'circle') return true;
    if ((a.kind === 'line' && b.kind === 'circle') || (a.kind === 'circle' && b.kind === 'line')) return true;
    return false;
  }

  private place(w: Vec2): void {
    const spec = specFromPicks(this.ed.s.doc, this.picks, w, 1 / this.ctx.vp().zoom, this.forceAligned);
    this.picks = [];
    this.forceAligned = false;
    this.ed.select([]);
    if (!spec) {
      this.ed.toast('Diese Auswahl lässt sich nicht bemaßen.', 'error');
      return;
    }
    const out = this.ed.addDimension(spec);
    if (out.ok && out.dimId) {
      this.ctx.openDimEditor(out.dimId, true);
      return;
    }
    if (!out.ok && out.reason === 'over') {
      this.ed.confirm({
        title: 'Skizze würde überbestimmt',
        text: 'Diese Bemaßung würde die Skizze überbestimmen. Stattdessen eine getriebene Bemaßung (Referenzmaß in Klammern) anlegen?',
        confirm: 'Getrieben anlegen',
        cancel: 'Abbrechen',
        onConfirm: () => {
          const r = this.ed.addDimension(spec, { driven: true });
          if (!r.ok) this.ed.toast(r.message, 'error');
        },
      });
      return;
    }
    if (!out.ok) this.ed.toast(out.message, 'error');
  }

  cancel(): boolean {
    if (this.picks.length) {
      this.picks = [];
      this.ed.select([]);
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.picks = [];
    this.ed.store.setState({ hover: null });
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    if (!this.picks.length || !this.cursor) return;
    const doc = this.ed.s.doc;
    const spec = specFromPicks(doc, this.picks, this.cursor, 1 / vp.zoom, this.forceAligned);
    if (!spec) return;
    const value = Math.abs(measureDim(doc, spec));
    const fake: Dimension = {
      id: '__preview',
      name: '',
      kind: spec.kind,
      refs: spec.refs,
      expr: '',
      value,
      driven: false,
      offset: spec.offset ?? 0,
      shift: spec.shift ?? 0,
      angle: spec.angle,
    };
    const g = dimGeometry(doc, fake, 1 / vp.zoom);
    if (!g) return;
    ctx.save();
    ctx.strokeStyle = THEME.preview;
    ctx.fillStyle = THEME.preview;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [a, b] of g.lines) {
      const sa = toScreen(vp, a);
      const sb = toScreen(vp, b);
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
    }
    for (const arc of g.arcs) {
      const c = toScreen(vp, arc.c);
      ctx.moveTo(c.x + Math.cos(-arc.a0) * arc.r * vp.zoom, c.y + Math.sin(-arc.a0) * arc.r * vp.zoom);
      ctx.arc(c.x, c.y, arc.r * vp.zoom, -arc.a0, -arc.a1, true);
    }
    ctx.stroke();
    const tp = toScreen(vp, g.text);
    ctx.font = `600 12px ${THEME.uiFont}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(g.label).width + 10;
    ctx.fillStyle = THEME.tag;
    ctx.fillRect(tp.x - w / 2, tp.y - 9, w, 18);
    ctx.fillStyle = THEME.tagInk;
    ctx.fillText(g.label, tp.x, tp.y + 0.5);
    ctx.restore();
  }
}

/** Ermittelt Art und Platzierung einer Bemaßung aus Auswahl und Mausposition. */
export function specFromPicks(doc: SketchDoc, picks: Pick[], cursor: Vec2, px: number, forceAligned = false): DimensionSpec | null {
  if (picks.length === 1) {
    const a = picks[0];
    if (a.kind === 'circle') {
      const c = circleOf(doc, a.id);
      if (!c) return null;
      const C = pt(doc, c.center);
      return {
        kind: 'diameter',
        refs: [a.id],
        angle: Math.atan2(cursor.y - C.y, cursor.x - C.x),
        offset: Math.max(0, dist(cursor, C) - c.r - 14 * px),
      };
    }
    if (a.kind === 'line') {
      const l = lineOf(doc, a.id);
      if (!l) return null;
      return linearSpec(doc, l.p1, l.p2, cursor, forceAligned);
    }
    if (a.kind === 'shape') {
      // Freie Form: Breite (Maß oberhalb/unterhalb) oder Höhe (Maß seitlich)
      const sh = entityOf(doc, a.id, 'shape');
      const b = sh ? contoursBBox(shapeWorldContours(doc, sh)) : null;
      if (!b) return null;
      const side = cursor.x > b.maxX || cursor.x < b.minX;
      const above = cursor.y > b.maxY || cursor.y < b.minY;
      if (side && !above) return { kind: 'height', refs: [a.id], offset: cursor.x - b.maxX };
      return { kind: 'width', refs: [a.id], offset: cursor.y - b.maxY };
    }
    return null;
  }
  const [a, b] = picks;
  const centerOf = (p: Pick) => (p.kind === 'circle' ? circleOf(doc, p.id)!.center : p.id);
  if (a.kind !== 'line' && b.kind !== 'line') {
    return linearSpec(doc, centerOf(a), centerOf(b), cursor, forceAligned);
  }
  if (a.kind === 'line' && b.kind === 'line') {
    const la = lineOf(doc, a.id)!;
    const lb = lineOf(doc, b.id)!;
    const ua = norm(sub(pt(doc, la.p2), pt(doc, la.p1)));
    const ub = norm(sub(pt(doc, lb.p2), pt(doc, lb.p1)));
    if (Math.abs(cross(ua, ub)) < Math.sin((0.5 * Math.PI) / 180)) {
      // wie in dimGeometry: Mitte von B auf A projiziert, Maßlinie senkrecht zu den Linien
      const mb = midOfLine(doc, lb.id);
      const A = pt(doc, la.p1);
      const foot = { x: A.x + ua.x * dot(sub(mb, A), ua), y: A.y + ua.y * dot(sub(mb, A), ua) };
      const u = dist(mb, foot) < 1e-9 ? { x: -ua.y, y: ua.x } : norm(sub(mb, foot));
      const n = { x: -u.y, y: u.x };
      return { kind: 'lineLine', refs: [a.id, b.id], offset: dot(sub(cursor, foot), n) };
    }
    return angleSpec(doc, la.p1, la.p2, lb.p1, lb.p2, cursor);
  }
  // Punkt/Kreis und Linie → senkrechter Abstand
  const line = a.kind === 'line' ? a : b;
  const other = a.kind === 'line' ? b : a;
  const l = lineOf(doc, line.id)!;
  const P = pt(doc, centerOf(other));
  const A = pt(doc, l.p1);
  const u = norm(sub(pt(doc, l.p2), A));
  // Maßlinie verläuft senkrecht zur Linie; Verschiebung entlang der Linie
  const foot = { x: A.x + u.x * dot(sub(P, A), u), y: A.y + u.y * dot(sub(P, A), u) };
  const dir = norm(sub(P, foot));
  const n = { x: -dir.y, y: dir.x };
  return { kind: 'pointLine', refs: [centerOf(other), line.id], offset: dot(sub(cursor, foot), n) };
}

function midOfLine(doc: SketchDoc, id: Id): Vec2 {
  const l = lineOf(doc, id)!;
  const a = pt(doc, l.p1);
  const b = pt(doc, l.p2);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Linearer Abstand zweier Punkte: horizontal, vertikal oder ausgerichtet je nach Mausposition. */
export function linearSpec(doc: SketchDoc, ia: Id, ib: Id, cursor: Vec2, forceAligned = false): DimensionSpec {
  const A = pt(doc, ia);
  const B = pt(doc, ib);
  const dx = Math.abs(B.x - A.x);
  const dy = Math.abs(B.y - A.y);
  const minX = Math.min(A.x, B.x);
  const maxX = Math.max(A.x, B.x);
  const minY = Math.min(A.y, B.y);
  const maxY = Math.max(A.y, B.y);
  let kind: 'distance' | 'distanceX' | 'distanceY';
  if (forceAligned) kind = 'distance';
  else if (dy < 1e-6) kind = 'distanceX';
  else if (dx < 1e-6) kind = 'distanceY';
  else {
    const outY = cursor.y > maxY || cursor.y < minY;
    const outX = cursor.x > maxX || cursor.x < minX;
    if (outY && !outX) kind = 'distanceX';
    else if (outX && !outY) kind = 'distanceY';
    else kind = 'distance';
  }
  if (kind === 'distanceX') {
    const [a, b] = B.x >= A.x ? [ia, ib] : [ib, ia];
    return { kind, refs: [a, b], offset: cursor.y - pt(doc, a).y };
  }
  if (kind === 'distanceY') {
    const [a, b] = B.y >= A.y ? [ia, ib] : [ib, ia];
    return { kind, refs: [a, b], offset: cursor.x - pt(doc, a).x };
  }
  const u = norm(sub(B, A));
  const n = { x: -u.y, y: u.x };
  return { kind, refs: [ia, ib], offset: dot(sub(cursor, A), n) };
}

/** Winkel zwischen zwei Linien; der Sektor unter der Maus wird bemaßt. */
export function angleSpec(doc: SketchDoc, a1: Id, a2: Id, b1: Id, b2: Id, cursor: Vec2): DimensionSpec | null {
  const A1 = pt(doc, a1);
  const A2 = pt(doc, a2);
  const B1 = pt(doc, b1);
  const B2 = pt(doc, b2);
  const V = lineIntersection(A1, A2, B1, B2);
  if (!V) return null;
  const ua = norm(sub(A2, A1));
  const ub = norm(sub(B2, B1));
  const tc = Math.atan2(cursor.y - V.y, cursor.x - V.x);
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      const u = { x: ua.x * sa, y: ua.y * sa };
      const w = { x: ub.x * sb, y: ub.y * sb };
      const start = Math.atan2(u.y, u.x);
      const sweep = normAngle2pi(Math.atan2(w.y, w.x) - start);
      if (sweep <= 1e-6 || sweep >= Math.PI) continue;
      const rel = normAngle2pi(tc - start);
      if (rel <= sweep) {
        const ra = sa > 0 ? [a1, a2] : [a2, a1];
        const rb = sb > 0 ? [b1, b2] : [b2, b1];
        void toDeg;
        return { kind: 'angle', refs: [...ra, ...rb], offset: dist(cursor, V) };
      }
    }
  }
  return null;
}
