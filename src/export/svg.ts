import type { Contour, Gradient, Id, SketchDoc, Style, Vec2 } from '../model/types';
import { clean, dist } from '../model/geometry';
import { sortedStops } from '../model/paint';
import { contoursToSvgD } from '../model/shape';
import { dashPattern } from '../render/drawDesign';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import { buildScene, ExportError, type SceneItem } from './scene';

export { ExportError };

export interface SvgExportOptions {
  /** Rahmen: exakt die Geometrie oder inklusive halber Konturstärke */
  bounds?: 'geometry' | 'stroke';
  /** Spiegeln (für Flexfolie) */
  mirror?: boolean;
  title?: string;
  /** Text als Umrisse (siehe textOutlines) */
  outlines?: Map<Id, Contour[]>;
}

export interface SvgExportResult {
  svg: string;
  widthMm: number;
  heightMm: number;
}

/** Zahl für SVG: höchstens 4 Nachkommastellen (0,1 µm), ohne −0 und überflüssige Nullen. */
export function fmt(n: number): string {
  const c = clean(n, 4);
  return String(c);
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Exportiert die Skizze als SVG mit exakten Millimetermaßen (width/height in mm, viewBox in mm).
 * Jede Ebene wird eine benannte Gruppe (Illustrator- und Inkscape-Ebenen). Konstruktionsgeometrie,
 * Bemaßungen, Glyphen und ausgeblendete Ebenen werden nie exportiert.
 */
export function exportSvg(doc: SketchDoc, opts: SvgExportOptions = {}): SvgExportResult {
  const scene = buildScene(doc, { bounds: opts.bounds, outlines: opts.outlines });
  const { box } = scene;
  const w = scene.widthMm;
  const h = scene.heightMm;
  const X = (x: number) => x - box.minX;
  const Y = (y: number) => box.maxY - y;
  const map = (p: Vec2) => ({ x: X(p.x), y: Y(p.y) });

  const defs: string[] = [];
  let gradCount = 0;
  const gradientRef = (it: SceneItem): string => {
    const gr = it.gradient!;
    const g: Gradient = gr.g;
    const id = `verlauf${++gradCount}`;
    const stops = sortedStops(g)
      .map((s) => `<stop offset="${fmt(Math.min(1, Math.max(0, s.offset)))}" stop-color="${s.color}"${s.opacity < 1 ? ` stop-opacity="${fmt(s.opacity)}"` : ''}/>`)
      .join('');
    if (g.kind === 'radial') {
      defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${fmt(X(gr.from.x))}" cy="${fmt(Y(gr.from.y))}" r="${fmt(Math.max(dist(gr.from, gr.to), 0.001))}">${stops}</radialGradient>`);
    } else {
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${fmt(X(gr.from.x))}" y1="${fmt(Y(gr.from.y))}" x2="${fmt(X(gr.to.x))}" y2="${fmt(Y(gr.to.y))}">${stops}</linearGradient>`);
    }
    return `url(#${id})`;
  };

  const styleAttrs = (s: Style, it: SceneItem): string => {
    const a: string[] = [];
    if (it.closed && s.fill) a.push(`fill="${it.gradient ? gradientRef(it) : (s.fill as string)}"`);
    else a.push('fill="none"');
    if (it.closed && s.fill && it.fillRule === 'evenodd') a.push('fill-rule="evenodd"');
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

  const element = (it: SceneItem): string | null => {
    if (it.text) {
      const e = it.text.entity;
      const anchor = e.align === 'center' ? 'middle' : e.align === 'right' ? 'end' : 'start';
      const attrs = [
        `x="${fmt(X(it.text.anchor.x))}"`,
        `y="${fmt(Y(it.text.anchor.y))}"`,
        `font-family="${xmlEscape(e.fontFamily)}"`,
        `font-size="${fmt(e.fontSize)}"`,
        e.fontWeight !== 400 ? `font-weight="${e.fontWeight}"` : '',
        e.italic ? 'font-style="italic"' : '',
        anchor !== 'start' ? `text-anchor="${anchor}"` : '',
        styleAttrs(e.style, it),
      ].filter(Boolean);
      return `<text id="${it.id}" ${attrs.join(' ')} xml:space="preserve">${xmlEscape(e.text)}</text>`;
    }
    if (it.image) {
      const im = it.image;
      const tf = `translate(${fmt(X(im.c.x))} ${fmt(Y(im.c.y))})${im.rotation ? ` rotate(${fmt(-im.rotation)})` : ''}${im.flipX ? ' scale(-1 1)' : ''}`;
      return `<image id="${it.id}" x="${fmt(-im.width / 2)}" y="${fmt(-im.height / 2)}" width="${fmt(im.width)}" height="${fmt(im.height)}" preserveAspectRatio="none" transform="${tf}"${it.style.opacity < 1 ? ` opacity="${fmt(it.style.opacity)}"` : ''} href="${im.src}"/>`;
    }
    if (it.circle) return `<circle id="${it.id}" cx="${fmt(X(it.circle.c.x))}" cy="${fmt(Y(it.circle.c.y))}" r="${fmt(it.circle.r)}" ${styleAttrs(it.style, it)}/>`;
    const d = contoursToSvgD(it.contours, map, fmt);
    return d ? `<path id="${it.id}" d="${d}" ${styleAttrs(it.style, it)}/>` : null;
  };

  const mirror = opts.mirror ? ` transform="matrix(-1 0 0 1 ${fmt(w)} 0)"` : '';
  const groups: string[] = [];
  const usedIds = new Set<string>();
  for (const layer of scene.layers) {
    let lid = layer.name.replace(/[^A-Za-z0-9_-]/g, '_') || 'Ebene';
    while (usedIds.has(lid)) lid += '_';
    usedIds.add(lid);
    const body = layer.items.map(element).filter((x): x is string => !!x);
    groups.push(
      `<g id="${lid}" data-name="${xmlEscape(layer.name)}" inkscape:groupmode="layer" inkscape:label="${xmlEscape(layer.name)}"${mirror}>`,
      ...body.map((b) => `  ${b}`),
      '</g>',
    );
  }
  const title = xmlEscape(opts.title ?? doc.name ?? 'Motiv');
  const svg = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<!-- Erstellt mit ${APP_NAME} ${APP_VERSION} · Maße in Millimetern -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${fmt(w)}mm" height="${fmt(h)}mm" viewBox="0 0 ${fmt(w)} ${fmt(h)}">`,
    `<title>${title}</title>`,
    defs.length ? `<defs>${defs.join('')}</defs>` : '',
    ...groups,
    '</svg>',
    '',
  ]
    .filter((x) => x !== '')
    .join('\n');
  return { svg, widthMm: w, heightMm: h };
}
