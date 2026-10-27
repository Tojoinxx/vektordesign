import type { Entity, Id, Layer, SketchDoc } from './types';

/** Erste Ebene alter Dateien und neuer Zeichnungen. */
export const DEFAULT_LAYER: Layer = { id: 'L1', name: 'Motiv', visible: true, locked: false };

export function layersOf(doc: SketchDoc): Layer[] {
  return doc.layers && doc.layers.length ? doc.layers : [DEFAULT_LAYER];
}

/** Ebene eines Objekts (unbekannte oder fehlende Ebene → unterste). */
export function layerIdOf(doc: SketchDoc, e: Entity): Id {
  const ls = layersOf(doc);
  if (e.layer && ls.some((l) => l.id === e.layer)) return e.layer;
  return ls[0].id;
}

export function layerOf(doc: SketchDoc, e: Entity): Layer {
  const id = layerIdOf(doc, e);
  return layersOf(doc).find((l) => l.id === id) ?? layersOf(doc)[0];
}

interface LayerInfo {
  order: Id[];
  hidden: Set<Id>;
  locked: Set<Id>;
}

const cache = new WeakMap<SketchDoc, LayerInfo>();

function info(doc: SketchDoc): LayerInfo {
  let i = cache.get(doc);
  if (i) return i;
  const ls = layersOf(doc);
  const rank = new Map(ls.map((l, k) => [l.id, k]));
  const hidden = new Set<Id>();
  const locked = new Set<Id>();
  const byLayer = ls.map(() => [] as Id[]);
  for (const id of doc.order) {
    const e = doc.entities[id];
    if (!e) continue;
    const l = layerOf(doc, e);
    if (!l.visible) hidden.add(id);
    if (l.locked) locked.add(id);
    byLayer[rank.get(l.id) ?? 0].push(id);
  }
  // Auch Objekte außerhalb der Zeichenreihenfolge (Konstruktion, Linien in Pfaden) und Punkte
  for (const e of Object.values(doc.entities)) {
    const l = layerOf(doc, e);
    if (!l.visible) hidden.add(e.id);
    if (l.locked) locked.add(e.id);
  }
  for (const p of Object.values(doc.points)) {
    if (!p.owner) continue;
    if (hidden.has(p.owner)) hidden.add(p.id);
    if (locked.has(p.owner)) locked.add(p.id);
  }
  // Linien eines Pfads erben die Ebene des Pfads
  for (const e of Object.values(doc.entities)) {
    if (e.kind !== 'path') continue;
    for (const ed of e.edges) {
      if (hidden.has(e.id)) hidden.add(ed.id);
      if (locked.has(e.id)) locked.add(ed.id);
      const l = doc.entities[ed.id];
      if (l?.kind === 'line') {
        for (const pid of [l.p1, l.p2]) {
          if (hidden.has(e.id)) hidden.add(pid);
          if (locked.has(e.id)) locked.add(pid);
        }
      }
    }
  }
  i = { order: byLayer.flat(), hidden, locked };
  cache.set(doc, i);
  return i;
}

/** Zeichenreihenfolge über alle Ebenen (unten → oben), inklusive ausgeblendeter Ebenen. */
export function layeredOrder(doc: SketchDoc): Id[] {
  return info(doc).order;
}

/** Sichtbare Objekte in Zeichenreihenfolge. */
export function visibleOrder(doc: SketchDoc): Id[] {
  const i = info(doc);
  return i.order.filter((id) => !i.hidden.has(id));
}

export function isHidden(doc: SketchDoc, id: Id): boolean {
  return info(doc).hidden.has(id);
}

/** Auf ausgeblendeten oder gesperrten Ebenen: nicht auswählbar. */
export function isInert(doc: SketchDoc, id: Id): boolean {
  const i = info(doc);
  return i.hidden.has(id) || i.locked.has(id);
}

/** Gruppenmitglieder (inklusive des Objekts selbst). */
export function groupMembers(doc: SketchDoc, id: Id): Id[] {
  const e = doc.entities[id];
  if (!e?.group) return [id];
  return Object.values(doc.entities)
    .filter((x) => x.group === e.group)
    .map((x) => x.id);
}
