import type { BodyMeasures, EdgeRef, Id, Pattern, PatternAvatar, PatternBlock, PatternMaterial, PatternPiece, PieceRole, SketchDoc, Style, Vec2 } from '../model/types';
import { deleteIds, newId } from '../model/doc';
import { DEFAULT_LAYER, layersOf } from '../model/layers';
import { addShapeFromWorld } from '../model/shape';
import { docBBox } from '../model/bounds';
import { canBePiece, emptyPattern, pieceGeom, sameEdge } from '../pattern/geometry';
import { generateBlock, layoutPieces, BLOCK_KINDS } from '../pattern/blocks';
import { SIZE_TABLE } from '../pattern/body';
import type { CommitOutcome, Editor } from './editor';
import { lookInto, materialInto, type PieceLookPatch } from '../pattern/edit';

/**
 * Editor-Befehle für Schnittteile und Nähte. Alles läuft über `Editor.commit`, damit Rückgängig,
 * Autosave, Sync und Tests wie bei allen anderen Befehlen funktionieren.
 */

export const PATTERN_LAYER_NAME = 'Schnitt';

export const ROLE_NAMES: Record<PieceRole, string> = {
  front: 'Vorderteil',
  back: 'Rückenteil',
  sleeve: 'Ärmel',
  hood: 'Kapuze',
  cuff: 'Ärmelbündchen',
  hem: 'Saumbund',
  neckband: 'Halsbündchen',
  collar: 'Kragen',
  placket: 'Knopfleiste',
  pocket: 'Tasche',
  other: 'Sonstiges',
};

export const FABRICS: { id: PatternMaterial['fabric']; name: string; gsm: number }[] = [
  { id: 'jersey', name: 'Single Jersey', gsm: 180 },
  { id: 'sweat', name: 'Sweat (angeraut)', gsm: 320 },
  { id: 'fleece', name: 'Fleece', gsm: 280 },
  { id: 'rib', name: 'Bündchen (Rippe)', gsm: 260 },
  { id: 'woven', name: 'Webware (Baumwolle)', gsm: 150 },
  { id: 'denim', name: 'Denim', gsm: 400 },
  { id: 'nylon', name: 'Nylon/Windbreaker', gsm: 80 },
  { id: 'mesh', name: 'Mesh', gsm: 120 },
];

export function patternLayerId(doc: SketchDoc): Id | null {
  return layersOf(doc).find((l) => l.pattern)?.id ?? null;
}

/** Schnitt-Ebene sicherstellen (ganz unten). Bestehende Objekte ohne Ebene behalten ihre bisherige Ebene. */
function ensurePatternLayer(d: SketchDoc): Id {
  const existing = (d.layers ?? []).find((l) => l.pattern);
  if (existing) return existing.id;
  if (!d.layers || !d.layers.length) d.layers = [{ ...DEFAULT_LAYER }];
  const first = d.layers[0].id;
  for (const e of Object.values(d.entities)) if (!e.layer) e.layer = first;
  const used = new Set(d.layers.map((l) => l.id));
  let id = newId(d, 'L');
  while (used.has(id)) id = newId(d, 'L');
  d.layers.unshift({ id, name: PATTERN_LAYER_NAME, visible: true, locked: false, pattern: true });
  return id;
}

function ensurePattern(d: SketchDoc): Pattern {
  if (!d.pattern) d.pattern = emptyPattern();
  d.pattern.materials ??= [];
  return d.pattern;
}

export function pieceStyle(color: string): Style {
  return { fill: color, stroke: '#1e2328', strokeWidth: 0.6, opacity: 0.32 };
}

function defaultMaterials(kind: PatternBlock['kind']): PatternMaterial[] {
  const main = kind === 'tshirt' || kind === 'longsleeve' || kind === 'polo' ? FABRICS[0] : FABRICS[1];
  if (kind === 'polo')
    return [
      { id: 'm-main', name: 'Oberstoff (Piqué)', fabric: main.id, color: '#4a6a8f', gsm: 220 },
      { id: 'm-rib', name: 'Strickkragen/Bündchen', fabric: 'rib', color: '#4a6a8f', gsm: FABRICS[3].gsm },
    ];
  return [
    { id: 'm-main', name: 'Oberstoff', fabric: main.id, color: '#4a6a8f', gsm: main.gsm },
    { id: 'm-rib', name: 'Bündchen', fabric: 'rib', color: '#4a6a8f', gsm: FABRICS[3].gsm },
  ];
}

/** Schnitt-Angaben ändern (ein Rückgängig-Schritt). */
export function updatePattern(ed: Editor, label: string, recipe: (p: Pattern, d: SketchDoc) => void): CommitOutcome {
  return ed.commit(
    label,
    (d) => {
      const p = ensurePattern(d);
      recipe(p, d);
    },
    { skipSolve: true },
  );
}

/**
 * Grundschnitt erzeugen oder aktualisieren. Vorhandene Grundschnitt-Teile werden ersetzt (an derselben
 * Stelle), eigene Teile und Nähte zwischen eigenen Teilen bleiben erhalten.
 */
export function generatePattern(ed: Editor, body: BodyMeasures, bodySize: string, blk: PatternBlock): CommitOutcome & { ids?: Id[] } {
  const res = generateBlock(body, blk);
  const ids: Id[] = [];
  const kindName = BLOCK_KINDS.find((k) => k.id === blk.kind)?.name ?? 'Grundschnitt';
  const prev = ed.s.doc;
  // Lage: wie zuvor, sonst unter der bisherigen Zeichnung
  let origin: Vec2 = { x: 0, y: 0 };
  const oldBlock = prev.pattern?.pieces.filter((p) => p.block) ?? [];
  const oldBoxes = oldBlock.map((p) => pieceGeom(prev, p)?.box).filter((b): b is NonNullable<typeof b> => !!b);
  if (oldBoxes.length) origin = { x: Math.min(...oldBoxes.map((b) => b.minX)), y: Math.max(...oldBoxes.map((b) => b.maxY)) };
  else {
    const box = docBBox(prev);
    if (box) origin = { x: box.minX, y: box.minY - 120 };
  }
  const out = ed.commit(
    oldBlock.length ? `${kindName} aktualisieren` : `${kindName} erzeugen`,
    (d) => {
      const layer = ensurePatternLayer(d);
      const p = ensurePattern(d);
      // alte Grundschnitt-Teile entfernen (Konturen + Teile + Nähte daran; deleteIds räumt den Schnitt auf)
      deleteIds(
        d,
        p.pieces.filter((x) => x.block).map((x) => x.outline),
      );
      p.pieces = p.pieces.filter((x) => !x.block);

      // Materialien
      for (const m of defaultMaterials(blk.kind)) if (!p.materials.some((x) => x.id === m.id)) p.materials.push(m);
      const mat = (rib: boolean) => p.materials.find((m) => m.id === (rib ? 'm-rib' : 'm-main')) ?? p.materials[0];

      const lay = layoutPieces(res.pieces, origin);
      const keyToId = new Map<string, Id>();
      for (const bp of res.pieces) {
        const off = lay.get(bp.key)!;
        const m = mat(!!bp.rib);
        const moved = [
          {
            closed: true,
            nodes: bp.contour.nodes.map((nd) => ({
              x: nd.x + off.x,
              y: nd.y + off.y,
              ...(nd.ix !== undefined ? { ix: nd.ix + off.x, iy: nd.iy! + off.y } : {}),
              ...(nd.ox !== undefined ? { ox: nd.ox + off.x, oy: nd.oy! + off.y } : {}),
            })),
          },
        ];
        const shape = addShapeFromWorld(d, moved, pieceStyle(m.color), { name: bp.name, layer });
        const pid = newId(d, 'pc');
        keyToId.set(bp.key, pid);
        ids.push(shape.id);
        p.pieces.push({ id: pid, name: bp.name, outline: shape.id, role: bp.role, cut: bp.cut, seamAllowance: bp.rib ? 7 : 10, grain: 0, material: m.id, block: true });
      }
      for (const s of res.seams) {
        p.seams.push({
          id: newId(d, 'sm'),
          name: s.name,
          a: { piece: keyToId.get(s.a[0])!, edge: s.a[1], ...(s.a[2] ? { copy: 1 as const } : {}) },
          b: { piece: keyToId.get(s.b[0])!, edge: s.b[1], ...(s.b[2] ? { copy: 1 as const } : {}) },
          reversed: s.reversed,
        });
      }
      p.body = { ...body };
      p.bodySize = bodySize;
      p.block = { ...blk };
    },
    { skipSolve: true },
  );
  if (out.ok) ed.select([]);
  return { ...out, ids };
}

/** Ausgewählte geschlossene Pfade/Formen zu Schnittteilen machen (auf die Schnitt-Ebene verschieben). */
export function makePieces(ed: Editor, ids: Id[], role: PieceRole = 'other'): CommitOutcome & { pieceIds?: Id[] } {
  const doc = ed.s.doc;
  const usable = ids.filter((id) => canBePiece(doc, id) && !doc.pattern?.pieces.some((p) => p.outline === id));
  if (!usable.length) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Bitte eine geschlossene Kontur auswählen (geschlossener Linienzug, Form oder Pfad), die noch kein Schnittteil ist.',
    };
  }
  const pieceIds: Id[] = [];
  const out = ed.commit(
    usable.length > 1 ? 'Schnittteile anlegen' : 'Schnittteil anlegen',
    (d) => {
      const layer = ensurePatternLayer(d);
      const p = ensurePattern(d);
      if (!p.materials.length) p.materials.push(...defaultMaterials('tshirt'));
      const used = new Set(p.pieces.map((x) => x.name));
      for (const id of usable) {
        const e = d.entities[id];
        e.layer = layer;
        if (e.kind === 'path') for (const ed2 of e.edges) if (d.entities[ed2.id]) d.entities[ed2.id].layer = layer;
        let name = (e.kind === 'shape' && e.name) || ROLE_NAMES[role];
        let k = 2;
        const base = name;
        while (used.has(name)) name = `${base} ${k++}`;
        used.add(name);
        const pid = newId(d, 'pc');
        pieceIds.push(pid);
        p.pieces.push({ id: pid, name, outline: id, role, cut: 1, seamAllowance: 10, grain: 0, material: p.materials[0]?.id });
        const m = p.materials[0];
        if (m && !e.style.fill) e.style = { ...pieceStyle(m.color), stroke: e.style.stroke ?? '#1e2328' };
      }
    },
    { skipSolve: true },
  );
  return { ...out, pieceIds };
}

export function updatePiece(ed: Editor, id: Id, patch: Partial<Omit<PatternPiece, 'id' | 'outline'>>): CommitOutcome {
  return updatePattern(ed, 'Schnittteil ändern', (p, d) => {
    const pc = p.pieces.find((x) => x.id === id);
    if (!pc) return;
    Object.assign(pc, patch);
    if (pc.cut === 1) {
      // Nähte zur gespiegelten Kopie werden ungültig
      p.seams = p.seams.filter((s) => !((s.a.piece === id && s.a.copy) || (s.b.piece === id && s.b.copy)));
    }
    if (patch.material) lookInto(d, pc, { material: patch.material });
  });
}

/** Schnittteil auflösen: Kontur bleibt als normale Form/Pfad erhalten. */
export function removePiece(ed: Editor, id: Id): CommitOutcome {
  return updatePattern(ed, 'Schnittteil entfernen', (p) => {
    p.pieces = p.pieces.filter((x) => x.id !== id);
    p.seams = p.seams.filter((s) => s.a.piece !== id && s.b.piece !== id);
  });
}

export function addSeam(ed: Editor, a: EdgeRef, b: EdgeRef, opts: { reversed?: boolean; name?: string } = {}): CommitOutcome & { seamId?: Id } {
  if (sameEdge(a, b)) return { ok: false, reason: 'invalid', message: 'Eine Kante kann nicht mit sich selbst vernäht werden.' };
  const pat = ed.s.doc.pattern;
  if (!pat) return { ok: false, reason: 'invalid', message: 'Noch keine Schnittteile vorhanden.' };
  const busy = pat.seams.find((s) => [s.a, s.b].some((r) => sameEdge(r, a) || sameEdge(r, b)));
  if (busy) return { ok: false, reason: 'invalid', message: `Diese Kante ist schon vernäht (${busy.name ?? 'Naht'}). Zuerst die bestehende Naht entfernen.` };
  let seamId: Id | undefined;
  const out = updatePattern(ed, 'Naht verbinden', (p, d) => {
    seamId = newId(d, 'sm');
    p.seams.push({ id: seamId, a: { ...a }, b: { ...b }, reversed: opts.reversed ?? true, name: opts.name ?? `Naht ${p.seams.length + 1}` });
  });
  return { ...out, seamId };
}

export function updateSeam(ed: Editor, id: Id, patch: { reversed?: boolean; name?: string }): CommitOutcome {
  return updatePattern(ed, patch.reversed !== undefined ? 'Nahtrichtung umkehren' : 'Naht umbenennen', (p) => {
    const s = p.seams.find((x) => x.id === id);
    if (s) Object.assign(s, patch);
  });
}

export function removeSeam(ed: Editor, id: Id): CommitOutcome {
  return updatePattern(ed, 'Naht entfernen', (p) => {
    p.seams = p.seams.filter((s) => s.id !== id);
  });
}

export function updateMaterial(ed: Editor, id: Id, patch: Partial<Omit<PatternMaterial, 'id'>>): CommitOutcome {
  return updatePattern(ed, 'Material ändern', (_p, d) => materialInto(d, id, patch));
}

/** Farbe/Stoff eines Teils (aus der 3D-Ansicht). `color: null` = wieder Materialfarbe. */
export function setPieceLook(ed: Editor, id: Id, patch: PieceLookPatch): CommitOutcome {
  return updatePattern(ed, patch.color !== undefined ? 'Teil einfärben' : 'Stoff des Teils ändern', (p, d) => {
    const pc = p.pieces.find((x) => x.id === id);
    if (pc) lookInto(d, pc, patch);
  });
}

export function addMaterial(ed: Editor): CommitOutcome & { id?: Id } {
  let id: Id | undefined;
  const out = updatePattern(ed, 'Material hinzufügen', (p, d) => {
    id = newId(d, 'm');
    p.materials.push({ id, name: `Stoff ${p.materials.length + 1}`, fabric: 'jersey', color: '#8a8f98', gsm: 180 });
  });
  return { ...out, id };
}

export function setBody(ed: Editor, body: BodyMeasures, bodySize: string): CommitOutcome {
  return updatePattern(ed, 'Körpermaße ändern', (p) => {
    p.body = { ...body };
    p.bodySize = bodySize;
  });
}

export const sizeName = (id: string) => (id === 'custom' ? 'Eigene Maße' : (SIZE_TABLE.find((r) => r.id === id)?.name ?? id));

/** Puppe für die 3D-Ansicht (null = Körpermaße des Schnitts). */
export function setAvatar(ed: Editor, avatar: PatternAvatar | null): CommitOutcome {
  return updatePattern(ed, avatar ? 'Puppe ändern' : 'Puppe wie Schnitt', (p) => {
    if (avatar) p.avatar = { ...avatar };
    else delete p.avatar;
  });
}
