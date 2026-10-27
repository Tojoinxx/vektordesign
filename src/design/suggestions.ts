import { produce } from 'immer';
import type { Id, SketchDoc, Style } from '../model/types';
import { hexToRgb, hsvToRgb, luminance, rgbToHex, rgbToHsv, normalizeHex } from '../model/color';
import { fadeGradient, makeGradient, paintColor } from '../model/paint';
import { callClaude, type ToolDef } from '../assistant/api';
import { gradientFromInput } from '../assistant/tools';

/** Ein Stilvorschlag: neuer Stil je Zielobjekt. */
export interface StyleSuggestion {
  id: string;
  name: string;
  styles: Record<Id, Style>;
  source: 'local' | 'ai';
}

const hsv = (h: number, s: number, v: number) => rgbToHex(hsvToRgb({ h: ((h % 360) + 360) % 360, s, v }));

function baseColor(doc: SketchDoc, targets: Id[]): string {
  for (const id of targets) {
    const e = doc.entities[id];
    const c = paintColor(e?.style.fill) ?? e?.style.stroke;
    if (c && c !== '#ffffff' && c !== '#000000' && c !== '#1e2328') return c;
  }
  for (const id of targets) {
    const e = doc.entities[id];
    const c = paintColor(e?.style.fill) ?? e?.style.stroke;
    if (c) return c;
  }
  return '#2f6fd6';
}

/**
 * Lokale (offline) Vorschläge aus Farbharmonien und druckfreundlichen Varianten.
 * Bei mehreren Objekten werden Farben über die Objekte verteilt.
 */
export function localSuggestions(doc: SketchDoc, targets: Id[]): StyleSuggestion[] {
  if (!targets.length) return [];
  const base = baseColor(doc, targets);
  const { h, s, v } = rgbToHsv(hexToRgb(base));
  const sat = Math.max(s, 55);
  const val = Math.max(v, 55);
  const dark = luminance(base) < 0.35;
  const n = targets.length;

  type Maker = (i: number, cur: Style) => Style;
  const variants: { name: string; make: Maker }[] = [
    { name: 'Kräftig', make: (i, c) => ({ ...c, fill: hsv(h + i * 25, 88, 88), stroke: null }) },
    {
      name: n > 1 ? 'Harmonie (Dreiklang)' : 'Komplementär',
      make: (i, c) => ({ ...c, fill: n > 1 ? hsv(h + i * 120, sat, val) : hsv(h + 180, sat, val), stroke: null }),
    },
    {
      name: 'Farbverlauf',
      make: (i, c) => ({
        ...c,
        fill: makeGradient(
          [
            { offset: 0, color: hsv(h + i * 20, sat, val), opacity: 1 },
            { offset: 1, color: hsv(h + 45 + i * 20, Math.min(100, sat + 10), Math.min(100, val + 10)), opacity: 1 },
          ],
          'lr',
        ),
        stroke: null,
      }),
    },
    { name: 'Verblassen', make: (i, c) => ({ ...c, fill: fadeGradient(hsv(h + i * 20, sat, val), 'tb'), stroke: null }) },
    { name: 'Nur Kontur', make: (i, c) => ({ ...c, fill: null, stroke: hsv(h + i * 20, sat, Math.min(val, 80)), strokeWidth: 1.2, lineCap: 'round' }) },
    { name: 'Kontrastrand', make: (i, c) => ({ ...c, fill: hsv(h + i * 20, sat, val), stroke: dark ? '#ffffff' : '#1e2328', strokeWidth: 0.8 }) },
    { name: 'Vintage', make: (i, c) => ({ ...c, fill: hsv(h * 0.6 + 18 + i * 15, Math.min(s, 45) * 0.8 + 10, 72), stroke: null, opacity: 0.92 }) },
    { name: 'Pastell', make: (i, c) => ({ ...c, fill: hsv(h + i * 40, 28, 97), stroke: null }) },
    { name: 'Neon', make: (i, c) => ({ ...c, fill: hsv(h + i * 60, 100, 100), stroke: '#1e2328', strokeWidth: 0.6 }) },
    { name: 'Siebdruck 1-farbig', make: (_i, c) => ({ ...c, fill: '#111111', stroke: null, opacity: 1 }) },
  ];

  return variants.map((vnt, k) => {
    const styles: Record<Id, Style> = {};
    targets.forEach((id, i) => {
      const e = doc.entities[id];
      if (!e) return;
      const next = vnt.make(i, { ...e.style, opacity: 1, dash: 'solid' });
      // Offene Linien haben keine Füllung → Farbe in die Kontur legen
      if (e.kind === 'line' || (e.kind === 'path' && !e.closed)) {
        styles[id] = { ...next, fill: null, stroke: paintColor(next.fill) ?? next.stroke ?? base, strokeWidth: Math.max(next.strokeWidth, 0.8) };
      } else styles[id] = next;
    });
    return { id: `local-${k}`, name: vnt.name, styles, source: 'local' as const };
  });
}

/** Dokument mit angewendetem Vorschlag (für Vorschaubilder). */
export function previewDoc(doc: SketchDoc, s: StyleSuggestion): SketchDoc {
  return produce(doc, (d) => {
    for (const [id, st] of Object.entries(s.styles)) {
      const e = d.entities[id];
      if (e) e.style = st;
    }
  });
}

// ---------------------------------------------------------------------------
// KI-Vorschläge (Claude)
// ---------------------------------------------------------------------------

const PROPOSE_TOOL: ToolDef = {
  name: 'propose_styles',
  description: 'Return distinct style suggestions for the given objects.',
  input_schema: {
    type: 'object',
    properties: {
      suggestions: {
        type: 'array',
        minItems: 8,
        maxItems: 10,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'German name, 1–3 words' },
            objects: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  index: { type: 'integer' },
                  fill: { type: 'string', description: '#rrggbb or none' },
                  gradient: {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['linear', 'radial'] },
                      colors: { type: 'array', items: { type: 'string' } },
                      direction: { type: 'string', enum: ['left_to_right', 'right_to_left', 'top_to_bottom', 'bottom_to_top', 'center'] },
                      fade: { type: 'boolean' },
                    },
                    required: ['colors'],
                  },
                  stroke: { type: 'string', description: '#rrggbb or none' },
                  stroke_width: { type: 'number', description: 'mm' },
                  opacity: { type: 'number' },
                },
                required: ['index'],
              },
            },
          },
          required: ['name', 'objects'],
        },
      },
    },
    required: ['suggestions'],
  },
};

export async function aiSuggestions(
  doc: SketchDoc,
  targets: Id[],
  keyword: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<StyleSuggestion[]> {
  const objs = targets.map((id, index) => {
    const e = doc.entities[id];
    return {
      index,
      type: e.kind === 'path' ? 'shape' : e.kind,
      ...(e.kind === 'text' ? { text: e.text, font: e.fontFamily } : {}),
      fill: e.style.fill === null ? 'none' : typeof e.style.fill === 'string' ? e.style.fill : 'gradient',
      stroke: e.style.stroke ?? 'none',
    };
  });
  const res = await callClaude({
    apiKey,
    model,
    system:
      'You are a graphic designer for apparel prints (screen printing, DTF, vinyl). Propose varied, tasteful, print-friendly color and style treatments. Keep contrast readable on typical garment colors. Use gradients and fades only where they add value.',
    messages: [
      {
        role: 'user',
        content: `Objects: ${JSON.stringify(objs)}\nStyle wish: ${keyword.trim() || 'surprise me – a varied set'}\nGive 8–10 distinct suggestions; every suggestion must style every object index.`,
      },
    ],
    tools: [PROPOSE_TOOL],
    toolChoice: { type: 'tool', name: 'propose_styles' },
    maxTokens: 3000,
    signal,
  });
  const use = res.content.find((b) => b.type === 'tool_use');
  if (!use || use.type !== 'tool_use') throw new Error('Claude hat keine Vorschläge geliefert.');
  const list = (use.input.suggestions as { name?: string; objects?: Record<string, unknown>[] }[]) ?? [];
  const out: StyleSuggestion[] = [];
  list.forEach((sug, k) => {
    const styles: Record<Id, Style> = {};
    for (const o of sug.objects ?? []) {
      const idx = Number(o.index);
      const id = targets[idx];
      const e = id ? doc.entities[id] : undefined;
      if (!e) continue;
      const st: Style = { ...e.style };
      try {
        if (o.gradient && typeof o.gradient === 'object') st.fill = gradientFromInput(o.gradient as Record<string, unknown>);
        else if (typeof o.fill === 'string') st.fill = o.fill === 'none' ? null : normalizeHex(o.fill) ?? st.fill;
      } catch {
        /* ungültiger Verlauf → Füllung behalten */
      }
      if (typeof o.stroke === 'string') st.stroke = o.stroke === 'none' ? null : normalizeHex(o.stroke) ?? st.stroke;
      if (typeof o.stroke_width === 'number') st.strokeWidth = Math.max(0, Math.min(10, o.stroke_width));
      if (typeof o.opacity === 'number') st.opacity = Math.max(0.05, Math.min(1, o.opacity));
      styles[id] = st;
    }
    if (Object.keys(styles).length) out.push({ id: `ai-${k}-${Date.now()}`, name: String(sug.name ?? `Vorschlag ${k + 1}`).slice(0, 28), styles, source: 'ai' });
  });
  if (!out.length) throw new Error('Claude hat keine verwendbaren Vorschläge geliefert.');
  return out;
}
