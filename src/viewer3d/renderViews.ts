import type { SketchDoc } from '../model/types';
import { GarmentViewer } from './viewer';

/**
 * 3D-Ansichten fürs Tech-Pack: Kleidungsstück unsichtbar im Hintergrund drapieren und vorne, hinten und
 * von der Seite fotografieren (helles Studio, JPEG). Liefert null, wenn WebGL fehlt oder es zu lange dauert.
 */
export async function render3DViews(
  doc: SketchDoc,
  opts: { width?: number; height?: number; timeout?: number; onProgress?: (t: string) => void } = {},
): Promise<{ front: string; back: string; side: string } | null> {
  const w = opts.width ?? 720;
  const h = opts.height ?? 1560;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' });
  document.body.appendChild(host);
  let viewer: GarmentViewer | null = null;
  try {
    let resolveReady: (ok: boolean) => void = () => {};
    const ready = new Promise<boolean>((r) => (resolveReady = r));
    viewer = new GarmentViewer(host, {
      onStatus: (s) => {
        if (s.state === 'simulating') opts.onProgress?.(`3D-Ansichten: Stoff fällt … ${Math.round((s.stats?.time ?? 0) * 10) / 10} s`);
        if (s.state === 'ready') resolveReady(true);
        if (s.state === 'error' || s.state === 'empty') resolveReady(false);
      },
    });
    viewer.setOptions({ dark: false, showBody: true, quality: 'preview', mode: 'look' });
    viewer.setDoc(doc);
    const ok = await Promise.race([ready, new Promise<boolean>((r) => setTimeout(() => r(false), opts.timeout ?? 90000))]);
    if (!ok) return null;
    // ein Bild warten, damit die letzten Positionen gezeichnet sind
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const d0 = viewer.distance;
    const shot = (v: 'front' | 'back' | 'left') => {
      viewer!.view(v);
      // näher heran: das Kleidungsstück füllt das Bild, die Hände dürfen angeschnitten sein
      viewer!.distance = d0 * 0.72;
      return toJpeg(viewer!.snapshot(1.5));
    };
    return { front: await shot('front'), back: await shot('back'), side: await shot('left') };
  } catch {
    return null;
  } finally {
    viewer?.dispose();
    host.remove();
  }
}

async function toJpeg(png: string): Promise<string> {
  const img = new Image();
  img.src = png;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  return c.toDataURL('image/jpeg', 0.88);
}
