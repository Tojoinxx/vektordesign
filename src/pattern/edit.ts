import { produce } from 'immer';
import type { Id, PatternAvatar, PatternMaterial, PatternPiece, SketchDoc } from '../model/types';
import { emptyPattern } from './geometry';

/**
 * Reine Änderungsfunktionen für Aussehen-Angaben aus der 3D-Ansicht (Farbe und Stoff je Teil, Stoffe).
 * Das Hauptprogramm wendet sie über den Editor an (rückgängig machbar), Vektordesign 3D direkt.
 */

export type PieceLookPatch = { color?: string | null; material?: Id };
export type MaterialPatch = Partial<Omit<PatternMaterial, 'id'>>;

export function applyPieceLook(doc: SketchDoc, id: Id, patch: PieceLookPatch): SketchDoc {
  return produce(doc, (d) => {
    const pc = d.pattern?.pieces.find((p) => p.id === id);
    if (!pc) return;
    lookInto(d, pc, patch);
  });
}

/** Wirkt auf ein (Entwurfs-)Teil: Farbe/Stoff setzen und die 2D-Füllung mitziehen. */
export function lookInto(d: SketchDoc, pc: PatternPiece, patch: PieceLookPatch): void {
  if (patch.material !== undefined) pc.material = patch.material;
  if (patch.color !== undefined) {
    if (patch.color === null) delete pc.color;
    else pc.color = patch.color;
  }
  const e = d.entities[pc.outline];
  const m = d.pattern?.materials.find((x) => x.id === pc.material);
  const fill = pc.color ?? m?.color;
  if (e && fill) e.style.fill = fill;
}

export function applyMaterial(doc: SketchDoc, id: Id, patch: MaterialPatch): SketchDoc {
  return produce(doc, (d) => {
    materialInto(d, id, patch);
  });
}

export function materialInto(d: SketchDoc, id: Id, patch: MaterialPatch): void {
  const m = d.pattern?.materials.find((x) => x.id === id);
  if (!m) return;
  Object.assign(m, patch);
  if (patch.color) {
    for (const pc of d.pattern!.pieces) {
      if (pc.material !== id || pc.color) continue;
      const e = d.entities[pc.outline];
      if (e) e.style.fill = patch.color;
    }
  }
}

/** Puppe setzen (null = wieder Körpermaße des Schnitts). */
export function applyAvatar(doc: SketchDoc, avatar: PatternAvatar | null): SketchDoc {
  return produce(doc, (d) => {
    if (!d.pattern) d.pattern = emptyPattern();
    if (avatar) d.pattern.avatar = { ...avatar };
    else delete d.pattern.avatar;
  });
}
