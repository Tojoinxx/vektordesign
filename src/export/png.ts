import { preloadImages } from '../model/image';
import type { SketchDoc } from '../model/types';
import { docBBox } from '../model/bounds';
import { drawDesign } from '../render/drawDesign';
import { ExportError } from './svg';
import { setPngDpi } from './pngMeta';

export interface PngExportOptions {
  dpi: number;
  bounds?: 'geometry' | 'stroke';
  /** Hintergrundfarbe, null = transparent */
  background?: string | null;
  mirror?: boolean;
}

export interface PngExportResult {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
}

export const MIN_DPI = 300;
const MAX_SIDE = 16384;
const MAX_PIXELS = 16384 * 16384;

/** Pixelmaße für eine Ausgabe – auch für die Anzeige im Exportdialog. */
export function pngSize(doc: SketchDoc, dpi: number, bounds: 'geometry' | 'stroke' = 'geometry') {
  const box = docBBox(doc, { includeStroke: bounds === 'stroke' });
  if (!box) return null;
  const wMm = box.maxX - box.minX;
  const hMm = box.maxY - box.minY;
  const s = dpi / 25.4;
  return { box, wMm, hMm, wPx: Math.max(1, Math.ceil(wMm * s - 1e-6)), hPx: Math.max(1, Math.ceil(hMm * s - 1e-6)) };
}

/** Rendert das Design als PNG mit transparentem Hintergrund und eingetragener Auflösung. */
export async function exportPng(doc: SketchDoc, opts: PngExportOptions): Promise<PngExportResult> {
  if (!(opts.dpi >= 72)) throw new ExportError('Auflösung zu klein');
  const size = pngSize(doc, opts.dpi, opts.bounds);
  if (!size) throw new ExportError('Nichts zu exportieren: Die Zeichnung enthält keine sichtbaren Objekte.');
  const { box, wPx, hPx, wMm, hMm } = size;
  if (wPx > MAX_SIDE || hPx > MAX_SIDE || wPx * hPx > MAX_PIXELS) {
    throw new ExportError(`Das Bild wäre ${wPx} × ${hPx} px groß – zu groß für den Export. Bitte eine kleinere Auflösung wählen.`);
  }
  const s = opts.dpi / 25.4;
  await preloadImages(doc);
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(wPx, hPx);
  else {
    canvas = document.createElement('canvas');
    canvas.width = wPx;
    canvas.height = hPx;
  }
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new ExportError('Zeichenfläche für den Export nicht verfügbar');
  if (opts.background) {
    ctx.fillStyle = opts.background;
    ctx.fillRect(0, 0, wPx, hPx);
  }
  const toScreen = opts.mirror
    ? (p: { x: number; y: number }) => ({ x: (box.maxX - p.x) * s, y: (box.maxY - p.y) * s })
    : (p: { x: number; y: number }) => ({ x: (p.x - box.minX) * s, y: (box.maxY - p.y) * s });
  if (opts.mirror) {
    // Text würde sonst seitenrichtig bleiben: ganzen Inhalt spiegeln
    ctx.translate(wPx, 0);
    ctx.scale(-1, 1);
    drawDesign({ ctx, toScreen: (p) => ({ x: (p.x - box.minX) * s, y: (box.maxY - p.y) * s }), scale: s, minStrokePx: 0, design: true }, doc);
  } else {
    drawDesign({ ctx, toScreen, scale: s, minStrokePx: 0, design: true }, doc);
  }
  let blob: Blob;
  if ('convertToBlob' in canvas) blob = await canvas.convertToBlob({ type: 'image/png' });
  else
    blob = await new Promise<Blob>((res, rej) =>
      (canvas as HTMLCanvasElement).toBlob((b) => (b ? res(b) : rej(new ExportError('PNG konnte nicht erzeugt werden'))), 'image/png'),
    );
  const bytes = setPngDpi(new Uint8Array(await blob.arrayBuffer()), opts.dpi);
  return { bytes, widthPx: wPx, heightPx: hPx, widthMm: wMm, heightMm: hMm };
}

/** Kleine Vorschau als Data-URL (für Stilvorschläge und den Assistenten). */
export async function renderPreviewPng(doc: SketchDoc, maxPx = 512, background: string | null = '#ffffff'): Promise<{ base64: string; width: number; height: number } | null> {
  const box = docBBox(doc);
  if (!box) return null;
  const wMm = Math.max(box.maxX - box.minX, 0.1);
  const hMm = Math.max(box.maxY - box.minY, 0.1);
  const pad = 0.06;
  const s = (maxPx * (1 - 2 * pad)) / Math.max(wMm, hMm);
  const W = Math.ceil(wMm * s + maxPx * pad * 2);
  const H = Math.ceil(hMm * s + maxPx * pad * 2);
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
  if (!ctx) return null;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);
  }
  const ox = maxPx * pad;
  drawDesign({ ctx, toScreen: (p) => ({ x: ox + (p.x - box.minX) * s, y: ox + (box.maxY - p.y) * s }), scale: s, minStrokePx: 0.75, design: true }, doc);
  let blob: Blob;
  if ('convertToBlob' in canvas) blob = await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  else blob = await new Promise<Blob>((res) => (canvas as HTMLCanvasElement).toBlob((b) => res(b!), 'image/png'));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { base64: btoa(bin), width: W, height: H };
}
