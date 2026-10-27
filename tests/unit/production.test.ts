import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'opentype.js';
import { unzipSync, strFromU8 } from 'fflate';
import { makeEditor } from './helpers';
import type { ShapeEntity } from '../../src/model/types';
import { booleanOp, textToPaths } from '../../src/store/ops';
import { allColors, applyVariant, motifColors, motifSize, productionOf } from '../../src/model/production';
import { areaOf, garmentOf } from '../../src/model/garments';
import { BUILTIN_PROFILES } from '../../src/model/profiles';
import { buildPackage } from '../../src/export/package';
import { parseDoc, serializeDoc } from '../../src/model/serialize';

vi.mock('../../src/platform/fontOutline', async (orig) => {
  const mod = await orig<typeof import('../../src/platform/fontOutline')>();
  const file = resolve(import.meta.dirname, '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff');
  const buf = readFileSync(file);
  const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return { ...mod, loadFont: async () => ({ font, substitute: false }) };
});

const OUT = join(tmpdir(), 'vektordesign-production-test');
mkdirSync(OUT, { recursive: true });
const has = (tool: string) => ['/usr/bin', '/usr/local/bin'].some((d) => existsSync(join(d, tool)));

/** Logo wie in der Abnahme M2: Text in Pfade, mit Unterstrich vereinigt, 100 mm breit, zwei Farben. */
async function logo() {
  const ed = await makeEditor();
  const t = ed.createText({ pos: { x: -15, y: 0 } }, 'TEAM', { fontSize: 10, fontWeight: 700 });
  await textToPaths(ed, [t.textId!]);
  const shape = Object.values(ed.s.doc.entities).find((e): e is ShapeEntity => e.kind === 'shape')!;
  const bar = ed.createRectangle({ pos: { x: -15, y: -3 } }, { pos: { x: 12, y: -1.5 } }, 'corner');
  await booleanOp(ed, 'union', [shape.id, bar.pathId!]);
  const u = Object.values(ed.s.doc.entities).find((e): e is ShapeEntity => e.kind === 'shape')!;
  expect(ed.setShapeSize(u.id, 'width', '100').ok).toBe(true);
  ed.setStyle([u.id], { fill: '#f5c518', stroke: null });
  const c = ed.createCircle({ pos: { x: 0, y: 3 } }, 12);
  ed.setStyle([c.circleId!], { fill: '#1f3a93', stroke: null });
  ed.arrange([c.circleId!], 'back');
  return ed;
}

describe('Produktion und LabwearOS-Paket (Meilenstein 3)', () => {
  it('Standardwerte: Hoodie, Motiv auf Brust links, Siebdruck', async () => {
    const ed = await makeEditor();
    const p = productionOf(ed.s.doc);
    expect(p.garment).toBe('hoodie');
    expect(p.motifs[0].technique).toBe('screen');
    expect(p.motifs[0].placement.area).toBe('chest-left');
    expect(areaOf(garmentOf('hoodie'), 'chest-left')).toBeTruthy();
  });

  it('Farben sammeln und Variante anwenden, Produktion bleibt beim Speichern erhalten', async () => {
    const ed = await logo();
    ed.updateProduction('Variante', (p) => {
      p.variants.push({ id: 'v2', name: 'Variante B', fabric: '#ffffff', fabricName: 'Weiß', colors: { '#f5c518': '#c8102e' } });
      p.colorSpecs['#f5c518'] = { pantone: '116 C' };
    });
    const p = productionOf(ed.s.doc);
    expect(motifColors(ed.s.doc, p.motifs[0]).sort()).toEqual(['#1f3a93', '#f5c518']);
    expect(allColors(ed.s.doc)).toHaveLength(2);
    const vd = applyVariant(ed.s.doc, p.variants[1]);
    expect(Object.values(vd.entities).some((e) => e.style.fill === '#c8102e')).toBe(true);
    const back = parseDoc(serializeDoc(ed.s.doc));
    expect(back.production?.variants).toHaveLength(2);
    expect(back.production?.colorSpecs['#f5c518'].pantone).toBe('116 C');
    // Rückgängig nimmt die Änderung zurück
    await ed.undo();
    expect(productionOf(ed.s.doc).variants).toHaveLength(1);
  });

  it('Abnahme M3: Logo auf Hoodie-Brust, Siebdruck, zwei Varianten → ZIP mit Motiven und Artwork-Blatt', async () => {
    const ed = await logo();
    ed.updateProduction('Artikel', (p) => {
      p.article = 'Vereinshoodie Süd';
      p.version = '2';
      p.garment = 'hoodie';
      p.motifs[0].name = 'Brustlogo';
      p.motifs[0].technique = 'screen';
      p.variants[0] = { id: 'v1', name: 'Schwarz', fabric: '#1e2328', fabricName: 'Schwarz', colors: {} };
      p.variants.push({ id: 'v2', name: 'Weiß', fabric: '#f4f4f2', fabricName: 'Weiß', colors: { '#f5c518': '#c8102e' } });
      p.colorSpecs['#f5c518'] = { pantone: '116 C', name: 'Vereinsgelb' };
    });
    const p = productionOf(ed.s.doc);
    const size = motifSize(ed.s.doc, p.motifs[0])!;
    expect(size.w).toBeCloseTo(100, 6);
    const profile = { ...BUILTIN_PROFILES[0], formats: ['pdf', 'svg', 'eps'] as const } as unknown as (typeof BUILTIN_PROFILES)[0];
    const res = await buildPackage(ed.s.doc, p, profile, { date: new Date('2026-10-28T08:00:00Z') });
    expect(res.fileName).toBe('Vereinshoodie-Sued_v2.zip');
    const files = unzipSync(res.zip);
    const names = Object.keys(files).sort();
    expect(names).toEqual(
      [
        'Vereinshoodie-Sued_v2/Farben.csv',
        'Vereinshoodie-Sued_v2/LIESMICH.txt',
        'Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Schwarz.eps',
        'Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Schwarz.pdf',
        'Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Schwarz.svg',
        'Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Weiss.eps',
        'Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Weiss.pdf',
        'Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Weiss.svg',
        'Vereinshoodie-Sued_v2/Vereinshoodie-Sued_v2.vdp',
        'Vereinshoodie-Sued_v2/Vereinshoodie-Sued_v2_Artwork-Blatt.pdf',
      ].sort(),
    );
    const svgB = strFromU8(files['Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Weiss.svg']);
    expect(svgB).toMatch(/width="100mm"/);
    expect(svgB).toContain('#c8102e');
    expect(svgB).not.toContain('#f5c518');
    expect(svgB).not.toContain('<text');
    const pdfA = new TextDecoder('latin1').decode(files['Vereinshoodie-Sued_v2/Motive/Vereinshoodie-Sued_v2_Brustlogo_Schwarz.pdf']);
    expect(pdfA).toContain('/MediaBox [0 0 283.465 ');
    expect(pdfA).toContain(' k\n'); // CMYK
    const csv = strFromU8(files['Vereinshoodie-Sued_v2/Farben.csv']);
    expect(csv).toContain('116 C');
    expect(csv).toContain('#C8102E');
    const sheet = files['Vereinshoodie-Sued_v2/Vereinshoodie-Sued_v2_Artwork-Blatt.pdf'];
    writeFileSync(join(OUT, 'artwork-blatt.pdf'), sheet);
    writeFileSync(join(OUT, 'paket.zip'), res.zip);
    if (has('qpdf')) execFileSync('qpdf', ['--check', join(OUT, 'artwork-blatt.pdf')]);
    if (has('pdfinfo')) {
      const info = execFileSync('pdfinfo', [join(OUT, 'artwork-blatt.pdf')]).toString();
      expect(info).toMatch(/Pages:\s+2/);
      expect(info).toMatch(/Page size:\s+841\.8\d* x 595\.27\d* pts/);
    }
    if (has('pdftotext')) {
      const txt = execFileSync('pdftotext', ['-layout', join(OUT, 'artwork-blatt.pdf'), '-']).toString();
      expect(txt).toContain('Vereinshoodie Süd');
      expect(txt).toContain('Siebdruck');
      expect(txt).toContain('Pantone 116 C');
      expect(txt).toContain('100 mm');
    }
    expect(res.warnings).toEqual([]);
  });
});
