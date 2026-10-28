import { produce } from 'immer';
import type { ColorSpec, Entity, Id, Motif, Production, SketchDoc, Style, Variant } from './types';
import { contrastRatio, hexToRgb, normalizeHex, rgbToCmyk } from './color';
import { isGradient } from './paint';
import { layersOf, visibleOrder } from './layers';
import { areaOf, garmentOf } from './garments';
import { docBBox } from './bounds';

/**
 * Produktionsangaben: Artikel, Motive mit Platzierung und Veredelung, Farbvarianten.
 * Alles ist optional im Dokument gespeichert; `productionOf` liefert immer einen
 * vollständigen Stand (mit Standardwerten).
 */

export const DEFAULT_PROFILE_ID = 'labwearos';

export function defaultProduction(doc: SketchDoc): Production {
  return {
    article: doc.name && doc.name !== 'Unbenannt' ? doc.name : 'Artikel',
    version: '1',
    garment: 'hoodie',
    motifs: [defaultMotif('m1', 'Motiv 1')],
    variants: [{ id: 'v1', name: 'Variante A', fabric: '#1e2328', fabricName: 'Schwarz', colors: {} }],
    colorSpecs: {},
    profileId: DEFAULT_PROFILE_ID,
  };
}

export function defaultMotif(id: Id, name: string): Motif {
  const a = areaOf(garmentOf('hoodie'), 'chest-left')!;
  return { id, name, layers: [], technique: 'screen', placement: { view: a.view, area: a.id, x: a.x, y: a.y } };
}

export function productionOf(doc: SketchDoc): Production {
  const p = doc.production;
  if (!p) return defaultProduction(doc);
  const base = defaultProduction(doc);
  return {
    ...base,
    ...p,
    motifs: p.motifs?.length ? p.motifs : base.motifs,
    variants: p.variants?.length ? p.variants : base.variants,
    colorSpecs: p.colorSpecs ?? {},
  };
}

/** Freie Id innerhalb einer Liste (m1, m2 … / v1, v2 …). */
export function nextListId(prefix: string, list: { id: Id }[]): Id {
  let i = list.length + 1;
  while (list.some((x) => x.id === `${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

const key = (hex: string) => (normalizeHex(hex) ?? hex).toLowerCase();

// ---------------------------------------------------------------------------
// Farben
// ---------------------------------------------------------------------------

function styleColors(s: Style, out: Set<string>) {
  if (s.fill) {
    if (isGradient(s.fill)) for (const st of s.fill.stops) out.add(key(st.color));
    else out.add(key(s.fill));
  }
  if (s.stroke && s.strokeWidth > 0) out.add(key(s.stroke));
}

/** Entitäten eines Motivs (sichtbar, keine Konstruktion), in Zeichenreihenfolge. */
export function motifEntities(doc: SketchDoc, m: Motif): Entity[] {
  const layers = new Set(m.layers);
  const out: Entity[] = [];
  for (const id of visibleOrder(doc)) {
    const e = doc.entities[id];
    if (!e || e.construction || (e.kind === 'image' && e.reference)) continue;
    if (layers.size && !layers.has(e.layer ?? layersOf(doc)[0].id)) continue;
    out.push(e);
  }
  return out;
}

/** Alle Druckfarben eines Motivs (Originalfarben, '#rrggbb' klein), in Reihenfolge des Auftretens. */
export function motifColors(doc: SketchDoc, m: Motif): string[] {
  const set = new Set<string>();
  for (const e of motifEntities(doc, m)) styleColors(e.style, set);
  return [...set];
}

/** Alle Originalfarben aller Motive. */
export function allColors(doc: SketchDoc, p: Production = productionOf(doc)): string[] {
  const set = new Set<string>();
  for (const m of p.motifs) for (const c of motifColors(doc, m)) set.add(c);
  return [...set];
}

/** Farbe in einer Variante. */
export function variantColor(v: Variant, original: string): string {
  return key(v.colors[key(original)] ?? original);
}

/** CMYK einer Farbe (eigene Angabe oder umgerechnet), gerundet 0…100. */
export function cmykOf(hex: string, spec?: ColorSpec): [number, number, number, number] {
  if (spec?.cmyk) return spec.cmyk;
  const c = rgbToCmyk(hexToRgb(hex));
  return [c.c, c.m, c.y, c.k].map((v) => Math.round(v)) as [number, number, number, number];
}

export const cmykText = (c: [number, number, number, number]) => `C${c[0]} M${c[1]} Y${c[2]} K${c[3]}`;

/** Zeichnung mit den Farben einer Variante (Geometrie unverändert). */
export function applyVariant(doc: SketchDoc, v: Variant): SketchDoc {
  if (!Object.keys(v.colors).length) return doc;
  const map = (c: string) => v.colors[key(c)] ?? c;
  return produce(doc, (d) => {
    for (const e of Object.values(d.entities)) {
      const s = e.style;
      if (s.fill) {
        if (isGradient(s.fill)) for (const st of s.fill.stops) st.color = map(st.color);
        else s.fill = map(s.fill);
      }
      if (s.stroke) s.stroke = map(s.stroke);
    }
  });
}

/** Zeichnung, in der nur die Ebenen des Motivs sichtbar sind. */
export function motifDoc(doc: SketchDoc, m: Motif): SketchDoc {
  if (!m.layers.length) return doc;
  const keep = new Set(m.layers);
  return produce(doc, (d) => {
    d.layers = layersOf(doc).map((l) => ({ ...l, visible: l.visible && keep.has(l.id) }));
  });
}

/** Größe des Motivs in mm (exakte Geometrie). */
export function motifSize(doc: SketchDoc, m: Motif): { w: number; h: number; box: { minX: number; minY: number; maxX: number; maxY: number } } | null {
  const ents = motifEntities(doc, m);
  if (!ents.length) return null;
  const box = docBBox(doc, { only: new Set(ents.map((e) => e.id)) });
  if (!box) return null;
  return { w: box.maxX - box.minX, h: box.maxY - box.minY, box };
}

/** Prüft ein Motiv gegen seinen Druckbereich; liefert verständliche Hinweise. */
export function motifWarnings(doc: SketchDoc, p: Production, m: Motif): string[] {
  const out: string[] = [];
  const size = motifSize(doc, m);
  if (!size) {
    out.push(`${m.name}: enthält keine sichtbaren Objekte.`);
    return out;
  }
  const g = garmentOf(p.garment);
  const a = areaOf(g, m.placement.area);
  if (a && (size.w > a.w + 0.01 || size.h > a.h + 0.01)) {
    out.push(`${m.name}: ${fmt(size.w)} × ${fmt(size.h)} mm ist größer als der Druckbereich „${a.name}“ (${a.w} × ${a.h} mm).`);
  }
  if (!g.views.includes(m.placement.view)) out.push(`${m.name}: Ansicht passt nicht zum Kleidungsstück.`);
  return out;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('de-DE');

export interface ContrastWarning {
  variant: string;
  fabric: string;
  color: string;
  ratio: number;
}

/** Druckfarben, die sich kaum vom Stoff abheben (je Variante). Grenze: Kontrast unter 1,6 : 1. */
export function contrastWarnings(doc: SketchDoc, p: Production = productionOf(doc), limit = 1.6): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  for (const v of p.variants)
    for (const m of p.motifs)
      for (const orig of motifColors(doc, m)) {
        const c = variantColor(v, orig);
        const ratio = contrastRatio(c, v.fabric);
        if (ratio < limit && !out.some((w) => w.variant === v.name && w.color === c)) out.push({ variant: v.name, fabric: v.fabricName ?? v.fabric, color: c, ratio });
      }
  return out;
}

/** Dateiname ohne Sonderzeichen (Umlaute ausgeschrieben). */
export function fileSafe(s: string): string {
  return (
    s
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/Ä/g, 'Ae')
      .replace(/Ö/g, 'Oe')
      .replace(/Ü/g, 'Ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'Unbenannt'
  );
}

/** Grundname für Paketdateien: Artikel_v1 */
export function articleBase(p: Production): string {
  return `${fileSafe(p.article)}_v${fileSafe(p.version)}`;
}
