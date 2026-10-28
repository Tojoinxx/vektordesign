import type { Style } from '../model/types';
import { drawableTargets } from '../store/editor';
import { hitTest } from './hit';
import type { Tool, ToolContext, ToolPointer } from './types';

/**
 * Format übertragen: Stil (Füllung, Verlauf, Kontur, Linienart, Deckkraft) des zuerst gewählten
 * Objekts auf angeklickte Objekte übertragen. Bleibt aktiv, Esc beendet.
 */
export class FormatTool implements Tool {
  readonly id = 'format' as const;
  readonly snaps = false;
  readonly cssCursor = 'copy';
  private style: Style | null = null;

  constructor(private ctx: ToolContext) {}

  activate(): void {
    const ed = this.ctx.editor;
    const src = drawableTargets(ed.s.doc, ed.s.selection)[0];
    const e = src ? ed.s.doc.entities[src] : undefined;
    if (!e) {
      ed.toast('Zuerst das Objekt auswählen, dessen Format übertragen werden soll.', 'info', 4000);
      queueMicrotask(() => this.ctx.setTool('select'));
      return;
    }
    this.style = structuredClone(e.style);
  }

  hint(): string {
    return 'Format übertragen: Objekte anklicken, die dasselbe Aussehen bekommen sollen · Esc beendet';
  }

  private pick(p: ToolPointer): string | null {
    const hit = hitTest(this.ctx.editor.s.doc, this.ctx.vp(), this.ctx.layout(), p.screen, { curves: true, fills: true, texts: true });
    if (!hit || hit.kind === 'dim' || hit.kind === 'glyph' || hit.kind === 'point') return null;
    return drawableTargets(this.ctx.editor.s.doc, [hit.id])[0] ?? null;
  }

  pointerMove(p: ToolPointer): void {
    const id = this.pick(p);
    if (id !== this.ctx.editor.s.hover) this.ctx.editor.store.setState({ hover: id });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !this.style) return;
    const id = this.pick(p);
    if (!id) return;
    const e = this.ctx.editor.s.doc.entities[id];
    // Linien haben keine Füllung: nur Kontur übernehmen
    const patch: Partial<Style> =
      e?.kind === 'line' || e?.kind === 'arc'
        ? { stroke: this.style.stroke, strokeWidth: this.style.strokeWidth, lineCap: this.style.lineCap, dash: this.style.dash, opacity: this.style.opacity }
        : { ...this.style };
    const out = this.ctx.editor.setStyle([id], patch);
    if (!out.ok) this.ctx.editor.toast(out.message, 'error');
  }

  deactivate(): void {
    this.ctx.editor.store.setState({ hover: null });
    this.style = null;
  }
}
