import { produce } from 'immer';
import type {
  Constraint,
  ConstraintKind,
  Dimension,
  DimensionKind,
  Id,
  LineEntity,
  Layer,
  ShapeEntity,
  SketchDoc,
  Style,
  TextEntity,
  Vec2,
} from '../model/types';
import { shapeSize } from '../model/shape';
import { productionOf } from '../model/production';
import type { Production } from '../model/types';
import { DEFAULT_LAYER, groupMembers, isInert, layerIdOf, layersOf } from '../model/layers';
import { applyXf, cloneInto, type Xf, type XfReport } from './xform';
import { extendLine, trimLine, type TrimResult } from './trimExtend';
import { ORIGIN_ID } from '../model/types';
import {
  addCircle,
  addConstraint,
  addDimension,
  addLine,
  addPath,
  addPoint,
  addText,
  circleOf,
  createDoc,
  deleteIds,
  dissolvePath,
  entityPointIds,
  fixValuesFor,
  lineOf,
  newId,
  pathOfLine,
  pt,
} from '../model/doc';
import { displayValue, measureDim } from '../model/measure';
import { dist, mid, norm, sub } from '../model/geometry';
import { docBBox } from '../model/bounds';
import { dimGeometry } from '../render/dimGeometry';
import { evaluateDims, namesInExpr, replaceName } from '../params/params';
import { evaluate, numberToExpr, ExprError } from '../params/expr';
import { SketchSolver, withSolution, type DragSpec, type SolveResult } from '../solver/solver';
import { analysisFromResult, analyzeFreedom, describeItem, CONSTRAINT_LABELS } from '../solver/analysis';
import type { AppState, AppStore, ConfirmRequest, Toast, ViewState } from './state';
import { initialState } from './state';

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

/** Wohin ein gezeichneter Punkt gefangen wurde (für automatische Abhängigkeiten). */
export type SnapRef =
  | { kind: 'point'; id: Id }
  | { kind: 'onCurve'; id: Id }
  | { kind: 'midpoint'; id: Id }
  | { kind: 'intersection'; ids: Id[] }
  | { kind: 'grid' };

export interface PlacedPoint {
  pos: Vec2;
  snap?: SnapRef | null;
}

export type CommitOutcome =
  | { ok: true; doc: SketchDoc; result: SolveResult | null }
  | { ok: false; reason: 'expr'; message: string; errors: Record<Id, string> }
  | { ok: false; reason: 'over'; message: string; conflicting: Id[]; redundant: Id[] }
  | { ok: false; reason: 'invalid'; message: string };

export interface CommitOptions {
  /** Automatisch erzeugte Abhängigkeiten: werden bei Konflikt still entfernt */
  autoIds?: Id[];
  /** Überbestimmung zulassen (z. B. beim Löschen) */
  allowOver?: boolean;
  /** Geometrie ändert sich nicht (nur Stil/Reihenfolge) – kein Lösen nötig */
  skipSolve?: boolean;
  /** Ausgangsdokument für das Rezept (Startwerte), Verlauf merkt sich trotzdem den aktuellen Stand */
  from?: SketchDoc;
  /** Auswahl nach dem Übernehmen */
  select?: Id[];
}

export interface DimensionSpec {
  kind: DimensionKind;
  refs: Id[];
  offset?: number;
  shift?: number;
  angle?: number;
}

type Recipe = (d: SketchDoc) => void;

const HISTORY_LIMIT = 200;
/** Freiheitsgrad-Analyse synchron bis zu dieser Größe, sonst verzögert */
const SYNC_FREEDOM_LIMIT = 80;

export const DIM_KIND_LABELS: Record<DimensionKind, string> = {
  distance: 'Abstand',
  distanceX: 'Horizontaler Abstand',
  distanceY: 'Vertikaler Abstand',
  pointLine: 'Abstand Punkt–Linie',
  lineLine: 'Abstand Linie–Linie',
  radius: 'Radius',
  diameter: 'Durchmesser',
  angle: 'Winkel',
  angleX: 'Winkel zur X-Achse',
  width: 'Breite',
  height: 'Höhe',
};

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export class Editor {
  solver: SketchSolver | null = null;
  private dragBase: SketchDoc | null = null;
  private dragLabel = 'Verschieben';
  private tx: { depth: number; startDoc: SketchDoc | null; label: string; count: number } = {
    depth: 0,
    startDoc: null,
    label: '',
    count: 0,
  };
  private freedomTimer: ReturnType<typeof setTimeout> | null = null;
  private toastId = 1;
  private clipboard: { doc: SketchDoc; ids: Id[] } | null = null;
  /** Größe der Zeichenfläche in CSS-Pixeln (für „Alles anzeigen“) */
  viewport = { width: 1200, height: 800 };

  constructor(public readonly store: AppStore) {}

  get s(): AppState {
    return this.store.getState();
  }

  private set(p: Partial<AppState>): void {
    this.store.setState(p);
  }

  attachSolver(solver: SketchSolver): void {
    this.solver = solver;
    this.set({ solverReady: true });
    this.resolveAll();
  }

  // -------------------------------------------------------------------------
  // Kern: Änderungen übernehmen
  // -------------------------------------------------------------------------

  /**
   * Wendet ein Änderungsrezept an, wertet Bemaßungsausdrücke aus, löst die Skizze und
   * übernimmt das Ergebnis nur, wenn alles erfüllbar ist. Sonst bleibt der Stand unverändert.
   */
  commit(label: string, recipe: Recipe, opts: CommitOptions = {}): CommitOutcome {
    const current = this.s.doc;
    const start = opts.from ?? current;
    let next: SketchDoc;
    try {
      next = produce(start, recipe);
    } catch (e) {
      return { ok: false, reason: 'invalid', message: e instanceof Error ? e.message : String(e) };
    }
    next = this.assignNewToLayer(start, next);

    if (opts.skipSolve || !this.solver) {
      if (next === current) return { ok: true, doc: current, result: null };
      this.accept(current, next, label, null, opts.select);
      return { ok: true, doc: next, result: null };
    }

    // Bemaßungsausdrücke auswerten
    const ev = evaluateDims(next);
    const errIds = Object.keys(ev.errors);
    if (errIds.length) {
      const first = errIds[0];
      const name = next.dims[first]?.name ?? first;
      return { ok: false, reason: 'expr', message: `${name}: ${ev.errors[first]}`, errors: ev.errors };
    }
    next = produce(next, (d) => {
      for (const [id, val] of Object.entries(ev.values)) if (d.dims[id] && d.dims[id].value !== val) d.dims[id].value = val;
    });
    // Breite/Höhe von Formen steuern deren Maßstab (außerhalb des Solvers)
    const sized = applyShapeSizes(next);
    if ('error' in sized) {
      if (!opts.allowOver) return { ok: false, reason: 'over', message: sized.error, conflicting: sized.ids, redundant: [] };
    } else next = sized.doc;

    let res = this.solver.solve(next);
    const auto = new Set(opts.autoIds ?? []);
    for (let tries = 0; tries < 6; tries++) {
      const problems = [...res.conflicting, ...res.redundant];
      const removable = problems.filter((id) => auto.has(id));
      if ((!res.ok || problems.length) && removable.length) {
        next = produce(next, (d) => {
          for (const id of removable) delete d.constraints[id];
        });
        removable.forEach((id) => auto.delete(id));
        res = this.solver.solve(next);
        continue;
      }
      break;
    }

    const problems = [...new Set([...res.conflicting, ...res.redundant])];
    const wasOver = this.s.analysis.status === 'over';
    if ((!res.ok || problems.length) && !opts.allowOver && !wasOver) {
      return {
        ok: false,
        reason: 'over',
        message: this.overMessage(next, res),
        conflicting: res.conflicting,
        redundant: res.redundant,
      };
    }

    if (res.ok) next = applySolution(next, res);
    next = refreshDriven(next);
    if (next === current) {
      // Keine Änderung → kein Verlaufseintrag
      if (opts.select) this.set({ selection: opts.select });
      return { ok: true, doc: current, result: res };
    }
    this.accept(current, next, label, res, opts.select);
    return { ok: true, doc: next, result: res };
  }

  /** Neu angelegte Objekte ohne Ebene landen auf der Zielebene (nur wenn es mehrere Ebenen gibt). */
  private assignNewToLayer(prev: SketchDoc, next: SketchDoc): SketchDoc {
    if (next === prev || !next.layers || next.layers.length < 2) return next;
    const fresh = Object.keys(next.entities).filter((id) => !prev.entities[id] && !next.entities[id].layer);
    if (!fresh.length) return next;
    const target = this.targetLayer(next);
    return produce(next, (d) => {
      for (const id of fresh) d.entities[id].layer = target;
    });
  }

  private overMessage(doc: SketchDoc, res: SolveResult): string {
    const ids = [...new Set([...res.conflicting, ...res.redundant])];
    if (!ids.length) return 'Diese Vorgaben lassen sich nicht gleichzeitig erfüllen.';
    const names = ids.map((id) => describeItem(doc, id)).join(', ');
    return `Das würde die Skizze überbestimmen (betroffen: ${names}).`;
  }

  private accept(prev: SketchDoc, next: SketchDoc, label: string, res: SolveResult | null, select?: Id[]): void {
    const patch: Partial<AppState> = { doc: next, dirty: true };
    if (this.tx.depth > 0) {
      if (!this.tx.startDoc) this.tx.startDoc = prev;
      this.tx.count++;
    } else {
      patch.past = [...this.s.past, { doc: prev, label }].slice(-HISTORY_LIMIT);
      patch.future = [];
    }
    if (select) patch.selection = select;
    else patch.selection = this.s.selection.filter((id) => existsIn(next, id));
    if (res) patch.analysis = analysisFromResult(next, res, this.s.analysis.free);
    this.set(patch);
    if (res) this.scheduleFreedom(res);
  }

  /** Mehrere Änderungen als ein einziger Rückgängig-Schritt. */
  transaction<T>(label: string, fn: () => T): T {
    this.beginTransaction(label);
    try {
      return fn();
    } finally {
      this.endTransaction();
    }
  }

  /** Beginnt einen Rückgängig-Schritt über mehrere (auch asynchrone) Änderungen. */
  beginTransaction(label: string): void {
    this.tx.depth++;
    if (this.tx.depth === 1) {
      this.tx.label = label;
      this.tx.startDoc = null;
      this.tx.count = 0;
    }
  }

  /** Beendet den Rückgängig-Schritt. Gibt die Zahl der enthaltenen Änderungen zurück. */
  endTransaction(label?: string): number {
    if (this.tx.depth === 0) return 0;
    this.tx.depth--;
    const count = this.tx.count;
    if (this.tx.depth === 0) {
      if (this.tx.startDoc && this.tx.startDoc !== this.s.doc) {
        this.set({
          past: [...this.s.past, { doc: this.tx.startDoc, label: label ?? this.tx.label }].slice(-HISTORY_LIMIT),
          future: [],
        });
      }
      this.tx.startDoc = null;
    }
    return count;
  }

  /** Löst die aktuelle Skizze neu (z. B. nach dem Laden). */
  resolveAll(): void {
    if (!this.solver) return;
    let doc = this.s.doc;
    const ev = evaluateDims(doc);
    doc = produce(doc, (d) => {
      for (const [id, val] of Object.entries(ev.values)) if (d.dims[id]) d.dims[id].value = val;
    });
    const res = this.solver.solve(doc);
    if (res.ok) doc = applySolution(doc, res);
    doc = refreshDriven(doc);
    this.set({ doc, analysis: analysisFromResult(doc, res, null) });
    this.scheduleFreedom(res);
  }

  private scheduleFreedom(res: SolveResult): void {
    if (this.freedomTimer) clearTimeout(this.freedomTimer);
    this.freedomTimer = null;
    const solver = this.solver;
    if (!solver) return;
    if (!res.ok || res.dof === 0) return;
    const doc = this.s.doc;
    const run = () => {
      if (this.s.doc !== doc) return;
      const free = analyzeFreedom(solver, doc, res.dof);
      this.set({ analysis: { ...this.s.analysis, free } });
    };
    const size = Object.keys(doc.points).length;
    if (size <= SYNC_FREEDOM_LIMIT) run();
    else this.freedomTimer = setTimeout(run, 150);
  }

  // -------------------------------------------------------------------------
  // Verlauf
  // -------------------------------------------------------------------------

  get canUndo(): boolean {
    return this.s.past.length > 0;
  }
  get canRedo(): boolean {
    return this.s.future.length > 0;
  }

  undo(): boolean {
    const { past, future, doc } = this.s;
    const last = past[past.length - 1];
    if (!last) return false;
    this.set({
      doc: last.doc,
      past: past.slice(0, -1),
      future: [...future, { doc, label: last.label }],
      dimPrompt: null,
      dirty: true,
    });
    this.afterHistoryJump();
    return true;
  }

  redo(): boolean {
    const { past, future, doc } = this.s;
    const next = future[future.length - 1];
    if (!next) return false;
    this.set({
      doc: next.doc,
      future: future.slice(0, -1),
      past: [...past, { doc, label: next.label }],
      dimPrompt: null,
      dirty: true,
    });
    this.afterHistoryJump();
    return true;
  }

  private afterHistoryJump(): void {
    const doc = this.s.doc;
    this.set({ selection: this.s.selection.filter((id) => existsIn(doc, id)) });
    if (!this.solver) return;
    const res = this.solver.solve(doc);
    this.set({ analysis: analysisFromResult(doc, res, null) });
    this.scheduleFreedom(res);
  }

  // -------------------------------------------------------------------------
  // Dokument
  // -------------------------------------------------------------------------

  newDocument(name = 'Unbenannt'): void {
    const keep = this.s;
    this.store.setState({
      ...initialState(),
      doc: createDoc(name),
      settings: keep.settings,
      currentStyle: keep.currentStyle,
      textDefaults: keep.textDefaults,
      view: { ...keep.view, cx: 0, cy: 0 },
      solverReady: keep.solverReady,
      assistantOpen: keep.assistantOpen,
    });
    this.resolveAll();
  }

  loadDocument(doc: SketchDoc, fileName: string | null = null, filePath: string | null = null): void {
    this.set({
      doc,
      past: [],
      future: [],
      selection: [],
      hover: null,
      fileName,
      filePath,
      dirty: false,
      dimPrompt: null,
      textEdit: null,
    });
    this.resolveAll();
    this.zoomToFit();
  }

  // -------------------------------------------------------------------------
  // Zeichnen
  // -------------------------------------------------------------------------

  private snapConstraints(d: SketchDoc, pointId: Id, snap: SnapRef | null | undefined, ownEntity?: Id): Id[] {
    if (!snap) return [];
    const out: Id[] = [];
    if (snap.kind === 'point') {
      const target = d.points[snap.id];
      if (!target || snap.id === pointId) return out;
      if (ownEntity && target.owner === ownEntity) return out;
      out.push(addConstraint(d, 'coincident', [pointId, snap.id]).id);
    } else if (snap.kind === 'onCurve') {
      if (snap.id === ownEntity || !d.entities[snap.id]) return out;
      const e = d.entities[snap.id];
      if (e.kind === 'line' || e.kind === 'circle') out.push(addConstraint(d, 'coincident', [pointId, snap.id]).id);
    } else if (snap.kind === 'midpoint') {
      if (snap.id === ownEntity || !lineOf(d, snap.id)) return out;
      out.push(addConstraint(d, 'midpoint', [pointId, snap.id]).id);
    }
    return out;
  }

  private defaultDimOffset(): number {
    return 26 / this.s.view.zoom;
  }

  /**
   * Zeichnet eine Linie. `prevEnd` verbindet sie mit dem Ende der vorherigen Linie (Kettenmodus).
   * `length`/`angle` sind Ausdrücke aus der direkten Werteingabe und werden zu Bemaßungen.
   */
  createLine(
    a: PlacedPoint,
    b: PlacedPoint,
    opts: {
      construction?: boolean;
      prevEnd?: Id | null;
      hv?: 'h' | 'v' | null;
      length?: string | null;
      angle?: string | null;
      noAuto?: boolean;
      style?: Style;
    } = {},
  ): CommitOutcome & { line?: LineEntity } {
    if (dist(a.pos, b.pos) < 1e-6) return { ok: false, reason: 'invalid', message: 'Linie hat die Länge 0' };
    const autoIds: Id[] = [];
    let line: LineEntity | undefined;
    const style = opts.style ?? this.s.currentStyle;
    const out = this.commit(
      opts.construction ? 'Konstruktionslinie' : 'Linie',
      (d) => {
        line = addLine(d, a.pos, b.pos, { ...style, fill: null }, !!opts.construction);
        if (opts.prevEnd && d.points[opts.prevEnd]) addConstraint(d, 'coincident', [line.p1, opts.prevEnd]);
        else if (!opts.noAuto) autoIds.push(...this.snapConstraints(d, line.p1, a.snap, line.id));
        if (!opts.noAuto) autoIds.push(...this.snapConstraints(d, line.p2, b.snap, line.id));
        if (opts.hv === 'h') autoIds.push(addConstraint(d, 'horizontal', [line.id]).id);
        if (opts.hv === 'v') autoIds.push(addConstraint(d, 'vertical', [line.id]).id);
        if (opts.length) {
          const kind: DimensionKind = opts.hv === 'h' ? 'distanceX' : opts.hv === 'v' ? 'distanceY' : 'distance';
          let refs = [line.p1, line.p2];
          if (kind === 'distanceX' && b.pos.x < a.pos.x) refs = [line.p2, line.p1];
          if (kind === 'distanceY' && b.pos.y < a.pos.y) refs = [line.p2, line.p1];
          addDimension(d, { kind, refs, expr: opts.length, value: 0, driven: false, offset: this.defaultDimOffset() });
        }
        if (opts.angle && !opts.hv) {
          addDimension(d, { kind: 'angleX', refs: [line.p1, line.p2], expr: opts.angle, value: 0, driven: false, offset: 12 / this.s.view.zoom + dist(a.pos, b.pos) * 0.35 });
        }
      },
      { autoIds },
    );
    return { ...out, line: out.ok && line ? out.doc.entities[line.id] as LineEntity : undefined };
  }

  /**
   * Linienzug bzw. geschlossenes Vieleck als ein Rückgängig-Schritt (Freihandskizze, Assistent).
   * Waagrechte/senkrechte Kanten bekommen die passende Abhängigkeit.
   */
  createPolyline(pts: Vec2[], closed: boolean, opts: { start?: PlacedPoint; end?: PlacedPoint; style?: Style; construction?: boolean } = {}): CommitOutcome & { lineIds?: Id[]; pathId?: Id } {
    const P = pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]) > 1e-6);
    if (closed && P.length > 2 && dist(P[0], P[P.length - 1]) < 1e-6) P.pop();
    if (P.length < 2) return { ok: false, reason: 'invalid', message: 'Zu wenige Punkte' };
    const lineIds: Id[] = [];
    let pathId: Id | undefined;
    let last: CommitOutcome = { ok: true, doc: this.s.doc, result: null };
    this.transaction(closed ? 'Vieleck' : 'Linienzug', () => {
      let prevEnd: Id | null = null;
      let first: Id | null = null;
      const segs = closed ? P.length : P.length - 1;
      for (let i = 0; i < segs; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        const hv = Math.abs(a.y - b.y) < 1e-9 ? 'h' : Math.abs(a.x - b.x) < 1e-9 ? 'v' : null;
        const start: PlacedPoint = prevEnd ? { pos: a } : (opts.start ?? { pos: a });
        let end: PlacedPoint = { pos: b };
        if (closed && i === segs - 1 && first) end = { pos: b, snap: { kind: 'point', id: first } };
        else if (!closed && i === segs - 1 && opts.end) end = opts.end;
        const out = this.createLine(start, end, { prevEnd, hv, style: opts.style, construction: opts.construction });
        last = out;
        if (!out.ok || !out.line) return;
        lineIds.push(out.line.id);
        if (!first) first = out.line.p1;
        prevEnd = out.line.p2;
      }
      if (closed && !opts.construction && lineIds.length >= 2) {
        const p = this.createPathFromLines(lineIds, true, opts.style);
        pathId = p.pathId;
      }
    });
    return { ...last, lineIds, pathId };
  }

  /** Fasst eine Linienkette zu einem (geschlossenen) Pfad zusammen. */
  createPathFromLines(lineIds: Id[], closed: boolean, style?: Style): CommitOutcome & { pathId?: Id } {
    let pathId: Id | undefined;
    const out = this.commit(
      'Geschlossene Kontur',
      (d) => {
        const valid = lineIds.filter((id) => lineOf(d, id) && !pathOfLine(d, id));
        if (valid.length < 2) throw new Error('Zu wenige Linien für eine Kontur');
        const p = addPath(d, valid.map((id) => ({ id, reversed: false })), closed, style ?? this.s.currentStyle);
        pathId = p.id;
      },
      { skipSolve: true },
    );
    return { ...out, pathId };
  }

  /**
   * Rechteck aus zwei Punkten (Ecke–Ecke) oder Mittelpunkt–Ecke. Erzeugt vier Linien,
   * Abhängigkeiten (koinzident, horizontal, vertikal), einen Mittelpunkt und einen Pfad.
   */
  createRectangle(
    p1: PlacedPoint,
    p2: PlacedPoint,
    mode: 'corner' | 'center',
    opts: { width?: string | null; height?: string | null; construction?: boolean; noAuto?: boolean; style?: Style } = {},
  ): CommitOutcome & { pathId?: Id; lineIds?: Id[]; centerId?: Id; widthDim?: Id; heightDim?: Id } {
    let minX: number, maxX: number, minY: number, maxY: number;
    if (mode === 'corner') {
      minX = Math.min(p1.pos.x, p2.pos.x);
      maxX = Math.max(p1.pos.x, p2.pos.x);
      minY = Math.min(p1.pos.y, p2.pos.y);
      maxY = Math.max(p1.pos.y, p2.pos.y);
    } else {
      const hw = Math.abs(p2.pos.x - p1.pos.x);
      const hh = Math.abs(p2.pos.y - p1.pos.y);
      minX = p1.pos.x - hw;
      maxX = p1.pos.x + hw;
      minY = p1.pos.y - hh;
      maxY = p1.pos.y + hh;
    }
    if (maxX - minX < 1e-6 || maxY - minY < 1e-6) return { ok: false, reason: 'invalid', message: 'Rechteck hat keine Fläche' };
    const corners: Vec2[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    const autoIds: Id[] = [];
    const ids: { pathId?: Id; lineIds: Id[]; centerId?: Id; widthDim?: Id; heightDim?: Id } = { lineIds: [] };
    const style = opts.style ?? this.s.currentStyle;
    const construction = !!opts.construction;
    const off = this.defaultDimOffset();

    const out = this.commit(
      'Rechteck',
      (d) => {
        const lines = corners.map((c, i) => addLine(d, c, corners[(i + 1) % 4], { ...style, fill: null }, construction));
        ids.lineIds = lines.map((l) => l.id);
        for (let i = 0; i < 4; i++) addConstraint(d, 'coincident', [lines[i].p2, lines[(i + 1) % 4].p1]);
        addConstraint(d, 'horizontal', [lines[0].id]);
        addConstraint(d, 'horizontal', [lines[2].id]);
        addConstraint(d, 'vertical', [lines[1].id]);
        addConstraint(d, 'vertical', [lines[3].id]);

        let pathId: Id | null = null;
        if (!construction) {
          const path = addPath(d, lines.map((l) => ({ id: l.id, reversed: false })), true, style);
          pathId = path.id;
          ids.pathId = path.id;
        }
        const center = addPoint(d, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, { construction: true, owner: pathId ?? undefined });
        ids.centerId = center;
        addConstraint(d, 'symmetric', [lines[0].p1, lines[1].p2, center]);

        // Eckpunkt zu einer Position finden (Startpunkt der Linie, die dort beginnt)
        const cornerPoint = (pos: Vec2): Id => {
          let best = 0;
          let bd = Infinity;
          corners.forEach((c, i) => {
            const dd = dist(c, pos);
            if (dd < bd) {
              bd = dd;
              best = i;
            }
          });
          return lines[best].p1;
        };
        if (!opts.noAuto) {
          if (mode === 'corner') {
            autoIds.push(...this.snapConstraints(d, cornerPoint(p1.pos), p1.snap));
            autoIds.push(...this.snapConstraints(d, cornerPoint(p2.pos), p2.snap));
          } else {
            autoIds.push(...this.snapConstraints(d, center, p1.snap));
            autoIds.push(...this.snapConstraints(d, cornerPoint(p2.pos), p2.snap));
          }
        }
        if (opts.width) {
          ids.widthDim = addDimension(d, { kind: 'distanceX', refs: [lines[0].p1, lines[0].p2], expr: opts.width, value: 0, driven: false, offset: -off }).id;
        }
        if (opts.height) {
          ids.heightDim = addDimension(d, { kind: 'distanceY', refs: [lines[1].p1, lines[1].p2], expr: opts.height, value: 0, driven: false, offset: off }).id;
        }
      },
      { autoIds },
    );
    return { ...out, ...ids };
  }

  createCircle(
    center: PlacedPoint,
    radius: number,
    opts: { rim?: PlacedPoint | null; diameter?: string | null; construction?: boolean; noAuto?: boolean; style?: Style } = {},
  ): CommitOutcome & { circleId?: Id; dimId?: Id } {
    if (!(radius > 1e-6)) return { ok: false, reason: 'invalid', message: 'Kreis hat den Radius 0' };
    const autoIds: Id[] = [];
    let circleId: Id | undefined;
    let dimId: Id | undefined;
    const style = opts.style ?? this.s.currentStyle;
    const out = this.commit(
      opts.construction ? 'Konstruktionskreis' : 'Kreis',
      (d) => {
        const c = addCircle(d, center.pos, radius, style, !!opts.construction);
        circleId = c.id;
        if (!opts.noAuto && center.snap) {
          // Mittelpunkt eines anderen Kreises → konzentrisch, sonst koinzident
          const snap = center.snap;
          const otherCircle = snap.kind === 'point' ? Object.values(d.entities).find((e) => e.kind === 'circle' && e.center === snap.id) : undefined;
          if (otherCircle) autoIds.push(addConstraint(d, 'concentric', [c.id, otherCircle.id]).id);
          else autoIds.push(...this.snapConstraints(d, c.center, snap, c.id));
        }
        if (!opts.noAuto && opts.rim?.snap?.kind === 'point' && d.points[opts.rim.snap.id]) {
          autoIds.push(addConstraint(d, 'coincident', [opts.rim.snap.id, c.id]).id);
        }
        if (opts.diameter) {
          dimId = addDimension(d, { kind: 'diameter', refs: [c.id], expr: opts.diameter, value: 0, driven: false, offset: 0, angle: Math.PI / 4 }).id;
        }
      },
      { autoIds },
    );
    return { ...out, circleId, dimId };
  }

  createText(at: PlacedPoint, text: string, opts: Partial<Pick<TextEntity, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'align'>> & { style?: Style; noAuto?: boolean } = {}): CommitOutcome & { textId?: Id } {
    const t = this.s.textDefaults;
    let textId: Id | undefined;
    const autoIds: Id[] = [];
    const fill = this.s.currentStyle.fill ?? '#1e2328';
    const out = this.commit(
      'Text',
      (d) => {
        const e = addText(d, at.pos, {
          text,
          fontFamily: opts.fontFamily ?? t.fontFamily,
          fontSize: opts.fontSize ?? t.fontSize,
          fontWeight: opts.fontWeight ?? t.fontWeight,
          italic: opts.italic ?? t.italic,
          align: opts.align ?? t.align,
          style: opts.style ?? { fill, stroke: null, strokeWidth: 0.3, opacity: 1 },
        });
        textId = e.id;
        if (!opts.noAuto) autoIds.push(...this.snapConstraints(d, e.anchor, at.snap, e.id));
      },
      { autoIds },
    );
    return { ...out, textId };
  }

  createPoint(at: PlacedPoint, noAuto = false): CommitOutcome & { pointId?: Id } {
    let pointId: Id | undefined;
    const autoIds: Id[] = [];
    const out = this.commit(
      'Punkt',
      (d) => {
        pointId = addPoint(d, at.pos);
        if (!noAuto) autoIds.push(...this.snapConstraints(d, pointId, at.snap));
      },
      { autoIds },
    );
    return { ...out, pointId };
  }

  // -------------------------------------------------------------------------
  // Abhängigkeiten
  // -------------------------------------------------------------------------

  /** Prüft und ordnet Referenzen. Gibt Fehlertext oder geordnete Referenzen zurück. */
  normalizeConstraint(doc: SketchDoc, kind: ConstraintKind, refsIn: Id[]): { refs: Id[][] } | { error: string } {
    const refs = refsIn.map((id) => resolveRef(doc, id));
    const type = (id: Id): 'point' | 'line' | 'circle' | 'text' | 'other' => {
      if (doc.points[id]) return 'point';
      const e = doc.entities[id];
      if (!e) return 'other';
      if (e.kind === 'line' || e.kind === 'circle' || e.kind === 'text') return e.kind;
      return 'other';
    };
    const t = refs.map(type);
    const label = CONSTRAINT_LABELS[kind];
    const err = (msg: string) => ({ error: `${label}: ${msg}` });
    if (new Set(refs).size !== refs.length) return err('bitte zwei verschiedene Elemente wählen');

    switch (kind) {
      case 'coincident': {
        if (refs.length !== 2) return err('zwei Elemente wählen (mindestens ein Punkt)');
        if (t[0] === 'point' && ['point', 'line', 'circle'].includes(t[1])) return { refs: [[refs[0], refs[1]]] };
        if (t[1] === 'point' && ['line', 'circle'].includes(t[0])) return { refs: [[refs[1], refs[0]]] };
        return err('einen Punkt und einen Punkt, eine Linie oder einen Kreis wählen');
      }
      case 'horizontal':
      case 'vertical': {
        if (refs.length === 1 && t[0] === 'line') return { refs: [[refs[0]]] };
        if (refs.length === 2 && t[0] === 'point' && t[1] === 'point') return { refs: [[refs[0], refs[1]]] };
        return err('eine Linie oder zwei Punkte wählen');
      }
      case 'parallel':
      case 'perpendicular':
      case 'collinear':
        if (refs.length === 2 && t[0] === 'line' && t[1] === 'line') return { refs: [[refs[0], refs[1]]] };
        return err('zwei Linien wählen');
      case 'tangent':
        if (refs.length === 2 && t[0] === 'line' && t[1] === 'circle') return { refs: [[refs[0], refs[1]]] };
        if (refs.length === 2 && t[0] === 'circle' && t[1] === 'line') return { refs: [[refs[1], refs[0]]] };
        if (refs.length === 2 && t[0] === 'circle' && t[1] === 'circle') return { refs: [[refs[0], refs[1]]] };
        return err('eine Linie und einen Kreis oder zwei Kreise wählen');
      case 'concentric':
        if (refs.length === 2 && t[0] === 'circle' && (t[1] === 'circle' || t[1] === 'point')) return { refs: [[refs[0], refs[1]]] };
        if (refs.length === 2 && t[0] === 'point' && t[1] === 'circle') return { refs: [[refs[1], refs[0]]] };
        return err('zwei Kreise oder einen Kreis und einen Punkt wählen');
      case 'equal':
        if (refs.length === 2 && t[0] === 'line' && t[1] === 'line') return { refs: [[refs[0], refs[1]]] };
        if (refs.length === 2 && t[0] === 'circle' && t[1] === 'circle') return { refs: [[refs[0], refs[1]]] };
        return err('zwei Linien oder zwei Kreise wählen');
      case 'midpoint':
        if (refs.length === 2 && t[0] === 'point' && t[1] === 'line') return { refs: [[refs[0], refs[1]]] };
        if (refs.length === 2 && t[0] === 'line' && t[1] === 'point') return { refs: [[refs[1], refs[0]]] };
        return err('einen Punkt und eine Linie wählen');
      case 'symmetric': {
        if (refs.length !== 3) return err('zwei Elemente und zuletzt die Symmetrieachse (Linie) wählen');
        if (t[0] === 'point' && t[1] === 'point' && (t[2] === 'line' || t[2] === 'point')) return { refs: [[refs[0], refs[1], refs[2]]] };
        if (t[0] === 'line' && t[1] === 'line' && t[2] === 'line') {
          const a = lineOf(doc, refs[0])!;
          const b = lineOf(doc, refs[1])!;
          const ax = lineOf(doc, refs[2])!;
          // Endpunkte paarweise über die Achse zuordnen (nächster Spiegelpunkt)
          const A = pt(doc, ax.p1);
          const B = pt(doc, ax.p2);
          const mirror = (p: Vec2): Vec2 => {
            const u = norm(sub(B, A));
            const ap = sub(p, A);
            const along = ap.x * u.x + ap.y * u.y;
            const foot = { x: A.x + u.x * along, y: A.y + u.y * along };
            return { x: 2 * foot.x - p.x, y: 2 * foot.y - p.y };
          };
          const m1 = mirror(pt(doc, a.p1));
          const straight = dist(m1, pt(doc, b.p1)) <= dist(m1, pt(doc, b.p2));
          return {
            refs: straight
              ? [
                  [a.p1, b.p1, ax.id],
                  [a.p2, b.p2, ax.id],
                ]
              : [
                  [a.p1, b.p2, ax.id],
                  [a.p2, b.p1, ax.id],
                ],
          };
        }
        return err('zwei Punkte oder zwei Linien und zuletzt die Achse wählen');
      }
      case 'fix': {
        if (refs.length !== 1) return err('ein Element wählen');
        if (t[0] === 'point' || t[0] === 'circle') return { refs: [[refs[0]]] };
        if (t[0] === 'line') {
          const l = lineOf(doc, refs[0])!;
          return { refs: [[l.p1], [l.p2]] };
        }
        if (t[0] === 'text') return { refs: [[(doc.entities[refs[0]] as TextEntity).anchor]] };
        return err('einen Punkt, eine Linie oder einen Kreis wählen');
      }
    }
  }

  addConstraint(kind: ConstraintKind, refs: Id[]): CommitOutcome & { ids?: Id[] } {
    const doc = this.s.doc;
    const norm = this.normalizeConstraint(doc, kind, refs);
    if ('error' in norm) return { ok: false, reason: 'invalid', message: norm.error };
    const existing = Object.values(doc.constraints);
    const sameRefs = (c: Constraint, r: Id[]) => c.kind === kind && c.refs.length === r.length && c.refs.every((x, i) => x === r[i]);
    const fresh = norm.refs.filter((r) => !existing.some((c) => sameRefs(c, r)));
    if (!fresh.length) return { ok: false, reason: 'invalid', message: `„${CONSTRAINT_LABELS[kind]}“ besteht bereits.` };
    const ids: Id[] = [];
    const out = this.commit(`Abhängigkeit „${CONSTRAINT_LABELS[kind]}“`, (d) => {
      for (const r of fresh) {
        const fixedAt = kind === 'fix' ? fixValuesFor(d, r[0]) ?? undefined : undefined;
        ids.push(addConstraint(d, kind, r, fixedAt).id);
      }
    });
    if (!out.ok && out.reason === 'over') {
      return { ...out, message: `„${CONSTRAINT_LABELS[kind]}“ ist nicht möglich: ${out.message}` };
    }
    return { ...out, ids };
  }

  // -------------------------------------------------------------------------
  // Bemaßungen
  // -------------------------------------------------------------------------

  /** Ordnet Referenzen so, dass horizontale/vertikale Abstände positiv sind. */
  normalizeDimension(doc: SketchDoc, spec: DimensionSpec): DimensionSpec {
    if (spec.kind === 'distanceX' || spec.kind === 'distanceY') {
      const m = measureDim(doc, spec);
      if (m < 0) return { ...spec, refs: [spec.refs[1], spec.refs[0]], offset: spec.offset };
    }
    return spec;
  }

  addDimension(specIn: DimensionSpec, opts: { expr?: string; driven?: boolean } = {}): CommitOutcome & { dimId?: Id } {
    const doc = this.s.doc;
    const spec = this.normalizeDimension(doc, specIn);
    const measured = measureDim(doc, spec);
    if (!Number.isFinite(measured)) return { ok: false, reason: 'invalid', message: 'Diese Auswahl lässt sich nicht bemaßen.' };
    const isLen = !(spec.kind === 'angle' || spec.kind === 'angleX');
    if (isLen && Math.abs(measured) < 1e-6 && !opts.expr && !opts.driven) {
      return { ok: false, reason: 'invalid', message: 'Abstand ist 0 – dafür „Koinzident“ verwenden.' };
    }
    const existingSame = Object.values(doc.dims).find((x) => x.kind === spec.kind && x.refs.join() === spec.refs.join());
    if (existingSame) return { ok: false, reason: 'invalid', message: `Diese Bemaßung gibt es bereits (${existingSame.name}).` };
    let dimId: Id | undefined;
    const value = Math.abs(measured);
    const expr = opts.expr ?? numberToExpr(value);
    const out = this.commit(opts.driven ? 'Getriebene Bemaßung' : 'Bemaßung', (d) => {
      dimId = addDimension(d, {
        kind: spec.kind,
        refs: spec.refs,
        expr,
        value,
        driven: !!opts.driven,
        offset: spec.offset ?? this.defaultDimOffset(),
        shift: spec.shift ?? 0,
        angle: spec.angle,
      }).id;
    });
    if (!out.ok && out.reason === 'over') {
      return { ...out, message: 'Diese Bemaßung würde die Skizze überbestimmen. Als getriebene Bemaßung (Referenz) anlegen?' };
    }
    return { ...out, dimId };
  }

  /** Neuer Wert/Ausdruck für eine Bemaßung. Große Sprünge werden schrittweise gelöst. */
  setDimensionExpr(id: Id, expr: string): CommitOutcome {
    const doc = this.s.doc;
    const dim = doc.dims[id];
    if (!dim) return { ok: false, reason: 'invalid', message: 'Bemaßung nicht gefunden' };
    const trimmed = expr.trim();
    if (dim.driven) return { ok: false, reason: 'invalid', message: `${dim.name} ist getrieben – erst auf „treibend“ umschalten.` };
    const label = `Bemaßung ${dim.name}`;
    const first = this.commit(label, (d) => {
      d.dims[id].expr = trimmed;
    });
    if (first.ok || first.reason !== 'over' || !this.solver) return first;

    // Schrittweise annähern (verhindert Umklappen/Scheitern bei großen Änderungen)
    const ev = evaluateDims(produce(doc, (d) => void (d.dims[id].expr = trimmed)));
    const target = ev.values[id];
    if (target === undefined) return first;
    for (const steps of [4, 16]) {
      let work = doc;
      let failed = false;
      for (let i = 1; i < steps; i++) {
        const v = dim.value + ((target - dim.value) * i) / steps;
        const stepDoc = produce(work, (d) => {
          d.dims[id].expr = String(v);
          d.dims[id].value = v;
        });
        const r = this.solver.solve(stepDoc);
        if (!r.ok) {
          failed = true;
          break;
        }
        work = applySolution(stepDoc, r);
      }
      if (failed) continue;
      const out = this.commit(label, (d) => void (d.dims[id].expr = trimmed), { from: work });
      if (out.ok) return out;
    }
    return { ...first, message: `${dim.name} = ${trimmed} lässt sich mit den übrigen Vorgaben nicht erreichen.` };
  }

  setDimensionDriven(id: Id, driven: boolean): CommitOutcome {
    const dim = this.s.doc.dims[id];
    if (!dim) return { ok: false, reason: 'invalid', message: 'Bemaßung nicht gefunden' };
    const out = this.commit(driven ? `${dim.name} getrieben` : `${dim.name} treibend`, (d) => {
      const x = d.dims[id];
      x.driven = driven;
      if (!driven) x.expr = numberToExpr(x.value);
    });
    if (!out.ok && out.reason === 'over') return { ...out, message: `${dim.name} kann nicht treibend werden: ${out.message}` };
    return out;
  }

  /** Wechselt zwischen Radius und Durchmesser. */
  toggleRadiusDiameter(id: Id): CommitOutcome {
    const dim = this.s.doc.dims[id];
    if (!dim || (dim.kind !== 'radius' && dim.kind !== 'diameter')) return { ok: false, reason: 'invalid', message: 'Keine Radius-/Durchmesserbemaßung' };
    return this.commit('Radius/Durchmesser', (d) => {
      const x = d.dims[id];
      const toDia = x.kind === 'radius';
      x.kind = toDia ? 'diameter' : 'radius';
      x.value = toDia ? x.value * 2 : x.value / 2;
      x.expr = numberToExpr(x.value);
    });
  }

  /** Verschiebt die Platzierung einer Bemaßung (ohne Lösen). */
  placeDimension(id: Id, place: Partial<Pick<Dimension, 'offset' | 'shift' | 'angle'>>, record = true): void {
    const doc = produce(this.s.doc, (d) => {
      const x = d.dims[id];
      if (!x) return;
      if (place.offset !== undefined) x.offset = place.offset;
      if (place.shift !== undefined) x.shift = place.shift;
      if (place.angle !== undefined) x.angle = place.angle;
    });
    if (record) this.accept(this.s.doc, doc, 'Bemaßung verschieben', null);
    else this.set({ doc });
  }

  // -------------------------------------------------------------------------
  // Bearbeiten
  // -------------------------------------------------------------------------

  deleteIds(ids: Id[]): CommitOutcome {
    const doc = this.s.doc;
    const targets = ids.filter((id) => existsIn(doc, id) && id !== ORIGIN_ID);
    if (!targets.length) return { ok: false, reason: 'invalid', message: 'Nichts zum Löschen ausgewählt' };
    const out = this.commit(
      'Löschen',
      (d) => {
        const before = new Set(Object.keys(d.dims));
        deleteIds(d, targets);
        // Ausdrücke, die gelöschte Bemaßungen verwenden, durch den Zahlenwert ersetzen
        const removed = [...before].filter((id) => !d.dims[id]).map((id) => doc.dims[id]);
        for (const r of removed) {
          for (const other of Object.values(d.dims)) {
            if (namesInExpr(other.expr).includes(r.name)) other.expr = replaceName(other.expr, r.name, numberToExpr(r.value));
          }
        }
      },
      { allowOver: true, select: [] },
    );
    return out;
  }

  deleteSelection(): CommitOutcome {
    return this.deleteIds(this.s.selection);
  }

  /** Stiländerung für Objekte (Linie im Pfad → Pfad). */
  /**
   * Größe einer freien Form über eine treibende Breiten- oder Höhenbemaßung festlegen
   * (proportional). Eine vorhandene treibende Bemaßung der anderen Richtung wird getrieben.
   */
  setShapeSize(id: Id, kind: 'width' | 'height', expr: string): CommitOutcome {
    const doc = this.s.doc;
    const sh = doc.entities[id];
    if (!sh || sh.kind !== 'shape') return { ok: false, reason: 'invalid', message: 'Keine Form ausgewählt.' };
    const trimmed = expr.trim();
    if (!trimmed) return { ok: false, reason: 'invalid', message: 'Bitte einen Wert eingeben.' };
    const dims = Object.values(doc.dims).filter((m) => m.refs[0] === id && (m.kind === 'width' || m.kind === 'height'));
    const own = dims.find((m) => m.kind === kind);
    return this.commit(kind === 'width' ? 'Breite der Form' : 'Höhe der Form', (d) => {
      for (const m of dims) if (m.kind !== kind && !m.driven) d.dims[m.id].driven = true;
      if (own) {
        d.dims[own.id].expr = trimmed;
        d.dims[own.id].driven = false;
      } else {
        addDimension(d, { kind, refs: [id], expr: trimmed, value: 0, driven: false, offset: 8 / this.s.view.zoom + 4, shift: 0 });
      }
    });
  }

  setStyle(ids: Id[], patch: Partial<Style>): CommitOutcome {
    const targets = drawableTargets(this.s.doc, ids);
    if (!targets.length) {
      this.set({ currentStyle: { ...this.s.currentStyle, ...patch } });
      return { ok: true, doc: this.s.doc, result: null };
    }
    return this.commit(
      'Stil ändern',
      (d) => {
        for (const id of targets) {
          const e = d.entities[id];
          if (!e) continue;
          e.style = { ...e.style, ...patch };
          if (e.kind === 'line') e.style.fill = null;
        }
      },
      { skipSolve: true },
    );
  }

  /** Setzt komplette Stile mehrerer Objekte (z. B. Stilvorschlag) als ein Schritt. */
  setStyles(styles: Record<Id, Style>, label = 'Stilvorschlag'): CommitOutcome {
    return this.commit(
      label,
      (d) => {
        for (const [id, st] of Object.entries(styles)) {
          const e = d.entities[id];
          if (e) e.style = { ...st, fill: e.kind === 'line' ? null : st.fill };
        }
      },
      { skipSolve: true },
    );
  }

  setTextProps(id: Id, patch: Partial<Pick<TextEntity, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'align'>>): CommitOutcome {
    return this.commit(
      'Text ändern',
      (d) => {
        const e = d.entities[id];
        if (e?.kind !== 'text') throw new Error('Kein Text');
        Object.assign(e, patch);
      },
      { skipSolve: true },
    );
  }

  toggleConstruction(ids: Id[]): CommitOutcome {
    const doc = this.s.doc;
    const ents = [...new Set(ids.map((id) => resolveRef(doc, id)))].filter((id) => {
      const e = doc.entities[id];
      return e && (e.kind === 'line' || e.kind === 'circle' || e.kind === 'path');
    });
    if (!ents.length) return { ok: false, reason: 'invalid', message: 'Linien oder Kreise wählen' };
    return this.commit(
      'Konstruktion umschalten',
      (d) => {
        const lines = new Set<Id>();
        for (const id of ents) {
          const e = d.entities[id];
          if (!e) continue;
          if (e.kind === 'path') {
            e.edges.forEach((ed) => lines.add(ed.id));
            dissolvePath(d, e.id);
          } else if (e.kind === 'line') {
            const p = pathOfLine(d, e.id);
            if (p) dissolvePath(d, p.id);
            lines.add(e.id);
          } else {
            e.construction = !e.construction;
          }
        }
        const target = ![...lines].every((l) => (d.entities[l] as LineEntity | undefined)?.construction);
        for (const l of lines) {
          const e = d.entities[l];
          if (e) e.construction = target;
        }
      },
      { skipSolve: true },
    );
  }

  arrange(ids: Id[], how: 'front' | 'back' | 'forward' | 'backward'): CommitOutcome {
    const targets = drawableTargets(this.s.doc, ids);
    if (!targets.length) return { ok: false, reason: 'invalid', message: 'Objekte wählen' };
    const labels = { front: 'Ganz nach vorne', back: 'Ganz nach hinten', forward: 'Nach vorne', backward: 'Nach hinten' };
    return this.commit(
      labels[how],
      (d) => {
        const sel = new Set(targets);
        let order = [...d.order];
        if (how === 'front') order = [...order.filter((x) => !sel.has(x)), ...order.filter((x) => sel.has(x))];
        else if (how === 'back') order = [...order.filter((x) => sel.has(x)), ...order.filter((x) => !sel.has(x))];
        else if (how === 'forward') {
          for (let i = order.length - 2; i >= 0; i--) {
            if (sel.has(order[i]) && !sel.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
          }
        } else {
          for (let i = 1; i < order.length; i++) {
            if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
          }
        }
        d.order = order;
      },
      { skipSolve: true },
    );
  }

  // ---- Zwischenablage ----

  copy(ids: Id[] = this.s.selection): number {
    const doc = this.s.doc;
    const targets = drawableTargets(doc, ids);
    if (!targets.length) return 0;
    this.clipboard = { doc, ids: targets };
    return targets.length;
  }

  /** Fügt kopierte Objekte versetzt ein (inkl. innerer Abhängigkeiten und Bemaßungen). */
  paste(offset: Vec2 = { x: 10, y: -10 }): CommitOutcome & { ids?: Id[] } {
    const clip = this.clipboard;
    if (!clip) return { ok: false, reason: 'invalid', message: 'Zwischenablage ist leer' };
    let created: Id[] = [];
    const out = this.commit(
      'Einfügen',
      (d) => {
        created = cloneInto(d, clip.doc, clip.ids);
        applyXf(d, created, { kind: 'move', dx: offset.x, dy: offset.y });
      },
      { autoIds: [] },
    );
    if (out.ok) this.set({ selection: created });
    return { ...out, ids: created };
  }

  /**
   * Verschieben, Drehen, Skalieren oder Spiegeln der Auswahl (mit `copy`: als Kopie).
   * Gebundene Geometrie folgt dem Solver; Hinweise (z. B. Text nicht drehbar) als Meldung.
   */
  transform(xf: Xf, opts: { ids?: Id[]; copy?: boolean; label?: string } = {}): CommitOutcome & { ids?: Id[] } {
    const doc = this.s.doc;
    const targets = drawableTargets(doc, opts.ids ?? this.s.selection);
    if (!targets.length) return { ok: false, reason: 'invalid', message: 'Zuerst Objekte auswählen.' };
    const report: XfReport = { notes: new Set() };
    let result = targets;
    const label = opts.label ?? XF_LABELS[xf.kind] + (opts.copy ? ' (Kopie)' : '');
    const out = this.commit(label, (d) => {
      if (opts.copy) result = cloneInto(d, doc, targets);
      applyXf(d, result, xf, report);
    });
    if (out.ok) {
      this.set({ selection: result });
      for (const n of report.notes) this.toast(n, 'info', 6000);
    }
    return { ...out, ids: result };
  }

  /** Stutzen: das angeklickte Stück einer Linie bis zu den nächsten Schnittpunkten entfernen. */
  trim(lineId: Id, click: Vec2): CommitOutcome {
    let res: TrimResult = { kind: 'none' };
    const out = this.commit(
      'Stutzen',
      (d) => {
        res = trimLine(d, lineId, click);
        if (res.kind === 'delete') deleteIds(d, [lineId]);
      },
      { allowOver: true },
    );
    if (out.ok && res.kind === 'none') return { ok: false, reason: 'invalid', message: 'Hier gibt es nichts zu stutzen.' };
    return out;
  }

  /** Dehnen: Linienende bis zur nächsten Geometrie verlängern. */
  extend(lineId: Id, click: Vec2): CommitOutcome {
    let done = false;
    const out = this.commit('Dehnen', (d) => void (done = extendLine(d, lineId, click)), { allowOver: true });
    if (out.ok && !done) return { ok: false, reason: 'invalid', message: 'In Verlängerung der Linie liegt keine Geometrie, bis zu der gedehnt werden kann.' };
    return out;
  }

  duplicate(ids: Id[] = this.s.selection): CommitOutcome & { ids?: Id[] } {
    const keep = this.clipboard;
    if (!this.copy(ids)) return { ok: false, reason: 'invalid', message: 'Objekte wählen' };
    const out = this.paste();
    this.clipboard = keep ?? this.clipboard;
    return out;
  }

  // -------------------------------------------------------------------------
  // Ziehen (interaktiv, mit Solver)
  // -------------------------------------------------------------------------

  beginDrag(label = 'Verschieben'): void {
    this.dragBase = this.s.doc;
    this.dragLabel = label;
  }

  get dragging(): boolean {
    return this.dragBase !== null;
  }

  dragTo(spec: DragSpec): boolean {
    if (!this.solver || !this.dragBase) return false;
    const doc = this.s.doc;
    const res = this.solver.solve(doc, { drag: spec });
    if (!res.ok) return false;
    const next = refreshDriven(applySolution(doc, res));
    if (next !== doc) this.set({ doc: next });
    return true;
  }

  /** Verschiebt nur Bemaßungsplatzierungen etc. während des Ziehens (ohne Solver). */
  dragDoc(recipe: Recipe): void {
    if (!this.dragBase) return;
    this.set({ doc: produce(this.s.doc, recipe) });
  }

  endDrag(): void {
    const base = this.dragBase;
    this.dragBase = null;
    if (!base) return;
    const doc = this.s.doc;
    if (doc === base) return;
    const patch: Partial<AppState> = {
      past: [...this.s.past, { doc: base, label: this.dragLabel }].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    };
    this.set(patch);
    if (this.solver) {
      const res = this.solver.solve(doc);
      this.set({ analysis: analysisFromResult(doc, res, this.s.analysis.free) });
      this.scheduleFreedom(res);
    }
  }

  cancelDrag(): void {
    if (this.dragBase) this.set({ doc: this.dragBase });
    this.dragBase = null;
  }

  // -------------------------------------------------------------------------
  // Auswahl, Ansicht, Meldungen
  // -------------------------------------------------------------------------

  select(idsIn: Id[], mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    const cur = this.s.selection;
    // Gruppen werden immer als Ganzes ausgewählt
    const doc = this.s.doc;
    const ids = [...new Set(idsIn.flatMap((id) => groupMembers(doc, id)))];
    let next: Id[];
    if (mode === 'replace') next = [...new Set(ids)];
    else if (mode === 'add') next = [...new Set([...cur, ...ids])];
    else {
      const set = new Set(cur);
      for (const id of ids) {
        if (set.has(id)) set.delete(id);
        else set.add(id);
      }
      next = [...set];
    }
    this.set({ selection: next });
  }

  selectAll(): void {
    const doc = this.s.doc;
    this.set({ selection: doc.order.filter((id) => !isInert(doc, id)) });
  }

  // -------------------------------------------------------------------------
  // Ebenen und Gruppen
  // -------------------------------------------------------------------------

  /** Ebene für neue Objekte: gewählte, sonst oberste sichtbare und nicht gesperrte. */
  targetLayer(doc: SketchDoc = this.s.doc): Id {
    const ls = layersOf(doc);
    const a = this.s.activeLayer;
    const act = ls.find((l) => l.id === a && l.visible && !l.locked);
    if (act) return act.id;
    const top = [...ls].reverse().find((l) => l.visible && !l.locked);
    return (top ?? ls[ls.length - 1]).id;
  }

  setActiveLayer(id: Id): void {
    this.set({ activeLayer: id });
  }

  addLayer(name?: string): Id {
    let id = '';
    this.commit(
      'Ebene hinzufügen',
      (d) => {
        if (!d.layers || !d.layers.length) d.layers = [{ ...DEFAULT_LAYER }];
        id = newId(d, 'L');
        d.layers.push({ id, name: name ?? `Ebene ${d.layers.length + 1}`, visible: true, locked: false });
      },
      { skipSolve: true },
    );
    this.set({ activeLayer: id });
    return id;
  }

  /** Produktionsangaben ändern (Artikel, Motive, Varianten …) – ein Rückgängig-Schritt. */
  updateProduction(label: string, recipe: (p: Production) => void): CommitOutcome {
    return this.commit(
      label,
      (d) => {
        if (!d.production) d.production = productionOf(d as SketchDoc);
        recipe(d.production);
      },
      { skipSolve: true },
    );
  }

  updateLayer(id: Id, patch: Partial<Pick<Layer, 'name' | 'visible' | 'locked'>>): CommitOutcome {
    const label = patch.name !== undefined ? 'Ebene umbenennen' : patch.visible !== undefined ? (patch.visible ? 'Ebene einblenden' : 'Ebene ausblenden') : patch.locked ? 'Ebene sperren' : 'Ebene entsperren';
    const out = this.commit(
      label,
      (d) => {
        if (!d.layers || !d.layers.length) d.layers = [{ ...DEFAULT_LAYER }];
        const l = d.layers.find((x) => x.id === id);
        if (l) Object.assign(l, patch);
      },
      { skipSolve: true },
    );
    // Ausgeblendetes/Gesperrtes kann nicht ausgewählt bleiben
    const doc = this.s.doc;
    this.set({ selection: this.s.selection.filter((x) => !isInert(doc, x)) });
    return out;
  }

  /** Ebene nach oben (+1) oder unten (−1) schieben. */
  moveLayer(id: Id, dir: 1 | -1): CommitOutcome {
    return this.commit(
      'Ebene verschieben',
      (d) => {
        if (!d.layers || !d.layers.length) d.layers = [{ ...DEFAULT_LAYER }];
        const i = d.layers.findIndex((x) => x.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= d.layers.length) return;
        [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
      },
      { skipSolve: true },
    );
  }

  /** Löscht eine Ebene; ihre Objekte wandern auf die Ebene darunter (bzw. darüber). */
  deleteLayer(id: Id): CommitOutcome {
    const ls = layersOf(this.s.doc);
    if (ls.length < 2) return { ok: false, reason: 'invalid', message: 'Die letzte Ebene kann nicht gelöscht werden.' };
    const i = ls.findIndex((l) => l.id === id);
    const target = ls[i > 0 ? i - 1 : 1].id;
    return this.commit(
      'Ebene löschen',
      (d) => {
        d.layers = layersOf(d).filter((l) => l.id !== id).map((l) => ({ ...l }));
        for (const e of Object.values(d.entities)) if (layerIdOf(this.s.doc, e) === id) e.layer = target;
      },
      { skipSolve: true },
    );
  }

  moveToLayer(ids: Id[], layerId: Id): CommitOutcome {
    const targets = drawableTargets(this.s.doc, ids);
    if (!targets.length) return { ok: false, reason: 'invalid', message: 'Nichts ausgewählt.' };
    return this.commit(
      'Auf Ebene verschieben',
      (d) => {
        if (!d.layers || !d.layers.length) d.layers = [{ ...DEFAULT_LAYER }];
        for (const id of targets) {
          for (const m of groupMembers(d, id)) {
            const e = d.entities[m];
            if (e) e.layer = layerId;
          }
        }
      },
      { skipSolve: true },
    );
  }

  /** Verschiebt Objekte (ihre Punkte) um je einen Versatz; gebundene Geometrie folgt dem Solver. */
  translate(moves: Map<Id, Vec2>, label = 'Verschieben'): CommitOutcome {
    const doc = this.s.doc;
    const delta = new Map<Id, Vec2>();
    for (const [id, v] of moves) {
      for (const m of groupMembers(doc, id)) {
        const e = doc.entities[m];
        if (!e) continue;
        for (const pid of entityPointIds(doc, e)) if (pid !== ORIGIN_ID && !delta.has(pid)) delta.set(pid, v);
      }
    }
    if (!delta.size) return { ok: false, reason: 'invalid', message: 'Nichts zu verschieben.' };
    return this.commit(label, (d) => {
      for (const [pid, v] of delta) {
        const p = d.points[pid];
        if (!p) continue;
        p.x += v.x;
        p.y += v.y;
      }
      for (const c of Object.values(d.constraints)) {
        if (c.kind === 'fix' && c.fixedAt && delta.has(c.refs[0])) {
          const v = delta.get(c.refs[0])!;
          c.fixedAt[0] += v.x;
          c.fixedAt[1] += v.y;
        }
      }
    });
  }

  /** Ausrichten an der gemeinsamen Box der Auswahl. */
  align(how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom', ids: Id[] = this.s.selection): CommitOutcome {
    const doc = this.s.doc;
    const targets = unitTargets(doc, ids);
    if (targets.length < 2) return { ok: false, reason: 'invalid', message: 'Zum Ausrichten mindestens zwei Objekte auswählen.' };
    const boxes = targets.map((t) => unitBox(doc, t)).filter((b): b is NonNullable<typeof b> => !!b);
    const all = { minX: Math.min(...boxes.map((b) => b.minX)), maxX: Math.max(...boxes.map((b) => b.maxX)), minY: Math.min(...boxes.map((b) => b.minY)), maxY: Math.max(...boxes.map((b) => b.maxY)) };
    const moves = new Map<Id, Vec2>();
    targets.forEach((t, i) => {
      const b = boxes[i];
      if (!b) return;
      let dx = 0;
      let dy = 0;
      if (how === 'left') dx = all.minX - b.minX;
      if (how === 'right') dx = all.maxX - b.maxX;
      if (how === 'hcenter') dx = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2;
      if (how === 'bottom') dy = all.minY - b.minY;
      if (how === 'top') dy = all.maxY - b.maxY;
      if (how === 'vcenter') dy = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2;
      if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) moves.set(t[0], { x: dx, y: dy });
    });
    if (!moves.size) return { ok: true, doc, result: null };
    return this.translate(moves, 'Ausrichten');
  }

  /** Gleichmäßig verteilen (gleiche Abstände zwischen den Objekten). */
  distribute(axis: 'x' | 'y', ids: Id[] = this.s.selection): CommitOutcome {
    const doc = this.s.doc;
    const targets = unitTargets(doc, ids);
    if (targets.length < 3) return { ok: false, reason: 'invalid', message: 'Zum Verteilen mindestens drei Objekte auswählen.' };
    const items = targets.map((t) => ({ t, b: unitBox(doc, t)! })).filter((x) => x.b);
    const lo = (b: BBoxLike) => (axis === 'x' ? b.minX : b.minY);
    const hi = (b: BBoxLike) => (axis === 'x' ? b.maxX : b.maxY);
    items.sort((a, b) => lo(a.b) + hi(a.b) - lo(b.b) - hi(b.b));
    const span = hi(items[items.length - 1].b) - lo(items[0].b);
    const sizes = items.reduce((acc, x) => acc + hi(x.b) - lo(x.b), 0);
    const gap = (span - sizes) / (items.length - 1);
    const moves = new Map<Id, Vec2>();
    let cursor = lo(items[0].b);
    for (const it of items) {
      const shift = cursor - lo(it.b);
      if (Math.abs(shift) > 1e-9) moves.set(it.t[0], axis === 'x' ? { x: shift, y: 0 } : { x: 0, y: shift });
      cursor += hi(it.b) - lo(it.b) + gap;
    }
    if (!moves.size) return { ok: true, doc, result: null };
    return this.translate(moves, 'Verteilen');
  }

  group(ids: Id[] = this.s.selection): CommitOutcome {
    const targets = drawableTargets(this.s.doc, ids);
    if (targets.length < 2) return { ok: false, reason: 'invalid', message: 'Zum Gruppieren mindestens zwei Objekte auswählen.' };
    let gid = '';
    return this.commit(
      'Gruppieren',
      (d) => {
        gid = newId(d, 'g');
        for (const id of targets) {
          for (const m of groupMembers(d, id)) {
            const e = d.entities[m];
            if (e) e.group = gid;
          }
        }
      },
      { skipSolve: true, select: targets },
    );
  }

  ungroup(ids: Id[] = this.s.selection): CommitOutcome {
    const targets = drawableTargets(this.s.doc, ids).filter((id) => this.s.doc.entities[id]?.group);
    if (!targets.length) return { ok: false, reason: 'invalid', message: 'Keine Gruppe ausgewählt.' };
    return this.commit(
      'Gruppierung aufheben',
      (d) => {
        for (const id of targets) {
          const e = d.entities[id];
          if (e) delete e.group;
        }
      },
      { skipSolve: true },
    );
  }

  setView(v: Partial<ViewState>): void {
    this.set({ view: { ...this.s.view, ...v } });
  }

  /** Alles anzeigen („F“). */
  zoomToFit(margin = 60): void {
    const doc = this.s.doc;
    const box = docBBox(doc, { construction: true });
    const { width, height } = this.viewport;
    // Bemaßungen gehören zur Ansicht dazu
    if (box && this.s.settings.showDims) {
      const z = Math.max(this.s.view.zoom, 0.02);
      for (const d of Object.values(doc.dims)) {
        const g = dimGeometry(doc, d, 1 / z);
        if (!g) continue;
        for (const p of [g.text, ...g.lines.flat()]) {
          box.minX = Math.min(box.minX, p.x - 6 / z);
          box.maxX = Math.max(box.maxX, p.x + 6 / z);
          box.minY = Math.min(box.minY, p.y - 4 / z);
          box.maxY = Math.max(box.maxY, p.y + 4 / z);
        }
      }
    }
    if (!box) {
      this.setView({ cx: 0, cy: 0, zoom: Math.max(1, Math.min(width, height) / 120) });
      return;
    }
    const w = Math.max(box.maxX - box.minX, 1);
    const h = Math.max(box.maxY - box.minY, 1);
    const zoom = Math.min((width - 2 * margin) / w, (height - 2 * margin) / h);
    this.setView({ cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, zoom: clampZoom(zoom) });
  }

  toast(text: string, kind: Toast['kind'] = 'info', ms = 4200): void {
    const id = this.toastId++;
    this.set({ toasts: [...this.s.toasts, { id, kind, text }].slice(-4) });
    setTimeout(() => this.set({ toasts: this.s.toasts.filter((t) => t.id !== id) }), ms);
  }

  confirm(req: ConfirmRequest): void {
    this.set({ confirm: req });
  }

  bumpOverlay(): void {
    this.set({ overlayTick: this.s.overlayTick + 1 });
  }
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Setzt den Maßstab von Formen aus ihren (treibenden) Breiten-/Höhenbemaßungen. */
export function applyShapeSizes(doc: SketchDoc): { doc: SketchDoc } | { error: string; ids: Id[] } {
  const byShape = new Map<Id, Dimension[]>();
  for (const dm of Object.values(doc.dims)) {
    if (dm.driven || (dm.kind !== 'width' && dm.kind !== 'height')) continue;
    const list = byShape.get(dm.refs[0]) ?? [];
    list.push(dm);
    byShape.set(dm.refs[0], list);
  }
  if (!byShape.size) return { doc };
  for (const [sid, list] of byShape) {
    if (list.length > 1) return { error: 'Breite und Höhe einer Form legen beide ihre Größe fest. Lege eine davon als getriebene Bemaßung (Referenz) an.', ids: list.map((x) => x.id) };
    if (!doc.entities[sid]) continue;
  }
  const next = produce(doc, (d) => {
    for (const [sid, list] of byShape) {
      const s = d.entities[sid];
      if (!s || s.kind !== 'shape') continue;
      const dm = list[0];
      const local = shapeSize({ ...s, scale: 1 } as ShapeEntity);
      const base = dm.kind === 'width' ? local.w : local.h;
      if (base > 1e-9) {
        const k = dm.value / base;
        if (Math.abs(k - s.scale) > 1e-12) s.scale = k;
      }
    }
  });
  return { doc: next };
}

type BBoxLike = { minX: number; minY: number; maxX: number; maxY: number };

/** Auswahl als Einheiten: Gruppen zählen als ein Objekt. */
export function unitTargets(doc: SketchDoc, ids: Id[]): Id[][] {
  const seen = new Set<Id>();
  const out: Id[][] = [];
  for (const id of drawableTargets(doc, ids)) {
    if (seen.has(id)) continue;
    const members = groupMembers(doc, id);
    members.forEach((m) => seen.add(m));
    out.push(members);
  }
  return out;
}

export function unitBox(doc: SketchDoc, members: Id[]): BBoxLike | null {
  return docBBox(doc, { only: new Set(members) });
}

export const XF_LABELS: Record<Xf['kind'], string> = { move: 'Verschieben', rotate: 'Drehen', scale: 'Skalieren', mirror: 'Spiegeln' };

export function clampZoom(z: number): number {
  return Math.min(400, Math.max(0.02, z));
}

export function existsIn(doc: SketchDoc, id: Id): boolean {
  return !!(doc.points[id] || doc.entities[id] || doc.constraints[id] || doc.dims[id]);
}

/** Pfad → Pfad, eigener Punkt eines Kreises → Kreis (für Abhängigkeiten: nur Punkte bleiben Punkte). */
export function resolveRef(_doc: SketchDoc, id: Id): Id {
  return id;
}

/** Zeichenbare Ziele einer Auswahl: Linie im Pfad → Pfad, eigener Punkt → Besitzer. */
export function drawableTargets(doc: SketchDoc, ids: Id[]): Id[] {
  const out = new Set<Id>();
  for (const id of ids) {
    let target: Id | undefined = id;
    const p = doc.points[id];
    if (p) target = p.owner;
    if (!target) continue;
    const e = doc.entities[target];
    if (!e) continue;
    if (e.kind === 'line') {
      const path = pathOfLine(doc, e.id);
      out.add(path ? path.id : e.id);
    } else out.add(e.id);
  }
  return [...out].filter((id) => doc.order.includes(id));
}

/** Übernimmt Solver-Ergebnis ins Modell (nur geänderte Werte). */
export function applySolution(doc: SketchDoc, res: SolveResult): SketchDoc {
  return produce(doc, (d) => {
    for (const [id, pos] of Object.entries(res.points)) {
      const p = d.points[id];
      if (!p) continue;
      const x = cleanCoord(pos.x);
      const y = cleanCoord(pos.y);
      if (p.x !== x) p.x = x;
      if (p.y !== y) p.y = y;
    }
    for (const [id, r] of Object.entries(res.radii)) {
      const c = d.entities[id];
      const rr = cleanCoord(r);
      if (c?.kind === 'circle' && c.r !== rr) c.r = rr;
    }
  });
}

/** Entfernt numerisches Rauschen des Solvers (1e-10 mm), ohne echte Werte zu verfälschen. */
function cleanCoord(v: number): number {
  const r = Math.round(v * 1e9) / 1e9;
  return Object.is(r, -0) ? 0 : r;
}

/** Aktualisiert die Messwerte getriebener Bemaßungen. */
export function refreshDriven(doc: SketchDoc): SketchDoc {
  const driven = Object.values(doc.dims).filter((d) => d.driven);
  if (!driven.length) return doc;
  return produce(doc, (d) => {
    for (const m of driven) {
      const v = displayValue(d, m);
      if (Number.isFinite(v) && d.dims[m.id].value !== v) d.dims[m.id].value = v;
    }
  });
}

/** Hilfsfunktion für Werkzeuge: Mittelpunkt zweier Punkt-Ids. */
export function midOf(doc: SketchDoc, a: Id, b: Id): Vec2 {
  return mid(pt(doc, a), pt(doc, b));
}

/** Bemaßungswert aus Ausdruck (für Vorschauen), ohne Fehler zu werfen. */
export function tryEvaluate(expr: string, doc: SketchDoc): number | null {
  try {
    const byName = new Map(Object.values(doc.dims).map((d) => [d.name, d.value]));
    return evaluate(expr, (n) => byName.get(n));
  } catch (e) {
    if (e instanceof ExprError) return null;
    return null;
  }
}

export { withSolution, circleOf };
