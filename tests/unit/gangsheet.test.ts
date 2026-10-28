import { describe, expect, test } from 'vitest';
import { createDoc } from '../../src/model/doc';
import { DEFAULT_GANG, layoutGang, parseNames, type GangPiece } from '../../src/model/gangsheet';

const piece = (key: string, w: number, h: number, hasImage = false): GangPiece => ({ key, label: key, doc: createDoc(), box: { minX: 0, minY: 0, maxX: w, maxY: h }, w, h, hasImage });

describe('Sammelbogen', () => {
  test('Namensliste lesen', () => {
    const r = parseNames('Name;Nummer;Größe;Anzahl\nMüller;10;L;2\nschmidt;7\n\t\n;23');
    expect(r).toEqual([
      { name: 'MÜLLER', number: '10', size: 'L', count: 2 },
      { name: 'SCHMIDT', number: '7', size: '', count: 1 },
      { name: '', number: '23', size: '', count: 1 },
    ]);
  });

  test('Stücke überlappen nicht und bleiben in der Rollenbreite', () => {
    const spec = { ...DEFAULT_GANG, width: 300, gap: 5, margin: 5 };
    const pcs = [...Array(12)].map((_, i) => piece(`p${i}`, 40 + (i % 4) * 25, 30 + (i % 3) * 40));
    const L = layoutGang(pcs, spec);
    expect(L.placed.length).toBe(12);
    const rects = L.placed.map((p) => ({ x: p.x, y: p.y, w: p.rotated ? p.piece.h : p.piece.w, h: p.rotated ? p.piece.w : p.piece.h }));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(295 + 1e-9);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const sep = a.x + a.w + 5 <= b.x + 1e-9 || b.x + b.w + 5 <= a.x + 1e-9 || a.y + a.h + 5 <= b.y + 1e-9 || b.y + b.h + 5 <= a.y + 1e-9;
        expect(sep).toBe(true);
      }
    expect(L.usage).toBeGreaterThan(0.4);
  });

  test('Drehen nutzt die Breite, Bilder werden nie gedreht', () => {
    const spec = { ...DEFAULT_GANG, width: 110, gap: 0, margin: 5 };
    const L = layoutGang([piece('a', 150, 50)], spec);
    expect(L.placed[0].rotated).toBe(true);
    const L2 = layoutGang([piece('b', 150, 50, true)], spec);
    expect(L2.tooWide.length).toBe(1);
  });

  test('Neuer Bogen bei Höchstlänge', () => {
    const spec = { ...DEFAULT_GANG, width: 110, gap: 0, margin: 5, maxLength: 210, rotate: false };
    const L = layoutGang([piece('a', 100, 100), piece('b', 100, 100), piece('c', 100, 100)], spec);
    expect(L.sheets.length).toBe(2);
    expect(L.placed.filter((p) => p.sheet === 1).length).toBe(1);
  });
});

import { addCircle, createDoc as cd } from '../../src/model/doc';
import { addShapeFromWorld, shapeWorldContours } from '../../src/model/shape';
import { buildSheetDocs, withoutCutLayer, CUT_LAYER } from '../../src/export/gangSheetExport';
import { docBBox } from '../../src/model/bounds';
import { exportSvg } from '../../src/export/svg';

describe('Sammelbogen-Export', () => {
  test('gedrehtes Stück landet seitenrichtig im Bogen, Schnittlinien eigene Ebene', async () => {
    const d = cd('Motiv');
    addShapeFromWorld(
      d,
      [
        {
          closed: true,
          nodes: [
            { x: 0, y: 0 },
            { x: 150, y: 0 },
            { x: 150, y: 50 },
            { x: 0, y: 50 },
          ],
        },
      ],
      { fill: '#ff0000', stroke: null, strokeWidth: 0, opacity: 1 },
    );
    addCircle(d, { x: 10, y: 40 }, 5, { fill: '#000000', stroke: null, strokeWidth: 0, opacity: 1 });
    const box = docBBox(d)!;
    const pc = { key: 'a', label: 'A', doc: d, box, w: 150, h: 50, hasImage: false };
    const spec = { ...DEFAULT_GANG, width: 110, gap: 4, margin: 5 };
    const L = layoutGang([pc], spec);
    expect(L.placed[0].rotated).toBe(true);
    const [sheet] = await buildSheetDocs(L, spec, { cutLines: true });
    const shapes = Object.values(sheet.doc.entities).filter((e) => e.kind === 'shape' && e.layer !== CUT_LAYER);
    expect(shapes.length).toBe(2);
    const b = docBBox(withoutCutLayer(sheet.doc))!;
    expect(b.maxX - b.minX).toBeCloseTo(50, 6);
    expect(b.maxY - b.minY).toBeCloseTo(150, 6);
    expect(b.minX).toBeCloseTo(5, 6);
    expect(b.maxY).toBeCloseTo(-5, 6);
    // Kreis (oben links im Motiv) liegt nach Drehung im Uhrzeigersinn oben rechts
    const circle = shapes.find((s) => s.kind === 'shape' && s.style.fill === '#000000')!;
    const cb = shapeWorldContours(sheet.doc, circle as never)[0].nodes;
    const cx = cb.reduce((s, n) => s + n.x, 0) / cb.length;
    const cy = cb.reduce((s, n) => s + n.y, 0) / cb.length;
    expect(cx).toBeCloseTo(5 + 50 - 10, 1);
    expect(cy).toBeCloseTo(-(5 + 10), 1);
    const svg = exportSvg(sheet.doc, { frame: sheet.frame });
    expect(svg.svg).toContain('width="110mm"');
    expect(svg.svg).toContain('Schnittlinien');
  });
});
