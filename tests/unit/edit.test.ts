import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'opentype.js';
import { makeEditor } from './helpers';
import { ORIGIN_ID, type ShapeEntity } from '../../src/model/types';
import { entityArea, areaOf } from '../../src/model/boolean';
import { shapeSize } from '../../src/model/shape';
import { docBBox } from '../../src/model/bounds';
import { booleanOp, patternOp, textToPaths, offsetOp, cornerOp } from '../../src/store/ops';
import { exportSvg } from '../../src/export/svg';

// Schrift aus der eingebauten IBM Plex Sans (in Node gibt es keine Systemschriften)
vi.mock('../../src/platform/fontOutline', async (orig) => {
  const mod = await orig<typeof import('../../src/platform/fontOutline')>();
  const file = resolve(import.meta.dirname, '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff');
  const buf = readFileSync(file);
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { ...mod, loadFont: async () => ({ font, substitute: false }) };
});

const shapes = (ed: Awaited<ReturnType<typeof makeEditor>>) => Object.values(ed.s.doc.entities).filter((e): e is ShapeEntity => e.kind === 'shape');

describe('Bearbeiten (Meilenstein 2)', () => {
  it('vereinigt zwei überlappende Quadrate zu einer Form', async () => {
    const ed = await makeEditor();
    const a = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 20, y: 20 } }, 'corner', { width: '20', height: '20' });
    const b = ed.createRectangle({ pos: { x: 10, y: 0 } }, { pos: { x: 30, y: 20 } }, 'corner', { width: '20', height: '20' });
    const out = await booleanOp(ed, 'union', [a.pathId!, b.pathId!]);
    expect(out.ok).toBe(true);
    const s = shapes(ed);
    expect(s).toHaveLength(1);
    expect(areaOf(entityArea(ed.s.doc, s[0])!)).toBeCloseTo(600, 3);
    expect(ed.s.doc.entities[a.pathId!]).toBeUndefined();
    // ein Rückgängig-Schritt
    ed.undo();
    expect(shapes(ed)).toHaveLength(0);
    expect(ed.s.doc.entities[a.pathId!]).toBeDefined();
  });

  it('subtrahiert einen Kreis aus einem Rechteck (Loch bleibt beim Export erhalten)', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'corner');
    ed.setStyle([r.pathId!], { fill: '#d62828' });
    const c = ed.createCircle({ pos: { x: 20, y: 10 } }, 5);
    await booleanOp(ed, 'subtract', [r.pathId!, c.circleId!]);
    const s = shapes(ed)[0];
    expect(areaOf(entityArea(ed.s.doc, s)!)).toBeCloseTo(800 - Math.PI * 25, 1);
    const svg = exportSvg(ed.s.doc).svg;
    expect(svg).toContain('fill-rule="evenodd"');
    expect((svg.match(/M/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('Logo: Text in Pfade, mit Kreis vereinigt, auf 100 mm Breite bemaßt', async () => {
    const ed = await makeEditor();
    const t = ed.createText({ pos: { x: 0, y: 0 } }, 'TEAM', { fontFamily: 'IBM Plex Sans', fontSize: 20, fontWeight: 700 });
    const conv = await textToPaths(ed, [t.textId!]);
    expect(conv.ok).toBe(true);
    const textShape = shapes(ed)[0];
    expect(textShape.contours.length).toBeGreaterThanOrEqual(5); // T, E, A (mit Loch), M
    const c = ed.createCircle({ pos: { x: 25, y: 7 } }, 14);
    ed.setStyle([c.circleId!], { fill: '#f5c518', stroke: null });
    const u = await booleanOp(ed, 'union', [textShape.id, c.circleId!]);
    expect(u.ok).toBe(true);
    const logo = shapes(ed)[0];
    const dim = ed.addDimension({ kind: 'width', refs: [logo.id] }, { expr: '100' });
    expect(dim.ok).toBe(true);
    const sized = ed.s.doc.entities[logo.id] as ShapeEntity;
    expect(shapeSize(sized).w).toBeCloseTo(100, 6);
    const svg = exportSvg(ed.s.doc);
    expect(svg.widthMm).toBeCloseTo(100, 3);
    // Ausdruck ändern: Form folgt
    const d = Object.values(ed.s.doc.dims).find((x) => x.kind === 'width')!;
    expect(ed.setDimensionExpr(d.id, '60+20').ok).toBe(true);
    expect(exportSvg(ed.s.doc).widthMm).toBeCloseTo(80, 3);
  });

  it('dreht, skaliert und spiegelt bemaßte Geometrie', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'corner', { width: '40', height: '20' });
    ed.select([r.pathId!]);
    expect(ed.transform({ kind: 'rotate', angle: 90, cx: 0, cy: 0 }).ok).toBe(true);
    let b = docBBox(ed.s.doc)!;
    expect(b.maxX - b.minX).toBeCloseTo(20, 6);
    expect(b.maxY - b.minY).toBeCloseTo(40, 6);
    expect(ed.transform({ kind: 'scale', k: 2, cx: 0, cy: 0 }).ok).toBe(true);
    b = docBBox(ed.s.doc)!;
    expect(b.maxX - b.minX).toBeCloseTo(40, 6);
    expect(Object.values(ed.s.doc.dims).map((x) => x.value).sort((p, q) => p - q)).toEqual([40, 80]);
    const before = docBBox(ed.s.doc)!;
    expect(ed.transform({ kind: 'mirror', axis: 'y', cx: 0, cy: 0 }, { copy: true }).ok).toBe(true);
    const after = docBBox(ed.s.doc)!;
    expect(after.maxX).toBeCloseTo(-before.minX, 6);
    expect(Object.values(ed.s.doc.entities).filter((e) => e.kind === 'path')).toHaveLength(2);
  });

  it('erzeugt rechteckige und kreisförmige Muster', async () => {
    const ed = await makeEditor();
    const c = ed.createCircle({ pos: { x: 10, y: 0 } }, 2);
    expect(patternOp(ed, { kind: 'rect', nx: 3, ny: 2, dx: 10, dy: 10 }, [c.circleId!]).ok).toBe(true);
    expect(Object.values(ed.s.doc.entities).filter((e) => e.kind === 'circle')).toHaveLength(6);
    ed.undo();
    expect(patternOp(ed, { kind: 'circ', n: 6, angle: 360, cx: 0, cy: 0 }, [c.circleId!]).ok).toBe(true);
    const centers = Object.values(ed.s.doc.entities)
      .filter((e) => e.kind === 'circle')
      .map((e) => (e.kind === 'circle' ? ed.s.doc.points[e.center] : null)!);
    expect(centers).toHaveLength(6);
    for (const p of centers) expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 6);
  });

  it('Versatz und Abrunden erzeugen saubere Flächen', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'corner');
    const off = await offsetOp(ed, 2, 'round', [r.pathId!]);
    expect(off.ok).toBe(true);
    const o = shapes(ed)[0];
    // 44 × 24 mit Viertelkreisen in den Ecken
    expect(areaOf(entityArea(ed.s.doc, o)!)).toBeCloseTo(40 * 20 + 2 * 2 * (40 + 20) + Math.PI * 4, 0);
    const f = await cornerOp(ed, 5, 'fillet', [r.pathId!]);
    expect(f.ok).toBe(true);
    const rounded = shapes(ed).find((s) => s.id !== o.id)!;
    expect(areaOf(entityArea(ed.s.doc, rounded)!)).toBeCloseTo(800 - (4 - Math.PI) * 25, 0);
  });

  it('Ebenen: Ausgeblendetes wird nicht exportiert, Gruppen werden zusammen ausgewählt', async () => {
    const ed = await makeEditor();
    const a = ed.createCircle({ pos: { x: 0, y: 0 } }, 5);
    const layer = ed.addLayer('Hintergrund');
    const b = ed.createCircle({ pos: { x: 50, y: 0 } }, 5);
    expect(ed.s.doc.entities[b.circleId!].layer).toBe(layer);
    expect(exportSvg(ed.s.doc).widthMm).toBeCloseTo(60, 6);
    ed.updateLayer(layer, { visible: false });
    expect(exportSvg(ed.s.doc).widthMm).toBeCloseTo(10, 6);
    ed.updateLayer(layer, { visible: true });
    expect(ed.group([a.circleId!, b.circleId!]).ok).toBe(true);
    ed.select([a.circleId!]);
    expect(ed.s.selection.sort()).toEqual([a.circleId!, b.circleId!].sort());
    expect(ed.s.doc.points[ORIGIN_ID]).toBeDefined();
  });
});
