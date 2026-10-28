import type { Id, SketchDoc } from './types';
import { createDoc } from './doc';
import { cloneInto } from '../store/xform';
import { docBBox } from './bounds';
import { hexToRgb, rgbToHex, rgbToHsv, hsvToRgb } from './color';
import { isGradient } from './paint';

/**
 * Eigene Bibliothek für Elemente, Logos und Farbpaletten – im Browser bzw. in der Desktop-App
 * gespeichert und in allen Projekten verfügbar. Als Datei (.vdlib) übertragbar.
 */

export interface LibraryElement {
  id: string;
  name: string;
  /** Zeichnung nur mit diesem Element (Mitte am Ursprung) */
  doc: SketchDoc;
  /** Vorschau als PNG-Data-URL */
  thumb?: string;
  w: number;
  h: number;
  created: string;
}

export interface Palette {
  id: string;
  name: string;
  colors: string[];
}

export interface Library {
  version: 1;
  elements: LibraryElement[];
  palettes: Palette[];
}

const KEY = 'vd.library';

export const emptyLibrary = (): Library => ({ version: 1, elements: [], palettes: [] });

export function loadLibrary(): Library {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyLibrary();
    const lib = JSON.parse(raw) as Partial<Library>;
    return { version: 1, elements: Array.isArray(lib.elements) ? lib.elements : [], palettes: Array.isArray(lib.palettes) ? lib.palettes : [] };
  } catch {
    return emptyLibrary();
  }
}

/** Speichert; gibt eine Fehlermeldung zurück, falls der Speicher voll ist. */
export function saveLibrary(lib: Library): string | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(lib));
    return null;
  } catch {
    return 'Der Speicher für die Bibliothek ist voll – bitte nicht mehr benötigte Elemente löschen oder die Bibliothek als Datei sichern.';
  }
}

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** Element aus Objekten einer Zeichnung (Mitte auf den Ursprung verschoben). */
export function makeElement(doc: SketchDoc, ids: Id[], name: string, thumb?: string): LibraryElement | null {
  if (!ids.length) return null;
  const d = createDoc(name);
  d.layers = undefined;
  const created = cloneInto(d, doc, ids);
  if (!created.length) return null;
  for (const id of Object.keys(d.entities)) delete d.entities[id].layer;
  const box = docBBox(d);
  if (!box) return null;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  for (const p of Object.values(d.points)) {
    if (p.locked) continue;
    p.x -= cx;
    p.y -= cy;
  }
  for (const c of Object.values(d.constraints))
    if (c.kind === 'fix' && c.fixedAt)
      for (let i = 0; i + 1 < c.fixedAt.length; i += 2) {
        c.fixedAt[i] -= cx;
        c.fixedAt[i + 1] -= cy;
      }
  return { id: uid(), name: name.trim() || 'Element', doc: d, thumb, w: box.maxX - box.minX, h: box.maxY - box.minY, created: new Date().toISOString() };
}

export function newPalette(name: string, colors: string[]): Palette {
  return { id: uid(), name: name.trim() || 'Palette', colors: [...new Set(colors.map((c) => c.toLowerCase()))].slice(0, 24) };
}

/** Alle Füll-/Konturfarben einer Zeichnung (Häufigkeit absteigend). */
export function docColors(doc: SketchDoc): string[] {
  const count = new Map<string, number>();
  const add = (c: string) => count.set(c.toLowerCase(), (count.get(c.toLowerCase()) ?? 0) + 1);
  for (const e of Object.values(doc.entities)) {
    if (e.construction) continue;
    const f = e.style.fill;
    if (f) {
      if (isGradient(f)) f.stops.forEach((s) => add(s.color));
      else add(f);
    }
    if (e.style.stroke && e.style.strokeWidth > 0) add(e.style.stroke);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
}

export type Harmony = 'complementary' | 'analogous' | 'triad' | 'split' | 'tetrad' | 'mono';

export const HARMONY_LABELS: Record<Harmony, string> = {
  complementary: 'Komplementär',
  analogous: 'Analog',
  triad: 'Dreiklang',
  split: 'Geteilt komplementär',
  tetrad: 'Vierklang',
  mono: 'Ton in Ton',
};

/** Farbharmonien zu einer Grundfarbe (Farbkreis im HSV-Raum). */
export function harmony(base: string, kind: Harmony): string[] {
  const hsv = rgbToHsv(hexToRgb(base));
  const at = (dh: number, s = hsv.s, v = hsv.v) => rgbToHex(hsvToRgb({ h: (((hsv.h + dh) % 360) + 360) % 360, s: Math.min(100, Math.max(0, s)), v: Math.min(100, Math.max(0, v)) }));
  switch (kind) {
    case 'complementary':
      return [base, at(180), at(0, hsv.s * 0.35, Math.min(100, hsv.v + 25)), at(180, hsv.s * 0.6, hsv.v * 0.55)];
    case 'analogous':
      return [at(-30), base, at(30), at(60)];
    case 'triad':
      return [base, at(120), at(240)];
    case 'split':
      return [base, at(150), at(210)];
    case 'tetrad':
      return [base, at(90), at(180), at(270)];
    case 'mono':
      return [at(0, hsv.s, Math.max(15, hsv.v * 0.45)), at(0, hsv.s, hsv.v * 0.75), base, at(0, hsv.s * 0.55, Math.min(100, hsv.v + 15)), at(0, hsv.s * 0.2, Math.min(100, hsv.v + 30))];
  }
}

/** Bibliothek als Datei / aus Datei */
export function libraryToJson(lib: Library): string {
  return JSON.stringify({ app: 'Vektordesign', kind: 'library', ...lib }, null, 1);
}

export function libraryFromJson(text: string): Library {
  const raw = JSON.parse(text) as Partial<Library> & { kind?: string };
  if (raw.kind !== 'library' || !Array.isArray(raw.elements) || !Array.isArray(raw.palettes)) throw new Error('Das ist keine Vektordesign-Bibliothek.');
  return { version: 1, elements: raw.elements, palettes: raw.palettes };
}

/** Zusammenführen (gleiche Ids werden ersetzt). */
export function mergeLibrary(a: Library, b: Library): Library {
  const el = new Map(a.elements.map((e) => [e.id, e]));
  for (const e of b.elements) el.set(e.id, e);
  const pa = new Map(a.palettes.map((p) => [p.id, p]));
  for (const p of b.palettes) pa.set(p.id, p);
  return { version: 1, elements: [...el.values()], palettes: [...pa.values()] };
}
