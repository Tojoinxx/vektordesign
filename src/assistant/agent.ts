import { ApiError, callClaude, type ContentBlock, type Message } from './api';
import { runTool, sketchSummary, TOOL_DEFS, type AgentHost } from './tools';

export interface ChatImage {
  id: string;
  name: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  base64: string;
  /** Vorschau-URL (Data-URL) für den Chat */
  url: string;
}

export type ChatEntry =
  | { id: number; role: 'user'; text: string; images: ChatImage[] }
  | { id: number; role: 'assistant'; text: string }
  | { id: number; role: 'action'; text: string; error?: boolean }
  | { id: number; role: 'error'; text: string };

export const SYSTEM_PROMPT = `You are the design assistant inside "Vektordesign", a precise 2D vector program for textile print and cut files (screen printing, DTF, vinyl plotters like Cricut/Silhouette; production via LabwearOS). It works like the Autodesk Inventor sketch mode: rough geometry becomes exact through dimensions and constraints.

Coordinates: millimeters, X to the right, Y UP, origin point "O" at (0,0). A sketch is fully constrained ("vollständig bestimmt") when its degrees of freedom are 0.

How to work:
- Make every change directly in the app with the tools; do not just describe steps.
- For exact sizes use driving dimensions (draw_rectangle/draw_circle create them by default). Center motifs on the origin unless told otherwise; geometry placed exactly on an existing point is attached automatically.
- Use closed polylines for custom shapes (stars, letters, banners, arrows, badges); approximate curves with enough points (24–64 for organic shapes).
- Text: font_size_mm is the em size; capital letters are about 0.7 × that tall.
- Colors as #rrggbb. Gradients via set_style.gradient; "Verblassen" (fade into transparency) = fade: true.
- Stacking: later objects are in front; use arrange to change the order.
- When the user attaches images: study shapes, colors, proportions and layering, then rebuild the motif as clean vector geometry with the tools (simplify photos and complex art into flat shapes). If no size is given, use sensible print sizes (left chest ≈ 80–100 mm wide, front ≈ 250–300 mm).
- After visual design work, call view_image once to check the result and fix obvious problems.
- If a tool returns an error (for example over-constrained), adapt instead of repeating the same call.
- Production hints: lines thinner than 0.5 mm may not print or cut reliably; for vinyl cutting prefer closed filled shapes.

Reply in the user's language (German unless they write otherwise), briefly: 1–3 sentences on what you did and anything to check. You cannot save or export files yourself; use open_export_dialog so the user can save.`;

const MAX_STEPS = 24;
const SUMMARY_LIMIT = 7000;

export interface AgentOptions {
  apiKey: () => string;
  model: () => string;
  onEntry: (e: ChatEntry) => void;
  onBusy?: (busy: boolean) => void;
  fetchImpl?: typeof fetch;
}

let entryId = 1;

type NewEntry = ChatEntry extends infer T ? (T extends { id: number } ? Omit<T, 'id'> : never) : never;

/** Gesprächsführung mit Werkzeugschleife. Ein Auftrag = ein Rückgängig-Schritt. */
export class Agent {
  messages: Message[] = [];
  private abort: AbortController | null = null;

  constructor(
    private host: AgentHost,
    private opts: AgentOptions,
  ) {}

  get busy(): boolean {
    return this.abort !== null;
  }

  reset(): void {
    this.stop();
    this.messages = [];
  }

  stop(): void {
    this.abort?.abort();
  }

  private emit(e: NewEntry): void {
    this.opts.onEntry({ ...e, id: entryId++ } as ChatEntry);
  }

  /** Entfernt Bilder aus älteren Nachrichten (spart Tokens bei Folgefragen). */
  private pruneImages(): void {
    const strip = (c: ContentBlock[]): ContentBlock[] =>
      c.map((b) => {
        if (b.type === 'image') return { type: 'text', text: '[Bild aus früherer Nachricht entfernt]' };
        if (b.type === 'tool_result' && Array.isArray(b.content)) return { ...b, content: strip(b.content) };
        return b;
      });
    this.messages = this.messages.map((m) => (Array.isArray(m.content) ? { ...m, content: strip(m.content) } : m));
  }

  async send(text: string, images: ChatImage[] = []): Promise<void> {
    if (this.abort) return;
    const ed = this.host.editor;
    this.emit({ role: 'user', text, images });
    this.pruneImages();
    const summary = JSON.stringify(sketchSummary(ed.s.doc, ed.s.analysis, ed.s.selection));
    const context =
      summary.length <= SUMMARY_LIMIT
        ? `<current_sketch>${summary}</current_sketch>`
        : `<current_sketch_status>${ed.s.analysis.label}; ${Object.keys(ed.s.doc.entities).length} objects – call get_sketch for details</current_sketch_status>`;
    const content: ContentBlock[] = [
      ...images.map((img): ContentBlock => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType as 'image/png', data: img.base64 } })),
      { type: 'text', text: `${text || '(siehe Bilder)'}\n\n${context}` },
    ];
    this.messages.push({ role: 'user', content });
    const ac = new AbortController();
    this.abort = ac;
    this.opts.onBusy?.(true);
    ed.beginTransaction(`Claude: ${text.slice(0, 40) || 'Bild nachbauen'}`);
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const res = await callClaude({
          apiKey: this.opts.apiKey(),
          model: this.opts.model(),
          system: SYSTEM_PROMPT,
          messages: this.messages,
          tools: TOOL_DEFS,
          maxTokens: 4096,
          signal: ac.signal,
          fetchImpl: this.opts.fetchImpl,
        });
        this.messages.push({ role: 'assistant', content: res.content });
        for (const b of res.content) if (b.type === 'text' && b.text.trim()) this.emit({ role: 'assistant', text: b.text.trim() });
        if (res.stop_reason === 'max_tokens') {
          this.emit({ role: 'error', text: 'Die Antwort wurde abgeschnitten (zu lang). Bitte den Auftrag aufteilen.' });
        }
        if (res.stop_reason === 'refusal') {
          this.emit({ role: 'error', text: 'Claude hat diese Anfrage abgelehnt.' });
        }
        const uses = res.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
        if (res.stop_reason !== 'tool_use' || !uses.length) break;
        const results: ContentBlock[] = [];
        for (const u of uses) {
          if (ac.signal.aborted) break;
          const run = await runTool(this.host, u.name, u.input ?? {});
          this.emit({ role: 'action', text: run.summary, error: run.isError });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: run.content, ...(run.isError ? { is_error: true } : {}) });
        }
        if (ac.signal.aborted) {
          // Gespräch gültig halten: offene Werkzeugaufrufe beantworten
          for (const u of uses.slice(results.length)) results.push({ type: 'tool_result', tool_use_id: u.id, content: 'Cancelled by the user.', is_error: true });
          this.messages.push({ role: 'user', content: results });
          this.emit({ role: 'error', text: 'Abgebrochen.' });
          break;
        }
        this.messages.push({ role: 'user', content: results });
        if (step === MAX_STEPS - 1) this.emit({ role: 'error', text: 'Der Auftrag war zu umfangreich und wurde nach vielen Schritten angehalten.' });
      }
    } catch (e) {
      const msg = e instanceof ApiError || e instanceof Error ? e.message : String(e);
      this.emit({ role: 'error', text: msg });
      // Letzte unvollständige Runde entfernen, damit das Gespräch fortgesetzt werden kann
      const last = this.messages[this.messages.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.some((b) => b.type === 'image' || b.type === 'text')) {
        this.messages.pop();
      } else if (last?.role === 'assistant') {
        this.messages.pop();
        const prev = this.messages[this.messages.length - 1];
        if (prev?.role === 'user') this.messages.pop();
      }
    } finally {
      const n = ed.endTransaction();
      if (n > 0) ed.toast(`Claude hat ${n} Änderung${n === 1 ? '' : 'en'} vorgenommen – Strg+Z macht alles rückgängig.`, 'success', 3500);
      this.abort = null;
      this.opts.onBusy?.(false);
    }
  }
}
