import type { BodyMeasures } from '../model/types';
import { buildMannequin, type Gender, type Mannequin } from './body';

/**
 * Realistische Puppe aus dem MakeHuman-Grundnetz (CC0): Geschlecht, Gewicht und Muskeln über die
 * Original-Ziele (Targets) gemischt, auf die Körpergröße skaliert und am Rumpf auf die gemessenen Umfänge
 * (Brust, Taille, Hüfte) eingepasst. Für die Stoffsimulation wird daraus ein Abstandsfeld (SDF) gerechnet,
 * damit der Stoff exakt auf dieser Oberfläche liegt.
 */

export interface HumanData {
  count: number;
  base: Float32Array;
  body: Uint16Array;
  eyes: Uint16Array;
  joints: Record<string, number[]>;
  targets: Map<string, { idx: Uint16Array; d: Int16Array }>;
  q: number;
}

export function parseHumanData(buf: ArrayBuffer): HumanData {
  const dv = new DataView(buf);
  const n = dv.getUint32(0, true);
  const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, n))) as {
    count: number;
    q: number;
    joints: Record<string, number[]>;
    targets: { name: string }[];
    blocks: { name: string; type: string; offset: number; length: number }[];
  };
  const head = Math.ceil((n + 4) / 4) * 4;
  const get = <T>(name: string): T => {
    const b = meta.blocks.find((x) => x.name === name)!;
    const C = b.type === 'Float32Array' ? Float32Array : b.type === 'Int16Array' ? Int16Array : Uint16Array;
    return new C(buf.slice(head + b.offset, head + b.offset + b.length * C.BYTES_PER_ELEMENT)) as T;
  };
  const targets = new Map<string, { idx: Uint16Array; d: Int16Array }>();
  for (const t of meta.targets) targets.set(t.name, { idx: get<Uint16Array>(`${t.name}:i`), d: get<Int16Array>(`${t.name}:d`) });
  return { count: meta.count, base: get<Float32Array>('base'), body: get<Uint16Array>('body'), eyes: get<Uint16Array>('eyes'), joints: meta.joints, targets, q: meta.q };
}

export interface HumanMesh {
  /** alle Punkte (Körper, Augen, Gelenke), mm, Boden y = 0 */
  positions: Float32Array;
  body: Uint16Array;
  eyes: Uint16Array;
  joints: Record<string, [number, number, number]>;
}

/** Gewichte der Ziele: Geschlecht, Gewicht (−1 … +1) und Muskeln (0 … 1, 0,5 = normal). */
function targetWeights(gender: Gender, build: number, muscle: number): [string, number][] {
  const s = gender === 'female' ? 'female' : 'male';
  const w = Math.min(1, Math.max(0, 0.5 + 0.5 * build));
  const wW: [string, number][] =
    w < 0.5
      ? [
          ['min', (0.5 - w) * 2],
          ['average', 1 - (0.5 - w) * 2],
        ]
      : [
          ['average', 1 - (w - 0.5) * 2],
          ['max', (w - 0.5) * 2],
        ];
  const m = Math.min(1, Math.max(0.5, muscle));
  const mW: [string, number][] = [
    ['average', 1 - (m - 0.5) * 2],
    ['max', (m - 0.5) * 2],
  ];
  const out: [string, number][] = [[`caucasian-${s}-young`, 1]];
  for (const [mk, mv] of mW) for (const [wk, wv] of wW) if (mv * wv > 1e-4) out.push([`universal-${s}-young-${mk}muscle-${wk}weight`, mv * wv]);
  return out;
}

function centroid(p: Float32Array, idx: number[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const i of idx) {
    x += p[3 * i];
    y += p[3 * i + 1];
    z += p[3 * i + 2];
  }
  return [x / idx.length, y / idx.length, z / idx.length];
}

/** Umfang (konvexe Hülle) der Punkte einer waagrechten Scheibe. */
function hullPerimeter(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  const h = lo.slice(0, -1).concat(up.slice(0, -1));
  let L = 0;
  for (let i = 0; i < h.length; i++) L += Math.hypot(h[(i + 1) % h.length][0] - h[i][0], h[(i + 1) % h.length][1] - h[i][1]);
  return L;
}

/** Abstand eines Punkts zur Strecke a–b. */
function segDist(px: number, py: number, pz: number, a: number[], b: number[]): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const ez = b[2] - a[2];
  let t = ((px - a[0]) * ex + (py - a[1]) * ey + (pz - a[2]) * ez) / (ex * ex + ey * ey + ez * ez);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - a[0] - ex * t, py - a[1] - ey * t, pz - a[2] - ez * t);
}

export function buildHuman(data: HumanData, m: BodyMeasures, gender: Gender, build = 0): HumanMesh {
  const n = data.count;
  const p = Float32Array.from(data.base);
  // 1. Ziele mischen
  for (const [name, w] of targetWeights(gender, build, gender === 'male' ? 0.6 : 0.5)) {
    const t = data.targets.get(name);
    if (!t) continue;
    const k = w * data.q;
    for (let j = 0; j < t.idx.length; j++) {
      const i = t.idx[j];
      p[3 * i] += t.d[3 * j] * k;
      p[3 * i + 1] += t.d[3 * j + 1] * k;
      p[3 * i + 2] += t.d[3 * j + 2] * k;
    }
  }
  // 2. Auf den Boden stellen und auf die Körpergröße skalieren
  let minY = Infinity;
  let maxY = -Infinity;
  for (let j = 0; j < data.body.length; j++) {
    const y = p[3 * data.body[j] + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const s = m.height / (maxY - minY);
  for (let i = 0; i < n; i++) {
    p[3 * i] *= s;
    p[3 * i + 1] = (p[3 * i + 1] - minY) * s;
    p[3 * i + 2] *= s;
  }
  // 3. Rumpf auf Brust-, Taillen- und Hüftumfang einpassen
  const J = (name: string) => centroid(p, data.joints[name]);
  const neck = J('neck');
  const lSh = J('l-shoulder');
  const rSh = J('r-shoulder');
  const lHand = J('l-hand');
  const rHand = J('r-hand');
  const lElbow = J('l-elbow');
  const rElbow = J('r-elbow');
  const lLeg = J('l-upper-leg');
  const armR = (m.upperArm / (2 * Math.PI)) * 1.35;
  const isBodyVert = new Uint8Array(n);
  for (let j = 0; j < data.body.length; j++) isBodyVert[data.body[j]] = 1;
  // Arm-Kette: Schulter → Ellbogen → Handgelenk → Fingerspitzen (verlängert)
  const tip = (h: number[], e: number[]) => [h[0] + (h[0] - e[0]) * 0.75, h[1] + (h[1] - e[1]) * 0.75, h[2] + (h[2] - e[2]) * 0.75];
  const lTip = tip(lHand, lElbow);
  const rTip = tip(rHand, rElbow);
  const armWeight = (x: number, y: number, z: number) => {
    if (Math.abs(x) < Math.abs(lSh[0]) * 0.55) return 0;
    const L = x > 0;
    const sh = L ? lSh : rSh;
    const el = L ? lElbow : rElbow;
    const ha = L ? lHand : rHand;
    // Hand und Finger komplett zum Arm
    if (segDist(x, y, z, ha, L ? lTip : rTip) < armR * 2.2 || Math.hypot(x - ha[0], y - ha[1], z - ha[2]) < armR * 2.2) return 1;
    const d = Math.min(segDist(x, y, z, sh, el), segDist(x, y, z, el, ha));
    const t = (armR * 1.6 - d) / (armR * 0.6);
    return Math.max(0, Math.min(1, t));
  };
  const neckBaseY = neck[1] - 15;
  const waistY = neckBaseY - m.backLength;
  const chestY = neckBaseY - m.backLength * (gender === 'female' ? 0.52 : 0.5);
  const hipY = waistY - m.height * (gender === 'female' ? 0.11 : 0.105);
  const crotchY = lLeg[1] - 45;
  const slice = (y: number) => {
    const pts: [number, number][] = [];
    let cz = 0;
    for (let i = 0; i < n; i++) {
      if (!isBodyVert[i] || Math.abs(p[3 * i + 1] - y) > 9) continue;
      if (armWeight(p[3 * i], p[3 * i + 1], p[3 * i + 2]) > 0.2) continue;
      pts.push([p[3 * i], p[3 * i + 2]]);
      cz += p[3 * i + 2];
    }
    return { per: hullPerimeter(pts), cz: pts.length ? cz / pts.length : 0 };
  };
  const levels = [
    { y: hipY, target: m.hip },
    { y: waistY, target: m.waist },
    { y: chestY, target: m.chest },
  ].map((l) => {
    const sl = slice(l.y);
    return { ...l, r: sl.per > 0 ? Math.min(1.5, Math.max(0.7, l.target / sl.per)) : 1, cz: sl.cz };
  });
  // Knoten der Skalierungskurve über die Höhe (oben und unten auf 1 auslaufend)
  const knots = [
    { y: crotchY - 160, r: 1 + (levels[0].r - 1) * 0.35, cz: levels[0].cz },
    ...levels.map((l) => ({ y: l.y, r: l.r, cz: l.cz })),
    { y: (chestY + neckBaseY) / 2 + 20, r: 1 + (levels[2].r - 1) * 0.55, cz: levels[2].cz },
    { y: neckBaseY + 10, r: 1, cz: neck[2] },
  ].sort((a, b) => a.y - b.y);
  const at = (y: number) => {
    if (y <= knots[0].y) return { r: 1, cz: knots[0].cz, fade: Math.max(0, 1 - (knots[0].y - y) / 200) };
    if (y >= knots[knots.length - 1].y) return { r: 1, cz: knots[knots.length - 1].cz, fade: 1 };
    let k = 0;
    while (y > knots[k + 1].y) k++;
    const a = knots[k];
    const b = knots[k + 1];
    const t0 = (y - a.y) / (b.y - a.y);
    const t = t0 * t0 * (3 - 2 * t0);
    return { r: a.r + (b.r - a.r) * t, cz: a.cz + (b.cz - a.cz) * t, fade: 1 };
  };
  // Arme werden mit der Rumpfbreite auf Achselhöhe verschoben, nicht skaliert
  const chestHalf = Math.abs(lSh[0]) * 0.8;
  const armShift = (at(chestY).r - 1) * chestHalf;
  for (let i = 0; i < n; i++) {
    const x = p[3 * i];
    const y = p[3 * i + 1];
    const z = p[3 * i + 2];
    const f = at(y);
    const r = 1 + (f.r - 1) * f.fade;
    const aw = armWeight(x, y, z);
    const tx = x * r;
    const tz = f.cz + (z - f.cz) * r;
    const ax = x + Math.sign(x) * armShift;
    p[3 * i] = tx * (1 - aw) + ax * aw;
    p[3 * i + 2] = tz * (1 - aw) + z * aw;
  }
  // 4. Armlänge auf das Maß bringen: Arm-Punkte entlang der Armachse verschieben (Dicke bleibt)
  for (const side of [1, -1]) {
    const sh = centroid(p, data.joints[side > 0 ? 'l-shoulder' : 'r-shoulder']);
    const el = centroid(p, data.joints[side > 0 ? 'l-elbow' : 'r-elbow']);
    const wr = centroid(p, data.joints[side > 0 ? 'l-hand' : 'r-hand']);
    const chain = Math.hypot(el[0] - sh[0], el[1] - sh[1], el[2] - sh[2]) + Math.hypot(wr[0] - el[0], wr[1] - el[1], wr[2] - el[2]);
    const f = Math.min(1.35, Math.max(0.85, (m.arm * 0.95) / chain));
    if (Math.abs(f - 1) < 0.01) continue;
    const ax = wr[0] - sh[0];
    const ay = wr[1] - sh[1];
    const az = wr[2] - sh[2];
    const L2 = ax * ax + ay * ay + az * az;
    for (let i = 0; i < n; i++) {
      const x = p[3 * i];
      if (Math.sign(x) !== side) continue;
      const y = p[3 * i + 1];
      const z = p[3 * i + 2];
      const w = armWeight(x, y, z);
      if (w <= 0) continue;
      const t = Math.max(0, Math.min(1.4, ((x - sh[0]) * ax + (y - sh[1]) * ay + (z - sh[2]) * az) / L2));
      const k = (f - 1) * t * w;
      p[3 * i] += ax * k;
      p[3 * i + 1] += ay * k;
      p[3 * i + 2] += az * k;
    }
  }
  const joints: Record<string, [number, number, number]> = {};
  for (const k of Object.keys(data.joints)) joints[k] = centroid(p, data.joints[k]);
  return { positions: p, body: data.body, eyes: data.eyes, joints };
}

/**
 * Landmarken der Puppe (für die Anordnung der Schnittteile) aus dem Menschen-Netz; die Querschnitte des
 * einfachen Modells bleiben als Grundlage für Platzierung und Rückfall erhalten.
 */
export function humanMannequin(m: BodyMeasures, gender: Gender, h: HumanMesh): Mannequin {
  const mq = buildMannequin(m, gender);
  const sh = h.joints['l-shoulder'];
  const hand = h.joints['l-hand'];
  const dx = hand[0] - sh[0];
  const dy = hand[1] - sh[1];
  const dz = hand[2] - sh[2];
  const L = Math.hypot(dx, dy, dz);
  mq.shoulderJoint = [sh[0], sh[1], sh[2]];
  mq.armDir = [dx / L, dy / L, dz / L];
  mq.armAngle = Math.acos(Math.max(-1, Math.min(1, -dy / L)));
  mq.neckBaseY = h.joints.neck[1] - 15;
  mq.crotchY = h.joints['l-upper-leg'][1] - 45;
  // größter Rumpfradius aus dem Netz (ohne Arme)
  let maxR = 0;
  const p = h.positions;
  for (let j = 0; j < h.body.length; j++) {
    const i = h.body[j];
    const y = p[3 * i + 1];
    if (y < mq.crotchY || y > mq.neckBaseY) continue;
    const x = p[3 * i];
    if (Math.abs(x) > Math.abs(sh[0]) * 0.95) continue;
    maxR = Math.max(maxR, Math.hypot(x, p[3 * i + 2]));
  }
  mq.maxR = Math.max(maxR, 100);
  return mq;
}
