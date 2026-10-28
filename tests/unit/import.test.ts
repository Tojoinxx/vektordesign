import { describe, expect, it, beforeAll } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import { importSvg, parsePathData, parseTransform } from '../../src/platform/svgImport';
import { importDxf } from '../../src/platform/dxfImport';
import { contoursBBox } from '../../src/model/shape';
import { exportSvg } from '../../src/export/svg';
import { exportDxf } from '../../src/export/dxf';
import { buildScene } from '../../src/export/scene';
import { makeEditor } from './helpers';
import { arcGeom, arcOf } from '../../src/model/arc';
import { docBBox } from '../../src/model/bounds';

beforeAll(() => {
  (globalThis as { DOMParser?: unknown }).DOMParser = XmlDOMParser;
});

describe('SVG-Import', () => {
  it('Pfaddaten mit relativen Befehlen, Bögen und Kurven', () => {
    const cs = parsePathData('M10 10 h20 v10 h-20 z M0 0 a5 5 0 0 1 10 0 Q 15 5 20 0 T 30 0');
    expect(cs.length).toBe(2);
    expect(cs[0].closed).toBe(true);
    expect(cs[0].nodes.length).toBe(4);
    const b = contoursBBox([cs[1]])!;
    expect(b.minY).toBeCloseTo(-5, 1);
  });

  it('Transformationen', () => {
    const m = parseTransform('translate(10 5) scale(2) rotate(90)');
    expect(m[4]).toBeCloseTo(10, 9);
    expect(m[0]).toBeCloseTo(0, 9);
    expect(m[1]).toBeCloseTo(2, 9);
  });

  it('mm-Dokument: Größe bleibt erhalten, Farben und Kontur kommen mit', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="40mm" viewBox="0 0 80 40">
      <style>.b{fill:#1f3a93}</style>
      <rect x="0" y="0" width="80" height="40" fill="#c8102e"/>
      <g transform="translate(40 20)"><circle class="b" r="5"/></g>
      <path d="M0 40 L80 0" fill="none" stroke="#000" stroke-width="2"/>
      <text x="1" y="1">x</text>
    </svg>`;
    const r = importSvg(svg);
    expect(r.shapes.length).toBe(3);
    const box = contoursBBox(r.shapes.flatMap((s) => s.contours))!;
    expect(box.maxX - box.minX).toBeCloseTo(80, 6);
    expect(box.maxY - box.minY).toBeCloseTo(40, 6);
    expect(r.shapes[1].style.fill).toBe('#1f3a93');
    expect(r.shapes[2].style.stroke).toBe('#000000');
    expect(r.shapes[2].style.strokeWidth).toBeCloseTo(2, 6);
    expect(r.warnings.join(' ')).toContain('Texte');
  });

  it('Rundreise: eigener SVG-Export wieder importiert hat dieselbe Größe', async () => {
    const ed = await makeEditor();
    ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 50, y: 20 } }, 'corner', { style: { fill: '#c8102e', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    ed.createCircle({ pos: { x: 60, y: 10 } }, 8, { style: { fill: '#1f3a93', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    const r = importSvg(exportSvg(ed.s.doc).svg);
    const box = contoursBBox(r.shapes.flatMap((s) => s.contours))!;
    expect(box.maxX - box.minX).toBeCloseTo(68, 4);
    expect(box.maxY - box.minY).toBeCloseTo(20, 4);
  });
});

describe('DXF-Import', () => {
  it('Rundreise: Linien, Kreis und Bogen werden Skizzengeometrie', async () => {
    const ed = await makeEditor();
    ed.createLine({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 0 } });
    ed.createCircle({ pos: { x: 20, y: 20 } }, 5);
    ed.createArc({ pos: { x: 0, y: 30 } }, { pos: { x: 10, y: 30 } }, { pos: { x: 0, y: 40 } }, true);
    const dxf = new TextDecoder().decode(exportDxf(buildScene(ed.s.doc)));
    const r = importDxf(dxf);
    expect(r.lines.length).toBe(1);
    expect(r.circles.length).toBe(1);
    expect(r.arcs.length).toBe(1);
    expect(r.arcs[0].r).toBeCloseTo(10, 4);
    const ed2 = await makeEditor();
    const out = ed2.insertImported({ ...r, shapes: r.shapes.map((c) => ({ contours: [c], style: { fill: null, stroke: '#000', strokeWidth: 0.25, opacity: 1 } })) }, 'Import');
    expect(out.ok).toBe(true);
    const arc = Object.values(ed2.s.doc.entities).find((e) => e.kind === 'arc')!;
    expect(arcGeom(ed2.s.doc, arcOf(ed2.s.doc, arc.id)!).sweep).toBeCloseTo(Math.PI / 2, 4);
    // Bemaßbar: Radius des importierten Bogens
    expect(ed2.addDimension({ kind: 'radius', refs: [arc.id] }, { expr: '12' }).ok).toBe(true);
  });

  it('LWPOLYLINE mit Ausbauchung (Halbkreis) und Zoll-Einheit', () => {
    const dxf = [
      '0',
      'SECTION',
      '2',
      'HEADER',
      '9',
      '$INSUNITS',
      '70',
      '1',
      '0',
      'ENDSEC',
      '0',
      'SECTION',
      '2',
      'ENTITIES',
      '0',
      'LWPOLYLINE',
      '8',
      '0',
      '90',
      '2',
      '70',
      '0',
      '10',
      '0',
      '20',
      '0',
      '42',
      '1',
      '10',
      '1',
      '20',
      '0',
      '0',
      'ENDSEC',
      '0',
      'EOF',
    ].join('\n');
    const r = importDxf(dxf);
    expect(r.unit).toBe('Zoll');
    const b = contoursBBox(r.shapes)!;
    expect(b.maxX - b.minX).toBeCloseTo(25.4, 4);
    expect(b.minY).toBeCloseTo(-12.7, 2);
  });
});

void docBBox;
