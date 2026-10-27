/** Farbumrechnungen HEX ↔ RGB ↔ HSV ↔ CMYK. */

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface HSV {
  h: number;
  s: number;
  v: number;
}
export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function normalizeHex(input: string): string | null {
  let s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(s)) return null;
  return `#${s}`;
}

export function hexToRgb(hex: string): RGB {
  const h = normalizeHex(hex) ?? '#000000';
  return { r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: RGB): string {
  const x = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${x(r)}${x(g)}${x(b)}`;
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : (d / max) * 100, v: max * 100 };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const S = clamp(s, 0, 100) / 100;
  const V = clamp(v, 0, 100) / 100;
  const C = V * S;
  const hh = (((h % 360) + 360) % 360) / 60;
  const X = C * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [C, X, 0];
  else if (hh < 2) [r, g, b] = [X, C, 0];
  else if (hh < 3) [r, g, b] = [0, C, X];
  else if (hh < 4) [r, g, b] = [0, X, C];
  else if (hh < 5) [r, g, b] = [X, 0, C];
  else [r, g, b] = [C, 0, X];
  const m = V - C;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/**
 * Einfache (geräteunabhängige) CMYK-Umrechnung in Prozent. Für verbindliche
 * Druckfarben gibt es zusätzlich das Pantone-Freitextfeld (ab Meilenstein 3).
 */
export function rgbToCmyk({ r, g, b }: RGB): CMYK {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 };
  return {
    c: ((1 - R - k) / (1 - k)) * 100,
    m: ((1 - G - k) / (1 - k)) * 100,
    y: ((1 - B - k) / (1 - k)) * 100,
    k: k * 100,
  };
}

export function cmykToRgb({ c, m, y, k }: CMYK): RGB {
  const K = clamp(k, 0, 100) / 100;
  return {
    r: 255 * (1 - clamp(c, 0, 100) / 100) * (1 - K),
    g: 255 * (1 - clamp(m, 0, 100) / 100) * (1 - K),
    b: 255 * (1 - clamp(y, 0, 100) / 100) * (1 - K),
  };
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp(alpha, 0, 1)})`;
}

/** Relative Leuchtdichte nach WCAG (für Kontrast und Textfarbe auf Farbfeldern). */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
