import type { Entity, ImageEntity, SketchDoc, Vec2 } from './types';
import { pt } from './doc';

/** Vorlagenbild (nur zum Nachzeichnen, nie im Export)? */
export const isReferenceImage = (e: Entity): boolean => e.kind === 'image' && e.reference;

/** Ecken eines Bildes in Weltkoordinaten: unten links, unten rechts, oben rechts, oben links. */
export function imageCorners(doc: SketchDoc, e: ImageEntity): Vec2[] {
  const c = pt(doc, e.anchor);
  const a = (e.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const w = e.width / 2;
  const h = e.height / 2;
  const local: Vec2[] = [
    { x: -w, y: -h },
    { x: w, y: -h },
    { x: w, y: h },
    { x: -w, y: h },
  ];
  return local.map((p) => ({ x: c.x + p.x * cos - p.y * sin, y: c.y + p.x * sin + p.y * cos }));
}

/** Bilder für die Darstellung (einmal dekodiert, nach Inhalt zwischengespeichert). */
const cache = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

export function onImageLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function imageElement(src: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null;
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => listeners.forEach((f) => f());
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : null;
}

/** Wartet, bis alle Bilder einer Zeichnung geladen sind (vor PNG-Export). */
export async function preloadImages(doc: SketchDoc): Promise<void> {
  const srcs = new Set<string>();
  for (const e of Object.values(doc.entities)) if (e.kind === 'image') srcs.add(e.src);
  await Promise.all(
    [...srcs].map(async (src) => {
      imageElement(src);
      const img = cache.get(src);
      if (img && !(img.complete && img.naturalWidth)) await img.decode().catch(() => {});
    }),
  );
}

/** Bilddatei lesen: Data-URL und Pixelmaße; große Bilder werden verkleinert (Projektgröße). */
export async function readImageFile(data: Uint8Array, mime: string, maxPx = 3000): Promise<{ src: string; pxWidth: number; pxHeight: number }> {
  const blob = new Blob([data as BlobPart], { type: mime || 'image/png' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const jpeg = /jpe?g/i.test(mime);
    return { src: c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), pxWidth: w, pxHeight: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}
