import type { Contour, ShapeNode, Style, Vec2 } from '../model/types';

/**
 * SVG-Import: Pfade und Grundformen (path, rect, circle, ellipse, line, polyline, polygon) mit
 * Transformationen, Füllung und Kontur werden zu Formen in mm. Einheiten über width/height und
 * viewBox (mm, cm, in, pt, px = 96 dpi). Texte bitte vorher in Pfade umwandeln.
 */

export interface ImportedShape {
  contours: Contour[];
  style: Style;
  fillRule: 'nonzero' | 'evenodd';
  name: string;
}

export interface SvgImportResult {
  shapes: ImportedShape[];
  warnings: string[];
  /** Breite/Höhe des Dokuments in mm (falls angegeben) */
  widthMm: number | null;
  heightMm: number | null;
}

type M = [number, number, number, number, number, number];
const I: M = [1, 0, 0, 1, 0, 0];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const ap = (m: M, x: number, y: number): Vec2 => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

const UNIT_MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };

export function lengthMm(v: string | null): number | null {
  if (!v) return null;
  const m = v.trim().match(/^([-+]?[\d.]+(?:e[-+]?\d+)?)\s*(mm|cm|in|pt|pc|px)?$/i);
  if (!m) return null;
  return Number(m[1]) * UNIT_MM[(m[2] ?? '').toLowerCase()];
}

function numbers(s: string): number[] {
  return (s.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
}

export function parseTransform(t: string | null): M {
  if (!t) return I;
  let m: M = I;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(t))) {
    const a = numbers(r[2]);
    let n: M = I;
    switch (r[1]) {
      case 'matrix':
        n = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case 'translate':
        n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
        break;
      case 'scale':
        n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
        break;
      case 'rotate': {
        const ang = ((a[0] ?? 0) * Math.PI) / 180;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        n = [c, s, -s, c, 0, 0];
        if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case 'skewX':
        n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, n);
  }
  return m;
}

/** Elliptischer Bogen (SVG) → kubische Bézierstücke (Endpunkt-Parametrisierung). */
function arcToCubics(x1: number, y1: number, rx: number, ry: number, phiDeg: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  if (rx === 0 || ry === 0) return [[x1, y1, x2, y2, x2, y2]];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lam > 1) {
    rx *= Math.sqrt(lam);
    ry *= Math.sqrt(lam);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const segs = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2)));
  const step = dt / segs;
  const k = (4 / 3) * Math.tan(step / 4);
  const out: number[][] = [];
  let a0 = t1;
  const pt = (a: number) => ({ x: cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, y: cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos });
  const der = (a: number) => ({ x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos });
  for (let i = 0; i < segs; i++) {
    const a1 = a0 + step;
    const p0 = pt(a0);
    const p1 = pt(a1);
    const d0 = der(a0);
    const d1 = der(a1);
    out.push([p0.x + k * d0.x, p0.y + k * d0.y, p1.x - k * d1.x, p1.y - k * d1.y, p1.x, p1.y]);
    a0 = a1;
  }
  return out;
}

/** SVG-Pfaddaten → Konturen (Koordinaten im SVG-Raum, y nach unten). */
export function parsePathData(d: string): Contour[] {
  const tokens = d.match(/[a-df-z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  const out: Contour[] = [];
  let cur: ShapeNode[] | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let lastC: { x: number; y: number } | null = null;
  let lastQ: { x: number; y: number } | null = null;
  let cmd = '';
  let i = 0;
  const next = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-z]$/i.test(tokens[i]);
  const finish = (closed: boolean) => {
    if (cur && cur.length > 1) {
      if (closed) {
        const a = cur[0];
        const b = cur[cur.length - 1];
        if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) {
          if (b.ix !== undefined) {
            a.ix = b.ix;
            a.iy = b.iy;
          }
          cur.pop();
        }
      }
      out.push({ closed, nodes: cur });
    }
    cur = null;
  };
  const lineTo = (nx: number, ny: number) => {
    cur!.push({ x: nx, y: ny });
    x = nx;
    y = ny;
  };
  const cubic = (c1x: number, c1y: number, c2x: number, c2y: number, nx: number, ny: number) => {
    const last = cur![cur!.length - 1];
    last.ox = c1x;
    last.oy = c1y;
    cur!.push({ x: nx, y: ny, ix: c2x, iy: c2y });
    x = nx;
    y = ny;
  };
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      finish(true);
      x = sx;
      y = sy;
      lastC = lastQ = null;
      continue;
    }
    if (!isNum()) {
      i++;
      continue;
    }
    switch (C) {
      case 'M': {
        finish(false);
        const nx = next() + (rel ? x : 0);
        const ny = next() + (rel ? y : 0);
        cur = [{ x: nx, y: ny }];
        x = sx = nx;
        y = sy = ny;
        cmd = rel ? 'l' : 'L';
        lastC = lastQ = null;
        break;
      }
      case 'L':
        if (!cur) cur = [{ x, y }];
        lineTo(next() + (rel ? x : 0), next() + (rel ? y : 0));
        lastC = lastQ = null;
        break;
      case 'H':
        if (!cur) cur = [{ x, y }];
        lineTo(next() + (rel ? x : 0), y);
        lastC = lastQ = null;
        break;
      case 'V':
        if (!cur) cur = [{ x, y }];
        lineTo(x, next() + (rel ? y : 0));
        lastC = lastQ = null;
        break;
      case 'C': {
        if (!cur) cur = [{ x, y }];
        const bx = rel ? x : 0;
        const by = rel ? y : 0;
        const c1x = next() + bx;
        const c1y = next() + by;
        const c2x = next() + bx;
        const c2y = next() + by;
        const nx = next() + bx;
        const ny = next() + by;
        cubic(c1x, c1y, c2x, c2y, nx, ny);
        lastC = { x: c2x, y: c2y };
        lastQ = null;
        break;
      }
      case 'S': {
        if (!cur) cur = [{ x, y }];
        const bx = rel ? x : 0;
        const by = rel ? y : 0;
        const c1x = lastC ? 2 * x - lastC.x : x;
        const c1y = lastC ? 2 * y - lastC.y : y;
        const c2x = next() + bx;
        const c2y = next() + by;
        const nx = next() + bx;
        const ny = next() + by;
        cubic(c1x, c1y, c2x, c2y, nx, ny);
        lastC = { x: c2x, y: c2y };
        lastQ = null;
        break;
      }
      case 'Q':
      case 'T': {
        if (!cur) cur = [{ x, y }];
        const bx = rel ? x : 0;
        const by = rel ? y : 0;
        let qx: number;
        let qy: number;
        if (C === 'Q') {
          qx = next() + bx;
          qy = next() + by;
        } else {
          qx = lastQ ? 2 * x - lastQ.x : x;
          qy = lastQ ? 2 * y - lastQ.y : y;
        }
        const nx = next() + bx;
        const ny = next() + by;
        cubic(x + ((qx - x) * 2) / 3, y + ((qy - y) * 2) / 3, nx + ((qx - nx) * 2) / 3, ny + ((qy - ny) * 2) / 3, nx, ny);
        lastQ = { x: qx, y: qy };
        lastC = null;
        break;
      }
      case 'A': {
        if (!cur) cur = [{ x, y }];
        const rx = next();
        const ry = next();
        const rot = next();
        const large = next() !== 0;
        const sweep = next() !== 0;
        const nx = next() + (rel ? x : 0);
        const ny = next() + (rel ? y : 0);
        for (const c of arcToCubics(x, y, rx, ry, rot, large, sweep, nx, ny)) cubic(c[0], c[1], c[2], c[3], c[4], c[5]);
        lastC = lastQ = null;
        break;
      }
      default:
        i++;
    }
  }
  finish(false);
  return out;
}

function ellipseContour(cx: number, cy: number, rx: number, ry: number): Contour {
  const k = 0.5522847498;
  return {
    closed: true,
    nodes: [
      { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ry * k, ox: cx + rx, oy: cy + ry * k },
      { x: cx, y: cy + ry, ix: cx + rx * k, iy: cy + ry, ox: cx - rx * k, oy: cy + ry },
      { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ry * k, ox: cx - rx, oy: cy - ry * k },
      { x: cx, y: cy - ry, ix: cx - rx * k, iy: cy - ry, ox: cx + rx * k, oy: cy - ry },
    ],
  };
}

const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  gray: '#808080',
  grey: '#808080',
  orange: '#ffa500',
  navy: '#000080',
};

function color(v: string | undefined | null): string | null | undefined {
  if (v === undefined || v === null) return undefined;
  const s = v.trim().toLowerCase();
  if (!s || s === 'inherit') return undefined;
  if (s === 'none' || s === 'transparent') return null;
  if (s.startsWith('url(')) return '#808080';
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const [r, g, b] = m[1].split(',').map((x) => (x.includes('%') ? (parseFloat(x) * 255) / 100 : parseFloat(x)));
    return `#${[r, g, b]
      .map((n) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  }
  return NAMED[s] ?? undefined;
}

interface Paint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  opacity: number;
  fillRule: 'nonzero' | 'evenodd';
  display: boolean;
}

function styleProps(el: Element, css: Map<string, Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'fill-rule', 'display', 'visibility']) {
    const v = el.getAttribute(k);
    if (v !== null) out[k] = v;
  }
  for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) Object.assign(out, css.get(cls) ?? {});
  for (const part of (el.getAttribute('style') ?? '').split(';')) {
    const [k, v] = part.split(':');
    if (k && v) out[k.trim()] = v.trim();
  }
  return out;
}

function parseCss(doc: Document): Map<string, Record<string, string>> {
  const map = new Map<string, Record<string, string>>();
  for (const st of Array.from(doc.getElementsByTagName('style'))) {
    const re = /\.([\w-]+)\s*\{([^}]*)\}/g;
    let r: RegExpExecArray | null;
    while ((r = re.exec(st.textContent ?? ''))) {
      const props: Record<string, string> = {};
      for (const part of r[2].split(';')) {
        const [k, v] = part.split(':');
        if (k && v) props[k.trim()] = v.trim();
      }
      map.set(r[1], { ...(map.get(r[1]) ?? {}), ...props });
    }
  }
  return map;
}

export function importSvg(text: string): SvgImportResult {
  const dom = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = dom.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') throw new Error('Das ist keine SVG-Datei.');
  const warnings = new Set<string>();
  const css = parseCss(dom);
  const vb = numbers(svg.getAttribute('viewBox') ?? '');
  const wMm = lengthMm(svg.getAttribute('width'));
  const hMm = lengthMm(svg.getAttribute('height'));
  // Benutzereinheit → mm
  let sx = 25.4 / 96;
  let sy = 25.4 / 96;
  let ox = 0;
  let oy = 0;
  if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
    ox = vb[0];
    oy = vb[1];
    sx = wMm ? wMm / vb[2] : 25.4 / 96;
    sy = hMm ? hMm / vb[3] : sx;
  } else if (wMm && svg.getAttribute('width')?.match(/mm|cm|in|pt/)) {
    sx = sy = 25.4 / 96;
  }
  // SVG (y nach unten) → Welt (mm, y nach oben)
  const root: M = [sx, 0, 0, -sy, -ox * sx, oy * sy];
  const shapes: ImportedShape[] = [];
  const walk = (el: Element, m: M, inherited: Paint) => {
    const tag = el.nodeName.toLowerCase().replace(/^svg:/, '');
    if (['defs', 'clippath', 'mask', 'symbol', 'style', 'title', 'desc', 'metadata', 'pattern', 'lineargradient', 'radialgradient', 'marker'].includes(tag)) return;
    const p = styleProps(el, css);
    const paint: Paint = { ...inherited };
    if (p.fill !== undefined) {
      const c = color(p.fill);
      if (c !== undefined) paint.fill = c;
      if (p.fill.startsWith('url(')) warnings.add('Verläufe und Muster aus der SVG werden als graue Fläche übernommen.');
    }
    if (p.stroke !== undefined) {
      const c = color(p.stroke);
      if (c !== undefined) paint.stroke = c;
    }
    if (p['stroke-width'] !== undefined) paint.strokeWidth = parseFloat(p['stroke-width']) || 0;
    if (p.opacity !== undefined) paint.opacity *= Math.min(1, Math.max(0, parseFloat(p.opacity)));
    if (p['fill-opacity'] !== undefined) paint.opacity *= Math.min(1, Math.max(0, parseFloat(p['fill-opacity'])));
    if (p['fill-rule'] !== undefined) paint.fillRule = p['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero';
    if (p.display === 'none' || p.visibility === 'hidden') return;
    const mm = mul(m, parseTransform(el.getAttribute('transform')));
    const num = (k: string) => parseFloat(el.getAttribute(k) ?? '0') || 0;
    let contours: Contour[] = [];
    switch (tag) {
      case 'svg':
      case 'g':
      case 'a':
        for (const c of Array.from(el.childNodes)) if (c.nodeType === 1) walk(c as Element, mm, paint);
        return;
      case 'path':
        contours = parsePathData(el.getAttribute('d') ?? '');
        break;
      case 'rect': {
        const x = num('x');
        const y = num('y');
        const w = num('width');
        const h = num('height');
        let rx = parseFloat(el.getAttribute('rx') ?? el.getAttribute('ry') ?? '0') || 0;
        rx = Math.min(rx, w / 2, h / 2);
        if (rx > 0) {
          const k = 0.5522847498 * rx;
          contours = [
            {
              closed: true,
              nodes: [
                { x: x + rx, y, ix: x + rx - k, iy: y },
                { x: x + w - rx, y, ox: x + w - rx + k, oy: y },
                { x: x + w, y: y + rx, ix: x + w, iy: y + rx - k },
                { x: x + w, y: y + h - rx, ox: x + w, oy: y + h - rx + k },
                { x: x + w - rx, y: y + h, ix: x + w - rx + k, iy: y + h },
                { x: x + rx, y: y + h, ox: x + rx - k, oy: y + h },
                { x, y: y + h - rx, ix: x, iy: y + h - rx + k },
                { x, y: y + rx, ox: x, oy: y + rx - k },
              ],
            },
          ];
        } else
          contours = [
            {
              closed: true,
              nodes: [
                { x, y },
                { x: x + w, y },
                { x: x + w, y: y + h },
                { x, y: y + h },
              ],
            },
          ];
        break;
      }
      case 'circle':
        contours = [ellipseContour(num('cx'), num('cy'), num('r'), num('r'))];
        break;
      case 'ellipse':
        contours = [ellipseContour(num('cx'), num('cy'), num('rx'), num('ry'))];
        break;
      case 'line':
        contours = [
          {
            closed: false,
            nodes: [
              { x: num('x1'), y: num('y1') },
              { x: num('x2'), y: num('y2') },
            ],
          },
        ];
        break;
      case 'polyline':
      case 'polygon': {
        const n = numbers(el.getAttribute('points') ?? '');
        const nodes: ShapeNode[] = [];
        for (let k = 0; k + 1 < n.length; k += 2) nodes.push({ x: n[k], y: n[k + 1] });
        contours = [{ closed: tag === 'polygon', nodes }];
        break;
      }
      case 'text':
        warnings.add('Texte in der SVG wurden übersprungen – bitte vorher in Pfade umwandeln.');
        return;
      case 'image':
        warnings.add('Eingebettete Bilder in der SVG wurden übersprungen (als Bild einfügen).');
        return;
      case 'use':
        warnings.add('Verweise (<use>) werden nicht aufgelöst.');
        return;
      default:
        return;
    }
    contours = contours.filter((c) => c.nodes.length >= 2);
    if (!contours.length) return;
    const world = contours.map((c) => ({
      closed: c.closed,
      nodes: c.nodes.map((n) => {
        const pnt = ap(mm, n.x, n.y);
        const out: ShapeNode = { x: pnt.x, y: pnt.y };
        if (n.ix !== undefined) {
          const q = ap(mm, n.ix, n.iy!);
          out.ix = q.x;
          out.iy = q.y;
        }
        if (n.ox !== undefined) {
          const q = ap(mm, n.ox, n.oy!);
          out.ox = q.x;
          out.oy = q.y;
        }
        return out;
      }),
    }));
    const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2]));
    const allOpen = world.every((c) => !c.closed);
    const fill = allOpen ? null : paint.fill;
    if (!fill && !paint.stroke) return;
    shapes.push({
      contours: world,
      style: { fill, stroke: paint.stroke, strokeWidth: Math.max(0.05, paint.strokeWidth * scale), opacity: paint.opacity },
      fillRule: paint.fillRule,
      name: el.getAttribute('id') ?? tag,
    });
  };
  walk(svg, root, { fill: '#000000', stroke: null, strokeWidth: 1, opacity: 1, fillRule: 'nonzero', display: true });
  return { shapes, warnings: [...warnings], widthMm: wMm, heightMm: hMm };
}
