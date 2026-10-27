/**
 * Farben der Zeichenfläche in zwei Varianten. Die Bedienoberfläche nutzt passende CSS-Variablen
 * (src/styles/app.css). Maßband-Gelb bleibt in beiden Varianten die einzige laute Farbe.
 *
 * Hell: weiße Fläche, gelbes Maßband als Lineal.
 * Dunkel: Werkbank bei Nacht – Graphitfläche, Lineal als schwarzes Maßband mit gelben
 * Markierungen, die Ecke gelb wie der Haken am Maßbandende.
 *
 * THEME wird beim Umschalten an Ort und Stelle überschrieben; alle Zeichenroutinen lesen die
 * Werte erst beim Zeichnen.
 */
export interface CanvasPalette {
  paper: string;
  gridMinor: string;
  gridMajor: string;
  axisX: string;
  axisY: string;
  /** vollständig bestimmte Skizzengeometrie */
  ink: string;
  /** noch bewegliche Geometrie */
  free: string;
  construction: string;
  constructionFree: string;
  selected: string;
  hover: string;
  conflict: string;
  /** Flächen ausgewählter/überfahrener Pfade */
  selectedFill: string;
  hoverFill: string;
  dim: string;
  dimDriven: string;
  dimHalo: string;
  /** Hintergrund eines ausgewählten Bemaßungstexts */
  dimSelectedBg: string;
  glyphBg: string;
  glyphBorder: string;
  glyphInk: string;
  glyphSelectedBg: string;
  glyphHoverBg: string;
  /** kleines Quadrat für „koinzident“ */
  glyphDot: string;
  glyphDotEdge: string;
  /** Rand um den Ursprungspunkt */
  originRing: string;
  tape: string;
  tapeEdge: string;
  tapeInk: string;
  tapeCorner: string;
  tapeCornerInk: string;
  snap: string;
  preview: string;
  /** Hintergrund von Beschriftungen an Werkzeugvorschauen */
  labelBg: string;
  /** gelbes Schild für Maße in Arbeit (wie das Eingabefeld) */
  tag: string;
  tagInk: string;
  selectBoxWindow: string;
  selectBoxCross: string;
  /** Umriss für Motive, die sich kaum vom Hintergrund abheben (nur Bildschirm) */
  contrastHint: string;
}

export const LIGHT_CANVAS: CanvasPalette = {
  paper: '#ffffff',
  gridMinor: '#eef1f4',
  gridMajor: '#dbe1e7',
  axisX: '#d9534f',
  axisY: '#2f9e5b',
  ink: '#1e2328',
  free: '#2f6fd6',
  construction: '#8a94a6',
  constructionFree: '#7fa3e0',
  selected: '#e8590c',
  hover: '#f59f00',
  conflict: '#d64545',
  selectedFill: 'rgba(232,89,12,0.10)',
  hoverFill: 'rgba(245,159,0,0.10)',
  dim: '#1e2328',
  dimDriven: '#6b7480',
  dimHalo: 'rgba(255,255,255,0.92)',
  dimSelectedBg: '#fff1e6',
  glyphBg: '#ffffff',
  glyphBorder: '#b9c1ca',
  glyphInk: '#3d4650',
  glyphSelectedBg: '#fff1e6',
  glyphHoverBg: '#fff8e1',
  glyphDot: '#fff7d6',
  glyphDotEdge: '#d9a900',
  originRing: '#ffffff',
  tape: '#f5c518',
  tapeEdge: '#d9a900',
  tapeInk: '#1e2328',
  tapeCorner: '#d9a900',
  tapeCornerInk: '#1e2328',
  snap: '#0f9d76',
  preview: '#2f6fd6',
  labelBg: '#ffffff',
  tag: '#f5c518',
  tagInk: '#1e2328',
  selectBoxWindow: 'rgba(47,111,214,0.08)',
  selectBoxCross: 'rgba(47,158,91,0.08)',
  contrastHint: 'rgba(30,35,40,0.45)',
};

export const DARK_CANVAS: CanvasPalette = {
  paper: '#181b1f',
  gridMinor: '#202429',
  gridMajor: '#2b3036',
  axisX: '#e8676c',
  axisY: '#4cc47e',
  ink: '#e6e9ed',
  free: '#6aa1ff',
  construction: '#7c8693',
  constructionFree: '#6f92cc',
  selected: '#ff8c42',
  hover: '#ffc24b',
  conflict: '#ff6b6b',
  selectedFill: 'rgba(255,140,66,0.14)',
  hoverFill: 'rgba(255,194,75,0.12)',
  dim: '#c3cbd4',
  dimDriven: '#8a949f',
  dimHalo: 'rgba(24,27,31,0.9)',
  dimSelectedBg: '#3b2a1d',
  glyphBg: '#262b31',
  glyphBorder: '#4a525c',
  glyphInk: '#c3cbd4',
  glyphSelectedBg: '#3b2a1d',
  glyphHoverBg: '#3a3320',
  glyphDot: '#3a3421',
  glyphDotEdge: '#b8961e',
  originRing: '#181b1f',
  tape: '#24292f',
  tapeEdge: '#3a414a',
  tapeInk: '#f5c518',
  tapeCorner: '#f5c518',
  tapeCornerInk: '#1e2328',
  snap: '#2fd3a0',
  preview: '#6aa1ff',
  labelBg: '#262b31',
  tag: '#f5c518',
  tagInk: '#1e2328',
  selectBoxWindow: 'rgba(106,161,255,0.10)',
  selectBoxCross: 'rgba(76,196,126,0.10)',
  contrastHint: 'rgba(230,233,237,0.5)',
};

export type CanvasMode = 'light' | 'dark';

/** Aktuelle Farben der Zeichenfläche (wird beim Umschalten überschrieben). */
export const THEME: CanvasPalette & { uiFont: string } = {
  ...LIGHT_CANVAS,
  uiFont: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
};

let mode: CanvasMode = 'light';

export function setCanvasMode(next: CanvasMode): void {
  mode = next;
  Object.assign(THEME, next === 'dark' ? DARK_CANVAS : LIGHT_CANVAS);
}

export function canvasMode(): CanvasMode {
  return mode;
}

export const RULER = 22;
