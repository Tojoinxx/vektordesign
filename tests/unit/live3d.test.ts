import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeEditor } from './helpers';
import { defaultBlock } from '../../src/pattern/blocks';
import { bodyForSize } from '../../src/pattern/body';
import { generatePattern } from '../../src/store/patternOps';
import { patternExchange, type PatternExchange } from '../../src/pattern/exchange';
import { GarmentSim } from '../../src/sim3d/garment';
import { buildHuman, parseHumanData, type HumanMesh } from '../../src/sim3d/human';
import { BONE_COUNT, buildRig, identityBones, isIdentity, poseBones, skinPositions, skinWeights } from '../../src/sim3d/rig';
import { SimRunner } from '../../src/sim3d/runner';
import type { FromWorker } from '../../src/sim3d/protocol';

let human: HumanMesh;
let ex: PatternExchange;
const body = bodyForSize('H-M');

beforeAll(async () => {
  const b = readFileSync('src/sim3d/avatar-data/makehuman.bin');
  human = buildHuman(parseHumanData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer), body, 'male', 0);
  const ed = await makeEditor();
  generatePattern(ed, body, 'H-M', defaultBlock('tshirt', body, 'regular', 'H-M'));
  ex = patternExchange(ed.s.doc)!;
});

const maxSeam = (sim: GarmentSim) => Math.max(...sim.seamGaps());
const finite = (sim: GarmentSim) => !sim.pos.some((v) => !Number.isFinite(v));

describe('Skelett der Puppe', () => {
  it('Ruhehaltung lässt die Haut unverändert; jede Bewegung beginnt weich aus dem Stand', () => {
    const rig = buildRig(human.joints, body);
    expect(rig.bones.length).toBe(BONE_COUNT);
    const skin = skinWeights(rig, human.positions);
    const out = new Float32Array(human.positions.length);
    skinPositions(skin, identityBones(), human.positions, out);
    for (let i = 0; i < out.length; i += 301) expect(out[i]).toBeCloseTo(human.positions[i], 3);
    const bones = new Float32Array(BONE_COUNT * 12);
    expect(isIdentity(poseBones(rig, 'walk', 1.3, bones, 'stand', 0))).toBe(true);
    expect(isIdentity(poseBones(rig, 'walk', 1.3, bones))).toBe(false);
  });

  it('Gehen: ein Fuß steht immer am Boden; Arme heben bringt die Hände über Schulterhöhe', () => {
    const rig = buildRig(human.joints, body);
    const bones = new Float32Array(BONE_COUNT * 12);
    const y = (b: number, p: number[]) => bones[12 * b + 4] * p[0] + bones[12 * b + 5] * p[1] + bones[12 * b + 6] * p[2] + bones[12 * b + 7];
    const ankle = (name: string) => [human.joints[name][0], rig.ankleY, human.joints[name][2]];
    let lifted = 0;
    for (let t = 0; t < 2.3; t += 0.05) {
      poseBones(rig, 'walk', t, bones);
      const l = y(8, ankle('l-ankle'));
      const r = y(10, ankle('r-ankle'));
      expect(Math.min(l, r)).toBeCloseTo(rig.ankleY, 1);
      lifted = Math.max(lifted, Math.max(l, r) - rig.ankleY);
    }
    expect(lifted).toBeGreaterThan(40);
    poseBones(rig, 'arms', 1.8, bones);
    expect(y(4, human.joints['l-hand'])).toBeGreaterThan(human.joints['l-shoulder'][1]);
    expect(y(6, human.joints['r-hand'])).toBeGreaterThan(human.joints['r-shoulder'][1]);
  });
});

describe('Live-Physik', () => {
  it('T-Shirt folgt der bewegten Puppe: nichts steckt im Körper, Nähte bleiben zu, danach wieder Ruhe', () => {
    const sim = new GarmentSim(ex, { resolution: 26, substeps: 8, human });
    sim.run();
    const rest = Float32Array.from(sim.pos);
    sim.setLive(true);
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.stats.live).toBe(true);
    expect(sim.stats.speed).toBeLessThan(8);
    for (const m of ['walk', 'turn', 'arms', 'hop'] as const) {
      sim.setMotion(m);
      let moved = 0;
      for (let i = 0; i < 150; i++) {
        sim.step();
        moved = Math.max(moved, sim.stats.speed);
        expect(sim.stats.inside).toBeLessThan(sim.n * 0.01);
      }
      expect(sim.posed).toBe(true);
      expect(moved).toBeGreaterThan(60);
      expect(finite(sim)).toBe(true);
      expect(maxSeam(sim)).toBeLessThan(8);
    }
    sim.setLive(false);
    let n = 0;
    while (!sim.stats.settled && n++ < 600) sim.step();
    expect(sim.stats.settled).toBe(true);
    expect(sim.posed).toBe(false);
    expect(sim.stats.live).toBeFalsy();
    expect(maxSeam(sim)).toBeLessThan(8);
    // der Halsausschnitt sitzt wieder, wo er vorher saß
    let top = 0;
    for (let i = 0; i < sim.n; i++) if (rest[3 * i + 1] > rest[3 * top + 1]) top = i;
    expect(Math.hypot(sim.pos[3 * top] - rest[3 * top], sim.pos[3 * top + 1] - rest[3 * top + 1], sim.pos[3 * top + 2] - rest[3 * top + 2])).toBeLessThan(40);
  }, 120000);

  it('Stoff anfassen: der Saum folgt dem Griff ein Stück, reißt nicht und fällt nach dem Loslassen zurück', () => {
    const sim = new GarmentSim(ex, { resolution: 26, substeps: 8, human });
    sim.run();
    sim.setLive(true);
    let hem = -1;
    for (let i = 0; i < sim.n; i++) if (Math.abs(sim.pos[3 * i]) < 60 && sim.pos[3 * i + 2] > 40 && (hem < 0 || sim.pos[3 * i + 1] < sim.pos[3 * hem + 1])) hem = i;
    const p0 = [sim.pos[3 * hem], sim.pos[3 * hem + 1], sim.pos[3 * hem + 2]];
    const dist = () => Math.hypot(sim.pos[3 * hem] - p0[0], sim.pos[3 * hem + 1] - p0[1], sim.pos[3 * hem + 2] - p0[2]);
    sim.grab(hem, p0[0], p0[1], p0[2]);
    expect(sim.grabbing).toBe(true);
    for (let i = 0; i < 60; i++) {
      sim.dragTo(p0[0], p0[1] + 2 * i, p0[2] + 15 * i);
      sim.step();
    }
    // gezogen wurde 900 mm weit – der Stoff kommt mit, aber nur so weit das Shirt es hergibt
    expect(dist()).toBeGreaterThan(60);
    expect(dist()).toBeLessThan(500);
    expect(finite(sim)).toBe(true);
    expect(maxSeam(sim)).toBeLessThan(10);
    sim.release();
    for (let i = 0; i < 150; i++) sim.step();
    expect(dist()).toBeLessThan(90);
    expect(sim.stats.inside).toBeLessThan(sim.n * 0.01);
  }, 120000);

  it('Wind schiebt den Stoff zur Seite; leichter Stoff weht stärker', () => {
    const drift = (gsm: number) => {
      const e2: PatternExchange = { ...ex, materials: ex.materials.map((m) => ({ ...m, gsm })) };
      const sim = new GarmentSim(e2, { resolution: 26, substeps: 8, human });
      sim.run();
      sim.setLive(true);
      let hem = 0;
      for (let i = 0; i < sim.n; i++) if (sim.pos[3 * i + 1] < sim.pos[3 * hem + 1]) hem = i;
      const x0 = sim.pos[3 * hem];
      sim.wind = 1;
      let max = 0;
      for (let i = 0; i < 150; i++) {
        sim.step();
        max = Math.max(max, sim.pos[3 * hem] - x0);
      }
      expect(finite(sim)).toBe(true);
      return max;
    };
    const light = drift(120);
    const heavy = drift(420);
    expect(light).toBeGreaterThan(8);
    expect(light).toBeGreaterThan(heavy);
  }, 120000);

  it('Treiber: Live-Bilder mit Haltung der Puppe, nach dem Ausschalten ein Ruhebild mit Passform-Daten', async () => {
    const msgs: FromWorker[] = [];
    const runner = new SimRunner((m) => msgs.push(m), 20);
    runner.handle({ type: 'live', on: true, motion: 'walk', wind: 0 });
    runner.start(1, ex, { resolution: 30, substeps: 8, human });
    const wait = async (ok: () => boolean, ms: number) => {
      const t0 = Date.now();
      while (!ok() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
      expect(ok()).toBe(true);
    };
    const frames = () => msgs.filter((m) => m.type === 'frame');
    await wait(() => frames().some((f) => f.stats.live && f.bones), 60000);
    const liveFrame = frames().find((f) => f.stats.live && f.bones)!;
    expect(liveFrame.bones!.length).toBe(BONE_COUNT * 12);
    expect(liveFrame.gap).toBeUndefined();
    runner.handle({ type: 'live', on: false, motion: 'stand', wind: 0 });
    await wait(() => {
      const f = frames();
      const last = f[f.length - 1];
      return !!last && last.stats.settled && !last.stats.live && !!last.gap;
    }, 60000);
    runner.stop();
  }, 150000);
});
