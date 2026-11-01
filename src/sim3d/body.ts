import type { BodyMeasures } from '../model/types';

/**
 * Schneiderpuppe aus Körpermaßen, männlich oder weiblich: Rumpf als Stapel von Querschnitten (Breite,
 * Tiefe vorne/hinten getrennt, Büste bzw. Brustmuskel und Gesäß als weiche Wölbungen; jeder Querschnitt
 * wird auf den gemessenen Umfang eingepasst), Hals, Kopf, Schultern, Arme in A-Haltung, Beine mit Knie
 * und Wade, Hände und Füße.
 *
 * Koordinaten in mm: y nach oben (Boden y = 0), z nach vorne (Blickrichtung der Puppe), +x = linke
 * Körperseite (von vorne gesehen also rechts im Bild). Dieselben Formeln liefern das Darstellungsnetz
 * und die Kollision für die Stoffsimulation, damit Stoff und Puppe exakt zusammenpassen.
 */

export type Gender = 'male' | 'female';

export interface Section {
  y: number;
  /** Halbe Breite (x) */
  a: number;
  /** Tiefe nach vorne / nach hinten ab Mittelpunkt (z) */
  bf: number;
  bb: number;
  /** Mittelpunkt in z */
  cz: number;
  /** Wölbung vorne (Büste/Brustmuskel) in mm und ihr Abstand zur Mitte als Winkel */
  bust: number;
  bustAng: number;
  /** Wölbung hinten (Gesäß/Schulterblätter) in mm */
  seat: number;
}

export interface Capsule {
  p0: [number, number, number];
  p1: [number, number, number];
  r0: number;
  r1: number;
}

export interface Ellipsoid {
  c: [number, number, number];
  r: [number, number, number];
}

export interface Mannequin {
  measures: BodyMeasures;
  gender: Gender;
  sections: Section[];
  neckBaseY: number;
  shoulderY: number;
  chestY: number;
  waistY: number;
  hipY: number;
  crotchY: number;
  chinY: number;
  neckR: number;
  /** Schultergelenk links (x > 0) */
  shoulderJoint: [number, number, number];
  /** Armrichtung links (Einheitsvektor) */
  armDir: [number, number, number];
  armAngle: number;
  capsules: Capsule[];
  ellipsoids: Ellipsoid[];
  /** Größter Rumpfradius (für die Anordnung der Teile) */
  maxR: number;
}

/** Ellipsenumfang nach Ramanujan. */
export function ellipsePerimeter(a: number, b: number): number {
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/** Radius eines Querschnitts in Richtung θ (0 = vorne, +π/2 = +x). */
export function sectionRadius(s: Section, th: number): number {
  const c = Math.cos(th);
  const sn = Math.sin(th);
  const b = c >= 0 ? s.bf : s.bb;
  let r = 1 / Math.sqrt((sn / s.a) ** 2 + (c / b) ** 2);
  if (s.bust > 0) {
    const w = 0.36;
    const d1 = th - s.bustAng;
    const d2 = th + s.bustAng;
    r += s.bust * (Math.exp(-((d1 / w) ** 2)) + Math.exp(-((d2 / w) ** 2)));
  }
  if (s.seat > 0) {
    const w = 0.55;
    const a = Math.PI - 0.5;
    const t = Math.abs(th) > Math.PI ? th - Math.sign(th) * 2 * Math.PI : th;
    const d1 = Math.abs(t) - a;
    r += s.seat * Math.exp(-((d1 / w) ** 2));
  }
  return r;
}

/** Umfang wie mit dem Maßband gemessen (konvexe Hülle über die Wölbungen). */
export function sectionPerimeter(s: Section, n = 96): number {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2 - Math.PI;
    const r = sectionRadius(s, th);
    pts.push([r * Math.sin(th), r * Math.cos(th)]);
  }
  const hull = convexHull(pts);
  let L = 0;
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i];
    const q = hull[(i + 1) % hull.length];
    L += Math.hypot(q[0] - p[0], q[1] - p[1]);
  }
  return L;
}

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Querschnitt auf einen Umfang einpassen: Verhältnisse (Tiefe vorne/hinten zur Breite) und Wölbungen
 * bleiben, Breite und Tiefen werden gemeinsam skaliert.
 */
function fit(circ: number, kf: number, kb: number, opts: { y: number; cz?: number; bust?: number; bustAng?: number; seat?: number }): Section {
  let a = circ / ellipsePerimeter(1, (kf + kb) / 2);
  const make = (aa: number): Section => ({ y: opts.y, a: aa, bf: aa * kf, bb: aa * kb, cz: opts.cz ?? 0, bust: opts.bust ?? 0, bustAng: opts.bustAng ?? 0.5, seat: opts.seat ?? 0 });
  for (let i = 0; i < 6; i++) a *= circ / sectionPerimeter(make(a));
  return make(a);
}

export const ARM_ANGLE = (42 * Math.PI) / 180;

export function buildMannequin(m: BodyMeasures, gender: Gender = 'male', armAngle = ARM_ANGLE): Mannequin {
  const H = m.height;
  const fem = gender === 'female';
  const shoulderY = H * 0.815;
  const neckBaseY = shoulderY + Math.max(30, Math.min(60, H * 0.025));
  const waistY = neckBaseY - m.backLength;
  const chestY = neckBaseY - m.backLength * (fem ? 0.52 : 0.5);
  const hipY = waistY - H * (fem ? 0.11 : 0.105);
  const crotchY = hipY - H * 0.05;
  const chinY = neckBaseY + H * (fem ? 0.05 : 0.045);
  const neckR = m.neck / (2 * Math.PI);
  const upperArmR = m.upperArm / (2 * Math.PI);
  // Büste: Wölbung aus dem Unterschied Brust- zu Unterbrustumfang (geschätzt)
  const bust = fem ? Math.max(14, Math.min(55, m.chest * 0.034 + (m.chest - m.waist) * 0.04)) : 7 + Math.max(0, m.chest - m.waist - 100) * 0.02;
  const seat = fem ? Math.max(8, Math.min(40, (m.hip - m.waist) * 0.09)) : 5;
  const shoulderHalf = m.shoulder / 2 - upperArmR * 0.55;
  const chestS = fit(m.chest, fem ? 0.66 : 0.66, fem ? 0.6 : 0.64, { y: chestY, cz: 4, bust, bustAng: fem ? 0.6 : 0.68 });
  const upperB = Math.min(chestS.bf * 0.95, shoulderHalf * 0.6);
  const sections: Section[] = [
    fit(m.hip * 0.5, 0.9, 0.9, { y: crotchY + 10, cz: -4 }),
    fit(m.hip * 0.82, 0.78, 0.82, { y: crotchY + 30, cz: -5, seat: seat * 0.6 }),
    fit(m.hip * 0.95, 0.72, 0.8, { y: crotchY + 45, cz: -5, seat }),
    fit(m.hip, fem ? 0.68 : 0.7, fem ? 0.82 : 0.76, { y: hipY, cz: -6, seat: seat * 0.9 }),
    fit((m.hip + m.waist) / 2, 0.72, 0.74, { y: (hipY + waistY) / 2, cz: -3, seat: seat * 0.3 }),
    fit(m.waist, fem ? 0.74 : 0.78, 0.7, { y: waistY, cz: 0 }),
    fit(fem ? m.waist * 0.55 + m.chest * 0.4 : (m.waist + m.chest) / 2, 0.7, 0.68, { y: (waistY + chestY) / 2, cz: 2, bust: fem ? bust * 0.08 : 0 }),
    ...(fem ? [fit(m.chest * 0.9, 0.66, 0.64, { y: chestY - 75, cz: 3, bust: bust * 0.45, bustAng: 0.6 })] : []),
    chestS,
    fit(m.chest * 0.97, 0.6, 0.62, { y: chestY + (shoulderY - chestY) * 0.55, cz: 0, bust: bust * (fem ? 0.25 : 0.6), bustAng: 0.7, seat: 6 }),
    { y: shoulderY - 10, a: shoulderHalf, bf: upperB, bb: upperB * 1.05, cz: -8, bust: 0, bustAng: 0.5, seat: 4 },
    { y: shoulderY + (neckBaseY - shoulderY) * 0.55, a: shoulderHalf * 0.62 + neckR * 0.45, bf: upperB * 0.82, bb: upperB * 0.88, cz: -10, bust: 0, bustAng: 0.5, seat: 0 },
    { y: neckBaseY, a: neckR * 1.18, bf: neckR * 1.05, bb: neckR * 1.1, cz: -12, bust: 0, bustAng: 0.5, seat: 0 },
  ];
  const wristR = m.wrist / (2 * Math.PI);
  const elbowR = (upperArmR + wristR) / 2 + 2;
  const foreR = elbowR + (fem ? 2 : 5);
  const joint: [number, number, number] = [m.shoulder / 2 - upperArmR * 0.95, shoulderY - upperArmR * 0.85, -6];
  const dir: [number, number, number] = [Math.sin(armAngle), -Math.cos(armAngle), 0];
  const at = (s: number): [number, number, number] => [joint[0] + dir[0] * s, joint[1] + dir[1] * s, joint[2] + dir[2] * s];
  const elbowS = m.arm * 0.52;
  const capsules: Capsule[] = [];
  const ellipsoids: Ellipsoid[] = [];
  for (const sx of [1, -1]) {
    const f = (p: [number, number, number]): [number, number, number] => [p[0] * sx, p[1], p[2]];
    capsules.push({ p0: f(joint), p1: f(at(elbowS)), r0: upperArmR, r1: elbowR });
    // Unterarm: kräftiger nahe dem Ellbogen, schlank zum Handgelenk
    capsules.push({ p0: f(at(elbowS)), p1: f(at(elbowS + (m.arm - elbowS) * 0.3)), r0: elbowR, r1: foreR });
    capsules.push({ p0: f(at(elbowS + (m.arm - elbowS) * 0.3)), p1: f(at(m.arm)), r0: foreR, r1: wristR });
    // Schulter (Deltamuskel): runder Übergang zum Rumpf
    const j = f(joint);
    ellipsoids.push({ c: [j[0] - sx * 4, j[1] + 6, j[2]], r: [upperArmR * 1.12, upperArmR * 1.05, upperArmR * 1.12] });
    // Hand
    const hc = f(at(m.arm + wristR * 2.5));
    ellipsoids.push({ c: hc, r: [wristR * 1.15, wristR * 2.8, wristR * 1.75] });
  }
  // Hals
  capsules.push({ p0: [0, neckBaseY - 40, -12], p1: [0, chinY, -6], r0: neckR, r1: neckR * 0.94 });
  // Beine mit Knie und Wade
  const hipA = sections[3].a;
  const thighR = (m.hip / (2 * Math.PI)) * (fem ? 0.7 : 0.66);
  const kneeY = H * 0.285;
  const calfY = H * 0.2;
  const ankleY = H * 0.045;
  const kneeR = thighR * 0.58;
  const calfR = thighR * (fem ? 0.6 : 0.64);
  const ankleR = thighR * 0.34;
  for (const sx of [1, -1]) {
    const lx = sx * hipA * (fem ? 0.42 : 0.4);
    const kx = sx * hipA * (fem ? 0.34 : 0.38);
    capsules.push({ p0: [lx, crotchY + 95, -6], p1: [kx, kneeY, 6], r0: thighR, r1: kneeR });
    capsules.push({ p0: [kx, kneeY, 6], p1: [kx * 0.98, calfY, -4], r0: kneeR, r1: calfR });
    capsules.push({ p0: [kx * 0.98, calfY, -4], p1: [kx * 0.95, ankleY, -10], r0: calfR, r1: ankleR });
    // Fuß
    ellipsoids.push({ c: [kx * 0.95, ankleY * 0.5, 55], r: [ankleR * 1.15, ankleY * 0.5, H * 0.06] });
  }
  const headR = m.head / (2 * Math.PI);
  ellipsoids.push({ c: [0, chinY + headR * 1.05, 6], r: [headR * 0.84, headR * (fem ? 1.18 : 1.22), headR * 1.04] });
  const maxR = Math.max(...sections.map((q) => Math.max(q.a, Math.max(q.bf, q.bb) + q.bust + q.seat + Math.abs(q.cz))));
  return { measures: m, gender, sections, neckBaseY, shoulderY, chestY, waistY, hipY, crotchY, chinY, neckR, shoulderJoint: joint, armDir: dir, armAngle, capsules, ellipsoids, maxR };
}

const KEYS = ['a', 'bf', 'bb', 'cz', 'bust', 'bustAng', 'seat'] as const;

/**
 * Querschnitt in Höhe y, glatt interpoliert (kubisch nach Hermite mit Steigungen aus den Nachbarn,
 * damit keine Knicke und Streifen zwischen den Querschnitten entstehen); null außerhalb des Rumpfs.
 */
export function sectionAt(mq: Mannequin, y: number): Section | null {
  const s = mq.sections;
  if (y < s[0].y || y > s[s.length - 1].y) return null;
  let i = 0;
  while (i < s.length - 2 && y > s[i + 1].y) i++;
  const p = s[i];
  const q = s[i + 1];
  const h = q.y - p.y;
  const t = (y - p.y) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const slope = (k: number, key: (typeof KEYS)[number]) => {
    const a = s[Math.max(0, k - 1)];
    const b = s[Math.min(s.length - 1, k + 1)];
    if (k === 0 || k === s.length - 1) return 0;
    return (b[key] - a[key]) / (b.y - a.y);
  };
  const out = { y } as Section;
  for (const key of KEYS) {
    const m0 = slope(i, key) * h;
    const m1 = slope(i + 1, key) * h;
    let v = h00 * p[key] + h10 * m0 + h01 * q[key] + h11 * m1;
    // nicht über die Nachbarwerte hinausschießen
    const lo = Math.min(p[key], q[key]);
    const hi = Math.max(p[key], q[key]);
    v = Math.max(lo - (hi - lo) * 0.15, Math.min(hi + (hi - lo) * 0.15, v));
    out[key] = v;
  }
  return out;
}

/** Implizite Rumpffunktion: < 0 innen (radialer Abstand zur Oberfläche). */
function torsoF(mq: Mannequin, x: number, y: number, z: number): number {
  const s = sectionAt(mq, y);
  if (!s) return 1e3;
  const dz = z - s.cz;
  const rho = Math.hypot(x, dz);
  if (rho < 1e-9) return -Math.min(s.a, s.bf);
  return rho - sectionRadius(s, Math.atan2(x, dz));
}

export interface Contact {
  /** Vorzeichenbehafteter Abstand zur Oberfläche (mm, < 0 innen) */
  d: number;
  nx: number;
  ny: number;
  nz: number;
}

const tmp: Contact = { d: 0, nx: 0, ny: 0, nz: 0 };

/**
 * Nächster Kontakt mit der Puppe: kleinster vorzeichenbehafteter Abstand über alle Körperteile und die
 * Normale nach außen. `maxD`: nur Kontakte näher als dieser Wert werden genau berechnet.
 */
export function bodyContact(mq: Mannequin, x: number, y: number, z: number, maxD: number, out: Contact = tmp): Contact | null {
  let best = maxD;
  let found = false;
  // Rumpf
  const top = mq.sections[mq.sections.length - 1].y;
  if (y >= mq.sections[0].y - maxD && y <= top + maxD && Math.abs(x) < mq.maxR + maxD && Math.abs(z) < mq.maxR + maxD) {
    const f = torsoF(mq, x, y, z);
    if (f < best) {
      const h = 1;
      const gx = (torsoF(mq, x + h, y, z) - torsoF(mq, x - h, y, z)) / (2 * h);
      const gy = (torsoF(mq, x, y + h, z) - torsoF(mq, x, y - h, z)) / (2 * h);
      const gz = (torsoF(mq, x, y, z + h) - torsoF(mq, x, y, z - h)) / (2 * h);
      const g = Math.hypot(gx, gy, gz);
      if (g > 1e-6 && g < 1e3) {
        const d = f / g;
        if (d < best) {
          best = d;
          found = true;
          out.d = d;
          out.nx = gx / g;
          out.ny = gy / g;
          out.nz = gz / g;
        }
      }
    }
  }
  for (const c of mq.capsules) {
    const ex = c.p1[0] - c.p0[0];
    const ey = c.p1[1] - c.p0[1];
    const ez = c.p1[2] - c.p0[2];
    const L2 = ex * ex + ey * ey + ez * ez;
    let t = ((x - c.p0[0]) * ex + (y - c.p0[1]) * ey + (z - c.p0[2]) * ez) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (c.p0[0] + ex * t);
    const dy = y - (c.p0[1] + ey * t);
    const dz = z - (c.p0[2] + ez * t);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const d = dist - (c.r0 + (c.r1 - c.r0) * t);
    if (d < best && dist > 1e-9) {
      best = d;
      found = true;
      out.d = d;
      out.nx = dx / dist;
      out.ny = dy / dist;
      out.nz = dz / dist;
    }
  }
  for (const e of mq.ellipsoids) {
    const ux = (x - e.c[0]) / e.r[0];
    const uy = (y - e.c[1]) / e.r[1];
    const uz = (z - e.c[2]) / e.r[2];
    const k = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (k < 1e-9) continue;
    const rmin = Math.min(e.r[0], e.r[1], e.r[2]);
    const d = (k - 1) * rmin;
    if (d < best) {
      const gx = ux / e.r[0];
      const gy = uy / e.r[1];
      const gz = uz / e.r[2];
      const g = Math.hypot(gx, gy, gz);
      best = d;
      found = true;
      out.d = d;
      out.nx = gx / g;
      out.ny = gy / g;
      out.nz = gz / g;
    }
  }
  return found ? out : null;
}

// ---------------------------------------------------------------------------
// Darstellungsnetz
// ---------------------------------------------------------------------------

export interface MeshData {
  positions: number[];
  indices: number[];
}

function ring(mesh: MeshData, rows: [number, number, number][][], closeU = true): void {
  const base = mesh.positions.length / 3;
  const nu = rows[0].length;
  for (const row of rows) for (const p of row) mesh.positions.push(p[0], p[1], p[2]);
  for (let r = 0; r + 1 < rows.length; r++) {
    const cols = closeU ? nu : nu - 1;
    for (let i = 0; i < cols; i++) {
      const a = base + r * nu + i;
      const b = base + r * nu + ((i + 1) % nu);
      const c = base + (r + 1) * nu + i;
      const d = base + (r + 1) * nu + ((i + 1) % nu);
      mesh.indices.push(a, b, c, b, d, c);
    }
  }
}

function capsuleMesh(mesh: MeshData, c: Capsule, seg = 24, rings = 12): void {
  const ax = [c.p1[0] - c.p0[0], c.p1[1] - c.p0[1], c.p1[2] - c.p0[2]];
  const L = Math.hypot(ax[0], ax[1], ax[2]);
  const w = ax.map((v) => v / L);
  const up = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = [w[1] * up[2] - w[2] * up[1], w[2] * up[0] - w[0] * up[2], w[0] * up[1] - w[1] * up[0]];
  const ul = Math.hypot(u[0], u[1], u[2]);
  const U = u.map((v) => v / ul);
  const V = [w[1] * U[2] - w[2] * U[1], w[2] * U[0] - w[0] * U[2], w[0] * U[1] - w[1] * U[0]];
  const rows: [number, number, number][][] = [];
  // Halbkugel am Anfang, Zylinder, Halbkugel am Ende
  const prof: [number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    prof.push([c.r0 * Math.sin(a), c.r0 * Math.cos(a)]);
  }
  for (let i = 1; i < rings; i++) prof.push([(i / rings) * L, c.r0 + (c.r1 - c.r0) * (i / rings)]);
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (Math.PI / 2);
    prof.push([L + c.r1 * Math.sin(a), c.r1 * Math.cos(a)]);
  }
  for (const [s, r] of prof) {
    const row: [number, number, number][] = [];
    for (let k = 0; k < seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      const cx = Math.cos(t) * r;
      const cy = Math.sin(t) * r;
      row.push([c.p0[0] + w[0] * s + U[0] * cx + V[0] * cy, c.p0[1] + w[1] * s + U[1] * cx + V[1] * cy, c.p0[2] + w[2] * s + U[2] * cx + V[2] * cy]);
    }
    rows.push(row);
  }
  ring(mesh, rows);
}

function ellipsoidMesh(mesh: MeshData, e: Ellipsoid, seg = 32, rings = 20): void {
  const rows: [number, number, number][][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = -Math.PI / 2 + (i / rings) * Math.PI;
    const row: [number, number, number][] = [];
    for (let k = 0; k < seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      row.push([e.c[0] + e.r[0] * Math.cos(phi) * Math.sin(t), e.c[1] + e.r[1] * Math.sin(phi), e.c[2] + e.r[2] * Math.cos(phi) * Math.cos(t)]);
    }
    rows.push(row);
  }
  ring(mesh, rows);
}

/** Darstellungsnetz der Puppe (Dreiecke in mm). */
export function mannequinMesh(mq: Mannequin, inset = 0): MeshData {
  const mesh: MeshData = { positions: [], indices: [] };
  const seg = 80;
  const rows: [number, number, number][][] = [];
  const y0 = mq.sections[0].y;
  const y1 = mq.sections[mq.sections.length - 1].y;
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    const s = sectionAt(mq, y)!;
    const row: [number, number, number][] = [];
    for (let k = 0; k < seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      const th = t - Math.PI;
      const r = sectionRadius(s, th) - inset;
      row.push([r * Math.sin(th), y, s.cz + r * Math.cos(th)]);
    }
    rows.push(row);
  }
  ring(mesh, rows);
  for (const c of mq.capsules) capsuleMesh(mesh, { ...c, r0: c.r0 - inset, r1: c.r1 - inset });
  for (const e of mq.ellipsoids) ellipsoidMesh(mesh, { c: e.c, r: [e.r[0] - inset, e.r[1] - inset, e.r[2] - inset] });
  return mesh;
}
