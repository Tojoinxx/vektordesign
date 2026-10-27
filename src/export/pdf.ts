import { PdfDoc, PT, type ColorMode } from './pdfDoc';
import type { ExportScene } from './scene';

/**
 * PDF-Export (vektorbasiert, maßstabsgetreu): Seitengröße = Motiv in mm, jede Ebene als
 * PDF-Ebene (optionaler Inhalt), Farben in RGB oder CMYK, Deckkraft, Verläufe als Shading
 * (Verblassen per weicher Maske). Text kommt immer als Umriss (siehe textOutlines).
 */

export type { ColorMode };

export interface PdfOptions {
  colorMode?: ColorMode;
  mirror?: boolean;
  title?: string;
}

export function exportPdf(scene: ExportScene, opts: PdfOptions = {}): Uint8Array {
  // Unkomprimiert: Motivdateien sind klein und bleiben so in jedem Werkzeug lesbar
  const doc = new PdfDoc(opts.colorMode ?? 'rgb', false);
  const page = doc.page(scene.widthMm * PT, scene.heightMm * PT);
  page.scene(scene, { ox: 0, oy: 0, k: PT, box: scene.box, mirror: opts.mirror, layers: true });
  page.finish({ trim: true, compress: false });
  return doc.finish(opts.title ?? 'Motiv');
}

export const PT_PER_MM = PT;
