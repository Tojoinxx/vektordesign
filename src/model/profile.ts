import type { Id, PathEdge, SketchDoc } from './types';
import { coincidenceClusters } from './topology';
import { pathOfLine } from './doc';

/**
 * Ordnet Linien und Bögen zu einer geschlossenen Schleife. Enden gelten als verbunden, wenn
 * sie koinzident sind (Abhängigkeit) oder praktisch aufeinanderliegen.
 */
export function orderLoop(doc: SketchDoc, idsIn: Id[]): { edges: PathEdge[] } | { error: string } {
  const ids = [...new Set(idsIn)].filter((id) => {
    const e = doc.entities[id];
    return e && (e.kind === 'line' || e.kind === 'arc') && !e.construction;
  });
  if (ids.length < 2) return { error: 'Mindestens zwei Linien oder Bögen wählen, deren Enden eine geschlossene Kontur bilden.' };
  if (ids.some((id) => pathOfLine(doc, id))) return { error: 'Ein Teil gehört schon zu einer Fläche.' };
  const clusters = coincidenceClusters(doc);
  const ends = (id: Id): [Id, Id] => {
    const e = doc.entities[id] as { p1: Id; p2: Id };
    return [e.p1, e.p2];
  };
  const same = (a: Id, b: Id) => {
    if (a === b || clusters.get(a) === clusters.get(b)) return true;
    const p = doc.points[a];
    const q = doc.points[b];
    return Math.hypot(p.x - q.x, p.y - q.y) < 1e-6;
  };
  const left = new Set(ids.slice(1));
  const edges: PathEdge[] = [{ id: ids[0], reversed: false }];
  const startPt = ends(ids[0])[0];
  let cur = ends(ids[0])[1];
  while (left.size) {
    let found: PathEdge | null = null;
    for (const id of left) {
      const [a, b] = ends(id);
      if (same(cur, a)) found = { id, reversed: false };
      else if (same(cur, b)) found = { id, reversed: true };
      if (found) break;
    }
    if (!found) return { error: 'Die gewählten Kanten bilden keine durchgehende Kontur – Enden mit „Koinzident“ verbinden.' };
    left.delete(found.id);
    edges.push(found);
    const [a, b] = ends(found.id);
    cur = found.reversed ? a : b;
  }
  if (!same(cur, startPt)) return { error: 'Die Kontur ist nicht geschlossen – Anfang und Ende fallen nicht zusammen.' };
  return { edges };
}
