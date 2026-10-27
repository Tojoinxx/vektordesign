import type { Entity, Gradient, SketchDoc, Style, Vec2 } from '../model/types';
import { lineOf, pathVertices, pt } from '../model/doc';
import { docBBox, entityBBox } from '../model/bounds';
import { gradientToWorld, isGradient, sortedStops } from '../model/paint';
import { bboxValid, clean, dist } from '../model/geometry';
import { dashPattern } from '../render/drawDesign';
import { APP_NAME, APP_VERSION } from '../model/serialize';

export interface SvgExportOptions {
  /** Rahmen: exakt die Geometrie oder inklusive halber Konturstärke */
  bounds?: 'geometry' | 'stroke';
  /** Spiegeln (für Flexfolie) */
  mirror?: boolean;
  /** Ebenenname (Illustrator/Inkscape) */
  layerName?: string;
  title?: string;
}

export interface SvgExportResult {
  svg: string;
  widthMm: number;
  heightMm: number;
}

export class ExportError extends Error {}

/** Zahl für SVG: höchstens 4 Nachkommastellen (0,1 µm), ohne −0 und überflüssige Nullen. */
export function fmt(n: number): string {
  const c = clean(n, 4);
  return String(c);
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Exportiert die Skizze als SVG mit exakten Millimetermaßen (width/height in mm,
 * viewBox in mm). Konstruktionsgeometrie, Bemaßungen und Glyphen werden nie exportiert.
 */
export function exportSvg(doc: SketchDoc, opts: SvgExportOptions = {}): SvgExportResult {
  const box = docBBox(doc, { includeStroke: opts.bounds === 'stroke' });
  if (!box) throw new ExportError('Nichts zu exportieren: Die Zeichnung enthält keine sichtbaren Objekte (Konstruktionsgeometrie wird nicht exportiert).');
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const X = (x: number) => x - box.minX;
  const Y = (y: number) => box.maxY - y;
  const P = (p: Vec2) => `${fmt(X(p.x))} ${fmt(Y(p.y))}`;

  const defs: string[] = [];
  let gradCount = 0;
  const gradientRef = (g: Gradient, e: Entity): string => {
    const eb = entityBBox(doc, e);
    if (!bboxValid(eb)) return 'none';
    const id = `verlauf${++gradCount}`;
    const { from, to } = gradientToWorld(g, eb);
    const stops = sortedStops(g)
      .map((s) => `<stop offset="${fmt(Math.min(1, Math.max(0, s.offset)))}" stop-color="${s.color}"${s.opacity < 1 ? ` stop-opacity="${fmt(s.opacity)}"` : ''}/>`)
      .join('');
    if (g.kind === 'radial') {
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(X(from.x))}" cy="${fmt(Y(from.y))}" r="${fmt(Math.max(dist(from, to), 0.001))}">${stops}</radialGradient>`);
    } else {
      defs.push(
        `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(X(from.x))}" y1="${fmt(Y(from.y))}" x2="${fmt(X(to.x))}" y2="${fmt(Y(to.y))}">${stops}</linearGradient>`,
      );
    }
    return `url(#${id})`;
  };

  const styleAttrs = (s: Style, e: Entity, closed: boolean): string => {
    const a: string[] = [];
    if (closed && s.fill) a.push(`fill="${isGradient(s.fill) ? gradientRef(s.fill, e) : s.fill}"`);
    else a.push('fill="none"');
    if (s.stroke && s.strokeWidth > 0) {
      a.push(`stroke="${s.stroke}"`, `stroke-width="${fmt(s.strokeWidth)}"`);
      const cap = s.dash === 'dotted' ? 'round' : s.lineCap ?? 'butt';
      if (cap !== 'butt') a.push(`stroke-linecap="${cap}"`);
      a.push('stroke-linejoin="miter"', 'stroke-miterlimit="10"');
      const dash = dashPattern(s);
      if (dash) a.push(`stroke-dasharray="${dash.map(fmt).join(' ')}"`);
    }
    if (s.opacity < 1) a.push(`opacity="${fmt(s.opacity)}"`);
    return a.join(' ');
  };

  const body: string[] = [];
  for (const id of doc.order) {
    const e = doc.entities[id];
    if (!e || e.construction) continue;
    switch (e.kind) {
      case 'path': {
        const vs = pathVertices(doc, e);
        if (vs.length < 2) break;
        const d = vs.map((v, i) => `${i === 0 ? 'M' : 'L'}${P(v)}`).join(' ') + (e.closed ? ' Z' : '');
        body.push(`<path id="${e.id}" d="${d}" ${styleAttrs(e.style, e, e.closed)}/>`);
        break;
      }
      case 'line': {
        const l = lineOf(doc, e.id)!;
        body.push(`<path id="${e.id}" d="M${P(pt(doc, l.p1))} L${P(pt(doc, l.p2))}" ${styleAttrs(e.style, e, false)}/>`);
        break;
      }
      case 'circle': {
        const c = pt(doc, e.center);
        body.push(`<circle id="${e.id}" cx="${fmt(X(c.x))}" cy="${fmt(Y(c.y))}" r="${fmt(e.r)}" ${styleAttrs(e.style, e, true)}/>`);
        break;
      }
      case 'text': {
        const a = pt(doc, e.anchor);
        const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start';
        const attrs = [
          `x="${fmt(X(a.x))}"`,
          `y="${fmt(Y(a.y))}"`,
          `font-family="${xmlEscape(e.fontFamily)}"`,
          `font-size="${fmt(e.fontSize)}"`,
          e.fontWeight !== 400 ? `font-weight="${e.fontWeight}"` : '',
          e.italic ? 'font-style="italic"' : '',
          anchor !== 'start' ? `text-anchor="${anchor}"` : '',
          styleAttrs(e.style, e, true),
        ].filter(Boolean);
        body.push(`<text id="${e.id}" ${attrs.join(' ')} xml:space="preserve">${xmlEscape(e.text)}</text>`);
        break;
      }
    }
  }

  const layer = opts.layerName ?? 'Motiv';
  const layerId = layer.replace(/[^A-Za-z0-9_-]/g, '_');
  const mirror = opts.mirror ? ` transform="matrix(-1 0 0 1 ${fmt(w)} 0)"` : '';
  const title = xmlEscape(opts.title ?? doc.name ?? 'Motiv');
  const svg = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<!-- Erstellt mit ${APP_NAME} ${APP_VERSION} · Maße in Millimetern -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`,
    `<title>${title}</title>`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    `<g id="${layerId}" data-name="${xmlEscape(layer)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(layer)}"${mirror}>`,
    ...body.map((b) => `  ${b}`),
    '</g>',
    '</svg>',
    '',
  ]
    .filter((x) => x !== '')
    .join('\n');
  return { svg, widthMm: w, heightMm: h };
}
