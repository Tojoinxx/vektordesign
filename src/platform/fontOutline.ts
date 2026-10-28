import { parse, type Font } from 'opentype.js';
import type { Contour, ShapeNode, TextEntity, Vec2 } from '../model/types';
import { isTauri } from './files';
import plex400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff?url';
import plex400i from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-italic.woff?url';
import plex700 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff?url';
import plex700i from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-italic.woff?url';

/**
 * Schriftumrisse für „Text in Pfade“ und für Exporte, die Text als Pfade brauchen (PDF, EPS, DXF).
 * Quellen: Desktop – Schriftdatei des Systems (Rust); Chrome/Edge – lokale Schriften
 * (Local Font Access, fragt einmal nach); sonst die eingebaute IBM Plex Sans als Ersatz.
 */

export interface LoadedFont {
  font: Font;
  /** true, wenn die gewünschte Schrift fehlte und IBM Plex Sans eingesprungen ist */
  substitute: boolean;
}

const cache = new Map<string, Promise<LoadedFont>>();

export function loadFont(family: string, weight: number, italic: boolean): Promise<LoadedFont> {
  const key = `${family}|${weight}|${italic}`;
  let p = cache.get(key);
  if (!p) {
    p = loadUncached(family, weight, italic);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function loadUncached(family: string, weight: number, italic: boolean): Promise<LoadedFont> {
  if (family.toLowerCase() !== 'ibm plex sans') {
    try {
      const bytes = isTauri() ? await fromDesktop(family, weight, italic) : await fromLocalFonts(family, weight, italic);
      if (bytes) return { font: parse(bytes), substitute: false };
    } catch {
      // weiter mit Ersatzschrift
    }
  }
  const url = weight >= 600 ? (italic ? plex700i : plex700) : italic ? plex400i : plex400;
  return { font: parse(await fetchBytes(url)), substitute: family.toLowerCase() !== 'ibm plex sans' };
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
  // Eingebettet (Einzeldatei): selbst dekodieren, denn fetch(data:) verbietet die CSP der Desktop-App
  if (url.startsWith('data:')) {
    const b64 = url.slice(url.indexOf(',') + 1);
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Schrift konnte nicht geladen werden (${r.status})`);
  return r.arrayBuffer();
}

async function fromDesktop(family: string, weight: number, italic: boolean): Promise<ArrayBuffer | null> {
  const { invoke } = await import('@tauri-apps/api/core');
  const raw = new Uint8Array(await invoke<ArrayBuffer>('font_file', { family, weight, italic }));
  const index = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
  return sfntFace(raw.slice(4).buffer, index);
}

interface LocalFontData {
  family: string;
  style: string;
  blob(): Promise<Blob>;
}

async function fromLocalFonts(family: string, weight: number, italic: boolean): Promise<ArrayBuffer | null> {
  const q = (window as unknown as { queryLocalFonts?: () => Promise<LocalFontData[]> }).queryLocalFonts;
  if (!q) return null;
  const all = (await q()).filter((f) => f.family.toLowerCase() === family.toLowerCase());
  if (!all.length) return null;
  const wantBold = weight >= 600;
  const score = (f: LocalFontData) => {
    const s = f.style.toLowerCase();
    const bold = /bold|black|heavy|semibold|demi/.test(s);
    const it = /italic|oblique/.test(s);
    return (bold === wantBold ? 2 : 0) + (it === italic ? 1 : 0) + (s === 'regular' && !wantBold && !italic ? 1 : 0);
  };
  all.sort((a, b) => score(b) - score(a));
  return sfntFace(await (await all[0].blob()).arrayBuffer(), 0);
}

/** Einzelne Schrift aus einer Sammlung (.ttc) als eigenständige Datei; andere Dateien unverändert. */
export function sfntFace(buf: ArrayBuffer, index: number): ArrayBuffer {
  const dv = new DataView(buf);
  if (dv.byteLength < 12 || dv.getUint32(0) !== 0x74746366 /* 'ttcf' */) return buf;
  const count = dv.getUint32(8);
  const off = dv.getUint32(12 + 4 * Math.min(index, count - 1));
  const numTables = dv.getUint16(off + 4);
  const tables: { tag: number; checksum: number; offset: number; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const r = off + 12 + i * 16;
    tables.push({ tag: dv.getUint32(r), checksum: dv.getUint32(r + 4), offset: dv.getUint32(r + 8), length: dv.getUint32(r + 12) });
  }
  const headerLen = 12 + numTables * 16;
  let size = headerLen;
  for (const t of tables) size += (t.length + 3) & ~3;
  const out = new Uint8Array(size);
  const ov = new DataView(out.buffer);
  out.set(new Uint8Array(buf, off, 12), 0);
  let pos = headerLen;
  tables.forEach((t, i) => {
    const r = 12 + i * 16;
    ov.setUint32(r, t.tag);
    ov.setUint32(r + 4, t.checksum);
    ov.setUint32(r + 8, pos);
    ov.setUint32(r + 12, t.length);
    out.set(new Uint8Array(buf, t.offset, t.length), pos);
    pos += (t.length + 3) & ~3;
  });
  return out.buffer;
}

/**
 * Umrisse eines Texts in Weltkoordinaten (mm, Y nach oben), passend zur Darstellung:
 * Anker auf der Grundlinie, Ausrichtung links/mittig/rechts, Schriftgröße = Geviert in mm.
 */
export function textContours(font: Font, t: Pick<TextEntity, 'text' | 'fontSize' | 'align'>, anchor: Vec2): Contour[] {
  const opts = { kerning: true };
  const w = font.getAdvanceWidth(t.text, t.fontSize, opts);
  const shift = t.align === 'center' ? -w / 2 : t.align === 'right' ? -w : 0;
  const path = font.getPath(t.text, 0, 0, t.fontSize, opts);
  const X = (x: number) => anchor.x + shift + x;
  const Y = (y: number) => anchor.y - y;
  const contours: Contour[] = [];
  let cur: ShapeNode[] | null = null;
  let last: ShapeNode | null = null;
  const close = () => {
    if (cur && cur.length > 1) {
      // Endpunkt = Startpunkt? Dann zusammenführen (Griff übernehmen)
      const a = cur[0];
      const b = cur[cur.length - 1];
      if (Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9) {
        if (b.ix !== undefined) {
          a.ix = b.ix;
          a.iy = b.iy;
        }
        cur.pop();
      }
      contours.push({ closed: true, nodes: cur });
    }
    cur = null;
    last = null;
  };
  for (const c of path.commands as { type: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }[]) {
    if (c.type === 'M') {
      close();
      last = { x: X(c.x!), y: Y(c.y!) };
      cur = [last];
    } else if (c.type === 'L' && cur && last) {
      last = { x: X(c.x!), y: Y(c.y!) };
      cur.push(last);
    } else if (c.type === 'C' && cur && last) {
      last.ox = X(c.x1!);
      last.oy = Y(c.y1!);
      last = { x: X(c.x!), y: Y(c.y!), ix: X(c.x2!), iy: Y(c.y2!) };
      cur.push(last);
    } else if (c.type === 'Q' && cur && last) {
      // Quadratisch → kubisch
      const qx = X(c.x1!);
      const qy = Y(c.y1!);
      const ex = X(c.x!);
      const ey = Y(c.y!);
      last.ox = last.x + (2 / 3) * (qx - last.x);
      last.oy = last.y + (2 / 3) * (qy - last.y);
      last = { x: ex, y: ey, ix: ex + (2 / 3) * (qx - ex), iy: ey + (2 / 3) * (qy - ey) };
      cur.push(last);
    } else if (c.type === 'Z') close();
  }
  close();
  return contours;
}

/** Text → Umrisse für Generatoren (Grundlinie y = 0, links bei x = 0), mit Breite und Versalhöhe. */
export function makeShaper(font: Font): (text: string, size: number) => { contours: Contour[]; width: number; capHeight: number } {
  const os2 = (font.tables as { os2?: { sCapHeight?: number } }).os2;
  const capRatio = os2?.sCapHeight ? os2.sCapHeight / font.unitsPerEm : 0.7;
  return (text, size) => ({
    contours: textContours(font, { text, fontSize: size, align: 'left' }, { x: 0, y: 0 }),
    width: font.getAdvanceWidth(text, size, { kerning: true }),
    capHeight: capRatio * size,
  });
}
