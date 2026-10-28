import type { Contour, Entity, Gradient, Id, SketchDoc, Style, TextEntity, Vec2 } from '../model/types';
import { lineOf, pathVertices, pt } from '../model/doc';
import { docBBox, entityBBox } from '../model/bounds';
import { layerOf, layersOf, visibleOrder } from '../model/layers';
import { circleContour, polygonContour, shapeWorldContours } from '../model/shape';
import { gradientToWorld, isGradient } from '../model/paint';
import { bboxValid, type BBox } from '../model/geometry';
import { loadFont, textContours } from '../platform/fontOutline';

/**
 * Gemeinsame Grundlage aller Vektor-Exporte (SVG, PDF, EPS, DXF): sichtbare Objekte je Ebene
 * als Konturen in Weltkoordinaten (mm, Y nach oben) mit ihrem Stil. Konstruktionsgeometrie,
 * Bemaßungen und Abhängigkeiten kommen nie hinein.
 */

export interface SceneItem {
  id: Id;
  /** Konturen in mm (Welt) */
  contours: Contour[];
  /** Fläche (Füllung möglich) oder offene Linie */
  closed: boolean;
  fillRule: 'nonzero' | 'evenodd';
  style: Style;
  /** Verlauf in Weltkoordinaten (falls Füllung ein Verlauf ist) */
  gradient?: { g: Gradient; from: Vec2; to: Vec2 };
  /** Lebender Text (nur SVG ohne „Text in Pfade“) */
  text?: { entity: TextEntity; anchor: Vec2 };
  /** Kreis (für DXF als echter Kreis, für SVG als <circle>) */
  circle?: { c: Vec2; r: number };
  /** Pixelbild (SVG eingebettet, PDF mit `pixels`; EPS/DXF ohne Bilder) */
  image?: { src: string; c: Vec2; width: number; height: number; rotation: number; flipX: boolean; pixels?: { rgba: Uint8Array | Uint8ClampedArray; width: number; height: number } };
}

export interface SceneLayer {
  id: Id;
  name: string;
  items: SceneItem[];
}

export interface ExportScene {
  layers: SceneLayer[];
  box: BBox;
  widthMm: number;
  heightMm: number;
}

export class ExportError extends Error {}

/** Bildpixel für den PDF-Export dekodieren (nur im Browser). */
export async function attachImagePixels(scene: ExportScene, decode: (src: string) => Promise<{ rgba: Uint8Array | Uint8ClampedArray; width: number; height: number } | null>): Promise<void> {
  for (const l of scene.layers)
    for (const it of l.items)
      if (it.image && !it.image.pixels) {
        const px = await decode(it.image.src).catch(() => null);
        if (px) it.image.pixels = px;
      }
}

/** Enthält die Szene Bilder (für Hinweise bei EPS/DXF)? */
export const sceneHasImages = (scene: ExportScene) => scene.layers.some((l) => l.items.some((it) => !!it.image));

/** Schriftumrisse für alle sichtbaren Texte (für Exporte mit „Text in Pfade“). */
export async function textOutlines(doc: SketchDoc): Promise<{ outlines: Map<Id, Contour[]>; substituted: string[] }> {
  const outlines = new Map<Id, Contour[]>();
  const substituted = new Set<string>();
  for (const id of visibleOrder(doc)) {
    const e = doc.entities[id];
    if (e?.kind !== 'text' || e.construction) continue;
    const f = await loadFont(e.fontFamily, e.fontWeight, e.italic);
    if (f.substitute) substituted.add(e.fontFamily);
    outlines.set(id, textContours(f.font, e, pt(doc, e.anchor)));
  }
  return { outlines, substituted: [...substituted] };
}

export interface SceneOptions {
  bounds?: 'geometry' | 'stroke';
  /** Text als Umrisse (aus textOutlines); fehlt ein Eintrag, bleibt der Text lebendig */
  outlines?: Map<Id, Contour[]>;
  /** Fester Rahmen statt der Geometriegrenzen (z. B. ganzer Sammelbogen) */
  frame?: BBox;
}

export function buildScene(doc: SketchDoc, opts: SceneOptions = {}): ExportScene {
  const box = opts.frame ?? docBBox(doc, { includeStroke: opts.bounds === 'stroke' });
  if (!box) throw new ExportError('Nichts zu exportieren: Die Zeichnung enthält keine sichtbaren Objekte (Konstruktionsgeometrie und ausgeblendete Ebenen werden nicht exportiert).');
  const layers = layersOf(doc).map((l) => ({ id: l.id, name: l.name, items: [] as SceneItem[] }));
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const id of visibleOrder(doc)) {
    const e = doc.entities[id];
    if (!e || e.construction) continue;
    const item = sceneItem(doc, e, opts.outlines);
    if (!item) continue;
    byId.get(layerOf(doc, e).id)?.items.push(item);
  }
  return { layers: layers.filter((l) => l.items.length), box, widthMm: box.maxX - box.minX, heightMm: box.maxY - box.minY };
}

function sceneItem(doc: SketchDoc, e: Entity, outlines?: Map<Id, Contour[]>): SceneItem | null {
  const base = { id: e.id, style: e.style, fillRule: 'nonzero' as const };
  let item: SceneItem | null = null;
  switch (e.kind) {
    case 'line': {
      const l = lineOf(doc, e.id)!;
      item = { ...base, contours: [polygonContour([pt(doc, l.p1), pt(doc, l.p2)], false)], closed: false };
      break;
    }
    case 'path': {
      const vs = pathVertices(doc, e);
      if (vs.length < 2) return null;
      item = { ...base, contours: [polygonContour(vs, e.closed)], closed: e.closed };
      break;
    }
    case 'circle': {
      const c = pt(doc, e.center);
      item = { ...base, contours: [circleContour(c.x, c.y, e.r)], closed: true, circle: { c: { x: c.x, y: c.y }, r: e.r } };
      break;
    }
    case 'shape':
      item = { ...base, contours: shapeWorldContours(doc, e), closed: true, fillRule: e.fillRule };
      break;
    case 'image':
      if (e.reference) return null;
      item = { ...base, contours: [], closed: true, image: { src: e.src, c: { ...pt(doc, e.anchor) }, width: e.width, height: e.height, rotation: e.rotation, flipX: !!e.flipX } };
      break;
    case 'text': {
      const o = outlines?.get(e.id);
      if (o) item = { ...base, contours: o, closed: true };
      else item = { ...base, contours: [], closed: true, text: { entity: e, anchor: { ...pt(doc, e.anchor) } } };
      break;
    }
  }
  if (item && isGradient(e.style.fill)) {
    const eb = entityBBox(doc, e);
    if (bboxValid(eb)) item.gradient = { g: e.style.fill, ...gradientToWorld(e.style.fill, eb) };
  }
  return item;
}
