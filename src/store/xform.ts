import type { Entity, Id, SketchDoc, Vec2 } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { addConstraint, addDimension, entityPointIds, newId } from '../model/doc';
import { groupMembers } from '../model/layers';
import { numberToExpr } from '../params/expr';

/**
 * Transformationen auf einem Entwurf (immer): Verschieben, Drehen, Skalieren, Spiegeln,
 * sowie Klonen für Kopien und Muster.
 */

export type Xf =
  | { kind: 'move'; dx: number; dy: number }
  | { kind: 'rotate'; angle: number; cx: number; cy: number }
  | { kind: 'scale'; k: number; cx: number; cy: number }
  | { kind: 'mirror'; axis: 'x' | 'y'; cx: number; cy: number };

export function xfPoint(xf: Xf, p: Vec2): Vec2 {
  switch (xf.kind) {
    case 'move':
      return { x: p.x + xf.dx, y: p.y + xf.dy };
    case 'rotate': {
      const a = (xf.angle * Math.PI) / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = p.x - xf.cx;
      const y = p.y - xf.cy;
      return { x: xf.cx + c * x - s * y, y: xf.cy + s * x + c * y };
    }
    case 'scale':
      return { x: xf.cx + (p.x - xf.cx) * xf.k, y: xf.cy + (p.y - xf.cy) * xf.k };
    case 'mirror':
      return xf.axis === 'y' ? { x: 2 * xf.cx - p.x, y: p.y } : { x: p.x, y: 2 * xf.cy - p.y };
  }
}

const clean = (v: number) => (Math.abs(v - Math.round(v)) < 1e-9 ? Math.round(v) : Math.round(v * 1e9) / 1e9);
const isNum = (expr: string) => /^\s*-?\d+([.,]\d+)?\s*$/.test(expr);
const norm360 = (a: number) => ((a % 360) + 360) % 360;

/** Hinweise, die der Aufrufer anzeigen kann (z. B. Text lässt sich nicht drehen). */
export interface XfReport {
  notes: Set<string>;
}

/** Wendet eine Transformation auf Objekte (inkl. Gruppenmitglieder) an. */
export function applyXf(d: SketchDoc, ids: Id[], xf: Xf, report: XfReport = { notes: new Set() }): void {
  const targets = new Set<Id>();
  for (const id of ids) for (const m of groupMembers(d, id)) if (d.entities[m]) targets.add(m);
  const pts = new Set<Id>();
  for (const id of targets) {
    const e = d.entities[id];
    if (e.kind === 'path') e.edges.forEach((ed) => targets.add(ed.id));
    for (const pid of entityPointIds(d, e)) if (pid !== ORIGIN_ID) pts.add(pid);
  }
  for (const pid of pts) {
    const p = d.points[pid];
    if (!p) continue;
    const q = xfPoint(xf, p);
    p.x = clean(q.x);
    p.y = clean(q.y);
  }
  const quarter = xf.kind === 'rotate' ? norm360(xf.angle) : 0;
  for (const id of targets) {
    const e = d.entities[id];
    if (xf.kind === 'scale') {
      if (e.kind === 'circle') e.r *= Math.abs(xf.k);
      if (e.kind === 'text') e.fontSize *= Math.abs(xf.k);
      if (e.kind === 'shape') e.scale *= Math.abs(xf.k);
      if (e.kind === 'image') {
        e.width *= Math.abs(xf.k);
        e.height *= Math.abs(xf.k);
      }
    } else if (xf.kind === 'rotate') {
      if (e.kind === 'shape' || e.kind === 'image') e.rotation = norm360(e.rotation + xf.angle);
      if (e.kind === 'text' && quarter !== 0) report.notes.add('Texte lassen sich nicht drehen – nur ihre Lage wurde mitgedreht. Für gedrehten Text erst „Text in Pfade“.');
    } else if (xf.kind === 'mirror') {
      if (e.kind === 'shape' || e.kind === 'image') {
        e.flipX = !e.flipX;
        e.rotation = norm360(xf.axis === 'y' ? -e.rotation : 180 - e.rotation);
      }
      if (e.kind === 'text') report.notes.add('Texte werden beim Spiegeln nur versetzt, nicht gespiegelt. Für gespiegelten Text erst „Text in Pfade“.');
      // Spiegeln kehrt die Laufrichtung um: Start und Ende tauschen, damit der Bogen derselbe bleibt
      if (e.kind === 'arc') [e.p1, e.p2] = [e.p2, e.p1];
    }
  }
  if (xf.kind === 'move') {
    for (const c of Object.values(d.constraints))
      if (c.kind === 'fix' && c.fixedAt && (pts.has(c.refs[0]) || targets.has(c.refs[0]))) {
        c.fixedAt[0] += xf.dx;
        c.fixedAt[1] += xf.dy;
        if (c.fixedAt.length === 6)
          for (let k = 2; k < 6; k += 2) {
            c.fixedAt[k] += xf.dx;
            c.fixedAt[k + 1] += xf.dy;
          }
      }
    return;
  }
  const inTargets = (rid: Id) => targets.has(rid) || pts.has(rid);
  // Abhängigkeiten anpassen
  for (const c of Object.values(d.constraints)) {
    if (!c.refs.some(inTargets)) continue;
    if (c.kind === 'fix' && c.fixedAt) {
      const q = xfPoint(xf, { x: c.fixedAt[0], y: c.fixedAt[1] });
      c.fixedAt[0] = q.x;
      c.fixedAt[1] = q.y;
      if (c.fixedAt.length === 6) {
        // Bogen: Mittelpunkt, Start, Ende (beim Spiegeln Start/Ende getauscht)
        for (let k = 2; k < 6; k += 2) {
          const r = xfPoint(xf, { x: c.fixedAt[k], y: c.fixedAt[k + 1] });
          c.fixedAt[k] = r.x;
          c.fixedAt[k + 1] = r.y;
        }
        if (xf.kind === 'mirror') c.fixedAt = [c.fixedAt[0], c.fixedAt[1], c.fixedAt[4], c.fixedAt[5], c.fixedAt[2], c.fixedAt[3]];
      } else if (xf.kind === 'scale' && c.fixedAt.length > 2) c.fixedAt[2] *= Math.abs(xf.k);
    }
    if (xf.kind === 'rotate' && (c.kind === 'horizontal' || c.kind === 'vertical')) {
      if (quarter === 90 || quarter === 270) c.kind = c.kind === 'horizontal' ? 'vertical' : 'horizontal';
      else if (quarter !== 0 && quarter !== 180) delete d.constraints[c.id];
    }
  }
  // Bemaßungen anpassen (nur reine Zahlen; Ausdrücke bleiben, wie sie sind)
  for (const m of Object.values(d.dims)) {
    if (!m.refs.every(inTargets)) continue;
    const linear = m.kind !== 'angle' && m.kind !== 'angleX';
    if (xf.kind === 'scale' && linear && m.kind !== 'width' && m.kind !== 'height' && isNum(m.expr)) {
      m.value *= Math.abs(xf.k);
      m.expr = numberToExpr(m.value);
    }
    if ((m.kind === 'distanceX' || m.kind === 'distanceY') && (xf.kind === 'mirror' || (xf.kind === 'rotate' && quarter !== 0))) {
      // Achsparallele Maße passen nicht mehr: als ausgerichteter Abstand weiterführen
      m.kind = 'distance';
    }
    if (m.kind === 'angleX' && isNum(m.expr)) {
      if (xf.kind === 'rotate') m.value = norm360(m.value + xf.angle);
      if (xf.kind === 'mirror') m.value = norm360((xf.axis === 'y' ? 180 : 360) - m.value);
      m.expr = numberToExpr(m.value);
    }
    if (m.kind === 'angle' && xf.kind === 'mirror' && isNum(m.expr)) {
      m.value = norm360(360 - m.value);
      m.expr = numberToExpr(m.value);
    }
  }
}

function prefixOf(e: Entity | undefined): string {
  if (!e) return 'x';
  return e.kind === 'line' ? 'l' : e.kind === 'circle' ? 'c' : e.kind === 'arc' ? 'a' : e.kind === 'text' ? 't' : e.kind === 'path' ? 'pa' : 's';
}

/**
 * Kopiert Objekte aus `src` in den Entwurf (neue Ids, innere Abhängigkeiten und Bemaßungen
 * kommen mit). Gruppen der Kopie bekommen neue Gruppen-Ids. Rückgabe: neue Objekt-Ids.
 */
export function cloneInto(d: SketchDoc, src: SketchDoc, ids: Id[]): Id[] {
  const idMap = new Map<Id, Id>();
  const mapId = (old: Id, prefix: string) => {
    let n = idMap.get(old);
    if (!n) {
      n = newId(d, prefix);
      idMap.set(old, n);
    }
    return n;
  };
  const groupMap = new Map<Id, Id>();
  const ents = new Set<Id>();
  for (const id of ids) {
    const e = src.entities[id];
    if (!e) continue;
    ents.add(id);
    if (e.kind === 'path') e.edges.forEach((ed) => ents.add(ed.id));
  }
  for (const p of Object.values(src.points)) {
    if (!p.owner || !ents.has(p.owner)) continue;
    const nid = mapId(p.id, 'p');
    d.points[nid] = { ...p, id: nid, owner: mapId(p.owner, prefixOf(src.entities[p.owner])) };
  }
  for (const eid of ents) {
    const e = src.entities[eid];
    const nid = mapId(eid, prefixOf(e));
    const copy = structuredClone(e) as Entity;
    copy.id = nid;
    if (copy.kind === 'line') {
      copy.p1 = idMap.get(copy.p1)!;
      copy.p2 = idMap.get(copy.p2)!;
    } else if (copy.kind === 'circle') copy.center = idMap.get(copy.center)!;
    else if (copy.kind === 'arc') {
      copy.center = idMap.get(copy.center)!;
      copy.p1 = idMap.get(copy.p1)!;
      copy.p2 = idMap.get(copy.p2)!;
    }
    else if (copy.kind === 'text' || copy.kind === 'shape' || copy.kind === 'image') copy.anchor = idMap.get(copy.anchor)!;
    else if (copy.kind === 'path') copy.edges = copy.edges.map((ed) => ({ ...ed, id: mapId(ed.id, prefixOf(src.entities[ed.id])) }));
    if (copy.group) {
      let g = groupMap.get(copy.group);
      if (!g) {
        g = newId(d, 'g');
        groupMap.set(copy.group, g);
      }
      copy.group = g;
    }
    d.entities[nid] = copy;
  }
  const created: Id[] = [];
  for (const id of ids) {
    const nid = idMap.get(id);
    if (nid && !created.includes(nid)) {
      d.order.push(nid);
      created.push(nid);
    }
  }
  const inside = (rid: Id) => idMap.has(rid);
  for (const c of Object.values(src.constraints)) {
    if (c.kind === 'fix' || !c.refs.every(inside)) continue;
    addConstraint(d, c.kind, c.refs.map((r) => idMap.get(r)!));
  }
  for (const m of Object.values(src.dims)) {
    if (!m.refs.every(inside)) continue;
    addDimension(d, { ...m, refs: m.refs.map((r) => idMap.get(r)!), expr: numberToExpr(m.value) });
  }
  return created;
}
