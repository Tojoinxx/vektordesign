import type { BodyMeasures, Id, PatternBlock, PatternMaterial, PieceRole, Seam, SketchDoc } from '../model/types';
import { APP_NAME, APP_VERSION } from '../model/serialize';
import { pieceGeom } from './geometry';
import { avatarBody, genderOfSize } from '../sim3d/avatar';

/**
 * Austauschformat Schnitt → „Vektordesign 3D“. Reine Zahlen, unabhängig vom Skizzenmodell:
 * jedes Teil als geschlossenes Polygon (mm, Y nach oben, gegen den Uhrzeigersinn) und seine Kanten als
 * Indexbereiche darin. Die 3D-Anwendung liest die Projektdatei (.vdp) und ruft diese Funktion auf –
 * dadurch sehen beide Programme immer denselben Stand.
 */

export interface ExchangeEdge {
  /** Index des Startpunkts im Polygon */
  from: number;
  /** Index des Endpunkts (bei der letzten Kante 0) */
  to: number;
  length: number;
}

export interface ExchangePiece {
  id: Id;
  name: string;
  role: PieceRole;
  cut: 1 | 2;
  material: Id | null;
  /** Eigene Farbe (sonst Materialfarbe) */
  color: string | null;
  seamAllowance: number;
  grain: number;
  polygon: [number, number][];
  edges: ExchangeEdge[];
  /** Flächenschwerpunkt */
  center: [number, number];
  area: number;
  /** Umlaufsinn gegen den Uhrzeigersinn (Teile des Grundschnitts immer) */
  ccw: boolean;
  /** Versatz des Streifenrapports (mm) */
  stripeShift?: number;
}

export interface PatternExchange {
  format: 'vektordesign-schnitt';
  version: 1;
  generator: string;
  name: string;
  unit: 'mm';
  /** Körpermaße der Puppe (eigene Puppe oder Maße des Schnitts) */
  body: BodyMeasures;
  gender: 'male' | 'female';
  /** Körperbau der Puppe (−1 … +1) für das Menschen-Modell */
  build: number;
  bodySize: string;
  block: PatternBlock | null;
  materials: PatternMaterial[];
  pieces: ExchangePiece[];
  seams: Seam[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function patternExchange(doc: SketchDoc): PatternExchange | null {
  const pat = doc.pattern;
  if (!pat || !pat.pieces.length) return null;
  const pieces: ExchangePiece[] = [];
  for (const pc of pat.pieces) {
    const g = pieceGeom(doc, pc);
    if (!g) continue;
    // Laufrichtung wie gezeichnet (Nahtrichtungen beziehen sich darauf); `ccw` sagt, wie herum
    const polygon: [number, number][] = [];
    const edges: ExchangeEdge[] = [];
    let idx = 0;
    for (const ed of g.edges) {
      const start = idx;
      for (const p of ed.pts.slice(0, -1)) {
        polygon.push([r2(p.x), r2(p.y)]);
        idx++;
      }
      edges.push({ from: start, to: idx, length: r2(ed.length) });
    }
    if (edges.length) edges[edges.length - 1].to = 0;
    pieces.push({
      id: pc.id,
      name: pc.name,
      role: pc.role,
      cut: pc.cut,
      material: pc.material ?? null,
      color: pc.color ?? null,
      seamAllowance: pc.seamAllowance,
      grain: pc.grain,
      polygon,
      edges,
      center: [r2(g.center.x), r2(g.center.y)],
      area: r2(g.area),
      ccw: g.ccw,
      ...(pc.stripeShift ? { stripeShift: pc.stripeShift } : {}),
    });
  }
  const ok = new Set(pieces.map((p) => p.id));
  return {
    format: 'vektordesign-schnitt',
    version: 1,
    generator: `${APP_NAME} ${APP_VERSION}`,
    name: doc.name,
    unit: 'mm',
    body: pat.avatar ? avatarBody(pat.avatar) : { ...pat.body },
    gender: pat.avatar?.gender ?? genderOfSize(pat.bodySize),
    build: pat.avatar?.build ?? 0,
    bodySize: pat.bodySize,
    block: pat.block ? { ...pat.block } : null,
    materials: pat.materials.map((m) => ({ ...m })),
    pieces,
    seams: pat.seams.filter((s) => ok.has(s.a.piece) && ok.has(s.b.piece)).map((s) => structuredClone(s)),
  };
}
