import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { buildBridgePrompt, parseScript, runScript } from '../../src/assistant/bridge';
import type { AgentHost } from '../../src/assistant/tools';

const host = (ed: Awaited<ReturnType<typeof makeEditor>>): AgentHost => ({ editor: ed, renderPreview: async () => null, openExport: () => {}, fitView: () => {} });

describe('Claude ohne API-Schlüssel (Abo-Brücke)', () => {
  it('Auftrag enthält Anleitung, Werkzeuge, Zeichnung und Wunsch', async () => {
    const ed = await makeEditor();
    const p = buildBridgePrompt(host(ed), 'Badge Ø60');
    expect(p).toContain('```vektordesign');
    expect(p).toContain('draw_circle');
    expect(p).toContain('## Current sketch');
    expect(p).toContain('Badge Ø60');
    expect(p).not.toContain('"name":"view_image"');
  });

  it('liest das Skript aus der Antwort und führt es als einen Rückgängig-Schritt aus – mit $-Verweisen', async () => {
    const ed = await makeEditor();
    const reply = `Hier ist dein Motiv:
\`\`\`vektordesign
[
  { "tool": "draw_rectangle", "input": { "x": 0, "y": 0, "width": 80, "height": 40, "anchor": "center", "fill": "#1f3a93" } },
  { "tool": "draw_circle", "input": { "cx": 5, "cy": 3, "diameter": 10, "fill": "#f5c518" } },
  { "tool": "add_constraint", "input": { "type": "concentric", "targets": ["$2", "$1.center"] } }
]
\`\`\``;
    const steps = parseScript(reply);
    expect(steps).toHaveLength(3);
    const rep = await runScript(host(ed), steps);
    expect(rep.failed).toBe(0);
    const doc = ed.s.doc;
    const circle = Object.values(doc.entities).find((e) => e.kind === 'circle');
    expect(circle && circle.kind === 'circle' && Math.abs(doc.points[circle.center].x) < 1e-6).toBe(true);
    expect(ed.s.analysis.status).toBe('full');
    await ed.undo();
    expect(Object.keys(ed.s.doc.entities)).toHaveLength(0);
  });

  it('verständliche Fehler bei kaputter Antwort', () => {
    expect(() => parseScript('Ich habe nichts gemacht.')).toThrow(/kein Befehlsskript/);
    expect(() => parseScript('```vektordesign\n[{"tool": ]\n```')).toThrow(/kein gültiges JSON/);
  });
});
