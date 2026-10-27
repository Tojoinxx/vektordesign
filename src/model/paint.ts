import type { Gradient, GradientStop, Paint, Vec2 } from './types';
import type { BBox } from './geometry';

export const isGradient = (p: Paint | null | undefined): p is Gradient => !!p && typeof p === 'object';

/** Stellvertretende Volltonfarbe (für Vorschauen, Farblisten, Kontrast). */
export function paintColor(p: Paint | null | undefined): string | null {
  if (!p) return null;
  if (typeof p === 'string') return p;
  return p.stops[0]?.color ?? null;
}

export type GradientDirection = 'lr' | 'rl' | 'tb' | 'bt' | 'center';

/** Vorgaben in Objekt-Box-Koordinaten (u: links→rechts, v: unten→oben). */
export const DIRECTION_POINTS: Record<GradientDirection, { from: Vec2; to: Vec2 }> = {
  lr: { from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } },
  rl: { from: { x: 1, y: 0.5 }, to: { x: 0, y: 0.5 } },
  tb: { from: { x: 0.5, y: 1 }, to: { x: 0.5, y: 0 } },
  bt: { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 1 } },
  center: { from: { x: 0.5, y: 0.5 }, to: { x: 1, y: 0.5 } },
};

export const DIRECTION_LABELS: Record<GradientDirection, string> = {
  lr: 'Links → rechts',
  rl: 'Rechts → links',
  tb: 'Oben → unten',
  bt: 'Unten → oben',
  center: 'Von der Mitte',
};

export function makeGradient(
  stops: GradientStop[],
  dir: GradientDirection = 'lr',
  kind: Gradient['kind'] = dir === 'center' ? 'radial' : 'linear',
): Gradient {
  const p = DIRECTION_POINTS[dir];
  return { kind, stops: stops.map((s) => ({ ...s })), from: { ...p.from }, to: { ...p.to } };
}

/** Zwei-Farben-Verlauf. */
export function twoColorGradient(a: string, b: string, dir: GradientDirection = 'lr'): Gradient {
  return makeGradient(
    [
      { offset: 0, color: a, opacity: 1 },
      { offset: 1, color: b, opacity: 1 },
    ],
    dir,
  );
}

/** „Verblassen“: Farbe läuft in Transparenz aus. */
export function fadeGradient(color: string, dir: GradientDirection = 'lr'): Gradient {
  return makeGradient(
    [
      { offset: 0, color, opacity: 1 },
      { offset: 1, color, opacity: 0 },
    ],
    dir,
  );
}

/** Ist der Verlauf ein „Verblassen“ (letzte Stufe durchsichtig)? */
export function isFade(g: Gradient): boolean {
  const last = g.stops[g.stops.length - 1];
  return !!last && last.opacity === 0;
}

/** Verlaufspunkte in Weltkoordinaten (mm). */
export function gradientToWorld(g: Gradient, box: BBox): { from: Vec2; to: Vec2 } {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  return {
    from: { x: box.minX + g.from.x * w, y: box.minY + g.from.y * h },
    to: { x: box.minX + g.to.x * w, y: box.minY + g.to.y * h },
  };
}

/** Weltkoordinaten (mm) → Box-Koordinaten. */
export function worldToGradientPoint(p: Vec2, box: BBox): Vec2 {
  const w = box.maxX - box.minX || 1;
  const h = box.maxY - box.minY || 1;
  return { x: (p.x - box.minX) / w, y: (p.y - box.minY) / h };
}

export function sortedStops(g: Gradient): GradientStop[] {
  return [...g.stops].sort((a, b) => a.offset - b.offset);
}

/** Farbe an Position t (0…1) – für neue Zwischenstufen. */
export function colorAt(g: Gradient, t: number): { color: string; opacity: number } {
  const s = sortedStops(g);
  if (!s.length) return { color: '#000000', opacity: 1 };
  if (t <= s[0].offset) return { color: s[0].color, opacity: s[0].opacity };
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i];
    const b = s[i + 1];
    if (t <= b.offset) {
      const k = (t - a.offset) / (b.offset - a.offset || 1);
      const ca = parseInt(a.color.slice(1), 16);
      const cb = parseInt(b.color.slice(1), 16);
      const ch = (shift: number) => Math.round(((ca >> shift) & 255) * (1 - k) + ((cb >> shift) & 255) * k);
      const hex = `#${[16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('')}`;
      return { color: hex, opacity: a.opacity * (1 - k) + b.opacity * k };
    }
  }
  const l = s[s.length - 1];
  return { color: l.color, opacity: l.opacity };
}
