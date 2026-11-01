import type { BodyMeasures, Contour, PatternBlock, PieceRole, ShapeNode, Vec2 } from '../model/types';
import { flattenContour, polyLength } from '../model/shape';

/**
 * Grundschnitt-Generator: erzeugt aus Körpermaßen und Passform die Schnittteile eines Oberteils
 * (T-Shirt, Longsleeve, Sweatshirt, Hoodie) samt Nähten.
 *
 * Konventionen (für die 3D-Zuordnung wichtig):
 * - Jedes Teil läuft gegen den Uhrzeigersinn (Y nach oben). Kante i = Segment Knoten i → i+1.
 * - Vorderteil von außen gesehen: +x = linke Körperseite der Trägerin/des Trägers.
 *   Rückenteil von außen gesehen: +x = rechte Körperseite.
 * - Gegengleiche Teile (cut 2): Kopie 0 (wie gezeichnet) = linke Körperseite, Kopie 1 = rechte.
 * - Das Vorderteil hat seinen hohen Halspunkt (HPS) auf y = 0.
 */

export type BlockKind = PatternBlock['kind'];

export const BLOCK_KINDS: { id: BlockKind; name: string; hint: string }[] = [
  { id: 'tshirt', name: 'T-Shirt', hint: 'Kurzarm, Halsbündchen' },
  { id: 'longsleeve', name: 'Longsleeve', hint: 'Langarm, Halsbündchen' },
  { id: 'sweatshirt', name: 'Sweatshirt', hint: 'Langarm, Bündchen an Ärmel, Saum und Hals' },
  { id: 'hoodie', name: 'Hoodie', hint: 'Langarm, Bündchen, zweiteilige Kapuze' },
];

export const FIT_NAMES: Record<PatternBlock['fit'], string> = { slim: 'Schmal (Slim)', regular: 'Normal (Regular)', oversize: 'Weit (Oversize)' };

/** Bewegungszugabe am Brustumfang (ganzer Umfang, mm) */
const CHEST_EASE = { slim: 60, regular: 140, oversize: 300 };
/** Verlängerung der Schulter über den Schulterpunkt hinaus (mm, halbe Seite) */
const SHOULDER_DROP = { slim: 0, regular: 15, oversize: 70 };
/** Zugabe am Oberarm (ganzer Umfang) */
const ARM_EASE = { slim: 70, regular: 110, oversize: 200 };

const RIB_H = 70;
const NECKBAND_H = 22;

export interface BlockPiece {
  key: string;
  name: string;
  role: PieceRole;
  cut: 1 | 2;
  /** Kontur in Teil-Koordinaten (mm, Y nach oben), gegen den Uhrzeigersinn */
  contour: Contour;
  /** Bündchen/Rippe statt Hauptstoff */
  rib?: boolean;
}

export interface BlockSeam {
  a: [string, number, 0 | 1];
  b: [string, number, 0 | 1];
  reversed: boolean;
  name: string;
}

export interface BlockResult {
  pieces: BlockPiece[];
  seams: BlockSeam[];
}

/** Standardwerte für Länge und Ärmel aus den Körpermaßen. */
export function defaultBlock(kind: BlockKind, body: BodyMeasures, fit: PatternBlock['fit'] = 'regular', size = 'H-M'): PatternBlock {
  const longArm = kind !== 'tshirt';
  const lengthFactor = kind === 'tshirt' || kind === 'longsleeve' ? 0.405 : 0.385;
  const extra = fit === 'oversize' ? 30 : 0;
  return {
    kind,
    size,
    fit,
    length: Math.round((body.height * lengthFactor + extra) / 5) * 5,
    sleeve: longArm ? Math.round((body.arm + 30) / 5) * 5 : Math.round((body.height * 0.115 + (fit === 'oversize' ? 40 : 0)) / 5) * 5,
  };
}

// ---------------------------------------------------------------------------

const n = (x: number, y: number, h: Partial<ShapeNode> = {}): ShapeNode => ({ x, y, ...h });

/** Länge einer Bézierkurve zwischen zwei Knoten. */
function curveLength(a: ShapeNode, b: ShapeNode): number {
  const pts = flattenContour({ closed: false, nodes: [a, b] }, 0.02);
  return polyLength(pts, false);
}

function rect(w: number, h: number): Contour {
  // gegen den Uhrzeigersinn ab links unten; Kanten: 0 unten, 1 rechts, 2 oben, 3 links
  return { closed: true, nodes: [n(-w / 2, -h), n(w / 2, -h), n(w / 2, 0), n(-w / 2, 0)] };
}

interface BodyPieceInfo {
  contour: Contour;
  neckHalf: number;
  armhole: number;
  hemWidth: number;
}

/**
 * Vorder- oder Rückenteil. Knoten: 0 Saum links, 1 Saum rechts, 2 Achsel rechts, 3 Schulter rechts,
 * 4 Halspunkt rechts, 5 Halsmitte, 6 Halspunkt links, 7 Schulter links, 8 Achsel links.
 * Kanten: 0 Saum, 1 Seite rechts, 2 Armloch rechts, 3 Schulter rechts, 4 Hals rechts, 5 Hals links,
 * 6 Schulter links, 7 Armloch links, 8 Seite links.
 */
function bodyPiece(b: BodyMeasures, blk: PatternBlock, front: boolean, len: number): BodyPieceInfo {
  const hw = (b.chest + CHEST_EASE[blk.fit]) / 4;
  const sp = b.shoulder / 2 + SHOULDER_DROP[blk.fit];
  const nw = b.neck / 6 + 8;
  const nd = front ? b.neck / 6 + 30 : 22;
  const slope = blk.fit === 'oversize' ? 30 : 45;
  const ad = b.chest / 8 + 120 + (blk.fit === 'slim' ? 0 : blk.fit === 'regular' ? 15 : 55);
  const hem = Math.max(hw, (b.hip + CHEST_EASE[blk.fit] * 0.6) / 4);
  const scoop = front ? 0.5 : 0.4;
  const underR = n(hw, -ad, { ox: hw - (hw - sp) * 0.9 - 4, oy: -ad + 2 });
  const shR = n(sp, -slope, { ix: sp - (front ? 10 : 4), iy: -slope - (ad - slope) * scoop });
  const neckR = n(nw, 0, { ox: nw, oy: -nd * 0.55 });
  const neckC = n(0, -nd, { ix: nw * 0.55, iy: -nd, ox: -nw * 0.55, oy: -nd });
  const neckL = n(-nw, 0, { ix: -nw, iy: -nd * 0.55 });
  const shL = n(-sp, -slope, { ox: -sp + (front ? 10 : 4), oy: -slope - (ad - slope) * scoop });
  const underL = n(-hw, -ad, { ix: -(hw - (hw - sp) * 0.9 - 4), iy: -ad + 2 });
  const contour: Contour = {
    closed: true,
    // Schulterlinien gerade: Knoten 3 ohne Ausgangsgriff, 4 ohne Eingangsgriff
    nodes: [n(-hem, -len), n(hem, -len), underR, shR, neckR, neckC, neckL, shL, underL],
  };
  const neckHalf = curveLength(contour.nodes[4], contour.nodes[5]);
  const armhole = curveLength(contour.nodes[2], contour.nodes[3]);
  return { contour, neckHalf, armhole, hemWidth: 2 * hem };
}

/**
 * Ärmel. Knoten: 0 Saum links, 1 Saum rechts, 2 Achsel rechts, 3 Kugelhöhe, 4 Achsel links.
 * Kanten: 0 Saum, 1 Unterarm rechts, 2 Kugel rechts (→ Vorderteil), 3 Kugel links (→ Rückenteil), 4 Unterarm links.
 */
function sleevePiece(b: BodyMeasures, blk: PatternBlock, frontArm: number, backArm: number, len: number, hemHalf: number): { contour: Contour; hemWidth: number } {
  let bw = (b.upperArm + ARM_EASE[blk.fit]) / 2;
  const target = (frontArm + backArm) / 2;
  const capNodes = (ch: number, fr = 0.42, fl = 0.42) => {
    const right = n(bw, -ch, { ox: bw * 0.55, oy: -ch * 0.72 });
    const top = n(0, 0, { ix: bw * fr, iy: 0, ox: -bw * fl, oy: 0 });
    const left = n(-bw, -ch, { ix: -bw * 0.55, iy: -ch * 0.72 });
    return { right, top, left };
  };
  // Kugelhöhe so wählen, dass die Kugellänge im Mittel zum Armloch passt (Bisektion) …
  if (target < bw + 15) bw = Math.max(40, target - 15);
  let lo = 5;
  let hi = target;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const c = capNodes(mid);
    if (curveLength(c.right, c.top) < target) lo = mid;
    else hi = mid;
  }
  const ch = (lo + hi) / 2;
  // … und je Hälfte die Kurvenform so anpassen, dass sie exakt zum vorderen bzw. hinteren Armloch passt
  const fit = (want: number, len: (f: number) => number) => {
    let a = 0.02;
    let z = 0.95;
    for (let i = 0; i < 50; i++) {
      const m = (a + z) / 2;
      // Längerer Griff → bauchigere, längere Kurve
      if (len(m) > want) z = m;
      else a = m;
    }
    return (a + z) / 2;
  };
  const fr = fit(frontArm, (f) => {
    const c = capNodes(ch, f, 0.42);
    return curveLength(c.right, c.top);
  });
  const fl = fit(backArm, (f) => {
    const c = capNodes(ch, 0.42, f);
    return curveLength(c.top, c.left);
  });
  const c = capNodes(ch, fr, fl);
  const hh = Math.min(hemHalf, bw);
  const contour: Contour = { closed: true, nodes: [n(-hh, -len), n(hh, -len), c.right, c.top, c.left] };
  return { contour, hemWidth: 2 * hh };
}

/**
 * Kapuzenhälfte (Kopie 0 = linke Seite). Knoten: 0 vordere Mitte am Hals, 1 Schulternaht, 2 hintere Mitte
 * am Hals, 3 Hinterkopf, 4 Scheitel, 5 Gesichtskante oben. Kanten: 0 Hals vorne, 1 Hals hinten,
 * 2 hintere Mitte unten, 3 Hinterkopf, 4 Scheitel, 5 Gesichtskante (offen).
 */
function hoodPiece(b: BodyMeasures, frontNeck: number, backNeck: number): Contour {
  const hh = b.head * 0.62 + 20;
  const depth = b.head * 0.43 + 15;
  const t = (3 * Math.PI) / 180;
  const p1 = { x: frontNeck * Math.cos(t), y: -frontNeck * Math.sin(t) };
  const p2 = { x: p1.x + backNeck * Math.cos(t), y: p1.y + backNeck * Math.sin(t) };
  const back = Math.max(depth, p2.x + 20);
  return {
    closed: true,
    nodes: [
      n(0, 0),
      n(p1.x, p1.y),
      n(p2.x, p2.y),
      n(back + 15, hh * 0.5, { ix: back + 18, iy: hh * 0.22, ox: back + 12, oy: hh * 0.82 }),
      n(back * 0.5, hh, { ix: back * 0.82, iy: hh + 6, ox: back * 0.25, oy: hh - 2 }),
      n(18, hh - 18, { ix: 22, iy: hh - 10, ox: 10, oy: hh * 0.55 }),
    ],
  };
}

/**
 * Halsbündchen: Unterkante in vier Abschnitte (Rücken rechts, vorne rechts, vorne links, Rücken links)
 * geteilt, Länge um `k` gegenüber dem Halsausschnitt verkürzt. Kanten 0–3 unten, 4 rechts, 5 oben, 6 links.
 */
function neckband(frontHalf: number, backHalf: number, k: number): Contour {
  const segs = [backHalf, frontHalf, frontHalf, backHalf].map((v) => v * k);
  const W = segs.reduce((s, v) => s + v, 0);
  const H = NECKBAND_H;
  const nodes: ShapeNode[] = [];
  let x = -W / 2;
  nodes.push(n(x, 0));
  for (let i = 0; i < 3; i++) {
    x += segs[i];
    nodes.push(n(x, 0));
  }
  nodes.push(n(W / 2, 0), n(W / 2, H), n(-W / 2, H));
  return { closed: true, nodes };
}

export function generateBlock(body: BodyMeasures, blk: PatternBlock): BlockResult {
  const hasRib = blk.kind === 'sweatshirt' || blk.kind === 'hoodie';
  const longArm = blk.kind !== 'tshirt';
  const bodyLen = Math.max(250, blk.length - (hasRib ? RIB_H : 0));
  const front = bodyPiece(body, blk, true, bodyLen);
  const back = bodyPiece(body, blk, false, bodyLen);
  const drop = SHOULDER_DROP[blk.fit];
  const cuffW = body.wrist + 45;
  const sleeveLen = Math.max(80, blk.sleeve - drop - (hasRib && longArm ? RIB_H : 0));
  const hemHalf = longArm ? (hasRib ? (cuffW * 1.3) / 2 : (body.wrist + 90) / 2) : Infinity;
  const sleeve = sleevePiece(body, blk, front.armhole, back.armhole, sleeveLen, hemHalf === Infinity ? 1e9 : hemHalf);
  if (!longArm) {
    // Kurzarm: Saum etwas schmaler als Oberarmweite
    const nodes = sleeve.contour.nodes;
    const bw = nodes[2].x;
    nodes[0].x = -bw * 0.88;
    nodes[1].x = bw * 0.88;
  }

  const pieces: BlockPiece[] = [
    { key: 'front', name: 'Vorderteil', role: 'front', cut: 1, contour: front.contour },
    { key: 'back', name: 'Rückenteil', role: 'back', cut: 1, contour: back.contour },
    { key: 'sleeve', name: 'Ärmel', role: 'sleeve', cut: 2, contour: sleeve.contour },
  ];
  const seams: BlockSeam[] = [
    { a: ['front', 1, 0], b: ['back', 8, 0], reversed: true, name: 'Seitennaht links' },
    { a: ['front', 8, 0], b: ['back', 1, 0], reversed: true, name: 'Seitennaht rechts' },
    { a: ['front', 3, 0], b: ['back', 6, 0], reversed: true, name: 'Schulternaht links' },
    { a: ['front', 6, 0], b: ['back', 3, 0], reversed: true, name: 'Schulternaht rechts' },
    // Ärmel links (Kopie 0) und rechts (Kopie 1, gespiegelt)
    { a: ['sleeve', 2, 0], b: ['front', 2, 0], reversed: false, name: 'Armloch vorne links' },
    { a: ['sleeve', 3, 0], b: ['back', 7, 0], reversed: false, name: 'Armloch hinten links' },
    { a: ['sleeve', 2, 1], b: ['front', 7, 0], reversed: true, name: 'Armloch vorne rechts' },
    { a: ['sleeve', 3, 1], b: ['back', 2, 0], reversed: true, name: 'Armloch hinten rechts' },
    { a: ['sleeve', 1, 0], b: ['sleeve', 4, 0], reversed: true, name: 'Ärmelnaht links' },
    { a: ['sleeve', 1, 1], b: ['sleeve', 4, 1], reversed: true, name: 'Ärmelnaht rechts' },
  ];

  if (hasRib) {
    if (longArm) {
      pieces.push({ key: 'cuff', name: 'Ärmelbündchen', role: 'cuff', cut: 2, contour: rect(cuffW, RIB_H), rib: true });
      seams.push(
        { a: ['cuff', 2, 0], b: ['sleeve', 0, 0], reversed: true, name: 'Bündchen links' },
        { a: ['cuff', 2, 1], b: ['sleeve', 0, 1], reversed: true, name: 'Bündchen rechts' },
        { a: ['cuff', 1, 0], b: ['cuff', 3, 0], reversed: true, name: 'Bündchennaht links' },
        { a: ['cuff', 1, 1], b: ['cuff', 3, 1], reversed: true, name: 'Bündchennaht rechts' },
      );
    }
    const fw = front.hemWidth * 0.88;
    const bw = back.hemWidth * 0.88;
    pieces.push(
      { key: 'hemFront', name: 'Saumbund vorne', role: 'hem', cut: 1, contour: rect(fw, RIB_H), rib: true },
      { key: 'hemBack', name: 'Saumbund hinten', role: 'hem', cut: 1, contour: rect(bw, RIB_H), rib: true },
    );
    seams.push(
      { a: ['hemFront', 2, 0], b: ['front', 0, 0], reversed: true, name: 'Saumbund vorne' },
      { a: ['hemBack', 2, 0], b: ['back', 0, 0], reversed: true, name: 'Saumbund hinten' },
      { a: ['hemFront', 1, 0], b: ['hemBack', 3, 0], reversed: true, name: 'Saumbund Seite links' },
      { a: ['hemFront', 3, 0], b: ['hemBack', 1, 0], reversed: true, name: 'Saumbund Seite rechts' },
    );
  }

  if (blk.kind === 'hoodie') {
    pieces.push({ key: 'hood', name: 'Kapuze', role: 'hood', cut: 2, contour: hoodPiece(body, front.neckHalf, back.neckHalf) });
    seams.push(
      { a: ['hood', 0, 0], b: ['front', 4, 0], reversed: true, name: 'Kapuze vorne links' },
      { a: ['hood', 1, 0], b: ['back', 5, 0], reversed: true, name: 'Kapuze hinten links' },
      { a: ['hood', 0, 1], b: ['front', 5, 0], reversed: false, name: 'Kapuze vorne rechts' },
      { a: ['hood', 1, 1], b: ['back', 4, 0], reversed: false, name: 'Kapuze hinten rechts' },
      { a: ['hood', 2, 0], b: ['hood', 2, 1], reversed: false, name: 'Kapuze Mitte hinten' },
      { a: ['hood', 3, 0], b: ['hood', 3, 1], reversed: false, name: 'Kapuze Hinterkopf' },
      { a: ['hood', 4, 0], b: ['hood', 4, 1], reversed: false, name: 'Kapuze Scheitel' },
    );
  } else {
    const k = hasRib ? 0.85 : 0.88;
    pieces.push({ key: 'neckband', name: 'Halsbündchen', role: 'neckband', cut: 1, contour: neckband(front.neckHalf, back.neckHalf, k), rib: true });
    seams.push(
      { a: ['neckband', 0, 0], b: ['back', 4, 0], reversed: true, name: 'Halsbündchen hinten rechts' },
      { a: ['neckband', 1, 0], b: ['front', 5, 0], reversed: true, name: 'Halsbündchen vorne rechts' },
      { a: ['neckband', 2, 0], b: ['front', 4, 0], reversed: true, name: 'Halsbündchen vorne links' },
      { a: ['neckband', 3, 0], b: ['back', 5, 0], reversed: true, name: 'Halsbündchen hinten links' },
      { a: ['neckband', 4, 0], b: ['neckband', 6, 0], reversed: true, name: 'Halsbündchen Mitte hinten' },
    );
  }
  return { pieces, seams };
}

/** Teile nebeneinander anordnen (Abstand `gap`), oberste Kante auf y = top. Liefert Versatz je Teil. */
export function layoutPieces(pieces: BlockPiece[], origin: Vec2, gap = 60, maxRow = 2600): Map<string, Vec2> {
  const out = new Map<string, Vec2>();
  let x = origin.x;
  let y = origin.y;
  let rowH = 0;
  for (const p of pieces) {
    const pts = flattenContour(p.contour, 0.5);
    const minX = Math.min(...pts.map((q) => q.x));
    const maxX = Math.max(...pts.map((q) => q.x));
    const minY = Math.min(...pts.map((q) => q.y));
    const maxY = Math.max(...pts.map((q) => q.y));
    const w = maxX - minX;
    const h = maxY - minY;
    if (x > origin.x && x + w > origin.x + maxRow) {
      x = origin.x;
      y -= rowH + gap * 1.5;
      rowH = 0;
    }
    out.set(p.key, { x: x - minX, y: y - maxY });
    x += w + gap;
    rowH = Math.max(rowH, h);
  }
  return out;
}
