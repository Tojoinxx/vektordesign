import { describe, expect, it } from 'vitest';
import { strFromU8 } from 'fflate';
import { makeEditor } from './helpers';
import { BLOCK_KINDS, defaultBlock, generateBlock } from '../../src/pattern/blocks';
import { bodyForSize, checkBody, SIZE_TABLE } from '../../src/pattern/body';
import { checkSeams, fabricArea, freeEdges, nearestEdge, pieceGeom } from '../../src/pattern/geometry';
import { patternExchange } from '../../src/pattern/exchange';
import { addSeam, generatePattern, makePieces, removePiece, updateMaterial, updatePiece, updateSeam } from '../../src/store/patternOps';
import { exportPatternDxf } from '../../src/export/patternDxf';
import { buildScene } from '../../src/export/scene';
import { parseDoc, serializeDoc } from '../../src/model/serialize';
import { layersOf } from '../../src/model/layers';
import { flattenContour, polyArea } from '../../src/model/shape';

describe('Körpermaße', () => {
  it('Maßtabelle ist plausibel', () => {
    for (const r of SIZE_TABLE) expect(checkBody(r.body), r.id).toEqual([]);
    expect(checkBody({ ...bodyForSize('H-M'), chest: 0 })[0]).toMatch(/Brustumfang/);
  });
});

describe('Grundschnitt-Generator', () => {
  for (const kind of BLOCK_KINDS.map((k) => k.id)) {
    for (const fit of ['slim', 'regular', 'oversize'] as const) {
      it(`${kind} ${fit}: Teile laufen gegen den Uhrzeigersinn, Nähte sind gleich lang`, async () => {
        const ed = await makeEditor();
        const body = bodyForSize('H-L');
        const blk = defaultBlock(kind, body, fit, 'H-L');
        const res = generateBlock(body, blk);
        for (const p of res.pieces) expect(polyArea(flattenContour(p.contour, 0.5)), p.key).toBeGreaterThan(0);
        expect(generatePattern(ed, body, 'H-L', blk).ok).toBe(true);
        const checks = checkSeams(ed.s.doc);
        expect(checks.length).toBe(res.seams.length);
        for (const c of checks) {
          if (c.ribbed) expect(c.stretch, c.seam.name).toBeLessThanOrEqual(35);
          else expect(Math.abs(c.diff), c.seam.name).toBeLessThan(0.5);
          expect(c.ok, `${c.seam.name}: ${c.message}`).toBe(true);
        }
      });
    }
  }

  it('Brustweite folgt den Maßen: Vorder- + Rückenteil = Brustumfang + Zugabe', async () => {
    const ed = await makeEditor();
    const body = bodyForSize('H-M');
    generatePattern(ed, body, 'H-M', defaultBlock('tshirt', body, 'regular'));
    const front = ed.s.doc.pattern!.pieces.find((p) => p.role === 'front')!;
    const back = ed.s.doc.pattern!.pieces.find((p) => p.role === 'back')!;
    const wf = pieceGeom(ed.s.doc, front)!;
    const wb = pieceGeom(ed.s.doc, back)!;
    // Breite auf Achselhöhe = Kante 1 Ende → Kante 8 Anfang
    const width = (g: typeof wf) => g.edges[2].pts[0].x - g.edges[8].pts[0].x;
    expect(width(wf) + width(wb)).toBeCloseTo(1000 + 140, 0);
  });

  it('Aktualisieren ersetzt die Grundschnitt-Teile an derselben Stelle, eigene Teile bleiben', async () => {
    const ed = await makeEditor();
    const body = bodyForSize('H-M');
    generatePattern(ed, body, 'H-M', defaultBlock('hoodie', body));
    const pocket = ed.createRectangle({ pos: { x: 3000, y: 0 } }, { pos: { x: 3200, y: -150 } }, 'corner');
    expect(makePieces(ed, [pocket.pathId!], 'pocket').ok).toBe(true);
    const before = ed.s.doc.pattern!.pieces.length;
    const frontBox = pieceGeom(
      ed.s.doc,
      ed.s.doc.pattern!.pieces.find((p) => p.role === 'front')!,
    )!.box;
    const big = bodyForSize('H-XL');
    expect(generatePattern(ed, big, 'H-XL', defaultBlock('hoodie', big)).ok).toBe(true);
    const pat = ed.s.doc.pattern!;
    expect(pat.pieces.length).toBe(before);
    expect(pat.pieces.some((p) => p.role === 'pocket' && !p.block)).toBe(true);
    expect(pat.bodySize).toBe('H-XL');
    const frontBox2 = pieceGeom(
      ed.s.doc,
      pat.pieces.find((p) => p.role === 'front')!,
    )!.box;
    expect(frontBox2.minX).toBeCloseTo(frontBox.minX, 3);
    expect(frontBox2.maxY).toBeCloseTo(frontBox.maxY, 3);
    // Rückgängig stellt die Größe M wieder her
    ed.undo();
    expect(ed.s.doc.pattern!.bodySize).toBe('H-M');
  });
});

describe('Schnittteile und Nähte von Hand', () => {
  it('Rechtecke werden Schnittteile, Kanten lassen sich vernähen und prüfen', async () => {
    const ed = await makeEditor();
    const a = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 200, y: 300 } }, 'corner');
    const b = ed.createRectangle({ pos: { x: 300, y: 0 } }, { pos: { x: 500, y: 290 } }, 'corner');
    const made = makePieces(ed, [a.pathId!, b.pathId!], 'front');
    expect(made.ok).toBe(true);
    const [pa, pb] = made.pieceIds!;
    // Pattern-Ebene liegt ganz unten und ist markiert
    expect(layersOf(ed.s.doc)[0].pattern).toBe(true);
    const ga = pieceGeom(ed.s.doc, ed.s.doc.pattern!.pieces[0])!;
    expect(ga.edges.length).toBe(4);
    // Kante per Klick finden
    const hit = nearestEdge(ed.s.doc, { x: 200.5, y: 150 }, 3)!;
    expect(hit.piece).toBe(pa);
    const right = hit.edge;
    const left = nearestEdge(ed.s.doc, { x: 299, y: 150 }, 3)!;
    expect(left.piece).toBe(pb);
    expect(addSeam(ed, { piece: pa, edge: right }, { piece: pb, edge: left.edge }).ok).toBe(true);
    // Kante doppelt vernähen geht nicht
    expect(addSeam(ed, { piece: pa, edge: right }, { piece: pb, edge: 0 }).ok).toBe(false);
    const c = checkSeams(ed.s.doc)[0];
    expect(c.ok).toBe(false);
    expect(c.message).toMatch(/10 mm/);
    expect(freeEdges(ed.s.doc, ed.s.doc.pattern!.pieces[0]).length).toBe(3);
    // Richtung umkehren, Teil entfernen räumt Nähte auf
    expect(updateSeam(ed, c.seam.id, { reversed: false }).ok).toBe(true);
    expect(ed.s.doc.pattern!.seams[0].reversed).toBe(false);
    expect(removePiece(ed, pb).ok).toBe(true);
    expect(ed.s.doc.pattern!.seams.length).toBe(0);
    // Löschen der Kontur entfernt das Schnittteil
    ed.deleteIds([a.pathId!]);
    expect(ed.s.doc.pattern!.pieces.length).toBe(0);
  });

  it('Nahtzugabe, Stoffmenge, Material färbt die Teile', async () => {
    const ed = await makeEditor();
    const a = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 100, y: 100 } }, 'corner');
    const id = makePieces(ed, [a.pathId!]).pieceIds![0];
    updatePiece(ed, id, { seamAllowance: 10, cut: 2 });
    // (100 + 2·10)² · 2 Stück, Ecken spitz
    expect(fabricArea(ed.s.doc)).toBeCloseTo((120 * 120 * 2) / 1e6, 4);
    const m = ed.s.doc.pattern!.materials[0];
    updateMaterial(ed, m.id, { color: '#aa0000' });
    expect(ed.s.doc.entities[a.pathId!].style.fill).toBe('#aa0000');
  });
});

describe('Export und Austausch', () => {
  it('Schnitt bleibt in der Projektdatei erhalten', async () => {
    const ed = await makeEditor();
    const body = bodyForSize('D-S');
    generatePattern(ed, body, 'D-S', defaultBlock('sweatshirt', body, 'regular', 'D-S'));
    const back = parseDoc(serializeDoc(ed.s.doc));
    expect(back.pattern?.pieces.length).toBe(ed.s.doc.pattern!.pieces.length);
    expect(back.pattern?.seams.length).toBe(ed.s.doc.pattern!.seams.length);
    expect(back.pattern?.bodySize).toBe('D-S');
  });

  it('Schnittteile gehören nicht zum Artwork-Export', async () => {
    const ed = await makeEditor();
    ed.createCircle({ pos: { x: 0, y: 0 } }, 20);
    const body = bodyForSize('H-M');
    generatePattern(ed, body, 'H-M', defaultBlock('tshirt', body));
    const scene = buildScene(ed.s.doc);
    expect(scene.widthMm).toBeCloseTo(40, 3);
    expect(scene.layers.every((l) => l.items.length === 1)).toBe(true);
  });

  it('Austauschformat für Vektordesign 3D', async () => {
    const ed = await makeEditor();
    const body = bodyForSize('H-M');
    generatePattern(ed, body, 'H-M', defaultBlock('hoodie', body));
    const ex = patternExchange(ed.s.doc)!;
    expect(ex.format).toBe('vektordesign-schnitt');
    expect(ex.pieces.map((p) => p.role).sort()).toEqual(['back', 'cuff', 'front', 'hem', 'hem', 'hood', 'sleeve']);
    for (const p of ex.pieces) {
      expect(p.ccw).toBe(true);
      expect(p.edges[0].from).toBe(0);
      expect(p.edges[p.edges.length - 1].to).toBe(0);
      for (let i = 1; i < p.edges.length; i++) expect(p.edges[i].from).toBe(p.edges[i - 1].to);
    }
    const hood = ex.pieces.find((p) => p.role === 'hood')!;
    expect(hood.cut).toBe(2);
    expect(ex.seams.some((s) => s.a.piece === hood.id && s.a.copy === 1)).toBe(true);
  });

  it('DXF mit Schnittlinie, Nahtlinie, Fadenlauf, Passzeichen und Beschriftung', async () => {
    const ed = await makeEditor();
    const body = bodyForSize('H-M');
    generatePattern(ed, body, 'H-M', defaultBlock('tshirt', body));
    const dxf = strFromU8(exportPatternDxf(ed.s.doc));
    for (const l of ['SCHNITTLINIE', 'NAHTLINIE', 'FADENLAUF', 'PASSZEICHEN', 'BESCHRIFTUNG']) expect(dxf).toContain(l);
    expect(dxf).toContain('Vorderteil');
    expect(dxf).toContain('2x gegengleich');
    expect(dxf.trim().endsWith('EOF')).toBe(true);
    const empty = await makeEditor();
    expect(() => exportPatternDxf(empty.s.doc)).toThrow(/Keine Schnittteile/);
  });
});
