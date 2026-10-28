import type { Dimension, SketchDoc, Vec2 } from '../model/types';
import { arcGeom, arcOf, roundOf } from '../model/arc';
import { entityOf, lineOf, pt } from '../model/doc';
import { contoursBBox, shapeWorldContours } from '../model/shape';
import { add, dist, dot, lineIntersection, mul, norm, normAngle2pi, projectOnLine, sub } from '../model/geometry';
import { formatNumber } from '../params/expr';
import type { Settings } from '../store/state';

/** Darstellungsgeometrie einer Bemaßung in Weltkoordinaten (mm). */
export interface DimGeom {
  /** Maß- und Hilfslinien */
  lines: [Vec2, Vec2][];
  /** Pfeilspitzen: Spitze und Richtung (Einheitsvektor, zeigt zur Spitze) */
  arrows: { tip: Vec2; dir: Vec2 }[];
  /** Bögen (Winkelbemaßung): Mittelpunkt, Radius, Start-/Endwinkel (Bogenmaß, gegen Uhrzeigersinn) */
  arcs: { c: Vec2; r: number; a0: number; a1: number }[];
  /** Textmitte */
  text: Vec2;
  label: string;
  /** Richtung der Maßlinie (für das Verschieben entlang) */
  along: Vec2;
  /** Normale der Maßlinie (für den Abstand) */
  normal: Vec2;
  /** Bezugspunkt, von dem aus `offset` gemessen wird */
  base: Vec2;
}

export function dimLabel(d: Dimension, display: Settings['dimDisplay'] = 'value'): string {
  const unit = d.kind === 'angle' || d.kind === 'angleX' ? '°' : '';
  const prefix = d.kind === 'diameter' ? 'Ø' : d.kind === 'radius' ? 'R' : '';
  const val = `${prefix}${formatNumber(d.value, 2)}${unit}`;
  let s: string;
  if (display === 'name') s = d.name;
  else if (display === 'expr') s = d.expr && d.expr !== formatNumber(d.value, 4) ? `${d.name} = ${d.expr}` : `${d.name} = ${val}`;
  else s = val;
  return d.driven ? `(${s})` : s;
}

/**
 * Berechnet die Bemaßungsgeometrie. `px` = Weltlänge eines Bildschirmpixels (1/zoom),
 * damit Abstände und Überstände unabhängig vom Zoom gleich aussehen.
 */
export function dimGeometry(doc: SketchDoc, d: Dimension, px: number, display: Settings['dimDisplay'] = 'value'): DimGeom | null {
  const label = dimLabel(d, display);
  const gap = 3 * px;
  const over = 4 * px;
  const P = (id: string) => doc.points[id];
  try {
    switch (d.kind) {
      case 'distance':
      case 'distanceX':
      case 'distanceY':
      case 'pointLine':
      case 'lineLine':
      case 'width':
      case 'height': {
        let A: Vec2;
        let B: Vec2;
        if (d.kind === 'width' || d.kind === 'height') {
          const sh = entityOf(doc, d.refs[0], 'shape');
          const b = sh ? contoursBBox(shapeWorldContours(doc, sh)) : null;
          if (!b) return null;
          if (d.kind === 'width') {
            A = { x: b.minX, y: b.maxY };
            B = { x: b.maxX, y: b.maxY };
          } else {
            A = { x: b.maxX, y: b.minY };
            B = { x: b.maxX, y: b.maxY };
          }
        } else if (d.kind === 'pointLine') {
          const l = lineOf(doc, d.refs[1]);
          if (!l || !P(d.refs[0])) return null;
          B = P(d.refs[0]);
          A = projectOnLine(B, pt(doc, l.p1), pt(doc, l.p2));
        } else if (d.kind === 'lineLine') {
          const la = lineOf(doc, d.refs[0]);
          const lb = lineOf(doc, d.refs[1]);
          if (!la || !lb) return null;
          // Mitte der zweiten Linie auf die erste projizieren
          const mb = { x: (pt(doc, lb.p1).x + pt(doc, lb.p2).x) / 2, y: (pt(doc, lb.p1).y + pt(doc, lb.p2).y) / 2 };
          B = mb;
          A = projectOnLine(mb, pt(doc, la.p1), pt(doc, la.p2));
        } else {
          if (!P(d.refs[0]) || !P(d.refs[1])) return null;
          A = P(d.refs[0]);
          B = P(d.refs[1]);
        }
        let u: Vec2;
        let n: Vec2;
        if (d.kind === 'distanceX' || d.kind === 'width') {
          u = { x: 1, y: 0 };
          n = { x: 0, y: 1 };
        } else if (d.kind === 'distanceY' || d.kind === 'height') {
          u = { x: 0, y: 1 };
          n = { x: 1, y: 0 };
        } else {
          u = dist(A, B) < 1e-9 ? { x: 1, y: 0 } : norm(sub(B, A));
          n = { x: -u.y, y: u.x };
        }
        // Maßlinie: Gerade durch base + n*offset in Richtung u
        const base = A;
        const lineOrigin = add(base, mul(n, d.offset));
        const proj = (p: Vec2) => add(lineOrigin, mul(u, dot(sub(p, lineOrigin), u)));
        const A2 = proj(A);
        const B2 = proj(B);
        const lines: [Vec2, Vec2][] = [];
        const ext = (p: Vec2, q: Vec2) => {
          const v = sub(q, p);
          const l = Math.hypot(v.x, v.y);
          if (l < gap * 1.5) return;
          const dir = mul(v, 1 / l);
          lines.push([add(p, mul(dir, gap)), add(q, mul(dir, over))]);
        };
        ext(A, A2);
        ext(B, B2);
        const mid = mul(add(A2, B2), 0.5);
        const text = add(mid, mul(u, d.shift));
        // Maßlinie ggf. bis zum Text verlängern, wenn dieser außerhalb liegt
        const ta = dot(sub(text, A2), u);
        const tb = dot(sub(B2, A2), u);
        const lo = Math.min(0, tb, ta);
        const hi = Math.max(0, tb, ta);
        lines.push([add(A2, mul(u, lo)), add(A2, mul(u, hi))]);
        const dirAB = dist(A2, B2) < 1e-9 ? u : norm(sub(B2, A2));
        const arrows = [
          { tip: A2, dir: mul(dirAB, -1) },
          { tip: B2, dir: dirAB },
        ];
        return { lines, arrows, arcs: [], text, label, along: u, normal: n, base };
      }
      case 'radius':
      case 'diameter': {
        const c = roundOf(doc, d.refs[0]);
        if (!c) return null;
        const C = pt(doc, c.center);
        const ar = arcOf(doc, d.refs[0]);
        const ang = d.angle ?? (ar ? (() => {
          const g = arcGeom(doc, ar);
          return g.a0 + g.sweep / 2;
        })() : Math.PI / 4);
        const dir = { x: Math.cos(ang), y: Math.sin(ang) };
        const rim = add(C, mul(dir, c.r));
        const textDist = Math.max(d.offset, 0) + 14 * px;
        const text = add(C, mul(dir, c.r + textDist));
        const lines: [Vec2, Vec2][] = [];
        const arrows: DimGeom['arrows'] = [];
        if (d.kind === 'diameter') {
          const rim2 = add(C, mul(dir, -c.r));
          lines.push([rim2, add(C, mul(dir, c.r + textDist - 8 * px))]);
          arrows.push({ tip: rim, dir }, { tip: rim2, dir: mul(dir, -1) });
        } else {
          lines.push([C, add(C, mul(dir, c.r + textDist - 8 * px))]);
          arrows.push({ tip: rim, dir });
        }
        return { lines, arrows, arcs: [], text, label, along: dir, normal: { x: -dir.y, y: dir.x }, base: C };
      }
      case 'angle': {
        const [a1, a2, b1, b2] = d.refs.map((id) => P(id));
        if (!a1 || !a2 || !b1 || !b2) return null;
        let V = lineIntersection(a1, a2, b1, b2);
        if (!V) V = a1;
        const u = norm(sub(a2, a1));
        const startAng = Math.atan2(u.y, u.x);
        const sweep = (d.value * Math.PI) / 180;
        const r = Math.max(d.offset, 10 * px);
        const a0 = startAng;
        const a1n = startAng + sweep;
        const midAng = startAng + sweep / 2;
        const text = add(V, mul({ x: Math.cos(midAng), y: Math.sin(midAng) }, r + 12 * px));
        const lines: [Vec2, Vec2][] = [];
        // Hilfslinien, falls der Bogen außerhalb der Linien liegt
        const ends = [
          [a1, a2, a0],
          [b1, b2, a1n],
        ] as const;
        for (const [p, q, ang] of ends) {
          const e = add(V, mul({ x: Math.cos(ang), y: Math.sin(ang) }, r + over));
          const far = dist(V, p) > dist(V, q) ? p : q;
          if (dist(V, far) < r) lines.push([add(V, mul({ x: Math.cos(ang), y: Math.sin(ang) }, dist(V, far) + gap)), e]);
        }
        const tip0 = add(V, mul({ x: Math.cos(a0), y: Math.sin(a0) }, r));
        const tip1 = add(V, mul({ x: Math.cos(a1n), y: Math.sin(a1n) }, r));
        const arrows = [
          { tip: tip0, dir: { x: Math.sin(a0), y: -Math.cos(a0) } },
          { tip: tip1, dir: { x: -Math.sin(a1n), y: Math.cos(a1n) } },
        ];
        return {
          lines,
          arrows,
          arcs: [{ c: V, r, a0, a1: a1n }],
          text,
          label,
          along: { x: -Math.sin(midAng), y: Math.cos(midAng) },
          normal: { x: Math.cos(midAng), y: Math.sin(midAng) },
          base: V,
        };
      }
      case 'angleX': {
        const A = P(d.refs[0]);
        const B = P(d.refs[1]);
        if (!A || !B) return null;
        const ang = normAngle2pi(Math.atan2(B.y - A.y, B.x - A.x));
        const r = Math.max(d.offset, 10 * px);
        const midAng = ang / 2;
        const text = add(A, mul({ x: Math.cos(midAng), y: Math.sin(midAng) }, r + 12 * px));
        const lines: [Vec2, Vec2][] = [[A, add(A, { x: r + over, y: 0 })]];
        const tip1 = add(A, mul({ x: Math.cos(ang), y: Math.sin(ang) }, r));
        return {
          lines,
          arrows: [
            { tip: add(A, { x: r, y: 0 }), dir: { x: 0, y: -1 } },
            { tip: tip1, dir: { x: -Math.sin(ang), y: Math.cos(ang) } },
          ],
          arcs: [{ c: A, r, a0: 0, a1: ang }],
          text,
          label,
          along: { x: -Math.sin(midAng), y: Math.cos(midAng) },
          normal: { x: Math.cos(midAng), y: Math.sin(midAng) },
          base: A,
        };
      }
    }
  } catch {
    return null;
  }
}
