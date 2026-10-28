import type { Separation } from './separation';

/**
 * Kostenschätzung je Veredelung aus der Separation (Farben, Flächen, Rahmen) und
 * einstellbaren Preisen. Bewusst einfach und nachvollziehbar – jede Zeile zeigt ihre Rechnung.
 */

export interface Prices {
  /** Flex-/Flockfolie je m² */
  flexPerM2: number;
  /** Plotten, Entgittern, Pressen je Farbe und Stück */
  flexWorkPerColor: number;
  /** Folienrand um jedes Farbteil (mm) */
  flexMargin: number;
  /** Sieb inkl. Film und Einrichten je Farbe (einmalig) */
  screenSetupPerColor: number;
  /** Druck je Farbe und Stück */
  screenPerColor: number;
  /** DTF-Transfer je m² Folie */
  dtfPerM2: number;
  /** DTF Pressen je Stück */
  dtfPressPerPiece: number;
  /** Stick: Programm erstellen (einmalig) */
  embroiderySetup: number;
  /** Stick je 1000 Stiche */
  embroideryPer1000: number;
  /** Stiche je mm² Fläche (Füllstich) */
  stitchesPerMm2: number;
}

export const DEFAULT_PRICES: Prices = {
  flexPerM2: 28,
  flexWorkPerColor: 1.2,
  flexMargin: 10,
  screenSetupPerColor: 30,
  screenPerColor: 0.55,
  dtfPerM2: 22,
  dtfPressPerPiece: 0.9,
  embroiderySetup: 35,
  embroideryPer1000: 1.1,
  stitchesPerMm2: 1.2,
};

export const PRICE_LABELS: Record<keyof Prices, { label: string; unit: string; group: string }> = {
  flexPerM2: { label: 'Folie', unit: '€/m²', group: 'Flex / Flock' },
  flexWorkPerColor: { label: 'Plotten, Entgittern, Pressen je Farbe', unit: '€/Stück', group: 'Flex / Flock' },
  flexMargin: { label: 'Folienrand je Farbteil', unit: 'mm', group: 'Flex / Flock' },
  screenSetupPerColor: { label: 'Sieb und Film je Farbe (einmalig)', unit: '€', group: 'Siebdruck' },
  screenPerColor: { label: 'Druck je Farbe', unit: '€/Stück', group: 'Siebdruck' },
  dtfPerM2: { label: 'Transferfolie', unit: '€/m²', group: 'DTF' },
  dtfPressPerPiece: { label: 'Pressen', unit: '€/Stück', group: 'DTF' },
  embroiderySetup: { label: 'Stickprogramm (einmalig)', unit: '€', group: 'Stick' },
  embroideryPer1000: { label: 'je 1000 Stiche', unit: '€', group: 'Stick' },
  stitchesPerMm2: { label: 'Stichdichte', unit: 'Stiche/mm²', group: 'Stick' },
};

const KEY = 'vd.prices';

export function loadPrices(): Prices {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PRICES, ...(JSON.parse(raw) as Partial<Prices>) };
  } catch {
    /* kein Speicher */
  }
  return { ...DEFAULT_PRICES };
}

export function savePrices(p: Prices): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* kein Speicher */
  }
}

export interface CostRow {
  id: 'screen' | 'dtf' | 'flex' | 'embroidery';
  name: string;
  oneTime: number;
  perPiece: number;
  total: number;
  /** Rechenweg in Worten */
  details: string[];
}

const eur = (n: number) => `${n.toFixed(2).replace('.', ',')} €`;
const fmt = (n: number, d = 1) => n.toFixed(d).replace('.', ',');

function bboxOf(polys: { x: number; y: number }[][]): { w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polys)
    for (const q of p) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  return Number.isFinite(minX) ? { w: maxX - minX, h: maxY - minY } : null;
}

/**
 * Schätzung für `qty` Stück. `sep` ist die Separation des Motivs (ohne Unterlage für Flex/Stick,
 * mit Unterlage für Siebdruck auf dunklem Stoff).
 */
export function estimateCosts(sep: Separation, qty: number, prices: Prices): CostRow[] {
  const n = Math.max(1, Math.round(qty));
  const colors = sep.plates.filter((p) => p.kind === 'color');
  const screens = sep.plates.length;
  const box = sep.box;
  const w = box ? box.maxX - box.minX : 0;
  const h = box ? box.maxY - box.minY : 0;
  const rows: CostRow[] = [];

  // Siebdruck
  {
    const oneTime = screens * prices.screenSetupPerColor;
    const per = screens * prices.screenPerColor;
    rows.push({
      id: 'screen',
      name: 'Siebdruck',
      oneTime,
      perPiece: per,
      total: oneTime + per * n,
      details: [
        `${screens} Sieb${screens === 1 ? '' : 'e'}${sep.underbase ? ' (inkl. weißer Unterlage)' : ''} × ${eur(prices.screenSetupPerColor)} einmalig`,
        `${screens} × ${eur(prices.screenPerColor)} Druck je Stück`,
      ],
    });
  }
  // DTF: Rechteck des Motivs plus 5 mm Rand, unabhängig von der Farbanzahl
  {
    const m2 = ((w + 10) * (h + 10)) / 1e6;
    const per = m2 * prices.dtfPerM2 + prices.dtfPressPerPiece;
    rows.push({
      id: 'dtf',
      name: 'DTF',
      oneTime: 0,
      perPiece: per,
      total: per * n,
      details: [`Transfer ${fmt(w + 10, 0)} × ${fmt(h + 10, 0)} mm = ${fmt(m2 * 1e4, 0)} cm² × ${eur(prices.dtfPerM2)}/m²`, `Pressen ${eur(prices.dtfPressPerPiece)} – Farbanzahl egal`],
    });
  }
  // Flex: je Farbe ein Folienstück (Rechteck des Farbteils plus Rand)
  {
    let m2 = 0;
    const parts: string[] = [];
    for (const c of colors) {
      const b = bboxOf(c.polys);
      if (!b) continue;
      const a = ((b.w + 2 * prices.flexMargin) * (b.h + 2 * prices.flexMargin)) / 1e6;
      m2 += a;
      parts.push(`${c.color.toUpperCase()}: ${fmt(a * 1e4, 0)} cm²`);
    }
    const per = m2 * prices.flexPerM2 + colors.length * prices.flexWorkPerColor;
    rows.push({
      id: 'flex',
      name: 'Flex / Flock',
      oneTime: 0,
      perPiece: per,
      total: per * n,
      details: [
        `Folie ${fmt(m2 * 1e4, 0)} cm² × ${eur(prices.flexPerM2)}/m² (${parts.join(', ') || '–'})`,
        `${colors.length} Farbe${colors.length === 1 ? '' : 'n'} × ${eur(prices.flexWorkPerColor)} Arbeit`,
      ],
    });
  }
  // Stick: Stiche aus der Fläche
  {
    const area = colors.reduce((s, c) => s + c.area, 0);
    const stitches = Math.round(area * prices.stitchesPerMm2);
    const per = (stitches / 1000) * prices.embroideryPer1000;
    rows.push({
      id: 'embroidery',
      name: 'Stick',
      oneTime: prices.embroiderySetup,
      perPiece: per,
      total: prices.embroiderySetup + per * n,
      details: [`≈ ${stitches.toLocaleString('de-DE')} Stiche (${fmt(area / 100, 1)} cm² × ${fmt(prices.stitchesPerMm2, 1)}/mm²)`, `Stickprogramm ${eur(prices.embroiderySetup)} einmalig`],
    });
  }
  return rows;
}

/** Ab welcher Stückzahl ist Siebdruck günstiger als DTF? */
export function breakEven(rows: CostRow[]): number | null {
  const s = rows.find((r) => r.id === 'screen');
  const d = rows.find((r) => r.id === 'dtf');
  if (!s || !d || s.perPiece >= d.perPiece) return null;
  return Math.ceil(s.oneTime / (d.perPiece - s.perPiece));
}
