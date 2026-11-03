/**
 * Kleine, oft wiederholte Bildteile (Abhängigkeits-Symbole, Bemaßungstexte) einmal zeichnen und danach nur noch
 * stempeln. drawImage einer fertigen Vorlage ist auf der Zeichenfläche um ein Vielfaches schneller als Pfade mit
 * save/restore oder fillText – entscheidend bei Hunderten von Symbolen pro Bild.
 *
 * Ohne OffscreenCanvas/DOM (Tests in Node) wird direkt gezeichnet.
 */

type Ctx = CanvasRenderingContext2D;
type Surface = OffscreenCanvas | HTMLCanvasElement;

interface Sprite {
  canvas: Surface | ImageBitmap;
  /** Ursprung in der Vorlage (CSS-Pixel), entspricht dem Ankerpunkt */
  ox: number;
  oy: number;
  w: number;
  h: number;
  dpr: number;
}

const cache = new Map<string, Sprite>();
const MAX = 4000;

function surface(w: number, h: number): Surface | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

/** Skalierung der Zeichenfläche (Gerätepixel je CSS-Pixel). */
export function ctxScale(ctx: Ctx): number {
  const t = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  return t ? Math.hypot(t.a, t.b) || 1 : 1;
}

export function spritesAvailable(ctx: Ctx): boolean {
  return typeof ctx.drawImage === 'function' && typeof ctx.getTransform === 'function' && (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined');
}

/**
 * Vorlage holen oder zeichnen und an (x, y) stempeln. `draw` zeichnet relativ zum Anker (0, 0) in einem Feld
 * von −ox … w−ox × −oy … h−oy (CSS-Pixel).
 */
export function stamp(ctx: Ctx, key: string, x: number, y: number, w: number, h: number, ox: number, oy: number, draw: (c: Ctx) => void): void {
  const dpr = ctxScale(ctx);
  const k = `${key}@${dpr}`;
  let sp = cache.get(k);
  if (!sp) {
    const cw = Math.max(1, Math.ceil(w * dpr));
    const ch = Math.max(1, Math.ceil(h * dpr));
    const s = surface(cw, ch);
    const c = s?.getContext('2d') as Ctx | null;
    if (!s || !c) {
      ctx.save();
      ctx.translate(x, y);
      draw(ctx);
      ctx.restore();
      return;
    }
    c.setTransform(dpr, 0, 0, dpr, ox * dpr, oy * dpr);
    draw(c);
    if (cache.size > MAX) cache.clear();
    // Als ImageBitmap gespeichert: wird ohne Umweg über die Grafikkarte kopiert
    const img = typeof OffscreenCanvas !== 'undefined' && s instanceof OffscreenCanvas ? s.transferToImageBitmap() : s;
    sp = { canvas: img, ox, oy, w: cw / dpr, h: ch / dpr, dpr };
    cache.set(k, sp);
  }
  // auf ganze Gerätepixel setzen: scharf und ohne Weichzeichnen
  const px = Math.round((x - sp.ox) * dpr) / dpr;
  const py = Math.round((y - sp.oy) * dpr) / dpr;
  ctx.drawImage(sp.canvas as CanvasImageSource, px, py, sp.w, sp.h);
}

/** Alle Vorlagen verwerfen (z. B. nach Wechsel hell/dunkel; Schlüssel enthalten die Farben ohnehin). */
export function clearSprites(): void {
  cache.clear();
}
