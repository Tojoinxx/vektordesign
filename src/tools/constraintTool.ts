import type { ConstraintKind, Id } from '../model/types';
import { CONSTRAINT_LABELS } from '../solver/analysis';
import type { ToolId } from '../store/state';
import { hitTest } from './hit';
import type { Tool, ToolContext, ToolPointer } from './types';

const HINTS: Record<ConstraintKind, string> = {
  coincident: 'Punkt wählen, dann Punkt, Linie oder Kreis',
  horizontal: 'Linie wählen – oder zwei Punkte, die waagrecht ausgerichtet werden',
  vertical: 'Linie wählen – oder zwei Punkte, die senkrecht ausgerichtet werden',
  parallel: 'Zwei Linien wählen',
  perpendicular: 'Zwei Linien wählen',
  collinear: 'Zwei Linien wählen, die auf einer Geraden liegen sollen',
  tangent: 'Linie und Kreis oder zwei Kreise wählen',
  concentric: 'Zwei Kreise oder Kreis und Punkt wählen',
  equal: 'Zwei Linien (gleich lang) oder zwei Kreise (gleicher Radius) wählen',
  symmetric: 'Zwei Punkte oder Linien wählen, zuletzt die Symmetrieachse',
  midpoint: 'Punkt und Linie wählen – der Punkt kommt auf die Linienmitte',
  fix: 'Punkt, Linie oder Kreis wählen, der festgehalten wird',
};

export const MAX_PICKS: Record<ConstraintKind, number> = {
  coincident: 2,
  horizontal: 2,
  vertical: 2,
  parallel: 2,
  perpendicular: 2,
  collinear: 2,
  tangent: 2,
  concentric: 2,
  equal: 2,
  symmetric: 3,
  midpoint: 2,
  fix: 1,
};

/** Abhängigkeit setzen: Elemente nacheinander anklicken; das Werkzeug bleibt aktiv (wie in Inventor). */
export class ConstraintTool implements Tool {
  readonly id: ToolId;
  readonly snaps = false;
  private picks: Id[] = [];

  constructor(
    private ctx: ToolContext,
    readonly kind: ConstraintKind,
  ) {
    this.id = `constraint:${kind}`;
  }

  private get ed() {
    return this.ctx.editor;
  }

  hint(): string {
    const n = this.picks.length;
    return `${CONSTRAINT_LABELS[this.kind]}: ${HINTS[this.kind]}${n ? ` (${n} gewählt)` : ''} · Esc beendet`;
  }

  private pick(p: ToolPointer): Id | null {
    const hit = hitTest(this.ed.s.doc, this.ctx.vp(), this.ctx.layout(), p.screen, {
      points: true,
      curves: true,
      helperPoints: true,
      texts: this.kind === 'fix',
    });
    if (!hit) return null;
    if (hit.kind === 'circle' && hit.dist === 0) return null;
    return hit.id;
  }

  pointerMove(p: ToolPointer): void {
    const id = this.pick(p);
    if (id !== this.ed.s.hover) this.ed.store.setState({ hover: id });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const id = this.pick(p);
    if (!id || this.picks.includes(id)) return;
    this.picks.push(id);
    this.ed.select(this.picks);
    const norm = this.ed.normalizeConstraint(this.ed.s.doc, this.kind, this.picks);
    if ('refs' in norm) {
      const out = this.ed.addConstraint(this.kind, this.picks);
      if (!out.ok) this.ed.toast(out.message, 'error');
      this.reset();
      return;
    }
    if (this.picks.length >= MAX_PICKS[this.kind]) {
      this.ed.toast(norm.error, 'error');
      this.reset();
    }
  }

  private reset(): void {
    this.picks = [];
    this.ed.select([]);
    this.ctx.requestRender();
  }

  cancel(): boolean {
    if (this.picks.length) {
      this.reset();
      return true;
    }
    return false;
  }

  deactivate(): void {
    this.picks = [];
    this.ed.store.setState({ hover: null });
  }
}
