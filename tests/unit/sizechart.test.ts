import { describe, expect, it } from 'vitest';
import { chartToSpecs, parseSizeChart, pomOfLabel } from '../../src/pattern/sizeChart';

const POLO = `SIZE GUIDE
Polo Shirt
CM	XS	S	M	L	XL	XXL
A TOTAL LENGTH	65	67	69	71	73	75
B CHEST WIDTH	56	58	60	62	64	66
INCH	XS	S	M	L	XL	XXL
A TOTAL LENGTH	25.6	26.4	27.2	28	28.8	29.5
B CHEST WIDTH	22	22.8	23.6	24.4	25.2	26`;

describe('Größentabelle eines Shops lesen', () => {
  it('Polo-Tabelle (CM und INCH untereinander): nimmt cm, A = Länge, B = ½ Brust', () => {
    const c = parseSizeChart(POLO)!;
    expect(c.unit).toBe('cm');
    expect(c.sizes).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL']);
    expect(c.rows.map((r) => r.pom)).toEqual(['len', 'chest']);
    expect(c.rows[0].values).toEqual([650, 670, 690, 710, 730, 750]);
    expect(c.rows[1].values).toEqual([560, 580, 600, 620, 640, 660]);
    const specs = chartToSpecs(c, 'H', ['H-XS', 'H-S', 'H-M', 'H-L', 'H-XL', 'H-XXL', 'H-3XL']);
    expect(specs['H-XXL']).toEqual({ len: 750, chest: 660 });
  });

  it('Nur Inch, deutsche Begriffe, Komma, Umfang und Semikolon (aus Excel)', () => {
    const inch = parseSizeChart('Size chart (inches)\nSize S M L\nBody length 27 28 29\nSleeve length 8 8.5 9')!;
    expect(inch.unit).toBe('inch');
    expect(inch.rows.find((r) => r.pom === 'len')!.values[0]).toBeCloseTo(685.8, 1);
    expect(inch.rows.find((r) => r.pom === 'sleeve')!.values[2]).toBeCloseTo(228.6, 1);
    const de = parseSizeChart('Größe;S;M;L;XL\nBrustumfang (cm);104;110;116;122\nRückenlänge;70;72;74;76\nÄrmellänge;61;62,5;64;65,5\nÄrmelöffnung;10;10,5;11;11,5')!;
    expect(de.rows.find((r) => r.pom === 'chest')!.values).toEqual([520, 550, 580, 610]);
    expect(de.rows.find((r) => r.pom === 'len')!.values[0]).toBe(700);
    expect(de.rows.find((r) => r.pom === 'sleeve')!.values[1]).toBe(625);
    expect(de.rows.find((r) => r.pom === 'opening')!.values[3]).toBe(115);
  });

  it('Begriffe → Messpunkte', () => {
    expect(pomOfLabel('Pit to pit')).toBe('chest');
    expect(pomOfLabel('Shoulder width')).toBe('shoulder');
    expect(pomOfLabel('Hood height')).toBe('hoodH');
    expect(pomOfLabel('Sleeve opening')).toBe('opening');
    expect(pomOfLabel('Saumweite')).toBe('hem');
    expect(pomOfLabel('Kragenhöhe')).toBe('collarH');
    expect(pomOfLabel('Farbe')).toBeNull();
  });
});

describe('Polo aus der Größentabelle eines Shops', () => {
  const POLO_CHART = POLO;

  it('Größentabelle einfügen → Schnitt: jede Größe trifft Länge und ½ Brust genau', async () => {
    const { makeEditor } = await import('./helpers');
    const { defaultBlock } = await import('../../src/pattern/blocks');
    const { bodyForSize, SIZE_TABLE } = await import('../../src/pattern/body');
    const { generatePattern } = await import('../../src/store/patternOps');
    const { measureTable } = await import('../../src/techpack/measure');
    const { checkSeams } = await import('../../src/pattern/geometry');
    const c = parseSizeChart(POLO_CHART)!;
    const all = chartToSpecs(
      c,
      'H',
      SIZE_TABLE.map((r) => r.id),
    );
    const ed = await makeEditor();
    const body = bodyForSize('H-M');
    expect(generatePattern(ed, body, 'H-M', { ...defaultBlock('polo', body, 'regular', 'H-M'), spec: all['H-M'], sizeSpecs: all }).ok).toBe(true);
    const doc = ed.s.doc;
    expect(doc.pattern!.pieces.map((p) => p.name)).toEqual(['Vorderteil', 'Rückenteil', 'Ärmel', 'Ärmelbündchen', 'Knopfleiste oben', 'Knopfleiste unten', 'Kragensteg', 'Kragen']);
    expect(checkSeams(doc).every((s) => s.ok)).toBe(true);
    const t = measureTable(doc)!;
    const col = (name: string) => t.sizes.findIndex((s) => s.name === name);
    const row = (id: string) => t.rows.find((r) => r.pom.id === id)!.values;
    for (const [i, s] of c.sizes.entries()) {
      expect(row('len')[col(s)], `Länge ${s}`).toBeCloseTo(c.rows[0].values[i]!, 0);
      expect(row('chest')[col(s)], `Brust ${s}`).toBeCloseTo(c.rows[1].values[i]!, 0);
    }
    // 3XL steht nicht in der Tabelle: wird von der Basisgröße aus gestuft
    expect(row('chest')[col('3XL')]!).toBeGreaterThan(660);
    // Polo-Messpunkte
    expect(row('placket')[col('M')]).toBeGreaterThan(100);
    expect(row('collarH')[col('M')]).toBeGreaterThan(50);
  });

  it('Claude liest die Tabelle aus dem Screenshot und baut den Schnitt (Aktion make_pattern_from_size_chart)', async () => {
    const { makeEditor } = await import('./helpers');
    const { runTool } = await import('../../src/assistant/tools');
    const ed = await makeEditor();
    const r = await runTool({ editor: ed, renderPreview: async () => null, openExport: () => {}, fitView: () => {} }, 'make_pattern_from_size_chart', {
      kind: 'polo',
      base_size: 'M',
      sizes: [
        { size: 'S', total_length: 67, chest: 58 },
        { size: 'M', total_length: 69, chest: 60 },
        { size: 'XXL', total_length: 75, chest: 66 },
        { size: '5XL', total_length: 80, chest: 72 },
      ],
    });
    expect(r.isError).toBeFalsy();
    expect(String(r.content)).toContain('5XL');
    const blk = ed.s.doc.pattern!.block!;
    expect(blk.kind).toBe('polo');
    expect(blk.spec).toEqual({ len: 690, chest: 600 });
    expect(blk.sizeSpecs!['H-XXL']).toEqual({ len: 750, chest: 660 });
  });

  it('Polo in 3D: Nähte zu, Kragen umgeschlagen (liegt unter der Halslinie), Leisten vorne, nichts im Körper', async () => {
    const { makeEditor } = await import('./helpers');
    const { defaultBlock } = await import('../../src/pattern/blocks');
    const { bodyForSize } = await import('../../src/pattern/body');
    const { generatePattern } = await import('../../src/store/patternOps');
    const { patternExchange } = await import('../../src/pattern/exchange');
    const { GarmentSim } = await import('../../src/sim3d/garment');
    const ed = await makeEditor();
    const body = bodyForSize('H-M');
    generatePattern(ed, body, 'H-M', defaultBlock('polo', body));
    const sim = new GarmentSim(patternExchange(ed.s.doc)!, { resolution: 24, substeps: 8 });
    const st = sim.run(10);
    expect(st.inside).toBe(0);
    expect(Math.max(...sim.seamGaps())).toBeLessThan(8);
    const mean = (name: string, c: number) => {
      const p = sim.parts.find((q) => q.piece.name === name)!;
      let s = 0;
      for (let i = 0; i < p.count; i++) s += sim.pos[3 * (p.offset + i) + c];
      return s / p.count;
    };
    // aufgestellt läge die Mitte ca. 100 mm über der Halslinie, umgeschlagen auf Höhe des Stegs
    expect(mean('Kragen', 1)).toBeLessThan(sim.mq.neckBaseY + 45);
    expect(mean('Knopfleiste oben', 2)).toBeGreaterThan(40);
    expect(mean('Knopfleiste oben', 2)).toBeGreaterThan(mean('Knopfleiste unten', 2));
  }, 90000);
});

describe('Streifenstoff (Ringel)', () => {
  it('Bänder, Farbe je Stelle und Text', async () => {
    const { stripeBands, stripeColorAt, stripeText } = await import('../../src/pattern/stripes');
    const m = { id: 'm', name: 'Oberstoff', fabric: 'jersey' as const, color: '#f3f2ec', gsm: 300, stripes: { stripe: '#234a35', width: 100, stripeWidth: 100, start: 35 } };
    expect(stripeBands(m.stripes, 0, 400)).toEqual([
      [35, 135],
      [235, 335],
    ]);
    expect(stripeBands(m.stripes, 100, 250)).toEqual([
      [100, 135],
      [235, 250],
    ]);
    expect(stripeColorAt(m, 10)).toBe('#f3f2ec');
    expect(stripeColorAt(m, 40)).toBe('#234a35');
    expect(stripeColorAt(m, -70)).toBe('#234a35');
    expect(stripeText(m)).toContain('#234A35 100 mm');
  });

  it('Polo: Streifen am Ärmel treffen an der Achsel auf die Seitennaht', async () => {
    const { makeEditor } = await import('./helpers');
    const { defaultBlock, generateBlock } = await import('../../src/pattern/blocks');
    const { bodyForSize } = await import('../../src/pattern/body');
    const { generatePattern } = await import('../../src/store/patternOps');
    const { patternExchange } = await import('../../src/pattern/exchange');
    const { stripeColorAt } = await import('../../src/pattern/stripes');
    const body = bodyForSize('H-M');
    const blk = { ...defaultBlock('polo', body, 'oversize', 'H-M'), spec: { len: 690, chest: 600 } };
    const r = generateBlock(body, blk);
    const front = r.pieces.find((p) => p.key === 'front')!;
    const sleeve = r.pieces.find((p) => p.key === 'sleeve')!;
    const m = { id: 'm', name: 'O', fabric: 'jersey' as const, color: '#ffffff', gsm: 300, stripes: { stripe: '#000000', width: 37, stripeWidth: 23, start: 11 } };
    // Abstand von der Oberkante: Körper 0 = Halspunkt, Ärmel 0 = Kugelhöhe; dazu der Versatz
    const dBody = -front.contour.nodes[2].y;
    const dSleeve = -sleeve.contour.nodes[2].y + (sleeve.stripeShift ?? 0);
    expect(dSleeve).toBeCloseTo(dBody, 6);
    for (const dd of [-30, -5, 0, 5, 30]) expect(stripeColorAt(m, dSleeve + dd)).toBe(stripeColorAt(m, dBody + dd));
    // im Projekt und im Austauschformat für 3D
    const ed = await makeEditor();
    generatePattern(ed, body, 'H-M', blk);
    const ex = patternExchange(ed.s.doc)!;
    expect(ex.pieces.find((p) => p.role === 'sleeve')!.stripeShift).toBeCloseTo(sleeve.stripeShift!, 0);
  });
});
