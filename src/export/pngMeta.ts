/** PNG-Hilfen: Auflösung (pHYs) setzen, damit 300 dpi in jedem Programm ankommen. */

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  return crcTable;
}

export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

export interface PngChunk {
  type: string;
  data: Uint8Array;
}

export function readChunks(png: Uint8Array): PngChunk[] {
  for (let i = 0; i < 8; i++) if (png[i] !== SIG[i]) throw new Error('Keine PNG-Datei');
  const out: PngChunk[] = [];
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let off = 8;
  while (off + 12 <= png.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
    out.push({ type, data: png.slice(off + 8, off + 8 + len) });
    off += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Setzt die Auflösung (pHYs, Pixel pro Meter) und ersetzt einen vorhandenen Eintrag. */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  const chunks = readChunks(png).filter((c) => c.type !== 'pHYs');
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(9);
  const dv = new DataView(phys.buffer);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  phys[8] = 1; // Einheit: Meter
  const parts: Uint8Array[] = [new Uint8Array(SIG)];
  for (const c of chunks) {
    parts.push(writeChunk(c.type, c.data));
    if (c.type === 'IHDR') parts.push(writeChunk('pHYs', phys));
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Liest Breite/Höhe (px) und dpi aus einer PNG-Datei. */
export function pngInfo(png: Uint8Array): { width: number; height: number; dpi: number | null; colorType: number } {
  const chunks = readChunks(png);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('IHDR fehlt');
  const dv = new DataView(ihdr.data.buffer, ihdr.data.byteOffset, ihdr.data.byteLength);
  const phys = chunks.find((c) => c.type === 'pHYs');
  let dpi: number | null = null;
  if (phys && phys.data[8] === 1) {
    const pv = new DataView(phys.data.buffer, phys.data.byteOffset, phys.data.byteLength);
    dpi = Math.round(pv.getUint32(0) * 0.0254 * 100) / 100;
  }
  return { width: dv.getUint32(0), height: dv.getUint32(4), dpi, colorType: ihdr.data[9] };
}
