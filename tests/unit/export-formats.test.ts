import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { buildScene } from '../../src/export/scene';
import { exportPdf } from '../../src/export/pdf';
import { exportEps } from '../../src/export/eps';
import { exportDxf } from '../../src/export/dxf';
import { fadeGradient } from '../../src/model/paint';

const OUT = join(tmpdir(), 'vektordesign-export-test');
mkdirSync(OUT, { recursive: true });
const has = (tool: string) => ['/usr/bin', '/usr/local/bin'].some((d) => existsSync(join(d, tool)));

async function sample() {
  const ed = await makeEditor();
  const r = ed.createRectangle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: 'O' } }, { pos: { x: 31, y: 17 } }, 'center', { width: '100', height: '50' });
  ed.setStyle([r.pathId!], { fill: fadeGradient('#2f6fd6', 'lr') as never, stroke: '#1e2328', strokeWidth: 0.5 });
  ed.addLayer('Vordergrund');
  const c = ed.createCircle({ pos: { x: 0, y: 0 } }, 10);
  ed.setStyle([c.circleId!], { fill: '#f5c518', stroke: null, opacity: 0.8 });
  return ed;
}

describe('Export als PDF, EPS und DXF', () => {
  it('PDF: Seitengröße exakt in mm, Ebenen, Verlauf mit Verblassen, gültige Struktur', async () => {
    const ed = await sample();
    const scene = buildScene(ed.s.doc);
    expect(scene.widthMm).toBeCloseTo(100, 6);
    const pdf = exportPdf(scene, { title: 'Prüfmotiv Ä' });
    const text = new TextDecoder('latin1').decode(pdf);
    expect(text.startsWith('%PDF-1.6')).toBe(true);
    expect(text).toContain('/MediaBox [0 0 283.465 141.732]');
    expect(text).toContain('/Type /OCG');
    expect(text).toContain('/SMask');
    expect(text).toContain('/ShadingType 2');
    const file = join(OUT, 'test.pdf');
    writeFileSync(file, pdf);
    if (has('qpdf')) execFileSync('qpdf', ['--check', file]);
    if (has('pdfinfo')) expect(execFileSync('pdfinfo', [file]).toString()).toMatch(/Page size:\s+283\.46\d* x 141\.73\d* pts/);
    // CMYK
    expect(new TextDecoder('latin1').decode(exportPdf(scene, { colorMode: 'cmyk' }))).toContain(' k\n');
  });

  it('EPS: Bounding Box in Punkt, Shading, Hinweis auf fehlende Transparenz', async () => {
    const ed = await sample();
    const { bytes, lostTransparency } = exportEps(buildScene(ed.s.doc));
    const ps = new TextDecoder('latin1').decode(bytes);
    expect(ps).toContain('%%HiResBoundingBox: 0 0 283.465 141.732');
    expect(ps).toContain('shfill');
    expect(lostTransparency).toBe(true);
    writeFileSync(join(OUT, 'test.eps'), bytes);
  });

  it('DXF: Maße in mm, Ebenen als Layer, Kreis als CIRCLE', async () => {
    const ed = await sample();
    const dxf = new TextDecoder('latin1').decode(exportDxf(buildScene(ed.s.doc)));
    expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
    expect(dxf).toContain('VORDERGRUND');
    expect(dxf).toContain('CIRCLE');
    expect(dxf).toMatch(/40\r\n10\r\n/);
    expect(dxf.trimEnd().endsWith('EOF')).toBe(true);
    writeFileSync(join(OUT, 'test.dxf'), dxf);
  });
});
