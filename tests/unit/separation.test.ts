import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { separate, isDarkFabric } from '../../src/model/separation';

async function logo() {
  const ed = await makeEditor();
  ed.createRectangle({ pos: { x: -20, y: -10 } }, { pos: { x: 20, y: 10 } }, 'corner', { style: { fill: '#c8102e', stroke: null, strokeWidth: 0.5, opacity: 1 } });
  ed.createCircle({ pos: { x: 0, y: 0 } }, 5, { style: { fill: '#1f3a93', stroke: null, strokeWidth: 0.5, opacity: 1 } });
  return ed;
}

describe('Farbseparation', () => {
  it('Knockout: obere Farbe spart die untere aus, hell vor dunkel', async () => {
    const ed = await logo();
    const s = separate(ed.s.doc, { fabric: '#ffffff' });
    expect(s.underbase).toBe(false);
    expect(s.plates.map((p) => p.color)).toEqual(['#c8102e', '#1f3a93']);
    const circle = Math.PI * 25;
    expect(s.plates[0].area).toBeCloseTo(800 - circle, 0);
    expect(s.plates[1].area).toBeCloseTo(circle, 0);
    expect(s.box!.maxX - s.box!.minX).toBeCloseTo(40, 6);
  });

  it('Überfüllung: helle Farbe läuft unter die dunkle', async () => {
    const ed = await logo();
    const s = separate(ed.s.doc, { trap: 0.2 });
    const circle = Math.PI * 25;
    // Loch im Rot schrumpft von r = 5 auf 4,8
    expect(s.plates[0].area - (800 - circle)).toBeCloseTo(Math.PI * (25 - 4.8 * 4.8), 1);
    expect(s.plates[1].area).toBeCloseTo(circle, 0);
  });

  it('Dunkler Stoff: weiße Unterlage mit Rückzug zuerst; Stofffarbe aussparen', async () => {
    const ed = await logo();
    expect(isDarkFabric('#111317')).toBe(true);
    const s = separate(ed.s.doc, { fabric: '#111317', choke: 0.3 });
    expect(s.underbase).toBe(true);
    expect(s.plates[0].kind).toBe('underbase');
    expect(s.plates[0].area).toBeCloseTo(39.4 * 19.4, 0);
    expect(s.plates.map((p) => p.order)).toEqual([1, 2, 3]);
    // Kreis in Stofffarbe: wird nicht gedruckt, spart aber das Rot aus
    const ed2 = await makeEditor();
    ed2.createRectangle({ pos: { x: -20, y: -10 } }, { pos: { x: 20, y: 10 } }, 'corner', { style: { fill: '#ffffff', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    ed2.createCircle({ pos: { x: 0, y: 0 } }, 5, { style: { fill: '#111317', stroke: null, strokeWidth: 0.5, opacity: 1 } });
    const s2 = separate(ed2.s.doc, { fabric: '#111317', dropFabricColor: true, underbase: 'off' });
    expect(s2.plates.length).toBe(1);
    expect(s2.plates[0].area).toBeCloseTo(800 - Math.PI * 25, 0);
  });

  it('Konturen werden zu Flächen', async () => {
    const ed = await makeEditor();
    ed.createLine({ pos: { x: 0, y: 0 } }, { pos: { x: 50, y: 0 } }, { style: { fill: null, stroke: '#000000', strokeWidth: 2, opacity: 1 } });
    const s = separate(ed.s.doc);
    expect(s.plates[0].area).toBeCloseTo(100, 3);
  });
});

import { unzipSync, strFromU8 } from 'fflate';
import { productionOf } from '../../src/model/production';
import { buildScreenPrint } from '../../src/export/screenPrint';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Siebdruck-Paket', () => {
  it('Filme je Farbe mit gleicher Seitengröße, Andruck, LIESMICH', async () => {
    const ed = await logo();
    ed.updateProduction('Test', (p) => {
      p.article = 'Vereinsshirt';
      p.variants[0].fabric = '#111317';
      p.colorSpecs['#c8102e'] = { name: 'Rot', pantone: '186 C' };
    });
    const p = productionOf(ed.s.doc);
    const r = await buildScreenPrint(ed.s.doc, p, p.motifs[0], p.variants[0], { date: new Date('2026-10-28T12:00:00Z') });
    expect(r.separation.plates.map((x) => x.kind)).toEqual(['underbase', 'color', 'color']);
    const files = unzipSync(r.zip);
    const names = Object.keys(files).sort();
    expect(names.some((n) => n.endsWith('_Film1_Unterlage-Weiss.pdf'))).toBe(true);
    expect(names.some((n) => n.endsWith('_Film2_Rot.pdf'))).toBe(true);
    expect(names.some((n) => n.endsWith('_alle_Filme.pdf'))).toBe(true);
    expect(names.some((n) => n.endsWith('_Andruck.pdf'))).toBe(true);
    const readme = strFromU8(files[names.find((n) => n.endsWith('LIESMICH.txt'))!]);
    expect(readme).toContain('2. Rot – #C8102E');
    expect(readme).toContain('Pantone 186 C');
    // gleiche Seitengröße auf allen Filmen (Passer)
    const all = new TextDecoder('latin1').decode(files[names.find((n) => n.endsWith('_alle_Filme.pdf'))!]);
    const boxes = [...all.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1]);
    expect(boxes.length).toBe(3);
    expect(new Set(boxes).size).toBe(1);
    const [, , w] = boxes[0].split(' ').map(Number);
    expect(w / (72 / 25.4)).toBeCloseTo(160, 3);
    // Rendern, falls pdftoppm vorhanden ist
    const out = join(tmpdir(), 'vektordesign-screen');
    mkdirSync(out, { recursive: true });
    const film = join(out, 'filme.pdf');
    writeFileSync(film, files[names.find((n) => n.endsWith('_alle_Filme.pdf'))!]);
    writeFileSync(join(out, 'andruck.pdf'), files[names.find((n) => n.endsWith('_Andruck.pdf'))!]);
    if (existsSync('/usr/local/bin/pdftoppm') || existsSync('/usr/bin/pdftoppm')) {
      execFileSync('pdftoppm', ['-r', '20', '-png', film, join(out, 'film')]);
      execFileSync('pdftoppm', ['-r', '30', '-png', join(out, 'andruck.pdf'), join(out, 'andruck')]);
    }
  });
});
