import { produce } from 'immer';
import type { Id, SketchDoc } from './types';
import { docBBox } from './bounds';
import { entityArea } from './boolean';
import { addShapeFromWorld, polygonContour } from './shape';
import { layersOf, visibleOrder } from './layers';
import type { Contour } from './types';

/**
 * Entgitterungsrahmen für Plotterfolie: Rahmen mit Abstand um das Motiv und optional
 * Entgitterungslinien durch freie Streifen zwischen den Motivteilen – das Gitter lässt sich
 * so in kleineren Stücken abziehen. Beides liegt auf einer eigenen Ebene „Entgitterung“.
 */

export interface WeedingOptions {
  /** Abstand Rahmen ↔ Motiv (mm) */
  margin: number;
  /** Entgitterungslinien durch freie Streifen */
  lines: boolean;
  /** Mindestbreite eines freien Streifens (mm) */
  minGap?: number;
}

export const WEED_LAYER = 'weed';

/** Freie Intervalle einer Achse (Lücken zwischen belegten Bereichen). */
function gaps(spans: [number, number][], lo: number, hi: number, minGap: number): number[] {
  const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: number[] = [];
  let cur = lo;
  for (const [a, b] of s) {
    if (a - cur >= minGap && cur > lo) out.push((cur + a) / 2);
    cur = Math.max(cur, b);
  }
  void hi;
  return out;
}

export function withWeeding(doc: SketchDoc, opts: WeedingOptions, outlines?: Map<Id, Contour[]>): SketchDoc {
  const box = docBBox(doc);
  if (!box) return doc;
  const m = Math.max(0, opts.margin);
  const F = { minX: box.minX - m, minY: box.minY - m, maxX: box.maxX + m, maxY: box.maxY + m };
  const xs: [number, number][] = [];
  const ys: [number, number][] = [];
  if (opts.lines) {
    for (const id of visibleOrder(doc)) {
      const e = doc.entities[id];
      if (!e || e.construction) continue;
      let polys = e.kind === 'text' ? (outlines?.get(id) ?? []).map((c) => c.nodes) : entityArea(doc, e);
      if (!polys || !polys.length) {
        // Linien/offene Pfade: über ihre Box
        const b = docBBox(doc, { only: new Set([id]), includeStroke: true });
        if (b)
          polys = [
            [
              { x: b.minX, y: b.minY },
              { x: b.maxX, y: b.maxY },
            ],
          ];
      }
      for (const poly of polys ?? []) {
        if (!poly.length) continue;
        xs.push([Math.min(...poly.map((p) => p.x)), Math.max(...poly.map((p) => p.x))]);
        ys.push([Math.min(...poly.map((p) => p.y)), Math.max(...poly.map((p) => p.y))]);
      }
    }
  }
  const minGap = opts.minGap ?? 2;
  const vx = opts.lines ? gaps(xs, box.minX, box.maxX, minGap) : [];
  const hy = opts.lines ? gaps(ys, box.minY, box.maxY, minGap) : [];
  return produce(doc, (d) => {
    const layers = layersOf(d);
    if (!layers.some((l) => l.id === WEED_LAYER)) d.layers = [...layers, { id: WEED_LAYER, name: 'Entgitterung', visible: true, locked: false }];
    const style = { fill: null, stroke: '#000000', strokeWidth: 0.25, opacity: 1 };
    const frame = polygonContour(
      [
        { x: F.minX, y: F.minY },
        { x: F.maxX, y: F.minY },
        { x: F.maxX, y: F.maxY },
        { x: F.minX, y: F.maxY },
      ],
      true,
    );
    addShapeFromWorld(d, [frame], style, { layer: WEED_LAYER, name: 'Entgitterungsrahmen' });
    for (const x of vx)
      addShapeFromWorld(
        d,
        [
          polygonContour(
            [
              { x, y: F.minY },
              { x, y: F.maxY },
            ],
            false,
          ),
        ],
        style,
        { layer: WEED_LAYER, name: 'Entgitterungslinie' },
      );
    for (const y of hy)
      addShapeFromWorld(
        d,
        [
          polygonContour(
            [
              { x: F.minX, y },
              { x: F.maxX, y },
            ],
            false,
          ),
        ],
        style,
        { layer: WEED_LAYER, name: 'Entgitterungslinie' },
      );
  });
}
