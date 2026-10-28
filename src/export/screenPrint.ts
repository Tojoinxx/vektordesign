import { zipSync, strToU8 } from 'fflate';
import type { Motif, Production, SketchDoc, Variant, Vec2 } from '../model/types';
import { applyVariant, articleBase, cmykOf, cmykText, fileSafe, motifDoc } from '../model/production';
import { separate, type Plate, type Separation, type UnderbaseMode } from '../model/separation';
import { PdfDoc, PT, wrapText, type PdfPage } from './pdfDoc';
import { textOutlines } from './scene';
import { APP_NAME, APP_VERSION } from '../model/serialize';

/**
 * Siebdruck-Paket: je Druckfarbe ein Film (schwarz, Originalgröße, Passermarken und
 * Beschriftung an derselben Stelle auf allen Filmen), alle Filme zusammen in einer PDF,
 * ein farbiger Andruck auf Stofffarbe mit Farbliste und eine LIESMICH-Datei.
 */

export interface ScreenPrintOptions {
  underbase: UnderbaseMode;
  /** Rückzug der weißen Unterlage (mm) */
  choke: number;
  /** Überfüllung (mm) */
  trap: number;
  dropFabricColor: boolean;
  /** Passermarken */
  marks: boolean;
  /** Seitenverkehrt (Schichtseite oben) */
  mirror: boolean;
  /** Stofffarbe (sonst die der Variante) */
  fabric?: string;
  date?: Date;
}

export const DEFAULT_SCREEN: ScreenPrintOptions = { underbase: 'auto', choke: 0.3, trap: 0.15, dropFabricColor: true, marks: true, mirror: false };

export interface ScreenPrintResult {
  zip: Uint8Array;
  fileName: string;
  files: string[];
  warnings: string[];
  separation: Separation;
}

/** Rand um das Motiv (mm): Platz für Passermarken */
const MARGIN = 22;
/** Beschriftungsfeld unten (mm) */
const LABEL = 30;
/** Mindestbreite eines Films (mm) */
const MIN_W = 160;

export function plateName(p: Plate, prod: Production): string {
  if (p.kind === 'underbase') return 'Unterlage Weiß';
  const spec = prod.colorSpecs[p.color.toLowerCase()];
  return spec?.name?.trim() || p.color.toUpperCase();
}

function plateInfo(p: Plate, prod: Production): string {
  if (p.kind === 'underbase') return 'Unterdruck, zuerst drucken und zwischentrocknen';
  const spec = prod.colorSpecs[p.color.toLowerCase()];
  const parts = [p.color.toUpperCase(), cmykText(cmykOf(p.color, spec))];
  if (spec?.pantone?.trim()) parts.push(`Pantone ${spec.pantone.trim()}`);
  return parts.join(' · ');
}

const fmt = (n: number, d = 1) => n.toFixed(d).replace('.', ',');

interface Layout {
  wMm: number;
  hMm: number;
  /** Welt → Seite (pt) */
  X: (x: number) => number;
  Y: (y: number) => number;
  box: NonNullable<Separation['box']>;
}

function layout(box: NonNullable<Separation['box']>, mirror: boolean): Layout {
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  // Mindestbreite für die Beschriftung; das Motiv steht mittig
  const wMm = Math.max(w + 2 * MARGIN, MIN_W);
  const hMm = h + 2 * MARGIN + LABEL;
  const ox = (wMm - w) / 2;
  const X = (x: number) => (mirror ? ox + (box.maxX - x) : ox + (x - box.minX)) * PT;
  const Y = (y: number) => (LABEL + MARGIN + (y - box.minY)) * PT;
  return { wMm, hMm, X, Y, box };
}

/** Flächen als ein Pfad (Löcher über die Umlaufrichtung, Nonzero-Füllung). */
function fillPolys(page: PdfPage, polys: Vec2[][], L: Layout): void {
  const ops: string[] = [];
  const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
  for (const poly of polys) {
    if (poly.length < 3) continue;
    ops.push(`${n(L.X(poly[0].x))} ${n(L.Y(poly[0].y))} m`);
    for (let i = 1; i < poly.length; i++) ops.push(`${n(L.X(poly[i].x))} ${n(L.Y(poly[i].y))} l`);
    ops.push('h');
  }
  if (ops.length) page.ops.push(`${ops.join('\n')}\nf`);
}

/** Passermarke: Kreis mit Fadenkreuz (Ø 8 mm) */
function regMark(page: PdfPage, cx: number, cy: number, color: string): void {
  const r = 3 * PT;
  const a = 5 * PT;
  page.stroke(color, 0.25 * PT);
  const k = 0.5522847498 * r;
  const f = (v: number) => (Math.round(v * 1000) / 1000).toString();
  const P = (x: number, y: number) => `${f(x)} ${f(y)}`;
  page.ops.push(
    `${P(cx + r, cy)} m ${P(cx + r, cy + k)} ${P(cx + k, cy + r)} ${P(cx, cy + r)} c ${P(cx - k, cy + r)} ${P(cx - r, cy + k)} ${P(cx - r, cy)} c ${P(cx - r, cy - k)} ${P(cx - k, cy - r)} ${P(cx, cy - r)} c ${P(cx + k, cy - r)} ${P(cx + r, cy - k)} ${P(cx + r, cy)} c S`,
  );
  page.line(cx - a, cy, cx + a, cy);
  page.line(cx, cy - a, cx, cy + a);
}

function marks(page: PdfPage, L: Layout, color: string): void {
  const { box } = L;
  const midX = (L.X(box.minX) + L.X(box.maxX)) / 2;
  const midY = (L.Y(box.minY) + L.Y(box.maxY)) / 2;
  const off = 12 * PT;
  const left = Math.min(L.X(box.minX), L.X(box.maxX));
  const right = Math.max(L.X(box.minX), L.X(box.maxX));
  regMark(page, midX, L.Y(box.maxY) + off, color);
  regMark(page, midX, L.Y(box.minY) - off, color);
  regMark(page, left - off, midY, color);
  regMark(page, right + off, midY, color);
  // Eckmarken (Beschnitt) an den Motivgrenzen
  const c = 4 * PT;
  const g = 2 * PT;
  page.stroke(color, 0.25 * PT);
  const top = L.Y(box.maxY);
  const bottom = L.Y(box.minY);
  for (const [x, sx] of [
    [left, -1],
    [right, 1],
  ] as const)
    for (const [y, sy] of [
      [top, 1],
      [bottom, -1],
    ] as const) {
      page.line(x + sx * g, y, x + sx * (g + c), y);
      page.line(x, y + sy * g, x, y + sy * (g + c));
    }
}

function label(page: PdfPage, lines: { text: string; bold?: boolean; size?: number }[], color = '#000000'): void {
  let y = (LABEL - 7) * PT;
  const maxW = page.w - 2 * 10 * PT;
  for (const l of lines) {
    const size = l.size ?? 8;
    for (const part of wrapText(l.text, size, maxW, l.bold)) {
      page.text(10 * PT, y, part, { size, bold: l.bold, color });
      y -= size * 1.3;
    }
  }
}

/** Filme und Andruck als PDF-Seiten. */
function filmPage(pdf: PdfDoc, plate: Plate, sep: Separation, L: Layout, info: { title: string; total: number; prod: Production; opts: ScreenPrintOptions }): void {
  const page = pdf.page(L.wMm * PT, L.hMm * PT);
  page.fill('#000000');
  fillPolys(page, plate.polys, L);
  if (info.opts.marks) marks(page, L, '#000000');
  const w = L.box.maxX - L.box.minX;
  const h = L.box.maxY - L.box.minY;
  const tech: string[] = [`${fmt(w)} × ${fmt(h)} mm (1:1)`];
  if (plate.kind === 'underbase') tech.push(`Rückzug ${fmt(info.opts.choke, 2)} mm`);
  else if (info.opts.trap > 0 && plate.order < sep.plates.length) tech.push(`Überfüllung ${fmt(info.opts.trap, 2)} mm`);
  tech.push(info.opts.mirror ? 'SEITENVERKEHRT' : 'seitenrichtig');
  label(page, [
    { text: `Film ${plate.order}/${info.total}: ${plateName(plate, info.prod)}`, bold: true, size: 11 },
    { text: plateInfo(plate, info.prod) },
    { text: info.title },
    { text: tech.join(' · ') },
  ]);
  page.finish({ trim: true });
}

function proofPage(pdf: PdfDoc, sep: Separation, L: Layout, fabric: string, info: { title: string; prod: Production }): void {
  const rows = sep.plates.length;
  const listH = 8 + rows * 6;
  const page = pdf.page(L.wMm * PT, (L.hMm + listH) * PT);
  // Stoff
  page.fill(fabric).rect(0, (LABEL + listH) * PT, L.wMm * PT, (L.hMm - LABEL) * PT);
  const L2: Layout = { ...L, Y: (y: number) => L.Y(y) + listH * PT };
  for (const p of sep.plates) {
    page.fill(p.color);
    fillPolys(page, p.polys, L2);
  }
  // Farbliste
  let y = (LABEL + listH - 6) * PT;
  page.text(10 * PT, y, 'Druckreihenfolge', { size: 9, bold: true });
  for (const p of sep.plates) {
    y -= 6 * PT;
    page
      .fill(p.color)
      .stroke('#888888', 0.3)
      .rect(10 * PT, y - 1 * PT, 4 * PT, 4 * PT, 'B');
    const t = `${p.order}. ${plateName(p, info.prod)} – ${plateInfo(p, info.prod)} – ${fmt(p.area / 100, 1)} cm²`;
    page.text(16 * PT, y, wrapText(t, 7.5, page.w - 26 * PT)[0], { size: 7.5 });
  }
  label(page, [
    { text: 'Andruck (Vorschau, nicht zum Belichten)', bold: true, size: 11 },
    { text: info.title },
    { text: `Stofffarbe ${fabric.toUpperCase()} · ${sep.plates.length} Sieb${sep.plates.length === 1 ? '' : 'e'}${sep.underbase ? ' inkl. weißer Unterlage' : ''}` },
  ]);
  page.finish({ trim: true });
}

export async function buildScreenPrint(doc: SketchDoc, prod: Production, motif: Motif, variant: Variant, optsIn: Partial<ScreenPrintOptions> = {}): Promise<ScreenPrintResult> {
  const opts = { ...DEFAULT_SCREEN, ...optsIn };
  const md = applyVariant(motifDoc(doc, motif), variant);
  const { outlines, substituted } = await textOutlines(md);
  const fabric = opts.fabric ?? variant.fabric ?? '#ffffff';
  const sep = separate(md, { outlines, fabric, dropFabricColor: opts.dropFabricColor, underbase: opts.underbase, choke: opts.choke, trap: opts.trap });
  const warnings = [...sep.warnings];
  if (substituted.length) warnings.push(`Schrift ersetzt (nicht verfügbar): ${substituted.join(', ')}`);
  if (!sep.box || !sep.plates.length) throw new Error('Keine druckbaren Flächen – das Motiv ist leer oder besteht nur aus Pixelbildern.');
  const many = prod.variants.length > 1 || variant.name !== 'Variante A';
  const base = `${articleBase(prod)}_${fileSafe(motif.name)}${many ? `_${fileSafe(variant.name)}` : ''}_Siebdruck`;
  const title = `${prod.article} v${prod.version} · ${motif.name} · ${variant.name}`;
  const L = layout(sep.box, opts.mirror);
  const files: Record<string, Uint8Array> = {};
  const total = sep.plates.length;

  const all = new PdfDoc('rgb', true);
  for (const p of sep.plates) {
    const one = new PdfDoc('rgb', true);
    filmPage(one, p, sep, L, { title, total, prod, opts });
    files[`${base}/Filme/${base}_Film${p.order}_${fileSafe(plateName(p, prod))}.pdf`] = one.finish(`${title} – Film ${p.order}`);
    filmPage(all, p, sep, L, { title, total, prod, opts });
  }
  files[`${base}/${base}_alle_Filme.pdf`] = all.finish(`${title} – Filme`);
  const proof = new PdfDoc('rgb', true);
  proofPage(proof, sep, layout(sep.box, false), fabric, { title, prod });
  files[`${base}/${base}_Andruck.pdf`] = proof.finish(`${title} – Andruck`);

  const date = opts.date ?? new Date();
  const lines = [
    `${title} – Siebdruck`,
    `Erstellt mit ${APP_NAME} ${APP_VERSION} am ${date.toLocaleDateString('de-DE')}`,
    '',
    `Motiv: ${fmt(sep.box.maxX - sep.box.minX)} × ${fmt(sep.box.maxY - sep.box.minY)} mm, Stofffarbe ${fabric.toUpperCase()}`,
    `Siebe: ${total}${sep.underbase ? ` (inkl. weißer Unterlage, Rückzug ${fmt(opts.choke, 2)} mm)` : ''}`,
    `Überfüllung: ${opts.trap > 0 ? `${fmt(opts.trap, 2)} mm (helle Farben laufen unter dunkle)` : 'keine'}`,
    `Filme: ${opts.mirror ? 'seitenverkehrt' : 'seitenrichtig'}, Positiv schwarz, 1:1, Passermarken auf allen Filmen an gleicher Stelle`,
    '',
    'Druckreihenfolge:',
    ...sep.plates.map((p) => `  ${p.order}. ${plateName(p, prod)} – ${plateInfo(p, prod)} – ${fmt(p.area / 100, 1)} cm²`),
    ...(warnings.length ? ['', 'Hinweise:', ...warnings.map((w) => `  - ${w}`)] : []),
    '',
  ];
  files[`${base}/LIESMICH.txt`] = strToU8(lines.join('\r\n'));
  return { zip: zipSync(files, { level: 6, mtime: date }), fileName: `${base}.zip`, files: Object.keys(files), warnings, separation: sep };
}
