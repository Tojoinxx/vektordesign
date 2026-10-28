import { describe, expect, it } from 'vitest';
import { makeEditor } from './helpers';
import { runPreflight, thinParts } from '../../src/model/preflight';

const rect = (x: number, y: number, w: number, h: number) => [
  [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
];

describe('Preflight je Veredelungsart', () => {
  it('findet schmale Stege per Öffnen, ignoriert breite Flächen', () => {
    expect(thinParts(rect(0, 0, 20, 10), 1)).toHaveLength(0);
    // 20 × 10 mit 0,4 mm breitem Steg daneben
    const poly = [...rect(0, 0, 20, 10), ...rect(20, 4.8, 10, 0.4)];
    const t = thinParts(poly, 1);
    expect(t.length).toBeGreaterThan(0);
  });

  it('Stick: zu dünne Kontur, zu kleine Schrift, Verlauf → Fehler; Siebdruck ohne Probleme bei kräftiger Form', async () => {
    const ed = await makeEditor();
    const r = ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'corner');
    ed.setStyle([r.pathId!], { fill: '#1f3a93', stroke: '#ffffff', strokeWidth: 0.3 });
    const t = ed.createText({ pos: { x: 0, y: 30 } }, 'klein', { fontSize: 4 });
    const res = runPreflight(ed.s.doc, 'embroidery');
    const msgs = res.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/Konturen dünner als 1 mm/);
    expect(msgs).toMatch(/Schrift zu klein/);
    expect(res.issues.find((i) => /Schrift/.test(i.message))?.ids).toContain(t.textId);
    ed.setStyle([r.pathId!], { stroke: null });
    ed.deleteIds([t.textId!]);
    const ok = runPreflight(ed.s.doc, 'screen');
    expect(ok.issues).toHaveLength(1);
    expect(ok.issues[0].severity).toBe('info');
  });

  it('Plotter: offene Linien und überlappende gleichfarbige Formen', async () => {
    const ed = await makeEditor();
    const a = ed.createCircle({ pos: { x: 0, y: 0 } }, 10);
    const b = ed.createCircle({ pos: { x: 12, y: 0 } }, 10);
    ed.setStyle([a.circleId!, b.circleId!], { fill: '#000000', stroke: null });
    ed.createLine({ pos: { x: -30, y: -20 } }, { pos: { x: 30, y: -20 } }, {});
    const res = runPreflight(ed.s.doc, 'flex');
    const msgs = res.issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/offene Kontur/);
    expect(msgs).toMatch(/überlappen/);
  });
});
