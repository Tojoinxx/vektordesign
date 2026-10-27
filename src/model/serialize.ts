import { version } from '../../package.json';
import type { SketchDoc } from './types';
import { ORIGIN_ID } from './types';

export const APP_NAME = 'Vektordesign';
/** Version kommt aus package.json (eine Quelle für App, Installer und Projektdateien). */
export const APP_VERSION: string = version;
export const PROJECT_EXT = 'vdp';

/** Projektdatei (.vdp) = JSON des Skizzenmodells plus Metadaten. */
export function serializeDoc(doc: SketchDoc): string {
  const out = { ...doc, savedWith: `${APP_NAME} ${APP_VERSION}`, savedAt: new Date().toISOString() };
  return JSON.stringify(out, null, 1);
}

export class ProjectFileError extends Error {}

/** Liest eine Projektdatei und prüft ihre Struktur. */
export function parseDoc(text: string): SketchDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectFileError('Die Datei ist kein gültiges Vektordesign-Projekt (kein JSON).');
  }
  const d = raw as Partial<SketchDoc> & { savedWith?: string; savedAt?: string };
  if (!d || d.format !== 'vektordesign') throw new ProjectFileError('Die Datei ist kein Vektordesign-Projekt.');
  if (d.version !== 1) throw new ProjectFileError(`Projektversion ${String(d.version)} wird von dieser Programmversion nicht unterstützt.`);
  for (const key of ['points', 'entities', 'constraints', 'dims'] as const) {
    if (!d[key] || typeof d[key] !== 'object') throw new ProjectFileError(`Projektdatei beschädigt: „${key}“ fehlt.`);
  }
  if (!Array.isArray(d.order)) throw new ProjectFileError('Projektdatei beschädigt: Zeichenreihenfolge fehlt.');
  const doc: SketchDoc = {
    format: 'vektordesign',
    version: 1,
    name: typeof d.name === 'string' ? d.name : 'Unbenannt',
    points: d.points!,
    entities: d.entities!,
    constraints: d.constraints!,
    dims: d.dims!,
    order: d.order,
    ...(Array.isArray(d.layers) && d.layers.length ? { layers: d.layers } : {}),
    ...(d.production && typeof d.production === 'object' ? { production: d.production } : {}),
    nextId: typeof d.nextId === 'number' ? d.nextId : 1,
    nextDim: typeof d.nextDim === 'number' ? d.nextDim : 0,
  };
  if (!doc.points[ORIGIN_ID]) doc.points[ORIGIN_ID] = { id: ORIGIN_ID, x: 0, y: 0, locked: true, construction: true };
  // Verweise prüfen
  for (const e of Object.values(doc.entities)) {
    const refs = e.kind === 'line' ? [e.p1, e.p2] : e.kind === 'circle' ? [e.center] : e.kind === 'text' ? [e.anchor] : [];
    for (const r of refs) if (!doc.points[r]) throw new ProjectFileError(`Projektdatei beschädigt: Punkt ${r} fehlt.`);
  }
  // Zähler hinter die höchste vorhandene Id setzen
  let max = doc.nextId;
  for (const id of [...Object.keys(doc.points), ...Object.keys(doc.entities), ...Object.keys(doc.constraints), ...Object.keys(doc.dims)]) {
    const n = Number(id.replace(/^[a-z]+/i, ''));
    if (Number.isFinite(n) && n >= max) max = n + 1;
  }
  doc.nextId = max;
  return doc;
}
