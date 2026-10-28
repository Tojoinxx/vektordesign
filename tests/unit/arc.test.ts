import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { ORIGIN_ID } from '../../src/model/types';
import { arcGeom, arcOf, circleThrough3, pathContour } from '../../src/model/arc';
import { docBBox } from '../../src/model/bounds';
import { exportSvg } from '../../src/export/svg';
import { exportDxf } from '../../src/export/dxf';
import { buildScene } from '../../src/export/scene';
import { lineOf, pt } from '../../src/model/doc';

describe('Bogen', () => {
  it('3-Punkt-Geometrie und Richtung', () => {
    const c = circleThrough3({ x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 })!;
    expect(c.c.x).toBeCloseTo(0, 9);
    expect(c.c.y).toBeCloseTo(0, 9);
    expect(c.r).toBeCloseTo(10, 9);
    expect(c.ccw).toBe(true);
    expect(circleThrough3({ x: 10, y: 0 }, { x: 0, y: -10 }, { x: -10, y: 0 })!.ccw).toBe(false);
  });

  it('3-Punkt-Bogen: Radius bemaßen, Mittelpunkt auf Ursprung → vollständig bestimmt', async () => {
    const ed = await makeEditor();
    const a = ed.createArc3({ pos: { x: 12, y: 1 } }, { pos: { x: -11, y: 2 } }, { x: 0.5, y: 12 });
    expect(a.ok).toBe(true);
    let arc = arcOf(ed.s.doc, a.arcId!)!;
    expect(ed.s.analysis.dof).toBe(5);
    expect(ed.addConstraint('coincident', [arc.center, ORIGIN_ID]).ok).toBe(true);
    const d = ed.addDimension({ kind: 'radius', refs: [arc.id] }, { expr: '20' });
    expect(d.ok).toBe(true);
    arc = arcOf(ed.s.doc, a.arcId!)!;
    const g = arcGeom(ed.s.doc, arc);
    expect(g.r).toBeCloseTo(20, 6);
    expect(g.c.x).toBeCloseTo(0, 6);
    // Start und Ende waagrecht festlegen → nur noch bestimmt
    expect(ed.addConstraint('horizontal', [arc.p1, arc.center]).ok).toBe(true);
    expect(ed.addConstraint('horizontal', [arc.p2, arc.center]).ok).toBe(true);
    expect(ed.s.analysis.status).toBe('full');
    const g2 = arcGeom(ed.s.doc, arcOf(ed.s.doc, a.arcId!)!);
    expect(g2.sweep).toBeCloseTo(Math.PI, 6);
    expect(g2.p1.x).toBeCloseTo(20, 6);
  });

  it('Langloch aus zwei Linien und zwei Bögen: tangential, bemaßt, gefüllt, exakt exportiert', async () => {
    const ed = await makeEditor();
    // grob gezeichnet
    const l1 = ed.createLine({ pos: { x: 0, y: -9 } }, { pos: { x: 31, y: -10 } }).line!;
    const l2 = ed.createLine({ pos: { x: 32, y: 11 } }, { pos: { x: 1, y: 9 } }).line!;
    const right = ed.createArc({ pos: { x: 31, y: 0 } }, { pos: pt(ed.s.doc, l1.p2), snap: { kind: 'point', id: l1.p2 } }, { pos: pt(ed.s.doc, l2.p1), snap: { kind: 'point', id: l2.p1 } }, true);
    expect(right.ok).toBe(true);
    const left = ed.createArc({ pos: { x: 0, y: 0 } }, { pos: pt(ed.s.doc, l2.p2), snap: { kind: 'point', id: l2.p2 } }, { pos: pt(ed.s.doc, l1.p1), snap: { kind: 'point', id: l1.p1 } }, true);
    expect(left.ok).toBe(true);
    for (const [l, a] of [
      [l1.id, right.arcId!],
      [l1.id, left.arcId!],
      [l2.id, right.arcId!],
      [l2.id, left.arcId!],
    ]) {
      const out = ed.addConstraint('tangent', [l, a]);
      expect(out.ok, out.ok ? '' : out.message).toBe(true);
    }
    const la = arcOf(ed.s.doc, left.arcId!)!;
    const ra = arcOf(ed.s.doc, right.arcId!)!;
    expect(ed.addConstraint('coincident', [la.center, ORIGIN_ID]).ok).toBe(true);
    expect(ed.addConstraint('horizontal', [la.center, ra.center]).ok).toBe(true);
    expect(ed.addConstraint('equal', [la.id, ra.id]).ok).toBe(true);
    expect(ed.addDimension({ kind: 'radius', refs: [la.id] }, { expr: '10' }).ok).toBe(true);
    const dd = ed.addDimension({ kind: 'distance', refs: [la.center, ra.center] }, { expr: '40' });
    expect(dd.ok, dd.ok ? '' : dd.message).toBe(true);
    expect(ed.s.analysis.status).toBe('full');
    const p = ed.createProfile([l1.id, right.arcId!, l2.id, left.arcId!], { fill: '#26292d', stroke: null, strokeWidth: 0.5, opacity: 1 });
    expect(p.ok, p.ok ? '' : p.message).toBe(true);
    const doc = ed.s.doc;
    const box = docBBox(doc)!;
    expect(box.maxX - box.minX).toBeCloseTo(60, 6);
    expect(box.maxY - box.minY).toBeCloseTo(20, 6);
    const path = doc.entities[p.pathId!];
    expect(path.kind).toBe('path');
    const contour = pathContour(doc, path as never);
    expect(contour.nodes.some((n) => n.ox !== undefined)).toBe(true);
    const svg = exportSvg(doc).svg;
    expect(svg).toContain('width="60mm"');
    expect(svg).toContain('height="20mm"');
    expect(svg).toMatch(/ C/);
    const dxf = new TextDecoder().decode(exportDxf(buildScene(doc)));
    // gefüllte Fläche → Kontur als Polylinie; Linien und Bögen einzeln erscheinen nicht doppelt
    expect(dxf).toContain('POLYLINE');
    // Lage stimmt
    const a = lineOf(doc, l1.id)!;
    expect(Math.abs(pt(doc, a.p1).y)).toBeCloseTo(10, 6);
  });

  it('Verschieben, Spiegeln und Kopieren behalten den Bogen', async () => {
    const ed = await makeEditor();
    const a = ed.createArc({ pos: { x: 0, y: 0 } }, { pos: { x: 10, y: 0 } }, { pos: { x: 0, y: 10 } }, true);
    const before = arcGeom(ed.s.doc, arcOf(ed.s.doc, a.arcId!)!);
    expect(before.sweep).toBeCloseTo(Math.PI / 2, 9);
    ed.transform({ kind: 'mirror', axis: 'y', cx: 0, cy: 0 }, { ids: [a.arcId!] });
    const g = arcGeom(ed.s.doc, arcOf(ed.s.doc, a.arcId!)!);
    expect(g.sweep).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.min(g.p1.x, g.p2.x)).toBeCloseTo(-10, 9);
    const dup = ed.duplicate([a.arcId!]);
    expect(dup.ok).toBe(true);
    expect(arcOf(ed.s.doc, dup.ids![0])).toBeTruthy();
  });
});
