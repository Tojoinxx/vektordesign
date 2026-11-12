import type { BodyMeasures } from '../model/types';

/**
 * Einfaches Skelett für die realistische Puppe: elf Knochen aus den Gelenken des Menschen-Netzes, Bewegungen
 * (Gehen, Drehen, Arme heben, Hüpfen) als Winkelkurven und die Zuordnung von Punkten zu Knochen über den Abstand
 * zur Knochenachse. Dieselbe Zuordnung bewegt die Haut der Puppe (Darstellung) und rechnet Stoffpartikel in die
 * Ruhehaltung zurück (Kollision gegen das Abstandsfeld der stehenden Puppe).
 *
 * Reines TypeScript ohne DOM. Matrizen: 3 × 4, zeilenweise, je Knochen 12 Werte (Ruhehaltung → Haltung).
 */

export type Motion = 'stand' | 'walk' | 'turn' | 'arms' | 'hop';

export const MOTIONS: { id: Motion; name: string }[] = [
  { id: 'stand', name: 'Stehen' },
  { id: 'walk', name: 'Gehen' },
  { id: 'turn', name: 'Drehen' },
  { id: 'arms', name: 'Arme heben' },
  { id: 'hop', name: 'Hüpfen' },
];

type V3 = [number, number, number];

export interface Bone {
  name: string;
  parent: number;
  /** Drehpunkt = Anfang der Knochenachse (Ruhehaltung) */
  a: V3;
  b: V3;
  /** ungefährer Radius des Körperteils (mm) – für die Zuordnung von Punkten */
  r: number;
}

export interface Rig {
  bones: Bone[];
  /** Höhe der Knöchel in Ruhe (für den Bodenkontakt) */
  ankleY: number;
}

const B = { hips: 0, chest: 1, head: 2, lArm: 3, lFore: 4, rArm: 5, rFore: 6, lThigh: 7, lShin: 8, rThigh: 9, rShin: 10 } as const;
export const BONE_COUNT = 11;

export function buildRig(joints: Record<string, [number, number, number]>, m: BodyMeasures): Rig {
  const J = (n: string): V3 => [...joints[n]] as V3;
  const mid = (p: V3, q: V3): V3 => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
  const ext = (p: V3, q: V3, k: number): V3 => [q[0] + (q[0] - p[0]) * k, q[1] + (q[1] - p[1]) * k, q[2] + (q[2] - p[2]) * k];
  const crotch = mid(J('l-upper-leg'), J('r-upper-leg'));
  const waist = J('spine-2');
  const neck = J('neck');
  const head = J('head');
  const torsoR = Math.max(m.chest, m.hip) / (2 * Math.PI);
  const armR = (m.upperArm / (2 * Math.PI)) * 1.15;
  const thighR = (m.hip / (2 * Math.PI)) * 0.58;
  const bones: Bone[] = [
    { name: 'hips', parent: -1, a: crotch, b: waist, r: torsoR },
    { name: 'chest', parent: B.hips, a: waist, b: neck, r: torsoR },
    { name: 'head', parent: B.chest, a: neck, b: ext(neck, head, 1), r: m.head / (2 * Math.PI) },
  ];
  for (const s of ['l', 'r'] as const) {
    const sh = J(`${s}-shoulder`);
    const el = J(`${s}-elbow`);
    const ha = J(`${s}-hand`);
    bones.push({ name: `${s}-arm`, parent: B.chest, a: sh, b: el, r: armR });
    bones.push({ name: `${s}-forearm`, parent: bones.length - 1, a: el, b: ext(el, ha, 0.75), r: armR * 0.8 });
  }
  for (const s of ['l', 'r'] as const) {
    const hip = J(`${s}-upper-leg`);
    const knee = J(`${s}-knee`);
    const ankle = J(`${s}-ankle`);
    bones.push({ name: `${s}-thigh`, parent: B.hips, a: hip, b: knee, r: thighR });
    bones.push({ name: `${s}-shin`, parent: bones.length - 1, a: knee, b: [ankle[0], 0, ankle[2]], r: thighR * 0.62 });
  }
  return { bones, ankleY: joints['l-ankle'][1] };
}

// ---------------------------------------------------------------------------
// Haltung
// ---------------------------------------------------------------------------

/** Gelenkwinkel einer Haltung (rad) und Lage des Beckens (mm). */
interface Angles {
  yaw: number;
  dy: number;
  chestYaw: number;
  /** Arm seitlich heben (+ = höher) */
  lAbd: number;
  rAbd: number;
  /** Arm nach vorne schwingen */
  lSwing: number;
  rSwing: number;
  lElbow: number;
  rElbow: number;
  /** Oberschenkel nach vorne */
  lHip: number;
  rHip: number;
  lKnee: number;
  rKnee: number;
}

const ZERO: Angles = { yaw: 0, dy: 0, chestYaw: 0, lAbd: 0, rAbd: 0, lSwing: 0, rSwing: 0, lElbow: 0, rElbow: 0, lHip: 0, rHip: 0, lKnee: 0, rKnee: 0 };
const KEYS = Object.keys(ZERO) as (keyof Angles)[];

/** Weicher Halbbogen: 0 für s ≤ 0, sonst s² (kein Knick in der Geschwindigkeit). */
const lift = (s: number) => (s > 0 ? s * s : 0);

function anglesOf(motion: Motion, t: number): Angles {
  const a = { ...ZERO };
  if (motion === 'walk') {
    const p = (2 * Math.PI * t) / 1.15;
    a.lHip = 0.42 * Math.sin(p);
    a.rHip = -0.42 * Math.sin(p);
    a.lKnee = 0.85 * lift(Math.sin(p + 0.5));
    a.rKnee = 0.85 * lift(-Math.sin(p + 0.5));
    a.lSwing = -0.32 * Math.sin(p);
    a.rSwing = 0.32 * Math.sin(p);
    a.lElbow = 0.22 + 0.12 * Math.sin(p);
    a.rElbow = 0.22 - 0.12 * Math.sin(p);
    a.chestYaw = 0.09 * Math.sin(p);
    a.yaw = -0.05 * Math.sin(p);
  } else if (motion === 'turn') {
    a.yaw = 1.9 * Math.sin((2 * Math.PI * t) / 4.2);
    a.chestYaw = 0.12 * Math.cos((2 * Math.PI * t) / 4.2);
  } else if (motion === 'arms') {
    const k = 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / 3.6);
    a.lAbd = a.rAbd = 0.95 * k;
    a.lElbow = a.rElbow = 0.1 * k;
  } else if (motion === 'hop') {
    const s = Math.sin((2 * Math.PI * t) / 0.95);
    a.dy = 150 * lift(Math.max(0, s));
    const crouch = lift(Math.max(0, -s));
    a.lHip = a.rHip = 0.38 * crouch;
    a.lKnee = a.rKnee = 0.8 * crouch;
    a.lSwing = a.rSwing = 0.25 * s;
    a.lElbow = a.rElbow = 0.3;
  }
  return a;
}

/** 3 × 4-Matrix c = a · b */
function mul(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, c: Float32Array, co: number): void {
  for (let r = 0; r < 3; r++) {
    const a0 = a[ao + 4 * r];
    const a1 = a[ao + 4 * r + 1];
    const a2 = a[ao + 4 * r + 2];
    tmp[4 * r] = a0 * b[bo] + a1 * b[bo + 4] + a2 * b[bo + 8];
    tmp[4 * r + 1] = a0 * b[bo + 1] + a1 * b[bo + 5] + a2 * b[bo + 9];
    tmp[4 * r + 2] = a0 * b[bo + 2] + a1 * b[bo + 6] + a2 * b[bo + 10];
    tmp[4 * r + 3] = a0 * b[bo + 3] + a1 * b[bo + 7] + a2 * b[bo + 11] + a[ao + 4 * r + 3];
  }
  for (let i = 0; i < 12; i++) c[co + i] = tmp[i];
}
const tmp = new Float32Array(12);
const loc = new Float32Array(12);

/** Drehung um die Achsen x, y, z (in dieser Reihenfolge angewandt: erst z, dann x, dann y) um den Drehpunkt p. */
function local(rx: number, ry: number, rz: number, p: V3, out: Float32Array): void {
  const cx = Math.cos(rx),
    sx = Math.sin(rx);
  const cy = Math.cos(ry),
    sy = Math.sin(ry);
  const cz = Math.cos(rz),
    sz = Math.sin(rz);
  // R = Ry · Rx · Rz
  const r00 = cy * cz + sy * sx * sz;
  const r01 = -cy * sz + sy * sx * cz;
  const r02 = sy * cx;
  const r10 = cx * sz;
  const r11 = cx * cz;
  const r12 = -sx;
  const r20 = -sy * cz + cy * sx * sz;
  const r21 = sy * sz + cy * sx * cz;
  const r22 = cy * cx;
  out[0] = r00;
  out[1] = r01;
  out[2] = r02;
  out[3] = p[0] - (r00 * p[0] + r01 * p[1] + r02 * p[2]);
  out[4] = r10;
  out[5] = r11;
  out[6] = r12;
  out[7] = p[1] - (r10 * p[0] + r11 * p[1] + r12 * p[2]);
  out[8] = r20;
  out[9] = r21;
  out[10] = r22;
  out[11] = p[2] - (r20 * p[0] + r21 * p[1] + r22 * p[2]);
}

export function identityBones(out: Float32Array = new Float32Array(BONE_COUNT * 12)): Float32Array {
  out.fill(0);
  for (let b = 0; b < BONE_COUNT; b++) out[12 * b] = out[12 * b + 5] = out[12 * b + 10] = 1;
  return out;
}

export function isIdentity(bones: Float32Array): boolean {
  for (let b = 0; b < BONE_COUNT; b++)
    for (let i = 0; i < 12; i++) if (Math.abs(bones[12 * b + i] - (i === 0 || i === 5 || i === 10 ? 1 : 0)) > 1e-6) return false;
  return true;
}

/**
 * Knochenmatrizen für eine Bewegung zum Zeitpunkt t. `from`/`blend` überblenden weich aus der vorherigen Bewegung
 * (blend 0 → nur `from`, 1 → nur `motion`). Die Füße bleiben am Boden: das Becken wird so gehoben oder gesenkt,
 * dass der tiefere Knöchel auf Ruhehöhe steht (plus Sprunghöhe).
 */
export function poseBones(rig: Rig, motion: Motion, t: number, out: Float32Array, from: Motion = 'stand', blend = 1): Float32Array {
  const a = anglesOf(motion, t);
  if (blend < 1) {
    const f = anglesOf(from, t);
    const k = blend * blend * (3 - 2 * blend);
    for (const key of KEYS) a[key] = f[key] + (a[key] - f[key]) * k;
  }
  const bones = rig.bones;
  const set = (b: number, rx: number, ry: number, rz: number) => {
    local(rx, ry, rz, bones[b].a, loc);
    const p = bones[b].parent;
    if (p < 0) out.set(loc, 12 * b);
    else mul(out, 12 * p, loc, 0, out, 12 * b);
  };
  set(B.hips, 0, a.yaw, 0);
  set(B.chest, 0, a.chestYaw, 0);
  set(B.head, 0, -a.chestYaw * 0.6, 0);
  set(B.lArm, -a.lSwing, 0, a.lAbd);
  set(B.lFore, -a.lElbow, 0, 0);
  set(B.rArm, -a.rSwing, 0, -a.rAbd);
  set(B.rFore, -a.rElbow, 0, 0);
  set(B.lThigh, -a.lHip, 0, 0);
  set(B.lShin, a.lKnee, 0, 0);
  set(B.rThigh, -a.rHip, 0, 0);
  set(B.rShin, a.rKnee, 0, 0);
  // Füße auf den Boden
  let low = Infinity;
  for (const b of [B.lShin, B.rShin]) {
    const q = bones[b].b;
    const y = out[12 * b + 4] * q[0] + out[12 * b + 5] * rig.ankleY + out[12 * b + 6] * q[2] + out[12 * b + 7];
    low = Math.min(low, y);
  }
  const dy = rig.ankleY - low + a.dy;
  for (let b = 0; b < BONE_COUNT; b++) out[12 * b + 7] += dy;
  return out;
}

// ---------------------------------------------------------------------------
// Zuordnung von Punkten zu Knochen
// ---------------------------------------------------------------------------

/** Knochenachsen in einer Haltung (je Knochen 6 Werte: Anfang, Ende). */
export function posedSegments(rig: Rig, bones: Float32Array, out: Float32Array = new Float32Array(BONE_COUNT * 6)): Float32Array {
  for (let b = 0; b < BONE_COUNT; b++) {
    const o = 12 * b;
    for (const [q, k] of [
      [rig.bones[b].a, 0],
      [rig.bones[b].b, 3],
    ] as const) {
      out[6 * b + k] = bones[o] * q[0] + bones[o + 1] * q[1] + bones[o + 2] * q[2] + bones[o + 3];
      out[6 * b + k + 1] = bones[o + 4] * q[0] + bones[o + 5] * q[1] + bones[o + 6] * q[2] + bones[o + 7];
      out[6 * b + k + 2] = bones[o + 8] * q[0] + bones[o + 9] * q[1] + bones[o + 10] * q[2] + bones[o + 11];
    }
  }
  return out;
}

const nd = new Float32Array(BONE_COUNT);
/** Übergangsbreite zwischen zwei Knochen (in Radien) */
const SOFT = 0.4;

/**
 * Gewichte eines Punkts zu den Knochen: am nächsten (Abstand zur Achse, geteilt durch den Radius) zählt voll,
 * weitere Knochen mit weichem Übergang. Ergebnis in `w` (Länge BONE_COUNT), Summe 1.
 */
export function boneWeights(rig: Rig, seg: Float32Array, x: number, y: number, z: number, w: Float32Array): void {
  let min = Infinity;
  for (let b = 0; b < BONE_COUNT; b++) {
    const o = 6 * b;
    const ex = seg[o + 3] - seg[o];
    const ey = seg[o + 4] - seg[o + 1];
    const ez = seg[o + 5] - seg[o + 2];
    let t = ((x - seg[o]) * ex + (y - seg[o + 1]) * ey + (z - seg[o + 2]) * ez) / (ex * ex + ey * ey + ez * ez);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - seg[o] - ex * t;
    const dy = y - seg[o + 1] - ey * t;
    const dz = z - seg[o + 2] - ez * t;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / rig.bones[b].r;
    nd[b] = d;
    if (d < min) min = d;
  }
  let sum = 0;
  for (let b = 0; b < BONE_COUNT; b++) {
    const k = 1 - (nd[b] - min) / SOFT;
    const v = k > 0 ? k * k : 0;
    w[b] = v;
    sum += v;
  }
  for (let b = 0; b < BONE_COUNT; b++) w[b] /= sum;
}

export interface Skin {
  /** je Punkt zwei Knochen */
  idx: Uint8Array;
  /** Gewicht des ersten Knochens (zweiter: 1 − w) */
  w: Float32Array;
}

/** Haut-Gewichte für die Punkte der Puppe in Ruhehaltung (die zwei stärksten Knochen je Punkt). */
export function skinWeights(rig: Rig, positions: Float32Array): Skin {
  const n = positions.length / 3;
  const idx = new Uint8Array(2 * n);
  const w = new Float32Array(n);
  const seg = posedSegments(rig, identityBones());
  const bw = new Float32Array(BONE_COUNT);
  for (let i = 0; i < n; i++) {
    boneWeights(rig, seg, positions[3 * i], positions[3 * i + 1], positions[3 * i + 2], bw);
    let b0 = 0;
    let b1 = -1;
    for (let b = 1; b < BONE_COUNT; b++) if (bw[b] > bw[b0]) b0 = b;
    for (let b = 0; b < BONE_COUNT; b++) if (b !== b0 && (b1 < 0 || bw[b] > bw[b1])) b1 = b;
    idx[2 * i] = b0;
    idx[2 * i + 1] = b1;
    const s = bw[b0] + bw[b1];
    w[i] = s > 0 ? bw[b0] / s : 1;
  }
  return { idx, w };
}

/** Punkte der Puppe in die Haltung bringen (lineare Mischung der zwei Knochen). */
export function skinPositions(skin: Skin, bones: Float32Array, rest: Float32Array, out: Float32Array): void {
  const n = rest.length / 3;
  for (let i = 0; i < n; i++) {
    const x = rest[3 * i];
    const y = rest[3 * i + 1];
    const z = rest[3 * i + 2];
    const a = 12 * skin.idx[2 * i];
    const b = 12 * skin.idx[2 * i + 1];
    const wa = skin.w[i];
    const wb = 1 - wa;
    out[3 * i] = wa * (bones[a] * x + bones[a + 1] * y + bones[a + 2] * z + bones[a + 3]) + wb * (bones[b] * x + bones[b + 1] * y + bones[b + 2] * z + bones[b + 3]);
    out[3 * i + 1] = wa * (bones[a + 4] * x + bones[a + 5] * y + bones[a + 6] * z + bones[a + 7]) + wb * (bones[b + 4] * x + bones[b + 5] * y + bones[b + 6] * z + bones[b + 7]);
    out[3 * i + 2] = wa * (bones[a + 8] * x + bones[a + 9] * y + bones[a + 10] * z + bones[a + 11]) + wb * (bones[b + 8] * x + bones[b + 9] * y + bones[b + 10] * z + bones[b + 11]);
  }
}

/** Umkehrungen der (starren) Knochenmatrizen: Haltung → Ruhehaltung. */
export function invertBones(bones: Float32Array, out: Float32Array): Float32Array {
  for (let b = 0; b < BONE_COUNT; b++) {
    const o = 12 * b;
    const tx = bones[o + 3];
    const ty = bones[o + 7];
    const tz = bones[o + 11];
    for (let r = 0; r < 3; r++) {
      const c0 = bones[o + r];
      const c1 = bones[o + 4 + r];
      const c2 = bones[o + 8 + r];
      out[o + 4 * r] = c0;
      out[o + 4 * r + 1] = c1;
      out[o + 4 * r + 2] = c2;
      out[o + 4 * r + 3] = -(c0 * tx + c1 * ty + c2 * tz);
    }
  }
  return out;
}
