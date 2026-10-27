import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { ORIGIN_ID } from '../../src/model/types';
import { lineOf, pt } from '../../src/model/doc';

/**
 * Abnahmekriterium Meilenstein 1 (auf Ebene der Editor-Befehle, also genau die Befehle,
 * die auch Maus-Werkzeuge und der Claude-Assistent verwenden).
 */
describe('Abnahme M1: Rechteck 80 × 40, Kreis Ø10 konzentrisch, vollständig bestimmt', () => {
  it('Variante A: Mittelpunkt-Rechteck am Ursprung mit direkter Werteingabe', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: ORIGIN_ID } }, { pos: { x: 31, y: 17 } }, 'center', {
      width: '80',
      height: '40',
    });
    expect(r.ok).toBe(true);
    expect(ed.s.analysis.status).toBe('full');

    const c = ed.createCircle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: r.centerId! } }, 6, { diameter: '10' });
    expect(c.ok).toBe(true);
    expect(ed.s.analysis.status).toBe('full');
    expect(ed.s.analysis.label).toBe('Vollständig bestimmt');

    const doc = ed.s.doc;
    const xs = r.lineIds!.flatMap((id) => {
      const l = lineOf(doc, id)!;
      return [pt(doc, l.p1).x, pt(doc, l.p2).x];
    });
    const ys = r.lineIds!.flatMap((id) => {
      const l = lineOf(doc, id)!;
      return [pt(doc, l.p1).y, pt(doc, l.p2).y];
    });
    expect(Math.min(...xs)).toBe(-40);
    expect(Math.max(...xs)).toBe(40);
    expect(Math.min(...ys)).toBe(-20);
    expect(Math.max(...ys)).toBe(20);
    const circle = doc.entities[c.circleId!];
    expect(circle.kind === 'circle' && circle.r).toBe(5);
  });

  it('Variante B: grob zeichnen, dann bemaßen und Abhängigkeiten setzen (wie in Inventor)', async () => {
    const ed = await makeEditor();
    // Grob irgendwo zeichnen
    const r = ed.createRectangle({ pos: { x: 12.3, y: 7.1 } }, { pos: { x: 71.9, y: 44.4 } }, 'corner');
    expect(r.ok).toBe(true);
    expect(ed.s.analysis.status).toBe('under');
    expect(ed.s.analysis.dof).toBe(4);
    expect(ed.s.analysis.label).toBe('Unterbestimmt – noch 4 Bemaßungen nötig');

    const [bottom, right] = r.lineIds!;
    const doc0 = ed.s.doc;
    const b = lineOf(doc0, bottom)!;
    const rl = lineOf(doc0, right)!;
    const w = ed.addDimension({ kind: 'distanceX', refs: [b.p1, b.p2] }, { expr: '80' });
    expect(w.ok).toBe(true);
    const h = ed.addDimension({ kind: 'distanceY', refs: [rl.p1, rl.p2] }, { expr: 'd0/2' });
    expect(h.ok).toBe(true);
    expect(ed.s.analysis.dof).toBe(2);

    // Position: Rechteckmitte auf den Ursprung
    const k = ed.addConstraint('coincident', [r.centerId!, ORIGIN_ID]);
    expect(k.ok).toBe(true);
    expect(ed.s.analysis.status).toBe('full');

    // Kreis grob in die Nähe, dann konzentrisch zur Mitte und Ø10
    const c = ed.createCircle({ pos: { x: 3, y: 2 } }, 7);
    expect(ed.s.analysis.dof).toBe(3);
    const k2 = ed.addConstraint('concentric', [c.circleId!, r.centerId!]);
    expect(k2.ok).toBe(true);
    const dd = ed.addDimension({ kind: 'diameter', refs: [c.circleId!] }, { expr: '10' });
    expect(dd.ok).toBe(true);
    expect(ed.s.analysis.status).toBe('full');

    const doc = ed.s.doc;
    const circle = doc.entities[c.circleId!];
    expect(circle.kind).toBe('circle');
    if (circle.kind === 'circle') {
      expect(circle.r).toBe(5);
      expect(pt(doc, circle.center)).toMatchObject({ x: 0, y: 0 });
    }
    expect(pt(doc, lineOf(doc, bottom)!.p1)).toMatchObject({ x: -40, y: -20 });

    // Bemaßung ändern: Ausdruck wirkt sofort, auch auf abhängige Bemaßung d1 = d0/2
    const ch = ed.setDimensionExpr(w.dimId!, '100');
    expect(ch.ok).toBe(true);
    const d2 = ed.s.doc;
    expect(pt(d2, lineOf(d2, bottom)!.p2).x).toBe(50);
    expect(pt(d2, lineOf(d2, right)!.p2).y).toBe(25);
  });

  it('meldet Überbestimmung verständlich und bietet getriebene Bemaßung an', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 50, y: 30 } }, 'corner', { width: '50', height: '30' });
    const [bottom, , top] = r.lineIds!;
    const doc = ed.s.doc;
    const t = lineOf(doc, top)!;
    // Oben ist durch horizontal + gleiche Breite schon bestimmt → Konflikt
    const over = ed.addDimension({ kind: 'distance', refs: [t.p1, t.p2] }, { expr: '60' });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.message).toMatch(/überbestimmen/);
    const driven = ed.addDimension({ kind: 'distance', refs: [t.p1, t.p2] }, { driven: true });
    expect(driven.ok).toBe(true);
    const dd = ed.s.doc.dims[driven.dimId!];
    expect(dd.driven).toBe(true);
    expect(dd.value).toBeCloseTo(50, 9);
    // Redundante Abhängigkeit wird abgelehnt
    const par = ed.addConstraint('parallel', [bottom, top]);
    expect(par.ok).toBe(false);
    expect(ed.s.analysis.status).not.toBe('over');
  });

  it('Rückgängig und Wiederholen', async () => {
    const ed = await makeEditor();
    ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 50, y: 30 } }, 'corner');
    const afterRect = ed.s.doc;
    ed.createCircle({ pos: { x: 10, y: 10 } }, 3);
    expect(Object.keys(ed.s.doc.entities).length).toBe(Object.keys(afterRect.entities).length + 1);
    ed.undo();
    expect(ed.s.doc).toBe(afterRect);
    ed.redo();
    expect(Object.keys(ed.s.doc.entities).length).toBe(Object.keys(afterRect.entities).length + 1);
  });

  it('Transaktion fasst mehrere Schritte zu einem Rückgängig-Schritt zusammen', async () => {
    const ed = await makeEditor();
    const before = ed.s.past.length;
    ed.transaction('Claude: 2 Änderungen', () => {
      ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 50, y: 30 } }, 'corner');
      ed.createCircle({ pos: { x: 10, y: 10 } }, 3);
    });
    expect(ed.s.past.length).toBe(before + 1);
    expect(ed.s.past[ed.s.past.length - 1].label).toBe('Claude: 2 Änderungen');
    ed.undo();
    expect(Object.keys(ed.s.doc.entities).length).toBe(0);
  });

  it('Ziehen bewegt nur, was noch frei ist', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: ORIGIN_ID } }, { pos: { x: 20, y: 10 } }, 'center', { width: '40' });
    const doc = ed.s.doc;
    const top = lineOf(doc, r.lineIds![2])!;
    const before = pt(doc, top.p1);
    ed.beginDrag();
    ed.dragTo({ kind: 'points', targets: [{ id: top.p1, x: before.x + 30, y: before.y + 5 }] });
    ed.endDrag();
    const after = pt(ed.s.doc, lineOf(ed.s.doc, r.lineIds![2])!.p1);
    expect(after.x).toBeCloseTo(before.x, 9); // Breite ist bemaßt
    expect(after.y).toBeGreaterThan(before.y); // Höhe ist frei
    ed.undo();
    expect(pt(ed.s.doc, top.p1).y).toBeCloseTo(before.y, 9);
  });
});
