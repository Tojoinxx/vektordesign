import type { Contour, Gradient, Id, ImageEntity, SketchDoc, Vec2 } from '../model/types';
import { addPoint, createDoc, newId } from '../model/doc';
import { addShapeFromWorld, mapContours } from '../model/shape';
import { isGradient } from '../model/paint';
import type { BBox } from '../model/geometry';
import type { GangLayout, GangSheetSpec } from '../model/gangsheet';
import { buildScene, textOutlines } from './scene';

/**
 * Baut aus dem gepackten Sammelbogen je Bogen eine eigene Zeichnung (Welt-mm, Y nach oben,
 * Bogen oben links bei 0/0). Text wird in Umrisse gewandelt, gedrehte Stücke werden um 90°
 * im Uhrzeigersinn gedreht. Schnittlinien liegen auf einer eigenen Ebene.
 */

export const PRINT_LAYER = 'L1';
export const CUT_LAYER = 'L2';
export const CUT_COLOR = '#ff00ff';

export interface SheetDoc {
  doc: SketchDoc;
  frame: BBox;
  index: number;
  length: number;
  substituted: string[];
}

export async function buildSheetDocs(layout: GangLayout, spec: GangSheetSpec, opts: { cutLines?: boolean; name?: string } = {}): Promise<SheetDoc[]> {
  const outlineCache = new Map<SketchDoc, { outlines: Map<Id, Contour[]>; substituted: string[] }>();
  const out: SheetDoc[] = [];
  const W = spec.width;
  for (let si = 0; si < layout.sheets.length; si++) {
    const L = layout.sheets[si].length;
    const d = createDoc(`${opts.name ?? 'Sammelbogen'} ${si + 1}`);
    d.layers = [
      { id: PRINT_LAYER, name: 'Druck', visible: true, locked: false },
      { id: CUT_LAYER, name: 'Schnittlinien', visible: true, locked: false },
    ];
    const substituted = new Set<string>();
    for (const pl of layout.placed.filter((p) => p.sheet === si)) {
      const pc = pl.piece;
      let ol = outlineCache.get(pc.doc);
      if (!ol) {
        ol = await textOutlines(pc.doc);
        outlineCache.set(pc.doc, ol);
      }
      ol.substituted.forEach((f) => substituted.add(f));
      const scene = buildScene(pc.doc, { outlines: ol.outlines, frame: pc.box });
      const { box } = pc;
      // Stück-lokal (oben links, Y nach unten) → Bogen → Welt
      const toWorld = (p: Vec2): Vec2 => {
        const lx = p.x - box.minX;
        const ly = box.maxY - p.y;
        let sx = pl.rotated ? pl.x + (pc.h - ly) : pl.x + lx;
        const sy = pl.rotated ? pl.y + lx : pl.y + ly;
        if (spec.mirror) sx = W - sx;
        return { x: sx, y: -sy };
      };
      const mapGradient = (g: Gradient): Gradient => {
        const f = (v: Vec2): Vec2 => {
          let u = v.x;
          let w = v.y;
          if (pl.rotated) [u, w] = [w, 1 - u];
          if (spec.mirror) u = 1 - u;
          return { x: u, y: w };
        };
        return { ...g, from: f(g.from), to: f(g.to) };
      };
      for (const layer of scene.layers)
        for (const it of layer.items) {
          if (it.image) {
            const src = pc.doc.entities[it.id] as ImageEntity | undefined;
            const id = newId(d, 'i');
            const img: ImageEntity = {
              id,
              kind: 'image',
              anchor: addPoint(d, toWorld(it.image.c), { owner: id }),
              width: it.image.width,
              height: it.image.height,
              rotation: spec.mirror ? -it.image.rotation : it.image.rotation,
              flipX: spec.mirror ? !it.image.flipX : it.image.flipX,
              src: it.image.src,
              pxWidth: src?.kind === 'image' ? src.pxWidth : 1,
              pxHeight: src?.kind === 'image' ? src.pxHeight : 1,
              reference: false,
              construction: false,
              style: { ...it.style },
              layer: PRINT_LAYER,
            };
            d.entities[id] = img;
            d.order.push(id);
            continue;
          }
          if (it.text) continue; // ohne Umriss (Schrift fehlt) – sollte nach textOutlines nicht vorkommen
          const style = { ...it.style };
          if (style.fill && isGradient(style.fill)) style.fill = mapGradient(style.fill);
          addShapeFromWorld(d, mapContours(it.contours, toWorld), style, { fillRule: it.fillRule, layer: PRINT_LAYER, name: pc.label });
        }
      if (opts.cutLines) {
        const g = spec.gap / 2;
        const w = pl.rotated ? pc.h : pc.w;
        const h = pl.rotated ? pc.w : pc.h;
        let x0 = pl.x - g;
        let x1 = pl.x + w + g;
        if (spec.mirror) [x0, x1] = [W - x1, W - x0];
        const y0 = -(pl.y - g);
        const y1 = -(pl.y + h + g);
        const rect: Contour = {
          closed: true,
          nodes: [
            { x: x0, y: y0 },
            { x: x1, y: y0 },
            { x: x1, y: y1 },
            { x: x0, y: y1 },
          ],
        };
        addShapeFromWorld(d, [rect], { fill: null, stroke: CUT_COLOR, strokeWidth: 0.25, opacity: 1 }, { layer: CUT_LAYER, name: 'Schnittlinie' });
      }
    }
    out.push({ doc: d, frame: { minX: 0, minY: -L, maxX: W, maxY: 0 }, index: si, length: L, substituted: [...substituted] });
  }
  return out;
}

/** Bogen ohne Schnittlinien (für PNG/DTF-Druck). */
export function withoutCutLayer(d: SketchDoc): SketchDoc {
  const c: SketchDoc = { ...d, entities: { ...d.entities }, order: d.order.filter((id) => d.entities[id]?.layer !== CUT_LAYER) };
  for (const id of Object.keys(c.entities)) if (c.entities[id].layer === CUT_LAYER) delete c.entities[id];
  c.layers = (d.layers ?? []).filter((l) => l.id !== CUT_LAYER);
  return c;
}
