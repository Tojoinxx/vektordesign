/**
 * Farben der Zeichenfläche. Die Bedienoberfläche nutzt dieselben Werte als CSS-Variablen
 * (src/styles/app.css). Maßband-Gelb ist die einzige laute Farbe: Lineale, aktives
 * Werkzeug, Eingabefelder für Maße.
 */
export const THEME = {
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
  dim: '#1e2328',
  dimDriven: '#6b7480',
  dimHalo: 'rgba(255,255,255,0.92)',
  glyphBg: '#ffffff',
  glyphBorder: '#b9c1ca',
  glyphInk: '#3d4650',
  tape: '#f5c518',
  tapeDark: '#d9a900',
  tapeInk: '#1e2328',
  snap: '#0f9d76',
  preview: '#2f6fd6',
  selectBoxWindow: 'rgba(47,111,214,0.08)',
  selectBoxCross: 'rgba(47,158,91,0.08)',
  uiFont: '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif',
} as const;

export const RULER = 22;
