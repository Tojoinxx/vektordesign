import type { Contour, Entity, Id, SketchDoc, Vec2 } from './types';
import { booleanAreas, entityArea, offsetArea } from './boolean';
import { flattenContour, polyArea } from './shape';
import { isGradient } from './paint';
import { visibleOrder } from './layers';
import { entityBBox } from './bounds';
import { normalizeHex } from './color';

/**
 * Prüfung vor dem Export („Preflight“) je Veredelungsart: zu feine Linien und Details,
 * zu kleine Schrift, zu viele Farben, Transparenz und Verläufe, Auflösung von Pixelbildern,
 * offene Konturen und Überlappungen (Plotter). Die Grenzwerte sind übliche Richtwerte und
 * lassen sich anpassen – im Zweifel gilt, was der Produzent vorgibt.
 */

export type PreflightTarget = 'screen' | 'dtg' | 'dtf' | 'flex' | 'embroidery' | 'puff' | 'silicone' | 'sublimation' | 'patch' | 'emboss';

export interface PreflightRules {
  name: string;
  /** Mindestbreite von Linien und Details (mm) */
  minLine: number;
  /** Mindestbreite von Zwischenräumen/Aussparungen (mm); 0 = nicht prüfen */
  minGap: number;
  /** Mindesthöhe von Großbuchstaben (mm) */
  minText: number;
  maxColors: number;
  transparency: 'ok' | 'warn' | 'error';
  gradients: 'ok' | 'warn' | 'error';
  images: 'ok' | 'warn' | 'error';
  /** Mindestauflösung platzierter Pixelbilder (dpi) */
  minDpi: number;
  /** Plotter: offene Konturen und Überlappungen prüfen */
  cutting?: boolean;
  /** Weiß wird nicht gedruckt (Sublimation) */
  noWhite?: boolean;
  hint: string;
}

export const PREFLIGHT_RULES: Record<PreflightTarget, PreflightRules> = {
  screen: { name: 'Siebdruck', minLine: 0.3, minGap: 0.3, minText: 2.5, maxColors: 6, transparency: 'warn', gradients: 'warn', images: 'warn', minDpi: 300, hint: 'Volltonfarben; Verläufe und Transparenz nur über Halbtonraster. Jede Farbe ist ein Sieb.' },
  dtg: { name: 'DTG (Digitaldruck)', minLine: 0.2, minGap: 0.2, minText: 2, maxColors: 99, transparency: 'warn', gradients: 'ok', images: 'ok', minDpi: 300, hint: 'Fotos und Verläufe möglich; halbtransparente Stellen werden auf dunklem Stoff unruhig.' },
  dtf: { name: 'DTF (Transfer)', minLine: 0.5, minGap: 0.4, minText: 2.5, maxColors: 99, transparency: 'warn', gradients: 'ok', images: 'ok', minDpi: 300, hint: 'Haarlinien unter 0,5 mm lösen sich leicht; Halbtransparenz besser als Raster.' },
  flex: { name: 'Flex/Flock (Plotter)', minLine: 0.8, minGap: 0.6, minText: 4, maxColors: 4, transparency: 'error', gradients: 'error', images: 'error', minDpi: 300, cutting: true, hint: 'Geschlossene Konturen, eine Folie je Farbe; feine Details lassen sich kaum entgittern.' },
  embroidery: { name: 'Stick', minLine: 1.0, minGap: 0.8, minText: 5, maxColors: 12, transparency: 'error', gradients: 'error', images: 'error', minDpi: 300, hint: 'Satinstiche ab etwa 1 mm Breite, Schrift ab etwa 5 mm Höhe; keine Verläufe.' },
  puff: { name: 'Puff Print', minLine: 1.5, minGap: 1.0, minText: 8, maxColors: 3, transparency: 'error', gradients: 'error', images: 'error', minDpi: 300, hint: 'Die Farbe quillt auf – Linien und Zwischenräume großzügig anlegen.' },
  silicone: { name: 'Silikondruck', minLine: 1.0, minGap: 0.8, minText: 5, maxColors: 3, transparency: 'error', gradients: 'error', images: 'error', minDpi: 300, hint: 'Erhabener Druck – kräftige Formen, wenige Farben.' },
  sublimation: { name: 'Sublimation', minLine: 0.2, minGap: 0.2, minText: 2, maxColors: 99, transparency: 'ok', gradients: 'ok', images: 'ok', minDpi: 200, noWhite: true, hint: 'Nur auf hellem Polyester; Weiß wird nicht gedruckt (bleibt Stofffarbe).' },
  patch: { name: 'Patch', minLine: 0.8, minGap: 0.6, minText: 4, maxColors: 9, transparency: 'error', gradients: 'warn', images: 'warn', minDpi: 300, hint: 'Gewebte oder gestickte Patches: wenige Farben, keine Haarlinien.' },
  emboss: { name: 'Prägung', minLine: 1.5, minGap: 1.5, minText: 6, maxColors: 1, transparency: 'error', gradients: 'error', images: 'error', minDpi: 300, hint: 'Einfarbig, kräftige Formen ohne feine Details.' },
};

/** Veredelungsart eines Motivs → Prüfprofil */
export function preflightTargetFor(technique: string | undefined): PreflightTarget {
  switch (technique) {
    case 'screen':
    case 'dtg':
    case 'puff':
    case 'embroidery':
    case 'patch':
    case 'silicone':
    case 'sublimation':
    case 'emboss':
      return technique;
    case 'transfer':
      return 'dtf';
    case 'allover':
      return 'sublimation';
    default:
      return 'screen';
  }
}

export interface PreflightIssue {
  severity: 'error' | 'warn' | 'info';
  message: string;
  ids: Id[];
  /** Problemzonen (Welt-mm) zum Markieren */
  regions?: Vec2[][];
}

export interface PreflightResult {
  target: PreflightTarget;
  rules: PreflightRules;
  issues: PreflightIssue[];
  colors: string[];
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('de-DE');
const key = (c: string) => (normalizeHex(c) ?? c).toLowerCase();

function designEntities(doc: SketchDoc, only?: Set<Id>): Entity[] {
  const out: Entity[] = [];
  for (const id of visibleOrder(doc)) {
    const e = doc.entities[id];
    if (!e || e.construction || (e.kind === 'image' && e.reference)) continue;
    if (only && !only.has(id)) continue;
    out.push(e);
  }
  return out;
}

/** Teile einer Fläche, die schmaler als `w` sind (morphologisches Öffnen). */
export function thinParts(polys: Vec2[][], w: number): Vec2[][] {
  if (!polys.length || w <= 0) return [];
  const r = w / 2;
  const opened = offsetArea(offsetArea(polys, -r, 'round'), r, 'round');
  const diff = booleanAreas('subtract', [polys, opened]);
  return significant(diff, w);
}

/** Zwischenräume (Löcher, Spalten) schmaler als `w` (morphologisches Schließen). */
export function narrowGaps(polys: Vec2[][], w: number): Vec2[][] {
  if (!polys.length || w <= 0) return [];
  const r = w / 2;
  const closed = offsetArea(offsetArea(polys, r, 'round'), -r, 'round');
  const diff = booleanAreas('subtract', [closed, polys]);
  return significant(diff, w);
}

/** Nur nennenswerte Stücke (Rundungsreste an Ecken ignorieren). */
function significant(polys: Vec2[][], w: number): Vec2[][] {
  const minArea = 0.35 * w * w;
  return polys.filter((p) => Math.abs(polyArea(p)) > minArea);
}

export interface PreflightOptions {
  /** Nur diese Objekte prüfen (z. B. ein Motiv) */
  only?: Set<Id>;
  /** Eigene Mindestbreite (mm) */
  minLine?: number;
  /** Textumrisse (für die Detailprüfung von Schrift) */
  outlines?: Map<Id, Contour[]>;
}

export function runPreflight(doc: SketchDoc, target: PreflightTarget, opts: PreflightOptions = {}): PreflightResult {
  const base = PREFLIGHT_RULES[target];
  const rules: PreflightRules = { ...base, minLine: opts.minLine ?? base.minLine, minGap: opts.minLine ? Math.max(opts.minLine * 0.8, 0) : base.minGap };
  const issues: PreflightIssue[] = [];
  const ents = designEntities(doc, opts.only);
  if (!ents.length) return { target, rules, issues: [{ severity: 'info', message: 'Nichts zu prüfen – die Auswahl bzw. Zeichnung ist leer.', ids: [] }], colors: [] };

  // ---------------------------------------------------------------- Farben
  const colors = new Set<string>();
  const thinIds: Id[] = [];
  const thinRegions: Vec2[][] = [];
  const gapIds: Id[] = [];
  const gapRegions: Vec2[][] = [];
  const strokeIds: Id[] = [];
  const textIds: Id[] = [];
  const transIds: Id[] = [];
  const gradIds: Id[] = [];
  const whiteIds: Id[] = [];
  const openIds: Id[] = [];
  let minStroke = Infinity;
  let minTextH = Infinity;

  for (const e of ents) {
    const s = e.style;
    if (e.kind === 'image') {
      const dpi = e.pxWidth / (e.width / 25.4);
      if (rules.images !== 'ok') issues.push({ severity: rules.images, message: `Pixelbild „${e.name ?? 'Bild'}“: Für ${rules.name} braucht es Vektorformen (Bild vektorisieren oder nachzeichnen).`, ids: [e.id] });
      if (dpi < rules.minDpi) issues.push({ severity: 'warn', message: `Pixelbild „${e.name ?? 'Bild'}“ hat in dieser Größe nur ${Math.round(dpi)} dpi (empfohlen ab ${rules.minDpi} dpi) – es wird unscharf.`, ids: [e.id] });
      if (s.opacity < 1) transIds.push(e.id);
      continue;
    }
    const filled = !!s.fill && (e.kind === 'circle' || e.kind === 'shape' || e.kind === 'text' || (e.kind === 'path' && e.closed));
    if (filled && s.fill) {
      if (isGradient(s.fill)) {
        gradIds.push(e.id);
        for (const st of s.fill.stops) {
          colors.add(key(st.color));
          if (st.opacity < 1) transIds.push(e.id);
        }
      } else colors.add(key(s.fill));
    }
    if (s.stroke && s.strokeWidth > 0) {
      colors.add(key(s.stroke));
      if (s.strokeWidth < rules.minLine - 1e-9) {
        strokeIds.push(e.id);
        minStroke = Math.min(minStroke, s.strokeWidth);
      }
    }
    if (s.opacity < 1 && !transIds.includes(e.id)) transIds.push(e.id);
    if (rules.noWhite && ((typeof s.fill === 'string' && key(s.fill) === '#ffffff') || (s.stroke && key(s.stroke) === '#ffffff'))) whiteIds.push(e.id);

    if (e.kind === 'text') {
      const cap = e.fontSize * 0.7;
      if (cap < rules.minText - 1e-9) {
        textIds.push(e.id);
        minTextH = Math.min(minTextH, cap);
      }
    }
    // Plotter: offene Linien werden nicht als Fläche geschnitten
    if (rules.cutting && (e.kind === 'line' || (e.kind === 'path' && !e.closed)) && !filled) openIds.push(e.id);

    // Feine Details in Flächen
    if (filled) {
      let polys: Vec2[][] | null = null;
      if (e.kind === 'text') {
        const o = opts.outlines?.get(e.id);
        if (o) polys = o.filter((c) => c.closed).map((c) => flattenContour(c, 0.01));
      } else polys = entityArea(doc, e);
      if (polys && polys.length) {
        const t = thinParts(polys, rules.minLine);
        if (t.length) {
          thinIds.push(e.id);
          thinRegions.push(...t);
        }
        if (rules.minGap > 0) {
          const g = narrowGaps(polys, rules.minGap);
          if (g.length) {
            gapIds.push(e.id);
            gapRegions.push(...g);
          }
        }
      }
    }
  }

  if (thinIds.length) issues.push({ severity: 'error', message: `Details schmaler als ${fmt(rules.minLine)} mm (${thinRegions.length} Stelle${thinRegions.length === 1 ? '' : 'n'}, rot markiert) – lassen sich bei ${rules.name} nicht sauber umsetzen.`, ids: thinIds, regions: thinRegions });
  if (gapIds.length) issues.push({ severity: 'warn', message: `Zwischenräume enger als ${fmt(rules.minGap)} mm (${gapRegions.length} Stelle${gapRegions.length === 1 ? '' : 'n'}) – können zulaufen.`, ids: gapIds, regions: gapRegions });
  if (strokeIds.length) issues.push({ severity: 'error', message: `Konturen dünner als ${fmt(rules.minLine)} mm (dünnste ${fmt(minStroke)} mm).`, ids: strokeIds });
  if (textIds.length) issues.push({ severity: 'error', message: `Schrift zu klein: Großbuchstaben ${fmt(minTextH)} mm hoch, für ${rules.name} mindestens ${fmt(rules.minText)} mm.`, ids: textIds });
  if (colors.size > rules.maxColors) issues.push({ severity: 'warn', message: `${colors.size} Farben – für ${rules.name} sind höchstens ${rules.maxColors} üblich (jede Farbe kostet ${target === 'screen' ? 'ein Sieb' : target === 'flex' ? 'eine Folie' : 'Aufwand'}).`, ids: [] });
  if (gradIds.length && rules.gradients !== 'ok') issues.push({ severity: rules.gradients, message: `Farbverläufe gehen bei ${rules.name} ${rules.gradients === 'error' ? 'nicht' : 'nur als Halbtonraster'}.`, ids: gradIds });
  if (transIds.length && rules.transparency !== 'ok') issues.push({ severity: rules.transparency, message: `Transparenz (Deckkraft unter 100 % oder Verblassen) geht bei ${rules.name} ${rules.transparency === 'error' ? 'nicht' : 'nur als Raster'}.`, ids: transIds });
  if (whiteIds.length) issues.push({ severity: 'warn', message: 'Weiß wird bei Sublimation nicht gedruckt – diese Flächen bleiben in Stofffarbe.', ids: whiteIds });
  if (openIds.length) issues.push({ severity: 'warn', message: `${openIds.length} offene Kontur${openIds.length === 1 ? '' : 'en'} – der Plotter schneidet sie als Linie, nicht als Fläche.`, ids: openIds });

  // Plotter: gleichfarbige Flächen, die sich überlappen, werden doppelt geschnitten
  if (rules.cutting) {
    const areas = ents
      .map((e) => ({ e, a: typeof e.style.fill === 'string' ? entityArea(doc, e) : null }))
      .filter((x): x is { e: Entity; a: Vec2[][] } => !!x.a && x.a.length > 0);
    const over = new Set<Id>();
    const regions: Vec2[][] = [];
    for (let i = 0; i < areas.length; i++)
      for (let j = i + 1; j < areas.length; j++) {
        if (key(areas[i].e.style.fill as string) !== key(areas[j].e.style.fill as string)) continue;
        const bi = entityBBox(doc, areas[i].e);
        const bj = entityBBox(doc, areas[j].e);
        if (bi.maxX < bj.minX || bj.maxX < bi.minX || bi.maxY < bj.minY || bj.maxY < bi.minY) continue;
        const inter = booleanAreas('intersect', [areas[i].a, areas[j].a]).filter((p) => Math.abs(polyArea(p)) > 0.01);
        if (inter.length) {
          over.add(areas[i].e.id);
          over.add(areas[j].e.id);
          regions.push(...inter);
        }
      }
    if (over.size) issues.push({ severity: 'warn', message: 'Gleichfarbige Formen überlappen sich – der Plotter schneidet doppelt. Tipp: auswählen und „Vereinigen“.', ids: [...over], regions });
  }

  if (!issues.length) issues.push({ severity: 'info', message: `Keine Probleme gefunden – passt für ${rules.name}.`, ids: [] });
  return { target, rules, issues, colors: [...colors] };
}
