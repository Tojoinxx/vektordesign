import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { docBBox } from '../../src/model/bounds';
import { layersOf } from '../../src/model/layers';
import { exportSvg } from '../../src/export/svg';
import type { ImageEntity } from '../../src/model/types';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('Bilder als Vorlage zum Nachzeichnen', () => {
  it('legt das Bild auf eine eigene Ebene „Vorlage“ ganz unten, halbtransparent, nicht im Export', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 20, y: 10 } }, 'corner');
    const out = ed.insertImage({ src: PNG, pxWidth: 400, pxHeight: 200, name: 'logo.png' }, { center: { x: 50, y: 50 }, widthMm: 100 });
    expect(out.ok).toBe(true);
    const doc = ed.s.doc;
    const img = doc.entities[out.imageId!] as ImageEntity;
    const layers = layersOf(doc);
    expect(layers[0].name).toBe('Vorlage');
    expect(img.layer).toBe(layers[0].id);
    expect(doc.entities[r.pathId!].layer).toBe(layers[1].id); // vorhandene Objekte bleiben auf ihrer Ebene
    expect(img.reference).toBe(true);
    expect(img.style.opacity).toBe(0.5);
    expect(img.height).toBeCloseTo(50, 9);
    // Export-Rahmen ohne Vorlage, Ansicht „Alles“ mit Vorlage
    const exp = docBBox(doc)!;
    expect(exp.maxX - exp.minX).toBeCloseTo(20, 9);
    const all = docBBox(doc, { construction: true })!;
    expect(all.maxX).toBeCloseTo(100, 9);
    expect(exportSvg(doc).svg).not.toContain('<image');
  });

  it('Größe proportional, Maßstab über Strecke (Skalieren um Punkt), als Motivbild exportierbar', async () => {
    const ed = await makeEditor();
    const out = ed.insertImage({ src: PNG, pxWidth: 300, pxHeight: 100 }, { center: { x: 0, y: 0 }, widthMm: 60 });
    const id = out.imageId!;
    expect(ed.updateImage(id, { width: 90 }).ok).toBe(true);
    let img = ed.s.doc.entities[id] as ImageEntity;
    expect(img.height).toBeCloseTo(30, 9);
    // Strecke, die 45 mm misst, ist in Wirklichkeit 90 mm → Faktor 2 um (−45, 0)
    await ed.transform({ kind: 'scale', k: 2, cx: -45, cy: 0 }, { ids: [id] });
    img = ed.s.doc.entities[id] as ImageEntity;
    expect(img.width).toBeCloseTo(180, 9);
    expect(ed.s.doc.points[img.anchor].x).toBeCloseTo(45, 6);
    ed.updateImage(id, { reference: false });
    const svg = exportSvg(ed.s.doc).svg;
    expect(svg).toContain('<image');
    expect(svg).toMatch(/width="180mm"/);
  });
});
