import type { BodyMeasures } from '../model/types';

/**
 * Schneiderpuppe aus Körpermaßen: Rumpf als Stapel von Ellipsen-Querschnitten (Umfänge aus den Maßen),
 * Hals, Kopf, Arme in A-Haltung und Beine als verjüngte Kapseln.
 *
 * Koordinaten in mm: y nach oben (Boden y = 0), z nach vorne (Blickrichtung der Puppe), +x = linke
 * Körperseite (von vorne gesehen also rechts im Bild). Dieselben Formeln liefern das Darstellungsnetz
 * und die Kollision für die Stoffsimulation, damit Stoff und Puppe exakt zusammenpassen.
 */

export interface Section {
  y: number;
  /** Halbe Breite (x) */
  a: number;
  /** Halbe Tiefe (z) */
  b: number;
  /** Mittelpunkt in z */
  cz: number;
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

/** Halbachsen zu Umfang und Verhältnis Tiefe/Breite. */
function axesFor(circ: number, k: number): { a: number; b: number } {
  const f = ellipsePerimeter(1, k);
  const a = circ / f;
  return { a, b: a * k };
}

export const ARM_ANGLE = (42 * Math.PI) / 180;

export function buildMannequin(m: BodyMeasures, armAngle = ARM_ANGLE): Mannequin {
  const H = m.height;
  const shoulderY = H * 0.815;
  const neckBaseY = shoulderY + Math.max(30, Math.min(60, H * 0.025));
  const waistY = neckBaseY - m.backLength;
  const chestY = neckBaseY - m.backLength * 0.5;
  const hipY = waistY - H * 0.105;
  const crotchY = hipY - H * 0.05;
  const chinY = neckBaseY + H * 0.045;
  const neckR = m.neck / (2 * Math.PI);
  const sec = (y: number, circ: number, k: number, cz = 0): Section => ({ y, ...axesFor(circ, k), cz });
  const shoulderHalf = m.shoulder / 2 - (m.upperArm / (2 * Math.PI)) * 0.55;
  const upper: Section = { y: shoulderY - 10, a: shoulderHalf, b: Math.min(axesFor(m.chest, 0.7).b * 0.9, shoulderHalf * 0.55), cz: -8 };
  const sections: Section[] = [
    sec(crotchY + 10, m.hip * 0.5, 0.9, -4),
    sec(crotchY + 30, m.hip * 0.82, 0.8, -5),
    sec(crotchY + 45, m.hip * 0.95, 0.76, -5),
    sec(hipY, m.hip, 0.74, -6),
    sec((hipY + waistY) / 2, (m.hip + m.waist) / 2, 0.74, -3),
    sec(waistY, m.waist, 0.74, 0),
    sec((waistY + chestY) / 2, (m.waist + m.chest) / 2, 0.72, 2),
    sec(chestY, m.chest, 0.7, 4),
    sec(chestY + (shoulderY - chestY) * 0.55, m.chest * 0.98, 0.64, 0),
    upper,
    { y: shoulderY + (neckBaseY - shoulderY) * 0.55, a: shoulderHalf * 0.62 + neckR * 0.45, b: upper.b * 0.85, cz: -10 },
    { y: neckBaseY, a: neckR * 1.18, b: neckR * 1.08, cz: -12 },
  ];
  const upperArmR = m.upperArm / (2 * Math.PI);
  const wristR = m.wrist / (2 * Math.PI);
  const elbowR = (upperArmR + wristR) / 2 + 3;
  const joint: [number, number, number] = [m.shoulder / 2 - upperArmR * 0.95, shoulderY - upperArmR * 0.85, -6];
  const dir: [number, number, number] = [Math.sin(armAngle), -Math.cos(armAngle), 0];
  const at = (s: number): [number, number, number] => [joint[0] + dir[0] * s, joint[1] + dir[1] * s, joint[2] + dir[2] * s];
  const elbowS = m.arm * 0.52;
  const capsules: Capsule[] = [];
  for (const sx of [1, -1]) {
    const f = (p: [number, number, number]): [number, number, number] => [p[0] * sx, p[1], p[2]];
    capsules.push({ p0: f(joint), p1: f(at(elbowS)), r0: upperArmR, r1: elbowR });
    capsules.push({ p0: f(at(elbowS)), p1: f(at(m.arm)), r0: elbowR, r1: wristR });
  }
  // Hals
  capsules.push({ p0: [0, neckBaseY - 40, -12], p1: [0, chinY, -6], r0: neckR, r1: neckR * 0.95 });
  // Beine
  const hipA = axesFor(m.hip, 0.74).a;
  const thighR = (m.hip / (2 * Math.PI)) * 0.68;
  for (const sx of [1, -1]) {
    capsules.push({ p0: [sx * hipA * 0.4, crotchY + 95, -6], p1: [sx * hipA * 0.4, H * 0.28, 5], r0: thighR, r1: thighR * 0.6 });
    capsules.push({ p0: [sx * hipA * 0.4, H * 0.28, 5], p1: [sx * hipA * 0.36, H * 0.045, -5], r0: thighR * 0.62, r1: thighR * 0.38 });
  }
  const headR = m.head / (2 * Math.PI);
  const ellipsoids: Ellipsoid[] = [
    { c: [0, chinY + headR * 1.05, 6], r: [headR * 0.86, headR * 1.22, headR * 1.05] },
    // Hände
    { c: at(m.arm + wristR * 2.4), r: [wristR * 1.25, wristR * 2.9, wristR * 1.9] },
  ];
  const hand = ellipsoids[1];
  ellipsoids.push({ c: [-hand.c[0], hand.c[1], hand.c[2]], r: hand.r });
  const maxR = Math.max(...sections.map((s) => Math.max(s.a, s.b + Math.abs(s.cz))));
  return { measures: m, sections, neckBaseY, shoulderY, chestY, waistY, hipY, crotchY, chinY, neckR, shoulderJoint: joint, armDir: dir, armAngle, capsules, ellipsoids, maxR };
}

/** Querschnitt in Höhe y (glatt interpoliert); null außerhalb des Rumpfs. */
export function sectionAt(mq: Mannequin, y: number): Section | null {
  const s = mq.sections;
  if (y < s[0].y || y > s[s.length - 1].y) return null;
  let i = 0;
  while (i < s.length - 2 && y > s[i + 1].y) i++;
  const p = s[i];
  const q = s[i + 1];
  const t0 = (y - p.y) / (q.y - p.y);
  const t = t0 * t0 * (3 - 2 * t0);
  return { y, a: p.a + (q.a - p.a) * t, b: p.b + (q.b - p.b) * t, cz: p.cz + (q.cz - p.cz) * t };
}

/** Implizite Rumpffunktion: < 0 innen. */
function torsoF(mq: Mannequin, x: number, y: number, z: number): number {
  const s = sectionAt(mq, y);
  if (!s) return 1e3;
  const u = x / s.a;
  const v = (z - s.cz) / s.b;
  return (Math.sqrt(u * u + v * v) - 1) * Math.min(s.a, s.b);
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
  const seg = 56;
  const rows: [number, number, number][][] = [];
  const y0 = mq.sections[0].y;
  const y1 = mq.sections[mq.sections.length - 1].y;
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n;
    const s = sectionAt(mq, y)!;
    const row: [number, number, number][] = [];
    for (let k = 0; k < seg; k++) {
      const t = (k / seg) * Math.PI * 2;
      row.push([(s.a - inset) * Math.sin(t), y, s.cz + (s.b - inset) * Math.cos(t)]);
    }
    rows.push(row);
  }
  ring(mesh, rows);
  for (const c of mq.capsules) capsuleMesh(mesh, { ...c, r0: c.r0 - inset, r1: c.r1 - inset });
  for (const e of mq.ellipsoids) ellipsoidMesh(mesh, { c: e.c, r: [e.r[0] - inset, e.r[1] - inset, e.r[2] - inset] });
  return mesh;
}
