import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { makeEditor } from './helpers';
import { productionOf } from '../../src/model/production';
import { gradedMotifDoc, gradedSize, presetSizes } from '../../src/model/sizes';
import { docBBox } from '../../src/model/bounds';
import { buildPackage } from '../../src/export/package';
import { BUILTIN_PROFILES } from '../../src/model/profiles';

describe('Größenstaffel', () => {
  it('skaliert um die obere Mitte und exportiert je Größe eigene Dateien', async () => {
    const ed = await makeEditor();
    ed.createRectangle({ pos: { x: -50, y: -40 } }, { pos: { x: 50, y: 0 } }, 'corner', { width: '100', height: '40', style: { fill: '#c8102e', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    ed.updateProduction('Staffel', (p) => {
      p.article = 'Teamshirt';
      p.sizes = presetSizes('s-xl');
    });
    const p = productionOf(ed.s.doc);
    expect(p.sizes!.map((g) => g.name)).toEqual(['S', 'M', 'L', 'XL']);
    expect(gradedSize(ed.s.doc, p.motifs[0], p.sizes![3])!.w).toBeCloseTo(115, 6);
    const xl = docBBox(gradedMotifDoc(ed.s.doc, p.motifs[0], 115))!;
    expect(xl.maxX - xl.minX).toBeCloseTo(115, 6);
    expect(xl.maxY).toBeCloseTo(0, 6); // Oberkante bleibt
    expect((xl.minX + xl.maxX) / 2).toBeCloseTo(0, 6);
    const profile = { ...BUILTIN_PROFILES[0], formats: ['svg' as const], sheet: false, project: false };
    const r = await buildPackage(ed.s.doc, p, profile);
    const files = unzipSync(r.zip);
    const svgs = Object.keys(files)
      .filter((n) => n.endsWith('.svg'))
      .sort();
    expect(svgs.length).toBe(4);
    const width = (n: string) => strFromU8(files[n]).match(/width="([\d.]+)mm"/)![1];
    expect(width(svgs.find((n) => n.includes('_Gr-S.'))!)).toBe('92');
    expect(width(svgs.find((n) => n.includes('_Gr-XL.'))!)).toBe('115');
    const readme = strFromU8(files[Object.keys(files).find((n) => n.endsWith('LIESMICH.txt'))!]);
    expect(readme).toContain('XL 115 × 46 mm (115 %)');
  });
});
