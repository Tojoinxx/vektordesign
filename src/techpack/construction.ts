import type { PieceRole, SketchDoc } from '../model/types';
import { edgeOf, freeEdges, pieceById, pieceGeom } from '../pattern/geometry';

/**
 * Verarbeitung: Nähte zu Gruppen zusammengefasst (links/rechts), mit Vorschlag für Stichart und Hinweis,
 * dazu offene Kanten (Säume, Gesichtskante der Kapuze). Vorschläge lassen sich im Tech-Pack überschreiben.
 */

export interface ConstructionRow {
  key: string;
  name: string;
  /** beteiligte Teile */
  pieces: string;
  /** Gesamtlänge der Naht (mm, eine Seite) */
  length: number;
  count: number;
  suggestion: string;
  kind: 'seam' | 'edge';
}

const RIB: PieceRole[] = ['cuff', 'hem', 'neckband'];

export const STITCHES = [
  'Overlock 4-Faden',
  'Overlock 4-Faden mit Nahtband',
  'Overlock 4-Faden, Bündchen gleichmäßig gedehnt annähen',
  'Flatlock 4-Nadel',
  'Coverstitch 2-Nadel, 25 mm umgeschlagen',
  'Coverstitch 2-Nadel, 15 mm umgeschlagen',
  'Steppnaht 3 mm, Kante abgesteppt',
  'Kappnaht (Doppelsteppnaht)',
  'Overlock + Coverstitch (Nackenband)',
];

function groupName(name: string): string {
  return name.replace(/\s+(links|rechts)$/i, '').trim();
}

export function constructionRows(doc: SketchDoc): ConstructionRow[] {
  const pat = doc.pattern;
  if (!pat) return [];
  const groups = new Map<string, ConstructionRow>();
  for (const s of pat.seams) {
    const name = groupName(s.name ?? 'Naht');
    const pa = pieceById(doc, s.a.piece);
    const pb = pieceById(doc, s.b.piece);
    if (!pa || !pb) continue;
    const len = Math.max(edgeOf(doc, s.a)?.length ?? 0, edgeOf(doc, s.b)?.length ?? 0);
    const rib = RIB.includes(pa.role) || RIB.includes(pb.role);
    let suggestion = 'Overlock 4-Faden';
    if (rib) suggestion = 'Overlock 4-Faden, Bündchen gleichmäßig gedehnt annähen';
    else if (/schulter/i.test(name)) suggestion = 'Overlock 4-Faden mit Nahtband';
    else if (/kapuze mitte|scheitel|hinterkopf/i.test(name)) suggestion = 'Overlock 4-Faden';
    if (/halsbündchen mitte|bündchennaht|saumbund seite/i.test(name)) suggestion = 'Overlock 4-Faden (vor dem Annähen zum Ring schließen)';
    const g = groups.get(name);
    const names = [...new Set([pa.name, pb.name])].join(' + ');
    if (g) {
      g.count++;
      g.length = Math.max(g.length, len);
    } else groups.set(name, { key: `seam:${name}`, name, pieces: names, length: len, count: 1, suggestion, kind: 'seam' });
  }
  const rows = [...groups.values()];
  // Offene Kanten: Säume ohne Bündchen, Gesichtskante, sonstige freie Kanten
  for (const pc of pat.pieces) {
    const free = freeEdges(doc, pc);
    const g = pieceGeom(doc, pc);
    if (!free.length || !g || RIB.includes(pc.role)) continue;
    const len = free.reduce((sum, e) => sum + (g.edges[e]?.length ?? 0), 0);
    let name = `${pc.name}: offene Kante`;
    let suggestion = 'Coverstitch 2-Nadel, 15 mm umgeschlagen';
    if (pc.role === 'front' || pc.role === 'back') {
      name = `Saum ${pc.name}`;
      suggestion = 'Coverstitch 2-Nadel, 25 mm umgeschlagen';
    } else if (pc.role === 'sleeve') {
      name = 'Ärmelsaum';
      suggestion = 'Coverstitch 2-Nadel, 25 mm umgeschlagen';
    } else if (pc.role === 'hood') {
      name = 'Kapuze Gesichtskante';
      suggestion = 'Coverstitch 2-Nadel, 15 mm umgeschlagen';
    }
    const key = `edge:${pc.id}`;
    rows.push({ key, name, pieces: pc.name, length: len, count: pc.cut, suggestion, kind: 'edge' });
  }
  return rows;
}
