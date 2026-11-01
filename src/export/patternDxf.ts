import type { SketchDoc, Vec2 } from '../model/types';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import { bboxAddPoint, emptyBBox, norm, perp, sub } from '../model/geometry';
import { grainLine, pieceGeom, seamAllowanceOutline, seamsAt, type PieceGeom } from '../pattern/geometry';
import { ROLE_NAMES, sizeName } from '../store/patternOps';
import { ExportError } from './scene';

/**
 * Schnittteile als DXF (R12, mm) für Zuschnitt-Plotter und Schnittsoftware.
 * Ebenen: SCHNITTLINIE (Außenkante inkl. Nahtzugabe), NAHTLINIE, FADENLAUF, PASSZEICHEN, BESCHRIFTUNG.
 */

const LAYERS: [string, number][] = [
  ['SCHNITTLINIE', 7],
  ['NAHTLINIE', 8],
  ['FADENLAUF', 3],
  ['PASSZEICHEN', 1],
  ['BESCHRIFTUNG', 5],
];

export function exportPatternDxf(doc: SketchDoc): Uint8Array {
  const pat = doc.pattern;
  const geoms = (pat?.pieces ?? []).map((p) => pieceGeom(doc, p)).filter((g): g is PieceGeom => !!g);
  if (!geoms.length) throw new ExportError('Keine Schnittteile vorhanden. Im Tab „Schnitt“ einen Grundschnitt erzeugen oder Konturen zu Schnittteilen machen.');

  // Außenkanten (mit Nahtzugabe) und Gesamtgröße
  const cuts = geoms.map((g) => {
    const sa = seamAllowanceOutline(g);
    return sa.length ? sa : [g.polygon];
  });
  const box = emptyBBox();
  for (const polys of cuts) for (const poly of polys) for (const p of poly) bboxAddPoint(box, p);
  const X = (x: number) => x - box.minX;
  const Y = (y: number) => y - box.minY;
  const n = (v: number) => {
    const r = Math.round(v * 10000) / 10000;
    return Object.is(r, -0) ? '0' : String(r);
  };
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  const poly = (layer: string, pts: Vec2[], closed: boolean) => {
    if (pts.length < 2) return;
    g(0, 'POLYLINE');
    g(8, layer);
    g(66, 1);
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(70, closed ? 1 : 0);
    for (const p of pts) {
      g(0, 'VERTEX');
      g(8, layer);
      g(10, n(X(p.x)));
      g(20, n(Y(p.y)));
      g(30, 0);
    }
    g(0, 'SEQEND');
    g(8, layer);
  };
  const line = (layer: string, a: Vec2, b: Vec2) => {
    g(0, 'LINE');
    g(8, layer);
    g(10, n(X(a.x)));
    g(20, n(Y(a.y)));
    g(30, 0);
    g(11, n(X(b.x)));
    g(21, n(Y(b.y)));
    g(31, 0);
  };
  const text = (layer: string, at: Vec2, h: number, s: string) => {
    g(0, 'TEXT');
    g(8, layer);
    g(10, n(X(at.x)));
    g(20, n(Y(at.y)));
    g(30, 0);
    g(40, n(h));
    g(1, ascii(s));
    g(72, 1);
    g(11, n(X(at.x)));
    g(21, n(Y(at.y)));
    g(31, 0);
  };

  g(999, `${APP_NAME} ${APP_VERSION} – Schnittteile, Einheit mm`);
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  g(70, 4);
  g(9, '$MEASUREMENT');
  g(70, 1);
  g(9, '$EXTMIN');
  g(10, 0);
  g(20, 0);
  g(9, '$EXTMAX');
  g(10, n(box.maxX - box.minX));
  g(20, n(box.maxY - box.minY));
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, LAYERS.length);
  for (const [name, color] of LAYERS) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');

  geoms.forEach((gm, i) => {
    const pc = gm.piece;
    for (const c of cuts[i]) poly('SCHNITTLINIE', c, true);
    if (pc.seamAllowance > 0) poly('NAHTLINIE', gm.polygon, true);
    // Fadenlauf mit Pfeilspitzen
    const [a, b] = grainLine(gm);
    line('FADENLAUF', a, b);
    const d = norm(sub(b, a));
    const q = perp(d);
    for (const [tip, dir] of [
      [b, d],
      [a, { x: -d.x, y: -d.y }],
    ] as [Vec2, Vec2][]) {
      line('FADENLAUF', tip, { x: tip.x - dir.x * 12 + q.x * 5, y: tip.y - dir.y * 12 + q.y * 5 });
      line('FADENLAUF', tip, { x: tip.x - dir.x * 12 - q.x * 5, y: tip.y - dir.y * 12 - q.y * 5 });
    }
    // Passzeichen: an Anfang und Ende jeder vernähten Kante, senkrecht nach außen bis zur Schnittkante
    const sign = gm.ccw ? 1 : -1;
    for (const ed of gm.edges) {
      if (!pat || !seamsAt(pat, { piece: pc.id, edge: ed.index }).length) continue;
      for (const [p, nb] of [
        [ed.pts[0], ed.pts[1]],
        [ed.pts[ed.pts.length - 1], ed.pts[ed.pts.length - 2]],
      ] as [Vec2, Vec2][]) {
        const t = norm(sub(nb, p));
        // Außennormale: bei CCW rechts der Laufrichtung (Richtung von p nach nb umgedreht berücksichtigt)
        const dir = p === ed.pts[0] ? t : { x: -t.x, y: -t.y };
        const out2 = { x: dir.y * sign, y: -dir.x * sign };
        const len = Math.max(4, Math.min(pc.seamAllowance, 8));
        line('PASSZEICHEN', p, { x: p.x + out2.x * len, y: p.y + out2.y * len });
      }
    }
    const h = Math.max(6, Math.min(14, (gm.box.maxX - gm.box.minX) / 18));
    const qty = pc.cut === 2 ? '2x gegengleich' : '1x';
    text('BESCHRIFTUNG', { x: gm.center.x, y: gm.center.y + h * 2.2 }, h, pc.name);
    text('BESCHRIFTUNG', { x: gm.center.x, y: gm.center.y - h * 2.6 }, h * 0.7, `${ROLE_NAMES[pc.role]} - Zuschnitt ${qty} - NZ ${pc.seamAllowance} mm`);
    if (pat) text('BESCHRIFTUNG', { x: gm.center.x, y: gm.center.y - h * 4 }, h * 0.7, `Groesse: ${sizeName(pat.bodySize)}`);
  });
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return new TextEncoder().encode(out.join('\r\n') + '\r\n');
}

function ascii(s: string): string {
  return s
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
}
