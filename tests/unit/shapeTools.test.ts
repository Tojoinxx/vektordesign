import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import type { ShapeEntity } from '../../src/model/types';
import { areaOf, entityArea } from '../../src/model/boolean';
import { outlineStrokeOp } from '../../src/store/ops';

const shapes = (ed: Awaited<ReturnType<typeof makeEditor>>) => Object.values(ed.s.doc.entities).filter((e): e is ShapeEntity => e.kind === 'shape');

describe('Kontur in Fläche (für Plotter)', () => {
  it('Rechteck mit Füllung und 2-mm-Kontur: Füllung bleibt, Kontur wird ein Ring in Konturfarbe', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'corner');
    ed.setStyle([r.pathId!], { fill: '#ffcc00', stroke: '#112233', strokeWidth: 2 });
    const out = await outlineStrokeOp(ed, [r.pathId!]);
    expect(out.ok).toBe(true);
    const path = ed.s.doc.entities[r.pathId!];
    expect(path.style.stroke).toBeNull();
    expect(path.style.fill).toBe('#ffcc00');
    const ring = shapes(ed)[0];
    expect(ring.style.fill).toBe('#112233');
    expect(ring.style.stroke).toBeNull();
    // Ring: 42 × 22 − 38 × 18 (Gehrungsecken)
    expect(areaOf(entityArea(ed.s.doc, ring)!)).toBeCloseTo(42 * 22 - 38 * 18, 1);
    // liegt direkt über der Füllung
    expect(ed.s.doc.order.indexOf(ring.id)).toBe(ed.s.doc.order.indexOf(r.pathId!) + 1);
    ed.undo();
    expect(shapes(ed)).toHaveLength(0);
    expect(ed.s.doc.entities[r.pathId!].style.stroke).toBe('#112233');
  });

  it('Linie mit runden Enden wird zur Fläche (Länge + Kappen), gestrichelt in einzelne Striche', async () => {
    const ed = await makeEditor();
    const l = ed.createLine({ pos: { x: 0, y: 0 } }, { pos: { x: 50, y: 0 } });
    const id = l.line!.id;
    ed.setStyle([id], { stroke: '#000000', strokeWidth: 4, lineCap: 'round' });
    await outlineStrokeOp(ed, [id]);
    const s = shapes(ed)[0];
    expect(ed.s.doc.entities[id]).toBeUndefined();
    expect(areaOf(entityArea(ed.s.doc, s)!)).toBeCloseTo(50 * 4 + Math.PI * 4, 0);

    const d = ed.createLine({ pos: { x: 0, y: 30 } }, { pos: { x: 60, y: 30 } });
    ed.setStyle([d.line!.id], { stroke: '#000000', strokeWidth: 1, dash: 'dashed' });
    await outlineStrokeOp(ed, [d.line!.id]);
    const dashed = shapes(ed).find((x) => x.id !== s.id)!;
    // Muster 4 mm Strich / 2 mm Lücke → 10 Striche auf 60 mm
    expect(dashed.contours.length).toBe(10);
    expect(areaOf(entityArea(ed.s.doc, dashed)!)).toBeCloseTo(40, 0);
  });

  it('Ohne Kontur: verständliche Meldung', async () => {
    const ed = await makeEditor();
    const c = ed.createCircle({ pos: { x: 0, y: 0 } }, 5);
    ed.setStyle([c.circleId!], { fill: '#ff0000', stroke: null });
    const out = await outlineStrokeOp(ed, [c.circleId!]);
    expect(out.ok).toBe(false);
  });
});

describe('Formgenerator', () => {
  it('Zwei überlappende Kreise ergeben drei Teilflächen', async () => {
    const { builderSources } = await import('../../src/store/ops');
    const ed = await makeEditor();
    const a = ed.createCircle({ pos: { x: 0, y: 0 } }, 10);
    const b = ed.createCircle({ pos: { x: 12, y: 0 } }, 10);
    const src = builderSources(ed.s.doc, [a.circleId!, b.circleId!]);
    expect(src.ids).toHaveLength(2);
    expect(src.regions).toHaveLength(3);
    expect(src.regions.filter((r) => r.owners.length === 2)).toHaveLength(1);
    const total = src.regions.reduce((s, r) => s + r.area, 0);
    expect(total).toBeCloseTo(areaOf(entityArea(ed.s.doc, ed.s.doc.entities[a.circleId!])!) * 2 - src.regions.find((r) => r.owners.length === 2)!.area, 0);
  });

  it('Linke Sichel + Mitte vereinigen: neue Form, rechter Kreis verliert die Mitte; Alt entfernt; ein Rückgängig-Schritt', async () => {
    const { builderSources, shapeBuildOp } = await import('../../src/store/ops');
    const { regionAt } = await import('../../src/model/shapeBuilder');
    const ed = await makeEditor();
    const a = ed.createCircle({ pos: { x: 0, y: 0 } }, 10);
    const b = ed.createCircle({ pos: { x: 12, y: 0 } }, 10);
    ed.setStyle([a.circleId!], { fill: '#ff0000' });
    ed.setStyle([b.circleId!], { fill: '#0000ff' });
    const src = builderSources(ed.s.doc, [a.circleId!, b.circleId!]);
    const left = regionAt(src.regions, { x: -5, y: 0 });
    const mid = regionAt(src.regions, { x: 6, y: 0 });
    const right = regionAt(src.regions, { x: 17, y: 0 });
    expect(new Set([left, mid, right]).size).toBe(3);
    const lens = src.regions[mid].area;
    const out = shapeBuildOp(ed, src, [left, mid], 'merge');
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    const all = shapes(ed);
    // linker Kreis ganz aufgegangen → entfällt; rechter Kreis ohne Linse; neue Form = linker Kreis
    expect(ed.s.doc.entities[a.circleId!]).toBeUndefined();
    const merged = all.find((s) => s.name === 'Formgenerator')!;
    expect(merged.style.fill).toBe('#ff0000');
    const fullArea = Math.PI * 100;
    expect(areaOf(entityArea(ed.s.doc, merged)!)).toBeCloseTo(fullArea, 0);
    const restB = all.find((s) => s.style.fill === '#0000ff')!;
    expect(areaOf(entityArea(ed.s.doc, restB)!)).toBeCloseTo(fullArea - lens, 0);
    // Reihenfolge: vereinigte Fläche vorne
    expect(ed.s.doc.order.indexOf(merged.id)).toBeGreaterThan(ed.s.doc.order.indexOf(restB.id));
    ed.undo();
    expect(ed.s.doc.entities[a.circleId!]).toBeDefined();
    expect(shapes(ed)).toHaveLength(0);

    // Alt: Linse entfernen → zwei Sicheln
    const src2 = builderSources(ed.s.doc, [a.circleId!, b.circleId!]);
    shapeBuildOp(ed, src2, [regionAt(src2.regions, { x: 6, y: 0 })], 'delete');
    const s2 = shapes(ed);
    expect(s2).toHaveLength(2);
    for (const s of s2) expect(areaOf(entityArea(ed.s.doc, s)!)).toBeCloseTo(fullArea - lens, 0);
  });

  it('Ring: Loch wird als eigene Teilfläche erkannt (Kreis im Rechteck)', async () => {
    const { builderSources } = await import('../../src/store/ops');
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 40 } }, 'corner');
    const c = ed.createCircle({ pos: { x: 20, y: 20 } }, 8);
    const src = builderSources(ed.s.doc, [r.pathId!, c.circleId!]);
    expect(src.regions).toHaveLength(2);
    const outer = src.regions.find((x) => x.owners.length === 1)!;
    expect(outer.polys).toHaveLength(2); // Außenkante + Loch
    expect(outer.area).toBeCloseTo(1600 - Math.PI * 64, 0);
  });
});
