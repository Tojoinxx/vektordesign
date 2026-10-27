import type { Constraint, Dimension, SketchDoc, Vec2 } from './types';
import { circleOf, entityOf, lineOf, pt } from './doc';
import { shapeSize } from './shape';
import { cross, dist, distToLine, dot, mid, normAngle, normAngle2pi, sub, toDeg } from './geometry';

/** Aktueller Messwert einer Bemaßung in mm bzw. Grad (vorzeichenrichtig, wo sinnvoll). */
export function measureDim(doc: SketchDoc, dim: Pick<Dimension, 'kind' | 'refs'>): number {
  const r = dim.refs;
  switch (dim.kind) {
    case 'distance':
      return dist(pt(doc, r[0]), pt(doc, r[1]));
    case 'distanceX':
      return pt(doc, r[1]).x - pt(doc, r[0]).x;
    case 'distanceY':
      return pt(doc, r[1]).y - pt(doc, r[0]).y;
    case 'pointLine': {
      const l = lineOf(doc, r[1]);
      if (!l) return NaN;
      return distToLine(pt(doc, r[0]), pt(doc, l.p1), pt(doc, l.p2));
    }
    case 'lineLine': {
      const a = lineOf(doc, r[0]);
      const b = lineOf(doc, r[1]);
      if (!a || !b) return NaN;
      return distToLine(pt(doc, b.p1), pt(doc, a.p1), pt(doc, a.p2));
    }
    case 'radius': {
      const c = circleOf(doc, r[0]);
      return c ? c.r : NaN;
    }
    case 'diameter': {
      const c = circleOf(doc, r[0]);
      return c ? 2 * c.r : NaN;
    }
    case 'angle': {
      const u = sub(pt(doc, r[1]), pt(doc, r[0]));
      const w = sub(pt(doc, r[3]), pt(doc, r[2]));
      return toDeg(normAngle2pi(Math.atan2(cross(u, w), dot(u, w))));
    }
    case 'angleX': {
      const u = sub(pt(doc, r[1]), pt(doc, r[0]));
      return toDeg(normAngle2pi(Math.atan2(u.y, u.x)));
    }
    case 'width':
    case 'height': {
      const s = entityOf(doc, r[0], 'shape');
      if (!s) return NaN;
      const z = shapeSize(s);
      return dim.kind === 'width' ? z.w : z.h;
    }
  }
}

/** Anzeigewert (Beträge, Winkel 0…360). */
export function displayValue(doc: SketchDoc, dim: Dimension): number {
  const m = measureDim(doc, dim);
  if (dim.kind === 'distanceX' || dim.kind === 'distanceY') return Math.abs(m);
  return m;
}

const lineEndsOf = (doc: SketchDoc, id: string): [Vec2, Vec2] | null => {
  const l = lineOf(doc, id);
  return l ? [pt(doc, l.p1), pt(doc, l.p2)] : null;
};

/** Restfehler einer Abhängigkeit (0 = erfüllt). Für Prüfungen nach dem Lösen. */
export function constraintError(doc: SketchDoc, c: Constraint): number {
  const r = c.refs;
  const P = (id: string) => doc.points[id];
  switch (c.kind) {
    case 'coincident': {
      const a = P(r[0]);
      if (!a) return NaN;
      if (P(r[1])) return dist(a, P(r[1]));
      const l = lineEndsOf(doc, r[1]);
      if (l) return distToLine(a, l[0], l[1]);
      const ci = circleOf(doc, r[1]);
      if (ci) return Math.abs(dist(a, pt(doc, ci.center)) - ci.r);
      return NaN;
    }
    case 'horizontal':
    case 'vertical': {
      const ends = r.length === 1 ? lineEndsOf(doc, r[0]) : [P(r[0]), P(r[1])];
      if (!ends || !ends[0] || !ends[1]) return NaN;
      return c.kind === 'horizontal' ? Math.abs(ends[1].y - ends[0].y) : Math.abs(ends[1].x - ends[0].x);
    }
    case 'parallel':
    case 'perpendicular':
    case 'collinear': {
      const a = lineEndsOf(doc, r[0]);
      const b = lineEndsOf(doc, r[1]);
      if (!a || !b) return NaN;
      const u = sub(a[1], a[0]);
      const w = sub(b[1], b[0]);
      const lu = Math.hypot(u.x, u.y) || 1;
      const lw = Math.hypot(w.x, w.y) || 1;
      if (c.kind === 'perpendicular') return Math.abs(dot(u, w)) / (lu * lw);
      const par = Math.abs(cross(u, w)) / (lu * lw);
      if (c.kind === 'parallel') return par;
      return Math.max(par, distToLine(b[0], a[0], a[1]), distToLine(b[1], a[0], a[1]));
    }
    case 'tangent': {
      const l = lineEndsOf(doc, r[0]);
      const c2 = circleOf(doc, r[1]);
      if (l && c2) return Math.abs(distToLine(pt(doc, c2.center), l[0], l[1]) - c2.r);
      const c1 = circleOf(doc, r[0]);
      if (c1 && c2) {
        const d = dist(pt(doc, c1.center), pt(doc, c2.center));
        return Math.min(Math.abs(d - (c1.r + c2.r)), Math.abs(d - Math.abs(c1.r - c2.r)));
      }
      return NaN;
    }
    case 'concentric': {
      const centerOf = (id: string) => {
        const ci = circleOf(doc, id);
        return ci ? pt(doc, ci.center) : P(id);
      };
      const a = centerOf(r[0]);
      const b = centerOf(r[1]);
      return a && b ? dist(a, b) : NaN;
    }
    case 'equal': {
      const a = lineEndsOf(doc, r[0]);
      const b = lineEndsOf(doc, r[1]);
      if (a && b) return Math.abs(dist(a[0], a[1]) - dist(b[0], b[1]));
      const c1 = circleOf(doc, r[0]);
      const c2 = circleOf(doc, r[1]);
      if (c1 && c2) return Math.abs(c1.r - c2.r);
      return NaN;
    }
    case 'symmetric': {
      const a = P(r[0]);
      const b = P(r[1]);
      if (a && b && P(r[2])) return dist(P(r[2]), mid(a, b));
      const ax = lineEndsOf(doc, r[2]);
      if (!a || !b || !ax) return NaN;
      const m = mid(a, b);
      const d = sub(ax[1], ax[0]);
      const ab = sub(b, a);
      const l = Math.hypot(d.x, d.y) || 1;
      return Math.max(distToLine(m, ax[0], ax[1]), Math.abs(dot(ab, d)) / l);
    }
    case 'midpoint': {
      const p = P(r[0]);
      const l = lineEndsOf(doc, r[1]);
      if (!p || !l) return NaN;
      return dist(p, mid(l[0], l[1]));
    }
    case 'fix': {
      const p = P(r[0]);
      const f = c.fixedAt ?? [];
      if (p) return Math.hypot(p.x - f[0], p.y - f[1]);
      const ci = circleOf(doc, r[0]);
      if (ci) {
        const ctr = pt(doc, ci.center);
        return Math.max(Math.hypot(ctr.x - f[0], ctr.y - f[1]), Math.abs(ci.r - f[2]));
      }
      return NaN;
    }
  }
}

/** Restfehler einer treibenden Bemaßung. */
export function dimError(doc: SketchDoc, d: Dimension): number {
  const m = measureDim(doc, d);
  if (d.kind === 'angle' || d.kind === 'angleX') {
    const diff = normAngle(((m - d.value) * Math.PI) / 180);
    return Math.abs(diff);
  }
  return Math.abs(m - d.value);
}
