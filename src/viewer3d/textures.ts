import * as THREE from 'three';
import type { PatternMaterial } from '../model/types';

/**
 * Prozedurale Stoffstrukturen als Normal-Maps (keine Bilddateien nötig): Maschenbild für Jersey/Sweat,
 * Rippe für Bündchen, Köper für Denim, Leinwand für Webware, Löcher für Mesh. Kachelgröße in mm.
 */

type Height = (x: number, y: number) => number;

const HEIGHTS: Record<PatternMaterial['fabric'], { tile: number; f: Height; strength: number }> = {
  // Maschen: V-förmige Schlingen in Säulen
  jersey: { tile: 4, strength: 1.2, f: (x, y) => Math.sin(Math.PI * x) ** 2 * (0.6 + 0.4 * Math.cos(2 * Math.PI * (y + Math.abs(x - 0.5)))) },
  sweat: { tile: 5, strength: 1.0, f: (x, y) => Math.sin(Math.PI * x) ** 2 * (0.6 + 0.4 * Math.cos(2 * Math.PI * (y + Math.abs(x - 0.5)))) },
  fleece: { tile: 6, strength: 0.5, f: (x, y) => 0.5 + 0.25 * Math.sin(2 * Math.PI * x * 3 + Math.sin(2 * Math.PI * y * 2) * 2) * Math.cos(2 * Math.PI * y * 3) },
  rib: { tile: 6, strength: 2.4, f: (x) => (x < 0.5 ? Math.sin(Math.PI * x * 2) ** 2 : 0.15) },
  woven: { tile: 2, strength: 0.8, f: (x, y) => ((Math.floor(x * 2) + Math.floor(y * 2)) % 2 ? Math.sin(Math.PI * ((x * 2) % 1)) : Math.sin(Math.PI * ((y * 2) % 1))) },
  denim: { tile: 4, strength: 1.4, f: (x, y) => 0.5 + 0.5 * Math.sin(2 * Math.PI * (x * 2 + y * 2)) },
  nylon: { tile: 3, strength: 0.25, f: (x, y) => 0.5 + 0.5 * Math.sin(2 * Math.PI * x) * Math.sin(2 * Math.PI * y) },
  mesh: { tile: 4, strength: 2.0, f: (x, y) => (Math.hypot(x - 0.5, y - 0.5) < 0.28 ? 0 : 1) },
};

const cache = new Map<string, THREE.Texture>();

export function fabricTileMm(fabric: PatternMaterial['fabric']): number {
  return HEIGHTS[fabric].tile;
}

/** Normal-Map einer Stoffart (eine Kachel, wiederholbar). */
export function fabricNormalMap(fabric: PatternMaterial['fabric']): THREE.Texture {
  const hit = cache.get(fabric);
  if (hit) return hit;
  const { f, strength } = HEIGHTS[fabric];
  const S = 64;
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[y * S + x] = f(x / S, y / S);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x - 1 + S) % S)];
      const hy = hgt[((y + 1) % S) * S + x] - hgt[((y - 1 + S) % S) * S + x];
      const nx = -hx * strength;
      const ny = -hy * strength;
      const l = Math.hypot(nx, ny, 1);
      const k = 4 * (y * S + x);
      data[k] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  cache.set(fabric, tex);
  return tex;
}

/** Aussehen je Stoffart für MeshPhysicalMaterial. */
export function fabricLook(fabric: PatternMaterial['fabric']): { roughness: number; sheen: number; sheenRoughness: number; normalScale: number; clearcoat?: number; transmission?: number } {
  switch (fabric) {
    case 'nylon':
      return { roughness: 0.42, sheen: 0.2, sheenRoughness: 0.4, normalScale: 0.25, clearcoat: 0.25 };
    case 'denim':
      return { roughness: 0.9, sheen: 0.3, sheenRoughness: 0.8, normalScale: 0.9 };
    case 'fleece':
      return { roughness: 1, sheen: 1, sheenRoughness: 0.9, normalScale: 0.4 };
    case 'sweat':
      return { roughness: 0.95, sheen: 0.7, sheenRoughness: 0.75, normalScale: 0.6 };
    case 'rib':
      return { roughness: 0.92, sheen: 0.6, sheenRoughness: 0.7, normalScale: 1.1 };
    case 'mesh':
      return { roughness: 0.8, sheen: 0.4, sheenRoughness: 0.6, normalScale: 1 };
    case 'woven':
      return { roughness: 0.85, sheen: 0.4, sheenRoughness: 0.6, normalScale: 0.6 };
    default:
      return { roughness: 0.9, sheen: 0.6, sheenRoughness: 0.7, normalScale: 0.7 };
  }
}
