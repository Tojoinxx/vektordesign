import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { withWeeding, WEED_LAYER } from '../../src/model/weeding';
import { docBBox } from '../../src/model/bounds';
import { exportSvg } from '../../src/export/svg';

describe('Entgitterung', () => {
  it('Rahmen mit Abstand und Linie durch den freien Streifen', async () => {
    const ed = await makeEditor();
    const st = { fill: '#000000', stroke: null, strokeWidth: 0.5, opacity: 1 };
    ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 20, y: 10 } }, 'corner', { style: st });
    ed.createRectangle({ pos: { x: 30, y: 0 } }, { pos: { x: 50, y: 10 } }, 'corner', { style: st });
    const d = withWeeding(ed.s.doc, { margin: 3, lines: true });
    const b = docBBox(d)!;
    expect(b.maxX - b.minX).toBeCloseTo(56, 6);
    expect(b.maxY - b.minY).toBeCloseTo(16, 6);
    const weed = Object.values(d.entities).filter((e) => e.layer === WEED_LAYER);
    expect(weed.length).toBe(2); // Rahmen + eine senkrechte Linie bei x = 25
    const svg = exportSvg(d).svg;
    expect(svg).toContain('Entgitterung');
    expect(svg).toContain('width="56mm"');
  });
});
