/**
 * Export-Profile: welche Dateien ein Paket enthält und mit welchen Einstellungen.
 * Die eingebauten Profile sind Startwerte; geänderte und eigene Profile werden auf dem
 * Gerät gespeichert (für alle Projekte).
 */

export type PackageFormat = 'pdf' | 'svg' | 'eps' | 'png' | 'dxf';

export interface ExportProfile {
  id: string;
  name: string;
  /** Kurzbeschreibung, wofür das Profil gedacht ist */
  purpose: string;
  formats: PackageFormat[];
  colorMode: 'rgb' | 'cmyk';
  pngDpi: number;
  /** Mindestauflösung laut Produzent (Hinweis, falls pngDpi darunter liegt) */
  minDpi: number;
  mirror: boolean;
  bounds: 'geometry' | 'stroke';
  /** Artwork-Blatt beilegen */
  sheet: boolean;
  /** Projektdatei beilegen */
  project: boolean;
  /** Eigene Notizen (z. B. Vorgaben aus dem LabwearOS-Konto) */
  note: string;
}

export const BUILTIN_PROFILES: ExportProfile[] = [
  {
    id: 'labwearos',
    name: 'LabwearOS',
    purpose: 'Artwork für LabwearOS bzw. deren Illustrator-Vorlage',
    formats: ['pdf', 'svg', 'png'],
    colorMode: 'cmyk',
    pngDpi: 300,
    minDpi: 300,
    mirror: false,
    bounds: 'geometry',
    sheet: true,
    project: true,
    note: 'Startwerte – bitte mit den Datei-Anforderungen aus dem LabwearOS-Konto abgleichen.',
  },
  {
    id: 'plotter',
    name: 'Plotter',
    purpose: 'Schneideplotter (Cricut, Silhouette): Konturen in Originalgröße',
    formats: ['svg', 'dxf'],
    colorMode: 'rgb',
    pngDpi: 300,
    minDpi: 0,
    mirror: false,
    bounds: 'geometry',
    sheet: false,
    project: false,
    note: 'Für Flexfolie „Spiegeln“ einschalten.',
  },
  {
    id: 'dtf',
    name: 'DTF',
    purpose: 'Direct-to-Film: Pixelbild mit transparentem Hintergrund',
    formats: ['png', 'pdf'],
    colorMode: 'rgb',
    pngDpi: 300,
    minDpi: 300,
    mirror: false,
    bounds: 'stroke',
    sheet: true,
    project: false,
    note: '',
  },
  {
    id: 'screen',
    name: 'Siebdruck',
    purpose: 'Vektordaten in CMYK für die Siebdruckerei',
    formats: ['pdf', 'eps'],
    colorMode: 'cmyk',
    pngDpi: 300,
    minDpi: 300,
    mirror: false,
    bounds: 'stroke',
    sheet: true,
    project: false,
    note: '',
  },
];

const KEY = 'vd.profiles';

export function loadProfiles(): ExportProfile[] {
  let saved: ExportProfile[] = [];
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) saved = JSON.parse(raw) as ExportProfile[];
  } catch {
    /* kein Speicher */
  }
  const byId = new Map(saved.filter((p) => p && typeof p.id === 'string').map((p) => [p.id, p]));
  const out = BUILTIN_PROFILES.map((b) => ({ ...b, ...(byId.get(b.id) ?? {}) }));
  for (const p of byId.values()) if (!BUILTIN_PROFILES.some((b) => b.id === p.id)) out.push(p);
  return out;
}

export function saveProfiles(list: ExportProfile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* kein Speicher */
  }
}

export function profileById(id: string, list: ExportProfile[] = loadProfiles()): ExportProfile {
  return list.find((p) => p.id === id) ?? list[0];
}

export const FORMAT_LABELS: Record<PackageFormat, string> = {
  pdf: 'PDF (Vektor)',
  svg: 'SVG (Vektor)',
  eps: 'EPS (Vektor)',
  png: 'PNG (Pixel, transparent)',
  dxf: 'DXF (Konturen)',
};
