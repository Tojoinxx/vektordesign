import { describe, expect, it } from 'vitest';
import { LOW_CONTRAST, paintContrast } from '../../src/render/drawDesign';
import { DARK_CANVAS, LIGHT_CANVAS, THEME, canvasMode, setCanvasMode } from '../../src/render/theme';
import { DEFAULT_APPEARANCE, loadAppearance, resolveCanvas, resolveTheme } from '../../src/ui/appearance';
import type { Entity, Style } from '../../src/model/types';

const circle = (style: Partial<Style>): Entity =>
  ({ id: 'c1', kind: 'circle', center: 'p1', r: 5, construction: false, style: { fill: null, stroke: null, strokeWidth: 0.5, opacity: 1, ...style } }) as Entity;

describe('Dunkles Design', () => {
  it('ist Standard und lässt die Zeichenfläche unabhängig umschalten', () => {
    // In Node gibt es keinen Speicher: Standardwerte
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
    expect(DEFAULT_APPEARANCE.theme).toBe('dark');
    expect(resolveTheme('dark')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveCanvas({ theme: 'dark', canvas: 'auto' })).toBe('dark');
    expect(resolveCanvas({ theme: 'dark', canvas: 'light' })).toBe('light');
    expect(resolveCanvas({ theme: 'light', canvas: 'dark' })).toBe('dark');
  });

  it('schaltet die Farben der Zeichenfläche an Ort und Stelle um', () => {
    setCanvasMode('dark');
    expect(canvasMode()).toBe('dark');
    expect(THEME.paper).toBe(DARK_CANVAS.paper);
    expect(THEME.tapeInk).toBe('#f5c518');
    setCanvasMode('light');
    expect(THEME.paper).toBe(LIGHT_CANVAS.paper);
    expect(THEME.tape).toBe('#f5c518');
    // Beide Varianten haben dieselben Schlüssel
    expect(Object.keys(DARK_CANVAS).sort()).toEqual(Object.keys(LIGHT_CANVAS).sort());
  });

  it('erkennt Motive, die sich kaum vom Hintergrund abheben (Hilfsumriss nur am Bildschirm)', () => {
    const dark = DARK_CANVAS.paper;
    const light = LIGHT_CANVAS.paper;
    // Schwarze Kontur auf dunkler Fläche: kaum sichtbar
    expect(paintContrast(circle({ stroke: '#1e2328' }), dark)).toBeLessThan(LOW_CONTRAST);
    // Weiße Füllung auf dunkler Fläche: gut sichtbar, auf weißer Fläche nicht
    expect(paintContrast(circle({ fill: '#ffffff' }), dark)).toBeGreaterThan(LOW_CONTRAST);
    expect(paintContrast(circle({ fill: '#ffffff' }), light)).toBeLessThan(LOW_CONTRAST);
    // Fast durchsichtig zählt als unsichtbar
    expect(paintContrast(circle({ fill: '#ffffff', opacity: 0.05 }), dark)).toBeLessThan(LOW_CONTRAST);
    // Verlauf: eine sichtbare Stufe reicht
    const grad = { kind: 'linear' as const, from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, stops: [{ offset: 0, color: '#111111', opacity: 1 }, { offset: 1, color: '#f5c518', opacity: 1 }] };
    expect(paintContrast(circle({ fill: grad }), dark)).toBeGreaterThan(LOW_CONTRAST);
    // Ohne Farbe gar nicht sichtbar
    expect(paintContrast(circle({}), dark)).toBe(1);
  });
});
