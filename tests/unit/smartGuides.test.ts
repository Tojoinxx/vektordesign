import { describe, expect, it } from 'vitest';
import { smartSnap } from '../../src/tools/smartGuides';

const box = (x: number, y: number, w: number, h: number) => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });

describe('Smarte Hilfslinien', () => {
  it('Kante rastet an der Kante eines anderen Objekts ein, mit Hilfslinie', () => {
    const r = smartSnap(box(0, 0, 10, 10), 48.6, 30, [box(60, 0, 20, 20)], 1);
    // rechte Kante 58,6 → nicht in Reichweite; linke Kante 48,6 … Mitte 53,6 … nichts → kein Fang in x
    expect(r.dx).toBeCloseTo(48.6);
    const r2 = smartSnap(box(0, 0, 10, 10), 50.4, 30, [box(60, 0, 20, 20)], 1);
    // rechte Kante 60,4 → 60
    expect(r2.dx).toBeCloseTo(50);
    expect(r2.lines.some((l) => l.axis === 'x' && Math.abs(l.at - 60) < 1e-6)).toBe(true);
  });

  it('Mitte rastet an Mitte ein (Objekte zentrieren)', () => {
    const r = smartSnap(box(0, 0, 10, 10), 34.7, 80, [box(20, 0, 40, 40)], 1);
    expect(r.dx).toBeCloseTo(35);
    expect(r.lines.some((l) => l.axis === 'x' && Math.abs(l.at - 40) < 1e-6)).toBe(true);
  });

  it('Ursprung als Fanglinie', () => {
    const r = smartSnap(box(10, 10, 10, 10), -14.6, 0, [], 1, { x: [0], y: [0] });
    expect(r.dx).toBeCloseTo(-15); // Mitte auf x = 0
  });

  it('Gleiche Abstände in einer Reihe werden erkannt und markiert', () => {
    // A [0,10], B [20,30] → Abstand 10; C wird rechts daneben gezogen
    const others = [box(0, 0, 10, 10), box(20, 0, 10, 10)];
    const r = smartSnap(box(100, 0, 10, 10), -59.3, 0, others, 1);
    expect(r.dx).toBeCloseTo(-60); // C links bei 40 = 30 + 10
    expect(r.gaps.filter((g) => g.equal).length).toBeGreaterThanOrEqual(2);
  });

  it('Genau mittig zwischen zwei Nachbarn', () => {
    const others = [box(0, 0, 10, 10), box(50, 0, 10, 10)];
    const r = smartSnap(box(100, 0, 10, 10), -74.4, 0, others, 1);
    // frei 40 − 10 = 30 → links 10 + 15 = 25
    expect(r.dx).toBeCloseTo(-75);
    const eq = r.gaps.filter((g) => g.equal);
    expect(eq.length).toBe(2);
    expect(eq.every((g) => Math.abs(g.b - g.a - 15) < 1e-6)).toBe(true);
  });

  it('Außerhalb der Fangweite bleibt die Mausbewegung unverändert', () => {
    const r = smartSnap(box(0, 0, 10, 10), 23.3, 17.7, [box(100, 100, 5, 5)], 1);
    expect(r.dx).toBeCloseTo(23.3);
    expect(r.dy).toBeCloseTo(17.7);
    expect(r.lines).toEqual([]);
  });
});
