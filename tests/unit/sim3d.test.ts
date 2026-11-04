import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { defaultBlock } from '../../src/pattern/blocks';
import { bodyForSize } from '../../src/pattern/body';
import { addSeam, generatePattern, makePieces } from '../../src/store/patternOps';
import { patternExchange } from '../../src/pattern/exchange';
import { applyMaterial, applyPieceLook } from '../../src/pattern/edit';
import { GarmentSim } from '../../src/sim3d/garment';
import { bodyContact, buildMannequin, sectionAt, sectionPerimeter, sectionRadius as radiusAt } from '../../src/sim3d/body';
import { meshPiece } from '../../src/sim3d/mesh';
import { SimRunner } from '../../src/sim3d/runner';
import type { FromWorker } from '../../src/sim3d/protocol';
import { necklineCenter } from '../../src/viewer3d/viewer';

/** Nähte geschlossen: fast alle Nahtstellen liegen aufeinander, keine klafft mehr als `max` mm. */
function expectSeamsClosed(sim: GarmentSim, max = 8): void {
  const g = Array.from(sim.seamGaps()).sort((a, b) => a - b);
  expect(g[Math.floor(g.length * 0.97)]).toBeLessThan(4);
  expect(g[g.length - 1]).toBeLessThan(max);
}

async function garment(kind: 'tshirt' | 'hoodie' | 'sweatshirt', size = 'H-M') {
  const ed = await makeEditor();
  const body = bodyForSize(size);
  generatePattern(ed, body, size, defaultBlock(kind, body, 'regular', size));
  return { ed, ex: patternExchange(ed.s.doc)! };
}

describe('Puppe aus Körpermaßen', () => {
  for (const [size, gender] of [
    ['H-L', 'male'],
    ['D-M', 'female'],
  ] as const) {
    it(`${gender}: Brust-, Taillen- und Hüftumfang stimmen mit den Maßen überein`, () => {
      const b = bodyForSize(size);
      const mq = buildMannequin(b, gender);
      for (const [y, circ] of [
        [mq.chestY, b.chest],
        [mq.waistY, b.waist],
        [mq.hipY, b.hip],
      ] as const) {
        const s = sectionAt(mq, y)!;
        expect(Math.abs(sectionPerimeter(s) - circ)).toBeLessThan(circ * 0.01);
      }
    });
  }

  it('Weibliche Puppe hat eine Büste: vorne auf Brusthöhe tiefer als in der Mitte', () => {
    const mq = buildMannequin(bodyForSize('D-M'), 'female');
    const s = sectionAt(mq, mq.chestY)!;
    expect(radiusAt(s, 0.6)).toBeGreaterThan(radiusAt(s, 0) + 5);
  });

  it('Kollision: Punkt im Rumpf liegt innen, Normale zeigt nach außen', () => {
    const mq = buildMannequin(bodyForSize('H-M'));
    const c = bodyContact(mq, 0, mq.chestY, 50, 1000)!;
    expect(c.d).toBeLessThan(0);
    expect(c.nz).toBeGreaterThan(0.8);
    const out = bodyContact(mq, 0, mq.chestY, 400, 1000)!;
    expect(out.d).toBeGreaterThan(0);
  });
});

describe('Vernetzung', () => {
  it('Kanten beginnen und enden an den Ecken, alle Dreiecke gegen den Uhrzeigersinn', async () => {
    const { ex } = await garment('tshirt');
    for (const p of ex.pieces) {
      const m = meshPiece(p, 20);
      const n = m.edgeVerts.length;
      for (let e = 0; e < n; e++) {
        const next = m.edgeVerts[(e + 1) % n];
        expect(m.edgeVerts[e][m.edgeVerts[e].length - 1]).toBe(next[0]);
        expect(m.edgeT[e][0]).toBe(0);
        expect(m.edgeT[e][m.edgeT[e].length - 1]).toBe(1);
      }
      for (let t = 0; t < m.tris.length; t += 3) {
        const [a, b, c] = [m.tris[t], m.tris[t + 1], m.tris[t + 2]];
        const cross = (m.uv[2 * b] - m.uv[2 * a]) * (m.uv[2 * c + 1] - m.uv[2 * a + 1]) - (m.uv[2 * c] - m.uv[2 * a]) * (m.uv[2 * b + 1] - m.uv[2 * a + 1]);
        expect(cross).toBeGreaterThan(0);
      }
    }
  });
});

describe('Stoffsimulation', () => {
  for (const kind of ['tshirt', 'hoodie'] as const) {
    it(`${kind}: kommt zur Ruhe, Nähte geschlossen, nichts steckt im Körper`, async () => {
      const { ex } = await garment(kind);
      const sim = new GarmentSim(ex, { resolution: 26, substeps: 8 });
      const st = sim.run(8);
      expect(st.settled).toBe(true);
      expectSeamsClosed(sim);
      expect(st.inside).toBe(0);
      // Kleidungsstück hängt auf den Schultern, nicht am Boden
      let minY = Infinity;
      for (let i = 0; i < sim.n; i++) minY = Math.min(minY, sim.pos[3 * i + 1]);
      expect(minY).toBeGreaterThan(sim.mq.crotchY - 250);
      // Vorderteil liegt vorne
      const front = sim.parts.find((p) => p.piece.role === 'front')!;
      let z = 0;
      for (let i = 0; i < front.count; i++) z += sim.pos[3 * (front.offset + i) + 2];
      expect(z / front.count).toBeGreaterThan(30);
    }, 60000);
  }

  it('Zwei Vierecke, an einer Kante verbunden: hängen wie auf einer Stange, Naht schließt sich', async () => {
    const ed = await makeEditor();
    const a = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 200, y: 300 } }, 'corner');
    const b = ed.createRectangle({ pos: { x: 300, y: 0 } }, { pos: { x: 500, y: 300 } }, 'corner');
    const [pa, pb] = makePieces(ed, [a.pathId!, b.pathId!]).pieceIds!;
    const doc = ed.s.doc;
    const { nearestEdge } = await import('../../src/pattern/geometry');
    const ea = nearestEdge(doc, { x: 200, y: 150 }, 3)!;
    const eb = nearestEdge(doc, { x: 300, y: 150 }, 3)!;
    expect(addSeam(ed, { piece: pa, edge: ea.edge }, { piece: pb, edge: eb.edge }).ok).toBe(true);
    const sim = new GarmentSim(patternExchange(ed.s.doc)!, { resolution: 25, substeps: 8 });
    const st = sim.run(8);
    expect(st.seamGap).toBeLessThan(6);
    let minY = Infinity;
    for (let i = 0; i < sim.n; i++) minY = Math.min(minY, sim.pos[3 * i + 1]);
    expect(minY).toBeGreaterThan(500);
  }, 60000);

  it('Simulation im Worker-Treiber: Aufteilung, Bildschritte und Endergebnis mit Passform-Daten', async () => {
    const { ex } = await garment('tshirt');
    const msgs: FromWorker[] = [];
    const r = new SimRunner((m) => msgs.push(m), 1e9);
    r.start(7, ex, { resolution: 30, substeps: 6 });
    const layout = msgs.find((m) => m.type === 'layout');
    expect(layout && layout.type === 'layout' && layout.parts.length).toBe(5);
    const last = msgs[msgs.length - 1];
    expect(last.type === 'frame' && last.stats.settled && !!last.strain && !!last.gap).toBe(true);
  }, 60000);
});

describe('Realistische Puppe (MakeHuman)', () => {
  const load = async () => {
    const { readFileSync } = await import('node:fs');
    const { parseHumanData } = await import('../../src/sim3d/human');
    const b = readFileSync('src/sim3d/avatar-data/makehuman.bin');
    return parseHumanData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  };

  it('Körpergröße stimmt, Arme auf Maß, kräftiger Körperbau hat mehr Volumen', async () => {
    const { buildHuman } = await import('../../src/sim3d/human');
    const data = await load();
    const body = bodyForSize('D-M');
    const h = buildHuman(data, body, 'female', 0);
    let maxY = 0;
    for (let j = 0; j < h.body.length; j++) maxY = Math.max(maxY, h.positions[3 * h.body[j] + 1]);
    expect(maxY).toBeCloseTo(body.height, -1);
    const sh = h.joints['l-shoulder'];
    const el = h.joints['l-elbow'];
    const wr = h.joints['l-hand'];
    const chain = Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]) + Math.hypot(wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]);
    expect(Math.abs(chain - body.arm * 0.95)).toBeLessThan(25);
    const vol = (hm: typeof h) => {
      let v = 0;
      const p = hm.positions;
      for (let t = 0; t < hm.body.length; t += 3) {
        const a = 3 * hm.body[t];
        const b = 3 * hm.body[t + 1];
        const c = 3 * hm.body[t + 2];
        v += (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) / 6;
      }
      return v;
    };
    const { avatarBody } = await import('../../src/sim3d/avatar');
    const heavy = avatarBody({ gender: 'female', base: 'D-M', height: body.height, build: 1 });
    expect(vol(buildHuman(data, heavy, 'female', 1))).toBeGreaterThan(vol(h) * 1.08);
  });

  it('Hoodie auf der realistischen Puppe: Nähte zu, nichts im Körper', async () => {
    const { buildHuman } = await import('../../src/sim3d/human');
    const data = await load();
    const { ex } = await garment('hoodie');
    const human = buildHuman(data, ex.body, ex.gender, 0);
    const sim = new GarmentSim(ex, { resolution: 26, substeps: 8, human });
    expect(sim.mq.sdf).toBeTruthy();
    const st = sim.run(8);
    expectSeamsClosed(sim);
    expect(st.inside).toBe(0);
  }, 60000);
});

describe('Stoff stößt an sich selbst', () => {
  /** Kleinster Abstand zwischen Stellen des Stoffs, die im Netz nicht benachbart sind. */
  const clearance = (sim: GarmentSim) => {
    let min = Infinity;
    const p = sim.pos;
    for (let i = 0; i < sim.n; i++)
      for (let j = i + 1; j < sim.n; j++) {
        const d = Math.hypot(p[3 * i] - p[3 * j], p[3 * i + 1] - p[3 * j + 1], p[3 * i + 2] - p[3 * j + 2]);
        if (d < min && !sim.meshNeighbors(i, j)) min = d;
      }
    return min;
  };

  it('Lagen halten Stoffdicke Abstand; Kapuze liegt abgelegt auf dem Rücken, aufgesetzt auf dem Kopf', async () => {
    const res: Record<string, { clear: number; hoodY: number; hoodZ: number; neck: number }> = {};
    for (const [name, hood, self] of [
      ['ohne', 'down', false],
      ['ab', 'down', true],
      ['auf', 'up', true],
    ] as const) {
      const { ex } = await garment('hoodie');
      const sim = new GarmentSim(ex, { resolution: 26, substeps: 8, hood, selfCollision: self });
      const st = sim.run(10);
      expect(st.inside).toBe(0);
      let y = 0;
      let z = 0;
      let n = 0;
      for (const h of sim.parts.filter((q) => q.piece.role === 'hood'))
        for (let i = 0; i < h.count; i++) {
          y += sim.pos[3 * (h.offset + i) + 1];
          z += sim.pos[3 * (h.offset + i) + 2];
          n++;
        }
      res[name] = { clear: clearance(sim), hoodY: y / n, hoodZ: z / n, neck: sim.mq.neckBaseY };
    }
    // mit Eigenkollision: mindestens doppelte Stoffdicke zwischen den Lagen, ohne deutlich weniger
    expect(res.ab.clear).toBeGreaterThan(6);
    expect(res.ab.clear).toBeGreaterThan(res.ohne.clear + 2);
    // aufgesetzt: Kapuze am Kopf; abgelegt: deutlich tiefer und hinter dem Hals
    expect(res.auf.hoodY).toBeGreaterThan(res.auf.neck + 100);
    expect(res.ab.hoodY).toBeLessThan(res.auf.hoodY - 80);
    expect(res.ab.hoodZ).toBeLessThan(res.auf.hoodZ - 40);
  }, 180000);
});

describe('Stoffgewicht', () => {
  it('Leichter Jersey fällt weicher und tiefer, schwerer Sweat steht steifer ab', async () => {
    const { updateMaterial } = await import('../../src/store/patternOps');
    const result: Record<string, { hem: number; gap: number }> = {};
    for (const [name, fabric, gsm] of [
      ['leicht', 'jersey', 140],
      ['schwer', 'sweat', 480],
    ] as const) {
      const { ed } = await garment('hoodie');
      updateMaterial(ed, 'm-main', { fabric, gsm });
      const sim = new GarmentSim(patternExchange(ed.s.doc)!, { resolution: 26, substeps: 8 });
      const st = sim.run(8);
      expect(st.inside).toBe(0);
      const front = sim.parts.find((p) => p.piece.role === 'front')!;
      let hem = Infinity;
      let gap = 0;
      for (let i = 0; i < front.count; i++) {
        hem = Math.min(hem, sim.pos[3 * (front.offset + i) + 1]);
        gap += sim.gap[front.offset + i];
      }
      result[name] = { hem, gap: gap / front.count };
    }
    expect(result.leicht.hem).toBeLessThan(result.schwer.hem - 3);
    expect(result.schwer.gap).toBeGreaterThan(result.leicht.gap);
  }, 90000);
});

describe('Puppe zum Anprobieren', () => {
  it('Regler: größer und kräftiger ergibt längere Maße und größere Umfänge', async () => {
    const { avatarBody, defaultAvatar } = await import('../../src/sim3d/avatar');
    const base = avatarBody(defaultAvatar('male'));
    const big = avatarBody({ ...defaultAvatar('male'), height: 1950, build: 1 });
    expect(big.backLength).toBeGreaterThan(base.backLength);
    expect(big.waist).toBeGreaterThan(base.waist * 1.2);
    expect(big.height).toBe(1950);
  });

  it('Weibliche, schlanke Puppe trägt einen Hoodie Herren M: Nähte zu, nichts im Körper', async () => {
    const { ed } = await garment('hoodie');
    const { applyAvatar } = await import('../../src/pattern/edit');
    const d = applyAvatar(ed.s.doc, { gender: 'female', base: 'D-S', height: 1620, build: -0.6 });
    const ex = patternExchange(d)!;
    expect(ex.gender).toBe('female');
    const sim = new GarmentSim(ex, { resolution: 26, substeps: 8 });
    const st = sim.run(8);
    expectSeamsClosed(sim);
    expect(st.inside).toBe(0);
  }, 60000);
});

describe('Aussehen aus der 3D-Ansicht', () => {
  it('Teil einfärben und Stoffart ändern, ohne den Schnitt zu verändern', async () => {
    const { ed } = await garment('hoodie');
    const doc = ed.s.doc;
    const hood = doc.pattern!.pieces.find((p) => p.role === 'hood')!;
    const d2 = applyPieceLook(doc, hood.id, { color: '#c8102e' });
    expect(d2.pattern!.pieces.find((p) => p.id === hood.id)!.color).toBe('#c8102e');
    expect(d2.entities[hood.outline].style.fill).toBe('#c8102e');
    const d3 = applyPieceLook(d2, hood.id, { color: null });
    expect(d3.pattern!.pieces.find((p) => p.id === hood.id)!.color).toBeUndefined();
    const d4 = applyMaterial(d3, 'm-main', { fabric: 'fleece', color: '#222222' });
    expect(d4.pattern!.materials.find((m) => m.id === 'm-main')!.fabric).toBe('fleece');
    expect(d4.entities[hood.outline].style.fill).toBe('#222222');
    expect(patternExchange(d4)!.pieces.find((p) => p.id === hood.id)!.polygon).toEqual(patternExchange(doc)!.pieces.find((p) => p.id === hood.id)!.polygon);
  });

  it('Bezugspunkt Kragennaht Mitte liegt am Halsausschnitt', async () => {
    const { ex } = await garment('tshirt');
    const front = ex.pieces.find((p) => p.role === 'front')!;
    const xs = front.polygon.map((p) => p[0]);
    const ys = front.polygon.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const ref = necklineCenter(front.polygon, cx)!;
    // Halsausschnitt vorne ca. Hals/6 + 30 mm unter dem Halspunkt
    expect(Math.max(...ys) - ref.y).toBeGreaterThan(60);
    expect(Math.max(...ys) - ref.y).toBeLessThan(120);
  });

  it('Polo: Bezugspunkt ist die Kragennaht neben der Knopfleiste, nicht das Schlitzende', async () => {
    const { makeEditor } = await import('./helpers');
    const { generatePattern } = await import('../../src/store/patternOps');
    const ed = await makeEditor();
    const body = bodyForSize('H-M');
    generatePattern(ed, body, 'H-M', defaultBlock('polo', body));
    const front = patternExchange(ed.s.doc)!.pieces.find((p) => p.role === 'front')!;
    const xs = front.polygon.map((p) => p[0]);
    const ys = front.polygon.map((p) => p[1]);
    const ref = necklineCenter(front.polygon, (Math.min(...xs) + Math.max(...xs)) / 2)!;
    // Kragennaht vorne ca. 6–12 cm unter dem Halspunkt (Schlitzende läge über 20 cm tiefer)
    expect(Math.max(...ys) - ref.y).toBeGreaterThan(60);
    expect(Math.max(...ys) - ref.y).toBeLessThan(130);
  });
});
