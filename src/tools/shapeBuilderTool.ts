import type { Id, Vec2 } from '../model/types';
import { regionAt, type BuilderRegion } from '../model/shapeBuilder';
import { builderSources, shapeBuildOp, textToPaths } from '../store/ops';
import { drawableTargets } from '../store/editor';
import { THEME } from '../render/theme';
import { toScreen, type Viewport } from '../render/viewport';
import type { Tool, ToolContext, ToolPointer } from './types';

interface Sources {
  ids: Id[];
  areas: Vec2[][][];
  regions: BuilderRegion[];
}

/**
 * Formgenerator (Umschalt+M, wie in Illustrator): überlappende Formen auswählen, dann
 * – über Teilflächen ziehen → zu einer Form vereinigen,
 * – mit Alt klicken/ziehen → Teilflächen entfernen.
 * Bleibt aktiv; Esc beendet.
 */
export class ShapeBuilderTool implements Tool {
  readonly id = 'shapebuilder' as const;
  readonly snaps = false;
  readonly cssCursor = 'crosshair';
  private src: Sources | null = null;
  private hover = -1;
  private picked: number[] = [];
  private dragging = false;
  private alt = false;
  private last: Vec2 | null = null;
  private busy = false;

  constructor(private ctx: ToolContext) {}

  private get ed() {
    return this.ctx.editor;
  }

  activate(): void {
    void this.prepare();
  }

  /** Ausgangsformen bestimmen; Texte vorher in Pfade umwandeln. */
  private async prepare(): Promise<void> {
    const ed = this.ed;
    const sel = drawableTargets(ed.s.doc, ed.s.selection);
    const texts = sel.filter((id) => ed.s.doc.entities[id]?.kind === 'text');
    if (texts.length) {
      this.busy = true;
      const t = await textToPaths(ed, texts);
      this.busy = false;
      if (!t.ok) {
        ed.toast(t.message, 'error');
        return;
      }
    }
    this.refresh(ed.s.selection);
    const src = this.src as Sources | null;
    if (!src || src.ids.length < 1 || src.regions.length < 2) {
      ed.toast('Formgenerator: zuerst mindestens zwei sich überlappende Flächen auswählen.', 'info', 5000);
      queueMicrotask(() => this.ctx.setTool('select'));
    }
  }

  private refresh(ids: Id[]): void {
    this.src = builderSources(this.ed.s.doc, ids);
    this.hover = -1;
    this.picked = [];
    this.ed.select(this.src.ids);
    this.ctx.requestRender();
  }

  hint(): string {
    return 'Formgenerator: über Teilflächen ziehen = vereinigen · Alt + Klick/Ziehen = entfernen · Esc beendet';
  }

  private regionUnder(p: Vec2): number {
    return this.src ? regionAt(this.src.regions, p) : -1;
  }

  pointerMove(p: ToolPointer): void {
    if (!this.src || this.busy) return;
    if (this.dragging) {
      // Strecke abtasten, damit schnelle Bewegungen keine Teilfläche überspringen
      const from = this.last ?? p.world;
      const step = 3 / this.ctx.vp().zoom;
      const n = Math.max(1, Math.ceil(Math.hypot(p.world.x - from.x, p.world.y - from.y) / step));
      for (let k = 1; k <= n; k++) {
        const q = { x: from.x + ((p.world.x - from.x) * k) / n, y: from.y + ((p.world.y - from.y) * k) / n };
        const r = this.regionUnder(q);
        if (r >= 0 && !this.picked.includes(r)) this.picked.push(r);
      }
      this.last = p.world;
      this.ctx.requestRender();
      return;
    }
    const h = this.regionUnder(p.world);
    if (h !== this.hover || this.alt !== p.alt) {
      this.hover = h;
      this.alt = p.alt;
      this.ctx.requestRender();
    }
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !this.src || this.busy) return;
    this.dragging = true;
    this.alt = p.alt;
    this.last = p.world;
    this.picked = [];
    const r = this.regionUnder(p.world);
    if (r >= 0) this.picked.push(r);
    this.ctx.requestRender();
  }

  pointerUp(p: ToolPointer): void {
    if (!this.dragging || !this.src) return;
    this.dragging = false;
    this.last = null;
    const picked = this.picked;
    this.picked = [];
    if (!picked.length) {
      this.ctx.requestRender();
      return;
    }
    const mode = this.alt || p.alt ? 'delete' : 'merge';
    // Einzelne Teilfläche ohne Überschneidung „vereinigen“ ändert nichts
    if (mode === 'merge' && picked.length === 1 && this.src.regions[picked[0]].owners.length === 1) {
      this.ctx.requestRender();
      return;
    }
    const out = shapeBuildOp(this.ed, this.src, picked, mode);
    if (!out.ok) {
      this.ed.toast(out.message, 'error');
      this.ctx.requestRender();
      return;
    }
    this.refresh(out.ids ?? []);
    if (this.src && this.src.regions.length < 2) this.ed.toast('Formgenerator: keine Überschneidungen mehr.', 'info', 3000);
  }

  cancel(): boolean {
    if (this.dragging) {
      this.dragging = false;
      this.picked = [];
      this.ctx.requestRender();
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.src = null;
    this.ctx.requestRender();
  }

  drawOverlay(ctx: CanvasRenderingContext2D, vp: Viewport): void {
    const src = this.src;
    if (!src) return;
    const path = (r: BuilderRegion) => {
      ctx.beginPath();
      for (const poly of r.polys) {
        poly.forEach((v, i) => {
          const s = toScreen(vp, v);
          if (i) ctx.lineTo(s.x, s.y);
          else ctx.moveTo(s.x, s.y);
        });
        ctx.closePath();
      }
    };
    ctx.save();
    // alle Teilflächen fein umrissen
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = THEME.free;
    for (const r of src.regions) {
      path(r);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    const del = this.alt;
    const fill = del ? 'rgba(214,69,69,0.32)' : 'rgba(47,111,214,0.28)';
    const edge = del ? THEME.conflict : THEME.free;
    const marked = this.dragging ? this.picked : this.hover >= 0 ? [this.hover] : [];
    for (const i of marked) {
      const r = src.regions[i];
      if (!r) continue;
      path(r);
      ctx.fillStyle = fill;
      ctx.fill('evenodd');
      ctx.lineWidth = 2;
      ctx.strokeStyle = edge;
      ctx.stroke();
    }
    // Ziehspur
    if (this.dragging && this.picked.length > 1) {
      ctx.fillStyle = edge;
      for (const i of this.picked) {
        const r = src.regions[i];
        const c = toScreen(vp, { x: (r.box.minX + r.box.maxX) / 2, y: (r.box.minY + r.box.maxY) / 2 });
        ctx.beginPath();
        ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
