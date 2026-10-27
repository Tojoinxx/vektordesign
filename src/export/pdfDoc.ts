import { zlibSync } from 'fflate';
import type { Gradient, Style } from '../model/types';
import { hexToRgb, rgbToCmyk } from '../model/color';
import { segments } from '../model/shape';
import { sortedStops } from '../model/paint';
import { dist } from '../model/geometry';
import { dashPattern } from '../render/drawDesign';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import type { ExportScene, SceneItem } from './scene';

/**
 * Kleiner PDF-Baukasten (PDF 1.6): mehrere Seiten, Vektorpfade in RGB oder CMYK,
 * Deckkraft, Verläufe, optionale Inhalte (Ebenen), Text in Helvetica (WinAnsi, nicht
 * eingebettet – Standardschrift jedes PDF-Programms) und Bilder (RGBA, verlustfrei).
 */

export type ColorMode = 'rgb' | 'cmyk';
export const PT = 72 / 25.4;

export const num = (v: number) => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** PDF-Textzeichenkette (UTF-16BE) für Metadaten und Ebenennamen. */
export function pdfText(s: string): string {
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

export function colorComps(hex: string, mode: ColorMode): number[] {
  if (mode === 'cmyk') {
    const c = rgbToCmyk(hexToRgb(hex));
    return [c.c / 100, c.m / 100, c.y / 100, c.k / 100];
  }
  const { r, g, b } = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

export function colorOp(hex: string, mode: ColorMode, stroke: boolean, cmyk?: number[]): string {
  if (mode === 'cmyk') {
    const c = cmyk ? cmyk.map((v) => v / 100) : colorComps(hex, 'cmyk');
    return `${c.map(num).join(' ')} ${stroke ? 'K' : 'k'}`;
  }
  return `${colorComps(hex, 'rgb').map(num).join(' ')} ${stroke ? 'RG' : 'rg'}`;
}

// ---------------------------------------------------------------------------
// Helvetica: Breiten (1/1000 em) für die Textausrichtung
// ---------------------------------------------------------------------------

// prettier-ignore
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const HELV_B = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

const BASE: Record<string, string> = { ä: 'a', ö: 'o', ü: 'u', Ä: 'A', Ö: 'O', Ü: 'U', é: 'e', è: 'e', á: 'a', à: 'a', ç: 'c', ñ: 'n', É: 'E' };
const WIN: Record<string, number> = { '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '™': 0x99 };

function charWidth(ch: string, bold: boolean): number {
  const t = bold ? HELV_B : HELV;
  const b = BASE[ch] ?? ch;
  const c = b.charCodeAt(0);
  if (c >= 32 && c <= 126) return t[c - 32];
  if (ch === 'ß') return bold ? 611 : 611;
  if (ch === '×' || ch === '±') return 584;
  if (ch === '°') return 400;
  if (ch === 'Ø') return 778;
  if (ch === '–') return 556;
  if (ch === '—') return 1000;
  if (ch === '•') return 350;
  return 556;
}

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s) w += charWidth(ch, bold);
  return (w / 1000) * size;
}

/** Text als PDF-Zeichenkette in WinAnsi (Zeichen außerhalb → „?“). */
function winAnsi(s: string): string {
  let out = '(';
  for (const ch of s) {
    let c = WIN[ch] ?? ch.codePointAt(0)!;
    if (c > 255) c = 63;
    if (c === 40 || c === 41 || c === 92) out += `\\${String.fromCharCode(c)}`;
    else if (c < 32 || c > 126) out += `\\${c.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(c);
  }
  return `${out})`;
}

/** Bricht Text auf eine Breite um (pt). */
export function wrapText(s: string, size: number, maxW: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of s.split('\n')) {
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && textWidth(next, size, bold) > maxW) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Dokument und Seiten
// ---------------------------------------------------------------------------

type Obj = string | { dict: string; data: Uint8Array };

export class PdfDoc {
  private objects: Obj[] = [];
  private pageNos: number[] = [];
  private ocgs: number[] = [];
  readonly catalogNo: number;
  readonly pagesNo: number;
  private fontNos: { regular?: number; bold?: number } = {};

  constructor(
    readonly mode: ColorMode = 'rgb',
    readonly compress = true,
  ) {
    this.catalogNo = this.add('');
    this.pagesNo = this.add('');
  }

  add(body: Obj): number {
    this.objects.push(body);
    return this.objects.length;
  }
  set(no: number, body: Obj): void {
    this.objects[no - 1] = body;
  }

  /** Datenstrom (optional komprimiert). `dict` ohne << >> und ohne /Length. */
  stream(dict: string, data: string | Uint8Array, compress = this.compress): number {
    let bytes = typeof data === 'string' ? latin1(data) : data;
    let filter = '';
    if (compress && bytes.length > 64) {
      bytes = zlibSync(bytes, { level: 6 });
      filter = ' /Filter /FlateDecode';
    }
    return this.add({ dict: `<< ${dict}${filter} /Length ${bytes.length} >>`, data: bytes });
  }

  font(bold: boolean): number {
    const k = bold ? 'bold' : 'regular';
    if (!this.fontNos[k]) this.fontNos[k] = this.add(`<< /Type /Font /Subtype /Type1 /BaseFont /${bold ? 'Helvetica-Bold' : 'Helvetica'} /Encoding /WinAnsiEncoding >>`);
    return this.fontNos[k]!;
  }

  ocg(name: string): number {
    const no = this.add(`<< /Type /OCG /Name ${pdfText(name)} >>`);
    this.ocgs.push(no);
    return no;
  }

  page(wPt: number, hPt: number): PdfPage {
    return new PdfPage(this, wPt, hPt);
  }

  /** Von PdfPage.finish aufgerufen */
  addPage(dict: string): void {
    this.pageNos.push(this.add(dict));
  }

  finish(title: string): Uint8Array {
    this.set(this.pagesNo, `<< /Type /Pages /Kids [${this.pageNos.map((p) => `${p} 0 R`).join(' ')}] /Count ${this.pageNos.length} >>`);
    const ocList = this.ocgs.map((o) => `${o} 0 R`).join(' ');
    this.set(this.catalogNo, `<< /Type /Catalog /Pages ${this.pagesNo} 0 R${this.ocgs.length ? ` /OCProperties << /OCGs [${ocList}] /D << /Order [${ocList}] /ON [${ocList}] >> >>` : ''} >>`);
    const d = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const info = this.add(
      `<< /Title ${pdfText(title)} /Producer ${pdfText(`${APP_NAME} ${APP_VERSION}`)} /Creator ${pdfText(APP_NAME)} /CreationDate (D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z) >>`,
    );
    const chunks: Uint8Array[] = [];
    let len = 0;
    const push = (b: Uint8Array) => {
      chunks.push(b);
      len += b.length;
    };
    push(latin1('%PDF-1.6\n%\xE2\xE3\xCF\xD3\n'));
    const offsets: number[] = [];
    this.objects.forEach((o, i) => {
      offsets.push(len);
      if (typeof o === 'string') push(latin1(`${i + 1} 0 obj\n${o}\nendobj\n`));
      else {
        push(latin1(`${i + 1} 0 obj\n${o.dict}\nstream\n`));
        push(o.data);
        push(latin1('\nendstream\nendobj\n'));
      }
    });
    const xref = len;
    let tail = `xref\n0 ${this.objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) tail += `${String(off).padStart(10, '0')} 00000 n \n`;
    tail += `trailer\n<< /Size ${this.objects.length + 1} /Root ${this.catalogNo} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    push(latin1(tail));
    const out = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }
}

export interface SceneBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ScenePlacement {
  /** Lage der linken unteren Ecke des Motivs auf der Seite (pt) */
  ox: number;
  oy: number;
  /** pt je mm */
  k: number;
  /** Rahmen des Motivs in mm (Welt) */
  box: SceneBox;
  mirror?: boolean;
  /** Ebenen als PDF-Ebenen anlegen */
  layers?: boolean;
  /** Farbersetzung (für Varianten in Vorschauen) */
  cmykFor?: (hex: string) => number[] | undefined;
}

export class PdfPage {
  readonly ops: string[] = [];
  private extG: string[] = [];
  private shadings: string[] = [];
  private xobjects: string[] = [];
  private props: string[] = [];
  private fonts = new Set<'F1' | 'F2'>();
  private gsCache = new Map<string, string>();

  constructor(
    readonly doc: PdfDoc,
    readonly w: number,
    readonly h: number,
  ) {}

  get mode(): ColorMode {
    return this.doc.mode;
  }

  gs(key: string, dict: string): string {
    let name = this.gsCache.get(key);
    if (!name) {
      name = `GS${this.gsCache.size + 1}`;
      this.gsCache.set(key, name);
      this.extG.push(`/${name} ${this.doc.add(dict)} 0 R`);
    }
    return name;
  }

  opacity(a: number): void {
    if (a < 1) this.ops.push(`/${this.gs(`a${a}`, `<< /Type /ExtGState /ca ${num(a)} /CA ${num(a)} >>`)} gs`);
  }

  fill(hex: string): this {
    this.ops.push(colorOp(hex, this.mode, false));
    return this;
  }
  stroke(hex: string, width = 0.5): this {
    this.ops.push(colorOp(hex, this.mode, true), `${num(width)} w 0 J 0 j [] 0 d`);
    return this;
  }
  dash(on: number, off: number): this {
    this.ops.push(`[${num(on)} ${num(off)}] 0 d`);
    return this;
  }
  rect(x: number, y: number, w: number, h: number, op: 'f' | 'S' | 'B' = 'f'): this {
    this.ops.push(`${num(x)} ${num(y)} ${num(w)} ${num(h)} re ${op}`);
    return this;
  }
  poly(pts: [number, number][], closed: boolean, op: 'f' | 'S' | 'B' | 'W n'): this {
    if (!pts.length) return this;
    const s = [`${num(pts[0][0])} ${num(pts[0][1])} m`];
    for (let i = 1; i < pts.length; i++) s.push(`${num(pts[i][0])} ${num(pts[i][1])} l`);
    if (closed) s.push('h');
    s.push(op);
    this.ops.push(s.join(' '));
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number): this {
    this.ops.push(`${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
    return this;
  }
  save(): this {
    this.ops.push('q');
    return this;
  }
  restore(): this {
    this.ops.push('Q');
    return this;
  }

  text(x: number, y: number, s: string, opts: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'center' | 'right' } = {}): number {
    const size = opts.size ?? 9;
    const bold = !!opts.bold;
    const w = textWidth(s, size, bold);
    const dx = opts.align === 'center' ? -w / 2 : opts.align === 'right' ? -w : 0;
    const f = bold ? 'F2' : 'F1';
    this.fonts.add(f);
    this.ops.push(`BT /${f} ${num(size)} Tf ${colorOp(opts.color ?? '#1e2328', this.mode, false)} ${num(x + dx)} ${num(y)} Td ${winAnsi(s)} Tj ET`);
    return w;
  }

  /** RGBA-Bild (Zeilen von oben nach unten) an Rechteck (pt) zeichnen. */
  image(rgba: Uint8Array | Uint8ClampedArray, pw: number, ph: number, x: number, y: number, w: number, h: number): void {
    const rgb = new Uint8Array(pw * ph * 3);
    const alpha = new Uint8Array(pw * ph);
    let hasAlpha = false;
    for (let i = 0, j = 0; i < pw * ph; i++, j += 4) {
      rgb[i * 3] = rgba[j];
      rgb[i * 3 + 1] = rgba[j + 1];
      rgb[i * 3 + 2] = rgba[j + 2];
      alpha[i] = rgba[j + 3];
      if (rgba[j + 3] !== 255) hasAlpha = true;
    }
    const smask = hasAlpha ? this.doc.stream(`/Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceGray /BitsPerComponent 8`, alpha, true) : 0;
    const img = this.doc.stream(`/Type /XObject /Subtype /Image /Width ${pw} /Height ${ph} /ColorSpace /DeviceRGB /BitsPerComponent 8${smask ? ` /SMask ${smask} 0 R` : ''}`, rgb, true);
    const name = `Im${this.xobjects.length + 1}`;
    this.xobjects.push(`/${name} ${img} 0 R`);
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${name} Do Q`);
  }

  /** Zeichnet eine Export-Szene (Motiv) maßstäblich auf die Seite. */
  scene(scene: ExportScene, pl: ScenePlacement): void {
    const { box, k } = pl;
    const W = (box.maxX - box.minX) * k;
    const X = (x: number) => (pl.mirror ? pl.ox + W - (x - box.minX) * k : pl.ox + (x - box.minX) * k);
    const Y = (y: number) => pl.oy + (y - box.minY) * k;
    const mode = this.mode;
    const doc = this.doc;

    const pathOps = (it: SceneItem): string => {
      const out: string[] = [];
      for (const c of it.contours) {
        if (!c.nodes.length) continue;
        out.push(`${num(X(c.nodes[0].x))} ${num(Y(c.nodes[0].y))} m`);
        for (const s of segments(c)) {
          if (s.curved) out.push(`${num(X(s.p1.x))} ${num(Y(s.p1.y))} ${num(X(s.p2.x))} ${num(Y(s.p2.y))} ${num(X(s.p3.x))} ${num(Y(s.p3.y))} c`);
          else out.push(`${num(X(s.p3.x))} ${num(Y(s.p3.y))} l`);
        }
        if (c.closed) out.push('h');
      }
      return out.join('\n');
    };

    const stitch = (g: Gradient, comps: (i: number) => number[]): string => {
      const stops = sortedStops(g);
      if (stops.length === 1) stops.push({ ...stops[0], offset: 1 });
      const fns: number[] = [];
      const bounds: string[] = [];
      const encode: string[] = [];
      for (let i = 0; i < stops.length - 1; i++) {
        fns.push(doc.add(`<< /FunctionType 2 /Domain [0 1] /C0 [${comps(i).map(num).join(' ')}] /C1 [${comps(i + 1).map(num).join(' ')}] /N 1 >>`));
        if (i > 0) bounds.push(num(Math.min(1, Math.max(0, stops[i].offset))));
        encode.push('0 1');
      }
      if (fns.length === 1) return `${fns[0]} 0 R`;
      return `${doc.add(`<< /FunctionType 3 /Domain [0 1] /Functions [${fns.map((f) => `${f} 0 R`).join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${encode.join(' ')}] >>`)} 0 R`;
    };

    const shadingDict = (it: SceneItem, cs: string, fn: string): string => {
      const gr = it.gradient!;
      if (gr.g.kind === 'radial') {
        const r = Math.max(dist(gr.from, gr.to), 0.001) * k;
        return `<< /ShadingType 3 /ColorSpace ${cs} /Coords [${num(X(gr.from.x))} ${num(Y(gr.from.y))} 0 ${num(X(gr.from.x))} ${num(Y(gr.from.y))} ${num(r)}] /Function ${fn} /Extend [true true] >>`;
      }
      return `<< /ShadingType 2 /ColorSpace ${cs} /Coords [${num(X(gr.from.x))} ${num(Y(gr.from.y))} ${num(X(gr.to.x))} ${num(Y(gr.to.y))}] /Function ${fn} /Extend [true true] >>`;
    };

    const content = this.ops;
    scene.layers.forEach((layer) => {
      let ocName = '';
      if (pl.layers) {
        const ocg = doc.ocg(layer.name);
        ocName = `OC${this.props.length + 1}`;
        this.props.push(`/${ocName} ${ocg} 0 R`);
        content.push(`/OC /${ocName} BDC`);
      }
      for (const it of layer.items) {
        if (!it.contours.length) continue;
        const s: Style = it.style;
        content.push('q');
        if (s.opacity < 1) content.push(`/${this.gs(`a${s.opacity}`, `<< /Type /ExtGState /ca ${num(s.opacity)} /CA ${num(s.opacity)} >>`)} gs`);
        const path = pathOps(it);
        const fill = it.closed && s.fill;
        if (fill && it.gradient) {
          const g = it.gradient.g;
          const stops = sortedStops(g);
          const cs = mode === 'cmyk' ? '/DeviceCMYK' : '/DeviceRGB';
          const sh = doc.add(shadingDict(it, cs, stitch(g, (i) => colorComps(stops[Math.min(i, stops.length - 1)].color, mode))));
          content.push('q');
          if (stops.some((x) => x.opacity < 1)) {
            const maskSh = doc.add(shadingDict(it, '/DeviceGray', stitch(g, (i) => [stops[Math.min(i, stops.length - 1)].opacity])));
            const form = doc.stream(
              `/Type /XObject /Subtype /Form /BBox [0 0 ${num(this.w)} ${num(this.h)}] /Group << /S /Transparency /CS /DeviceGray >> /Resources << /Shading << /Sh1 ${maskSh} 0 R >> >>`,
              `${path}\nW n\n/Sh1 sh`,
              false,
            );
            const name = this.gs(`m${form}`, `<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${form} 0 R >> >>`);
            content.push(`/${name} gs`);
          }
          const shName = `Sh${this.shadings.length + 1}`;
          this.shadings.push(`/${shName} ${sh} 0 R`);
          content.push(`${path}\nW${it.fillRule === 'evenodd' ? '*' : ''} n\n/${shName} sh`, 'Q');
        } else if (fill) {
          content.push(colorOp(s.fill as string, mode, false, pl.cmykFor?.(s.fill as string)), `${path}\n${it.fillRule === 'evenodd' ? 'f*' : 'f'}`);
        }
        if (s.stroke && s.strokeWidth > 0) {
          const cap = s.dash === 'dotted' ? 1 : s.lineCap === 'round' ? 1 : s.lineCap === 'square' ? 2 : 0;
          const dash = dashPattern(s);
          content.push(
            colorOp(s.stroke, mode, true, pl.cmykFor?.(s.stroke)),
            `${num(s.strokeWidth * k)} w ${cap} J 0 j 10 M`,
            dash ? `[${dash.map((v) => num(v * k)).join(' ')}] 0 d` : '[] 0 d',
            `${path}\nS`,
          );
        }
        content.push('Q');
      }
      if (pl.layers) content.push('EMC');
    });
  }

  finish(extra: { trim?: boolean; compress?: boolean } = {}): void {
    const contentNo = this.doc.stream('', this.ops.join('\n'), extra.compress);
    const fonts: string[] = [];
    if (this.fonts.has('F1')) fonts.push(`/F1 ${this.doc.font(false)} 0 R`);
    if (this.fonts.has('F2')) fonts.push(`/F2 ${this.doc.font(true)} 0 R`);
    const resources = [
      this.extG.length ? `/ExtGState << ${this.extG.join(' ')} >>` : '',
      this.shadings.length ? `/Shading << ${this.shadings.join(' ')} >>` : '',
      this.xobjects.length ? `/XObject << ${this.xobjects.join(' ')} >>` : '',
      this.props.length ? `/Properties << ${this.props.join(' ')} >>` : '',
      fonts.length ? `/Font << ${fonts.join(' ')} >>` : '',
    ]
      .filter(Boolean)
      .join(' ');
    const box = `[0 0 ${num(this.w)} ${num(this.h)}]`;
    this.doc.addPage(`<< /Type /Page /Parent ${this.doc.pagesNo} 0 R /MediaBox ${box}${extra.trim ? ` /TrimBox ${box}` : ''} /Resources << ${resources} >> /Contents ${contentNo} 0 R >>`);
  }
}

export function latin1(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
  return b;
}
