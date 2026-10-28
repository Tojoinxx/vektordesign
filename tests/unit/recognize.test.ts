import { describe, expect, it } from 'vitest';
import { recognize } from '../../src/model/recognize';
import type { Vec2 } from '../../src/model/types';

// Reproduzierbares Zittern wie bei einer Hand
let seed = 7;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647 - 0.5;
};
const jitter = (pts: Vec2[], a: number) => pts.map((p) => ({ x: p.x + rnd() * a, y: p.y + rnd() * a }));
function along(poly: Vec2[], n: number, closed: boolean): Vec2[] {
  const out: Vec2[] = [];
  const segs = closed ? poly.length : poly.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  out.push(closed ? { ...poly[0] } : poly[poly.length - 1]);
  return out;
}

describe('Formerkennung (Freihandskizze)', () => {
  it('Gerade, fast waagrecht → waagrechte Linie', () => {
    const r = recognize(jitter(along([{ x: 0, y: 0 }, { x: 60, y: 3 }], 40, false), 0.8));
    expect(r.kind).toBe('line');
    if (r.kind === 'line') {
      expect(r.hv).toBe('h');
      expect(r.b.y).toBe(r.a.y);
    }
  });

  it('schräge Gerade bleibt schräg', () => {
    const r = recognize(jitter(along([{ x: 0, y: 0 }, { x: 40, y: 30 }], 40, false), 0.6));
    expect(r.kind).toBe('line');
    if (r.kind === 'line') expect(r.hv).toBeNull();
  });

  it('wackliger Kreis → Kreis mit passendem Mittelpunkt und Radius', () => {
    const pts: Vec2[] = [];
    for (let i = 0; i <= 80; i++) {
      const t = (i / 80) * Math.PI * 2.05;
      const rr = 20 + Math.sin(t * 3) * 0.8;
      pts.push({ x: 10 + rr * Math.cos(t), y: -5 + rr * Math.sin(t) });
    }
    const r = recognize(jitter(pts, 0.8));
    expect(r.kind).toBe('circle');
    if (r.kind === 'circle') {
      expect(r.c.x).toBeCloseTo(10, 0);
      expect(r.c.y).toBeCloseTo(-5, 0);
      expect(Math.abs(r.r - 20)).toBeLessThan(1.2);
    }
  });

  it('grobes Rechteck (Start an einer Ecke) → achsparalleles Rechteck', () => {
    const r = recognize(jitter(along([{ x: 0, y: 0 }, { x: 80, y: 1.5 }, { x: 81, y: 41 }, { x: 1, y: 40 }], 25, true), 1.2));
    expect(r.kind).toBe('rect');
    if (r.kind === 'rect') {
      expect(Math.abs(r.max.x - r.min.x - 80)).toBeLessThan(3);
      expect(Math.abs(r.max.y - r.min.y - 40)).toBeLessThan(3);
    }
  });

  it('Rechteck mit Start mitten auf einer Kante wird ebenfalls erkannt', () => {
    const r = recognize(jitter(along([{ x: 40, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 30 }, { x: 0, y: 30 }, { x: 0, y: 0 }], 25, true), 1));
    expect(r.kind).toBe('rect');
  });

  it('Dreieck → geschlossenes Dreieck', () => {
    const r = recognize(jitter(along([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 25, y: 40 }], 30, true), 0.8));
    expect(r.kind).toBe('polygon');
    if (r.kind === 'polygon') {
      expect(r.closed).toBe(true);
      expect(r.pts).toHaveLength(3);
    }
  });

  it('offener Zickzack → Linienzug', () => {
    const r = recognize(jitter(along([{ x: 0, y: 0 }, { x: 20, y: 20 }, { x: 40, y: 0 }, { x: 60, y: 20 }], 20, false), 0.5));
    expect(r.kind).toBe('polygon');
    if (r.kind === 'polygon') {
      expect(r.closed).toBe(false);
      expect(r.pts).toHaveLength(4);
    }
  });
});
