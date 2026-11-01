import type { Motif, SketchDoc, TechPack, Vec2 } from '../model/types';
import { applyVariant, cmykOf, cmykText, motifColors, motifDoc, motifSize, productionOf, variantColor } from '../model/production';
import { garmentOf, techniqueName } from '../model/garments';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import { polygonArea } from '../model/geometry';
import { BLOCK_KINDS, FIT_NAMES } from '../pattern/blocks';
import { grainLine, pieceGeom, seamAllowanceOutline, type PieceGeom } from '../pattern/geometry';
import { FABRICS, sizeName } from '../store/patternOps';
import { techPackOf } from '../store/techpackOps';
import { measureTable, type MeasureTable } from '../techpack/measure';
import { constructionRows } from '../techpack/construction';
import { PdfDoc, PdfPage, PT, wrapText, type ColorMode } from './pdfDoc';
import { buildScene, textOutlines, type ExportScene } from './scene';

/**
 * Tech-Pack als PDF (A4 quer) – als Ergänzung zum Tech-Pack in LabwearOS: Deckblatt mit 3D-Ansichten,
 * Maßtabelle mit Größenstaffel und Toleranzen, Schnittteile, Material und Zutaten, Verarbeitung,
 * Artwork und Referenzbilder. Maßgeblich für Bestellung und Produktion bleiben die Angaben in LabwearOS.
 */

export interface Pixels {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface TechPackOptions {
  colorMode?: ColorMode;
  date?: Date;
  /** Bilder (Data-URLs) dekodieren – nur im Browser verfügbar */
  decode?: (url: string) => Promise<Pixels | null>;
}

const W = 297 * PT;
const H = 210 * PT;
const M = 28;
const INK = '#1e2328';
const MUTED = '#6b7480';
const LINE = '#c9d0d7';
const SOFT = '#f3f5f7';
const ACCENT = '#d9a900';
const BASE_BG = '#fff4c7';

const cm = (mm: number | null | undefined) => (mm == null ? '–' : (Math.round(mm) / 10).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

interface Ctx {
  doc: SketchDoc;
  tp: TechPack;
  pdf: PdfDoc;
  date: Date;
  article: string;
  version: string;
  table: MeasureTable | null;
  renders: { front?: Pixels | null; back?: Pixels | null; side?: Pixels | null };
  refs: Map<string, Pixels | null>;
  scenes: Map<string, ExportScene>;
}

type PageFn = (ctx: Ctx, n: number, total: number) => void;

export async function buildTechPack(doc: SketchDoc, opts: TechPackOptions = {}): Promise<Uint8Array> {
  const prod = productionOf(doc);
  const tp = techPackOf(doc.techPack);
  const pdf = new PdfDoc(opts.colorMode ?? 'rgb', true);
  const ctx: Ctx = { doc, tp, pdf, date: opts.date ?? new Date(), article: prod.article, version: prod.version, table: measureTable(doc), renders: {}, refs: new Map(), scenes: new Map() };
  const dec = opts.decode;
  if (dec && tp.renders) {
    for (const k of ['front', 'back', 'side'] as const) {
      const u = tp.renders[k];
      if (u) ctx.renders[k] = await dec(u).catch(() => null);
    }
  }
  if (dec) for (const r of tp.references) ctx.refs.set(r.id, await dec(r.image).catch(() => null));
  // Motive als Vektorszenen (Text als Umrisse)
  if (prod.motifs.length) {
    const { outlines } = await textOutlines(doc).catch(() => ({ outlines: new Map() }));
    for (const m of prod.motifs) {
      try {
        ctx.scenes.set(m.id, buildScene(applyVariant(motifDoc(doc, m), prod.variants[0]), { outlines }));
      } catch {
        /* leeres Motiv */
      }
    }
  }

  const pages: PageFn[] = [coverPage];
  if (ctx.table?.rows.length) {
    const per = 15;
    for (let i = 0; i < ctx.table.rows.length; i += per) pages.push((c, n, t) => measurePage(c, n, t, i, per));
  }
  if (doc.pattern?.pieces.length) pages.push(piecesPage);
  pages.push(materialsPage);
  if (doc.pattern?.pieces.length || tp.notes) pages.push(constructionPage);
  const motifs = prod.motifs.filter((m) => ctx.scenes.has(m.id));
  for (let i = 0; i < motifs.length; i += 2) pages.push((c, n, t) => artworkPage(c, n, t, motifs.slice(i, i + 2)));
  for (let i = 0; i < tp.references.length; i += 4) pages.push((c, n, t) => referencesPage(c, n, t, i));
  pages.forEach((fn, i) => fn(ctx, i + 1, pages.length));
  return pdf.finish(`Tech-Pack ${prod.article} v${prod.version}`);
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function header(ctx: Ctx, page: PdfPage, title: string, n: number, total: number): number {
  const { tp } = ctx;
  page.fill(ACCENT).rect(M, H - M - 4, 34, 4);
  page.text(M, H - M - 22, 'TECH-PACK  ·  ERGÄNZUNG ZU LABWEAROS', { size: 8, bold: true, color: MUTED });
  page.text(M, H - M - 42, `${ctx.article}  ·  Version ${ctx.version}`, { size: 17, bold: true });
  page.text(M, H - M - 58, title, { size: 10, color: MUTED });
  const r = W - M;
  page.text(r, H - M - 22, ctx.date.toLocaleDateString('de-DE'), { size: 8, color: MUTED, align: 'right' });
  page.text(r, H - M - 34, [tp.styleNo && `Style ${tp.styleNo}`, tp.season, tp.status].filter(Boolean).join('  ·  '), { size: 8, color: MUTED, align: 'right' });
  page.text(r, H - M - 46, `Seite ${n} von ${total}`, { size: 8, color: MUTED, align: 'right' });
  page.stroke(LINE, 0.6).line(M, H - M - 68, W - M, H - M - 68);
  page.text(M, M - 12, `Erstellt mit ${APP_NAME} ${APP_VERSION}. Ergänzung zum Tech-Pack in LabwearOS – bei Abweichungen gelten die Angaben in LabwearOS. Maße in cm, flach liegend gemessen.`, {
    size: 6.5,
    color: MUTED,
  });
  return H - M - 84;
}

function sectionTitle(page: PdfPage, x: number, y: number, t: string) {
  page.text(x, y, t.toUpperCase(), { size: 7.5, bold: true, color: MUTED });
}

function kv(page: PdfPage, x: number, y: number, k: string, v: string, w: number): number {
  if (!v) return y;
  page.text(x, y, k, { size: 7.5, color: MUTED });
  const lines = wrapText(v, 9, w - 86);
  lines.forEach((l, i) => page.text(x + 86, y - i * 11, l, { size: 9 }));
  return y - Math.max(1, lines.length) * 11 - 5;
}

function swatch(page: PdfPage, x: number, y: number, hex: string, size = 10) {
  page.fill(hex).stroke(LINE, 0.5).rect(x, y, size, size, 'B');
}

/** Bild in ein Feld einpassen (zentriert). */
function fitImage(page: PdfPage, px: Pixels, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / px.width, h / px.height);
  const iw = px.width * k;
  const ih = px.height * k;
  page.image(px.rgba, px.width, px.height, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

interface Col {
  title: string;
  w: number;
  align?: 'left' | 'right' | 'center';
}

/** Einfache Tabelle; liefert die y-Position unter der Tabelle. Zellen mit Zeilenumbruch. */
function table(
  page: PdfPage,
  x: number,
  y: number,
  cols: Col[],
  rows: string[][],
  opts: { size?: number; highlight?: number; minY?: number; rowFill?: (i: number) => string | null; onRow?: (i: number, y: number) => void } = {},
): number {
  const size = opts.size ?? 8.5;
  const lh = size + 3;
  let cx = x;
  const total = cols.reduce((s, c) => s + c.w, 0);
  page.fill(SOFT).rect(x, y - 5, total, 16);
  if (opts.highlight != null) {
    const hx = x + cols.slice(0, opts.highlight).reduce((s, c) => s + c.w, 0);
    page.fill(BASE_BG).rect(hx, y - 5, cols[opts.highlight].w, 16);
  }
  for (const c of cols) {
    const tx = c.align === 'right' ? cx + c.w - 5 : c.align === 'center' ? cx + c.w / 2 : cx + 5;
    page.text(tx, y, c.title, { size: 7.5, bold: true, color: MUTED, align: c.align ?? 'left' });
    cx += c.w;
  }
  y -= 16;
  rows.forEach((r, ri) => {
    const wrapped = r.map((cell, i) => wrapText(cell, size, cols[i].w - 10));
    const n = Math.max(1, ...wrapped.map((w) => w.length));
    const rh = n * lh + 5;
    if (opts.minY != null && y - rh < opts.minY) return;
    const fill = opts.rowFill?.(ri);
    if (fill) page.fill(fill).rect(x, y - rh + lh - 1, total, rh);
    if (opts.highlight != null) {
      const hx = x + cols.slice(0, opts.highlight).reduce((s, c) => s + c.w, 0);
      page.fill(BASE_BG).rect(hx, y - rh + lh - 1, cols[opts.highlight].w, rh);
    }
    opts.onRow?.(ri, y);
    cx = x;
    wrapped.forEach((lines, i) => {
      const c = cols[i];
      lines.forEach((l, k) => {
        const tx = c.align === 'right' ? cx + c.w - 5 : c.align === 'center' ? cx + c.w / 2 : cx + 5;
        page.text(tx, y - k * lh, l, { size, align: c.align ?? 'left', bold: i === 0 && c.w < 40 });
      });
      cx += c.w;
    });
    y -= rh;
    page.stroke(LINE, 0.4).line(x, y + lh - 1, x + total, y + lh - 1);
  });
  return y;
}

// ---------------------------------------------------------------------------
// Seiten
// ---------------------------------------------------------------------------

function coverPage(ctx: Ctx, n: number, total: number) {
  const { doc, tp, pdf } = ctx;
  const page = pdf.page(W, H);
  const top = header(ctx, page, 'Übersicht', n, total);
  const pat = doc.pattern;
  const prod = productionOf(doc);
  const rightW = 250;
  const leftW = W - 2 * M - rightW - 20;
  const bottom = M + 8;
  // 3D-Ansichten
  const views = (['front', 'back', 'side'] as const).filter((k) => ctx.renders[k]);
  if (views.length) {
    const cw = (leftW - (views.length - 1) * 10) / views.length;
    views.forEach((k, i) => {
      const x = M + i * (cw + 10);
      // gleiche Farbe wie der Studiohintergrund der Aufnahme
      page.fill('#eceef0').rect(x, bottom + 14, cw, top - bottom - 14);
      fitImage(page, ctx.renders[k]!, x, bottom + 14, cw, top - bottom - 14);
      page.text(x + cw / 2, bottom + 2, k === 'front' ? 'Vorderansicht' : k === 'back' ? 'Rückansicht' : 'Seitenansicht', { size: 8, color: MUTED, align: 'center' });
    });
  } else if (pat?.pieces.length) {
    page.fill(SOFT).rect(M, bottom, leftW, top - bottom);
    drawPieces(ctx, page, { x: M + 16, y: bottom + 16, w: leftW - 32, h: top - bottom - 32 }, false);
    page.text(M + leftW / 2, bottom + 4, '3D-Ansichten im Tech-Pack-Dialog aufnehmen, dann erscheinen sie hier.', { size: 7.5, color: MUTED, align: 'center' });
  } else {
    page.fill(SOFT).rect(M, bottom, leftW, top - bottom);
    page.text(M + leftW / 2, (top + bottom) / 2, 'Noch kein Schnitt – Tech-Pack enthält Artwork, Material und Referenzen.', { size: 9, color: MUTED, align: 'center' });
  }
  // Angaben
  const rx = W - M - rightW;
  let y = top;
  sectionTitle(page, rx, y, 'Artikel');
  y -= 16;
  y = kv(page, rx, y, 'Style-Nr.', tp.styleNo, rightW);
  y = kv(page, rx, y, 'Saison', tp.season, rightW);
  y = kv(page, rx, y, 'Marke', tp.brand, rightW);
  y = kv(page, rx, y, 'Design', tp.designer, rightW);
  y = kv(page, rx, y, 'Status', tp.status, rightW);
  const kind = pat?.block ? BLOCK_KINDS.find((k) => k.id === pat.block!.kind)?.name : garmentOf(prod.garment).name;
  y = kv(page, rx, y, 'Kleidungsstück', kind ?? '', rightW);
  if (pat?.block) y = kv(page, rx, y, 'Passform', FIT_NAMES[pat.block.fit], rightW);
  if (pat) y = kv(page, rx, y, 'Basisgröße', sizeName(pat.bodySize), rightW);
  if (ctx.table?.kind === 'graded') y = kv(page, rx, y, 'Größen', ctx.table.sizes.map((s) => s.name).join(' · '), rightW);
  if (tp.description) y = kv(page, rx, y, 'Beschreibung', tp.description, rightW);
  y -= 6;
  if (pat?.materials.length) {
    sectionTitle(page, rx, y, 'Stoffe');
    y -= 15;
    for (const m of pat.materials) {
      if (y < bottom + 60) break;
      swatch(page, rx, y - 2, m.color);
      page.text(rx + 16, y, `${m.name} – ${FABRICS.find((f) => f.id === m.fabric)?.name ?? m.fabric}, ${m.gsm} g/m²`, { size: 8.5 });
      y -= 14;
    }
    y -= 6;
  }
  if (prod.variants.length) {
    sectionTitle(page, rx, y, 'Farbvarianten');
    y -= 15;
    for (const v of prod.variants) {
      if (y < bottom) break;
      swatch(page, rx, y - 2, v.fabric);
      page.text(rx + 16, y, `${v.name}${v.fabricName ? ` – ${v.fabricName}` : ''} (${v.fabric.toUpperCase()})`, { size: 8.5 });
      y -= 14;
    }
  }
  page.finish({ compress: true });
}

function measurePage(ctx: Ctx, n: number, total: number, start: number, per: number) {
  const t = ctx.table!;
  const page = ctx.pdf.page(W, H);
  const y = header(ctx, page, t.kind === 'graded' ? 'Maßtabelle mit Größenstaffel' : 'Maße der Schnittteile', n, total);
  const sizeW = Math.min(46, 330 / t.sizes.length);
  const cols: Col[] = [
    { title: 'Code', w: 34 },
    { title: 'Messpunkt', w: 150 },
    ...t.sizes.map((s) => ({ title: s.base ? `${s.name}*` : s.name, w: sizeW, align: 'right' as const })),
    { title: 'Tol. ±', w: 42, align: 'right' },
  ];
  const used = cols.reduce((s, c) => s + c.w, 0);
  cols.push({ title: 'Messanleitung', w: W - 2 * M - used });
  const base = t.sizes.findIndex((s) => s.base);
  const rows = t.rows.slice(start, start + per).map((r) => [r.pom.code, r.pom.label, ...r.values.map(cm), cm(ctx.tp.tolerances[r.pom.id] ?? r.pom.tol), r.pom.how]);
  table(page, M, y, cols, rows, { size: 8, highlight: base >= 0 ? 2 + base : undefined, minY: M + 30 });
  page.text(
    M,
    M + 6,
    t.kind === 'graded'
      ? '* Basisgröße (Musterteil). Maße der anderen Größen aus dem Grundschnitt neu berechnet (gleiche Passform, Länge und Ärmel im selben Abstand zum Standard).'
      : 'Ohne Grundschnitt: größte Breite und Höhe je Schnittteil, ohne Nahtzugabe.',
    { size: 7, color: MUTED },
  );
  page.finish({ compress: true });
}

/** Alle Schnittteile maßstäblich in ein Feld zeichnen. */
function drawPieces(ctx: Ctx, page: PdfPage, frame: { x: number; y: number; w: number; h: number }, labels = true): number {
  const pat = ctx.doc.pattern!;
  const geoms = pat.pieces.map((p) => pieceGeom(ctx.doc, p)).filter((g): g is PieceGeom => !!g);
  const outlines = geoms.map((g) => {
    const sa = seamAllowanceOutline(g);
    return sa.length ? sa : [g.polygon];
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const o of outlines)
    for (const poly of o)
      for (const p of poly) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
  const k = Math.min(frame.w / (maxX - minX), frame.h / (maxY - minY));
  const ox = frame.x + (frame.w - (maxX - minX) * k) / 2;
  const oy = frame.y + (frame.h - (maxY - minY) * k) / 2;
  const P = (p: Vec2): [number, number] => [ox + (p.x - minX) * k, oy + (p.y - minY) * k];
  geoms.forEach((g) => {
    const m = pat.materials.find((x) => x.id === g.piece.material);
    const color = g.piece.color ?? m?.color ?? '#cccccc';
    page.save();
    page.opacity(0.22);
    page.fill(color).poly(g.polygon.map(P), true, 'f');
    page.restore();
    page.save().stroke(MUTED, 0.4).dash(2, 1.5);
    for (const sa of seamAllowanceOutline(g)) page.poly(sa.map(P), true, 'S');
    page.restore();
    page.stroke(INK, 0.7).poly(g.polygon.map(P), true, 'S');
    const [a, b] = grainLine(g);
    const [ax, ay] = P(a);
    const [bx, by] = P(b);
    page.stroke(MUTED, 0.5).line(ax, ay, bx, by);
    if (labels && (g.box.maxX - g.box.minX) * k > 70 && (g.box.maxY - g.box.minY) * k > 30) {
      const [cx, cy] = P(g.center);
      page.text(cx + 4, cy + 2, g.piece.name, { size: 7.5, bold: true });
      page.text(cx + 4, cy - 8, g.piece.cut === 2 ? '2× gegengleich' : '1×', { size: 6.5, color: MUTED });
    }
  });
  return k;
}

function piecesPage(ctx: Ctx, n: number, total: number) {
  const { doc, pdf } = ctx;
  const pat = doc.pattern!;
  const page = pdf.page(W, H);
  const top = header(ctx, page, 'Schnittteile und Stoffverbrauch', n, total);
  const bottom = M + 10;
  const leftW = 470;
  sectionTitle(page, M, top, 'Schnittteile (Nahtzugabe gestrichelt, Fadenlauf als Linie)');
  const k = drawPieces(ctx, page, { x: M, y: bottom + 12, w: leftW, h: top - bottom - 28 });
  page.text(M, bottom, `Maßstab ca. 1:${Math.round(1 / (k / PT))} – Schnittteile 1:1 als DXF aus Vektordesign (Tab „Schnitt“).`, { size: 7, color: MUTED });
  const rx = M + leftW + 20;
  const rw = W - M - rx;
  sectionTitle(page, rx, top, 'Teile');
  const rows: string[][] = [];
  const usage = new Map<string, number>();
  for (const pc of pat.pieces) {
    const g = pieceGeom(doc, pc);
    if (!g) continue;
    const sa = seamAllowanceOutline(g);
    const area = (sa.length ? Math.abs(sa.reduce((s, p) => s + polygonArea(p), 0)) : g.area) * pc.cut;
    if (pc.material) usage.set(pc.material, (usage.get(pc.material) ?? 0) + area);
    const m = pat.materials.find((x) => x.id === pc.material);
    rows.push([pc.name, pc.cut === 2 ? '2× gg.' : '1×', m?.name ?? '–', `${pc.seamAllowance} mm`]);
  }
  let y = table(
    page,
    rx,
    top - 16,
    [
      { title: 'Teil', w: rw * 0.38 },
      { title: 'Zuschnitt', w: rw * 0.18 },
      { title: 'Stoff', w: rw * 0.27 },
      { title: 'NZ', w: rw * 0.17, align: 'right' },
    ],
    rows,
    { size: 8, minY: bottom + 90 },
  );
  y -= 12;
  sectionTitle(page, rx, y, 'Stoffverbrauch je Teil (Fläche inkl. NZ)');
  y -= 16;
  for (const m of pat.materials) {
    const a = usage.get(m.id);
    if (!a) continue;
    swatch(page, rx, y - 2, m.color, 9);
    page.text(rx + 15, y, `${m.name}: ${(a / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 2 })} m²`, { size: 8.5 });
    y -= 13;
  }
  wrapText('Reine Teilefläche, zzgl. Verschnitt (Richtwert 15–25 % je nach Stoffbreite und Schnittbild).', 7, rw).forEach((l, i) => page.text(rx, y - 2 - i * 9, l, { size: 7, color: MUTED }));
  page.finish({ compress: true });
}

function materialsPage(ctx: Ctx, n: number, total: number) {
  const { doc, tp, pdf } = ctx;
  const pat = doc.pattern;
  const page = pdf.page(W, H);
  let y = header(ctx, page, 'Material und Zutaten (Stückliste)', n, total);
  const fw = W - 2 * M;
  if (pat?.materials.length) {
    sectionTitle(page, M, y, 'Stoffe');
    y -= 16;
    const rows = pat.materials.map((m) => {
      const used = pat.pieces.filter((p) => p.material === m.id).map((p) => p.name);
      return [
        '',
        m.name,
        FABRICS.find((f) => f.id === m.fabric)?.name ?? m.fabric,
        `${m.gsm} g/m²`,
        m.color.toUpperCase(),
        cmykText(cmykOf(m.color, productionOf(doc).colorSpecs[m.color.toLowerCase()])),
        productionOf(doc).colorSpecs[m.color.toLowerCase()]?.pantone ?? '',
        used.join(', ') || '–',
      ];
    });
    y = table(
      page,
      M,
      y,
      [
        { title: '', w: 22 },
        { title: 'Stoff', w: 110 },
        { title: 'Art', w: 120 },
        { title: 'Gewicht', w: 60 },
        { title: 'HEX', w: 62 },
        { title: 'CMYK', w: 100 },
        { title: 'Pantone', w: 70 },
        { title: 'Verwendet für', w: fw - 544 },
      ],
      rows,
      { size: 8, onRow: (i, ry) => swatch(page, M + 6, ry - 2, pat.materials[i].color, 9) },
    );
    y -= 14;
  }
  sectionTitle(page, M, y, 'Zutaten und Etiketten');
  y -= 16;
  if (tp.trims.length) {
    y = table(
      page,
      M,
      y,
      [
        { title: 'Zutat', w: 150 },
        { title: 'Spezifikation', w: 260 },
        { title: 'Menge', w: 60, align: 'right' },
        { title: 'Platzierung', w: fw - 470 },
      ],
      tp.trims.map((t) => [t.name, t.spec, t.qty, t.placement]),
      { size: 8, minY: M + 20 },
    );
  } else page.text(M, y, 'Keine Zutaten erfasst – Etiketten, Kordeln, Ösen usw. im Tech-Pack-Dialog ergänzen oder in LabwearOS pflegen.', { size: 8.5, color: MUTED });
  page.finish({ compress: true });
}

function constructionPage(ctx: Ctx, n: number, total: number) {
  const { doc, tp, pdf } = ctx;
  const page = pdf.page(W, H);
  let y = header(ctx, page, 'Verarbeitung', n, total);
  const fw = W - 2 * M;
  const rows = constructionRows(doc);
  if (rows.length) {
    sectionTitle(page, M, y, 'Nähte und Kanten');
    y -= 16;
    y = table(
      page,
      M,
      y,
      [
        { title: 'Naht / Kante', w: 170 },
        { title: 'Teile', w: 190 },
        { title: 'Länge', w: 52, align: 'right' },
        { title: 'Anzahl', w: 46, align: 'right' },
        { title: 'Verarbeitung', w: fw - 458 },
      ],
      rows.map((r) => [r.name, r.pieces, `${cm(r.length)} cm`, `${r.count}×`, tp.construction[r.key] ?? r.suggestion]),
      { size: 8, minY: M + 60, rowFill: (i) => (rows[i].kind === 'edge' ? '#fbfbfc' : null) },
    );
    y -= 10;
  }
  const pat = doc.pattern;
  if (pat?.pieces.length) {
    const sas = [...new Set(pat.pieces.map((p) => p.seamAllowance))];
    page.text(M, y, `Nahtzugaben laut Schnitt: ${sas.length === 1 ? `${sas[0]} mm an allen Teilen` : pat.pieces.map((p) => `${p.name} ${p.seamAllowance} mm`).join(', ')}.`, { size: 8.5 });
    y -= 16;
  }
  if (tp.notes) {
    sectionTitle(page, M, y, 'Hinweise');
    y -= 14;
    for (const l of tp.notes.split('\n').flatMap((p) => wrapText(p, 9, fw))) {
      if (y < M + 10) break;
      page.text(M, y, l, { size: 9 });
      y -= 12;
    }
  }
  page.finish({ compress: true });
}

function artworkPage(ctx: Ctx, n: number, total: number, motifs: Motif[]) {
  const { doc, pdf } = ctx;
  const prod = productionOf(doc);
  const g = garmentOf(prod.garment);
  const v0 = prod.variants[0];
  const page = pdf.page(W, H);
  const top = header(ctx, page, 'Artwork (Details im Artwork-Blatt)', n, total);
  const colW = (W - 2 * M - 20) / 2;
  motifs.forEach((m, i) => {
    const x = M + i * (colW + 20);
    let y = top;
    page.text(x, y, m.name, { size: 12, bold: true });
    y -= 12;
    const scene = ctx.scenes.get(m.id)!;
    const size = motifSize(doc, m);
    const boxH = 170;
    page.fill(v0.fabric).rect(x, y - boxH - 6, colW, boxH);
    if (size) {
      const k = Math.min((colW - 40) / size.w, (boxH - 30) / size.h, 3 * PT);
      const w = size.w * k;
      const h = size.h * k;
      page.scene(scene, { ox: x + (colW - w) / 2, oy: y - 6 - boxH + (boxH - h) / 2, k, box: scene.box });
    }
    y -= boxH + 22;
    const side = m.placement.x > 0.5 ? 'rechts' : m.placement.x < -0.5 ? 'links' : '';
    y = kv(page, x, y, 'Veredelung', techniqueName(m.technique), colW);
    if (size) y = kv(page, x, y, 'Größe', `${cm(size.w)} × ${cm(size.h)} cm`, colW);
    y = kv(
      page,
      x,
      y,
      'Platzierung',
      `${m.placement.view === 'front' ? 'Vorne' : 'Hinten'}: Oberkante ${cm(m.placement.y)} cm unter ${g.reference[m.placement.view]}${side ? `, Mitte ${cm(Math.abs(m.placement.x))} cm ${side} der Mittellinie (Bildansicht)` : ', mittig'}`,
      colW,
    );
    if (m.note) y = kv(page, x, y, 'Hinweis', m.note, colW);
    y -= 2;
    sectionTitle(page, x, y, `Druckfarben (${v0.name})`);
    y -= 15;
    for (const orig of motifColors(doc, m)) {
      if (y < M + 10) break;
      const c = variantColor(v0, orig);
      const spec = prod.colorSpecs[c];
      swatch(page, x, y - 2, c);
      page.text(x + 16, y, c.toUpperCase(), { size: 8.5, bold: true });
      page.text(x + 66, y, cmykText(cmykOf(c, spec)), { size: 8 });
      page.text(x + 160, y, spec?.pantone ? `Pantone ${spec.pantone}` : '', { size: 8 });
      y -= 14;
    }
  });
  page.finish({ compress: true });
}

function referencesPage(ctx: Ctx, n: number, total: number, start: number) {
  const { tp, pdf } = ctx;
  const page = pdf.page(W, H);
  const top = header(ctx, page, 'Referenzen', n, total);
  const refs = tp.references.slice(start, start + 4);
  const cw = (W - 2 * M - 20) / 2;
  const ch = (top - M - 14) / 2;
  refs.forEach((r, i) => {
    const x = M + (i % 2) * (cw + 20);
    const y = top - Math.floor(i / 2) * (ch + 6);
    const imgW = cw * 0.58;
    page.fill(SOFT).rect(x, y - ch + 6, imgW, ch - 6);
    const px = ctx.refs.get(r.id);
    if (px) fitImage(page, px, x + 4, y - ch + 10, imgW - 8, ch - 14);
    else page.text(x + imgW / 2, y - ch / 2, '(Bild nicht verfügbar)', { size: 8, color: MUTED, align: 'center' });
    const tx = x + imgW + 12;
    const tw = cw - imgW - 12;
    page.text(tx, y - 4, r.category.toUpperCase(), { size: 7, bold: true, color: ACCENT });
    let ty = y - 18;
    for (const l of wrapText(r.name, 10, tw, true)) {
      page.text(tx, ty, l, { size: 10, bold: true });
      ty -= 12;
    }
    ty -= 4;
    for (const l of r.note.split('\n').flatMap((p) => wrapText(p, 8.5, tw))) {
      if (ty < y - ch + 10) break;
      page.text(tx, ty, l, { size: 8.5 });
      ty -= 11;
    }
  });
  page.finish({ compress: true });
}

export const techPackFileName = (article: string, version: string) => `${article.replace(/[^\w\-äöüÄÖÜß ]+/g, '_').trim() || 'Artikel'}_v${version}_TechPack.pdf`;
