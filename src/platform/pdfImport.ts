/**
 * Vorlagen-Import: PDF bzw. AI mit PDF-Kompatibilität (z. B. LabwearOS-Vorlagen) als Bild
 * rendern. pdf.js läuft dabei ohne separaten Worker im Hauptthread, damit es auch offline und
 * als Einzeldatei funktioniert. Wird erst beim ersten Import geladen.
 */

export interface RenderedPage {
  /** PNG als Data-URL */
  image: string;
  widthPx: number;
  heightPx: number;
  /** Seitengröße 1:1 (aus Punkt umgerechnet) */
  widthMm: number;
  heightMm: number;
  pages: number;
}

export class TemplateImportError extends Error {}

async function pdfjs() {
  const [lib, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs')]);
  (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
  return lib;
}

/** Prüft, ob die Datei ein PDF ist (auch .ai mit PDF-Kompatibilität). */
export function isPdf(data: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(data.subarray(0, 1024));
  return head.includes('%PDF-');
}

export async function renderPdfPage(data: Uint8Array, pageNo = 1, maxPx = 2400): Promise<RenderedPage> {
  if (!isPdf(data)) {
    throw new TemplateImportError('Die Datei ist kein PDF. Illustrator-Dateien (.ai) bitte „mit PDF-Kompatibilität“ speichern oder als PDF exportieren.');
  }
  const lib = await pdfjs();
  let pdf;
  try {
    pdf = await lib.getDocument({ data: data.slice(), isEvalSupported: false, disableFontFace: false, useSystemFonts: true }).promise;
  } catch (e) {
    throw new TemplateImportError(`PDF konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`);
  }
  const n = Math.min(Math.max(1, pageNo), pdf.numPages);
  const page = await pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxPx / base.width, maxPx / base.height, 8);
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const image = canvas.toDataURL('image/png');
  const out: RenderedPage = {
    image,
    widthPx: canvas.width,
    heightPx: canvas.height,
    widthMm: (base.width / 72) * 25.4,
    heightMm: (base.height / 72) * 25.4,
    pages: pdf.numPages,
  };
  await pdf.destroy();
  return out;
}

/** Bild (Data-URL) in RGBA-Pixel umwandeln, höchstens `maxPx` breit/hoch (für das Artwork-Blatt). */
export async function decodeImage(url: string, maxPx = 1400): Promise<{ rgba: Uint8ClampedArray; width: number; height: number } | null> {
  if (typeof document === 'undefined') return null;
  const img = new Image();
  img.src = url;
  await img.decode();
  const k = Math.min(1, maxPx / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  return { rgba: ctx.getImageData(0, 0, w, h).data, width: w, height: h };
}
