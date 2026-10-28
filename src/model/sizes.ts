import { produce } from 'immer';
import type { Motif, SizeGrade, SketchDoc } from './types';
import { motifDoc, motifEntities, motifSize } from './production';
import { applyXf } from '../store/xform';

/**
 * Größenstaffel: dasselbe Motiv je Kleidergröße in eigener Breite (z. B. S 24 cm, XL 30 cm).
 * Angegeben in Prozent der gezeichneten Größe (100 % = wie gezeichnet, üblich für M).
 */

export const SIZE_PRESETS: { id: string; name: string; sizes: [string, number][] }[] = [
  {
    id: 's-xl',
    name: 'S–XL',
    sizes: [
      ['S', 92],
      ['M', 100],
      ['L', 108],
      ['XL', 115],
    ],
  },
  {
    id: 'xs-3xl',
    name: 'XS–3XL',
    sizes: [
      ['XS', 85],
      ['S', 92],
      ['M', 100],
      ['L', 108],
      ['XL', 115],
      ['XXL', 120],
      ['3XL', 125],
    ],
  },
  {
    id: 'groups',
    name: '3 Gruppen',
    sizes: [
      ['XS–S', 90],
      ['M–L', 100],
      ['XL–3XL', 112],
    ],
  },
  {
    id: 'kids',
    name: 'Kinder 104–164',
    sizes: [
      ['104', 60],
      ['116', 66],
      ['128', 72],
      ['140', 80],
      ['152', 88],
      ['164', 95],
    ],
  },
];

export function presetSizes(id: string): SizeGrade[] {
  const p = SIZE_PRESETS.find((x) => x.id === id) ?? SIZE_PRESETS[0];
  return p.sizes.map(([name, pct], i) => ({ id: `gr${i + 1}`, name, pct }));
}

/** Größe des Motivs in einer Staffelgröße (mm). */
export function gradedSize(doc: SketchDoc, m: Motif, g: SizeGrade): { w: number; h: number } | null {
  const s = motifSize(doc, m);
  if (!s) return null;
  return { w: (s.w * g.pct) / 100, h: (s.h * g.pct) / 100 };
}

/**
 * Motiv-Zeichnung, gleichmäßig skaliert um die obere Mitte (so bleibt der Abstand zum Kragen
 * gleich). Bemaßungen mit Zahlenwerten werden mitskaliert.
 */
export function gradedMotifDoc(doc: SketchDoc, m: Motif, pct: number): SketchDoc {
  const md = motifDoc(doc, m);
  if (Math.abs(pct - 100) < 1e-9) return md;
  const s = motifSize(doc, m);
  if (!s) return md;
  const ids = motifEntities(doc, m).map((e) => e.id);
  return produce(md, (d) => {
    applyXf(d, ids, { kind: 'scale', k: pct / 100, cx: (s.box.minX + s.box.maxX) / 2, cy: s.box.maxY });
  });
}

/** Dateinamen-Zusatz einer Größe */
export const sizeSuffix = (g: SizeGrade) => `Gr-${g.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
