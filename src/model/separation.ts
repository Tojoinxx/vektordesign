import type { Contour, Entity, Id, SketchDoc, Vec2 } from './types';
import { pt } from './doc';
import { arcContour, arcGeom, pathContour } from './arc';
import { areaOf, entityArea, intersectArea, offsetArea, strokeArea, subtractArea, unionArea } from './boolean';
import { circleContour, flattenContour, polygonContour, shapeWorldContours } from './shape';
import { isHidden, visibleOrder } from './layers';
import { isGradient } from './paint';
import { hexToRgb, luminance } from './color';

/**
 * Farbseparation für Siebdruck (und Folienfarben): je Druckfarbe die sichtbare Fläche,
 * ausgespart (Knockout) unter darüberliegenden Farben. Dazu weiße Unterlage mit Rückzug
 * (Choke) für dunkle Stoffe und Überfüllung (Trapping): helle Farben laufen etwas unter
 * dunkle, damit beim Passerversatz keine Blitzer entstehen.
 */

export type UnderbaseMode = 'auto' | 'on' | 'off';

export interface SeparationOptions {
  /** Text als Umrisse (aus textOutlines) */
  outlines?: Map<Id, Contour[]>;
  /** Stofffarbe */
  fabric?: string;
  /** Flächen in Stofffarbe nicht drucken (Stoff scheint durch) */
  dropFabricColor?: boolean;
  underbase?: UnderbaseMode;
  /** Rückzug der Unterlage (mm) */
  choke?: number;
  /** Überfüllung (mm), 0 = aus */
  trap?: number;
  /** Nur diese Objekte (Motiv) */
  only?: Set<Id>;
}

export interface Plate {
  /** 'underbase' oder Farbwert */
  key: string;
  kind: 'color' | 'underbase';
  /** Druckfarbe '#rrggbb' (Unterlage: Weiß) */
  color: string;
  polys: Vec2[][];
  /** Fläche in mm² */
  area: number;
  /** Druckreihenfolge ab 1 */
  order: number;
}

export interface Separation {
  plates: Plate[];
  warnings: string[];
  /** Gemeinsamer Rahmen aller Filme (mm, Welt) */
  box: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Unterlage tatsächlich angelegt */
  underbase: boolean;
}

const norm = (c: string) => c.toLowerCase();

/** Ähnliche Farben (z. B. Stofffarbe) – Abstand im RGB-Raum. */
export function sameColor(a: string, b: string, tol = 12): boolean {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return Math.hypot(x.r - y.r, x.g - y.g, x.b - y.b) <= tol;
}

/** Dunkler Stoff → Unterlage nötig. */
export const isDarkFabric = (fabric: string) => luminance(fabric) < 0.45;

/** Konturen eines Objekts (für den Strich). */
function strokeContours(doc: SketchDoc, e: Entity, outlines?: Map<Id, Contour[]>): Contour[] {
  switch (e.kind) {
    case 'line':
      return [polygonContour([pt(doc, e.p1), pt(doc, e.p2)], false)];
    case 'arc':
      return [arcContour(arcGeom(doc, e))];
    case 'circle': {
      const c = pt(doc, e.center);
      return [circleContour(c.x, c.y, e.r)];
    }
    case 'path':
      return [pathContour(doc, e)];
    case 'shape':
      return shapeWorldContours(doc, e);
    case 'text':
      return outlines?.get(e.id) ?? [];
    default:
      return [];
  }
}

function fillArea(doc: SketchDoc, e: Entity, outlines?: Map<Id, Contour[]>): Vec2[][] | null {
  if (e.kind === 'text') {
    const o = outlines?.get(e.id);
    if (!o) return null;
    return unionArea(o.filter((c) => c.closed).map((c) => flattenContour(c, 0.005)));
  }
  return entityArea(doc, e);
}

/**
 * Trennt die Zeichnung in Druckfarben. Reihenfolge: Unterlage zuerst, dann von hell nach dunkel.
 */
export function separate(doc: SketchDoc, opts: SeparationOptions = {}): Separation {
  const warnings = new Set<string>();
  const plates = new Map<string, Vec2[][]>();
  const order: string[] = [];
  const knock = (region: Vec2[][], color: string) => {
    if (!region.length) return;
    const k = norm(color);
    for (const [c, polys] of plates) if (c !== k) plates.set(c, subtractArea(polys, region));
    plates.set(k, unionArea(plates.get(k) ?? [], region));
    if (!order.includes(k)) order.push(k);
  };

  for (const id of visibleOrder(doc)) {
    const e = doc.entities[id];
    if (!e || e.construction || isHidden(doc, id)) continue;
    if (opts.only && !opts.only.has(id)) continue;
    const s = e.style;
    if (e.kind === 'image') {
      if (!e.reference) warnings.add('Pixelbilder lassen sich nicht separieren – erst vektorisieren oder nachzeichnen.');
      continue;
    }
    if (s.opacity < 1) warnings.add('Deckkraft unter 100 % wird im Siebdruck voll gedruckt (für Abstufungen braucht es ein Halbtonraster).');
    const fillable = e.kind === 'circle' || e.kind === 'shape' || e.kind === 'text' || (e.kind === 'path' && e.closed);
    if (fillable && s.fill) {
      let color: string;
      if (isGradient(s.fill)) {
        warnings.add('Farbverläufe werden als Vollton ihrer ersten Farbe separiert (Verlauf braucht ein Halbtonraster).');
        color = s.fill.stops[0]?.color ?? '#000000';
      } else color = s.fill;
      const area = fillArea(doc, e, opts.outlines);
      if (area === null && e.kind === 'text') warnings.add('Text konnte nicht in Pfade umgewandelt werden.');
      if (area) knock(area, color);
    }
    if (s.stroke && s.strokeWidth > 0 && !(e.kind === 'text' && !opts.outlines?.has(e.id))) {
      if (s.dash && s.dash !== 'solid') warnings.add('Gestrichelte Konturen werden als durchgehende Linie separiert.');
      knock(strokeArea(strokeContours(doc, e, opts.outlines), s.strokeWidth, s.lineCap ?? 'butt'), s.stroke);
    }
  }

  const fabric = opts.fabric ?? '#ffffff';
  let colors = order.filter((c) => (plates.get(c) ?? []).length);
  if (opts.dropFabricColor) colors = colors.filter((c) => !sameColor(c, fabric));
  // hell → dunkel
  colors.sort((a, b) => luminance(b) - luminance(a));

  const trap = Math.max(0, opts.trap ?? 0);
  const areas = colors.map((c) => plates.get(c)!);
  if (trap > 0) {
    for (let i = 0; i < areas.length - 1; i++) {
      const later = unionArea(...areas.slice(i + 1));
      const spread = intersectArea(offsetArea(areas[i], trap, 'round'), later);
      if (spread.length) areas[i] = unionArea(areas[i], spread);
    }
  }

  const out: Plate[] = [];
  const wantBase = opts.underbase === 'on' || (opts.underbase !== 'off' && isDarkFabric(fabric));
  let underbase = false;
  if (wantBase && areas.length) {
    // Unterlage unter allen Farben außer Weiß selbst (Weiß wird dann als Highlight darüber gedruckt)
    const base = offsetArea(unionArea(...areas), -Math.max(0, opts.choke ?? 0), 'round');
    if (base.length) {
      out.push({ key: 'underbase', kind: 'underbase', color: '#ffffff', polys: base, area: areaOf(base), order: 0 });
      underbase = true;
    }
  }
  colors.forEach((c, i) => out.push({ key: c, kind: 'color', color: c, polys: areas[i], area: areaOf(areas[i]), order: 0 }));
  out.forEach((p, i) => (p.order = i + 1));

  let box: Separation['box'] = null;
  for (const p of out)
    for (const poly of p.polys)
      for (const q of poly) {
        if (!box) box = { minX: q.x, minY: q.y, maxX: q.x, maxY: q.y };
        else {
          box.minX = Math.min(box.minX, q.x);
          box.minY = Math.min(box.minY, q.y);
          box.maxX = Math.max(box.maxX, q.x);
          box.maxY = Math.max(box.maxY, q.y);
        }
      }
  if (!out.length) warnings.add('Keine druckbaren Flächen gefunden.');
  return { plates: out, warnings: [...warnings], box, underbase };
}
