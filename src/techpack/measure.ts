import type { BodyMeasures, PatternBlock, ShapeNode, SketchDoc } from '../model/types';
import { flattenContour, polyLength } from '../model/shape';
import { defaultBlock, generateBlock, type BlockPiece, type BlockResult } from '../pattern/blocks';
import { SIZE_TABLE, bodyForSize, sizeRow } from '../pattern/body';
import { pieceGeom } from '../pattern/geometry';

/**
 * Maßtabelle (Messpunkte, „Points of Measure“) für das Tech-Pack. Mit Grundschnitt werden die Maße für
 * alle Größen der Maßtabelle neu berechnet (Größenstaffel); ohne Grundschnitt gibt es die Maße je Teil.
 * Alle Werte in mm (Ausgabe im Tech-Pack in cm).
 */

export interface Pom {
  id: string;
  code: string;
  label: string;
  /** Messanleitung */
  how: string;
  /** Standard-Toleranz ± in mm */
  tol: number;
}

export const POMS: Pom[] = [
  { id: 'len', code: 'A', label: 'Gesamtlänge hinten', how: 'Vom hohen Halspunkt (Schulternaht am Hals) senkrecht bis zur Saumkante', tol: 10 },
  { id: 'chest', code: 'B', label: '½ Brustweite', how: 'Flach liegend, 2,5 cm unter dem Armloch von Seitennaht zu Seitennaht', tol: 10 },
  { id: 'hem', code: 'C', label: '½ Saumweite', how: 'Flach liegend an der Saumkante, ungedehnt', tol: 10 },
  { id: 'shoulder', code: 'D', label: 'Schulterbreite', how: 'Von Schulterpunkt zu Schulterpunkt (Ärmelansatz) gerade gemessen', tol: 8 },
  { id: 'shoulderSeam', code: 'E', label: 'Schulternaht', how: 'Vom hohen Halspunkt bis zum Ärmelansatz entlang der Naht', tol: 5 },
  { id: 'armhole', code: 'F', label: 'Armloch gerade', how: 'Vom Schulterpunkt gerade bis zum Achselpunkt', tol: 6 },
  { id: 'sleeve', code: 'G', label: 'Ärmellänge', how: 'Vom Schulterpunkt entlang der Ärmelmitte bis zur Ärmelkante (inkl. Bündchen)', tol: 10 },
  { id: 'bicep', code: 'H', label: '½ Oberarmweite', how: 'Flach liegend, 2,5 cm unter dem Achselpunkt quer über den Ärmel', tol: 6 },
  { id: 'opening', code: 'I', label: '½ Ärmelöffnung', how: 'Flach liegend an der Ärmelkante, ungedehnt', tol: 5 },
  { id: 'neckW', code: 'J', label: 'Halsweite', how: 'Von hohem Halspunkt zu hohem Halspunkt (Naht zu Naht)', tol: 5 },
  { id: 'neckFront', code: 'K', label: 'Halsausschnitt vorne tief', how: 'Von der gedachten Linie zwischen den hohen Halspunkten senkrecht bis zur Naht vorne Mitte', tol: 5 },
  { id: 'neckBack', code: 'L', label: 'Halsausschnitt hinten tief', how: 'Wie K, hinten Mitte', tol: 3 },
  { id: 'rib', code: 'M', label: 'Bündchenhöhe', how: 'Höhe von Saum- und Ärmelbündchen', tol: 3 },
  { id: 'neckband', code: 'N', label: 'Halsbündchen Höhe', how: 'Fertige Höhe des Halsbündchens', tol: 2 },
  { id: 'hoodH', code: 'O', label: 'Kapuzenhöhe', how: 'Von der Halsnaht hinten bis zum höchsten Punkt der Kapuze', tol: 10 },
  { id: 'hoodW', code: 'P', label: 'Kapuzenbreite', how: 'Flach liegend von der Gesichtskante bis zur hinteren Mitte', tol: 8 },
  { id: 'placket', code: 'Q', label: 'Knopfleiste Länge', how: 'Von der Kragenansatznaht bis zum unteren Ende der Knopfleiste', tol: 5 },
  { id: 'collarH', code: 'R', label: 'Kragenhöhe', how: 'Höhe des Kragens in der hinteren Mitte (ohne Steg)', tol: 3 },
];

export interface SizeColumn {
  id: string;
  name: string;
  base: boolean;
}

export interface MeasureTable {
  kind: 'graded' | 'pieces';
  sizes: SizeColumn[];
  rows: { pom: Pom; values: (number | null)[] }[];
}

const node = (p: BlockPiece | undefined, i: number): ShapeNode | null => p?.contour.nodes[i] ?? null;
const segLen = (p: BlockPiece | undefined, i: number): number => {
  if (!p) return 0;
  const a = p.contour.nodes[i];
  const b = p.contour.nodes[(i + 1) % p.contour.nodes.length];
  return polyLength(flattenContour({ closed: false, nodes: [a, b] }, 0.05), false);
};
const box = (p: BlockPiece | undefined) => {
  if (!p) return null;
  const pts = flattenContour(p.contour, 0.2);
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

/** Messpunkte aus einem Grundschnitt (Knotenreihenfolge siehe pattern/blocks). */
export function blockPoms(r: BlockResult): Record<string, number | null> {
  const f = r.pieces.find((p) => p.key === 'front');
  const b = r.pieces.find((p) => p.key === 'back');
  const s = r.pieces.find((p) => p.key === 'sleeve');
  const cuff = r.pieces.find((p) => p.key === 'cuff');
  const hemF = r.pieces.find((p) => p.key === 'hemFront');
  const hemB = r.pieces.find((p) => p.key === 'hemBack');
  const hood = r.pieces.find((p) => p.key === 'hood');
  const nb = r.pieces.find((p) => p.key === 'neckband');
  const placket = r.pieces.find((p) => p.key === 'placketTop');
  const collar = r.pieces.find((p) => p.key === 'collar');
  // Polo-Vorderteil hat vier Knoten mehr (Schlitz): Knotennummern ab dem linken Halspunkt verschoben
  const k = f && f.contour.nodes.length === 12 ? 3 : 0;
  const width = (p: BlockPiece | undefined, i: number, j: number) => {
    const a = node(p, i);
    const c = node(p, j);
    return a && c ? Math.abs(a.x - c.x) : 0;
  };
  const ribH = hemF ? box(hemF)!.h : 0;
  const out: Record<string, number | null> = {};
  out.len = b ? -node(b, 0)!.y + ribH : null;
  out.chest = f && b ? (width(f, 2, 8 + k) + width(b, 2, 8)) / 2 : null;
  out.hem = hemF && hemB ? (box(hemF)!.w + box(hemB)!.w) / 2 : f && b ? (width(f, 0, 1) + width(b, 0, 1)) / 2 : null;
  out.shoulder = f ? width(f, 3, 7 + k) : null;
  out.shoulderSeam = f ? segLen(f, 3) : null;
  out.armhole = f ? Math.hypot(node(f, 3)!.x - node(f, 2)!.x, node(f, 3)!.y - node(f, 2)!.y) : null;
  out.sleeve = s ? -node(s, 0)!.y + (cuff ? box(cuff)!.h : 0) : null;
  out.bicep = s ? width(s, 2, 4) / 2 : null;
  out.opening = cuff ? box(cuff)!.w / 2 : s ? width(s, 0, 1) / 2 : null;
  out.neckW = f ? width(f, 4, 6 + k) : null;
  // Polo: Halsausschnitt bis zur Knopfleiste (Kragenansatz vorne)
  out.neckFront = f ? node(f, 4)!.y - node(f, 5)!.y : null;
  out.neckBack = b ? node(b, 4)!.y - node(b, 5)!.y : null;
  out.rib = hemF ? ribH : cuff ? box(cuff)!.h : null;
  out.neckband = nb ? box(nb)!.h : null;
  out.hoodH = hood ? box(hood)!.h : null;
  out.hoodW = hood ? box(hood)!.w : null;
  out.placket = placket ? box(placket)!.h : null;
  out.collarH = collar ? box(collar)!.h : null;
  return out;
}

/** Größen der Staffel: alle Größen der Maßtabelle derselben Gruppe (Herren/Unisex bzw. Damen). */
export function gradeSizes(bodySize: string): SizeColumn[] {
  const row = sizeRow(bodySize);
  if (!row) return [{ id: 'custom', name: 'Eigene Maße', base: true }];
  return SIZE_TABLE.filter((r) => r.group === row.group).map((r) => ({ id: r.id, name: r.id.replace(/^[HD]-/, ''), base: r.id === bodySize }));
}

/** Grundschnitt einer anderen Größe: Länge und Ärmel behalten den Abstand zum Standard der Basisgröße. */
export function gradedBlock(blk: PatternBlock, baseBody: BodyMeasures, size: string): { body: BodyMeasures; blk: PatternBlock } {
  const body = size === 'custom' ? baseBody : bodyForSize(size);
  const d0 = defaultBlock(blk.kind, baseBody, blk.fit, blk.size);
  const d1 = defaultBlock(blk.kind, body, blk.fit, size);
  const out: PatternBlock = { ...blk, size, length: d1.length + (blk.length - d0.length), sleeve: d1.sleeve + (blk.sleeve - d0.sleeve) };
  if (blk.spec && size !== blk.size) {
    // Fertigmaße mitstufen: gleicher Sprung je Messpunkt wie beim Standardschnitt zwischen den Größen
    const p0 = blockPoms(generateBlock(baseBody, { ...blk, spec: undefined }));
    const p1 = blockPoms(generateBlock(body, { ...out, spec: undefined }));
    const spec: Partial<Record<string, number>> = {};
    for (const [k, v] of Object.entries(blk.spec)) if (v != null) spec[k] = v + ((p1[k] ?? 0) - (p0[k] ?? 0));
    out.spec = spec;
  }
  // Werte aus der Größentabelle gelten für ihre Größe genau
  const own = blk.sizeSpecs?.[size];
  if (own && size !== blk.size) out.spec = { ...(out.spec ?? {}), ...Object.fromEntries(Object.entries(own).filter(([, v]) => v != null)) };
  return { body, blk: out };
}

/** Messpunkte, deren Fertigmaß der erzeugte Schnitt nicht trifft (z. B. Ärmelweite größer als das Armloch zulässt). */
export function specDeviations(body: BodyMeasures, blk: PatternBlock, tol = 1): { pom: Pom; want: number; got: number }[] {
  if (!blk.spec) return [];
  const got = blockPoms(generateBlock(body, blk));
  const out: { pom: Pom; want: number; got: number }[] = [];
  for (const pom of POMS) {
    const want = blk.spec[pom.id];
    const g = got[pom.id];
    if (want == null || g == null) continue;
    if (Math.abs(want - g) > tol) out.push({ pom, want, got: g });
  }
  return out;
}

/** Messpunkte, die es beim Kleidungsstück gibt (für die Eingabe von Fertigmaßen). */
export function pomsFor(kind: PatternBlock['kind']): Pom[] {
  const r = blockPoms(generateBlock(bodyForSize('H-M'), defaultBlock(kind, bodyForSize('H-M'))));
  return POMS.filter((p) => r[p.id] != null && r[p.id]! > 0);
}

export function measureTable(doc: SketchDoc): MeasureTable | null {
  const pat = doc.pattern;
  if (!pat?.pieces.length) return null;
  if (pat.block && pat.pieces.some((p) => p.block)) {
    const sizes = gradeSizes(pat.bodySize);
    const cols = sizes.map((sz) => {
      const g = sz.base ? { body: pat.body, blk: pat.block! } : gradedBlock(pat.block!, pat.body, sz.id);
      return blockPoms(generateBlock(g.body, g.blk));
    });
    const rows = POMS.filter((pom) => cols.some((c) => c[pom.id] != null && c[pom.id]! > 0)).map((pom) => ({ pom, values: cols.map((c) => c[pom.id] ?? null) }));
    return { kind: 'graded', sizes, rows };
  }
  // Ohne Grundschnitt: Breite und Höhe je Teil
  const rows: MeasureTable['rows'] = [];
  pat.pieces.forEach((pc, i) => {
    const g = pieceGeom(doc, pc);
    if (!g) return;
    const code = String.fromCharCode(65 + (i % 26));
    rows.push({ pom: { id: `${pc.id}:w`, code: `${code}1`, label: `${pc.name} – Breite`, how: 'Größte Breite des Schnittteils (ohne Nahtzugabe)', tol: 5 }, values: [g.box.maxX - g.box.minX] });
    rows.push({ pom: { id: `${pc.id}:h`, code: `${code}2`, label: `${pc.name} – Höhe`, how: 'Größte Höhe des Schnittteils (ohne Nahtzugabe)', tol: 5 }, values: [g.box.maxY - g.box.minY] });
  });
  return { kind: 'pieces', sizes: [{ id: pat.bodySize, name: 'Maß', base: true }], rows };
}

/** Maßtabelle als CSV (Semikolon, cm mit Komma – öffnet direkt in Excel). */
export function measureCsv(t: MeasureTable, tolerances: Record<string, number> = {}): string {
  const cm = (v: number | null) => (v == null ? '' : (Math.round(v) / 10).toFixed(1).replace('.', ','));
  const lines = [['Code', 'Messpunkt', ...t.sizes.map((s) => (s.base ? `${s.name} (Basis)` : s.name)), 'Toleranz ±', 'Messanleitung'].join(';')];
  for (const r of t.rows)
    lines.push([r.pom.code, r.pom.label, ...r.values.map(cm), cm(tolerances[r.pom.id] ?? r.pom.tol), r.pom.how].map((v) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(';'));
  return '﻿' + lines.join('\r\n') + '\r\n';
}
