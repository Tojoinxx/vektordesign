import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { docBBox } from '../../src/model/bounds';

describe('Symmetrie-Modus', () => {
  it('4-fach: Rechteck erscheint in allen Quadranten, ein Rückgängig-Schritt', async () => {
    const ed = await makeEditor();
    ed.store.setState({ symmetry: 'vh' });
    ed.createRectangle({ pos: { x: 10, y: 5 } }, { pos: { x: 30, y: 15 } }, 'corner');
    const copies = ed.mirrorLastCreated();
    expect(copies.length).toBe(3);
    const paths = Object.values(ed.s.doc.entities).filter((e) => e.kind === 'path');
    expect(paths.length).toBe(4);
    const b = docBBox(ed.s.doc)!;
    expect(b.minX).toBeCloseTo(-30, 6);
    expect(b.maxY).toBeCloseTo(15, 6);
    expect(b.minY).toBeCloseTo(-15, 6);
    ed.undo();
    expect(Object.values(ed.s.doc.entities).filter((e) => e.kind === 'path').length).toBe(0);
  });

  it('aus: nichts passiert', async () => {
    const ed = await makeEditor();
    ed.createCircle({ pos: { x: 10, y: 0 } }, 3);
    expect(ed.mirrorLastCreated()).toEqual([]);
  });
});
