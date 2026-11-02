/**
 * Vorzeichenbehaftetes Abstandsfeld (SDF) eines Dreiecksnetzes auf einem Raster – nur in einem schmalen Band
 * um die Oberfläche berechnet (mehr braucht die Stoffkollision nicht). Abfrage trilinear mit Gradient.
 */

export interface Sdf {
  ox: number;
  oy: number;
  oz: number;
  cell: number;
  nx: number;
  ny: number;
  nz: number;
  /** Abstand in mm (außerhalb des Bands: FAR) */
  d: Float32Array;
}

export const FAR = 1e4;

/** Nächster Punkt auf dem Dreieck a, b, c zu p (Ericson, Real-Time Collision Detection). */
function closest(px: number, py: number, pz: number, a: number[], b: number[], c: number[], out: number[]): void {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    abz = b[2] - a[2];
  const acx = c[0] - a[0],
    acy = c[1] - a[1],
    acz = c[2] - a[2];
  const apx = px - a[0],
    apy = py - a[1],
    apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return void ((out[0] = a[0]), (out[1] = a[1]), (out[2] = a[2]));
  const bpx = px - b[0],
    bpy = py - b[1],
    bpz = pz - b[2];
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return void ((out[0] = b[0]), (out[1] = b[1]), (out[2] = b[2]));
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return void ((out[0] = a[0] + abx * v), (out[1] = a[1] + aby * v), (out[2] = a[2] + abz * v));
  }
  const cpx = px - c[0],
    cpy = py - c[1],
    cpz = pz - c[2];
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return void ((out[0] = c[0]), (out[1] = c[1]), (out[2] = c[2]));
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return void ((out[0] = a[0] + acx * w), (out[1] = a[1] + acy * w), (out[2] = a[2] + acz * w));
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return void ((out[0] = b[0] + (c[0] - b[0]) * w), (out[1] = b[1] + (c[1] - b[1]) * w), (out[2] = b[2] + (c[2] - b[2]) * w));
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  out[0] = a[0] + abx * v + acx * w;
  out[1] = a[1] + aby * v + acy * w;
  out[2] = a[2] + abz * v + acz * w;
}

export function buildSdf(pos: Float32Array, tris: Uint16Array | Uint32Array, cell = 12, band = 36): Sdf {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let j = 0; j < tris.length; j++) {
    const i = 3 * tris[j];
    minX = Math.min(minX, pos[i]);
    maxX = Math.max(maxX, pos[i]);
    minY = Math.min(minY, pos[i + 1]);
    maxY = Math.max(maxY, pos[i + 1]);
    minZ = Math.min(minZ, pos[i + 2]);
    maxZ = Math.max(maxZ, pos[i + 2]);
  }
  const pad = band + cell;
  const ox = minX - pad,
    oy = minY - pad,
    oz = minZ - pad;
  const nx = Math.ceil((maxX - minX + 2 * pad) / cell) + 1;
  const ny = Math.ceil((maxY - minY + 2 * pad) / cell) + 1;
  const nz = Math.ceil((maxZ - minZ + 2 * pad) / cell) + 1;
  const d = new Float32Array(nx * ny * nz).fill(FAR);
  const a = [0, 0, 0],
    b = [0, 0, 0],
    c = [0, 0, 0],
    q = [0, 0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      a[k] = pos[3 * tris[t] + k];
      b[k] = pos[3 * tris[t + 1] + k];
      c[k] = pos[3 * tris[t + 2] + k];
    }
    // Flächennormale (nach außen, Netz gegen den Uhrzeigersinn)
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const vx = c[0] - a[0],
      vy = c[1] - a[1],
      vz = c[2] - a[2];
    const fnx = uy * vz - uz * vy,
      fny = uz * vx - ux * vz,
      fnz = ux * vy - uy * vx;
    const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - band - ox) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(a[0], b[0], c[0]) + band - ox) / cell));
    const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - band - oy) / cell));
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(a[1], b[1], c[1]) + band - oy) / cell));
    const k0 = Math.max(0, Math.floor((Math.min(a[2], b[2], c[2]) - band - oz) / cell));
    const k1 = Math.min(nz - 1, Math.ceil((Math.max(a[2], b[2], c[2]) + band - oz) / cell));
    for (let k = k0; k <= k1; k++) {
      const pz = oz + k * cell;
      for (let j = j0; j <= j1; j++) {
        const py = oy + j * cell;
        const row = (k * ny + j) * nx;
        for (let i = i0; i <= i1; i++) {
          const px = ox + i * cell;
          closest(px, py, pz, a, b, c, q);
          const dx = px - q[0],
            dy = py - q[1],
            dz = pz - q[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist > band) continue;
          const cur = d[row + i];
          if (dist < Math.abs(cur)) d[row + i] = dx * fnx + dy * fny + dz * fnz < 0 ? -dist : dist;
        }
      }
    }
  }
  return { ox, oy, oz, cell, nx, ny, nz, d };
}

/** Trilineare Abfrage mit Gradient; null außerhalb des Bands. */
export function sampleSdf(s: Sdf, x: number, y: number, z: number, out: { d: number; nx: number; ny: number; nz: number }): boolean {
  const fx = (x - s.ox) / s.cell;
  const fy = (y - s.oy) / s.cell;
  const fz = (z - s.oz) / s.cell;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  const k = Math.floor(fz);
  if (i < 0 || j < 0 || k < 0 || i >= s.nx - 1 || j >= s.ny - 1 || k >= s.nz - 1) return false;
  const tx = fx - i;
  const ty = fy - j;
  const tz = fz - k;
  const D = s.d;
  const nx = s.nx;
  const nxy = nx * s.ny;
  const o = k * nxy + j * nx + i;
  const c000 = D[o],
    c100 = D[o + 1],
    c010 = D[o + nx],
    c110 = D[o + nx + 1];
  const c001 = D[o + nxy],
    c101 = D[o + nxy + 1],
    c011 = D[o + nxy + nx],
    c111 = D[o + nxy + nx + 1];
  if (c000 >= FAR || c100 >= FAR || c010 >= FAR || c110 >= FAR || c001 >= FAR || c101 >= FAR || c011 >= FAR || c111 >= FAR) return false;
  const x00 = c000 + (c100 - c000) * tx,
    x10 = c010 + (c110 - c010) * tx;
  const x01 = c001 + (c101 - c001) * tx,
    x11 = c011 + (c111 - c011) * tx;
  const y0 = x00 + (x10 - x00) * ty,
    y1 = x01 + (x11 - x01) * ty;
  out.d = y0 + (y1 - y0) * tz;
  // Gradient der trilinearen Interpolation
  const gx = ((c100 - c000) * (1 - ty) + (c110 - c010) * ty) * (1 - tz) + ((c101 - c001) * (1 - ty) + (c111 - c011) * ty) * tz;
  const gy = (x10 - x00) * (1 - tz) + (x11 - x01) * tz;
  const gz = y1 - y0;
  const g = Math.hypot(gx, gy, gz);
  if (g < 1e-9) return false;
  out.nx = gx / g;
  out.ny = gy / g;
  out.nz = gz / g;
  return true;
}
