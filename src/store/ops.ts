import type { Contour, Entity, Id, SketchDoc, Style, TextEntity, Vec2 } from '../model/types';
import { deleteIds, pt } from '../model/doc';
import { addShapeFromWorld, polygonContour } from '../model/shape';
import { BOOL_LABELS, booleanAreas, entityArea, offsetArea, polysToContours, roundCorners, type BoolOp } from '../model/boolean';
import { groupMembers, layeredOrder } from '../model/layers';
import { docBBox } from '../model/bounds';
import { loadFont, textContours } from '../platform/fontOutline';
import { drawableTargets, type CommitOutcome, type Editor } from './editor';
import { applyXf, cloneInto } from './xform';

/**
 * Bearbeitungsfunktionen, die neue Formen erzeugen: Text in Pfade, boolesche Operationen,
 * Versatz, Abrunden/Fase, Muster. Jede Funktion ist ein einziger Rückgängig-Schritt.
 */

type Outcome = CommitOutcome & { ids?: Id[] };

const fail = (message: string): Outcome => ({ ok: false, reason: 'invalid', message });

/** Ersetzt `remove` durch eine neue Form an der Stelle des vordersten entfernten Objekts. */
function replaceWithShape(d: SketchDoc, remove: Id[], contours: Contour[], style: Style, opts: { name?: string; fillRule?: 'nonzero' | 'evenodd'; like?: Entity }): Id {
  const gone = new Set(remove);
  const front = Math.max(...remove.map((id) => d.order.indexOf(id)));
  const after = d.order.slice(front + 1).find((id) => !gone.has(id));
  const s = addShapeFromWorld(d, contours, style, { name: opts.name, fillRule: opts.fillRule, layer: opts.like?.layer });
  if (opts.like?.group) s.group = opts.like.group;
  deleteIds(d, remove);
  d.order = d.order.filter((x) => x !== s.id);
  const at = after ? d.order.indexOf(after) : -1;
  if (at >= 0) d.order.splice(at, 0, s.id);
  else d.order.push(s.id);
  return s.id;
}

/** Text in Pfade (Umrisse der Schrift). Fehlt die Schrift, springt IBM Plex Sans ein (mit Hinweis). */
export async function textToPaths(ed: Editor, ids: Id[] = ed.s.selection): Promise<Outcome> {
  const doc = ed.s.doc;
  const texts = drawableTargets(doc, ids)
    .map((id) => doc.entities[id])
    .filter((e): e is TextEntity => e?.kind === 'text');
  if (!texts.length) return fail('Keinen Text ausgewählt.');
  const outlines = new Map<Id, Contour[]>();
  const substituted = new Set<string>();
  for (const t of texts) {
    const f = await loadFont(t.fontFamily, t.fontWeight, t.italic);
    if (f.substitute) substituted.add(t.fontFamily);
    outlines.set(t.id, textContours(f.font, t, pt(doc, t.anchor)));
  }
  if (ed.s.doc !== doc) return fail('Die Zeichnung hat sich währenddessen geändert – bitte noch einmal.');
  const created: Id[] = [];
  const keepSel = ed.s.selection.filter((id) => !outlines.has(id));
  const out = ed.commit('Text in Pfade', (d) => {
    for (const t of texts) {
      const cs = outlines.get(t.id)!;
      if (!cs.length) continue;
      created.push(replaceWithShape(d, [t.id], cs, t.style, { name: `Text „${t.text}“`, like: t }));
    }
  });
  if (out.ok) {
    ed.select([...keepSel, ...created]);
    if (substituted.size) ed.toast(`Schrift ${[...substituted].join(', ')} ist hier nicht verfügbar – ersetzt durch IBM Plex Sans.`, 'info', 7000);
  }
  return { ...out, ids: created };
}

/** Wandelt Kreise und geschlossene Pfade (Skizze) in freie Formen um. */
export function toShape(ed: Editor, ids: Id[] = ed.s.selection): Outcome {
  const doc = ed.s.doc;
  const items = drawableTargets(doc, ids)
    .map((id) => doc.entities[id])
    .filter((e): e is Entity => !!e && (e.kind === 'circle' || (e.kind === 'path' && e.closed)));
  if (!items.length) return fail('Kreis oder geschlossene Fläche auswählen.');
  const created: Id[] = [];
  const out = ed.commit('In Form umwandeln', (d) => {
    for (const e of items) {
      const area = entityArea(doc, e);
      if (!area) continue;
      created.push(replaceWithShape(d, [e.id], e.kind === 'circle' ? circleAsContours(doc, e.id) : polysToContours(area), e.style, { like: e }));
    }
  });
  if (out.ok) ed.select(created);
  return { ...out, ids: created };
}

function circleAsContours(doc: SketchDoc, id: Id): Contour[] {
  const e = doc.entities[id];
  if (e?.kind !== 'circle') return [];
  const c = pt(doc, e.center);
  const k = e.r * 0.5522847498307936;
  return [
    {
      closed: true,
      nodes: [
        { x: c.x + e.r, y: c.y, ix: c.x + e.r, iy: c.y - k, ox: c.x + e.r, oy: c.y + k },
        { x: c.x, y: c.y + e.r, ix: c.x + k, iy: c.y + e.r, ox: c.x - k, oy: c.y + e.r },
        { x: c.x - e.r, y: c.y, ix: c.x - e.r, iy: c.y + k, ox: c.x - e.r, oy: c.y - k },
        { x: c.x, y: c.y - e.r, ix: c.x - k, iy: c.y - e.r, ox: c.x + k, oy: c.y - e.r },
      ],
    },
  ];
}

/**
 * Vereinigen, Subtrahieren (vordere von der hintersten), Schnittmenge, Ausschließen.
 * Texte werden vorher automatisch in Pfade umgewandelt.
 */
export async function booleanOp(ed: Editor, op: BoolOp, ids: Id[] = ed.s.selection): Promise<Outcome> {
  let doc = ed.s.doc;
  let targets = drawableTargets(doc, ids).flatMap((id) => groupMembers(doc, id));
  targets = [...new Set(targets)];
  if (targets.length < 2) return fail(`Für „${BOOL_LABELS[op]}“ mindestens zwei Flächen auswählen.`);
  const texts = targets.filter((id) => doc.entities[id]?.kind === 'text');
  ed.beginTransaction(BOOL_LABELS[op]);
  let ok = false;
  try {
    if (texts.length) {
      const t = await textToPaths(ed, texts);
      if (!t.ok) return t;
      doc = ed.s.doc;
      targets = [...targets.filter((id) => !texts.includes(id)), ...(t.ids ?? [])];
    }
    const order = layeredOrder(doc);
    targets.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const areas: Vec2[][][] = [];
    const used: Id[] = [];
    const skipped: string[] = [];
    for (const id of targets) {
      const e = doc.entities[id];
      const a = e ? entityArea(doc, e) : null;
      if (a && a.length) {
        areas.push(a);
        used.push(id);
      } else if (e) skipped.push(e.kind === 'line' ? 'Linie' : e.kind === 'path' ? 'offener Linienzug' : e.kind);
    }
    if (used.length < 2) return fail('Nur geschlossene Flächen lassen sich verknüpfen (Kreise, Rechtecke, geschlossene Linienzüge, Formen, Texte).');
    const result = booleanAreas(op, areas);
    if (!result.length) return fail('Das Ergebnis wäre leer – die Flächen überlappen sich nicht.');
    const styleFrom = doc.entities[op === 'subtract' ? used[0] : used[used.length - 1]];
    let id = '';
    const out = ed.commit(BOOL_LABELS[op], (d) => {
      id = replaceWithShape(d, used, polysToContours(result), styleFrom.style, { fillRule: 'evenodd', like: styleFrom, name: BOOL_LABELS[op] });
    });
    if (out.ok) {
      ok = true;
      ed.select([id]);
      if (skipped.length) ed.toast(`Nicht berücksichtigt (keine geschlossene Fläche): ${skipped.join(', ')}.`, 'info', 6000);
    }
    return { ...out, ids: id ? [id] : [] };
  } finally {
    // Misslungen: auch die Umwandlung der Texte zurücknehmen
    if (ed.endTransaction() > 0 && !ok) ed.undo();
  }
}

/** Versatz: neue Form im Abstand `delta` mm um die Auswahl (negativ = nach innen). */
export async function offsetOp(ed: Editor, delta: number, join: 'round' | 'miter' = 'round', ids: Id[] = ed.s.selection): Promise<Outcome> {
  return shapeEdit(ed, ids, 'Versatz', (polys) => offsetArea(polys, delta, join), true);
}

/** Abrunden bzw. Fase aller Ecken der Auswahl (wandelt Skizzenflächen in Formen um). */
export async function cornerOp(ed: Editor, r: number, mode: 'fillet' | 'chamfer', ids: Id[] = ed.s.selection): Promise<Outcome> {
  return shapeEdit(ed, ids, mode === 'fillet' ? 'Abrunden' : 'Fase', (polys) => roundCorners(polys, r, mode), false);
}

async function shapeEdit(ed: Editor, ids: Id[], label: string, fn: (polys: Vec2[][]) => Vec2[][], keepOriginal: boolean): Promise<Outcome> {
  let doc = ed.s.doc;
  let targets = drawableTargets(doc, ids);
  if (!targets.length) return fail('Zuerst Flächen auswählen.');
  ed.beginTransaction(label);
  let ok = false;
  try {
    const texts = targets.filter((id) => doc.entities[id]?.kind === 'text');
    if (texts.length) {
      const t = await textToPaths(ed, texts);
      if (!t.ok) return t;
      doc = ed.s.doc;
      targets = [...targets.filter((id) => !texts.includes(id)), ...(t.ids ?? [])];
    }
    const results: { src: Entity; polys: Vec2[][] }[] = [];
    for (const id of targets) {
      const e = doc.entities[id];
      const a = e ? entityArea(doc, e) : null;
      if (!e || !a) continue;
      const polys = fn(a);
      if (polys.length) results.push({ src: e, polys });
    }
    if (!results.length) return fail('Nur geschlossene Flächen lassen sich bearbeiten (Kreise, Rechtecke, geschlossene Linienzüge, Formen, Texte).');
    const created: Id[] = [];
    const out = ed.commit(label, (d) => {
      for (const r of results) {
        if (keepOriginal) {
          const s = addShapeFromWorld(d, polysToContours(r.polys), r.src.style, { fillRule: 'evenodd', layer: r.src.layer, name: label });
          created.push(s.id);
        } else created.push(replaceWithShape(d, [r.src.id], polysToContours(r.polys), r.src.style, { fillRule: 'evenodd', like: r.src, name: label }));
      }
    });
    if (out.ok) {
      ok = true;
      ed.select(created);
    }
    return { ...out, ids: created };
  } finally {
    if (ed.endTransaction() > 0 && !ok) ed.undo();
  }
}

export interface RectPattern {
  kind: 'rect';
  nx: number;
  ny: number;
  dx: number;
  dy: number;
}
export interface CircPattern {
  kind: 'circ';
  n: number;
  /** Gesamtwinkel (360 = voller Kreis) */
  angle: number;
  /** Drehpunkt (Standard: Ursprung) */
  cx: number;
  cy: number;
}

/** Rechteckiges oder kreisförmiges Muster aus Kopien der Auswahl. */
export function patternOp(ed: Editor, p: RectPattern | CircPattern, ids: Id[] = ed.s.selection): Outcome {
  const doc = ed.s.doc;
  const targets = drawableTargets(doc, ids);
  if (!targets.length) return fail('Zuerst Objekte auswählen.');
  const count = p.kind === 'rect' ? p.nx * p.ny : p.n;
  if (count < 2 || count > 400) return fail('Anzahl zwischen 2 und 400 wählen.');
  const created: Id[] = [];
  const out = ed.commit(p.kind === 'rect' ? 'Rechteckiges Muster' : 'Kreisförmiges Muster', (d) => {
    if (p.kind === 'rect') {
      for (let j = 0; j < p.ny; j++)
        for (let i = 0; i < p.nx; i++) {
          if (!i && !j) continue;
          const c = cloneInto(d, doc, targets);
          applyXf(d, c, { kind: 'move', dx: i * p.dx, dy: j * p.dy });
          created.push(...c);
        }
    } else {
      const step = Math.abs(p.angle - 360) < 1e-9 ? 360 / p.n : p.angle / (p.n - 1);
      for (let i = 1; i < p.n; i++) {
        const c = cloneInto(d, doc, targets);
        applyXf(d, c, { kind: 'rotate', angle: step * i, cx: p.cx, cy: p.cy });
        created.push(...c);
      }
    }
  });
  if (out.ok) ed.select([...targets, ...created]);
  return { ...out, ids: created };
}

/** Mitte der Auswahl (für Drehen/Skalieren/Spiegeln um die Auswahl). */
export function selectionCenter(doc: SketchDoc, ids: Id[]): Vec2 | null {
  const b = docBBox(doc, { only: new Set(drawableTargets(doc, ids).flatMap((id) => groupMembers(doc, id))) });
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : null;
}

export function selectionSize(doc: SketchDoc, ids: Id[]): { w: number; h: number } | null {
  const b = docBBox(doc, { only: new Set(drawableTargets(doc, ids).flatMap((id) => groupMembers(doc, id))) });
  return b ? { w: b.maxX - b.minX, h: b.maxY - b.minY } : null;
}

export { polygonContour };
