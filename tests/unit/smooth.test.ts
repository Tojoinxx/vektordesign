import { describe, expect, it } from 'vitest';
import { seamPairs, smoothAttr, smoothFill, smoothTopology, vertexNormals } from '../../src/viewer3d/smooth';

describe('Glatte Stoffdarstellung', () => {
  it('Aus einem Dreieck werden vier, Randpunkte erkannt', () => {
    const t = smoothTopology([0, 1, 2, 0, 2, 3], 4);
    expect(t.tris.length).toBe(2 * 4 * 3);
    expect(t.edges.length / 2).toBe(5);
    expect(Array.from(t.boundary)).toEqual([1, 1, 1, 1]);
  });

  it('Mittelpunkte liegen auf der gekrümmten Fläche (Kugel: nach außen gewölbt)', () => {
    // Achtel einer Kugel mit Radius 100: Ecken auf den Achsen, Normalen = Richtung vom Mittelpunkt
    const pos = new Float32Array([100, 0, 0, 0, 100, 0, 0, 0, 100]);
    const topo = smoothTopology([0, 1, 2], 3);
    const nrm = new Float32Array(9);
    vertexNormals(pos, [0, 1, 2], 3, nrm);
    // Flächennormale zeigt nach außen → Vertexnormalen durch exakte Kugelnormalen ersetzen
    nrm.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const out = new Float32Array(6 * 3);
    const on = new Float32Array(6 * 3);
    smoothFill(topo, pos, nrm, out, on);
    for (let e = 0; e < 3; e++) {
      const k = 3 * (3 + e);
      const r = Math.hypot(out[k], out[k + 1], out[k + 2]);
      // flacher Mittelpunkt hätte r = 70,7; gewölbt deutlich näher an 100
      expect(r).toBeGreaterThan(80);
      expect(r).toBeLessThan(102);
    }
    const col = new Float32Array(6);
    smoothAttr(topo, [0, 2, 4], col, 1);
    expect(Array.from(col.slice(3)).sort()).toEqual([1, 2, 3]);
  });

  it('Nähte: Randpunkte zweier Teile, die aufeinander liegen', () => {
    const pos = new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1, 10, 0, 1, 50, 50, 50]);
    const b = new Uint8Array([1, 1, 1]);
    const pairs = seamPairs(pos, [
      { offset: 0, count: 3, boundary: b },
      { offset: 3, count: 3, boundary: b },
    ]);
    expect(Array.from(pairs)).toEqual([0, 3, 1, 4]);
  });
});
