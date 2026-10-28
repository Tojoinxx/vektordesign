import { describe, expect, it } from 'vitest';
import { halftone, applyGrunge, rapportTile, colorWeight, gradientT, DEFAULT_HALFTONE } from '../../src/model/textile';
import { areaOf } from '../../src/model/boolean';
import { fadeGradient, twoColorGradient } from '../../src/model/paint';

const square = (x: number, y: number, w: number, h: number) => [
  [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
];

describe('Textile Effekte', () => {
  it('Halbton: Deckung entspricht der Flächenbelegung', () => {
    const a = square(0, 0, 40, 40);
    for (const cov of [0.2, 0.5]) {
      const dots = halftone(a, () => cov, DEFAULT_HALFTONE);
      expect(areaOf(dots) / 1600).toBeCloseTo(cov, 1);
    }
    expect(areaOf(halftone(a, () => 1, DEFAULT_HALFTONE))).toBeCloseTo(1600, 0);
    expect(halftone(a, () => 0, DEFAULT_HALFTONE).length).toBe(0);
  });

  it('Verlauf: Gewichte je Farbe und Verblassen', () => {
    const fade = fadeGradient('#000000');
    expect(colorWeight(fade, '#000000', 0)).toBe(1);
    expect(colorWeight(fade, '#000000', 0.5)).toBeCloseTo(0.5, 9);
    const two = twoColorGradient('#ff0000', '#0000ff');
    expect(colorWeight(two, '#ff0000', 0.25) + colorWeight(two, '#0000ff', 0.25)).toBeCloseTo(1, 9);
    expect(gradientT(two, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 3 })).toBeCloseTo(0.5, 9);
  });

  it('Used-Look entfernt einen Teil der Fläche, gleiche Zufallszahl = gleiches Ergebnis', () => {
    const a = square(0, 0, 60, 30);
    const g1 = applyGrunge(a, { amount: 0.3, grain: 1.5, seed: 3, scratches: true });
    const g2 = applyGrunge(a, { amount: 0.3, grain: 1.5, seed: 3, scratches: true });
    const left = areaOf(g1) / 1800;
    expect(left).toBeLessThan(0.95);
    expect(left).toBeGreaterThan(0.5);
    expect(areaOf(g2)).toBeCloseTo(areaOf(g1), 6);
  });

  it('Rapport: über den Rand ragende Teile erscheinen gegenüber', () => {
    // Kreis-ähnliches Quadrat über der rechten Kante
    const piece = square(45, 10, 10, 10);
    const tile = rapportTile(piece, { x: 0, y: 0, w: 50, h: 50 }, 'straight');
    expect(areaOf(tile)).toBeCloseTo(100, 6);
    const xs = tile.flat().map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 6);
    expect(Math.max(...xs)).toBeCloseTo(50, 6);
    const hd = rapportTile(piece, { x: 0, y: 0, w: 50, h: 50 }, 'halfdrop');
    expect(areaOf(hd)).toBeCloseTo(100, 6);
    // halber Versatz: das rechts herausragende Stück erscheint links 25 mm höher
    const left = hd.filter((p) => Math.max(...p.map((q) => q.x)) < 10).flat();
    expect(Math.min(...left.map((q) => q.y))).toBeCloseTo(35, 6);
  });
});

import { makeEditor } from './helpers';
import { grungeOp, halftoneOp, rapportOp } from '../../src/store/ops';
import { entityArea } from '../../src/model/boolean';
import { docBBox } from '../../src/model/bounds';

describe('Textil-Befehle', () => {
  it('Halbton aus Verblassen-Verlauf: Punkte in voller Farbe, etwa halbe Fläche', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 60, y: 30 } }, 'corner', { style: { fill: fadeGradient('#1f3a93'), stroke: null, strokeWidth: 0.5, opacity: 1 } });
    const out = await halftoneOp(ed, DEFAULT_HALFTONE, [r.pathId!]);
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    const s = ed.s.doc.entities[out.ids![0]];
    expect(s.kind).toBe('shape');
    expect(s.style.fill).toBe('#1f3a93');
    const a = areaOf(entityArea(ed.s.doc, s)!);
    expect(a / 1800).toBeGreaterThan(0.4);
    expect(a / 1800).toBeLessThan(0.6);
    // Undo stellt den Verlauf wieder her
    ed.undo();
    expect(ed.s.doc.entities[r.pathId!]).toBeTruthy();
  });

  it('Used-Look und Rapport als Befehle', async () => {
    const ed = await makeEditor();
    const st = { fill: '#c8102e', stroke: null, strokeWidth: 0.5, opacity: 1 };
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'corner', { style: st });
    const g = await grungeOp(ed, { amount: 0.3, grain: 1, seed: 5, scratches: false }, [r.pathId!]);
    expect(g.ok).toBe(true);
    const c = ed.createCircle({ pos: { x: 48, y: 10 } }, 6, { style: st });
    const rp = await rapportOp(ed, { x: 0, y: 0, w: 50, h: 50 }, 'straight', [c.circleId!]);
    expect(rp.ok, rp.ok ? '' : rp.message).toBe(true);
    const tileShape = ed.s.doc.entities[rp.ids![0]];
    const area = areaOf(entityArea(ed.s.doc, tileShape)!);
    expect(area).toBeCloseTo(Math.PI * 36, 0);
    const frame = Object.values(ed.s.doc.entities).find((e) => e.kind === 'shape' && e.name === 'Rapport-Kachel')!;
    const b = docBBox(ed.s.doc, { only: new Set([frame.id]) })!;
    expect(b.maxX - b.minX).toBeCloseTo(50, 6);
  });
});
