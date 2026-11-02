/**
 * Glatte Darstellung eines groben Stoffnetzes: jede Dreiecksseite bekommt einen Mittelpunkt auf einer gekrümmten
 * Fläche (PN-Dreiecke), aus einem Dreieck werden vier. Normalen werden über Nähte gemittelt, damit die Teile
 * ohne sichtbare Kante ineinander übergehen. Rein rechnerisch, ohne three.js – testbar.
 */

export interface SmoothTopology {
  /** Partikel des groben Netzes */
  count: number;
  /** Kanten [a, b] (lokale Indizes); Mittelpunkt von Kante e hat den Index count + e */
  edges: Uint32Array;
  /** Dreiecke des feinen Netzes */
  tris: Uint32Array;
  /** Randpartikel (an Nähten oder freien Kanten) */
  boundary: Uint8Array;
}

export function smoothTopology(tris: ArrayLike<number>, count: number): SmoothTopology {
  const map = new Map<number, number>();
  const edges: number[] = [];
  const uses: number[] = [];
  const mid = (a: number, b: number) => {
    const key = a < b ? a * count + b : b * count + a;
    let e = map.get(key);
    if (e === undefined) {
      e = edges.length / 2;
      map.set(key, e);
      edges.push(a, b);
      uses.push(0);
    }
    uses[e]++;
    return count + e;
  };
  const fine: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t];
    const b = tris[t + 1];
    const c = tris[t + 2];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    fine.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const boundary = new Uint8Array(count);
  for (let e = 0; e < uses.length; e++)
    if (uses[e] === 1) {
      boundary[edges[2 * e]] = 1;
      boundary[edges[2 * e + 1]] = 1;
    }
  return { count, edges: Uint32Array.from(edges), tris: Uint32Array.from(fine), boundary };
}

/** Flächengewichtete Vertexnormalen (nicht normiert zurückgegeben, sondern normiert). */
export function vertexNormals(pos: ArrayLike<number>, tris: ArrayLike<number>, count: number, out: Float32Array): void {
  out.fill(0, 0, count * 3);
  for (let t = 0; t < tris.length; t += 3) {
    const a = 3 * tris[t];
    const b = 3 * tris[t + 1];
    const c = 3 * tris[t + 2];
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) {
      out[k] += nx;
      out[k + 1] += ny;
      out[k + 2] += nz;
    }
  }
  for (let i = 0; i < count; i++) normalize(out, 3 * i);
}

function normalize(v: Float32Array, k: number): void {
  const l = Math.hypot(v[k], v[k + 1], v[k + 2]);
  if (l > 1e-12) {
    v[k] /= l;
    v[k + 1] /= l;
    v[k + 2] /= l;
  } else {
    v[k + 1] = 1;
  }
}

/**
 * Feines Netz aus grober Lage und (ggf. über Nähte gemittelten) Normalen.
 * pos/nrm: grobe Werte (count × 3); outPos/outNrm: fein (count + edges) × 3.
 */
export function smoothFill(topo: SmoothTopology, pos: ArrayLike<number>, nrm: Float32Array, outPos: Float32Array, outNrm: Float32Array): void {
  const n = topo.count;
  for (let i = 0; i < n * 3; i++) {
    outPos[i] = pos[i];
    outNrm[i] = nrm[i];
  }
  const E = topo.edges;
  for (let e = 0; e < E.length / 2; e++) {
    const a = 3 * E[2 * e];
    const b = 3 * E[2 * e + 1];
    const dx = pos[b] - pos[a];
    const dy = pos[b + 1] - pos[a + 1];
    const dz = pos[b + 2] - pos[a + 2];
    // PN-Dreieck: Mittelpunkt der kubischen Kante = Mitte − (w_ab·n_a + w_ba·n_b) / 8
    const wab = dx * nrm[a] + dy * nrm[a + 1] + dz * nrm[a + 2];
    const wba = -(dx * nrm[b] + dy * nrm[b + 1] + dz * nrm[b + 2]);
    const k = 3 * (n + e);
    // Ausbeulung begrenzen: bei scharfen Falten nicht überschießen
    const len = Math.hypot(dx, dy, dz);
    const lim = len * 0.18;
    let ox = (wab * nrm[a] + wba * nrm[b]) / 8;
    let oy = (wab * nrm[a + 1] + wba * nrm[b + 1]) / 8;
    let oz = (wab * nrm[a + 2] + wba * nrm[b + 2]) / 8;
    const ol = Math.hypot(ox, oy, oz);
    if (ol > lim) {
      ox *= lim / ol;
      oy *= lim / ol;
      oz *= lim / ol;
    }
    outPos[k] = (pos[a] + pos[b]) / 2 - ox;
    outPos[k + 1] = (pos[a + 1] + pos[b + 1]) / 2 - oy;
    outPos[k + 2] = (pos[a + 2] + pos[b + 2]) / 2 - oz;
    outNrm[k] = nrm[a] + nrm[b];
    outNrm[k + 1] = nrm[a + 1] + nrm[b + 1];
    outNrm[k + 2] = nrm[a + 2] + nrm[b + 2];
    normalize(outNrm, k);
  }
}

/** Werte je grobem Partikel (z. B. Farben, 3 Kanäle) auf das feine Netz übertragen. */
export function smoothAttr(topo: SmoothTopology, src: ArrayLike<number>, out: Float32Array, size: number): void {
  const n = topo.count;
  for (let i = 0; i < n * size; i++) out[i] = src[i];
  const E = topo.edges;
  for (let e = 0; e < E.length / 2; e++) {
    const a = size * E[2 * e];
    const b = size * E[2 * e + 1];
    const k = size * (n + e);
    for (let c = 0; c < size; c++) out[k + c] = (src[a + c] + src[b + c]) / 2;
  }
}

/**
 * Paare von Randpartikeln verschiedener Teile, die (fast) aufeinander liegen – das sind die Nähte.
 * Liefert globale Indizes [i, j, …].
 */
export function seamPairs(pos: ArrayLike<number>, parts: { offset: number; count: number; boundary: Uint8Array }[], tol = 4): Uint32Array {
  const cell = tol * 2;
  const grid = new Map<string, number[]>();
  const owner = new Map<number, number>();
  parts.forEach((p, pi) => {
    for (let i = 0; i < p.count; i++) {
      if (!p.boundary[i]) continue;
      const g = p.offset + i;
      owner.set(g, pi);
      const key = `${Math.floor(pos[3 * g] / cell)},${Math.floor(pos[3 * g + 1] / cell)},${Math.floor(pos[3 * g + 2] / cell)}`;
      const list = grid.get(key);
      if (list) list.push(g);
      else grid.set(key, [g]);
    }
  });
  const out: number[] = [];
  for (const [g, pi] of owner) {
    const x = pos[3 * g];
    const y = pos[3 * g + 1];
    const z = pos[3 * g + 2];
    const ix = Math.floor(x / cell);
    const iy = Math.floor(y / cell);
    const iz = Math.floor(z / cell);
    for (let dz = -1; dz <= 1; dz++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const list = grid.get(`${ix + dx},${iy + dy},${iz + dz}`);
          if (!list) continue;
          for (const h of list) {
            if (h <= g || owner.get(h) === pi) continue;
            if (Math.hypot(pos[3 * h] - x, pos[3 * h + 1] - y, pos[3 * h + 2] - z) < tol) out.push(g, h);
          }
        }
  }
  return Uint32Array.from(out);
}
