import { setCanvasMode, type CanvasMode } from '../render/theme';
import { isTauri } from '../platform/files';

/**
 * Erscheinungsbild: Design der Oberfläche (dunkel, hell oder wie das System) und, unabhängig
 * davon, die Zeichenfläche. Eine helle Zeichenfläche im dunklen Design hilft bei dunklen Motiven.
 * Gespeichert pro Gerät; Standard ist das dunkle Design.
 */

export type ThemePref = 'dark' | 'light' | 'system';
export type CanvasPref = 'auto' | 'dark' | 'light';

export interface Appearance {
  theme: ThemePref;
  canvas: CanvasPref;
}

export const DEFAULT_APPEARANCE: Appearance = { theme: 'dark', canvas: 'auto' };

export const THEME_LABELS: Record<ThemePref, string> = { dark: 'Dunkel', light: 'Hell', system: 'Wie System' };
export const CANVAS_LABELS: Record<CanvasPref, string> = { auto: 'Passend', dark: 'Dunkel', light: 'Hell' };

const KEY = 'vd.appearance';

export function loadAppearance(): Appearance {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Appearance> | null;
    const theme = raw?.theme && raw.theme in THEME_LABELS ? raw.theme : DEFAULT_APPEARANCE.theme;
    const canvas = raw?.canvas && raw.canvas in CANVAS_LABELS ? raw.canvas : DEFAULT_APPEARANCE.canvas;
    return { theme, canvas };
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: Appearance): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // Speichern ist bestmöglich
  }
}

const darkQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

export function resolveTheme(theme: ThemePref): CanvasMode {
  if (theme === 'system') return darkQuery?.matches === false ? 'light' : 'dark';
  return theme;
}

export function resolveCanvas(a: Appearance): CanvasMode {
  return a.canvas === 'auto' ? resolveTheme(a.theme) : a.canvas;
}

/** Wendet das Erscheinungsbild auf Seite, Zeichenfläche und Fenster an. */
export function applyAppearance(a: Appearance): { ui: CanvasMode; canvas: CanvasMode } {
  const ui = resolveTheme(a.theme);
  const canvas = resolveCanvas(a);
  setCanvasMode(canvas);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.theme = ui;
    root.dataset.canvas = canvas;
    const bar = getComputedStyle(root).getPropertyValue('--chrome').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bar || (ui === 'dark' ? '#1f2328' : '#ffffff'));
  }
  void syncWindowTheme(ui);
  return { ui, canvas };
}

/** Titelleiste der Desktop-App passend einfärben (Windows/macOS). */
async function syncWindowTheme(ui: CanvasMode): Promise<void> {
  if (!isTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTheme(ui);
  } catch (e) {
    console.warn('Fensterfarbe konnte nicht gesetzt werden', e);
  }
}

/** Meldet Wechsel des System-Designs (nur relevant bei „Wie System“). */
export function onSystemThemeChange(cb: () => void): () => void {
  if (!darkQuery) return () => {};
  darkQuery.addEventListener('change', cb);
  return () => darkQuery.removeEventListener('change', cb);
}
