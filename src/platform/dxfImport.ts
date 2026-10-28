import type { Contour, ShapeNode, Vec2 } from '../model/types';

/**
 * DXF-Import (ASCII): LINE, CIRCLE, ARC werden zu Skizzengeometrie (bemaßbar), LWPOLYLINE,
 * POLYLINE (mit Bögen über „bulge“), ELLIPSE und SPLINE zu Formen. Einheit aus $INSUNITS.
 */

export interface DxfImportResult {
  lines: [Vec2, Vec2][];
  circles: { c: Vec2; r: number }[];
  /** Winkel in Grad, gegen den Uhrzeigersinn */
  arcs: { c: Vec2; r: number; a0: number; a1: number }[];
  shapes: Contour[];
  warnings: string[];
  unit: string;
}

const UNITS: Record<number, [number, string]> = { 0: [1, 'mm (ohne Angabe)'], 1: [25.4, 'Zoll'], 2: [304.8, 'Fuß'], 4: [1, 'mm'], 5: [10, 'cm'], 6: [1000, 'm'] };

function pairs(text: string): [number, string][] {
  const lines = text.split(/\r?\n/);
  const out: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isFinite(code)) {
      i--;
      continue;
    }
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

/** Polylinien-Stück mit Ausbauchung (bulge = tan(Winkel/4)) als Bézier-Knoten. */
function bulgeNodes(a: Vec2, b: Vec2, bulge: number): { out: Partial<ShapeNode>; inn: Partial<ShapeNode>; extra: ShapeNode[] } {
  if (Math.abs(bulge) < 1e-9) return { out: {}, inn: {}, extra: [] };
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  // Mittelpunkt
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const ux = (b.x - a.x) / chord;
  const uy = (b.y - a.y) / chord;
  const sgn = (bulge > 0 ? 1 : -1) * (Math.abs(theta) > Math.PI ? -1 : 1);
  const c = { x: mx - uy * d * sgn, y: my + ux * d * sgn };
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const segs = Math.max(1, Math.ceil(Math.abs(theta) / (Math.PI / 2)));
  const step = theta / segs;
  const k = (4 / 3) * Math.tan(step / 4) * r;
  const pts: ShapeNode[] = [];
  for (let i = 0; i <= segs; i++) {
    const ang = a0 + step * i;
    const t = { x: -Math.sin(ang) * k, y: Math.cos(ang) * k };
    pts.push({
      x: c.x + r * Math.cos(ang),
      y: c.y + r * Math.sin(ang),
      ix: c.x + r * Math.cos(ang) - t.x,
      iy: c.y + r * Math.sin(ang) - t.y,
      ox: c.x + r * Math.cos(ang) + t.x,
      oy: c.y + r * Math.sin(ang) + t.y,
    });
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  return { out: { ox: first.ox, oy: first.oy }, inn: { ix: last.ix, iy: last.iy }, extra: pts.slice(1, -1) };
}

function polylineContour(verts: { x: number; y: number; bulge: number }[], closed: boolean): Contour {
  const nodes: ShapeNode[] = [];
  const n = verts.length;
  for (let i = 0; i < n; i++) nodes.push({ x: verts[i].x, y: verts[i].y });
  const outNodes: ShapeNode[] = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < n; i++) {
    outNodes.push(nodes[i]);
    if (i >= segs) continue;
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const bn = bulgeNodes(a, b, a.bulge);
    Object.assign(nodes[i], bn.out);
    outNodes.push(...bn.extra);
    Object.assign(nodes[(i + 1) % n], bn.inn);
  }
  return { closed, nodes: outNodes };
}

export function importDxf(text: string): DxfImportResult {
  const ps = pairs(text);
  const warnings = new Set<string>();
  let insunits = 0;
  for (let i = 0; i < ps.length; i++) if (ps[i][0] === 9 && ps[i][1] === '$INSUNITS' && ps[i + 1]) insunits = Number(ps[i + 1][1]);
  const [k, unit] = UNITS[insunits] ?? [1, 'mm'];
  const res: DxfImportResult = { lines: [], circles: [], arcs: [], shapes: [], warnings: [], unit };
  // Abschnitt ENTITIES
  let i = ps.findIndex((p, j) => p[0] === 2 && p[1] === 'ENTITIES' && ps[j - 1]?.[1] === 'SECTION');
  if (i < 0) throw new Error('In der DXF-Datei gibt es keinen Abschnitt ENTITIES.');
  i++;
  while (i < ps.length) {
    if (ps[i][0] !== 0) {
      i++;
      continue;
    }
    const type = ps[i][1];
    if (type === 'ENDSEC') break;
    // Gruppen dieses Objekts sammeln
    const g: [number, string][] = [];
    i++;
    while (i < ps.length && ps[i][0] !== 0) g.push(ps[i++]);
    const v = (code: number) => {
      const p = g.find((x) => x[0] === code);
      return p ? Number(p[1]) : 0;
    };
    switch (type) {
      case 'LINE':
        res.lines.push([
          { x: v(10) * k, y: v(20) * k },
          { x: v(11) * k, y: v(21) * k },
        ]);
        break;
      case 'CIRCLE':
        res.circles.push({ c: { x: v(10) * k, y: v(20) * k }, r: v(40) * k });
        break;
      case 'ARC':
        res.arcs.push({ c: { x: v(10) * k, y: v(20) * k }, r: v(40) * k, a0: v(50), a1: v(51) });
        break;
      case 'LWPOLYLINE': {
        const verts: { x: number; y: number; bulge: number }[] = [];
        for (const [code, val] of g) {
          if (code === 10) verts.push({ x: Number(val) * k, y: 0, bulge: 0 });
          else if (code === 20 && verts.length) verts[verts.length - 1].y = Number(val) * k;
          else if (code === 42 && verts.length) verts[verts.length - 1].bulge = Number(val);
        }
        if (verts.length >= 2) res.shapes.push(polylineContour(verts, (v(70) & 1) === 1));
        break;
      }
      case 'POLYLINE': {
        const closed = (v(70) & 1) === 1;
        const verts: { x: number; y: number; bulge: number }[] = [];
        while (i < ps.length && ps[i][1] === 'VERTEX') {
          i++;
          const vg: [number, string][] = [];
          while (i < ps.length && ps[i][0] !== 0) vg.push(ps[i++]);
          const vv = (code: number) => Number(vg.find((x) => x[0] === code)?.[1] ?? 0);
          verts.push({ x: vv(10) * k, y: vv(20) * k, bulge: vv(42) });
        }
        if (ps[i]?.[1] === 'SEQEND') {
          i++;
          while (i < ps.length && ps[i][0] !== 0) i++;
        }
        if (verts.length >= 2) res.shapes.push(polylineContour(verts, closed));
        break;
      }
      case 'ELLIPSE': {
        const c = { x: v(10) * k, y: v(20) * k };
        const maj = { x: v(11) * k, y: v(21) * k };
        const ratio = v(40) || 1;
        let t0 = v(41);
        let t1 = g.some((x) => x[0] === 42) ? v(42) : Math.PI * 2;
        if (t1 <= t0) t1 += Math.PI * 2;
        const a = Math.hypot(maj.x, maj.y);
        const rot = Math.atan2(maj.y, maj.x);
        const full = Math.abs(t1 - t0 - Math.PI * 2) < 1e-6;
        const n = 64;
        const nodes: ShapeNode[] = [];
        for (let s = 0; s <= (full ? n - 1 : n); s++) {
          const t = t0 + ((t1 - t0) * s) / n;
          const x = a * Math.cos(t);
          const y = a * ratio * Math.sin(t);
          nodes.push({ x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) });
        }
        res.shapes.push({ closed: full, nodes });
        break;
      }
      case 'SPLINE': {
        const fit: Vec2[] = [];
        const ctrl: Vec2[] = [];
        for (let j = 0; j < g.length; j++) {
          if (g[j][0] === 11) fit.push({ x: Number(g[j][1]) * k, y: 0 });
          if (g[j][0] === 21 && fit.length) fit[fit.length - 1].y = Number(g[j][1]) * k;
          if (g[j][0] === 10) ctrl.push({ x: Number(g[j][1]) * k, y: 0 });
          if (g[j][0] === 20 && ctrl.length) ctrl[ctrl.length - 1].y = Number(g[j][1]) * k;
        }
        const pts = fit.length >= 2 ? fit : ctrl;
        if (pts.length >= 2) {
          res.shapes.push({ closed: (v(70) & 1) === 1, nodes: pts.map((p) => ({ x: p.x, y: p.y })) });
          if (!fit.length) warnings.add('Splines ohne Stützpunkte wurden über ihre Kontrollpunkte angenähert.');
        }
        break;
      }
      case 'TEXT':
      case 'MTEXT':
        warnings.add('Texte aus der DXF wurden übersprungen.');
        break;
      case 'INSERT':
        warnings.add('Blockreferenzen (INSERT) werden nicht aufgelöst – Blöcke vorher auflösen.');
        break;
      case 'HATCH':
      case 'DIMENSION':
      case 'POINT':
      case 'VIEWPORT':
        break;
      default:
        warnings.add(`DXF-Objekt ${type} wird nicht unterstützt.`);
    }
  }
  res.warnings = [...warnings];
  return res;
}
