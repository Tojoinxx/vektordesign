import type { GarmentId, GarmentView, Technique } from './types';

/**
 * Kleidungsstück-Skizzen für Platzierung und Artwork-Blatt (Größe L, flach liegend).
 *
 * Koordinaten in mm, Ursprung = Bezugspunkt „Kragennaht Mitte“ (vorne bzw. hinten; bei der Cap
 * die Schirmnaht in der Mitte), x nach rechts, y nach UNTEN (wie auf einem Blatt Papier).
 * Die Umrisse sind bewusst schlicht – sie zeigen Lage und Größe, kein Schnittmuster.
 */

export type Pt = [number, number];
export interface Poly {
  pts: Pt[];
  closed: boolean;
}

export interface GarmentDrawing {
  /** Flächen in Stofffarbe (hinten → vorne) */
  fills: Poly[];
  /** Nähte und Details (nur Linie) */
  lines: Poly[];
}

export interface PrintArea {
  id: string;
  name: string;
  view: GarmentView;
  /** Mitte des Bereichs, Abstand von der Mittellinie (positiv = im Bild rechts) */
  x: number;
  /** Oberkante unter dem Bezugspunkt */
  y: number;
  w: number;
  h: number;
}

export interface Garment {
  id: GarmentId;
  name: string;
  views: GarmentView[];
  /** Bezeichnung des Bezugspunkts je Ansicht */
  reference: Record<GarmentView, string>;
  areas: PrintArea[];
  draw: (view: GarmentView) => GarmentDrawing;
}

export const TECHNIQUES: { id: Technique; name: string }[] = [
  { id: 'screen', name: 'Siebdruck' },
  { id: 'dtg', name: 'DTG (Digitaldruck)' },
  { id: 'puff', name: 'Puff Print' },
  { id: 'embroidery', name: 'Stick' },
  { id: 'patch', name: 'Patch' },
  { id: 'silicone', name: 'Silikondruck' },
  { id: 'sublimation', name: 'Sublimation' },
  { id: 'transfer', name: 'Transferdruck' },
  { id: 'emboss', name: 'Prägung' },
  { id: 'allover', name: 'Allover' },
];

export const techniqueName = (t: Technique) => TECHNIQUES.find((x) => x.id === t)?.name ?? t;

// ---------------------------------------------------------------------------
// Zeichenhilfen
// ---------------------------------------------------------------------------

class PathBuilder {
  pts: Pt[] = [];
  constructor(x: number, y: number) {
    this.pts.push([x, y]);
  }
  private get last(): Pt {
    return this.pts[this.pts.length - 1];
  }
  l(x: number, y: number): this {
    this.pts.push([x, y]);
    return this;
  }
  /** Quadratische Kurve über Kontrollpunkt (cx, cy) */
  q(cx: number, cy: number, x: number, y: number, steps = 10): this {
    const [x0, y0] = this.last;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      this.pts.push([a * x0 + b * cx + c * x, a * y0 + b * cy + c * y]);
    }
    return this;
  }
  done(closed = false): Poly {
    return { pts: this.pts, closed };
  }
}
const P = (x: number, y: number) => new PathBuilder(x, y);

/** Spiegelt eine halbe Kontur (rechte Seite, von oben nach unten) zur ganzen geschlossenen Form. */
function mirrored(half: Pt[]): Poly {
  const left = half
    .slice()
    .reverse()
    .map(([x, y]) => [-x, y] as Pt);
  return { pts: [...half, ...left], closed: true };
}
const mirrorPoly = (p: Poly): Poly => ({ pts: p.pts.map(([x, y]) => [-x, y] as Pt), closed: p.closed });

// ---------------------------------------------------------------------------
// Oberteile
// ---------------------------------------------------------------------------

interface TopSpec {
  /** halbe Brustbreite */
  half: number;
  /** Länge ab Kragennaht Mitte vorne */
  length: number;
  /** Halsausschnitt: halbe Breite und Tiefe vorne (ab Schulterpunkt am Hals) */
  neckHalf: number;
  neckDrop: number;
  shoulder: Pt;
  sleeveOuter: Pt;
  sleeveInner: Pt;
  armpit: Pt;
  rib?: number;
  cuff?: number;
}

function topBody(s: TopSpec, view: GarmentView): { body: Poly; lines: Poly[] } {
  const drop = view === 'front' ? s.neckDrop : 18;
  // rechte Hälfte: Halspunkt → Schulter → Ärmel → Achsel → Seite → Saum
  const half: Pt[] = [];
  const neck = P(0, 0).q(s.neckHalf * 0.85, 0, s.neckHalf, -drop, 8).pts;
  half.push(...neck);
  half.push(s.shoulder, s.sleeveOuter, s.sleeveInner, s.armpit, [s.half, s.length]);
  half.push([0, s.length]);
  const body = mirrored(half.slice(0, -1).concat([[0.001, s.length]]));
  const lines: Poly[] = [];
  // Ärmelnaht
  const seam = P(s.shoulder[0], s.shoulder[1]).q(s.armpit[0] - 18, (s.shoulder[1] + s.armpit[1]) / 2, s.armpit[0], s.armpit[1], 8).done();
  lines.push(seam, mirrorPoly(seam));
  // Halsbündchen
  const rib = P(-s.neckHalf, -drop)
    .q(-s.neckHalf * 0.8, view === 'front' ? 14 : 10, 0, view === 'front' ? 14 : 10, 8)
    .q(s.neckHalf * 0.8, view === 'front' ? 14 : 10, s.neckHalf, -drop, 8)
    .done();
  lines.push(rib);
  if (s.rib) lines.push({ pts: [[-s.half + 4, s.length - s.rib], [s.half - 4, s.length - s.rib]], closed: false });
  if (s.cuff) {
    const [ox, oy] = s.sleeveOuter;
    const [ix, iy] = s.sleeveInner;
    const dx = ox - s.shoulder[0];
    const dy = oy - s.shoulder[1];
    const len = Math.hypot(dx, dy);
    const ux = (dx / len) * s.cuff;
    const uy = (dy / len) * s.cuff;
    const cuff: Poly = { pts: [[ox - ux, oy - uy], [ix - ux, iy - uy]], closed: false };
    lines.push(cuff, mirrorPoly(cuff));
  }
  return { body, lines };
}

const TEE: TopSpec = {
  half: 280,
  length: 640,
  neckHalf: 95,
  neckDrop: 80,
  shoulder: [240, -45],
  sleeveOuter: [345, 150],
  sleeveInner: [292, 192],
  armpit: [280, 150],
};
const HOODIE: TopSpec = {
  half: 300,
  length: 650,
  neckHalf: 100,
  neckDrop: 85,
  shoulder: [255, -40],
  sleeveOuter: [430, 560],
  sleeveInner: [352, 588],
  armpit: [298, 185],
  rib: 70,
  cuff: 70,
};
const SWEAT: TopSpec = { ...HOODIE, length: 630, neckDrop: 75, neckHalf: 92 };

function hoodieDrawing(view: GarmentView): GarmentDrawing {
  const { body, lines } = topBody(HOODIE, view);
  const fills: Poly[] = [];
  if (view === 'front') {
    // Kapuze hinter dem Kopf: Umriss oberhalb des Halses
    const hood = P(-HOODIE.neckHalf - 8, -HOODIE.neckDrop + 6)
      .q(-205, -230, -110, -360)
      .q(0, -440, 110, -360)
      .q(205, -230, HOODIE.neckHalf + 8, -HOODIE.neckDrop + 6)
      .l(0, 0)
      .done(true);
    fills.push(hood);
    // Kapuzenöffnung
    lines.push(P(-70, -20).q(-150, -250, 0, -330).q(150, -250, 70, -20).done());
    // Kordeln
    lines.push({ pts: [[-38, -6], [-44, 190]], closed: false }, { pts: [[38, -6], [44, 190]], closed: false });
    // Kängurutasche
    lines.push(
      P(-170, 400)
        .l(170, 400)
        .q(205, 470, 230, HOODIE.length - HOODIE.rib! - 6)
        .l(-230, HOODIE.length - HOODIE.rib! - 6)
        .q(-205, 470, -170, 400)
        .done(true),
    );
  }
  fills.push(body);
  if (view === 'back') {
    // Kapuze liegt auf dem Rücken
    const hood = P(-HOODIE.neckHalf - 4, -16)
      .q(-215, 40, -170, 230)
      .q(-90, 320, 0, 325)
      .q(90, 320, 170, 230)
      .q(215, 40, HOODIE.neckHalf + 4, -16)
      .q(0, 6, -HOODIE.neckHalf - 4, -16)
      .done(true);
    fills.push(hood);
    lines.push({ pts: [[0, 0], [0, 322]], closed: false });
  }
  return { fills, lines };
}

function teeDrawing(spec: TopSpec) {
  return (view: GarmentView): GarmentDrawing => {
    const { body, lines } = topBody(spec, view);
    return { fills: [body], lines };
  };
}

function capDrawing(): GarmentDrawing {
  // Vorderansicht: Krone über der Schirmnaht (y = 0), Schirm darunter
  const crown = P(-150, 0).q(-160, -150, 0, -165).q(160, -150, 150, 0).q(0, 12, -150, 0).done(true);
  const brim = P(-165, 2).q(0, 22, 165, 2).q(185, 40, 140, 62).q(0, 95, -140, 62).q(-185, 40, -165, 2).done(true);
  const lines: Poly[] = [
    { pts: [[0, -165], [0, -2]], closed: false },
    P(-150, -4).q(-60, -190, 0, -165).done(),
    P(150, -4).q(60, -190, 0, -165).done(),
    P(-150, 30).q(0, 52, 150, 30).done(),
  ];
  return { fills: [crown, brim], lines };
}

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

function topAreas(backTop: number): PrintArea[] {
  return [
    { id: 'chest-left', name: 'Brust links (Trägersicht)', view: 'front', x: 105, y: 70, w: 100, h: 100 },
    { id: 'chest-right', name: 'Brust rechts (Trägersicht)', view: 'front', x: -105, y: 70, w: 100, h: 100 },
    { id: 'front-a4', name: 'Front A4', view: 'front', x: 0, y: 80, w: 210, h: 297 },
    { id: 'front-a3', name: 'Front A3', view: 'front', x: 0, y: 70, w: 297, h: 420 },
    { id: 'neck', name: 'Nacken', view: 'back', x: 0, y: 30, w: 80, h: 40 },
    { id: 'back-a4', name: 'Rücken A4', view: 'back', x: 0, y: backTop, w: 210, h: 297 },
    { id: 'back-a3', name: 'Rücken A3', view: 'back', x: 0, y: backTop - 10, w: 297, h: 420 },
  ];
}

export const GARMENTS: Garment[] = [
  {
    id: 'hoodie',
    name: 'Hoodie',
    views: ['front', 'back'],
    reference: { front: 'Kragennaht Mitte vorne', back: 'Kragennaht Mitte hinten' },
    areas: topAreas(340).filter((a) => a.id !== 'neck'),
    draw: hoodieDrawing,
  },
  {
    id: 'tshirt',
    name: 'T-Shirt',
    views: ['front', 'back'],
    reference: { front: 'Kragennaht Mitte vorne', back: 'Kragennaht Mitte hinten' },
    areas: topAreas(100),
    draw: teeDrawing(TEE),
  },
  {
    id: 'sweatshirt',
    name: 'Sweatshirt',
    views: ['front', 'back'],
    reference: { front: 'Kragennaht Mitte vorne', back: 'Kragennaht Mitte hinten' },
    areas: topAreas(100),
    draw: teeDrawing(SWEAT),
  },
  {
    id: 'cap',
    name: 'Cap',
    views: ['front'],
    reference: { front: 'Schirmnaht Mitte', back: 'Schirmnaht Mitte' },
    areas: [{ id: 'cap-front', name: 'Cap-Front', view: 'front', x: 0, y: -130, w: 110, h: 55 }],
    draw: () => capDrawing(),
  },
];

export function garmentOf(id: GarmentId): Garment {
  return GARMENTS.find((g) => g.id === id) ?? GARMENTS[0];
}

export function areaOf(g: Garment, id: string): PrintArea | undefined {
  return g.areas.find((a) => a.id === id);
}

/** Begrenzungsrahmen einer Zeichnung (mm, y nach unten). */
export function drawingBounds(d: GarmentDrawing): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of [...d.fills, ...d.lines])
    for (const [x, y] of p.pts) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return { minX, minY, maxX, maxY };
}
