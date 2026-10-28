import type { Id } from '../model/types';
import { SYSTEM_PROMPT } from './agent';
import { runTool, sketchSummary, TOOL_DEFS, type AgentHost } from './tools';

/**
 * Claude ohne API-Schlüssel: Die App erzeugt einen Auftrag zum Kopieren (Anleitung, Werkzeuge,
 * aktuelle Zeichnung, Wunsch). In claude.ai (Abo) eingefügt, antwortet Claude mit einem
 * Befehlsskript, das die App hier ausführt – mit denselben Werkzeugen wie der Assistent.
 */

/** Werkzeuge, die im Skript keinen Sinn ergeben (brauchen eine Rückmeldung) */
const SKIP = new Set(['get_sketch', 'view_image', 'undo']);

export interface ScriptStep {
  tool: string;
  input: Record<string, unknown>;
}

export function buildBridgePrompt(host: AgentHost, request: string): string {
  const ed = host.editor;
  const tools = TOOL_DEFS.filter((t) => !SKIP.has(t.name)).map((t) => ({ name: t.name, description: t.description, input: t.input_schema }));
  const sketch = sketchSummary(ed.s.doc, ed.s.analysis, ed.s.selection);
  return `${SYSTEM_PROMPT.replace(/- After visual design work, call view_image.*\n/, '').replace('Make every change directly in the app with the tools; do not just describe steps.', 'You cannot call the tools yourself here. Instead, answer with ONE script the app will run.')}

## How to answer (important)
Reply with a short German sentence, then exactly one fenced code block with the language tag \`vektordesign\` containing a JSON array of steps:
\`\`\`vektordesign
[
  { "tool": "draw_rectangle", "input": { "x": 0, "y": 0, "width": 80, "height": 40, "anchor": "center", "fill": "#1f3a93" } },
  { "tool": "draw_circle", "input": { "cx": 0, "cy": 0, "diameter": 10, "fill": "#f5c518" } },
  { "tool": "add_constraint", "input": { "type": "concentric", "targets": ["$2", "$1.center"] } }
]
\`\`\`
- Steps run in order as one undo step. Use only the tools listed below with their input fields.
- To refer to an object created by an earlier step, write "$N" (N = step number, starting at 1); "$N.center" is the center point of a rectangle/circle created in step N. Existing objects keep their ids from the sketch below.
- You get no feedback between steps, so keep coordinates consistent and prefer tools that create dimensions directly.
- If the user attached images in this chat, rebuild them as clean vector shapes.

## Tools
${JSON.stringify(tools)}

## Current sketch
${JSON.stringify(sketch)}

## User request
${request.trim() || '(siehe angehängtes Bild)'}`;
}

export class ScriptError extends Error {}

/** Skript aus der Antwort lesen (Codeblock „vektordesign“ oder erstes JSON-Array). */
export function parseScript(reply: string): ScriptStep[] {
  const fenced = reply.match(/```(?:vektordesign|json)?\s*\n([\s\S]*?)```/);
  let raw = fenced ? fenced[1] : reply;
  if (!fenced) {
    const a = reply.indexOf('[');
    const b = reply.lastIndexOf(']');
    if (a < 0 || b <= a) throw new ScriptError('In der Antwort steht kein Befehlsskript (JSON-Liste in einem ```vektordesign-Block).');
    raw = reply.slice(a, b + 1);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new ScriptError(`Das Skript ist kein gültiges JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const arr = Array.isArray(data) ? data : (data as { steps?: unknown })?.steps;
  if (!Array.isArray(arr) || !arr.length) throw new ScriptError('Das Skript enthält keine Schritte.');
  return arr.map((s, i) => {
    const st = s as { tool?: unknown; name?: unknown; input?: unknown };
    const tool = typeof st.tool === 'string' ? st.tool : typeof st.name === 'string' ? st.name : '';
    if (!tool) throw new ScriptError(`Schritt ${i + 1}: Werkzeugname fehlt.`);
    return { tool, input: st.input && typeof st.input === 'object' ? (st.input as Record<string, unknown>) : {} };
  });
}

export interface ScriptReport {
  done: number;
  failed: number;
  lines: { text: string; error: boolean }[];
}

/** Führt ein Skript als einen Rückgängig-Schritt aus. */
export async function runScript(host: AgentHost, steps: ScriptStep[]): Promise<ScriptReport> {
  const ed = host.editor;
  const created: { main: Id | null; center: Id | null }[] = [];
  const report: ScriptReport = { done: 0, failed: 0, lines: [] };
  const resolve = (v: unknown): unknown => {
    if (typeof v === 'string') {
      const m = v.match(/^\$(\d+)(?:\.(center))?$/);
      if (m) {
        const c = created[Number(m[1]) - 1];
        if (!c) throw new ScriptError(`Verweis ${v} zeigt auf keinen früheren Schritt.`);
        const id = m[2] ? c.center : c.main;
        if (!id) throw new ScriptError(`Schritt ${m[1]} hat ${m[2] ? 'keinen Mittelpunkt' : 'kein Objekt'} erzeugt.`);
        return id;
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(resolve);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
    return v;
  };
  ed.beginTransaction('Claude (Abo)');
  try {
    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      const before = new Set(Object.keys(ed.s.doc.entities));
      const beforePts = new Set(Object.keys(ed.s.doc.points));
      if (SKIP.has(st.tool)) {
        created.push({ main: null, center: null });
        continue;
      }
      let input: Record<string, unknown>;
      try {
        input = resolve(st.input) as Record<string, unknown>;
      } catch (e) {
        report.failed++;
        report.lines.push({ text: `Schritt ${i + 1}: ${e instanceof Error ? e.message : String(e)}`, error: true });
        created.push({ main: null, center: null });
        continue;
      }
      if (!TOOL_DEFS.some((t) => t.name === st.tool)) {
        report.failed++;
        report.lines.push({ text: `Schritt ${i + 1}: unbekanntes Werkzeug „${st.tool}“`, error: true });
        created.push({ main: null, center: null });
        continue;
      }
      const run = await runTool(host, st.tool, input);
      const doc = ed.s.doc;
      const fresh = Object.keys(doc.entities).filter((id) => !before.has(id));
      const main = fresh.find((id) => doc.entities[id].kind === 'path') ?? fresh.find((id) => doc.entities[id].kind !== 'line') ?? fresh[0] ?? null;
      const circle = fresh.map((id) => doc.entities[id]).find((e) => e.kind === 'circle');
      const freePt = Object.keys(doc.points).find((id) => !beforePts.has(id) && doc.points[id].construction && (!doc.points[id].owner || doc.points[id].owner === main));
      created.push({ main, center: circle?.kind === 'circle' ? circle.center : (freePt ?? null) });
      if (run.isError) report.failed++;
      else report.done++;
      report.lines.push({ text: run.summary, error: !!run.isError });
    }
  } finally {
    ed.endTransaction();
  }
  return report;
}
