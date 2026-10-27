import type { TextEntity } from '../model/types';

/** Textmaße in mm relativ zum Ankerpunkt (Grundlinie). Y nach oben. */
export interface TextBox {
  left: number;
  right: number;
  ascent: number;
  descent: number;
}

let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
const cache = new Map<string, TextBox>();

function measureCtx() {
  if (ctx !== undefined) return ctx;
  try {
    if (typeof OffscreenCanvas !== 'undefined') ctx = new OffscreenCanvas(8, 8).getContext('2d');
    else if (typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d');
    else ctx = null;
  } catch {
    ctx = null;
  }
  return ctx;
}

export function cssFont(t: Pick<TextEntity, 'fontFamily' | 'fontWeight' | 'italic'>, sizePx: number): string {
  const fam = t.fontFamily.includes(' ') && !t.fontFamily.includes('"') ? `"${t.fontFamily}"` : t.fontFamily;
  return `${t.italic ? 'italic ' : ''}${t.fontWeight} ${sizePx}px ${fam}, sans-serif`;
}

/** Misst einen Text (Ergebnis in mm). In Node ohne Canvas wird geschätzt. */
export function measureText(t: Pick<TextEntity, 'text' | 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic' | 'align'>): TextBox {
  const key = `${t.fontFamily}|${t.fontWeight}|${t.italic}|${t.fontSize}|${t.align}|${t.text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = measureCtx();
  const REF = 100; // Referenzgröße in px, danach skaliert
  let width: number;
  let ascent: number;
  let descent: number;
  let leftBearing = 0;
  if (c) {
    c.font = cssFont(t, REF);
    const m = c.measureText(t.text || ' ');
    width = m.width;
    ascent = m.actualBoundingBoxAscent || REF * 0.72;
    descent = m.actualBoundingBoxDescent || 0;
    leftBearing = m.actualBoundingBoxLeft !== undefined ? -m.actualBoundingBoxLeft : 0;
    if (t.text.trim() === '') {
      ascent = REF * 0.72;
      descent = 0;
    }
  } else {
    width = 0.58 * REF * Math.max(1, t.text.length);
    ascent = 0.72 * REF;
    descent = 0.2 * REF;
  }
  const s = t.fontSize / REF;
  let left = Math.min(0, leftBearing) * s;
  let right = width * s;
  if (t.align === 'center') {
    left -= (width * s) / 2;
    right -= (width * s) / 2;
  } else if (t.align === 'right') {
    left -= width * s;
    right -= width * s;
  }
  const box = { left, right, ascent: ascent * s, descent: descent * s };
  if (cache.size > 2000) cache.clear();
  cache.set(key, box);
  return box;
}

/** Cache leeren, wenn Schriften nachgeladen wurden. */
export function clearTextMetricsCache(): void {
  cache.clear();
}
