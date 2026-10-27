import type { Id, SketchDoc, SketchStatus } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { coincidenceClusters } from '../model/topology';
import type { SketchSolver, SolveResult } from './solver';

export interface Analysis {
  status: SketchStatus;
  dof: number;
  conflicting: Id[];
  redundant: Id[];
  /** Kurztext für die Statusleiste */
  label: string;
  /** Ausführliche Meldung (Überbestimmung) */
  detail: string;
  /**
   * Noch frei bewegliche Geometrie (Punkte, Kreise mit freiem Radius).
   * null = nicht berechnet (z. B. sehr große Skizze).
   */
  free: { points: Set<Id>; circles: Set<Id> } | null;
}

export const CONSTRAINT_LABELS: Record<string, string> = {
  coincident: 'Koinzident',
  horizontal: 'Horizontal',
  vertical: 'Vertikal',
  parallel: 'Parallel',
  perpendicular: 'Rechtwinklig',
  collinear: 'Kollinear',
  tangent: 'Tangential',
  concentric: 'Konzentrisch',
  equal: 'Gleich',
  symmetric: 'Symmetrisch',
  midpoint: 'Mittelpunkt',
  fix: 'Fixiert',
};

/** Lesbarer Name für Abhängigkeit oder Bemaßung. */
export function describeItem(doc: SketchDoc, id: Id): string {
  const d = doc.dims[id];
  if (d) return `Bemaßung ${d.name}`;
  const c = doc.constraints[id];
  if (c) return `„${CONSTRAINT_LABELS[c.kind] ?? c.kind}“`;
  return id;
}

export function isEmptySketch(doc: SketchDoc): boolean {
  return Object.keys(doc.entities).length === 0 && Object.keys(doc.points).every((p) => p === ORIGIN_ID);
}

export function bemassungen(n: number): string {
  return n === 1 ? '1 Bemaßung' : `${n} Bemaßungen`;
}

export function analysisFromResult(doc: SketchDoc, res: SolveResult, free: Analysis['free'] = null): Analysis {
  if (isEmptySketch(doc)) {
    return { status: 'empty', dof: 0, conflicting: [], redundant: [], label: 'Leere Skizze', detail: '', free: null };
  }
  const problems = [...new Set([...res.conflicting, ...res.redundant])];
  if (!res.ok || problems.length) {
    const names = problems.map((id) => describeItem(doc, id));
    const detail = res.conflicting.length
      ? `Diese Vorgaben widersprechen sich: ${names.join(', ')}. Entferne eine davon oder mache eine Bemaßung getrieben.`
      : problems.length
        ? `Diese Vorgaben sind doppelt (überflüssig): ${names.join(', ')}. Entferne eine davon.`
        : 'Die Vorgaben lassen sich nicht gleichzeitig erfüllen.';
    return { status: 'over', dof: res.dof, conflicting: res.conflicting, redundant: res.redundant, label: 'Überbestimmt', detail, free };
  }
  if (res.dof === 0) {
    return { status: 'full', dof: 0, conflicting: [], redundant: [], label: 'Vollständig bestimmt', detail: '', free: { points: new Set(), circles: new Set() } };
  }
  return {
    status: 'under',
    dof: res.dof,
    conflicting: [],
    redundant: [],
    label: `Unterbestimmt – noch ${bemassungen(res.dof)} nötig`,
    detail: '',
    free,
  };
}

/**
 * Ermittelt, welche Punkte/Kreise noch frei sind (je Teilsystem, siehe SketchSolver.freedom).
 * Koinzidente Punkte werden gemeinsam geprüft. Gibt null zurück, wenn die Skizze zu groß ist.
 */
export function analyzeFreedom(solver: SketchSolver, doc: SketchDoc, baseDof: number): Analysis['free'] {
  if (baseDof === 0) return { points: new Set(), circles: new Set() };
  return solver.freedom(doc, coincidenceClusters(doc));
}
