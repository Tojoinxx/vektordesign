import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeEditor } from './helpers';
import { BLOCK_KINDS, defaultBlock, generateBlock, isBottom, riseOf } from '../../src/pattern/blocks';
import { bodyForSize } from '../../src/pattern/body';
import { generatePattern } from '../../src/store/patternOps';
import { patternExchange } from '../../src/pattern/exchange';
import { checkSeams } from '../../src/pattern/geometry';
import { GarmentSim } from '../../src/sim3d/garment';
import { buildHuman, parseHumanData, type HumanData } from '../../src/sim3d/human';
import { blockPoms, gradedBlock, measureTable, pomsFor, specDeviations } from '../../src/techpack/measure';

let data: HumanData;
beforeAll(() => {
  const b = readFileSync('src/sim3d/avatar-data/makehuman.bin');
  data = parseHumanData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
});

const BOTTOMS = ['skirt', 'pleated', 'pants', 'shorts'] as const;

async function make(kind: (typeof BOTTOMS)[number], size: string) {
  const ed = await makeEditor();
  const body = bodyForSize(size);
  const blk = defaultBlock(kind, body, 'regular', size);
  generatePattern(ed, body, size, blk);
  return { ed, body, blk };
}

describe('Grundschnitte Rock und Hose', () => {
  it('Auswahl: vier Unterteile, jedes mit Bund; Hose mit gegengleichen Beinen und Beinbündchen', () => {
    expect(BLOCK_KINDS.filter((k) => isBottom(k.id)).map((k) => k.id)).toEqual([...BOTTOMS]);
    const body = bodyForSize('H-M');
    for (const kind of BOTTOMS) {
      const r = generateBlock(body, defaultBlock(kind, body));
      expect(r.pieces.some((p) => p.role === 'waistband')).toBe(true);
      // alle Teile gegen den Uhrzeigersinn (Vorzeichen der Fläche des Knotenpolygons)
      for (const p of r.pieces) {
        const nd = p.contour.nodes;
        let a = 0;
        for (let i = 0; i < nd.length; i++) a += nd[i].x * nd[(i + 1) % nd.length].y - nd[(i + 1) % nd.length].x * nd[i].y;
        expect(a, `${kind} ${p.name}`).toBeGreaterThan(0);
      }
    }
    const pants = generateBlock(body, defaultBlock('pants', body));
    expect(pants.pieces.filter((p) => p.cut === 2).map((p) => p.key)).toEqual(['legFront', 'legBack', 'legCuff']);
    expect(generateBlock(body, defaultBlock('shorts', body)).pieces.some((p) => p.role === 'legCuff')).toBe(false);
    expect(generateBlock(body, defaultBlock('pleated', body)).pieces.find((p) => p.key === 'skirtFront')!.pleats).toBeGreaterThan(4);
  });

  for (const size of ['H-M', 'D-S', 'H-XXL']) {
    it(`${size}: alle Nähte passen (Bund gedehnt, Falten eingelegt, Seiten- und Innenbeinnaht gleich lang)`, async () => {
      for (const kind of BOTTOMS) {
        const { ed } = await make(kind, size);
        const bad = checkSeams(ed.s.doc).filter((c) => !c.ok);
        expect(bad.map((c) => `${kind}: ${c.seam.name}: ${c.message}`)).toEqual([]);
      }
      const { ed } = await make('pleated', size);
      expect(checkSeams(ed.s.doc).some((c) => /Falten/.test(c.message))).toBe(true);
    });
  }

  it('Maßtabelle: Seitenlänge, Bundweite, Hüftweite, Leibhöhe; Fertigmaße legen den Schnitt fest und werden gestuft', async () => {
    const body = bodyForSize('H-M');
    const blk = defaultBlock('pants', body);
    const p = blockPoms(generateBlock(body, blk));
    expect(p.sideLen).toBeCloseTo(blk.length, 0);
    expect(p.rise).toBeCloseTo(riseOf(body), 0);
    expect(p.hip! * 2).toBeGreaterThan(body.hip + 60);
    expect(p.waist! * 2).toBeLessThan(body.waist);
    expect(pomsFor('pants').map((x) => x.id)).toEqual(['sideLen', 'waist', 'hip', 'rise', 'legOpening', 'waistbandH']);
    expect(pomsFor('skirt').map((x) => x.id)).toEqual(['hem', 'sideLen', 'waist', 'waistbandH']);
    const spec = { sideLen: 1010, waist: 400, hip: 560, rise: 260, legOpening: 120, waistbandH: 50 };
    const withSpec = { ...blk, spec };
    const got = blockPoms(generateBlock(body, withSpec));
    for (const [k, v] of Object.entries(spec)) expect(got[k], k).toBeCloseTo(v, 0);
    expect(specDeviations(body, withSpec)).toEqual([]);
    const xl = gradedBlock(withSpec, body, 'H-XL');
    expect(blockPoms(generateBlock(xl.body, xl.blk)).hip!).toBeGreaterThan(560 + 30);
    const { ed } = await make('shorts', 'H-M');
    const t = measureTable(ed.s.doc)!;
    expect(t.kind).toBe('graded');
    expect(t.rows.find((r) => r.pom.id === 'sideLen')!.values.every((v) => v != null && v > 300)).toBe(true);
  });
});

describe('Rock und Hose in 3D', () => {
  for (const [size, gender] of [
    ['H-M', 'male'],
    ['D-M', 'female'],
  ] as const) {
    it(`${gender}: sitzen an der Taille, Nähte zu, nichts im Körper – auch nach Gehen und Hüpfen`, async () => {
      for (const kind of BOTTOMS) {
        const { ed, body } = await make(kind, size);
        const human = buildHuman(data, body, gender, 0);
        const ex = patternExchange(ed.s.doc)!;
        const sim = new GarmentSim(ex, { resolution: 26, substeps: 8, human });
        sim.run();
        const top = () => {
          let y = -Infinity;
          for (let i = 0; i < sim.n; i++) y = Math.max(y, sim.pos[3 * i + 1]);
          return y;
        };
        const low = () => {
          let y = Infinity;
          for (let i = 0; i < sim.n; i++) y = Math.min(y, sim.pos[3 * i + 1]);
          return y;
        };
        const waistY = sim.mq.waistY;
        const label = `${kind} ${size}`;
        expect(sim.stats.settled, label).toBe(true);
        expect(sim.stats.inside, label).toBeLessThan(sim.n * 0.01);
        expect(Math.max(...sim.seamGaps()), label).toBeLessThan(kind === 'pleated' ? 10 : 8);
        // Bund an der Taille (höchstens 9 cm darunter, nicht darüber hinaus)
        expect(top(), label).toBeGreaterThan(waistY - 90);
        expect(top(), label).toBeLessThan(waistY + 60);
        // Hose reicht bis zum Knöchel, Rock und Shorts enden über dem Knie
        if (kind === 'pants') expect(low(), label).toBeLessThan(body.height * 0.1);
        else expect(low(), label).toBeGreaterThan(body.height * 0.28);
        const top0 = top();
        sim.setLive(true);
        for (const m of ['walk', 'hop'] as const) {
          sim.setMotion(m);
          for (let i = 0; i < 120; i++) {
            sim.step();
            expect(sim.stats.inside, label).toBeLessThan(sim.n * 0.02);
          }
        }
        sim.setLive(false);
        let n = 0;
        while (!sim.stats.settled && n++ < 600) sim.step();
        expect(sim.pos.some((v) => !Number.isFinite(v)), label).toBe(false);
        // nichts gerutscht: der Bund hält wie ein Gummizug
        expect(Math.abs(top() - top0), label).toBeLessThan(25);
        expect(Math.max(...sim.seamGaps()), label).toBeLessThan(kind === 'pleated' ? 10 : 8);
      }
    }, 240000);
  }

  it('Faltenrock schwingt beim Drehen weiter aus als im Stand', async () => {
    const { ed, body } = await make('pleated', 'D-M');
    const sim = new GarmentSim(patternExchange(ed.s.doc)!, { resolution: 26, substeps: 8, human: buildHuman(data, body, 'female', 0) });
    sim.run();
    const radius = () => {
      let r = 0;
      for (let i = 0; i < sim.n; i++) r = Math.max(r, Math.hypot(sim.pos[3 * i], sim.pos[3 * i + 2]));
      return r;
    };
    const r0 = radius();
    sim.setLive(true);
    sim.setMotion('turn');
    let r1 = 0;
    for (let i = 0; i < 260; i++) {
      sim.step();
      r1 = Math.max(r1, radius());
    }
    expect(r1).toBeGreaterThan(r0 + 15);
  }, 120000);
});
