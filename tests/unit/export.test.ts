import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { ORIGIN_ID } from '../../src/model/types';
import { exportSvg, ExportError } from '../../src/export/svg';
import { crc32, pngInfo, readChunks, setPngDpi } from '../../src/export/pngMeta';
import { parseDoc, serializeDoc } from '../../src/model/serialize';
import { fadeGradient } from '../../src/model/paint';

async function acceptanceSketch() {
  const ed = await makeEditor();
  const r = ed.createRectangle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: ORIGIN_ID } }, { pos: { x: 30, y: 15 } }, 'center', {
    width: '80',
    height: '40',
  });
  const c = ed.createCircle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: r.centerId! } }, 4, { diameter: '10' });
  return { ed, r, c };
}

describe('SVG-Export', () => {
  it('Abnahme M1: exakt 80 × 40 mm mit Kreis Ø10 in der Mitte', async () => {
    const { ed, r, c } = await acceptanceSketch();
    ed.setStyle([r.pathId!], { fill: '#d62828', stroke: null });
    ed.setStyle([c.circleId!], { fill: '#ffffff', stroke: null });
    expect(ed.s.analysis.status).toBe('full');
    const { svg, widthMm, heightMm } = exportSvg(ed.s.doc);
    expect(widthMm).toBe(80);
    expect(heightMm).toBe(40);
    expect(svg).toContain('width="80mm" height="40mm" viewBox="0 0 80 40"');
    expect(svg).toContain('d="M0 40 L80 40 L80 0 L0 0 Z"');
    expect(svg).toMatch(/<circle id="c\d+" cx="40" cy="20" r="5" fill="#ffffff"\/>/);
    // Nur die beiden Formen – kein Mittelpunkt, keine Bemaßungen, keine Glyphen
    const elements = svg.match(/<(path|circle|text|line|rect)\b/g) ?? [];
    expect(elements).toEqual(['<path', '<circle']);
  });

  it('Konturstärke kann in den Rahmen einbezogen werden', async () => {
    const { ed, r } = await acceptanceSketch();
    ed.setStyle([r.pathId!], { stroke: '#000000', strokeWidth: 1 });
    const g = exportSvg(ed.s.doc, { bounds: 'geometry' });
    expect(g.widthMm).toBe(80);
    const s = exportSvg(ed.s.doc, { bounds: 'stroke' });
    expect(s.widthMm).toBe(81);
    expect(s.heightMm).toBe(41);
  });

  it('Farbverlauf und Verblassen landen als SVG-Verlauf im Export', async () => {
    const { ed, r } = await acceptanceSketch();
    ed.setStyle([r.pathId!], { fill: fadeGradient('#2f6fd6', 'lr') });
    const { svg } = exportSvg(ed.s.doc);
    expect(svg).toContain('<linearGradient id="verlauf1" gradientUnits="userSpaceOnUse" x1="0" y1="20" x2="80" y2="20">');
    expect(svg).toContain('stop-opacity="0"');
    expect(svg).toContain('fill="url(#verlauf1)"');
  });

  it('Spiegeln für Flexfolie', async () => {
    const { ed } = await acceptanceSketch();
    const { svg } = exportSvg(ed.s.doc, { mirror: true });
    expect(svg).toContain('transform="matrix(-1 0 0 1 80 0)"');
  });

  it('leere Zeichnung meldet einen verständlichen Fehler', async () => {
    const ed = await makeEditor();
    expect(() => exportSvg(ed.s.doc)).toThrow(ExportError);
  });
});

describe('PNG-Auflösung', () => {
  // 1×1 PNG, transparent (RGBA)
  const tiny = Uint8Array.from(
    atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='),
    (c) => c.charCodeAt(0),
  );

  it('trägt 300 dpi als pHYs ein', () => {
    const out = setPngDpi(tiny, 300);
    const info = pngInfo(out);
    expect(info.dpi).toBe(300);
    expect(info.width).toBe(1);
    expect(info.colorType).toBe(6); // RGBA → transparenter Hintergrund möglich
    const chunks = readChunks(out).map((c) => c.type);
    expect(chunks.slice(0, 2)).toEqual(['IHDR', 'pHYs']);
  });

  it('ersetzt vorhandene Auflösung und hat gültige Prüfsummen', () => {
    const out = setPngDpi(setPngDpi(tiny, 150), 600);
    expect(readChunks(out).filter((c) => c.type === 'pHYs').length).toBe(1);
    expect(pngInfo(out).dpi).toBe(600);
    // CRC jedes Blocks prüfen
    const dv = new DataView(out.buffer);
    let off = 8;
    while (off < out.length) {
      const len = dv.getUint32(off);
      const crc = dv.getUint32(off + 8 + len);
      expect(crc32(out, off + 4, off + 8 + len)).toBe(crc);
      off += 12 + len;
    }
  });
});

describe('Projektdatei', () => {
  it('speichert und lädt verlustfrei', async () => {
    const { ed } = await acceptanceSketch();
    const text = serializeDoc(ed.s.doc);
    const back = parseDoc(text);
    expect(back.dims).toEqual(ed.s.doc.dims);
    expect(back.constraints).toEqual(ed.s.doc.constraints);
    expect(back.points).toEqual(ed.s.doc.points);
  });

  it('lehnt fremde Dateien ab', () => {
    expect(() => parseDoc('{"a":1}')).toThrow(/kein Vektordesign-Projekt/);
    expect(() => parseDoc('kein json')).toThrow(/kein gültiges/);
  });
});
