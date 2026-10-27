import type { Id, SketchDoc } from './types';
import { circleOf } from './doc';

/** Union-Find über Punkte, die durch „koinzident“/„konzentrisch“ zusammenfallen. */
export function coincidenceClusters(doc: SketchDoc): Map<Id, Id> {
  const parent = new Map<Id, Id>();
  const find = (a: Id): Id => {
    let r = a;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    // Pfadkompression
    let x = a;
    while (parent.has(x) && parent.get(x) !== r) {
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
  for (const id of Object.keys(doc.points)) parent.set(id, id);
  for (const c of Object.values(doc.constraints)) {
    if (c.kind === 'coincident' && doc.points[c.refs[0]] && doc.points[c.refs[1]]) union(c.refs[0], c.refs[1]);
    if (c.kind === 'concentric') {
      const a = circleOf(doc, c.refs[0])?.center ?? c.refs[0];
      const b = circleOf(doc, c.refs[1])?.center ?? c.refs[1];
      if (doc.points[a] && doc.points[b]) union(a, b);
    }
  }
  const out = new Map<Id, Id>();
  for (const id of Object.keys(doc.points)) out.set(id, find(id));
  return out;
}

/** Punkt-Ids, die mit `id` zusammenfallen (inkl. id selbst). */
export function clusterMembers(clusters: Map<Id, Id>, id: Id): Id[] {
  const root = clusters.get(id);
  const out: Id[] = [];
  for (const [p, r] of clusters) if (r === root) out.push(p);
  return out;
}
