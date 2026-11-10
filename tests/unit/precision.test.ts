import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { smartSnap } from '../../src/tools/smartGuides';
import { docBBox } from '../../src/model/bounds';
import { computeSnap } from '../../src/tools/snap';
import { DEFAULT_SETTINGS } from '../../src/store/state';
import { serializeDoc, parseDoc } from '../../src/model/serialize';

const box = (minX: number, minY: number, w: number, h: number) => ({ minX, minY, maxX: minX + w, maxY: minY + h });

describe('Smarte Hilfslinien', () => {
  it('rastet die linke Kante an der eines Nachbarn ein und zeigt eine Linie', () => {
    const g = smartSnap(box(10.4, 40, 20, 10), [box(10, 0, 30, 20)], 1);
    expect(g.dx).toBeCloseTo(-0.4);
    expect(g.lines.length).toBeGreaterThan(0);
  });
  it('rastet die Mitte am Ursprung ein', () => {
    const g = smartSnap(box(-10.5, -5.3, 20, 10), [box(0, 0, 0, 0)], 1);
    expect(g.dx).toBeCloseTo(0.5);
    expect(g.dy).toBeCloseTo(0.3);
  });
  it('erkennt gleichen Abstand zwischen zwei Nachbarn', () => {
    // A 0–10, B 40–50, bewegte Box 10 breit → mittig bei 20–30 (je 10 mm Abstand)
    const g = smartSnap(box(20.7, 0, 10, 10), [box(0, 0, 10, 10), box(40, 0, 10, 10)], 1);
    expect(g.dx).toBeCloseTo(-0.7);
    expect(g.lines.filter((l) => l.gap !== undefined).map((l) => Math.round(l.gap!))).toEqual([10, 10]);
  });
  it('lässt weit entfernte Objekte in Ruhe', () => {
    const g = smartSnap(box(100, 100, 5, 5), [box(0, 0, 10, 10)], 1);
    expect(g.dx).toBe(0);
    expect(g.dy).toBe(0);
    expect(g.lines).toEqual([]);
  });
});

describe('Pfeiltasten, gleiche Auswahl, Auswahl zoomen', () => {
  it('verschiebt ein bemaßtes Rechteck in einem Rückgängig-Schritt', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 20, y: 10 } }, 'corner', { width: '20', height: '10' });
    ed.select([r.pathId!]);
    const before = ed.s.past.length;
    expect(ed.nudge(1, 0).ok).toBe(true);
    expect(ed.nudge(1, 0).ok).toBe(true);
    expect(ed.nudge(0, 0.1).ok).toBe(true);
    const b = docBBox(ed.s.doc)!;
    expect(b.minX).toBeCloseTo(2);
    expect(b.minY).toBeCloseTo(0.1);
    expect(b.maxX - b.minX).toBeCloseTo(20);
    expect(ed.s.past.length).toBe(before + 1);
  });
  it('wählt alle Objekte mit gleicher Füllung', async () => {
    const ed = await makeEditor();
    const a = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 10, y: 10 } }, 'corner');
    const b = ed.createRectangle({ pos: { x: 20, y: 0 } }, { pos: { x: 30, y: 10 } }, 'corner');
    const c = ed.createRectangle({ pos: { x: 40, y: 0 } }, { pos: { x: 50, y: 10 } }, 'corner');
    ed.setStyle([a.pathId!, c.pathId!], { fill: '#ff0000' });
    ed.setStyle([b.pathId!], { fill: '#00ff00' });
    ed.select([a.pathId!]);
    expect(ed.selectSame('fill')).toBe(2);
    expect(new Set(ed.s.selection)).toEqual(new Set([a.pathId, c.pathId]));
  });
  it('zoomt auf die Auswahl', async () => {
    const ed = await makeEditor();
    ed.viewport = { width: 1000, height: 800 };
    ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 500, y: 500 } }, 'corner');
    const small = ed.createCircle({ pos: { x: 100, y: 100 } }, 5);
    ed.select([small.circleId!]);
    ed.zoomToSelection(100);
    expect(ed.s.view.cx).toBeCloseTo(100);
    expect(ed.s.view.zoom).toBeGreaterThan(40);
  });
});

describe('Hilfslinien aus dem Lineal', () => {
  it('fängt an Hilfslinien und ihren Kreuzungen und bleibt beim Speichern erhalten', async () => {
    const ed = await makeEditor();
    const gx = ed.setGuide(null, 'x', 25);
    ed.setGuide(null, 'y', 40);
    const vp = { cx: 0, cy: 0, zoom: 4, width: 800, height: 600 };
    // Bildschirmpunkt nahe (25, 40): x = 400 + 25·4, y = 300 − 40·4
    const s = computeSnap(ed.s.doc, vp, DEFAULT_SETTINGS, { x: 501, y: 141 });
    expect(s.pos.x).toBeCloseTo(25);
    expect(s.pos.y).toBeCloseTo(40);
    const near = computeSnap(ed.s.doc, vp, DEFAULT_SETTINGS, { x: 502, y: 400 });
    expect(near.kind).toBe('guide');
    expect(near.pos.x).toBeCloseTo(25);
    const back = parseDoc(serializeDoc(ed.s.doc));
    expect(back.guides?.length).toBe(2);
    ed.removeGuides(gx);
    expect(ed.s.doc.guides?.length).toBe(1);
    ed.undo();
    expect(ed.s.doc.guides?.length).toBe(2);
  });
});
