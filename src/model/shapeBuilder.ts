import type { Vec2 } from './types';
import { areaOf, intersectArea, subtractArea, unionArea } from './boolean';
import { polyArea, pointInPolys } from './shape';

/**
 * Formgenerator (wie Shape Builder in Illustrator/Affinity): Überlappende Flächen werden in Teilflächen zerlegt.
 * Jede Teilfläche weiß, welche Ausgangsflächen sie bedecken. Rein rechnerisch, ohne Editor.
 */

export interface BuilderRegion {
  /** Umriss (mit Löchern), Füllregel gerade/ungerade */
  polys: Vec2[][];
  /** Indizes der Ausgangsflächen, die diese Teilfläche bedecken (aufsteigend = von hinten nach vorne) */
  owners: number[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
  area: number;
}

/** Kleinste sinnvolle Teilfläche (mm²); kleinere Splitter entstehen durch Rundung und werden verworfen. */
const MIN_AREA = 0.02;

/** Flächen in zusammenhängende Teile zerlegen (Außenumriss + zugehörige Löcher). */
export function components(polys: Vec2[][]): Vec2[][][] {
  if (!polys.length) return [];
  const signed = polys.map((p) => ({ p, a: polyArea(p) }));
  const outerSign = Math.sign(signed.reduce((m, q) => (Math.abs(q.a) > Math.abs(m.a) ? q : m)).a) || 1;
  const outers = signed.filter((q) => Math.sign(q.a) === outerSign).map((q) => ({ ...q, holes: [] as Vec2[][] }));
  const holes = signed.filter((q) => Math.sign(q.a) !== outerSign);
  outers.sort((x, y) => Math.abs(x.a) - Math.abs(y.a));
  for (const h of holes) {
    const probe = h.p[0];
    const host = outers.find((o) => pointInPolys(probe, [o.p], 'nonzero'));
    if (host) host.holes.push(h.p);
  }
  return outers.map((o) => [o.p, ...o.holes]);
}

function boxOf(polys: Vec2[][]): BuilderRegion['box'] {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of polys)
    for (const v of p) {
      if (v.x < b.minX) b.minX = v.x;
      if (v.y < b.minY) b.minY = v.y;
      if (v.x > b.maxX) b.maxX = v.x;
      if (v.y > b.maxY) b.maxY = v.y;
    }
  return b;
}

/** Teilflächen aller Überschneidungen. `areas[i]` = Fläche der i-ten Ausgangsform (von hinten nach vorne). */
export function buildRegions(areas: Vec2[][][]): BuilderRegion[] {
  let regions: { polys: Vec2[][]; owners: number[] }[] = [];
  areas.forEach((a, i) => {
    if (!a.length) return;
    const next: typeof regions = [];
    for (const r of regions) {
      const inter = intersectArea(r.polys, a);
      if (inter.length && areaOf(inter) > MIN_AREA) next.push({ polys: inter, owners: [...r.owners, i] });
      const diff = subtractArea(r.polys, a);
      if (diff.length && areaOf(diff) > MIN_AREA) next.push({ polys: diff, owners: r.owners });
    }
    const before = areas.slice(0, i).filter((x) => x.length);
    const rest = before.length ? subtractArea(a, unionArea(...before)) : unionArea(a);
    if (rest.length && areaOf(rest) > MIN_AREA) next.push({ polys: rest, owners: [i] });
    regions = next;
  });
  const out: BuilderRegion[] = [];
  for (const r of regions)
    for (const c of components(r.polys)) {
      const area = areaOf(c);
      if (area > MIN_AREA) out.push({ polys: c, owners: r.owners, box: boxOf(c), area });
    }
  return out;
}

/** Teilfläche unter einem Punkt (oder −1). */
export function regionAt(regions: BuilderRegion[], p: Vec2): number {
  let best = -1;
  for (let i = 0; i < regions.length; i++) {
    const r = regions[i];
    if (p.x < r.box.minX || p.x > r.box.maxX || p.y < r.box.minY || p.y > r.box.maxY) continue;
    if (pointInPolys(p, r.polys, 'evenodd') && (best < 0 || r.area < regions[best].area)) best = i;
  }
  return best;
}

export interface BuilderPlan {
  /** Neue, vereinigte Fläche (nur beim Vereinigen) */
  merged: Vec2[][] | null;
  /** Ausgangsform, deren Aussehen die vereinigte Fläche übernimmt */
  styleFrom: number;
  /** je Ausgangsform: neue Fläche (leer = Form entfällt) oder null = unverändert */
  rest: (Vec2[][] | null)[];
}

/**
 * Was passiert, wenn die Teilflächen `picked` vereinigt bzw. entfernt werden: Die Ausgangsformen verlieren diese
 * Teilflächen; beim Vereinigen entsteht daraus eine neue Form im Aussehen der vordersten Form der ersten Teilfläche.
 */
export function planBuild(areas: Vec2[][][], regions: BuilderRegion[], picked: number[], mode: 'merge' | 'delete'): BuilderPlan | null {
  const sel = [...new Set(picked)].filter((i) => regions[i]);
  if (!sel.length) return null;
  const P = unionArea(...sel.map((i) => regions[i].polys));
  if (!P.length) return null;
  const first = regions[sel[0]];
  const styleFrom = first.owners[first.owners.length - 1];
  const touched = new Set(sel.flatMap((i) => regions[i].owners));
  const rest = areas.map((a, i) => (touched.has(i) ? subtractArea(a, P).filter((p) => Math.abs(polyArea(p)) > MIN_AREA / 10) : null));
  return { merged: mode === 'merge' ? P : null, styleFrom, rest };
}
