import { flattenContour } from '../model/shape';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import type { ExportScene } from './scene';

/**
 * DXF-Export (ASCII, R12) für Schneideplotter und Schnittmuster-Software: reine Geometrie in mm,
 * Kreise als CIRCLE, alles andere als geschlossene oder offene Polylinien (Kurven fein
 * abgeflacht), Ebenen als DXF-Layer. Farben, Füllungen und Verläufe gibt es in DXF nicht.
 */
export function exportDxf(scene: ExportScene, opts: { mirror?: boolean; tolerance?: number } = {}): Uint8Array {
  const tol = opts.tolerance ?? 0.01;
  const { box } = scene;
  const W = scene.widthMm;
  const n = (v: number) => {
    const r = Math.round(v * 10000) / 10000;
    return Object.is(r, -0) ? '0' : String(r);
  };
  const X = (x: number) => (opts.mirror ? W - (x - box.minX) : x - box.minX);
  const Y = (y: number) => y - box.minY;
  const names = new Map<string, string>();
  for (const l of scene.layers) {
    let name = l.name
      .replace(/[äÄ]/g, 'ae')
      .replace(/[öÖ]/g, 'oe')
      .replace(/[üÜ]/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .toUpperCase();
    while ([...names.values()].includes(name)) name += '_';
    names.set(l.id, name || 'MOTIV');
  }
  const out: string[] = [];
  const g = (code: number, value: string | number) => out.push(String(code), String(value));
  g(999, `${APP_NAME} ${APP_VERSION}, Einheit mm`);
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
  g(10, n(W));
  g(20, n(scene.heightMm));
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LAYER');
  g(70, names.size);
  for (const name of names.values()) {
    g(0, 'LAYER');
    g(2, name);
    g(70, 0);
    g(62, 7);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const layer of scene.layers) {
    const ln = names.get(layer.id)!;
    for (const it of layer.items) {
      if (it.circle) {
        g(0, 'CIRCLE');
        g(8, ln);
        g(10, n(X(it.circle.c.x)));
        g(20, n(Y(it.circle.c.y)));
        g(30, 0);
        g(40, n(it.circle.r));
        continue;
      }
      if (it.arc) {
        // Gespiegelt kehrt sich die Laufrichtung um: Winkel an der Senkrechten spiegeln
        const start = opts.mirror ? 180 - it.arc.end : it.arc.start;
        const end = opts.mirror ? 180 - it.arc.start : it.arc.end;
        g(0, 'ARC');
        g(8, ln);
        g(10, n(X(it.arc.c.x)));
        g(20, n(Y(it.arc.c.y)));
        g(30, 0);
        g(40, n(it.arc.r));
        g(50, n(((start % 360) + 360) % 360));
        g(51, n(((end % 360) + 360) % 360));
        continue;
      }
      for (const c of it.contours) {
        const pts = flattenContour(c, tol);
        if (pts.length < 2) continue;
        g(0, 'POLYLINE');
        g(8, ln);
        g(66, 1);
        g(10, 0);
        g(20, 0);
        g(30, 0);
        g(70, c.closed ? 1 : 0);
        for (const p of pts) {
          g(0, 'VERTEX');
          g(8, ln);
          g(10, n(X(p.x)));
          g(20, n(Y(p.y)));
          g(30, 0);
        }
        g(0, 'SEQEND');
        g(8, ln);
      }
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  const s = out.join('\r\n') + '\r\n';
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}
