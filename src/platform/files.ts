/**
 * Dateizugriff für Desktop (Tauri) und Browser/iPad (Web) mit gemeinsamer Schnittstelle.
 */

export const isTauri = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export interface FileType {
  description: string;
  mime: string;
  ext: string;
}

export interface SaveResult {
  name: string;
  /** Pfad (nur Desktop) */
  path: string | null;
}

export interface OpenResult {
  name: string;
  path: string | null;
  data: Uint8Array;
}

/** iPad/iPhone (auch iPadOS, das sich als Mac ausgibt) */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/**
 * Teilen braucht in Safari eine frische Nutzeraktion. Dauert das Erzeugen der Datei zu lange,
 * zeigt die App einen Knopf „Teilen“ an (vom Controller gesetzt).
 */
let shareFallback: ((name: string, share: () => Promise<void>) => void) | null = null;
export function setShareFallback(fn: typeof shareFallback): void {
  shareFallback = fn;
}

async function shareBytes(bytes: Uint8Array, name: string, mime: string): Promise<'shared' | 'aborted' | 'unsupported' | 'deferred'> {
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  if (!nav.share || !nav.canShare) return 'unsupported';
  const file = new File([bytes as BlobPart], name, { type: mime });
  if (!nav.canShare({ files: [file] })) return 'unsupported';
  const run = () => nav.share({ files: [file], title: name });
  try {
    await run();
    return 'shared';
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'aborted';
    if (e instanceof DOMException && e.name === 'NotAllowedError' && shareFallback) {
      shareFallback(name, async () => {
        try {
          await run();
        } catch {
          /* abgebrochen */
        }
      });
      return 'deferred';
    }
    return 'unsupported';
  }
}

const toBytes = (data: Uint8Array | string): Uint8Array => (typeof data === 'string' ? new TextEncoder().encode(data) : data);

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Speichert Daten. Mit `path` wird ohne Dialog überschrieben (nur Desktop). */
export async function saveFile(data: Uint8Array | string, suggestedName: string, type: FileType, path?: string | null): Promise<SaveResult | null> {
  const bytes = toBytes(data);
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    let target = path ?? null;
    if (!target) {
      const { save } = await import('@tauri-apps/plugin-dialog');
      target = await save({ defaultPath: suggestedName, filters: [{ name: type.description, extensions: [type.ext] }] });
      if (!target) return null;
      if (!target.toLowerCase().endsWith(`.${type.ext}`)) target += `.${type.ext}`;
    }
    await invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(target) } });
    return { name: baseName(target), path: target };
  }
  // iPad: Teilen-Menü (In Dateien sichern, AirDrop, Mail, Cricut-App …)
  if (isIOS()) {
    const r = await shareBytes(bytes, suggestedName, type.mime);
    if (r === 'shared' || r === 'deferred') return { name: suggestedName, path: null };
    if (r === 'aborted') return null;
  }
  const w = window as unknown as {
    showSaveFilePicker?: (o: unknown) => Promise<{ name: string; createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>;
  };
  if (w.showSaveFilePicker && window.top === window.self) {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description: type.description, accept: { [type.mime]: [`.${type.ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([bytes as BlobPart], { type: type.mime }));
      await writable.close();
      return { name: handle.name, path: null };
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null;
      // Fallback auf Download
    }
  }
  downloadBytes(bytes, suggestedName, type.mime);
  return { name: suggestedName, path: null };
}

export function downloadBytes(bytes: Uint8Array, name: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function openFile(types: FileType[]): Promise<OpenResult | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const { invoke } = await import('@tauri-apps/api/core');
    const sel = await open({ multiple: false, filters: types.map((t) => ({ name: t.description, extensions: [t.ext] })) });
    if (!sel || Array.isArray(sel)) return null;
    const buf = await invoke<ArrayBuffer>('read_file', { path: sel });
    return { name: baseName(sel), path: sel, data: new Uint8Array(buf) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // iOS graut unbekannte Endungen (.vdp) sonst aus
    if (!isIOS()) input.accept = types.map((t) => `.${t.ext},${t.mime}`).join(',');
    input.style.display = 'none';
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return resolve(null);
      resolve({ name: f.name, path: null, data: new Uint8Array(await f.arrayBuffer()) });
    };
    document.body.appendChild(input);
    input.click();
  });
}

export const PROJECT_TYPE: FileType = { description: 'Vektordesign-Projekt', mime: 'application/json', ext: 'vdp' };
export const SVG_TYPE: FileType = { description: 'SVG-Grafik', mime: 'image/svg+xml', ext: 'svg' };
export const PNG_TYPE: FileType = { description: 'PNG-Bild', mime: 'image/png', ext: 'png' };
export const PDF_TYPE: FileType = { description: 'PDF-Dokument', mime: 'application/pdf', ext: 'pdf' };
export const EPS_TYPE: FileType = { description: 'EPS-Grafik', mime: 'application/postscript', ext: 'eps' };
export const ZIP_TYPE: FileType = { description: 'ZIP-Paket', mime: 'application/zip', ext: 'zip' };
export const TEMPLATE_TYPE: FileType = { description: 'PDF-Vorlage', mime: 'application/pdf', ext: 'pdf' };
export const AI_TYPE: FileType = { description: 'Illustrator-Datei (PDF-kompatibel)', mime: 'application/postscript', ext: 'ai' };
export const DXF_TYPE: FileType = { description: 'DXF-Zeichnung', mime: 'application/dxf', ext: 'dxf' };

/** Dateiname ohne verbotene Zeichen. */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Unbenannt';
}
