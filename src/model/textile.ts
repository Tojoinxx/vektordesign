import type { Gradient, Vec2 } from './types';
import { intersectArea, subtractArea, unionArea } from './boolean';
import { sortedStops } from './paint';

/**
 * Textile Effekte als echte Vektorflächen (druck- und plotbar):
 * - Halbtonraster: Verläufe und Transparenz als Punkte (für Siebdruck/Flex)
 * - Used-Look: zufällige Ausbrüche und Kratzer werden aus der Fläche entfernt
 * - Rapport: nahtlos kachelbare Kachel für Allover-Druck
 */

// ---------------------------------------------------------------------------
// Halbton
// ---------------------------------------------------------------------------

export interface HalftoneOptions {
  /** Rasterweite in Linien je Zoll (Textil üblich 25–45) */
  lpi: number;
  /** Rasterwinkel in Grad (üblich 22,5°) */
  angle: number;
  /** Kleinster Punkt in mm (feinere werden weggelassen, damit sie nicht zulaufen) */
  minDot: number;
}

export const DEFAULT_HALFTONE: HalftoneOptions = { lpi: 30, angle: 22.5, minDot: 0.15 };

function circlePoly(c: Vec2, r: number): Vec2[] {
  const n = r < 0.4 ? 8 : r < 1 ? 12 : 16;
  return Array.from({ length: n }, (_, i) => ({ x: c.x + r * Math.cos((2 * Math.PI * i) / n), y: c.y + r * Math.sin((2 * Math.PI * i) / n) }));
}

/**
 * Punkte auf einem gedrehten Raster: Punktfläche = Deckung × Zellfläche (runde Punkte,
 * ab etwa 78 % berühren sie sich und fließen ineinander). Ergebnis auf die Fläche beschnitten.
 */
export function halftone(area: Vec2[][], coverage: (p: Vec2) => number, opts: HalftoneOptions): Vec2[][] {
  if (!area.length) return [];
  const cell = 25.4 / Math.max(5, opts.lpi);
  const a = (opts.angle * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -u.y, y: u.x };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of area)
    for (const q of p) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  const c0 = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const R = Math.hypot(maxX - minX, maxY - minY) / 2 + cell;
  const n = Math.ceil(R / cell);
  const dots: Vec2[][] = [];
  const full: Vec2[] = [];
  for (let i = -n; i <= n; i++)
    for (let j = -n; j <= n; j++) {
      const p = { x: c0.x + (i * u.x + j * v.x) * cell, y: c0.y + (i * u.y + j * v.y) * cell };
      if (p.x < minX - cell || p.x > maxX + cell || p.y < minY - cell || p.y > maxY + cell) continue;
      const cov = Math.min(1, Math.max(0, coverage(p)));
      if (cov <= 0) continue;
      if (cov >= 0.999) {
        full.push(p);
        continue;
      }
      const r = cell * Math.sqrt(cov / Math.PI);
      if (2 * r < opts.minDot) continue;
      // ab ca. 78 % Deckung würden sich Kreise nicht mehr schließen: Radius bis zur Zellecke erlauben
      dots.push(circlePoly(p, Math.min(r, cell * 0.7072)));
    }
  // Volle Zellen als Quadrate (lückenlos)
  for (const p of full) {
    const h = cell / 2 + 1e-4;
    dots.push([
      { x: p.x + (-u.x - v.x) * h, y: p.y + (-u.y - v.y) * h },
      { x: p.x + (u.x - v.x) * h, y: p.y + (u.y - v.y) * h },
      { x: p.x + (u.x + v.x) * h, y: p.y + (u.y + v.y) * h },
      { x: p.x + (-u.x + v.x) * h, y: p.y + (-u.y + v.y) * h },
    ]);
  }
  return intersectArea(unionArea(dots), area);
}

/** Lage im Verlauf (0…1) für einen Weltpunkt. */
export function gradientT(g: Gradient, from: Vec2, to: Vec2, p: Vec2): number {
  if (g.kind === 'radial') {
    const r = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return Math.min(1, Math.hypot(p.x - from.x, p.y - from.y) / r);
  }
  const d = { x: to.x - from.x, y: to.y - from.y };
  const l2 = d.x * d.x + d.y * d.y || 1;
  return Math.min(1, Math.max(0, ((p.x - from.x) * d.x + (p.y - from.y) * d.y) / l2));
}

/**
 * Anteil einer Farbe an einer Stelle des Verlaufs, mal Deckkraft. Für einfarbiges Verblassen
 * ist das die Deckkraft; bei mehreren Farben je Farbe eine eigene Rasterebene (Duplex).
 */
export function colorWeight(g: Gradient, color: string, t: number): number {
  const st = sortedStops(g);
  if (!st.length) return 0;
  const w = (s: (typeof st)[0]) => (s.color.toLowerCase() === color.toLowerCase() ? s.opacity : 0);
  if (t <= st[0].offset) return w(st[0]);
  for (let i = 0; i < st.length - 1; i++) {
    const a = st[i];
    const b = st[i + 1];
    if (t <= b.offset) {
      const k = b.offset - a.offset > 1e-9 ? (t - a.offset) / (b.offset - a.offset) : 1;
      return w(a) * (1 - k) + w(b) * k;
    }
  }
  return w(st[st.length - 1]);
}

// ---------------------------------------------------------------------------
// Used-Look
// ---------------------------------------------------------------------------

export interface GrungeOptions {
  /** Stärke 0…1 (Anteil der Ausbrüche) */
  amount: number;
  /** Körnung: typische Größe der Ausbrüche in mm */
  grain: number;
  /** Zufallszahl – gleiche Zahl, gleiches Muster */
  seed: number;
  /** Kratzer zusätzlich */
  scratches: boolean;
}

export const DEFAULT_GRUNGE: GrungeOptions = { amount: 0.15, grain: 1.2, seed: 7, scratches: true };

function rng(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Unregelmäßiger Fleck (Kreis mit verrauschtem Radius). */
function blob(c: Vec2, r: number, rand: () => number): Vec2[] {
  const n = 9;
  const ph = rand() * Math.PI * 2;
  return Array.from({ length: n }, (_, i) => {
    const a = ph + (2 * Math.PI * i) / n;
    const rr = r * (0.55 + 0.9 * rand());
    return { x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) };
  });
}

/** Ausbruchmuster für eine Fläche (zum Abziehen). Deterministisch über `seed`. */
export function grungeMask(area: Vec2[][], opts: GrungeOptions): Vec2[][] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of area)
    for (const q of p) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  if (!Number.isFinite(minX)) return [];
  const rand = rng(opts.seed);
  const g = Math.max(0.2, opts.grain);
  const W = maxX - minX;
  const H = maxY - minY;
  const amount = Math.min(0.9, Math.max(0, opts.amount));
  // Anzahl so, dass etwa `amount` der Fläche betroffen ist (Flecken überlappen teilweise)
  const count = Math.min(12000, Math.round((amount * W * H) / (Math.PI * g * g * 0.075)));
  const out: Vec2[][] = [];
  for (let i = 0; i < count; i++) {
    // Häufchen bilden: halbe Flecken in der Nähe eines vorherigen
    const near = out.length && rand() < 0.5 ? out[Math.floor(rand() * out.length)][0] : null;
    const c = near ? { x: near.x + (rand() - 0.5) * g * 3, y: near.y + (rand() - 0.5) * g * 3 } : { x: minX + rand() * W, y: minY + rand() * H };
    // viele feine Sprenkel, wenige größere Ausbrüche
    const r = g * (0.06 + Math.pow(rand(), 3.2) * 0.75);
    out.push(blob(c, r, rand));
  }
  if (opts.scratches) {
    const k = Math.round(amount * 12 + 2);
    for (let i = 0; i < k; i++) {
      const c = { x: minX + rand() * W, y: minY + rand() * H };
      const len = (0.15 + rand() * 0.35) * Math.max(W, H);
      const a = (rand() - 0.5) * 0.9 + (rand() < 0.5 ? 0 : Math.PI / 2);
      const w = g * (0.08 + rand() * 0.15);
      const d = { x: Math.cos(a), y: Math.sin(a) };
      const nn = { x: -d.y * w, y: d.x * w };
      out.push([
        { x: c.x - d.x * len * 0.5, y: c.y - d.y * len * 0.5 },
        { x: c.x + nn.x, y: c.y + nn.y },
        { x: c.x + d.x * len * 0.5, y: c.y + d.y * len * 0.5 },
        { x: c.x - nn.x, y: c.y - nn.y },
      ]);
    }
  }
  return unionArea(out);
}

export function applyGrunge(area: Vec2[][], opts: GrungeOptions): Vec2[][] {
  return subtractArea(area, grungeMask(area, opts));
}

// ---------------------------------------------------------------------------
// Rapport
// ---------------------------------------------------------------------------

export type RapportMode = 'straight' | 'halfdrop' | 'brick';

export interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Versätze der Nachbarkacheln (Gitter des Rapports, die Kachel selbst inklusive). */
export function tileOffsets(t: Tile, mode: RapportMode): Vec2[] {
  const out: Vec2[] = [];
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      // Gitter: halber Versatz verschiebt jede Spalte (bzw. Reihe) um eine halbe Kachel
      const dx = i * t.w + (mode === 'brick' ? (j * t.w) / 2 : 0);
      const dy = j * t.h + (mode === 'halfdrop' ? (i * t.h) / 2 : 0);
      if (Math.abs(dx) > 1.6 * t.w || Math.abs(dy) > 1.6 * t.h) continue;
      out.push({ x: dx, y: dy });
    }
  return out;
}

/**
 * Teile, die über den Kachelrand ragen, erscheinen auf der Gegenseite – das Ergebnis lässt sich
 * lückenlos aneinandersetzen.
 */
export function rapportTile(area: Vec2[][], t: Tile, mode: RapportMode): Vec2[][] {
  const rect: Vec2[][] = [
    [
      { x: t.x, y: t.y },
      { x: t.x + t.w, y: t.y },
      { x: t.x + t.w, y: t.y + t.h },
      { x: t.x, y: t.y + t.h },
    ],
  ];
  const copies = tileOffsets(t, mode).flatMap((o) => area.map((p) => p.map((q) => ({ x: q.x + o.x, y: q.y + o.y }))));
  return intersectArea(unionArea(copies), rect);
}
