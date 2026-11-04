import type { PatternMaterial } from '../model/types';

/**
 * Streifenstoff (Ringel): Bänder quer zum Fadenlauf. Position `d` = Abstand von der Oberkante des Teils (mm)
 * plus Versatz des Teils. Gemeinsam genutzt von Schnitt-Anzeige, 3D-Ansicht und Tech-Pack.
 */

export type Stripes = NonNullable<PatternMaterial['stripes']>;

export function hasStripes(m: PatternMaterial | null | undefined): m is PatternMaterial & { stripes: Stripes } {
  return !!m?.stripes && m.stripes.width > 0 && m.stripes.stripeWidth > 0;
}

/** Bänder der Streifenfarbe im Bereich [from, to) (mm), jeweils [Anfang, Ende]. */
export function stripeBands(s: Stripes, from: number, to: number): [number, number][] {
  const period = s.width + s.stripeWidth;
  if (period <= 0) return [];
  const out: [number, number][] = [];
  // erster Streifen, der vor `from` beginnt
  let a = s.start + Math.floor((from - s.start) / period) * period;
  for (; a < to; a += period) {
    const b = a + s.stripeWidth;
    if (b > from) out.push([Math.max(a, from), Math.min(b, to)]);
  }
  return out;
}

/** Farbe an Position d. */
export function stripeColorAt(m: PatternMaterial & { stripes: Stripes }, d: number): string {
  const s = m.stripes;
  const period = s.width + s.stripeWidth;
  const x = (((d - s.start) % period) + period) % period;
  return x < s.stripeWidth ? s.stripe : m.color;
}

/** Kurztext für Tech-Pack und Listen. */
export function stripeText(m: PatternMaterial & { stripes: Stripes }): string {
  const s = m.stripes;
  const mm = (v: number) => `${Math.round(v * 10) / 10}`.replace('.', ',');
  return `Ringel: ${m.color.toUpperCase()} ${mm(s.width)} mm / ${s.stripe.toUpperCase()} ${mm(s.stripeWidth)} mm, erster Streifen ${mm(s.start)} mm unter Halspunkt`;
}
