import type {
  CircleEntity,
  Constraint,
  ConstraintKind,
  Dimension,
  Entity,
  Id,
  LineEntity,
  PathEdge,
  PathEntity,
  SketchDoc,
  SketchPoint,
  Style,
  TextAlign,
  TextEntity,
  Vec2,
} from './types';
import { ORIGIN_ID } from './types';

export const DEFAULT_STYLE: Style = { fill: null, stroke: '#1e2328', strokeWidth: 0.5, opacity: 1 };
export const DEFAULT_TEXT_STYLE: Style = { fill: '#1e2328', stroke: null, strokeWidth: 0.3, opacity: 1 };

export function createDoc(name = 'Unbenannt'): SketchDoc {
  return {
    format: 'vektordesign',
    version: 1,
    name,
    points: { [ORIGIN_ID]: { id: ORIGIN_ID, x: 0, y: 0, locked: true, construction: true } },
    entities: {},
    constraints: {},
    dims: {},
    order: [],
    nextId: 1,
    nextDim: 0,
  };
}

// ---------------------------------------------------------------------------
// Lesen
// ---------------------------------------------------------------------------

export function pt(doc: SketchDoc, id: Id): SketchPoint {
  const p = doc.points[id];
  if (!p) throw new Error(`Punkt ${id} fehlt`);
  return p;
}

export function isPoint(doc: SketchDoc, id: Id): boolean {
  return id in doc.points;
}

export function entityOf<K extends Entity['kind']>(doc: SketchDoc, id: Id, kind: K): Extract<Entity, { kind: K }> | undefined {
  const e = doc.entities[id];
  return e && e.kind === kind ? (e as Extract<Entity, { kind: K }>) : undefined;
}

export const lineOf = (doc: SketchDoc, id: Id) => entityOf(doc, id, 'line');
export const circleOf = (doc: SketchDoc, id: Id) => entityOf(doc, id, 'circle');

export function lineEnds(doc: SketchDoc, l: LineEntity): [Vec2, Vec2] {
  return [pt(doc, l.p1), pt(doc, l.p2)];
}

/** Alle Punkt-Ids, die ein Objekt direkt referenziert. */
export function entityPointIds(doc: SketchDoc, e: Entity): Id[] {
  switch (e.kind) {
    case 'line':
      return [e.p1, e.p2];
    case 'circle':
      return [e.center];
    case 'text':
    case 'shape':
    case 'image':
      return [e.anchor];
    case 'path': {
      const ids: Id[] = [];
      for (const edge of e.edges) {
        const l = lineOf(doc, edge.id);
        if (l) ids.push(l.p1, l.p2);
      }
      for (const p of Object.values(doc.points)) if (p.owner === e.id) ids.push(p.id);
      return ids;
    }
  }
}

/** Pfad, zu dem eine Linie gehört. */
export function pathOfLine(doc: SketchDoc, lineId: Id): PathEntity | undefined {
  for (const e of Object.values(doc.entities)) {
    if (e.kind === 'path' && e.edges.some((ed) => ed.id === lineId)) return e;
  }
  return undefined;
}

/** Eckpunkte eines Pfads in Durchlaufrichtung (Startpunkte der Kanten). */
export function pathVertices(doc: SketchDoc, path: PathEntity): Vec2[] {
  const out: Vec2[] = [];
  for (const edge of path.edges) {
    const l = lineOf(doc, edge.id);
    if (!l) continue;
    out.push(pt(doc, edge.reversed ? l.p2 : l.p1));
  }
  if (!path.closed && path.edges.length) {
    const last = path.edges[path.edges.length - 1];
    const l = lineOf(doc, last.id);
    if (l) out.push(pt(doc, last.reversed ? l.p1 : l.p2));
  }
  return out;
}

/** Ids, die eine Abhängigkeit oder Bemaßung referenziert (für Kaskaden). */
export function referencedIds(item: Constraint | Dimension): Id[] {
  return item.refs;
}

/** Objekt, das ein Punkt „repräsentiert“ (für Auswahl): Besitzer oder der Punkt selbst. */
export function ownerOrSelf(doc: SketchDoc, pointId: Id): Id {
  return doc.points[pointId]?.owner ?? pointId;
}

/** Linien, die nicht Teil eines Pfads sind, plus Pfade/Kreise/Texte – also alles Zeichenbare. */
export function drawableIds(doc: SketchDoc): Id[] {
  return doc.order.filter((id) => doc.entities[id]);
}

// ---------------------------------------------------------------------------
// Schreiben (auf immer-Drafts oder frischen Objekten)
// ---------------------------------------------------------------------------

export function newId(d: SketchDoc, prefix: string): Id {
  let id = `${prefix}${d.nextId++}`;
  while (d.points[id] || d.entities[id] || d.constraints[id] || d.dims[id]) id = `${prefix}${d.nextId++}`;
  return id;
}

export function addPoint(d: SketchDoc, pos: Vec2, opts: { owner?: Id; construction?: boolean } = {}): Id {
  const id = newId(d, 'p');
  const p: SketchPoint = { id, x: pos.x, y: pos.y };
  if (opts.owner) p.owner = opts.owner;
  if (opts.construction) p.construction = true;
  d.points[id] = p;
  return id;
}

export function addLine(d: SketchDoc, a: Vec2, b: Vec2, style: Style = DEFAULT_STYLE, construction = false): LineEntity {
  const id = newId(d, 'l');
  const p1 = addPoint(d, a, { owner: id });
  const p2 = addPoint(d, b, { owner: id });
  const line: LineEntity = { id, kind: 'line', p1, p2, construction, style: { ...style } };
  d.entities[id] = line;
  d.order.push(id);
  return line;
}

export function addCircle(d: SketchDoc, c: Vec2, r: number, style: Style = DEFAULT_STYLE, construction = false): CircleEntity {
  const id = newId(d, 'c');
  const center = addPoint(d, c, { owner: id });
  const circle: CircleEntity = { id, kind: 'circle', center, r, construction, style: { ...style } };
  d.entities[id] = circle;
  d.order.push(id);
  return circle;
}

export interface TextInit {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  italic?: boolean;
  align?: TextAlign;
  style?: Style;
}

export function addText(d: SketchDoc, pos: Vec2, init: TextInit): TextEntity {
  const id = newId(d, 't');
  const anchor = addPoint(d, pos, { owner: id });
  const t: TextEntity = {
    id,
    kind: 'text',
    anchor,
    text: init.text,
    fontFamily: init.fontFamily,
    fontSize: init.fontSize,
    fontWeight: init.fontWeight ?? 400,
    italic: init.italic ?? false,
    align: init.align ?? 'left',
    construction: false,
    style: { ...(init.style ?? DEFAULT_TEXT_STYLE) },
  };
  d.entities[id] = t;
  d.order.push(id);
  return t;
}

/** Fasst Linien zu einem Pfad zusammen. Die Linien verschwinden aus der Zeichenreihenfolge. */
export function addPath(d: SketchDoc, edges: PathEdge[], closed: boolean, style: Style): PathEntity {
  const id = newId(d, 'pa');
  const path: PathEntity = { id, kind: 'path', edges: edges.map((e) => ({ ...e })), closed, construction: false, style: { ...style } };
  const lineIds = new Set(edges.map((e) => e.id));
  const firstIdx = d.order.findIndex((oid) => lineIds.has(oid));
  d.order = d.order.filter((oid) => !lineIds.has(oid));
  d.entities[id] = path;
  if (firstIdx >= 0 && firstIdx <= d.order.length) d.order.splice(firstIdx, 0, id);
  else d.order.push(id);
  return path;
}

export function addConstraint(d: SketchDoc, kind: ConstraintKind, refs: Id[], fixedAt?: number[]): Constraint {
  const id = newId(d, 'k');
  const c: Constraint = { id, kind, refs: [...refs] };
  if (fixedAt) c.fixedAt = [...fixedAt];
  d.constraints[id] = c;
  return c;
}

export type DimensionInit = Omit<Dimension, 'id' | 'name' | 'shift' | 'offset'> & Partial<Pick<Dimension, 'shift' | 'offset'>>;

export function addDimension(d: SketchDoc, init: DimensionInit): Dimension {
  const id = newId(d, 'dim');
  const name = nextDimName(d);
  const dim: Dimension = { offset: 8, shift: 0, ...init, id, name, refs: [...init.refs] };
  d.dims[id] = dim;
  return dim;
}

function nextDimName(d: SketchDoc): string {
  const used = new Set(Object.values(d.dims).map((x) => x.name));
  let name = `d${d.nextDim++}`;
  while (used.has(name)) name = `d${d.nextDim++}`;
  return name;
}

/**
 * Löscht Objekte mit Kaskade:
 * - Linie/Kreis/Text → eigene Punkte, alle Abhängigkeiten/Bemaßungen darauf
 * - Eigener Punkt → Besitzerobjekt
 * - Pfad → Pfad, seine Linien und Hilfspunkte
 * - Linie aus einem Pfad → Pfad wird aufgelöst, die übrigen Linien bleiben mit Pfadkontur erhalten
 */
export function deleteIds(d: SketchDoc, ids: Iterable<Id>): void {
  const del = new Set<Id>();
  const queue = [...ids];
  while (queue.length) {
    const id = queue.pop()!;
    if (del.has(id) || id === ORIGIN_ID) continue;
    if (d.constraints[id] || d.dims[id]) {
      del.add(id);
      continue;
    }
    const p = d.points[id];
    if (p) {
      if (p.owner && d.entities[p.owner]) {
        queue.push(p.owner);
        continue;
      }
      del.add(id);
      continue;
    }
    const e = d.entities[id];
    if (!e) continue;
    del.add(id);
    if (e.kind === 'path') {
      for (const edge of e.edges) queue.push(edge.id);
    }
    for (const pid of entityPointIds(d, e)) {
      if (d.points[pid]?.owner === id) del.add(pid);
    }
  }

  // Pfade auflösen, deren Linien teilweise gelöscht werden
  for (const e of Object.values(d.entities)) {
    if (e.kind !== 'path' || del.has(e.id)) continue;
    if (e.edges.some((edge) => del.has(edge.id))) dissolvePath(d, e.id, del);
  }

  for (const id of del) {
    delete d.points[id];
    delete d.entities[id];
    delete d.constraints[id];
    delete d.dims[id];
  }
  // Abhängigkeiten/Bemaßungen mit verwaisten Referenzen entfernen
  const exists = (rid: Id) => !!(d.points[rid] || d.entities[rid]);
  for (const c of Object.values(d.constraints)) if (!c.refs.every(exists)) delete d.constraints[c.id];
  for (const m of Object.values(d.dims)) if (!m.refs.every(exists)) delete d.dims[m.id];
  d.order = d.order.filter((oid) => d.entities[oid]);
}

/** Löst einen Pfad auf; seine (nicht gelöschten) Linien werden wieder einzeln gezeichnet. */
export function dissolvePath(d: SketchDoc, pathId: Id, deleting: Set<Id> = new Set()): void {
  const path = d.entities[pathId];
  if (!path || path.kind !== 'path') return;
  const idx = d.order.indexOf(pathId);
  const lines: Id[] = [];
  for (const edge of path.edges) {
    const l = d.entities[edge.id];
    if (l && l.kind === 'line' && !deleting.has(edge.id)) {
      l.style = { ...path.style, fill: null };
      lines.push(edge.id);
    }
  }
  // Hilfspunkte des Pfads (z. B. Rechteckmitte) bleiben als freie Konstruktionspunkte
  for (const p of Object.values(d.points)) if (p.owner === pathId) delete p.owner;
  delete d.entities[pathId];
  d.order = d.order.filter((oid) => oid !== pathId);
  d.order.splice(idx >= 0 ? idx : d.order.length, 0, ...lines);
}

/** Erzeugt den Fix-Wert einer Abhängigkeit „Fixiert“ aus der aktuellen Lage. */
export function fixValuesFor(d: SketchDoc, refId: Id): number[] | null {
  const p = d.points[refId];
  if (p) return [p.x, p.y];
  const e = d.entities[refId];
  if (e?.kind === 'circle') {
    const c = pt(d, e.center);
    return [c.x, c.y, e.r];
  }
  return null;
}

/** Tiefe Kopie (für Tests und Export). */
export function cloneDoc(doc: SketchDoc): SketchDoc {
  return structuredClone(doc);
}
