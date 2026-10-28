import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'opentype.js';
import { makeShaper } from '../../src/platform/fontOutline';
import { badge, banner, bendText, frame, neckLabel, qr, shield } from '../../src/model/generators';
import { contoursBBox, flattenContour } from '../../src/model/shape';
import { makeEditor } from './helpers';
import { textOnCircleOp } from '../../src/store/ops';

const file = resolve(import.meta.dirname, '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff');
const buf = readFileSync(file);
const font = parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
vi.mock('../../src/platform/fontOutline', async (orig) => {
  const mod = await orig<typeof import('../../src/platform/fontOutline')>();
  const { readFileSync: rf } = await import('node:fs');
  const { resolve: rs } = await import('node:path');
  const { parse: ps } = await import('opentype.js');
  const b = rf(rs(import.meta.dirname, '../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff'));
  const f = ps(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return { ...mod, loadFont: async () => ({ font: f, substitute: false }) };
});

const shape = makeShaper(font);
const bbox = (parts: { contours: import('../../src/model/types').Contour[] }[]) => contoursBBox(parts.flatMap((p) => p.contours))!;

describe('Vorlagen-Generatoren', () => {
  it('Badge: Außendurchmesser, Text im Ring', () => {
    const parts = badge({ diameter: 80, ring: 16, top: 'SPORTVEREIN', bottom: 'SEIT 1920', center: 'SV', stars: true, color: '#1f3a93', accent: '#ffffff' }, shape);
    const b = bbox(parts);
    expect(b.maxX - b.minX).toBeCloseTo(80, 3);
    const ringText = parts.find((p) => p.name === 'Ringtext')!;
    for (const c of ringText.contours)
      for (const p of flattenContour(c, 0.05)) {
        const r = Math.hypot(p.x, p.y);
        expect(r).toBeGreaterThan(24 - 0.5);
        expect(r).toBeLessThan(40 + 0.5);
      }
  });

  it('Text biegen: oben Grundlinie auf dem Radius', () => {
    const t = shape('ABC', 10);
    const bent = bendText(t.contours, t.width, { x: 0, y: 0 }, 30, 'top');
    const pts = bent.flatMap((c) => flattenContour(c, 0.05));
    const minR = Math.min(...pts.map((p) => Math.hypot(p.x, p.y)));
    expect(minR).toBeGreaterThan(29.5);
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(30 + t.capHeight - 0.5);
  });

  it('Wappen, Banner, Rahmen, Nackendruck in Sollgröße', () => {
    const s = bbox(shield({ width: 60, height: 72, border: 4, band: 'FC', initials: '1920', color: '#c8102e', accent: '#fff' }, shape));
    expect(s.maxX - s.minX).toBeCloseTo(60, 1);
    expect(s.maxY - s.minY).toBeCloseTo(72, 1);
    const bn = bbox(banner({ width: 90, height: 18, text: 'CHAMPIONS', color: '#c8102e', shade: '#7b1e2b', textColor: '#fff' }, shape));
    expect(bn.maxX - bn.minX).toBeGreaterThan(90);
    const f = bbox(frame({ width: 100, height: 60, radius: 8, line: 1.5, double: true, color: '#000' }));
    expect(f.maxX - f.minX).toBeCloseTo(100, 1);
    const n = neckLabel({ brand: 'MARKE', size: 'M', lines: '100 % Baumwolle\n30 °C', width: 50, color: '#fff', frame: true }, shape);
    expect(n.length).toBe(2);
  });

  it('QR-Code: quadratisch in Sollgröße', () => {
    const parts = qr({ text: 'https://example.com', size: 30, quiet: 2, level: 'M', color: '#000' });
    const b = bbox(parts);
    // Module ohne Ruhezone: kleiner als 30, mittig
    expect(b.maxX - b.minX).toBeCloseTo(b.maxY - b.minY, 6);
    expect(b.maxX - b.minX).toBeLessThan(30);
    expect(b.maxX + b.minX).toBeCloseTo(0, 6);
  });

  it('Text auf Kreis als Befehl', async () => {
    const ed = await makeEditor();
    const c = ed.createCircle({ pos: { x: 0, y: 0 } }, 20);
    const t = ed.createText({ pos: { x: -10, y: 30 } }, 'HALLO', { fontSize: 8 });
    const out = await textOnCircleOp(ed, 'top', 1, [c.circleId!, t.textId!]);
    expect(out.ok, out.ok ? '' : out.message).toBe(true);
    const s = ed.s.doc.entities[out.ids![0]];
    expect(s.kind).toBe('shape');
    expect(ed.s.doc.entities[t.textId!]).toBeUndefined();
  });
});
