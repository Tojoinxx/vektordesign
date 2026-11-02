/**
 * Größentabellen vorhandener Produkte (z. B. aus einem Online-Shop) lesen: eingefügter Text aus Shop, PDF oder
 * Excel wird in Messpunkte der Maßtabelle (A–R, mm) je Größe übersetzt. Deutsch und Englisch, cm oder inch,
 * halbe Weite (flach gemessen) oder ganzer Umfang.
 */

/** Größen der Maßtabelle (Herren/Unisex bzw. Damen) – Schreibweisen aus Shops. */
const SIZE_ALIASES: Record<string, string> = {
  XXS: 'XXS',
  XS: 'XS',
  S: 'S',
  M: 'M',
  L: 'L',
  XL: 'XL',
  XXL: 'XXL',
  '2XL': 'XXL',
  XXXL: '3XL',
  '3XL': '3XL',
  '4XL': '4XL',
  XXXXL: '4XL',
};

export function normalizeSize(s: string): string | null {
  return SIZE_ALIASES[s.trim().toUpperCase()] ?? null;
}

/** Messpunkt aus der Zeilenbeschriftung erkennen (Reihenfolge: spezielle Begriffe zuerst). */
const POM_WORDS: [string, RegExp][] = [
  ['hoodH', /(hood|kapuze)\w*\s*(height|höhe|hoehe|length|länge)/i],
  ['hoodW', /(hood|kapuze)\w*\s*(width|breite)/i],
  ['collarH', /(collar|kragen)\w*\s*(height|höhe|hoehe|width|breite)?$/i],
  ['placket', /(placket|knopfleiste|button\s*stand)/i],
  ['shoulderSeam', /(shoulder|schulter)\w*\s*(seam|naht)/i],
  ['opening', /(sleeve|ärmel|aermel|arm)\w*\s*(opening|öffnung|oeffnung|hem|saum|end)|cuff|manschette/i],
  ['bicep', /(bicep|biceps|upper\s*arm|oberarm|sleeve\s*width|ärmelweite|ärmelbreite|aermelweite)/i],
  ['sleeve', /(sleeve|ärmel|aermel)\w*\s*(length|länge|laenge)?|arm\s*length|armlänge/i],
  ['armhole', /(armhole|armloch|arm\s*hole)/i],
  ['shoulder', /(shoulder|schulter)/i],
  ['neckFront', /(front\s*neck\s*drop|neck\s*drop\s*front|halsausschnitt\s*vorne)/i],
  ['neckBack', /(back\s*neck\s*drop|halsausschnitt\s*hinten)/i],
  ['neckW', /(neck|hals|collar\s*width)/i],
  ['rib', /(rib|bündchen|buendchen|waistband|bund)/i],
  ['hem', /(hem|saum|bottom|sweep)/i],
  ['chest', /(chest|brust|pit\s*to\s*pit|body\s*width|breite|width)/i],
  ['len', /(length|länge|laenge|lange|total|höhe|height)/i],
];

export function pomOfLabel(label: string): string | null {
  const l = label
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [id, re] of POM_WORDS) if (re.test(l)) return id;
  return null;
}

export interface SizeChart {
  /** Größen in der Reihenfolge der Tabelle (normalisiert: XS, S, M, …) */
  sizes: string[];
  /** Messpunkt → Wert je Größe in mm (halbe Weite bei Weiten) */
  rows: { pom: string; label: string; values: (number | null)[] }[];
  unit: 'cm' | 'inch' | 'mm';
  /** Zeilen, die keinem Messpunkt zugeordnet werden konnten */
  unknown: string[];
}

const NUM = /(\d+(?:[.,]\d+)?)/g;

/**
 * Tabelle aus Text lesen. Erkennt eine Kopfzeile mit Größen und darunter Zeilen „Beschriftung Wert Wert …“.
 * Stehen mehrere Tabellen untereinander (z. B. CM und INCH), wird die in cm genommen.
 */
export function parseSizeChart(text: string): SizeChart | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[\t;|]/g, ' ').trim())
    .filter(Boolean);
  type Block = { unit: SizeChart['unit']; sizes: string[]; rows: SizeChart['rows']; unknown: string[] };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let pendingUnit: SizeChart['unit'] | null = null;
  const unitOf = (l: string): SizeChart['unit'] | null => (/\b(inch|inches|zoll|in\.)\b|"/i.test(l) ? 'inch' : /\bcm\b/i.test(l) ? 'cm' : /\bmm\b/i.test(l) ? 'mm' : null);
  for (const line of lines) {
    const tokens = line.split(/[\s;|]+/).filter(Boolean);
    const sizes = tokens.map(normalizeSize).filter((s): s is string => !!s);
    const u = unitOf(line);
    // Kopfzeile: mindestens zwei Größen, sonst kaum Zahlen
    const nums = line.match(NUM) ?? [];
    if (sizes.length >= 2 && nums.length < sizes.length) {
      cur = { unit: u ?? pendingUnit ?? 'cm', sizes, rows: [], unknown: [] };
      blocks.push(cur);
      pendingUnit = null;
      continue;
    }
    if (!cur || nums.length < 2) {
      if (u) pendingUnit = u;
      continue;
    }
    // Datenzeile: Zahlen am Ende gehören zu den Größen, der Rest ist die Beschriftung
    const values = nums.slice(-cur.sizes.length).map((n) => Number(n.replace(',', '.')));
    let label = line;
    for (const n of nums.slice(-cur.sizes.length)) label = label.replace(n, ' ');
    label = label.replace(/^[A-Z]\s+(?=\p{L})/u, '').trim(); // Kennbuchstabe des Shops („A TOTAL LENGTH“)
    if (u && !/\p{L}{3,}/u.test(label.replace(/\b(cm|inch|mm)\b/gi, ''))) {
      cur.unit = u;
      continue;
    }
    const pom = pomOfLabel(label);
    if (!pom || cur.rows.some((r) => r.pom === pom)) {
      cur.unknown.push(label || line);
      continue;
    }
    const circumference =
      /(umfang|circumference|circ|girth)/i.test(label) && !['len', 'sleeve', 'shoulder', 'shoulderSeam', 'armhole', 'rib', 'hoodH', 'collarH', 'placket', 'neckFront', 'neckBack'].includes(pom);
    cur.rows.push({ pom, label, values: values.map((v) => (circumference ? v / 2 : v)) });
  }
  const good = blocks.filter((b) => b.rows.length);
  if (!good.length) return null;
  const pick = good.find((b) => b.unit === 'cm') ?? good.find((b) => b.unit === 'mm') ?? good[0];
  const k = pick.unit === 'inch' ? 25.4 : pick.unit === 'cm' ? 10 : 1;
  return {
    sizes: pick.sizes,
    unit: pick.unit,
    unknown: pick.unknown,
    rows: pick.rows.map((r) => ({ ...r, values: r.values.map((v) => (v == null ? null : Math.round(v * k * 10) / 10)) })),
  };
}

/** Größe der Tabelle → Größe der Maßtabelle des Programms (Herren/Unisex „H-…“ oder Damen „D-…“). */
export function chartSizeId(size: string, group: 'H' | 'D'): string {
  return `${group}-${size}`;
}

/**
 * Fertigmaße je Größe aus der Tabelle: { 'H-M': { len: 690, chest: 600 }, … }.
 * Nur Größen, die es in der Maßtabelle gibt.
 */
export function chartToSpecs(chart: SizeChart, group: 'H' | 'D', known: string[]): Record<string, Partial<Record<string, number>>> {
  const out: Record<string, Partial<Record<string, number>>> = {};
  chart.sizes.forEach((s, i) => {
    const id = chartSizeId(s, group);
    if (!known.includes(id)) return;
    const spec: Partial<Record<string, number>> = {};
    for (const r of chart.rows) {
      const v = r.values[i];
      if (v != null && v > 0) spec[r.pom] = v;
    }
    out[id] = spec;
  });
  return out;
}
