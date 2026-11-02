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
      expect(st.seamGap).toBeLessThan(8);
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
    expect(st.seamGap).toBeLessThan(8);
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
});
