import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { docColors, harmony, libraryFromJson, libraryToJson, makeElement, mergeLibrary, newPalette, emptyLibrary } from '../../src/model/library';
import { docBBox } from '../../src/model/bounds';
import { luminance } from '../../src/model/color';

describe('Bibliothek', () => {
  it('Element: Mitte auf Ursprung, einfügen an anderer Stelle, Bemaßung kommt mit', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 100, y: 50 } }, { pos: { x: 140, y: 70 } }, 'corner', {
      width: '40',
      height: '20',
      style: { fill: '#c8102e', stroke: null, strokeWidth: 0.5, opacity: 1 },
    });
    const el = makeElement(ed.s.doc, [r.pathId!], 'Logo')!;
    expect(el.w).toBeCloseTo(40, 6);
    const b = docBBox(el.doc)!;
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 6);
    expect(Object.keys(el.doc.dims).length).toBe(2);
    const ed2 = await makeEditor();
    const out = ed2.insertDoc(el.doc, 'Einfügen', { x: -10, y: 5 });
    expect(out.ok).toBe(true);
    const b2 = docBBox(ed2.s.doc)!;
    expect((b2.minX + b2.maxX) / 2).toBeCloseTo(-10, 6);
    expect(Object.keys(ed2.s.doc.dims).length).toBe(2);
  });

  it('Farben, Harmonien, Datei und Zusammenführen', async () => {
    const ed = await makeEditor();
    ed.createCircle({ pos: { x: 0, y: 0 } }, 5, { style: { fill: '#1F3A93', stroke: '#ffffff', strokeWidth: 1, opacity: 1 } });
    expect(docColors(ed.s.doc)).toEqual(['#1f3a93', '#ffffff']);
    const comp = harmony('#1f3a93', 'complementary');
    expect(comp[0]).toBe('#1f3a93');
    expect(comp.length).toBe(4);
    const mono = harmony('#1f3a93', 'mono');
    expect(luminance(mono[0])).toBeLessThan(luminance(mono[4]));
    const lib = { ...emptyLibrary(), palettes: [newPalette('A', ['#FF0000', '#ff0000', '#00ff00'])] };
    expect(lib.palettes[0].colors).toEqual(['#ff0000', '#00ff00']);
    const back = libraryFromJson(libraryToJson(lib));
    expect(back.palettes[0].name).toBe('A');
    expect(mergeLibrary(lib, back).palettes.length).toBe(1);
    expect(() => libraryFromJson('{"x":1}')).toThrow();
  });
});

import { reduceColorMap } from '../../src/model/library';
import { reduceColorsOp, shadowOp } from '../../src/store/ops';
import { perColorFiles } from '../../src/ui/controller';

describe('Farbreduktion, Schatten, je Farbe exportieren', () => {
  it('fasst ähnliche Farben zusammen (häufigste gewinnt)', () => {
    const map = reduceColorMap(
      [
        { color: '#c8102e', weight: 100 },
        { color: '#d01530', weight: 10 },
        { color: '#1f3a93', weight: 50 },
        { color: '#203b95', weight: 5 },
      ],
      2,
    );
    expect(map.get('#d01530')).toBe('#c8102e');
    expect(map.get('#203b95')).toBe('#1f3a93');
  });

  it('Befehle: Farben reduzieren, Schatten hinter dem Original', async () => {
    const ed = await makeEditor();
    const a = ed.createCircle({ pos: { x: 0, y: 0 } }, 5, { style: { fill: '#c8102e', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    ed.createCircle({ pos: { x: 20, y: 0 } }, 5, { style: { fill: '#d01530', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    ed.createCircle({ pos: { x: 40, y: 0 } }, 5, { style: { fill: '#1f3a93', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    const r = reduceColorsOp(ed, 2);
    expect(r.ok).toBe(true);
    expect(docColors(ed.s.doc).length).toBe(2);
    const s = shadowOp(ed, 1, -1, '#000000', [a.circleId!]);
    expect(s.ok).toBe(true);
    const order = ed.s.doc.order;
    expect(order.indexOf(s.ids![0])).toBeLessThan(order.indexOf(a.circleId!));
    expect(ed.s.doc.entities[s.ids![0]].style.fill).toBe('#000000');
  });

  it('je Farbe eine Datei: gleiche Größe', async () => {
    const ed = await makeEditor();
    ed.createCircle({ pos: { x: 0, y: 0 } }, 5, { style: { fill: '#c8102e', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    ed.createCircle({ pos: { x: 30, y: 0 } }, 5, { style: { fill: '#1f3a93', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    const files = perColorFiles(ed.s.doc, { format: 'svg', dpi: 300, bounds: 'geometry', mirror: false, weeding: { margin: 3, lines: false } }, undefined, 'Test');
    expect(files.length).toBe(2);
    const w = files.map((f) => new TextDecoder().decode(f.data).match(/width="([\d.]+)mm"/)![1]);
    expect(w).toEqual(['46', '46']);
  });
});
