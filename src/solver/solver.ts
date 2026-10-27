import { Algorithm, DebugMode, SolveStatus, type GcsWrapper, type SketchPrimitive } from '@salusoft89/planegcs';
import type { Id, SketchDoc, Vec2 } from '../model/types';
import { constraintError, dimError } from '../model/measure';
import { constraintPrimitives, dimensionPrimitives, geometryPrimitives, modelIdOf, SEP } from './mapping';

/** Temporäre Zug-Vorgabe beim interaktiven Ziehen (wird nur „so gut es geht“ erfüllt). */
export type DragSpec =
  | { kind: 'points'; targets: { id: Id; x: number; y: number }[] }
  | { kind: 'radius'; circle: Id; r: number };

export interface SolveOptions {
  drag?: DragSpec;
  /** Abhängigkeiten/Bemaßungen, die beim Lösen ignoriert werden */
  exclude?: ReadonlySet<Id>;
  /** Prüf-Fixierungen für die Freiheitsgrad-Analyse */
  probe?: { points?: Id[]; circles?: Id[] };
}

export interface SolveResult {
  ok: boolean;
  /** Neue Lage aller Punkte */
  points: Record<Id, Vec2>;
  /** Neue Radien aller Kreise */
  radii: Record<Id, number>;
  /** Verbleibende Freiheitsgrade */
  dof: number;
  /** Widersprüchliche Abhängigkeiten/Bemaßungen (Modell-Ids) */
  conflicting: Id[];
  /** Überflüssige (redundante) Abhängigkeiten/Bemaßungen (Modell-Ids) */
  redundant: Id[];
  /** Größter Restfehler aller Bedingungen nach dem Lösen */
  maxError: number;
  ms: number;
}

const TOL = 1e-6;

export class SketchSolver {
  constructor(private readonly gcs: GcsWrapper) {
    gcs.debug_mode = DebugMode.NoDebug;
    gcs.set_convergence_threshold(1e-12);
    gcs.set_max_iterations(200);
  }

  /** Baut das Gleichungssystem aus dem Modell auf und löst es. Das Modell bleibt unverändert. */
  solve(doc: SketchDoc, opts: SolveOptions = {}): SolveResult {
    const t0 = performance.now();
    const prims = this.buildPrimitives(doc, opts);
    const g = this.gcs;
    g.clear_data();
    g.push_primitives_and_params(prims);
    const status = g.solve(Algorithm.DogLeg);
    g.apply_solution();

    const points: Record<Id, Vec2> = {};
    const radii: Record<Id, number> = {};
    for (const p of g.sketch_index.get_primitives()) {
      if (p.type === 'point') {
        if (doc.points[p.id]) points[p.id] = { x: p.x, y: p.y };
      } else if (p.type === 'circle') {
        radii[p.id] = p.radius;
      }
    }

    const dof = g.gcs.dof();
    const toModel = (ids: string[]) => [...new Set(ids.filter((i) => !i.startsWith('drag') && !i.startsWith('probe')).map(modelIdOf))];
    const conflicting = toModel(g.get_gcs_conflicting_constraints());
    const redundant = toModel(g.get_gcs_redundant_constraints());

    const maxError = this.residual(doc, points, radii, opts.exclude);
    const solved = status === SolveStatus.Success || status === SolveStatus.Converged;
    const ok = solved && maxError < TOL && conflicting.length === 0;
    return { ok, points, radii, dof, conflicting, redundant, maxError, ms: performance.now() - t0 };
  }

  private buildPrimitives(doc: SketchDoc, opts: SolveOptions): SketchPrimitive[] {
    const prims = geometryPrimitives(doc);
    const ex = opts.exclude;
    for (const c of Object.values(doc.constraints)) {
      if (ex?.has(c.id)) continue;
      prims.push(...constraintPrimitives(doc, c));
    }
    for (const d of Object.values(doc.dims)) {
      if (ex?.has(d.id)) continue;
      prims.push(...dimensionPrimitives(doc, d));
    }
    const drag = opts.drag;
    if (drag?.kind === 'points') {
      drag.targets.forEach((t, i) => {
        if (!doc.points[t.id] || doc.points[t.id].locked) return;
        prims.push({ id: `drag${SEP}t${i}`, type: 'point', x: t.x, y: t.y, fixed: true });
        prims.push({ id: `drag${SEP}c${i}`, type: 'p2p_coincident', p1_id: t.id, p2_id: `drag${SEP}t${i}`, temporary: true });
      });
    } else if (drag?.kind === 'radius') {
      prims.push({ id: `drag${SEP}r`, type: 'circle_radius', c_id: drag.circle, radius: drag.r, temporary: true });
    }
    const probe = opts.probe;
    if (probe) {
      for (const pid of probe.points ?? []) {
        const p = doc.points[pid];
        if (!p || p.locked) continue;
        prims.push({ id: `probe${SEP}x${pid}`, type: 'coordinate_x', p_id: pid, x: p.x });
        prims.push({ id: `probe${SEP}y${pid}`, type: 'coordinate_y', p_id: pid, y: p.y });
      }
      for (const cid of probe.circles ?? []) {
        const c = doc.entities[cid];
        if (c?.kind === 'circle') prims.push({ id: `probe${SEP}r${cid}`, type: 'circle_radius', c_id: cid, radius: c.r });
      }
    }
    return prims;
  }

  /** Prüft alle Bedingungen am Ergebnis nach (unabhängig vom Solver-Status). */
  private residual(doc: SketchDoc, points: Record<Id, Vec2>, radii: Record<Id, number>, exclude?: ReadonlySet<Id>): number {
    const tmp = withSolution(doc, points, radii);
    let max = 0;
    for (const c of Object.values(tmp.constraints)) {
      if (exclude?.has(c.id)) continue;
      const e = constraintError(tmp, c);
      if (Number.isFinite(e) && e > max) max = e;
    }
    for (const d of Object.values(tmp.dims)) {
      if (d.driven || exclude?.has(d.id)) continue;
      const e = dimError(tmp, d);
      if (Number.isFinite(e) && e > max) max = e;
    }
    return max;
  }
}

/** Flache Kopie des Modells mit neuen Punktlagen und Radien (für Messungen). */
export function withSolution(doc: SketchDoc, points: Record<Id, Vec2>, radii: Record<Id, number>): SketchDoc {
  const np: SketchDoc['points'] = {};
  for (const p of Object.values(doc.points)) {
    const s = points[p.id];
    np[p.id] = s ? { ...p, x: s.x, y: s.y } : p;
  }
  const ne: SketchDoc['entities'] = {};
  for (const e of Object.values(doc.entities)) {
    ne[e.id] = e.kind === 'circle' && radii[e.id] !== undefined ? { ...e, r: radii[e.id] } : e;
  }
  return { ...doc, points: np, entities: ne };
}

/** Lädt das WebAssembly-Modul. `locateFile`/`wasmBinary` je nach Umgebung. */
export async function createSolver(moduleArgs?: Record<string, unknown>): Promise<SketchSolver> {
  const { init_planegcs_module, GcsWrapper } = await import('@salusoft89/planegcs');
  const mod = await init_planegcs_module(moduleArgs as never);
  const wrapper = new GcsWrapper(new mod.GcsSystem(), mod);
  return new SketchSolver(wrapper);
}
