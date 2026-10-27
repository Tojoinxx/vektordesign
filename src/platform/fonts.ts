import { isTauri } from './files';

/**
 * Installierte Schriftarten.
 * - Desktop: Liste aus dem Betriebssystem (Rust-Befehl list_fonts)
 * - Chromium-Browser: Local Font Access API (fragt einmal um Erlaubnis)
 * - sonst: bekannte Schriften, die auf diesem Gerät tatsächlich vorhanden sind
 */

const COMMON = [
  'Arial',
  'Arial Black',
  'Bahnschrift',
  'Calibri',
  'Cambria',
  'Candara',
  'Comic Sans MS',
  'Consolas',
  'Constantia',
  'Corbel',
  'Courier New',
  'Franklin Gothic Medium',
  'Gabriola',
  'Georgia',
  'Gill Sans',
  'Helvetica',
  'Helvetica Neue',
  'IBM Plex Sans',
  'Impact',
  'Lucida Console',
  'Palatino Linotype',
  'Segoe Print',
  'Segoe Script',
  'Segoe UI',
  'Tahoma',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  'Avenir',
  'Avenir Next',
  'Futura',
  'Didot',
  'Optima',
  'Menlo',
  'Marker Felt',
  'Chalkboard SE',
  'American Typewriter',
  'Copperplate',
  'Rockwell',
];

let cache: string[] | null = null;

function isAvailable(name: string): boolean {
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas').getContext('2d');
  if (!c) return false;
  const sample = 'mmmmmmmmmmlliWW@#0123';
  return ['monospace', 'serif', 'sans-serif'].some((base) => {
    c.font = `72px ${base}`;
    const w0 = c.measureText(sample).width;
    c.font = `72px "${name}", ${base}`;
    return c.measureText(sample).width !== w0;
  });
}

export async function listFonts(askPermission = false): Promise<string[]> {
  if (cache) return cache;
  let names: string[] = [];
  if (isTauri()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      names = await invoke<string[]>('list_fonts');
    } catch {
      names = [];
    }
  }
  const w = window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> };
  if (!names.length && askPermission && w.queryLocalFonts) {
    try {
      const fonts = await w.queryLocalFonts();
      names = fonts.map((f) => f.family);
    } catch {
      names = [];
    }
  }
  if (!names.length) names = COMMON.filter(isAvailable);
  if (!names.includes('IBM Plex Sans')) names.push('IBM Plex Sans');
  cache = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'de'));
  return cache;
}

export function resetFontCache(): void {
  cache = null;
}
