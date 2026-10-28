import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { ORIGIN_ID } from '../../src/model/types';
import { docBBox, bboxOf } from '../../src/model/bounds';
import { lineOf, pt } from '../../src/model/doc';
import { exportSvg } from '../../src/export/svg';

const origin = { pos: { x: 0, y: 0 }, snap: { kind: 'point' as const, id: ORIGIN_ID } };
const len = (ed: Awaited<ReturnType<typeof makeEditor>>, id: string) => {
  const l = lineOf(ed.s.doc, id)!;
  const a = pt(ed.s.doc, l.p1);
  const b = pt(ed.s.doc, l.p2);
  return Math.hypot(b.x - a.x, b.y - a.y);
};

describe('Vieleck, Stern, Ellipse, Pfad', () => {
  it('Sechseck Ø50 (Umkreis): gleich lange Kanten, Bemaßung ändert die Größe', async () => {
    const ed = await makeEditor();
    const out = ed.createPolygon(origin, { x: 20, y: 3 }, 6, 'circumscribed', { diameter: '50' });
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    expect(out.lineIds!.length).toBe(6);
    for (const id of out.lineIds!) expect(len(ed, id)).toBeCloseTo(25, 6);
    // eine Kante waagrecht → vollständig bestimmt
    expect(ed.addConstraint('horizontal', [out.lineIds![0]]).ok).toBe(true);
    expect(ed.s.analysis.status).toBe('full');
    const b = bboxOf(ed.s.doc, out.pathId!)!;
    expect(b.maxX - b.minX).toBeCloseTo(50, 6);
  });

  it('Achteck mit Inkreis: Schlüsselweite = Kreisdurchmesser', async () => {
    const ed = await makeEditor();
    const out = ed.createPolygon(origin, { x: 0, y: 15 }, 8, 'inscribed', { diameter: '30' });
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    expect(ed.addConstraint('horizontal', [out.lineIds![0]]).ok).toBe(true);
    const b = bboxOf(ed.s.doc, out.pathId!)!;
    expect(b.maxY - b.minY).toBeCloseTo(30, 5);
  });

  it('Stern mit 5 Zacken, Ø außen 60 / innen 24', async () => {
    const ed = await makeEditor();
    const out = ed.createStar(origin, { x: 0, y: 28 }, 5, 0.5, { diameter: '60', innerDiameter: '24' });
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    const outer = ed.s.doc.entities[out.outerId!];
    const inner = ed.s.doc.entities[out.innerId!];
    expect(outer.kind === 'circle' && outer.r).toBeCloseTo(30, 6);
    expect(inner.kind === 'circle' && inner.r).toBeCloseTo(12, 6);
    const b = bboxOf(ed.s.doc, out.pathId!)!;
    expect(Math.max(b.maxY, -b.minY, b.maxX, -b.minX)).toBeCloseTo(30, 1);
  });

  it('Ellipse 80 × 30 als Form mit Breite/Höhe, exakt im SVG', async () => {
    const ed = await makeEditor();
    const out = ed.createEllipse(origin, 40, 15, { width: '80', height: '30' });
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    const b = docBBox(ed.s.doc)!;
    expect(b.maxX - b.minX).toBeCloseTo(80, 6);
    expect(b.maxY - b.minY).toBeCloseTo(30, 6);
    expect(exportSvg(ed.s.doc).svg).toContain('width="80mm"');
  });

  it('Bézierpfad offen (nur Kontur) und geschlossen (gefüllt)', async () => {
    const ed = await makeEditor();
    const open = ed.createBezier(
      [
        { x: 0, y: 0, ox: 10, oy: 10 },
        { x: 30, y: 0, ix: 20, iy: 10 },
      ],
      false,
    );
    expect(open.ok).toBe(true);
    const s = ed.s.doc.entities[open.shapeId!];
    expect(s.style.fill).toBeNull();
    const closed = ed.createBezier(
      [
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 20, y: 0 },
      ],
      true,
    );
    expect(ed.s.doc.entities[closed.shapeId!].kind).toBe('shape');
  });
});
