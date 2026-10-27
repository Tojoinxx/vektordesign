import type { SketchPrimitive } from '@salusoft89/planegcs';
import type { Constraint, Dimension, Id, SketchDoc } from '../model/types';
import { circleOf, lineOf } from '../model/doc';

/**
 * Übersetzt das Datenmodell in planegcs-Primitive.
 *
 * Eine Abhängigkeit kann mehrere Solver-Gleichungen erzeugen; deren Ids lauten
 * `<modelId>~<n>`. modelIdOf() führt sie wieder auf das Modell zurück.
 */

export const SEP = '~';
export const modelIdOf = (gcsId: string) => gcsId.split(SEP)[0];

const DEG = Math.PI / 180;

export function geometryPrimitives(doc: SketchDoc): SketchPrimitive[] {
  const out: SketchPrimitive[] = [];
  for (const p of Object.values(doc.points)) {
    out.push({ id: p.id, type: 'point', x: p.x, y: p.y, fixed: !!p.locked });
  }
  for (const e of Object.values(doc.entities)) {
    if (e.kind === 'line') out.push({ id: e.id, type: 'line', p1_id: e.p1, p2_id: e.p2 });
    else if (e.kind === 'circle') out.push({ id: e.id, type: 'circle', c_id: e.center, radius: e.r });
  }
  return out;
}

export function constraintPrimitives(doc: SketchDoc, c: Constraint): SketchPrimitive[] {
  const r = c.refs;
  const id = (n: number) => `${c.id}${SEP}${n}`;
  const isPt = (x: Id) => x in doc.points;
  switch (c.kind) {
    case 'coincident': {
      const [a, b] = r;
      if (isPt(b)) return [{ id: id(0), type: 'p2p_coincident', p1_id: a, p2_id: b }];
      if (lineOf(doc, b)) return [{ id: id(0), type: 'point_on_line_pl', p_id: a, l_id: b }];
      if (circleOf(doc, b)) return [{ id: id(0), type: 'point_on_circle', p_id: a, c_id: b }];
      return [];
    }
    case 'horizontal':
      return r.length === 1
        ? [{ id: id(0), type: 'horizontal_l', l_id: r[0] }]
        : [{ id: id(0), type: 'horizontal_pp', p1_id: r[0], p2_id: r[1] }];
    case 'vertical':
      return r.length === 1
        ? [{ id: id(0), type: 'vertical_l', l_id: r[0] }]
        : [{ id: id(0), type: 'vertical_pp', p1_id: r[0], p2_id: r[1] }];
    case 'parallel':
      return [{ id: id(0), type: 'parallel', l1_id: r[0], l2_id: r[1] }];
    case 'perpendicular':
      return [{ id: id(0), type: 'perpendicular_ll', l1_id: r[0], l2_id: r[1] }];
    case 'collinear': {
      const l2 = lineOf(doc, r[1]);
      if (!l2) return [];
      return [
        { id: id(0), type: 'point_on_line_pl', p_id: l2.p1, l_id: r[0] },
        { id: id(1), type: 'point_on_line_pl', p_id: l2.p2, l_id: r[0] },
      ];
    }
    case 'tangent':
      if (lineOf(doc, r[0])) return [{ id: id(0), type: 'tangent_lc', l_id: r[0], c_id: r[1] }];
      return [{ id: id(0), type: 'tangent_cc', c1_id: r[0], c2_id: r[1] }];
    case 'concentric': {
      const ctr = (x: Id) => circleOf(doc, x)?.center ?? x;
      return [{ id: id(0), type: 'p2p_coincident', p1_id: ctr(r[0]), p2_id: ctr(r[1]) }];
    }
    case 'equal':
      if (lineOf(doc, r[0])) return [{ id: id(0), type: 'equal_length', l1_id: r[0], l2_id: r[1] }];
      return [{ id: id(0), type: 'equal_radius_cc', c1_id: r[0], c2_id: r[1] }];
    case 'symmetric':
      // Symmetrisch zu einer Achse (Linie) oder zu einem Punkt (Mittelpunkt von A und B)
      if (isPt(r[2])) return [{ id: id(0), type: 'p2p_symmetric_ppp', p1_id: r[0], p2_id: r[1], p_id: r[2] }];
      return [{ id: id(0), type: 'p2p_symmetric_ppl', p1_id: r[0], p2_id: r[1], l_id: r[2] }];
    case 'midpoint': {
      const l = lineOf(doc, r[1]);
      if (!l) return [];
      return [{ id: id(0), type: 'p2p_symmetric_ppp', p1_id: l.p1, p2_id: l.p2, p_id: r[0] }];
    }
    case 'fix': {
      const f = c.fixedAt ?? [];
      if (isPt(r[0])) {
        return [
          { id: id(0), type: 'coordinate_x', p_id: r[0], x: f[0] },
          { id: id(1), type: 'coordinate_y', p_id: r[0], y: f[1] },
        ];
      }
      const ci = circleOf(doc, r[0]);
      if (ci) {
        return [
          { id: id(0), type: 'coordinate_x', p_id: ci.center, x: f[0] },
          { id: id(1), type: 'coordinate_y', p_id: ci.center, y: f[1] },
          { id: id(2), type: 'circle_radius', c_id: r[0], radius: f[2] },
        ];
      }
      return [];
    }
  }
}

export function dimensionPrimitives(doc: SketchDoc, d: Dimension): SketchPrimitive[] {
  if (d.driven) return [];
  const r = d.refs;
  const id = `${d.id}${SEP}0`;
  switch (d.kind) {
    case 'distance':
      return [{ id, type: 'p2p_distance', p1_id: r[0], p2_id: r[1], distance: d.value }];
    case 'distanceX':
      return [
        { id, type: 'difference', param1: { o_id: r[0], prop: 'x' }, param2: { o_id: r[1], prop: 'x' }, difference: d.value },
      ];
    case 'distanceY':
      return [
        { id, type: 'difference', param1: { o_id: r[0], prop: 'y' }, param2: { o_id: r[1], prop: 'y' }, difference: d.value },
      ];
    case 'pointLine':
      return [{ id, type: 'p2l_distance', p_id: r[0], l_id: r[1], distance: d.value }];
    case 'lineLine': {
      const b = lineOf(doc, r[1]);
      if (!b) return [];
      return [{ id, type: 'p2l_distance', p_id: b.p1, l_id: r[0], distance: d.value }];
    }
    case 'radius':
      return [{ id, type: 'circle_radius', c_id: r[0], radius: d.value }];
    case 'diameter':
      return [{ id, type: 'circle_diameter', c_id: r[0], diameter: d.value }];
    case 'angle':
      return [
        { id, type: 'l2l_angle_pppp', l1p1_id: r[0], l1p2_id: r[1], l2p1_id: r[2], l2p2_id: r[3], angle: d.value * DEG },
      ];
    case 'angleX':
      return [{ id, type: 'p2p_angle', p1_id: r[0], p2_id: r[1], angle: d.value * DEG }];
    case 'width':
    case 'height':
      // Größe einer Form: wirkt auf deren Maßstab, nicht über den Solver
      return [];
  }
}
