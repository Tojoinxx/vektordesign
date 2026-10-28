import qrcodeNS from 'qrcode-generator';
import type { Contour, ShapeNode, Style, Vec2 } from './types';
import { circleContour, mapContours, polygonContour } from './shape';
import { intersectArea, offsetArea, polysToContours, subtractArea, unionArea } from './boolean';
import { flattenContour } from './shape';

/**
 * Vorlagen-Generatoren: Badge (rund), Wappen, Banner, Rahmen, QR-Code und Nackendruck.
 * Ergebnis sind fertige Formen (Konturen in mm, Mitte am Ursprung) mit Farbe – eingefügt als Gruppe.
 */

type QrFactory = typeof qrcodeNS;
const qrcode = ((qrcodeNS as unknown as { default?: QrFactory }).default ?? qrcodeNS) as QrFactory;

export interface GenPart {
  name: string;
  contours: Contour[];
  style: Style;
  fillRule?: 'nonzero' | 'evenodd';
}

/** Schrift als Umrisse: Text (Grundlinie y = 0, links bei x = 0) → Konturen, Breite. */
export type TextShaper = (text: string, size: number) => { contours: Contour[]; width: number; capHeight: number };

const fill = (c: string): Style => ({ fill: c, stroke: null, strokeWidth: 0.5, opacity: 1 });

// ---------------------------------------------------------------------------
// Text biegen
// ---------------------------------------------------------------------------

/**
 * Text auf einem Kreis um `c`: „top“ liest im Uhrzeigersinn oben (Grundlinie auf `r`, Schrift
 * nach außen), „bottom“ liest unten von links nach rechts (Schriftoberkante zur Mitte).
 * Der Text wird mittig zum Winkel (oben 90°, unten 270°) gesetzt.
 */
export function bendText(contours: Contour[], width: number, c: Vec2, r: number, side: 'top' | 'bottom'): Contour[] {
  const R = Math.max(1e-6, r);
  return mapContours(contours, (p) => {
    const x = p.x - width / 2;
    if (side === 'top') {
      const a = Math.PI / 2 - x / R;
      const rr = R + p.y;
      return { x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) };
    }
    const a = -Math.PI / 2 + x / R;
    const rr = R - p.y;
    return { x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) };
  });
}

/** Gerader Text, mittig auf `at` (Grundlinie). */
function straightText(shape: TextShaper, text: string, size: number, at: Vec2): Contour[] {
  const t = shape(text, size);
  return mapContours(t.contours, (p) => ({ x: at.x + p.x - t.width / 2, y: at.y + p.y }));
}

/** Text auf eine Breite begrenzen (Größe verkleinern, falls nötig). */
function fitSize(shape: TextShaper, text: string, size: number, maxW: number): number {
  const w = shape(text, size).width;
  return w > maxW && w > 0 ? (size * maxW) / w : size;
}

// ---------------------------------------------------------------------------
// Formen
// ---------------------------------------------------------------------------

export function starPolygon(c: Vec2, R: number, n = 5, ratio = 0.45, rot = Math.PI / 2): Vec2[] {
  return Array.from({ length: 2 * n }, (_, i) => {
    const r = i % 2 === 0 ? R : R * ratio;
    const a = rot + (Math.PI * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

/** Wappenschild (oben gerade, unten spitz) in Breite w und Höhe h, Mitte am Ursprung. */
export function shieldContour(w: number, h: number): Contour {
  const hw = w / 2;
  const top = h / 2;
  const side = top - h * 0.42;
  const bottom = -h / 2;
  const k = 0.5522847498;
  const nodes: ShapeNode[] = [
    { x: -hw, y: top },
    { x: hw, y: top },
    { x: hw, y: side, ox: hw, oy: side - (side - bottom) * k },
    { x: 0, y: bottom, ix: hw * 0.55, iy: bottom + (side - bottom) * 0.25, ox: -hw * 0.55, oy: bottom + (side - bottom) * 0.25 },
    { x: -hw, y: side, ix: -hw, iy: side - (side - bottom) * k },
  ];
  return { closed: true, nodes };
}

function roundRect(w: number, h: number, r: number): Contour {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.max(0, Math.min(r, hw, hh));
  if (rr < 1e-6)
    return polygonContour([
      { x: -hw, y: -hh },
      { x: hw, y: -hh },
      { x: hw, y: hh },
      { x: -hw, y: hh },
    ]);
  const k = 0.5522847498 * rr;
  return {
    closed: true,
    nodes: [
      { x: -hw + rr, y: -hh, ix: -hw + rr - k, iy: -hh },
      { x: hw - rr, y: -hh, ox: hw - rr + k, oy: -hh },
      { x: hw, y: -hh + rr, ix: hw, iy: -hh + rr - k },
      { x: hw, y: hh - rr, ox: hw, oy: hh - rr + k },
      { x: hw - rr, y: hh, ix: hw - rr + k, iy: hh },
      { x: -hw + rr, y: hh, ox: -hw + rr - k, oy: hh },
      { x: -hw, y: hh - rr, ix: -hw, iy: hh - rr + k },
      { x: -hw, y: -hh + rr, ox: -hw, oy: -hh + rr - k },
    ],
  };
}

const polysOf = (cs: Contour[]) => cs.map((c) => flattenContour(c, 0.01));

// ---------------------------------------------------------------------------
// Generatoren
// ---------------------------------------------------------------------------

export interface BadgeOptions {
  diameter: number;
  ring: number;
  top: string;
  bottom: string;
  center: string;
  stars: boolean;
  color: string;
  accent: string;
}

export function badge(o: BadgeOptions, shape: TextShaper): GenPart[] {
  const R = o.diameter / 2;
  const ri = Math.max(1, R - o.ring);
  const c = { x: 0, y: 0 };
  const parts: GenPart[] = [];
  parts.push({ name: 'Ring', contours: [circleContour(0, 0, R), circleContour(0, 0, ri)], style: fill(o.color), fillRule: 'evenodd' });
  const textH = o.ring * 0.52;
  const textCap = (s: number) => shape('H', s).capHeight || s * 0.7;
  const size = textH / (textCap(10) / 10);
  const gap = (o.ring - textH) / 2;
  const ringText: Contour[] = [];
  const arcLen = (rr: number) => Math.PI * rr * 0.8;
  if (o.top.trim()) {
    const rb = ri + gap;
    const s = fitSize(shape, o.top.trim(), size, arcLen(rb));
    const t = shape(o.top.trim(), s);
    ringText.push(...bendText(t.contours, t.width, c, rb, 'top'));
  }
  if (o.bottom.trim()) {
    const rb = R - gap;
    const s = fitSize(shape, o.bottom.trim(), size, arcLen(rb - textH));
    const t = shape(o.bottom.trim(), s);
    ringText.push(...bendText(t.contours, t.width, c, rb, 'bottom'));
  }
  if (o.stars) {
    const sr = textH * 0.55;
    ringText.push(polygonContour(starPolygon({ x: -(ri + o.ring / 2), y: 0 }, sr)), polygonContour(starPolygon({ x: ri + o.ring / 2, y: 0 }, sr)));
  }
  if (ringText.length) parts.push({ name: 'Ringtext', contours: ringText, style: fill(o.accent) });
  // Innere Linie
  parts.push({
    name: 'Innenlinie',
    contours: polysToContours(subtractArea(polysOf([circleContour(0, 0, ri * 0.94)]), polysOf([circleContour(0, 0, ri * 0.94 - Math.max(0.6, o.ring * 0.06))]))),
    style: fill(o.color),
    fillRule: 'evenodd',
  });
  if (o.center.trim()) {
    const s = fitSize(shape, o.center.trim(), ri * 0.5, ri * 1.5);
    const cap = shape('H', s).capHeight || s * 0.7;
    parts.push({ name: 'Mitte', contours: straightText(shape, o.center.trim(), s, { x: 0, y: -cap / 2 }), style: fill(o.color) });
  }
  return parts;
}

export interface ShieldOptions {
  width: number;
  height: number;
  border: number;
  band: string;
  initials: string;
  color: string;
  accent: string;
}

export function shield(o: ShieldOptions, shape: TextShaper): GenPart[] {
  const outer = shieldContour(o.width, o.height);
  const outerP = polysOf([outer]);
  const inner = offsetArea(outerP, -o.border, 'round');
  const parts: GenPart[] = [{ name: 'Schild', contours: [outer], style: fill(o.color) }];
  const innerLine = subtractArea(inner, offsetArea(inner, -Math.max(0.6, o.border * 0.25), 'round'));
  parts.push({ name: 'Schildrand', contours: polysToContours(innerLine), style: fill(o.accent), fillRule: 'evenodd' });
  if (o.band.trim()) {
    const bh = o.height * 0.16;
    const y = o.height * 0.08;
    const band = intersectArea(
      [
        [
          { x: -o.width, y: y - bh / 2 },
          { x: o.width, y: y - bh / 2 },
          { x: o.width, y: y + bh / 2 },
          { x: -o.width, y: y + bh / 2 },
        ],
      ],
      inner,
    );
    parts.push({ name: 'Band', contours: polysToContours(band), style: fill(o.accent) });
    const s = fitSize(shape, o.band.trim(), (bh * 0.62) / ((shape('H', 10).capHeight || 7) / 10), o.width * 0.8);
    const cap = shape('H', s).capHeight || s * 0.7;
    parts.push({ name: 'Bandtext', contours: straightText(shape, o.band.trim(), s, { x: 0, y: y - cap / 2 }), style: fill(o.color) });
  }
  if (o.initials.trim()) {
    const s = fitSize(shape, o.initials.trim(), o.height * 0.28, o.width * 0.6);
    const cap = shape('H', s).capHeight || s * 0.7;
    parts.push({ name: 'Initialen', contours: straightText(shape, o.initials.trim(), s, { x: 0, y: -o.height * 0.25 - cap / 2 }), style: fill(o.accent) });
  }
  return parts;
}

export interface BannerOptions {
  width: number;
  height: number;
  text: string;
  color: string;
  shade: string;
  textColor: string;
}

export function banner(o: BannerOptions, shape: TextShaper): GenPart[] {
  const w = o.width;
  const h = o.height;
  const tail = h * 1.1;
  const drop = h * 0.35;
  const notch = h * 0.35;
  const hw = w / 2;
  // Hintere Enden mit V-Kerbe
  const leftEnd = polygonContour([
    { x: -hw + h * 0.4, y: h / 2 - drop },
    { x: -hw - tail, y: h / 2 - drop },
    { x: -hw - tail + notch, y: -drop },
    { x: -hw - tail, y: -h / 2 - drop },
    { x: -hw + h * 0.4, y: -h / 2 - drop },
  ]);
  const rightEnd = mapContours([leftEnd], (p) => ({ x: -p.x, y: p.y }))[0];
  // Umschläge (dunkler)
  const foldL = polygonContour([
    { x: -hw, y: -h / 2 },
    { x: -hw + h * 0.4, y: -h / 2 - drop },
    { x: -hw + h * 0.4, y: -h / 2 },
  ]);
  const foldR = mapContours([foldL], (p) => ({ x: -p.x, y: p.y }))[0];
  const main = polygonContour([
    { x: -hw, y: -h / 2 },
    { x: hw, y: -h / 2 },
    { x: hw, y: h / 2 },
    { x: -hw, y: h / 2 },
  ]);
  const parts: GenPart[] = [
    { name: 'Bandenden', contours: [leftEnd, rightEnd], style: fill(o.color) },
    { name: 'Umschlag', contours: [foldL, foldR], style: fill(o.shade) },
    { name: 'Band', contours: [main], style: fill(o.color) },
  ];
  if (o.text.trim()) {
    const s = fitSize(shape, o.text.trim(), (h * 0.55) / ((shape('H', 10).capHeight || 7) / 10), w * 0.9);
    const cap = shape('H', s).capHeight || s * 0.7;
    parts.push({ name: 'Bandtext', contours: straightText(shape, o.text.trim(), s, { x: 0, y: -cap / 2 }), style: fill(o.textColor) });
  }
  return parts;
}

export interface FrameOptions {
  width: number;
  height: number;
  radius: number;
  line: number;
  double: boolean;
  color: string;
}

export function frame(o: FrameOptions): GenPart[] {
  const outer = polysOf([roundRect(o.width, o.height, o.radius)]);
  let ring = subtractArea(outer, offsetArea(outer, -o.line, 'round'));
  if (o.double) {
    const inner = offsetArea(outer, -o.line * 2.5, 'round');
    ring = unionArea(ring, subtractArea(inner, offsetArea(inner, -o.line * 0.5, 'round')));
  }
  return [{ name: 'Rahmen', contours: polysToContours(ring), style: fill(o.color), fillRule: 'evenodd' }];
}

export interface QrOptions {
  text: string;
  size: number;
  /** Ruhezone in Modulen (Standard 4) */
  quiet: number;
  level: 'L' | 'M' | 'Q' | 'H';
  color: string;
}

/** QR-Code als Fläche (Module verschmolzen), Kantenlänge inkl. Ruhezone = size. */
export function qr(o: QrOptions): GenPart[] {
  if (!o.text) return [];
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const q = qrcode(0, o.level);
  q.addData(o.text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  const cell = o.size / (n + 2 * o.quiet);
  const x0 = -o.size / 2 + o.quiet * cell;
  const y0 = o.size / 2 - o.quiet * cell;
  const squares: Vec2[][] = [];
  for (let r = 0; r < n; r++) {
    // zusammenhängende Läufe einer Zeile als ein Rechteck
    let c = 0;
    while (c < n) {
      if (!q.isDark(r, c)) {
        c++;
        continue;
      }
      let e = c;
      while (e < n && q.isDark(r, e)) e++;
      const x = x0 + c * cell;
      const y = y0 - r * cell;
      squares.push([
        { x, y: y - cell },
        { x: x + (e - c) * cell, y: y - cell },
        { x: x + (e - c) * cell, y },
        { x, y },
      ]);
      c = e;
    }
  }
  return [{ name: 'QR-Code', contours: polysToContours(unionArea(squares)), style: fill(o.color), fillRule: 'evenodd' }];
}

export interface NeckOptions {
  brand: string;
  size: string;
  lines: string;
  width: number;
  color: string;
  frame: boolean;
}

/** Nackendruck (statt eingenähtem Etikett): Marke, Größe groß, Pflege-/Materialzeilen. */
export function neckLabel(o: NeckOptions, shape: TextShaper): GenPart[] {
  const w = o.width;
  const parts: GenPart[] = [];
  const contours: Contour[] = [];
  let y = 0;
  const cap = (s: number) => shape('H', s).capHeight || s * 0.7;
  if (o.brand.trim()) {
    const s = fitSize(shape, o.brand.trim(), w * 0.16, w * 0.9);
    contours.push(...straightText(shape, o.brand.trim(), s, { x: 0, y }));
    y -= cap(s) * 0.9 + w * 0.06;
  }
  if (o.size.trim()) {
    const s = fitSize(shape, o.size.trim(), w * 0.32, w * 0.7);
    y -= cap(s);
    contours.push(...straightText(shape, o.size.trim(), s, { x: 0, y }));
    y -= w * 0.07;
  }
  for (const line of o.lines
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)) {
    const s = fitSize(shape, line, w * 0.075, w * 0.92);
    y -= cap(s);
    contours.push(...straightText(shape, line, s, { x: 0, y }));
    y -= cap(s) * 0.7;
  }
  parts.push({ name: 'Nackendruck', contours, style: fill(o.color) });
  if (o.frame) {
    const top = (o.brand.trim() ? cap(fitSize(shape, o.brand.trim(), w * 0.16, w * 0.9)) : 0) + w * 0.08;
    const bottom = y - w * 0.04;
    const h = top - bottom;
    const f = frame({ width: w * 1.04, height: h, radius: w * 0.06, line: Math.max(0.5, w * 0.012), double: false, color: o.color })[0];
    parts.push({ ...f, name: 'Etikettrahmen', contours: mapContours(f.contours, (p) => ({ x: p.x, y: p.y + (top + bottom) / 2 })) });
  }
  return parts;
}
