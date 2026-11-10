import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'opentype.js';
import { makeEditor } from './helpers';
import type { ShapeEntity } from '../../src/model/types';
import { pathWalker, sweepArea, warpPoint } from '../../src/model/textEffects';
import { areaOf, entityArea } from '../../src/model/boolean';
import { entityBBox } from '../../src/model/bounds';
import { longShadowOp, textOnPathOp, textToPaths, warpOp } from '../../src/store/ops';

vi.mock('../../src/platform/fontOutline', async (orig) => {
  const mod = await orig<typeof import('../../src/platform/fontOutline')>();
  const file = resolve(import.meta.dirname, '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff');
  const buf = readFileSync(file);
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { ...mod, loadFont: async () => ({ font, substitute: false }) };
});

const box = { minX: 0, minY: 0, maxX: 100, maxY: 20 };

describe('Verformen', () => {
  it('Bogen hebt die Mitte an und lässt die Ränder', () => {
    const mid = warpPoint({ x: 50, y: 0 }, box, 'arch', 0.5);
    const edge = warpPoint({ x: 0, y: 0 }, box, 'arch', 0.5);
    expect(mid.y).toBeCloseTo(6);
    expect(edge.y).toBeCloseTo(0);
  });
  it('Kreisbogen erhält die Länge der Grundlinie', () => {
    const pts = Array.from({ length: 101 }, (_, i) => warpPoint({ x: i, y: 0 }, box, 'arc', 0.5));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    expect(len).toBeCloseTo(100, 0);
    // Mitte oben, Enden tiefer
    expect(pts[50].y).toBeGreaterThan(pts[0].y + 5);
  });
  it('Stärke 0 verändert nichts', () => {
    for (const m of ['arc', 'arch', 'bulge', 'wave', 'perspective', 'rise'] as const) {
      const p = warpPoint({ x: 30, y: 12 }, box, m, 0);
      expect(p.x).toBeCloseTo(30);
      expect(p.y).toBeCloseTo(12);
    }
  });
  it('verformt einen Text zu einer Form gleicher Breite', async () => {
    const ed = await makeEditor();
    const ref = ed.createText({ pos: { x: 0, y: 50 } }, 'HELLO');
    const flat = await textToPaths(ed, [ref.textId!]);
    const before = entityBBox(ed.s.doc, ed.s.doc.entities[flat.ids![0]]);
    const t = ed.createText({ pos: { x: 0, y: 0 } }, 'HELLO');
    const out = await warpOp(ed, 'arch', 0.4, [t.textId!]);
    expect(out.ok).toBe(true);
    const s = ed.s.doc.entities[out.ids![0]] as ShapeEntity;
    expect(s.kind).toBe('shape');
    const after = entityBBox(ed.s.doc, s);
    expect(after.maxX - after.minX).toBeCloseTo(before.maxX - before.minX, 1);
    expect(after.maxY - after.minY).toBeGreaterThan(before.maxY - before.minY);
  });
});

describe('Text auf Pfad', () => {
  it('läuft eine Linie von links nach rechts ab, auch wenn sie andersherum gezeichnet ist', () => {
    const w = pathWalker(
      [
        { x: 100, y: 0 },
        { x: 0, y: 0 },
      ],
      false,
    );
    expect(w.length).toBeCloseTo(100);
    expect(w.at(10).p.x).toBeCloseTo(10);
    expect(w.at(10).t.x).toBeCloseTo(1);
  });
  it('legt Text mittig auf einen Bogen', async () => {
    const ed = await makeEditor();
    const t = ed.createText({ pos: { x: 0, y: 0 } }, 'TEXT');
    const c = ed.createCircle({ pos: { x: 0, y: -100 } }, 60);
    const out = await textOnPathOp(ed, 'center', 2, [t.textId!, c.circleId!]);
    expect(out.ok).toBe(true);
    const b = entityBBox(ed.s.doc, ed.s.doc.entities[out.ids![0]]);
    // oben auf dem Kreis, mittig über dem Mittelpunkt
    expect((b.minX + b.maxX) / 2).toBeCloseTo(0, 0);
    expect(b.minY).toBeGreaterThan(-100 + 60);
  });
});

describe('Langer Schatten', () => {
  it('überstreicht ein Quadrat exakt', () => {
    const sq = [
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    ];
    // 10×10 um (5, −5) geschoben: 100 + 2 Parallelogramme à 50 = 200
    expect(areaOf(sweepArea(sq, 5, -5))).toBeCloseTo(200, 3);
  });
  it('legt die Schattenfläche hinter das Rechteck', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 20, y: 10 } }, 'corner');
    ed.setStyle([r.pathId!], { fill: '#ff0000' });
    const out = await longShadowOp(ed, -45, 5, '#550000', [r.pathId!]);
    expect(out.ok).toBe(true);
    const doc = ed.s.doc;
    expect(doc.order.indexOf(out.ids![0])).toBeLessThan(doc.order.indexOf(r.pathId!));
    const area = areaOf(entityArea(doc, doc.entities[out.ids![0]])!);
    expect(area).toBeGreaterThan(200);
    expect(doc.entities[out.ids![0]].style.fill).toBe('#550000');
  });
});
