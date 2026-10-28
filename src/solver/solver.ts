import { Algorithm, DebugMode, GcsWrapper, SolveStatus, init_planegcs_module, type SketchPrimitive } from '@salusoft89/planegcs';
import type { Constraint, Dimension, Id, SketchDoc, Vec2 } from '../model/types';
import { constraintError, dimError } from '../model/measure';
import { circleOf, lineOf } from '../model/doc';
import { arcPrimitives, constraintPrimitives, dimensionPrimitives, modelIdOf, SEP } from './mapping';

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
  /** Anzahl unabhängiger Teilsysteme / davon neu gelöst */
  components: number;
  solved: number;
}

interface CompResult {
  ok: boolean;
  points: Record<Id, Vec2>;
  radii: Record<Id, number>;
  dof: number;
  conflicting: Id[];
  redundant: Id[];
  maxError: number;
}

interface Component {
  points: Id[];
  circles: Id[];
  lines: Id[];
  arcs: Id[];
  constraints: Constraint[];
  dims: Dimension[];
}

const TOL = 1e-6;
const CACHE_LIMIT = 4000;

/** Entfernt numerisches Rauschen (1e-9 mm), ohne echte Werte zu verfälschen. */
export function cleanCoord(v: number): number {
  const r = Math.round(v * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}

/**
 * Löst Skizzen mit planegcs. Die Skizze wird in unabhängige Teilsysteme zerlegt
 * (z. B. einzelne Rechtecke); unveränderte Teilsysteme kommen aus dem Zwischenspeicher.
 * So bleiben auch große Skizzen schnell, und beim Ziehen wird nur das betroffene Teil gelöst.
 */
export class SketchSolver {
  private cache = new Map<string, CompResult>();
  private freeCache = new Map<string, { points: Id[]; circles: Id[] }>();

  constructor(private readonly gcs: GcsWrapper) {
    gcs.debug_mode = DebugMode.NoDebug;
    gcs.set_convergence_threshold(1e-12);
    gcs.set_max_iterations(200);
  }

  solve(doc: SketchDoc, opts: SolveOptions = {}): SolveResult {
    const t0 = performance.now();
    const comps = components(doc, opts.exclude);
    const hot = new Set<Id>();
    if (opts.drag?.kind === 'points') opts.drag.targets.forEach((t) => hot.add(t.id));
    if (opts.drag?.kind === 'radius') hot.add(opts.drag.circle);
    opts.probe?.points?.forEach((p) => hot.add(p));
    opts.probe?.circles?.forEach((c) => hot.add(c));

    const out: SolveResult = { ok: true, points: {}, radii: {}, dof: 0, conflicting: [], redundant: [], maxError: 0, ms: 0, components: comps.length, solved: 0 };
    for (const comp of comps) {
      const isHot = hot.size > 0 && (comp.points.some((p) => hot.has(p)) || comp.circles.some((c) => hot.has(c)));
      let r: CompResult;
      if (opts.drag && !isHot) {
        // Beim Ziehen bleibt alles andere unverändert – nicht einmal Schlüssel berechnen
        for (const id of comp.points) out.points[id] = { x: doc.points[id].x, y: doc.points[id].y };
        for (const id of comp.circles) out.radii[id] = circleOf(doc, id)!.r;
        continue;
      }
      if (!comp.constraints.length && !comp.dims.length && !isHot) {
        // Ohne Bedingungen: nichts zu lösen
        r = freeComponent(doc, comp);
      } else {
        const prims = this.primitives(doc, comp);
        if (isHot) {
          r = this.run(doc, comp, [...prims, ...extraPrimitives(doc, opts)]);
          out.solved++;
        } else {
          const key = JSON.stringify(prims);
          const hit = this.cache.get(key);
          if (hit) r = hit;
          else {
            r = this.run(doc, comp, prims);
            out.solved++;
            this.remember(key, r);
            // Auch unter dem Ergebnis-Schlüssel ablegen: nach dem Übernehmen ist das der Zustand
            if (r.ok) this.remember(JSON.stringify(this.primitives(doc, comp, r)), r);
          }
        }
      }
      Object.assign(out.points, r.points);
      Object.assign(out.radii, r.radii);
      out.dof += r.dof;
      out.conflicting.push(...r.conflicting);
      out.redundant.push(...r.redundant);
      out.maxError = Math.max(out.maxError, r.maxError);
      if (!r.ok) out.ok = false;
    }
    // Feste Punkte (Ursprung) unverändert übernehmen
    for (const p of Object.values(doc.points)) if (!(p.id in out.points)) out.points[p.id] = { x: p.x, y: p.y };
    out.conflicting = [...new Set(out.conflicting)];
    out.redundant = [...new Set(out.redundant)];
    out.ms = performance.now() - t0;
    return out;
  }

  /**
   * Welche Punkte/Kreise sind noch frei? Je Teilsystem: Ein Punkt ist bestimmt, wenn
   * zusätzliches Festhalten die Freiheitsgrade nicht verringert.
   * Gibt null zurück, wenn die Prüfung zu aufwendig wäre.
   */
  freedom(doc: SketchDoc, clusters: Map<Id, Id>, limit = 1500): { points: Set<Id>; circles: Set<Id> } | null {
    const points = new Set<Id>();
    const circles = new Set<Id>();
    let budget = limit;
    for (const comp of components(doc)) {
      if (!comp.constraints.length && !comp.dims.length) {
        comp.points.forEach((p) => points.add(p));
        comp.circles.forEach((c) => circles.add(c));
        continue;
      }
      const prims = this.primitives(doc, comp);
      const key = JSON.stringify(prims);
      const known = this.freeCache.get(key);
      if (known) {
        known.points.forEach((p) => points.add(p));
        known.circles.forEach((c) => circles.add(c));
        continue;
      }
      let base = this.cache.get(key);
      if (!base) {
        base = this.run(doc, comp, prims);
        this.remember(key, base);
      }
      if (base.dof === 0 || !base.ok) {
        this.freeCache.set(key, { points: [], circles: [] });
        continue;
      }
      const compFree: { points: Id[]; circles: Id[] } = { points: [], circles: [] };
      const reps = new Map<Id, Id[]>();
      for (const p of comp.points) {
        const root = clusters.get(p) ?? p;
        const list = reps.get(root);
        if (list) list.push(p);
        else reps.set(root, [p]);
      }
      // Punkte, die mit dem Ursprung koinzident sind, sind bestimmt
      for (const [root, members] of reps) {
        if (doc.points[root]?.locked) continue;
        if (--budget < 0) return null;
        const r = this.run(doc, comp, [...prims, ...extraPrimitives(doc, { probe: { points: [members[0]] } })]);
        if (r.dof < base.dof) compFree.points.push(...members);
      }
      for (const cid of comp.circles) {
        if (--budget < 0) return null;
        const r = this.run(doc, comp, [...prims, ...extraPrimitives(doc, { probe: { circles: [cid] } })]);
        if (r.dof < base.dof) compFree.circles.push(cid);
      }
      if (this.freeCache.size > CACHE_LIMIT) this.freeCache.clear();
      this.freeCache.set(key, compFree);
      compFree.points.forEach((p) => points.add(p));
      compFree.circles.forEach((c) => circles.add(c));
    }
    return { points, circles };
  }

  private remember(key: string, r: CompResult): void {
    if (this.cache.size > CACHE_LIMIT) this.cache.clear();
    this.cache.set(key, r);
  }

  /** Solver-Primitive eines Teilsystems (optional mit gelösten Werten statt Modellwerten). */
  private primitives(doc: SketchDoc, comp: Component, solved?: CompResult): SketchPrimitive[] {
    const prims: SketchPrimitive[] = [];
    const lockedUsed = new Set<Id>();
    const refsLocked = (ids: Id[]) => ids.forEach((id) => doc.points[id]?.locked && lockedUsed.add(id));
    for (const c of comp.constraints) refsLocked(c.refs);
    for (const d of comp.dims) refsLocked(d.refs);
    for (const id of lockedUsed) {
      const p = doc.points[id];
      prims.push({ id, type: 'point', x: p.x, y: p.y, fixed: true });
    }
    for (const id of comp.points) {
      const p = doc.points[id];
      const s = solved?.points[id];
      prims.push({ id, type: 'point', x: s ? s.x : p.x, y: s ? s.y : p.y, fixed: false });
    }
    for (const id of comp.lines) {
      const l = lineOf(doc, id)!;
      prims.push({ id, type: 'line', p1_id: l.p1, p2_id: l.p2 });
    }
    for (const id of comp.circles) {
      const c = circleOf(doc, id)!;
      prims.push({ id, type: 'circle', c_id: c.center, radius: solved?.radii[id] ?? c.r });
    }
    for (const id of comp.arcs) prims.push(...arcPrimitives(doc, id, solved?.points));
    for (const c of comp.constraints) prims.push(...constraintPrimitives(doc, c));
    for (const d of comp.dims) prims.push(...dimensionPrimitives(doc, d));
    return prims;
  }

  private run(doc: SketchDoc, comp: Component, prims: SketchPrimitive[]): CompResult {
    const g = this.gcs;
    g.clear_data();
    g.push_primitives_and_params(prims);
    const status = g.solve(Algorithm.DogLeg);
    g.apply_solution();
    const points: Record<Id, Vec2> = {};
    const radii: Record<Id, number> = {};
    const own = new Set(comp.points);
    const ownC = new Set(comp.circles);
    for (const p of g.sketch_index.get_primitives()) {
      if (p.type === 'point' && own.has(p.id)) points[p.id] = { x: cleanCoord(p.x), y: cleanCoord(p.y) };
      else if (p.type === 'circle' && ownC.has(p.id)) radii[p.id] = cleanCoord(p.radius);
    }
    const dof = g.gcs.dof();
    const toModel = (ids: string[]) => [...new Set(ids.filter((i) => !i.startsWith('drag') && !i.startsWith('probe')).map(modelIdOf))];
    const conflicting = toModel(g.get_gcs_conflicting_constraints());
    const redundant = toModel(g.get_gcs_redundant_constraints());
    const maxError = residual(doc, comp, points, radii);
    const solved = status === SolveStatus.Success || status === SolveStatus.Converged;
    return { ok: solved && maxError < TOL && conflicting.length === 0, points, radii, dof, conflicting, redundant, maxError };
  }
}

function freeComponent(doc: SketchDoc, comp: Component): CompResult {
  const points: Record<Id, Vec2> = {};
  const radii: Record<Id, number> = {};
  for (const id of comp.points) points[id] = { x: doc.points[id].x, y: doc.points[id].y };
  for (const id of comp.circles) radii[id] = circleOf(doc, id)!.r;
  return { ok: true, points, radii, dof: comp.points.length * 2 + comp.circles.length - comp.arcs.length, conflicting: [], redundant: [], maxError: 0 };
}

function extraPrimitives(doc: SketchDoc, opts: SolveOptions): SketchPrimitive[] {
  const prims: SketchPrimitive[] = [];
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
  for (const pid of opts.probe?.points ?? []) {
    const p = doc.points[pid];
    if (!p || p.locked) continue;
    prims.push({ id: `probe${SEP}x${pid}`, type: 'coordinate_x', p_id: pid, x: p.x });
    prims.push({ id: `probe${SEP}y${pid}`, type: 'coordinate_y', p_id: pid, y: p.y });
  }
  for (const cid of opts.probe?.circles ?? []) {
    const c = doc.entities[cid];
    if (c?.kind === 'circle') prims.push({ id: `probe${SEP}r${cid}`, type: 'circle_radius', c_id: cid, radius: c.r });
  }
  return prims;
}

/** Restfehler der Bedingungen eines Teilsystems am Ergebnis. */
function residual(doc: SketchDoc, comp: Component, points: Record<Id, Vec2>, radii: Record<Id, number>): number {
  // Leichte Überlagerung statt Kopie des ganzen Modells (Prototyp-Kette)
  // (defineProperty, weil die Prototyp-Objekte von immer eingefroren sind)
  const put = <T,>(o: Record<Id, T>, id: Id, value: T) => Object.defineProperty(o, id, { value, enumerable: true, writable: true, configurable: true });
  const pts = Object.create(doc.points) as SketchDoc['points'];
  for (const [id, v] of Object.entries(points)) put(pts, id, { ...doc.points[id], x: v.x, y: v.y });
  const ents = Object.create(doc.entities) as SketchDoc['entities'];
  for (const [id, r] of Object.entries(radii)) {
    const c = doc.entities[id];
    if (c?.kind === 'circle') put(ents, id, { ...c, r });
  }
  const tmp: SketchDoc = { ...doc, points: pts, entities: ents };
  let max = 0;
  for (const c of comp.constraints) {
    const e = constraintError(tmp, c);
    if (Number.isFinite(e) && e > max) max = e;
  }
  for (const d of comp.dims) {
    const e = dimError(tmp, d);
    if (Number.isFinite(e) && e > max) max = e;
  }
  return max;
}

/** Zerlegt die Skizze in unabhängige Teilsysteme (Union-Find über Punkte und Radien). */
export function components(doc: SketchDoc, exclude?: ReadonlySet<Id>): Component[] {
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = a;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let x = a;
    while (parent.get(x) !== r) {
      const n = parent.get(x)!;
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  const union = (a: Id, b: Id) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const p of Object.values(doc.points)) if (!p.locked) parent.set(p.id, p.id);
  const lines: Id[] = [];
  const circles: Id[] = [];
  const arcs: Id[] = [];
  for (const e of Object.values(doc.entities)) {
    if (e.kind === 'line') {
      lines.push(e.id);
      if (parent.has(e.p1) && parent.has(e.p2)) union(e.p1, e.p2);
    } else if (e.kind === 'circle') {
      circles.push(e.id);
      parent.set(e.id, e.id);
      if (parent.has(e.center)) union(e.id, e.center);
    } else if (e.kind === 'arc') {
      arcs.push(e.id);
      const own = [e.center, e.p1, e.p2].filter((p) => parent.has(p));
      for (let i = 1; i < own.length; i++) union(own[0], own[i]);
    }
  }
  /** Freie Knoten (Punkte/Radien), die eine Referenz berührt */
  const nodesOf = (ref: Id): Id[] => {
    if (doc.points[ref]) return parent.has(ref) ? [ref] : [];
    const e = doc.entities[ref];
    if (!e) return [];
    if (e.kind === 'line') return [e.p1, e.p2].filter((p) => parent.has(p));
    if (e.kind === 'circle') return [e.id];
    if (e.kind === 'arc') return [e.center, e.p1, e.p2].filter((p) => parent.has(p));
    if (e.kind === 'text') return parent.has(e.anchor) ? [e.anchor] : [];
    return [];
  };
  const cons = Object.values(doc.constraints).filter((c) => !exclude?.has(c.id));
  const dims = Object.values(doc.dims).filter((d) => !d.driven && !exclude?.has(d.id));
  const nodesOfItem = (refs: Id[], extra: Id[] = []) => [...refs.flatMap(nodesOf), ...extra];
  // Bemaßungen/Abhängigkeiten, die Linienpunkte indirekt verwenden (lineLine, midpoint …), über die Referenzen abdecken
  for (const c of cons) {
    const n = nodesOfItem(c.refs);
    for (let i = 1; i < n.length; i++) union(n[0], n[i]);
  }
  for (const d of dims) {
    const n = nodesOfItem(d.refs);
    for (let i = 1; i < n.length; i++) union(n[0], n[i]);
  }

  const byRoot = new Map<Id, Component>();
  const comp = (root: Id) => {
    let c = byRoot.get(root);
    if (!c) {
      c = { points: [], circles: [], lines: [], arcs: [], constraints: [], dims: [] };
      byRoot.set(root, c);
    }
    return c;
  };
  for (const p of Object.values(doc.points)) if (parent.has(p.id)) comp(find(p.id)).points.push(p.id);
  for (const id of circles) comp(find(id)).circles.push(id);
  for (const id of lines) {
    const l = lineOf(doc, id)!;
    const anchor = parent.has(l.p1) ? l.p1 : parent.has(l.p2) ? l.p2 : null;
    if (anchor) comp(find(anchor)).lines.push(id);
  }
  for (const id of arcs) {
    const a = doc.entities[id];
    if (a?.kind !== 'arc') continue;
    const anchor = [a.center, a.p1, a.p2].find((p) => parent.has(p));
    if (anchor) comp(find(anchor)).arcs.push(id);
  }
  for (const c of cons) {
    const n = nodesOfItem(c.refs);
    if (n.length) comp(find(n[0])).constraints.push(c);
  }
  for (const d of dims) {
    const n = nodesOfItem(d.refs);
    if (n.length) comp(find(n[0])).dims.push(d);
  }
  // Linien brauchen beide Endpunkte im Teilsystem; Kreise ihren Mittelpunkt (durch union gesichert)
  return [...byRoot.values()];
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
  const mod = await init_planegcs_module(moduleArgs as never);
  const wrapper = new GcsWrapper(new mod.GcsSystem(), mod);
  return new SketchSolver(wrapper);
}
