import { hexToRgb, rgbToCmyk } from '../model/color';
import { segments } from '../model/shape';
import { sortedStops } from '../model/paint';
import { dist } from '../model/geometry';
import { dashPattern } from '../render/drawDesign';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import type { ExportScene, SceneItem } from './scene';
import type { ColorMode } from './pdf';

/**
 * EPS-Export (PostScript Level 3) für ältere Workflows und Schneideplotter-Software.
 * Maßstabsgetreu in Punkt, Verläufe als Shading. EPS kennt keine Transparenz: Deckkraft und
 * Verblassen entfallen (dafür PDF oder SVG verwenden).
 */
export function exportEps(scene: ExportScene, opts: { colorMode?: ColorMode; mirror?: boolean; title?: string } = {}): { bytes: Uint8Array; lostTransparency: boolean } {
  const PT = 72 / 25.4;
  const mode = opts.colorMode ?? 'rgb';
  const W = scene.widthMm * PT;
  const H = scene.heightMm * PT;
  const { box } = scene;
  const n = (v: number) => String(Math.round(v * 1000) / 1000).replace(/^-0$/, '0');
  const X = (x: number) => (x - box.minX) * PT;
  const Y = (y: number) => (y - box.minY) * PT;
  const col = (hex: string) => {
    if (mode === 'cmyk') {
      const c = rgbToCmyk(hexToRgb(hex));
      return `${n(c.c / 100)} ${n(c.m / 100)} ${n(c.y / 100)} ${n(c.k / 100)} setcmykcolor`;
    }
    const { r, g, b } = hexToRgb(hex);
    return `${n(r / 255)} ${n(g / 255)} ${n(b / 255)} setrgbcolor`;
  };
  const comps = (hex: string) => {
    if (mode === 'cmyk') {
      const c = rgbToCmyk(hexToRgb(hex));
      return [c.c, c.m, c.y, c.k].map((v) => n(v / 100)).join(' ');
    }
    const { r, g, b } = hexToRgb(hex);
    return [r, g, b].map((v) => n(v / 255)).join(' ');
  };
  const path = (it: SceneItem) => {
    const out: string[] = ['newpath'];
    for (const c of it.contours) {
      if (!c.nodes.length) continue;
      out.push(`${n(X(c.nodes[0].x))} ${n(Y(c.nodes[0].y))} moveto`);
      for (const s of segments(c)) {
        if (s.curved) out.push(`${n(X(s.p1.x))} ${n(Y(s.p1.y))} ${n(X(s.p2.x))} ${n(Y(s.p2.y))} ${n(X(s.p3.x))} ${n(Y(s.p3.y))} curveto`);
        else out.push(`${n(X(s.p3.x))} ${n(Y(s.p3.y))} lineto`);
      }
      if (c.closed) out.push('closepath');
    }
    return out.join('\n');
  };
  let lost = false;
  const body: string[] = [];
  if (opts.mirror) body.push(`[-1 0 0 1 ${n(W)} 0] concat`);
  for (const layer of scene.layers) {
    body.push(`%%Ebene: ${layer.name.replace(/[^\x20-\x7e]/g, '?')}`);
    for (const it of layer.items) {
      if (!it.contours.length) continue;
      const s = it.style;
      if (s.opacity < 1) lost = true;
      const p = path(it);
      if (it.closed && s.fill) {
        if (it.gradient) {
          const stops = sortedStops(it.gradient.g);
          if (stops.some((x) => x.opacity < 1)) lost = true;
          const fns = stops.slice(0, -1).map((st, i) => `<< /FunctionType 2 /Domain [0 1] /C0 [${comps(st.color)}] /C1 [${comps(stops[i + 1].color)}] /N 1 >>`);
          const fn = fns.length === 1 ? fns[0] : `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${stops.slice(1, -1).map((x) => n(x.offset)).join(' ')}] /Encode [${fns.map(() => '0 1').join(' ')}] >>`;
          const gr = it.gradient;
          const cs = mode === 'cmyk' ? '/DeviceCMYK' : '/DeviceRGB';
          const coords =
            gr.g.kind === 'radial'
              ? `/ShadingType 3 /Coords [${n(X(gr.from.x))} ${n(Y(gr.from.y))} 0 ${n(X(gr.from.x))} ${n(Y(gr.from.y))} ${n(Math.max(dist(gr.from, gr.to), 0.001) * PT)}]`
              : `/ShadingType 2 /Coords [${n(X(gr.from.x))} ${n(Y(gr.from.y))} ${n(X(gr.to.x))} ${n(Y(gr.to.y))}]`;
          body.push('gsave', p, it.fillRule === 'evenodd' ? 'eoclip' : 'clip', `<< ${coords} /ColorSpace ${cs} /Function ${fn} /Extend [true true] >> shfill`, 'grestore');
        } else body.push(col(s.fill as string), p, it.fillRule === 'evenodd' ? 'eofill' : 'fill');
      }
      if (s.stroke && s.strokeWidth > 0) {
        const cap = s.dash === 'dotted' || s.lineCap === 'round' ? 1 : s.lineCap === 'square' ? 2 : 0;
        const dash = dashPattern(s);
        body.push(col(s.stroke), `${n(s.strokeWidth * PT)} setlinewidth ${cap} setlinecap 0 setlinejoin 10 setmiterlimit`, `[${dash ? dash.map((v) => n(v * PT)).join(' ') : ''}] 0 setdash`, p, 'stroke');
      }
    }
  }
  const title = (opts.title ?? 'Motiv').replace(/[^\x20-\x7e]/g, '?');
  const ps = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${Math.ceil(W)} ${Math.ceil(H)}`,
    `%%HiResBoundingBox: 0 0 ${n(W)} ${n(H)}`,
    `%%Title: ${title}`,
    `%%Creator: ${APP_NAME} ${APP_VERSION}`,
    '%%LanguageLevel: 3',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '%%EndProlog',
    '%%Page: 1 1',
    'save',
    ...body,
    'restore',
    'showpage',
    '%%EOF',
    '',
  ].join('\n');
  const bytes = new Uint8Array(ps.length);
  for (let i = 0; i < ps.length; i++) bytes[i] = ps.charCodeAt(i) & 0xff;
  return { bytes, lostTransparency: lost };
}
