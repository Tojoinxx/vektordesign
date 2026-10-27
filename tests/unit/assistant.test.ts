import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { Agent, type ChatEntry } from '../../src/assistant/agent';
import { runTool, type AgentHost } from '../../src/assistant/tools';
import type { ContentBlock } from '../../src/assistant/api';
import { localSuggestions } from '../../src/design/suggestions';
import { exportSvg } from '../../src/export/svg';

function host(ed: Awaited<ReturnType<typeof makeEditor>>): AgentHost {
  return { editor: ed, renderPreview: async () => ({ base64: 'AAAA' }), openExport: () => {}, fitView: () => {} };
}

/** Simuliert die Claude-API mit festen Antworten und protokolliert die Anfragen. */
function fakeApi(responses: { content: ContentBlock[]; stop_reason: string }[]) {
  const requests: { headers: Record<string, string>; body: { messages: { role: string; content: unknown }[]; tools?: unknown[]; system?: unknown } }[] = [];
  let i = 0;
  const fetchImpl = (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
    requests.push({ headers: init.headers, body: JSON.parse(init.body) });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify({ id: `msg_${i}`, ...r }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

describe('Claude-Assistent', () => {
  it('führt Werkzeugaufrufe aus und fasst alles zu einem Rückgängig-Schritt zusammen', async () => {
    const ed = await makeEditor();
    const api = fakeApi([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Ich zeichne das Motiv.' },
          { type: 'tool_use', id: 'tu1', name: 'draw_rectangle', input: { x: 0, y: 0, width: 80, height: 40, anchor: 'center', fill: '#d62828', stroke: 'none' } },
          { type: 'tool_use', id: 'tu2', name: 'draw_circle', input: { cx: 0, cy: 0, diameter: 10, fill: '#ffffff', stroke: 'none' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Fertig: Rechteck 80 × 40 mm mit Kreis Ø10 in der Mitte.' }] },
    ]);
    const entries: ChatEntry[] = [];
    const agent = new Agent(host(ed), { apiKey: () => 'sk-test', model: () => 'claude-sonnet-5-5', onEntry: (e) => entries.push(e), fetchImpl: api.fetchImpl });
    const before = ed.s.past.length;
    await agent.send('Rechteck 80×40 mittig, Kreis Ø10 in die Mitte');

    expect(ed.s.analysis.status).toBe('full');
    expect(ed.s.past.length).toBe(before + 1);
    const { svg } = exportSvg(ed.s.doc);
    expect(svg).toContain('width="80mm" height="40mm"');
    expect(svg).toContain('fill="#d62828"');

    // Anfrage-Format laut API-Doku
    const first = api.requests[0];
    expect(first.headers['x-api-key']).toBe('sk-test');
    expect(first.headers['anthropic-version']).toBe('2023-06-01');
    expect(first.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(first.body.tools?.length).toBeGreaterThan(10);
    // Zweite Anfrage: tool_result-Blöcke direkt nach dem tool_use, in derselben Reihenfolge
    const second = api.requests[1].body.messages;
    const last = second[second.length - 1];
    expect(last.role).toBe('user');
    const results = last.content as { type: string; tool_use_id: string }[];
    expect(results.map((r) => [r.type, r.tool_use_id])).toEqual([
      ['tool_result', 'tu1'],
      ['tool_result', 'tu2'],
    ]);
    expect(entries.map((e) => e.role)).toEqual(['user', 'assistant', 'action', 'action', 'assistant']);

    // Ein Rückgängig nimmt den ganzen Auftrag zurück
    ed.undo();
    expect(Object.keys(ed.s.doc.entities).length).toBe(0);
  });

  it('meldet Werkzeugfehler an Claude zurück statt abzubrechen', async () => {
    const ed = await makeEditor();
    const r = await runTool(host(ed), 'add_dimension', { type: 'diameter', targets: ['gibtsnicht'] });
    expect(r.isError).toBe(true);
    expect(typeof r.content === 'string' && r.content.startsWith('Error:')).toBe(true);
  });

  it('baut geschlossene Formen und Verläufe', async () => {
    const ed = await makeEditor();
    const h = host(ed);
    const star = Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? 12 : 30;
      return [Math.cos(a) * rr, Math.sin(a) * rr];
    });
    const res = await runTool(h, 'draw_polyline', { points: star, closed: true, fill: '#f5c518' });
    expect(res.isError).toBeFalsy();
    const path = Object.values(ed.s.doc.entities).find((e) => e.kind === 'path');
    expect(path?.kind === 'path' && path.closed && path.edges.length).toBe(10);
    const st = await runTool(h, 'set_style', { targets: [path!.id], gradient: { colors: ['#f5c518', '#e8590c'], direction: 'top_to_bottom' } });
    expect(st.isError).toBeFalsy();
    expect(exportSvg(ed.s.doc).svg).toContain('<linearGradient');
    const img = await runTool(h, 'view_image', {});
    expect(Array.isArray(img.content)).toBe(true);
  });

  it('API-Fehler werden verständlich gemeldet', async () => {
    const ed = await makeEditor();
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401 })) as unknown as typeof fetch;
    const entries: ChatEntry[] = [];
    const agent = new Agent(host(ed), { apiKey: () => 'falsch', model: () => 'claude-sonnet-5-5', onEntry: (e) => entries.push(e), fetchImpl });
    await agent.send('Hallo');
    expect(entries[entries.length - 1]).toMatchObject({ role: 'error', text: expect.stringMatching(/API-Schlüssel ist ungültig/) });
    // Gespräch bleibt fortsetzbar (keine halbe Runde im Verlauf)
    expect(agent.messages.length).toBe(0);
  });
});

describe('Stilvorschläge', () => {
  it('liefert mindestens 8 unterschiedliche Vorschläge für die Auswahl', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'corner');
    ed.setStyle([r.pathId!], { fill: '#2f6fd6' });
    const s = localSuggestions(ed.s.doc, [r.pathId!]);
    expect(s.length).toBeGreaterThanOrEqual(8);
    const fills = new Set(s.map((x) => JSON.stringify(x.styles[r.pathId!].fill)));
    expect(fills.size).toBe(s.length);
    // Übernehmen = ein Rückgängig-Schritt
    const n = ed.s.past.length;
    ed.setStyles(s[3].styles);
    expect(ed.s.past.length).toBe(n + 1);
  });
});
