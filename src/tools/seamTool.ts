import type { EdgeRef } from '../model/types';
import { toScreen, type Viewport } from '../render/viewport';
import { THEME } from '../render/theme';
import { edgeOf, nearestEdge, pieceById, pieceLabel, sameEdge, seamsAt } from '../pattern/geometry';
import { addSeam } from '../store/patternOps';
import type { Tool, ToolContext, ToolPointer } from './types';

/**
 * Naht verbinden: erste Kante anklicken, dann die zweite. Bei gegengleichen Teilen (2×) wird automatisch
 * die noch freie Kopie genommen. Bleibt aktiv für weitere Nähte, Esc beendet.
 */
export class SeamTool implements Tool {
  readonly id = 'seam' as const;
  readonly snaps = false;
  readonly cssCursor = 'crosshair';
  private first: EdgeRef | null = null;
  private hover: EdgeRef | null = null;

  constructor(private ctx: ToolContext) {}

  activate(): void {
    const ed = this.ctx.editor;
    if (!ed.s.doc.pattern?.pieces.length) {
      ed.toast('Zuerst Schnittteile anlegen (Tab „Schnitt“).', 'info', 4000);
      queueMicrotask(() => this.ctx.setTool('select'));
    }
  }

  hint(): string {
    if (this.first) return `Naht: zweite Kante anklicken (erste: ${pieceLabel(this.ctx.editor.s.doc, this.first)}) · Esc bricht ab`;
    return 'Naht verbinden: erste Kante eines Schnittteils anklicken · Esc beendet';
  }

  /** Kante unter dem Zeiger; bei 2×-Teilen die erste noch freie Kopie. */
  private pick(p: ToolPointer): EdgeRef | null {
    const doc = this.ctx.editor.s.doc;
    const tol = 9 / this.ctx.vp().zoom;
    const hit = nearestEdge(doc, p.world, tol);
    if (!hit) return null;
    const piece = pieceById(doc, hit.piece);
    const ref: EdgeRef = { piece: hit.piece, edge: hit.edge };
    const pat = doc.pattern!;
    const used = (copy: 0 | 1) => seamsAt(pat, { ...ref, copy }, false).some((s) => [s.a, s.b].some((r) => sameEdge(r, { ...ref, copy })));
    if (piece?.cut === 2) {
      // Bei Nähten innerhalb desselben Teils (Ärmelnaht) bleibt die Kopie der ersten Kante
      if (this.first && this.first.piece === ref.piece) return { ...ref, ...(this.first.copy ? { copy: 1 as const } : {}) };
      if (used(0) && !used(1)) return { ...ref, copy: 1 };
    }
    return ref;
  }

  pointerMove(p: ToolPointer): void {
    const h = this.pick(p);
    const changed = (h && !this.hover) || (!h && this.hover) || (h && this.hover && !sameEdge(h, this.hover));
    this.hover = h;
    if (changed) this.ctx.requestRender();
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const ed = this.ctx.editor;
    const ref = this.pick(p);
    if (!ref) {
      if (!this.first) ed.toast('Keine Schnittteil-Kante getroffen – näher an die Kontur klicken.', 'info', 2500);
      return;
    }
    if (!this.first) {
      const busy = seamsAt(ed.s.doc.pattern!, ref, false).find((s) => [s.a, s.b].some((r) => sameEdge(r, ref)));
      if (busy) {
        ed.toast(`Diese Kante ist schon vernäht (${busy.name ?? 'Naht'}).`, 'info', 3000);
        return;
      }
      this.first = ref;
      this.ctx.requestRender();
      return;
    }
    if (sameEdge(this.first, ref)) {
      this.first = null;
      this.ctx.requestRender();
      return;
    }
    const a = this.first;
    this.first = null;
    const out = addSeam(ed, a, ref);
    if (!out.ok) ed.toast(out.message ?? 'Naht nicht möglich', 'error');
    else {
      const la = edgeOf(ed.s.doc, a)?.length ?? 0;
      const lb = edgeOf(ed.s.doc, ref)?.length ?? 0;
      const d = Math.abs(la - lb);
      ed.toast(d > 2 ? `Naht verbunden – Kanten unterscheiden sich um ${d.toFixed(1).replace('.', ',')} mm` : 'Naht verbunden', d > 2 ? 'info' : 'success', 3000);
    }
    this.ctx.requestRender();
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
    this.hover = null;
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const doc = this.ctx.editor.s.doc;
    const draw = (ref: EdgeRef, color: string, width: number) => {
      const e = edgeOf(doc, ref);
      if (!e) return;
      ctx.beginPath();
      e.pts.forEach((p, i) => {
        const s = toScreen(vp, p);
        if (i) ctx.lineTo(s.x, s.y);
        else ctx.moveTo(s.x, s.y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.stroke();
      // Laufrichtung andeuten: Punkt am Anfang
      const s0 = toScreen(vp, e.pts[0]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s0.x, s0.y, width + 1.5, 0, Math.PI * 2);
      ctx.fill();
    };
    if (this.first) draw(this.first, THEME.selected, 5);
    if (this.hover && !(this.first && sameEdge(this.first, this.hover))) draw(this.hover, THEME.free, 4);
  }
}
