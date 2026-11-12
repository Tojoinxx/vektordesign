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
  { id: 'polo', name: 'Polo', hint: 'Kurzarm, Polokragen mit Steg, Knopfleiste, Ärmelbündchen' },
  { id: 'longsleeve', name: 'Longsleeve', hint: 'Langarm, Halsbündchen' },
  { id: 'sweatshirt', name: 'Sweatshirt', hint: 'Langarm, Bündchen an Ärmel, Saum und Hals' },
  { id: 'hoodie', name: 'Hoodie', hint: 'Langarm, Bündchen, zweiteilige Kapuze' },
  { id: 'skirt', name: 'Rock', hint: 'A-Linie, elastischer Bund' },
  { id: 'pleated', name: 'Faltenrock', hint: 'Rundum eingelegte Falten, elastischer Bund' },
  { id: 'pants', name: 'Jogginghose', hint: 'Lang, elastischer Bund, Beinbündchen' },
  { id: 'shorts', name: 'Shorts', hint: 'Kurz, elastischer Bund' },
];

/** Unterteile (Rock, Hose) – sitzen an der Taille statt an den Schultern. */
export const isBottom = (kind: BlockKind): boolean => kind === 'skirt' || kind === 'pleated' || kind === 'pants' || kind === 'shorts';

/** Bundhöhe und Höhe der Beinbündchen (fertig, mm) */
const WAISTBAND_H = 40;
const LEG_CUFF_H = 60;
/** Der Bund sitzt etwas unter der natürlichen Taille (mm): Rock, Hose */
export const WAIST_DROP = { skirt: 10, pants: 25 };
/** Schritttiefe ab Bundoberkante der Hose (mm): bis ca. 3 cm unter den Schritt der Puppe */
export const riseOf = (b: BodyMeasures): number => Math.round(b.height * 0.374 - b.backLength);

export const FIT_NAMES: Record<PatternBlock['fit'], string> = { slim: 'Schmal (Slim)', regular: 'Normal (Regular)', oversize: 'Weit (Oversize)' };

/** Bewegungszugabe am Brustumfang (ganzer Umfang, mm) */
const CHEST_EASE = { slim: 60, regular: 140, oversize: 300 };
/** Verlängerung der Schulter über den Schulterpunkt hinaus (mm, halbe Seite) */
const SHOULDER_DROP = { slim: 0, regular: 15, oversize: 70 };
/** Zugabe am Oberarm (ganzer Umfang) */
const ARM_EASE = { slim: 70, regular: 110, oversize: 200 };

const RIB_H = 70;
const NECKBAND_H = 22;
/** Polo: Breite der Knopfleiste, Länge, Kragensteg, Kragen, Ärmelbündchen (fertig, mm) */
const PLACKET_W = 30;
const PLACKET_L = 140;
const STAND_H = 28;
const COLLAR_H = 75;
const ARMBAND_H = 25;

export interface BlockPiece {
  key: string;
  name: string;
  role: PieceRole;
  cut: 1 | 2;
  /** Kontur in Teil-Koordinaten (mm, Y nach oben), gegen den Uhrzeigersinn */
  contour: Contour;
  /** Bündchen/Rippe statt Hauptstoff */
  rib?: boolean;
  /** Versatz des Streifenrapports (mm), damit Streifen an der Achsel auf die Seitennaht treffen */
  stripeShift?: number;
  /** Anzahl Falten über die Breite (Faltenrock) */
  pleats?: number;
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
  if (isBottom(kind)) {
    // Seitenlänge ab Bundoberkante: Rock bis über das Knie, Faltenrock kurz, Hose bis zum Knöchel, Shorts über dem Knie
    const f = kind === 'skirt' ? 0.275 : kind === 'pleated' ? 0.225 : kind === 'pants' ? 0.545 : 0.24;
    return { kind, size, fit, length: Math.round((body.height * f + (fit === 'oversize' && kind !== 'pants' ? 30 : 0)) / 5) * 5, sleeve: 0 };
  }
  const longArm = kind !== 'tshirt' && kind !== 'polo';
  const lengthFactor = kind === 'tshirt' || kind === 'polo' || kind === 'longsleeve' ? 0.405 : 0.385;
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
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type P2 = [number, number];
/** Kubische Bézierkurve an der Stelle teilen, an der x den Wert `x` erreicht (x monoton). */
function splitAtX(p0: P2, p1: P2, p2: P2, p3: P2, x: number): [P2[], P2[]] {
  const at = (t: number) => {
    const u = 1 - t;
    return u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0];
  };
  let lo = 0;
  let hi = 1;
  const dec = at(1) < at(0);
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (at(m) > x === dec) lo = m;
    else hi = m;
  }
  const t = (lo + hi) / 2;
  const lerp = (a: P2, b: P2): P2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a1 = lerp(p0, p1);
  const b1 = lerp(p1, p2);
  const c1 = lerp(p2, p3);
  const a2 = lerp(a1, b1);
  const b2 = lerp(b1, c1);
  const m = lerp(a2, b2);
  return [
    [p0, a1, a2, m],
    [m, b2, c1, p3],
  ];
}

/** Länge einer Bézierkurve zwischen zwei Knoten. */
function curveLength(a: ShapeNode, b: ShapeNode): number {
  const pts = flattenContour({ closed: false, nodes: [a, b] }, 0.02);
  return polyLength(pts, false);
}

/**
 * Gebogenes Band (Polokragen): Ansatzkante (Kante 0, unten) so lang wie `len`, Außenkante um `ratio` länger –
 * so legt sich der Kragen beim Umschlagen flach auf Steg und Schultern. Kanten: 0 Ansatz, 1 rechts, 2 außen, 3 links.
 */
function arcBand(len: number, h: number, ratio: number): Contour {
  const r1 = h / (ratio - 1);
  const r2 = r1 + h;
  const a = len / r1 / 2;
  const k = (4 / 3) * Math.tan(a / 2);
  // Kreismittelpunkt unterhalb (0, −r1): Ansatzkante oben gewölbt, y = 0 in der Mitte
  const pt = (r: number, t: number): P2 => [r * Math.sin(t), r * Math.cos(t) - r1];
  const tan = (r: number, t: number, dir: number): P2 => [r * Math.cos(t) * dir * k, -r * Math.sin(t) * dir * k];
  const [x0, y0] = pt(r1, -a);
  const [x1, y1] = pt(r1, a);
  const [x2, y2] = pt(r2, a);
  const [x3, y3] = pt(r2, -a);
  const t0 = tan(r1, -a, 1);
  const t1 = tan(r1, a, 1);
  const t2 = tan(r2, a, 1);
  const t3 = tan(r2, -a, 1);
  return {
    closed: true,
    nodes: [n(x0, y0, { ox: x0 + t0[0], oy: y0 + t0[1] }), n(x1, y1, { ix: x1 - t1[0], iy: y1 - t1[1] }), n(x2, y2, { ox: x2 - t2[0], oy: y2 - t2[1] }), n(x3, y3, { ix: x3 + t3[0], iy: y3 + t3[1] })],
  };
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
function bodyPiece(b: BodyMeasures, blk: PatternBlock, front: boolean, len: number, rib: boolean, notch?: { w: number; d: number }): BodyPieceInfo {
  const s = blk.spec ?? {};
  const hw = s.chest ? s.chest / 2 : (b.chest + CHEST_EASE[blk.fit]) / 4;
  const sp = s.shoulder ? s.shoulder / 2 : b.shoulder / 2 + SHOULDER_DROP[blk.fit];
  const nw = s.neckW ? s.neckW / 2 : b.neck / 6 + 8;
  const nd = front ? (s.neckFront ?? b.neck / 6 + 30) : (s.neckBack ?? 22);
  // Schulternaht (gerade vom Halspunkt zum Schulterpunkt) bestimmt die Schulterneigung
  const slope = s.shoulderSeam ? clamp(Math.sqrt(Math.max(0, s.shoulderSeam ** 2 - (sp - nw) ** 2)), 5, 110) : blk.fit === 'oversize' ? 30 : 45;
  // Armloch gerade (Schulterpunkt → Achsel) bestimmt die Armlochtiefe
  const ad = s.armhole ? slope + Math.max(60, Math.sqrt(Math.max(0, s.armhole ** 2 - (hw - sp) ** 2))) : b.chest / 8 + 120 + (blk.fit === 'slim' ? 0 : blk.fit === 'regular' ? 15 : 55);
  // ½ Saumweite: mit Bündchen misst man das Bündchen (88 % des Teils), sonst die Saumkante
  const hem = s.hem ? (rib ? s.hem / 1.76 : s.hem / 2) : Math.max(hw, (b.hip + CHEST_EASE[blk.fit] * 0.6) / 4);
  const scoop = front ? 0.5 : 0.4;
  const underR = n(hw, -ad, { ox: hw - (hw - sp) * 0.9 - 4, oy: -ad + 2 });
  const shR = n(sp, -slope, { ix: sp - (front ? 10 : 4), iy: -slope - (ad - slope) * scoop });
  const neckR = n(nw, 0, { ox: nw, oy: -nd * 0.55 });
  const neckC = n(0, -nd, { ix: nw * 0.55, iy: -nd, ox: -nw * 0.55, oy: -nd });
  const neckL = n(-nw, 0, { ix: -nw, iy: -nd * 0.55 });
  const shL = n(-sp, -slope, { ox: -sp + (front ? 10 : 4), oy: -slope - (ad - slope) * scoop });
  const underL = n(-hw, -ad, { ix: -(hw - (hw - sp) * 0.9 - 4), iy: -ad + 2 });
  if (notch) {
    // Polo: Schlitz für die Knopfleiste in der vorderen Mitte. Halsausschnitt bis zur Schlitzkante teilen.
    const hw2 = notch.w / 2;
    const [a, bb] = splitAtX([neckR.x, neckR.y], [neckR.ox!, neckR.oy!], [neckC.ix!, neckC.iy!], [neckC.x, neckC.y], hw2);
    const nR = n(neckR.x, neckR.y, { ox: a[1][0], oy: a[1][1] });
    const tR = n(hw2, a[3][1], { ix: a[2][0], iy: a[2][1] });
    const yN = a[3][1];
    void bb;
    const bR = n(hw2, yN - notch.d);
    const bL = n(-hw2, yN - notch.d);
    const tL = n(-hw2, yN, { ox: -a[2][0], oy: a[2][1] });
    const nL = n(-neckR.x, neckR.y, { ix: -a[1][0], iy: a[1][1] });
    const contour: Contour = { closed: true, nodes: [n(-hem, -len), n(hem, -len), underR, shR, nR, tR, bR, bL, tL, nL, shL, underL] };
    const neckHalf = curveLength(contour.nodes[4], contour.nodes[5]);
    const armhole = curveLength(contour.nodes[2], contour.nodes[3]);
    return { contour, neckHalf, armhole, hemWidth: 2 * hem };
  }
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
  let bw = blk.spec?.bicep ?? (b.upperArm + ARM_EASE[blk.fit]) / 2;
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
function hoodPiece(b: BodyMeasures, frontNeck: number, backNeck: number, spec: Partial<Record<string, number>> = {}): Contour {
  // Fertigmaße Kapuzenhöhe/-breite: Kontur messen und zwei-, dreimal nachstellen (Bézier-Bögen ragen etwas über)
  let hh = spec.hoodH ?? b.head * 0.62 + 20;
  let depth = spec.hoodW ? spec.hoodW - 30 : b.head * 0.43 + 15;
  for (let it = 0; it < 6; it++) {
    const c = hoodContour(hh, depth, frontNeck, backNeck);
    if (!spec.hoodH && !spec.hoodW) return c;
    const pts = flattenContour(c, 0.2);
    const w = Math.max(...pts.map((q) => q.x)) - Math.min(...pts.map((q) => q.x));
    const h = Math.max(...pts.map((q) => q.y)) - Math.min(...pts.map((q) => q.y));
    if (spec.hoodH) hh += spec.hoodH - h;
    if (spec.hoodW) depth += spec.hoodW - w;
  }
  return hoodContour(hh, depth, frontNeck, backNeck);
}

function hoodContour(hh: number, depth: number, frontNeck: number, backNeck: number): Contour {
  // Halskante leicht geneigt; bei schmaler Kapuze (Fertigmaß) steiler, damit sie trotzdem den ganzen Halsausschnitt fasst
  const need = frontNeck + backNeck;
  const t = Math.max((3 * Math.PI) / 180, Math.min((55 * Math.PI) / 180, Math.acos(Math.min(1, Math.max(0, (depth - 20) / need)))));
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
function neckband(frontHalf: number, backHalf: number, k: number, height?: number): Contour {
  const segs = [backHalf, frontHalf, frontHalf, backHalf].map((v) => v * k);
  const W = segs.reduce((s, v) => s + v, 0);
  const H = height ? clamp(height, 8, 80) : NECKBAND_H;
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

// ---------------------------------------------------------------------------
// Unterteile: Rock, Faltenrock, Jogginghose, Shorts
// ---------------------------------------------------------------------------

/** Zugabe am Hüftumfang (ganzer Umfang, mm) */
const HIP_EASE_SKIRT = { slim: 20, regular: 50, oversize: 110 };
const HIP_EASE_PANTS = { slim: 50, regular: 110, oversize: 200 };
/** Ausstellung des Rocks je mm Länge unterhalb der Hüfte (je Seite) */
const FLARE = { slim: 0.02, regular: 0.13, oversize: 0.26 };
/** Saumweite der Hose (ganzer Umfang, mm) vor dem Bündchen */
const LEG_HEM = { slim: 300, regular: 360, oversize: 440 };

/**
 * Bund als Ring: Unterkante in `segs` Abschnitte geteilt (Kanten 0 … n−1, je einer für eine Bundkante der
 * Bahnen), dann rechts, oben, links. Reihenfolge rund um den Körper: rechte Seite → vorne → linke Seite → hinten.
 */
function waistband(segs: number[], h: number): Contour {
  const L = segs.reduce((a, v) => a + v, 0);
  const nodes: ShapeNode[] = [];
  let x = -L / 2;
  nodes.push(n(x, -h));
  for (let i = 0; i < segs.length - 1; i++) {
    x += segs[i];
    nodes.push(n(x, -h));
  }
  nodes.push(n(L / 2, -h), n(L / 2, 0), n(-L / 2, 0));
  return { closed: true, nodes };
}

/** Länge einer Kante der Kontur (Knoten i → i+1). */
function edgeLen(c: Contour, i: number): number {
  return curveLength(c.nodes[i], c.nodes[(i + 1) % c.nodes.length]);
}

function generateSkirt(body: BodyMeasures, blk: PatternBlock): BlockResult {
  const spec = blk.spec ?? {};
  const pleated = blk.kind === 'pleated';
  const bandH = clamp(spec.waistbandH ?? WAISTBAND_H, 15, 120);
  const len = Math.max(150, (spec.sideLen ?? blk.length) - bandH);
  const waistHalf = (body.waist + 30) / 2;
  const hipDepth = Math.min(len * 0.8, body.height * 0.105);
  let contour: Contour;
  let pleats = 0;
  if (pleated) {
    // Rechteck, gut doppelt so breit wie die halbe Taille: jede Falte verbraucht die doppelte Stoffbreite
    const ratio = blk.fit === 'slim' ? 1.8 : blk.fit === 'oversize' ? 2.6 : 2.2;
    const w = Math.max(waistHalf * ratio, (body.hip + 60) / 2);
    pleats = Math.max(4, Math.round(waistHalf / 48));
    contour = { closed: true, nodes: [n(-w / 2, -len), n(w / 2, -len), n(w / 2, 0), n(-w / 2, 0)] };
  } else {
    const hipHalf = (body.hip + HIP_EASE_SKIRT[blk.fit]) / 2;
    const hemHalf = spec.hem ?? hipHalf + 2 * FLARE[blk.fit] * (len - hipDepth);
    // Seitennaht: vom Saum gerade zur Hüfte, darüber in einem Bogen zur Taille
    const k = 0.7;
    const hx = hemHalf / 2 + (hipHalf / 2 - hemHalf / 2) * k;
    const hy = -len + (len - hipDepth) * k;
    contour = {
      closed: true,
      nodes: [
        n(-hemHalf / 2, -len, { ix: -hx, iy: hy }),
        n(hemHalf / 2, -len, { ox: hx, oy: hy }),
        n(waistHalf / 2, 0, { ix: hipHalf / 2 + 2, iy: -hipDepth * 0.55 }),
        n(-waistHalf / 2, 0, { ox: -(hipHalf / 2 + 2), oy: -hipDepth * 0.55 }),
      ],
    };
  }
  // Kanten der Bahn: 0 Saum, 1 Seite rechts (Saum → Bund), 2 Bund, 3 Seite links (Bund → Saum)
  // Bund ungedehnt (Fertigmaß ½ Bundweite), höchstens so lang wie die Bundkante der Bahn
  const bandHalf = spec.waist ?? Math.min(waistHalf, (body.waist * 0.9) / 2);
  const front: BlockPiece = { key: 'skirtFront', name: 'Rockbahn vorne', role: 'skirtFront', cut: 1, contour, ...(pleats ? { pleats } : {}) };
  const back: BlockPiece = { key: 'skirtBack', name: 'Rockbahn hinten', role: 'skirtBack', cut: 1, contour: structuredClone(contour), ...(pleats ? { pleats } : {}) };
  const band: BlockPiece = { key: 'waistband', name: 'Bund', role: 'waistband', cut: 1, contour: waistband([bandHalf, bandHalf], bandH), rib: true };
  return {
    pieces: [front, back, band],
    seams: [
      { a: ['skirtFront', 1, 0], b: ['skirtBack', 3, 0], reversed: true, name: 'Seitennaht links' },
      { a: ['skirtFront', 3, 0], b: ['skirtBack', 1, 0], reversed: true, name: 'Seitennaht rechts' },
      { a: ['waistband', 0, 0], b: ['skirtFront', 2, 0], reversed: true, name: 'Bund vorne' },
      { a: ['waistband', 1, 0], b: ['skirtBack', 2, 0], reversed: true, name: 'Bund hinten' },
      { a: ['waistband', 2, 0], b: ['waistband', 4, 0], reversed: true, name: 'Bundnaht' },
    ],
  };
}

function generatePants(body: BodyMeasures, blk: PatternBlock): BlockResult {
  const spec = blk.spec ?? {};
  const long = blk.kind === 'pants';
  const bandH = clamp(spec.waistbandH ?? WAISTBAND_H, 15, 120);
  const cuffH = long ? LEG_CUFF_H : 0;
  const rise = clamp(spec.rise ?? riseOf(body), 150, 420);
  const hipQ = spec.hip ? spec.hip / 2 : (body.hip + HIP_EASE_PANTS[blk.fit]) / 4;
  const extF = body.hip / 20;
  const extB = body.hip / 10;
  // Taille: an der Seite etwas eingezogen, den Rest zieht der elastische Bund ein
  const sideIn = clamp((body.hip - body.waist) * 0.15, 8, 45);
  const L = Math.max(rise + 60, (spec.sideLen ?? blk.length) - bandH - cuffH);
  // Saumweite: Hose läuft zum Knöchel zu, Shorts bleiben weit
  const thighCirc = 2 * hipQ + extF + extB;
  const hemCirc = !long && spec.legOpening ? 2 * spec.legOpening : long ? Math.max(LEG_HEM[blk.fit], spec.legOpening ? 2 * spec.legOpening : 0) : thighCirc - Math.min(120, (L - rise) * 0.35);
  /**
   * Hosenbein in „Vorderteil-Lage“ (x+ = Seitennaht): 0 Saum innen, 1 Saum außen, 2 Bund Seite, 3 Bund Mitte,
   * 4 Schrittspitze. Kanten: 0 Saum, 1 Seitennaht, 2 Bund, 3 Schrittnaht, 4 Innenbeinnaht.
   */
  const leg = (hipW: number, ext: number, hemHalf: number, centerIn: number, centerUp: number): ShapeNode[] => {
    const c = (hipW - ext) / 2;
    const outX = c + hemHalf;
    const inX = c - hemHalf;
    const below = L - rise;
    return [
      n(inX, -L),
      n(outX, -L, { ox: outX + (hipW - outX) * 0.55, oy: -L + below * 0.6 }),
      n(hipW - sideIn, 0, { ix: hipW, iy: -rise * 0.55 }),
      n(centerIn, centerUp, { ox: centerIn * 0.4, oy: -rise * 0.62 }),
      n(-ext, -rise, { ix: -ext * 0.15, iy: -rise, ox: -ext + (inX + ext) * 0.45, oy: -rise - below * 0.3 }),
    ];
  };
  const f = leg(hipQ - 10, extF, hemCirc / 4 - 5, 8, 0);
  // Hinterhose: breiter, längere Schrittspitze, hintere Mitte etwas höher (Gesäß)
  const bRaw = leg(hipQ + 10, extB, hemCirc / 4 + 5, 22, 25);
  // Seiten- und Innenbeinnaht hinten genau so lang wie vorne: Bundecke bzw. Schrittspitze der Hinterhose nachstellen
  const shiftY = (q: ShapeNode, dy: number) => {
    q.y += dy;
    if (q.iy !== undefined) q.iy += dy;
    if (q.oy !== undefined) q.oy += dy;
  };
  for (let it = 0; it < 6; it++) {
    shiftY(bRaw[2], curveLength(f[1], f[2]) - curveLength(bRaw[1], bRaw[2]));
    shiftY(bRaw[4], curveLength(f[4], f[0]) - curveLength(bRaw[4], bRaw[0]));
  }
  // … von hinten gesehen liegt die Seitennaht links: spiegeln und Umlaufsinn wieder gegen den Uhrzeigersinn
  const mir = (q: ShapeNode): ShapeNode => ({
    x: -q.x,
    y: q.y,
    ...(q.ox !== undefined ? { ix: -q.ox, iy: q.oy } : {}),
    ...(q.ix !== undefined ? { ox: -q.ix, oy: q.iy } : {}),
  });
  // Kanten der Hinterhose: 0 Saum, 1 Innenbeinnaht, 2 Schrittnaht, 3 Bund, 4 Seitennaht
  const b = [bRaw[1], bRaw[0], bRaw[4], bRaw[3], bRaw[2]].map(mir);
  const frontC: Contour = { closed: true, nodes: f };
  const backC: Contour = { closed: true, nodes: b };
  const wf = edgeLen(frontC, 2);
  const wb = edgeLen(backC, 3);
  // Bund: höchstens 30 % kürzer als die Bundkanten (sonst lässt er sich nicht annähen)
  const k = spec.waist ? spec.waist / (wf + wb) : Math.max((body.waist * 0.92) / (2 * (wf + wb)), 1 / 1.3);
  const pieces: BlockPiece[] = [
    { key: 'legFront', name: 'Vorderhose', role: 'legFront', cut: 2, contour: frontC },
    { key: 'legBack', name: 'Hinterhose', role: 'legBack', cut: 2, contour: backC },
    // rechte Seite → vorne rechts, vorne links → linke Seite → hinten links, hinten rechts
    { key: 'waistband', name: 'Bund', role: 'waistband', cut: 1, contour: waistband([wf * k, wf * k, wb * k, wb * k], bandH), rib: true },
  ];
  const seams: BlockSeam[] = [
    { a: ['legFront', 1, 0], b: ['legBack', 4, 0], reversed: true, name: 'Seitennaht' },
    { a: ['legFront', 4, 0], b: ['legBack', 1, 0], reversed: true, name: 'Innenbeinnaht' },
    { a: ['legFront', 3, 0], b: ['legFront', 3, 1], reversed: false, name: 'Schrittnaht vorne' },
    { a: ['legBack', 2, 0], b: ['legBack', 2, 1], reversed: false, name: 'Schrittnaht hinten' },
    { a: ['waistband', 0, 0], b: ['legFront', 2, 1], reversed: false, name: 'Bund vorne rechts' },
    { a: ['waistband', 1, 0], b: ['legFront', 2, 0], reversed: true, name: 'Bund vorne links' },
    { a: ['waistband', 2, 0], b: ['legBack', 3, 0], reversed: true, name: 'Bund hinten links' },
    { a: ['waistband', 3, 0], b: ['legBack', 3, 1], reversed: false, name: 'Bund hinten rechts' },
    { a: ['waistband', 4, 0], b: ['waistband', 6, 0], reversed: true, name: 'Bundnaht' },
  ];
  if (long) {
    const cuffW = spec.legOpening ? 2 * spec.legOpening : Math.max(hemCirc / 1.3, Math.min(hemCirc * 0.8, body.height * 0.135));
    pieces.push({ key: 'legCuff', name: 'Beinbündchen', role: 'legCuff', cut: 2, contour: waistband([cuffW / 2 - 5, cuffW / 2 + 5], cuffH), rib: true });
    // Bündchen-Oberkante (Kante 3) an beide Saumkanten: dafür trägt das Bündchen oben die Teilung – Kontur umdrehen
    const cuff = pieces[pieces.length - 1];
    cuff.contour = { closed: true, nodes: cuff.contour.nodes.map((q) => n(-q.x, -q.y - cuffH)) };
    // nach dem Drehen: Kante 0 (oben, Innenbein → Seite) an die Vorderhose, Kante 1 (Seite → Innenbein) an die
    // Hinterhose – beide laufen wie die Saumkanten; Kanten 2 und 4 schließen den Ring an der Innenbeinnaht
    seams.push(
      { a: ['legCuff', 0, 0], b: ['legFront', 0, 0], reversed: false, name: 'Beinbündchen vorne' },
      { a: ['legCuff', 1, 0], b: ['legBack', 0, 0], reversed: false, name: 'Beinbündchen hinten' },
      { a: ['legCuff', 2, 0], b: ['legCuff', 4, 0], reversed: true, name: 'Beinbündchennaht' },
    );
  }
  return { pieces, seams };
}

export function generateBlock(body: BodyMeasures, blk: PatternBlock): BlockResult {
  if (blk.kind === 'skirt' || blk.kind === 'pleated') return generateSkirt(body, blk);
  if (blk.kind === 'pants' || blk.kind === 'shorts') return generatePants(body, blk);
  const hasRib = blk.kind === 'sweatshirt' || blk.kind === 'hoodie';
  const polo = blk.kind === 'polo';
  const longArm = blk.kind !== 'tshirt' && !polo;
  const spec = blk.spec ?? {};
  const RIB = spec.rib ? clamp(spec.rib, 15, 200) : RIB_H;
  const length = spec.len ?? blk.length;
  const bodyLen = Math.max(250, length - (hasRib ? RIB : 0));
  const placketL = clamp(spec.placket ?? PLACKET_L, 40, 400);
  const front = bodyPiece(body, blk, true, bodyLen, hasRib, polo ? { w: PLACKET_W, d: placketL } : undefined);
  const back = bodyPiece(body, blk, false, bodyLen, hasRib);
  const drop = spec.shoulder ? 0 : SHOULDER_DROP[blk.fit];
  const cuffW = spec.opening && hasRib && longArm ? 2 * spec.opening : body.wrist + 45;
  const cuffH = hasRib && longArm ? RIB : 0;
  // Ärmellänge als Fertigmaß: ab Schulterpunkt des Schnitts bis Ärmelkante (inkl. Bündchen)
  const sleeveLen = Math.max(80, spec.sleeve ? spec.sleeve - cuffH : blk.sleeve - drop - cuffH);
  const hemHalf = longArm ? (hasRib ? (cuffW * 1.3) / 2 : (spec.opening ?? (body.wrist + 90) / 2)) : Infinity;
  const sleeve = sleevePiece(body, blk, front.armhole, back.armhole, sleeveLen, hemHalf === Infinity ? 1e9 : hemHalf);
  // Polo: Ärmelbündchen (Rippe) am kurzen Ärmel, etwas enger als der Ärmelsaum
  const bandH = polo ? clamp(spec.rib ?? ARMBAND_H, 10, 80) : 0;
  if (polo) sleeve.contour.nodes[0].y = sleeve.contour.nodes[1].y = -Math.max(60, spec.sleeve ? spec.sleeve - bandH : blk.sleeve - drop - bandH);
  if (!longArm) {
    // Kurzarm: Saum etwas schmaler als Oberarmweite
    const nodes = sleeve.contour.nodes;
    const bw = nodes[2].x;
    const half = polo ? (spec.opening ? spec.opening / 0.9 : bw * 0.88) : (spec.opening ?? bw * 0.88);
    nodes[0].x = -half;
    nodes[1].x = half;
  }
  // Kantennummern des Vorderteils (Polo: vier Kanten mehr für den Schlitz)
  const F = polo
    ? { hem: 0, sideR: 1, armR: 2, shR: 3, neckR: 4, notchR: 5, notchB: 6, notchL: 7, neckL: 8, shL: 9, armL: 10, sideL: 11 }
    : { hem: 0, sideR: 1, armR: 2, shR: 3, neckR: 4, notchR: -1, notchB: -1, notchL: -1, neckL: 5, shL: 6, armL: 7, sideL: 8 };

  const pieces: BlockPiece[] = [
    { key: 'front', name: 'Vorderteil', role: 'front', cut: 1, contour: front.contour },
    { key: 'back', name: 'Rückenteil', role: 'back', cut: 1, contour: back.contour },
    // Streifen: Achselpunkt des Ärmels liegt im Rapport auf Höhe des Achselpunkts am Körper
    { key: 'sleeve', name: 'Ärmel', role: 'sleeve', cut: 2, contour: sleeve.contour, stripeShift: sleeve.contour.nodes[2].y - front.contour.nodes[2].y },
  ];
  const seams: BlockSeam[] = [
    { a: ['front', F.sideR, 0], b: ['back', 8, 0], reversed: true, name: 'Seitennaht links' },
    { a: ['front', F.sideL, 0], b: ['back', 1, 0], reversed: true, name: 'Seitennaht rechts' },
    { a: ['front', F.shR, 0], b: ['back', 6, 0], reversed: true, name: 'Schulternaht links' },
    { a: ['front', F.shL, 0], b: ['back', 3, 0], reversed: true, name: 'Schulternaht rechts' },
    // Ärmel links (Kopie 0) und rechts (Kopie 1, gespiegelt)
    { a: ['sleeve', 2, 0], b: ['front', F.armR, 0], reversed: false, name: 'Armloch vorne links' },
    { a: ['sleeve', 3, 0], b: ['back', 7, 0], reversed: false, name: 'Armloch hinten links' },
    { a: ['sleeve', 2, 1], b: ['front', F.armL, 0], reversed: true, name: 'Armloch vorne rechts' },
    { a: ['sleeve', 3, 1], b: ['back', 2, 0], reversed: true, name: 'Armloch hinten rechts' },
    { a: ['sleeve', 1, 0], b: ['sleeve', 4, 0], reversed: true, name: 'Ärmelnaht links' },
    { a: ['sleeve', 1, 1], b: ['sleeve', 4, 1], reversed: true, name: 'Ärmelnaht rechts' },
  ];

  if (hasRib) {
    if (longArm) {
      pieces.push({ key: 'cuff', name: 'Ärmelbündchen', role: 'cuff', cut: 2, contour: rect(cuffW, RIB), rib: true });
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
      { key: 'hemFront', name: 'Saumbund vorne', role: 'hem', cut: 1, contour: rect(fw, RIB), rib: true },
      { key: 'hemBack', name: 'Saumbund hinten', role: 'hem', cut: 1, contour: rect(bw, RIB), rib: true },
    );
    seams.push(
      { a: ['hemFront', 2, 0], b: ['front', 0, 0], reversed: true, name: 'Saumbund vorne' },
      { a: ['hemBack', 2, 0], b: ['back', 0, 0], reversed: true, name: 'Saumbund hinten' },
      { a: ['hemFront', 1, 0], b: ['hemBack', 3, 0], reversed: true, name: 'Saumbund Seite links' },
      { a: ['hemFront', 3, 0], b: ['hemBack', 1, 0], reversed: true, name: 'Saumbund Seite rechts' },
    );
  }

  if (polo) {
    // Ärmelbündchen
    const sw = sleeve.contour.nodes[1].x * 2;
    const bandW = spec.opening ? 2 * spec.opening : sw * 0.9;
    pieces.push({ key: 'cuff', name: 'Ärmelbündchen', role: 'cuff', cut: 2, contour: rect(bandW, bandH), rib: true });
    seams.push(
      { a: ['cuff', 2, 0], b: ['sleeve', 0, 0], reversed: true, name: 'Bündchen links' },
      { a: ['cuff', 2, 1], b: ['sleeve', 0, 1], reversed: true, name: 'Bündchen rechts' },
      { a: ['cuff', 1, 0], b: ['cuff', 3, 0], reversed: true, name: 'Bündchennaht links' },
      { a: ['cuff', 1, 1], b: ['cuff', 3, 1], reversed: true, name: 'Bündchennaht rechts' },
    );
    // Knopfleisten: obere (linke Körperseite, Herrenart) und untere, beide so breit wie der Schlitz
    pieces.push(
      { key: 'placketTop', name: 'Knopfleiste oben', role: 'placket', cut: 1, contour: rect(PLACKET_W, placketL) },
      { key: 'placketUnder', name: 'Knopfleiste unten', role: 'placket', cut: 1, contour: rect(PLACKET_W, placketL) },
    );
    seams.push(
      { a: ['placketTop', 1, 0], b: ['front', F.notchR, 0], reversed: true, name: 'Knopfleiste oben' },
      { a: ['placketUnder', 3, 0], b: ['front', F.notchL, 0], reversed: true, name: 'Knopfleiste unten' },
      { a: ['placketTop', 0, 0], b: ['front', F.notchB, 0], reversed: true, name: 'Knopfleiste oben Riegel' },
      { a: ['placketUnder', 0, 0], b: ['front', F.notchB, 0], reversed: true, name: 'Knopfleiste unten Riegel' },
    );
    // Kragensteg: über die obere Leiste, rund um den Hals, über die untere Leiste (Enden überlappen vorne)
    const frontNeck = curveLength(front.contour.nodes[4], front.contour.nodes[5]);
    const segs = [PLACKET_W, frontNeck, back.neckHalf, back.neckHalf, frontNeck, PLACKET_W];
    const L = segs.reduce((a, v) => a + v, 0);
    const standNodes: ShapeNode[] = [];
    let x = -L / 2;
    standNodes.push(n(x, 0));
    for (let i = 0; i < segs.length - 1; i++) {
      x += segs[i];
      standNodes.push(n(x, 0));
    }
    const standH = STAND_H;
    standNodes.push(n(L / 2, 0), n(L / 2, standH), n(-L / 2, standH));
    const collarH = clamp(spec.collarH ?? COLLAR_H, 30, 160);
    pieces.push(
      { key: 'stand', name: 'Kragensteg', role: 'collar', cut: 1, contour: { closed: true, nodes: standNodes }, rib: true },
      { key: 'collar', name: 'Kragen', role: 'collar', cut: 1, contour: arcBand(L, collarH, 1.16), rib: true },
    );
    seams.push(
      { a: ['stand', 0, 0], b: ['placketTop', 2, 0], reversed: true, name: 'Kragensteg Knopfleiste oben' },
      { a: ['stand', 1, 0], b: ['front', F.neckR, 0], reversed: true, name: 'Kragensteg vorne links' },
      { a: ['stand', 2, 0], b: ['back', 5, 0], reversed: true, name: 'Kragensteg hinten links' },
      { a: ['stand', 3, 0], b: ['back', 4, 0], reversed: true, name: 'Kragensteg hinten rechts' },
      { a: ['stand', 4, 0], b: ['front', F.neckL, 0], reversed: true, name: 'Kragensteg vorne rechts' },
      { a: ['stand', 5, 0], b: ['placketUnder', 2, 0], reversed: true, name: 'Kragensteg Knopfleiste unten' },
      { a: ['collar', 0, 0], b: ['stand', 7, 0], reversed: true, name: 'Kragen an Steg' },
    );
  } else if (blk.kind === 'hoodie') {
    pieces.push({ key: 'hood', name: 'Kapuze', role: 'hood', cut: 2, contour: hoodPiece(body, front.neckHalf, back.neckHalf, spec) });
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
    pieces.push({ key: 'neckband', name: 'Halsbündchen', role: 'neckband', cut: 1, contour: neckband(front.neckHalf, back.neckHalf, k, spec.neckband), rib: true });
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
