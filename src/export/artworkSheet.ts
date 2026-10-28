import type { GarmentTemplate, GarmentView, Motif, Production, SketchDoc, Variant } from '../model/types';
import { luminance } from '../model/color';
import { areaOf, drawingBounds, garmentOf, techniqueName, type GarmentDrawing } from '../model/garments';
import { applyVariant, cmykOf, cmykText, motifColors, motifDoc, motifSize, variantColor } from '../model/production';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import { PdfDoc, PdfPage, PT, wrapText, type ColorMode } from './pdfDoc';
import { buildScene, textOutlines, type ExportScene } from './scene';

/**
 * Artwork-Blatt (PDF, A4 quer) als Anhang bzw. Referenz für LabwearOS:
 * Seite je Motiv mit Platzierungsskizze (vorne/hinten), Motiv mit Maßen, Veredelung und
 * Farbangaben; danach eine Übersicht aller Farbvarianten.
 */

export interface TemplatePixels {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export interface SheetOptions {
  colorMode?: ColorMode;
  date?: Date;
  /** Dekodiert importierte Vorlagenbilder (nur im Browser verfügbar) */
  decodeTemplate?: (t: GarmentTemplate) => Promise<TemplatePixels | null>;
}

const A4W = 297 * PT;
const A4H = 210 * PT;
const M = 28; // Rand in pt
const INK = '#1e2328';
const MUTED = '#6b7480';
const LINE = '#c9d0d7';
const ACCENT = '#d9a900';

const mmText = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString('de-DE')} mm`;

interface Ctx {
  doc: SketchDoc;
  p: Production;
  pdf: PdfDoc;
  scenes: Map<string, ExportScene>;
  templates: Partial<Record<GarmentView, TemplatePixels | null>>;
  date: Date;
}

export async function buildArtworkSheet(doc: SketchDoc, p: Production, opts: SheetOptions = {}): Promise<Uint8Array> {
  const pdf = new PdfDoc(opts.colorMode ?? 'rgb', true);
  const ctx: Ctx = { doc, p, pdf, scenes: new Map(), templates: {}, date: opts.date ?? new Date() };
  const { outlines } = await textOutlines(doc);
  for (const m of p.motifs) {
    for (const v of p.variants) {
      const md = applyVariant(motifDoc(doc, m), v);
      try {
        ctx.scenes.set(`${m.id}/${v.id}`, buildScene(md, { outlines }));
      } catch {
        /* leeres Motiv */
      }
    }
  }
  if (opts.decodeTemplate && p.templates) {
    for (const view of ['front', 'back'] as GarmentView[]) {
      const t = p.templates[view];
      if (t) ctx.templates[view] = await opts.decodeTemplate(t).catch(() => null);
    }
  }
  const pages = p.motifs.length + 1;
  p.motifs.forEach((m, i) => motifPage(ctx, m, i + 1, pages));
  variantsPage(ctx, pages, pages);
  return pdf.finish(`Artwork-Blatt ${p.article} v${p.version}`);
}

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

function header(ctx: Ctx, page: PdfPage, title: string, n: number, total: number) {
  const { p } = ctx;
  const g = garmentOf(p.garment);
  page.fill(ACCENT).rect(M, A4H - M - 4, 34, 4);
  page.text(M, A4H - M - 22, 'ARTWORK-BLATT', { size: 8, bold: true, color: MUTED });
  page.text(M, A4H - M - 42, `${p.article}  ·  Version ${p.version}`, { size: 17, bold: true });
  page.text(M, A4H - M - 58, `${g.name}  ·  ${title}`, { size: 10, color: MUTED });
  const right = A4W - M;
  page.text(right, A4H - M - 22, ctx.date.toLocaleDateString('de-DE'), { size: 8, color: MUTED, align: 'right' });
  page.text(right, A4H - M - 34, `Seite ${n} von ${total}`, { size: 8, color: MUTED, align: 'right' });
  page.stroke(LINE, 0.6).line(M, A4H - M - 68, A4W - M, A4H - M - 68);
  page.text(M, M - 12, `Erstellt mit ${APP_NAME} ${APP_VERSION}. Alle Maße in mm, Motivdateien im Maßstab 1:1. Pantone-Angaben sind Freitext des Gestalters.`, { size: 6.5, color: MUTED });
}

function fabricLine(fabric: string): string {
  return luminance(fabric) < 0.3 ? '#8b939c' : '#59616b';
}

/** Kleidungsstück-Skizze mit Motiv(en) in ein Feld zeichnen. Liefert Maßstab und Ursprung. */
function garmentSketch(ctx: Ctx, page: PdfPage, view: GarmentView, variant: Variant, frame: { x: number; y: number; w: number; h: number }, motifs: Motif[], annotate: Motif | null): void {
  const g = garmentOf(ctx.p.garment);
  const drawing: GarmentDrawing = g.draw(view);
  const tpl = ctx.p.templates?.[view];
  const pix = ctx.templates[view];
  // Rahmen in Kleidungsstück-Koordinaten (mm, y nach unten)
  let b = drawingBounds(drawing);
  if (tpl) b = { minX: -tpl.originX, minY: -tpl.originY, maxX: tpl.widthMm - tpl.originX, maxY: tpl.heightMm - tpl.originY };
  const s = Math.min(frame.w / (b.maxX - b.minX), frame.h / (b.maxY - b.minY));
  const cx = frame.x + frame.w / 2 - ((b.minX + b.maxX) / 2) * s;
  const cy = frame.y + frame.h / 2 + ((b.minY + b.maxY) / 2) * s;
  const P = (x: number, y: number): [number, number] => [cx + x * s, cy - y * s];

  if (tpl && pix) {
    const [x0, y1] = P(b.minX, b.minY);
    const [x1, y0] = P(b.maxX, b.maxY);
    page.image(pix.rgba, pix.width, pix.height, x0, y0, x1 - x0, y1 - y0);
  } else {
    page.save();
    for (const f of drawing.fills) {
      page.fill(variant.fabric).stroke(fabricLine(variant.fabric), 0.7);
      page.poly(
        f.pts.map(([x, y]) => P(x, y)),
        f.closed,
        'B',
      );
    }
    page.stroke(fabricLine(variant.fabric), 0.5).dash(2, 1.5);
    for (const l of drawing.lines)
      page.poly(
        l.pts.map(([x, y]) => P(x, y)),
        l.closed,
        'S',
      );
    page.restore();
  }

  for (const m of motifs) {
    if (m.placement.view !== view) continue;
    const scene = ctx.scenes.get(`${m.id}/${variant.id}`);
    const size = motifSize(ctx.doc, m);
    if (!scene || !size) continue;
    const left = m.placement.x - size.w / 2;
    const [ox, oy] = P(left, m.placement.y + size.h);
    page.save();
    page.scene(scene, { ox, oy, k: s, box: scene.box });
    page.restore();
    if (annotate && annotate.id === m.id) {
      const [ax, ay] = P(left, m.placement.y);
      const [bx] = P(left + size.w, m.placement.y);
      const [rx, ry] = P(0, 0);
      page.save().stroke('#e8590c', 0.6).dash(1.5, 1.5);
      page.rect(ax, oy, bx - ax, ay - oy, 'S');
      page.restore();
      // Abstand Kragen → Oberkante
      const dimX = m.placement.x >= 0 ? bx + 10 : ax - 10;
      dimV(page, dimX, ry, ay, mmText(m.placement.y), m.placement.x >= 0 ? 'right' : 'left');
      page
        .save()
        .stroke('#e8590c', 0.4)
        .dash(1, 1.5)
        .line(rx - 6, ry, dimX + (m.placement.x >= 0 ? 4 : -4), ry)
        .restore();
      // Abstand Mittellinie → Motivmitte
      if (Math.abs(m.placement.x) > 0.5) {
        const [mx] = P(m.placement.x, 0);
        dimH(page, rx, mx, oy - 10, mmText(Math.abs(m.placement.x)), true);
      }
      page
        .save()
        .stroke('#e8590c', 0.35)
        .dash(3, 2)
        .line(rx, ry + 8, rx, oy - 20)
        .restore();
    }
  }
}

function arrow(page: PdfPage, x: number, y: number, dx: number, dy: number) {
  const L = 4;
  const W = 1.6;
  const nx = -dy;
  const ny = dx;
  page.fill('#e8590c').poly(
    [
      [x, y],
      [x - dx * L + nx * W, y - dy * L + ny * W],
      [x - dx * L - nx * W, y - dy * L - ny * W],
    ],
    true,
    'f',
  );
}

function dimH(page: PdfPage, x1: number, x2: number, y: number, label: string, below = false) {
  const a = Math.min(x1, x2);
  const b = Math.max(x1, x2);
  page.stroke('#e8590c', 0.5).line(a, y, b, y);
  arrow(page, a, y, -1, 0);
  arrow(page, b, y, 1, 0);
  page.text((a + b) / 2, below ? y - 8.5 : y + 3, label, { size: 7, bold: true, color: '#e8590c', align: 'center' });
}

function dimV(page: PdfPage, x: number, y1: number, y2: number, label: string, side: 'left' | 'right') {
  const a = Math.min(y1, y2);
  const b = Math.max(y1, y2);
  page.stroke('#e8590c', 0.5).line(x, a, x, b);
  arrow(page, x, a, 0, -1);
  arrow(page, x, b, 0, 1);
  page.text(side === 'right' ? x + 4 : x - 4, (a + b) / 2 - 2.5, label, { size: 7, bold: true, color: '#e8590c', align: side === 'right' ? 'left' : 'right' });
}

function swatch(page: PdfPage, x: number, y: number, hex: string, size = 11) {
  page.fill(hex).stroke(LINE, 0.5).rect(x, y, size, size, 'B');
}

function kv(page: PdfPage, x: number, y: number, k: string, v: string, w: number): number {
  page.text(x, y, k, { size: 7.5, color: MUTED });
  const lines = wrapText(v, 9, w - 92);
  lines.forEach((l, i) => page.text(x + 92, y - i * 11, l, { size: 9 }));
  return y - Math.max(1, lines.length) * 11 - 5;
}

// ---------------------------------------------------------------------------
// Seiten
// ---------------------------------------------------------------------------

function motifPage(ctx: Ctx, m: Motif, n: number, total: number) {
  const { p, doc, pdf } = ctx;
  const page = pdf.page(A4W, A4H);
  header(ctx, page, m.name, n, total);
  const g = garmentOf(p.garment);
  const v0 = p.variants[0];
  const top = A4H - M - 80;
  const bottom = M + 6;

  // Links: Platzierung vorne / hinten
  const leftW = 430;
  page.text(M, top, 'PLATZIERUNG', { size: 7.5, bold: true, color: MUTED });
  const views = g.views;
  // Ansicht mit dem Motiv bekommt mehr Platz
  const weights = views.map((v) => (v === m.placement.view ? 1.5 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let fx = M;
  views.forEach((view, i) => {
    const fw = ((leftW - (views.length - 1) * 14) * weights[i]) / wsum;
    if (i > 0) fx += 14;
    page.text(fx + fw / 2, top - 14, view === 'front' ? 'Vorderansicht' : 'Rückansicht', { size: 8, color: MUTED, align: 'center' });
    garmentSketch(ctx, page, view, v0, { x: fx, y: bottom + 30, w: fw, h: top - 24 - bottom - 30 }, p.motifs, m.placement.view === view ? m : null);
    fx += fw;
  });
  const area = areaOf(g, m.placement.area);
  const sideTxt = m.placement.x > 0.5 ? 'rechts' : m.placement.x < -0.5 ? 'links' : '';
  const posText = `Oberkante ${mmText(m.placement.y)} unter ${g.reference[m.placement.view]}${sideTxt ? `, Mitte ${mmText(Math.abs(m.placement.x))} ${sideTxt} der Mittellinie (Bildansicht)` : ', mittig'}`;
  wrapText(posText, 8, leftW).forEach((l, i) => page.text(M, bottom + 16 - i * 10, l, { size: 8 }));

  // Rechts: Motiv groß mit Maßen, Angaben, Farben
  const rx = M + leftW + 24;
  const rw = A4W - M - rx;
  page.stroke(LINE, 0.6).line(rx - 12, top + 6, rx - 12, bottom);
  page.text(rx, top, 'MOTIV', { size: 7.5, bold: true, color: MUTED });
  const size = motifSize(doc, m);
  const scene = ctx.scenes.get(`${m.id}/${v0.id}`);
  let y = top - 14;
  if (size && scene) {
    const boxH = 120;
    const k = Math.min((rw - 40) / size.w, boxH / size.h, 2.5 * PT);
    const w = size.w * k;
    const h = size.h * k;
    const ox = rx + (rw - 30 - w) / 2;
    const oy = y - 12 - h;
    // Hintergrund in Stofffarbe
    page.fill(v0.fabric).rect(rx, oy - 22, rw - 22, h + 34);
    page.scene(scene, { ox, oy, k, box: scene.box });
    dimH(page, ox, ox + w, oy - 12, mmText(size.w));
    dimV(page, ox + w + 10, oy, oy + h, mmText(size.h), 'right');
    y = oy - 40;
    page.text(rx, y + 6, `Maßstab ${Math.round((k / PT) * 100)} % – Motivdateien 1:1`, { size: 6.5, color: MUTED });
    y -= 10;
  } else {
    page.text(rx, y - 10, 'Motiv enthält keine sichtbaren Objekte.', { size: 9, color: '#d64545' });
    y -= 30;
  }
  y = kv(page, rx, y, 'Veredelung', techniqueName(m.technique), rw);
  y = kv(page, rx, y, 'Druckbereich', area ? `${area.name} (max. ${area.w} × ${area.h} mm)` : 'frei platziert', rw);
  if (size) y = kv(page, rx, y, 'Größe', `${mmText(size.w)} × ${mmText(size.h)}`, rw);
  if (size && p.sizes?.length) y = kv(page, rx, y, 'Größenstaffel', p.sizes.map((g) => `${g.name}: ${mmText((size.w * g.pct) / 100)} breit`).join(' · '), rw);
  y = kv(page, rx, y, 'Stofffarbe', `${v0.fabricName ? `${v0.fabricName}, ` : ''}${v0.fabric.toUpperCase()}`, rw);
  if (m.note) y = kv(page, rx, y, 'Hinweis', m.note, rw);

  // Farben
  y -= 4;
  page.text(rx, y, `DRUCKFARBEN (${v0.name})`, { size: 7.5, bold: true, color: MUTED });
  y -= 16;
  const colors = motifColors(doc, m);
  for (const orig of colors) {
    if (y < bottom + 6) break;
    const c = variantColor(v0, orig);
    const spec = p.colorSpecs[c];
    swatch(page, rx, y - 3, c);
    page.text(rx + 18, y, `${c.toUpperCase()}`, { size: 8.5, bold: true });
    page.text(rx + 70, y, cmykText(cmykOf(c, spec)), { size: 8 });
    page.text(rx + 160, y, spec?.pantone ? `Pantone ${spec.pantone}` : 'Pantone: –', { size: 8, color: spec?.pantone ? INK : MUTED });
    if (spec?.name) page.text(rx + 18, y - 9, spec.name, { size: 6.5, color: MUTED });
    y -= spec?.name ? 22 : 17;
  }
  if (!colors.length) page.text(rx, y, '–', { size: 9 });
  page.finish({ compress: true });
}

function variantsPage(ctx: Ctx, n: number, total: number) {
  const { p, doc, pdf } = ctx;
  const page = pdf.page(A4W, A4H);
  header(ctx, page, 'Farbvarianten', n, total);
  const top = A4H - M - 80;
  const bottom = M + 6;
  const vs = p.variants;
  const cols = Math.min(Math.max(vs.length, 1), 4);
  const colW = (A4W - 2 * M - (cols - 1) * 16) / cols;
  const g = garmentOf(p.garment);
  // Ansicht mit dem ersten Motiv
  const view = p.motifs[0]?.placement.view ?? 'front';
  vs.slice(0, 4).forEach((v, i) => {
    const x = M + i * (colW + 16);
    page.text(x, top, v.name, { size: 11, bold: true });
    swatch(page, x, top - 18, v.fabric, 9);
    page.text(x + 14, top - 16, `Stoff: ${v.fabricName ? `${v.fabricName}, ` : ''}${v.fabric.toUpperCase()}`, { size: 7.5, color: MUTED });
    const sketchH = 210;
    garmentSketch(ctx, page, view, v, { x, y: top - 30 - sketchH, w: colW, h: sketchH }, p.motifs, null);
    let y = top - 48 - sketchH;
    page.text(x, y, 'DRUCKFARBEN', { size: 7, bold: true, color: MUTED });
    y -= 14;
    const seen = new Set<string>();
    for (const m of p.motifs) {
      for (const orig of motifColors(doc, m)) {
        const c = variantColor(v, orig);
        if (seen.has(c)) continue;
        seen.add(c);
        if (y < bottom + 4) break;
        const spec = p.colorSpecs[c];
        swatch(page, x, y - 3, c, 10);
        page.text(x + 15, y, c.toUpperCase(), { size: 8, bold: true });
        page.text(x + 56, y, cmykText(cmykOf(c, spec)), { size: 7 });
        if (spec?.pantone) page.text(x + 15, y - 9, `Pantone ${spec.pantone}`, { size: 7 });
        y -= spec?.pantone ? 22 : 15;
      }
    }
  });
  if (vs.length > 4)
    page.text(
      M,
      bottom,
      `Weitere Varianten: ${vs
        .slice(4)
        .map((v) => v.name)
        .join(', ')} (siehe Motivdateien)`,
      { size: 8, color: MUTED },
    );
  void g;
  page.finish({ compress: true });
}
