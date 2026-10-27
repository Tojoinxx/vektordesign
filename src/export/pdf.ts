import type { Gradient, Style, Vec2 } from '../model/types';
import { hexToRgb, rgbToCmyk } from '../model/color';
import { segments } from '../model/shape';
import { sortedStops } from '../model/paint';
import { dist } from '../model/geometry';
import { dashPattern } from '../render/drawDesign';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import type { ExportScene, SceneItem } from './scene';

/**
 * PDF-Export (vektorbasiert, maßstabsgetreu): Seitengröße = Motiv in mm, jede Ebene als
 * PDF-Ebene (optionaler Inhalt), Farben in RGB oder CMYK, Deckkraft, Verläufe als Shading
 * (Verblassen per weicher Maske). Text kommt immer als Umriss (siehe textOutlines).
 */

export type ColorMode = 'rgb' | 'cmyk';

export interface PdfOptions {
  colorMode?: ColorMode;
  mirror?: boolean;
  title?: string;
}

const PT = 72 / 25.4;
const n = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** PDF-Textzeichenkette (UTF-16BE, für Umlaute im Titel/Ebenennamen). */
function pdfText(s: string): string {
  let hex = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

function colorOp(hex: string, mode: ColorMode, stroke: boolean): string {
  if (mode === 'cmyk') {
    const c = rgbToCmyk(hexToRgb(hex));
    return `${n(c.c / 100)} ${n(c.m / 100)} ${n(c.y / 100)} ${n(c.k / 100)} ${stroke ? 'K' : 'k'}`;
  }
  const { r, g, b } = hexToRgb(hex);
  return `${n(r / 255)} ${n(g / 255)} ${n(b / 255)} ${stroke ? 'RG' : 'rg'}`;
}

function colorComps(hex: string, mode: ColorMode): number[] {
  if (mode === 'cmyk') {
    const c = rgbToCmyk(hexToRgb(hex));
    return [c.c / 100, c.m / 100, c.y / 100, c.k / 100];
  }
  const { r, g, b } = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

export function exportPdf(scene: ExportScene, opts: PdfOptions = {}): Uint8Array {
  const mode = opts.colorMode ?? 'rgb';
  const W = scene.widthMm * PT;
  const H = scene.heightMm * PT;
  const { box } = scene;
  const X = (x: number) => (x - box.minX) * PT;
  const Y = (y: number) => (y - box.minY) * PT;

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length; // Objektnummer
  };
  // Reservierte Nummern
  const catalogNo = add('');
  const pagesNo = add('');
  const pageNo = add('');

  const extG: string[] = [];
  const patterns: string[] = [];
  const xobjects: string[] = [];
  const gsCache = new Map<string, string>();
  const gs = (key: string, dict: string) => {
    let name = gsCache.get(key);
    if (!name) {
      name = `GS${gsCache.size + 1}`;
      gsCache.set(key, name);
      extG.push(`/${name} ${add(dict)} 0 R`);
    }
    return name;
  };

  const pathOps = (it: SceneItem): string => {
    const out: string[] = [];
    for (const c of it.contours) {
      if (!c.nodes.length) continue;
      out.push(`${n(X(c.nodes[0].x))} ${n(Y(c.nodes[0].y))} m`);
      for (const s of segments(c)) {
        if (s.curved) out.push(`${n(X(s.p1.x))} ${n(Y(s.p1.y))} ${n(X(s.p2.x))} ${n(Y(s.p2.y))} ${n(X(s.p3.x))} ${n(Y(s.p3.y))} c`);
        else out.push(`${n(X(s.p3.x))} ${n(Y(s.p3.y))} l`);
      }
      if (c.closed) out.push('h');
    }
    return out.join('\n');
  };

  /** Funktion über die Verlaufsstufen (Farbe oder Deckkraft). */
  const stitch = (g: Gradient, comps: (stopIdx: number) => number[]): string => {
    const stops = sortedStops(g);
    if (stops.length === 1) stops.push({ ...stops[0], offset: 1 });
    const fns: number[] = [];
    const bounds: string[] = [];
    const encode: string[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const c0 = comps(i);
      const c1 = comps(i + 1);
      fns.push(add(`<< /FunctionType 2 /Domain [0 1] /C0 [${c0.map(n).join(' ')}] /C1 [${c1.map(n).join(' ')}] /N 1 >>`));
      if (i > 0) bounds.push(n(Math.min(1, Math.max(0, stops[i].offset))));
      encode.push('0 1');
    }
    const first = Math.min(1, Math.max(0, stops[0].offset));
    const last = Math.min(1, Math.max(0, stops[stops.length - 1].offset));
    // Bereiche vor der ersten / nach der letzten Stufe: per Extend
    void first;
    void last;
    if (fns.length === 1) return `${fns[0]} 0 R`;
    return `${add(`<< /FunctionType 3 /Domain [0 1] /Functions [${fns.map((f) => `${f} 0 R`).join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode.join(' ')}] >>`)} 0 R`;
  };

  const shadingDict = (it: SceneItem, cs: string, fn: string): string => {
    const gr = it.gradient!;
    if (gr.g.kind === 'radial') {
      const r = Math.max(dist(gr.from, gr.to), 0.001) * PT;
      return `<< /ShadingType 3 /ColorSpace ${cs} /Coords [${n(X(gr.from.x))} ${n(Y(gr.from.y))} 0 ${n(X(gr.from.x))} ${n(Y(gr.from.y))} ${n(r)}] /Function ${fn} /Extend [true true] >>`;
    }
    return `<< /ShadingType 2 /ColorSpace ${cs} /Coords [${n(X(gr.from.x))} ${n(Y(gr.from.y))} ${n(X(gr.to.x))} ${n(Y(gr.to.y))}] /Function ${fn} /Extend [true true] >>`;
  };

  const fillOp = (it: SceneItem) => (it.fillRule === 'evenodd' ? 'f*' : 'f');

  const content: string[] = [];
  if (opts.mirror) content.push(`-1 0 0 1 ${n(W)} 0 cm`);
  const ocgs: number[] = [];
  const props: string[] = [];
  scene.layers.forEach((layer, li) => {
    const ocg = add(`<< /Type /OCG /Name ${pdfText(layer.name)} >>`);
    ocgs.push(ocg);
    props.push(`/OC${li + 1} ${ocg} 0 R`);
    content.push(`/OC /OC${li + 1} BDC`);
    for (const it of layer.items) {
      if (!it.contours.length) continue;
      const s: Style = it.style;
      content.push('q');
      if (s.opacity < 1) content.push(`/${gs(`a${s.opacity}`, `<< /Type /ExtGState /ca ${n(s.opacity)} /CA ${n(s.opacity)} >>`)} gs`);
      const path = pathOps(it);
      const fill = it.closed && s.fill;
      if (fill && it.gradient) {
        // Verlauf: Pfad als Clip, dann Shading; Deckkraftstufen als weiche Maske
        const g = it.gradient.g;
        const stops = sortedStops(g);
        const cs = mode === 'cmyk' ? '/DeviceCMYK' : '/DeviceRGB';
        const sh = add(shadingDict(it, cs, stitch(g, (i) => colorComps(stops[Math.min(i, stops.length - 1)].color, mode))));
        content.push('q');
        if (stops.some((x) => x.opacity < 1)) {
          const maskSh = add(shadingDict(it, '/DeviceGray', stitch(g, (i) => [stops[Math.min(i, stops.length - 1)].opacity])));
          const form = add(
            streamObj(`<< /Type /XObject /Subtype /Form /BBox [0 0 ${n(W)} ${n(H)}] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Shading << /Sh1 ${maskSh} 0 R >> >>`, `${path}\nW n\n/Sh1 sh`),
          );
          const name = gs(`m${form}`, `<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${form} 0 R >> >>`);
          content.push(`/${name} gs`);
        }
        const shName = `Sh${patterns.length + 1}`;
        patterns.push(`/${shName} ${sh} 0 R`);
        content.push(`${path}\nW${it.fillRule === 'evenodd' ? '*' : ''} n\n/${shName} sh`, 'Q');
      } else if (fill) {
        content.push(colorOp(s.fill as string, mode, false), `${path}\n${fillOp(it)}`);
      }
      if (s.stroke && s.strokeWidth > 0) {
        const cap = s.dash === 'dotted' ? 1 : s.lineCap === 'round' ? 1 : s.lineCap === 'square' ? 2 : 0;
        const dash = dashPattern(s);
        content.push(colorOp(s.stroke, mode, true), `${n(s.strokeWidth * PT)} w ${cap} J 0 j 10 M`, dash ? `[${dash.map((v) => n(v * PT)).join(' ')}] 0 d` : '[] 0 d', `${path}\nS`);
      }
      content.push('Q');
    }
    content.push('EMC');
  });

  const contentNo = add(streamObj('<<', content.join('\n'), true));
  const resources = [
    extG.length ? `/ExtGState << ${extG.join(' ')} >>` : '',
    patterns.length ? `/Shading << ${patterns.join(' ')} >>` : '',
    xobjects.length ? `/XObject << ${xobjects.join(' ')} >>` : '',
    props.length ? `/Properties << ${props.join(' ')} >>` : '',
  ].join(' ');
  objects[pageNo - 1] = `<< /Type /Page /Parent ${pagesNo} 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /TrimBox [0 0 ${n(W)} ${n(H)}] /Resources << ${resources} >> /Contents ${contentNo} 0 R >>`;
  objects[pagesNo - 1] = `<< /Type /Pages /Kids [${pageNo} 0 R] /Count 1 >>`;
  const ocList = ocgs.map((o) => `${o} 0 R`).join(' ');
  objects[catalogNo - 1] = `<< /Type /Catalog /Pages ${pagesNo} 0 R${ocgs.length ? ` /OCProperties << /OCGs [${ocList}] /D << /Order [${ocList}] /ON [${ocList}] >> >>` : ''} >>`;
  const d = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  const info = add(
    `<< /Title ${pdfText(opts.title ?? 'Motiv')} /Producer ${pdfText(`${APP_NAME} ${APP_VERSION}`)} /Creator ${pdfText(APP_NAME)} /CreationDate (D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z) >>`,
  );

  // Datei zusammensetzen (nur ASCII → Zeichen = Bytes)
  let out = '%PDF-1.6\n%\xE2\xE3\xCF\xD3\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(byteLen(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = byteLen(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(out);
}

function streamObj(dictStart: string, data: string, plain = false): string {
  const dict = plain ? `<< /Length ${data.length} >>` : `${dictStart} /Length ${data.length} >>`;
  return `${dict}\nstream\n${data}\nendstream`;
}

/** Länge in Bytes: nur die Binärzeile enthält Zeichen > 127 (je ein Byte in Latin-1). */
function byteLen(s: string): number {
  return s.length;
}

function latin1(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}

export const PT_PER_MM = PT;
export type { Vec2 };
