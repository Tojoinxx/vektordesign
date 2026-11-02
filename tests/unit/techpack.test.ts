import { describe, expect, it } from 'vitest';
import { strFromU8, unzlibSync } from 'fflate';
import { makeEditor } from './helpers';
import { defaultBlock } from '../../src/pattern/blocks';
import { bodyForSize } from '../../src/pattern/body';
import { generatePattern, makePieces } from '../../src/store/patternOps';
import { addReferences, addTrim, techPackOf, updateTechPack } from '../../src/store/techpackOps';
import { measureCsv, measureTable } from '../../src/techpack/measure';
import { constructionRows } from '../../src/techpack/construction';
import { buildTechPack } from '../../src/export/techPack';
import { parseDoc, serializeDoc } from '../../src/model/serialize';

async function hoodie(size = 'H-M', kind: 'hoodie' | 'tshirt' = 'hoodie') {
  const ed = await makeEditor();
  const b = bodyForSize(size);
  generatePattern(ed, b, size, defaultBlock(kind, b, 'regular', size));
  return ed;
}

/** Alle Textoperatoren eines PDFs (Inhaltsströme entpackt). */
function pdfText(bytes: Uint8Array): string {
  const s = strFromU8(bytes, true);
  let out = '';
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    const head = s.slice(Math.max(0, m.index - 200), m.index);
    const chunk = bytes.slice(start, end);
    try {
      out += head.includes('FlateDecode') ? strFromU8(unzlibSync(chunk), true) : strFromU8(chunk, true);
    } catch {
      /* Bild o. ä. */
    }
  }
  return out;
}

describe('Maßtabelle', () => {
  it('Größenstaffel aus dem Grundschnitt: Brustweite wächst mit der Größe, Basisgröße markiert', async () => {
    const ed = await hoodie('H-L');
    const t = measureTable(ed.s.doc)!;
    expect(t.kind).toBe('graded');
    expect(t.sizes.map((s) => s.name)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL']);
    expect(t.sizes.find((s) => s.base)?.name).toBe('L');
    const chest = t.rows.find((r) => r.pom.id === 'chest')!.values as number[];
    for (let i = 1; i < chest.length; i++) expect(chest[i]).toBeGreaterThan(chest[i - 1]);
    // L: (Brust 108 cm + 14 cm Zugabe) / 2
    expect(chest[3]).toBeCloseTo((1080 + 140) / 2, 0);
    expect(t.rows.some((r) => r.pom.id === 'hoodH')).toBe(true);
    const csv = measureCsv(t, { chest: 15 });
    expect(csv).toContain('½ Brustweite');
    expect(csv).toContain('61,0');
    expect(csv.split('\r\n')[0]).toContain('L (Basis)');
  });

  it('Ohne Grundschnitt: Maße je Schnittteil', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 200, y: 300 } }, 'corner');
    makePieces(ed, [r.pathId!]);
    const t = measureTable(ed.s.doc)!;
    expect(t.kind).toBe('pieces');
    expect(t.rows.map((x) => Math.round(x.values[0]!))).toEqual([200, 300]);
  });
});

describe('Verarbeitung', () => {
  it('Nähte als Gruppen mit Vorschlag, Säume als offene Kanten', async () => {
    const ed = await hoodie('H-M', 'tshirt');
    const rows = constructionRows(ed.s.doc);
    const side = rows.find((r) => r.name === 'Seitennaht')!;
    expect(side.count).toBe(2);
    expect(rows.find((r) => r.name === 'Schulternaht')!.suggestion).toMatch(/Nahtband/);
    expect(rows.find((r) => r.name.startsWith('Halsbündchen vorne'))!.suggestion).toMatch(/gedehnt/);
    expect(rows.some((r) => r.kind === 'edge' && r.name === 'Ärmelsaum')).toBe(true);
  });
});

describe('Tech-Pack', () => {
  it('Angaben, Zutaten und Referenzen bleiben in der Projektdatei', async () => {
    const ed = await hoodie();
    updateTechPack(ed, 'x', (tp) => {
      tp.styleNo = 'TH-1';
      tp.season = 'FS 2027';
    });
    addTrim(ed, 'Hauptetikett', 'Gewebt');
    addReferences(ed, [{ name: 'Kapuze', image: 'data:image/png;base64,AA==', w: 1, h: 1, category: 'Detail', note: 'tiefer' }]);
    const back = parseDoc(serializeDoc(ed.s.doc));
    const tp = techPackOf(back.techPack);
    expect(tp.styleNo).toBe('TH-1');
    expect(tp.trims[0].name).toBe('Hauptetikett');
    expect(tp.references[0].category).toBe('Detail');
    ed.undo();
    expect(techPackOf(ed.s.doc.techPack).references.length).toBe(0);
  });

  it('PDF: Deckblatt, Maßtabelle, Schnittteile, Material, Verarbeitung, Referenzen', async () => {
    const ed = await hoodie();
    updateTechPack(ed, 'x', (tp) => {
      tp.styleNo = 'TH-2027-01';
      tp.notes = 'Kordel nicht im Muster.';
    });
    addTrim(ed, 'Pflegeetikett', 'Satin');
    addReferences(ed, [{ name: 'Farbmuster', image: 'x', w: 4, h: 4, category: 'Stoff/Farbe', note: '' }]);
    const decode = async () => ({ rgba: new Uint8ClampedArray(4 * 4 * 4).fill(200), width: 4, height: 4 });
    const pdf = await buildTechPack(ed.s.doc, { decode, date: new Date('2026-11-01') });
    const head = strFromU8(pdf.slice(0, 8));
    expect(head.startsWith('%PDF-')).toBe(true);
    const pages = (strFromU8(pdf, true).match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBe(6);
    const text = pdfText(pdf);
    for (const t of ['TECH-PACK', 'TH-2027-01', 'Gesamtl', 'Schnittteile', 'Pflegeetikett', 'Overlock', 'Kordel nicht im Muster', 'Farbmuster']) expect(text, t).toContain(t);
  });
});

describe('Tech-Pack im ZIP-Paket', () => {
  it('LabwearOS-Profil legt Tech-Pack, Maßtabelle und Schnitt bei, wenn Schnittteile vorhanden sind', async () => {
    const { buildPackage } = await import('../../src/export/package');
    const { BUILTIN_PROFILES } = await import('../../src/model/profiles');
    const { productionOf } = await import('../../src/model/production');
    const { unzipSync } = await import('fflate');
    const ed = await hoodie();
    const profile = BUILTIN_PROFILES.find((p) => p.id === 'labwearos')!;
    const doc = ed.s.doc;
    const res = await buildPackage(doc, productionOf(doc), profile, { date: new Date('2026-11-02T10:00:00Z') });
    const names = Object.keys(unzipSync(res.zip));
    const tp = names.filter((n) => n.includes('/Tech-Pack/'));
    expect(tp.some((n) => n.endsWith('_Tech-Pack.pdf'))).toBe(true);
    expect(tp.some((n) => n.endsWith('_Masstabelle.csv'))).toBe(true);
    expect(tp.some((n) => n.endsWith('_Schnitt.dxf'))).toBe(true);
    const readme = strFromU8(unzipSync(res.zip)[names.find((n) => n.endsWith('LIESMICH.txt'))!]);
    expect(readme).toContain('Tech-Pack/');
    // ohne Häkchen bzw. ohne Schnitt: kein Tech-Pack
    const off = await buildPackage(doc, productionOf(doc), { ...profile, techPack: false });
    expect(off.files.some((n) => n.includes('/Tech-Pack/'))).toBe(false);
    const plain = await makeEditor();
    const none = await buildPackage(plain.s.doc, productionOf(plain.s.doc), profile);
    expect(none.files.some((n) => n.includes('/Tech-Pack/'))).toBe(false);
  }, 60000);
});
