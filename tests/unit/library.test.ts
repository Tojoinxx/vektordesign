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
