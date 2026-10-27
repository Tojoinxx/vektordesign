/**
 * Datenmodell der Skizze.
 *
 * Einheiten: Längen in Millimetern, Winkel in Grad (Bemaßungswerte) bzw. Bogenmaß
 * (intern im Solver). Koordinatensystem wie in CAD üblich: X nach rechts, Y nach oben.
 *
 * Das Modell ist reines, serialisierbares JSON ohne Klassen. Änderungen erfolgen
 * unveränderlich (immer), damit Rückgängig/Wiederholen per Schnappschuss funktioniert.
 */

export type Id = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface GradientStop {
  /** Position 0…1 entlang des Verlaufs */
  offset: number;
  /** '#rrggbb' */
  color: string;
  /** Deckkraft 0…1 (0 = durchsichtig, für „Verblassen“) */
  opacity: number;
}

/**
 * Farbverlauf. `from`/`to` sind relativ zum umschließenden Rechteck des Objekts
 * (0…1; u = links→rechts, v = unten→oben), damit der Verlauf dem Objekt folgt,
 * wenn sich Lage oder Größe durch Bemaßungen ändern.
 * Linear: Verlauf von `from` nach `to`. Radial: Mittelpunkt `from`, Radius |to − from|.
 */
export interface Gradient {
  kind: 'linear' | 'radial';
  stops: GradientStop[];
  from: Vec2;
  to: Vec2;
}

/** Füllung: Volltonfarbe '#rrggbb' oder Farbverlauf */
export type Paint = string | Gradient;

/** Darstellungsstil eines zeichenbaren Objekts. Farben als '#rrggbb', null = keine. */
export interface Style {
  fill: Paint | null;
  stroke: string | null;
  /** Konturstärke in mm */
  strokeWidth: number;
  /** Deckkraft 0…1 */
  opacity: number;
  /** Linienenden */
  lineCap?: 'butt' | 'round' | 'square';
  /** Linientyp */
  dash?: 'solid' | 'dashed' | 'dotted';
}

export interface SketchPoint {
  id: Id;
  x: number;
  y: number;
  /** Objekt, zu dem der Punkt gehört (Linienende, Kreismittelpunkt, Textanker …). */
  owner?: Id;
  /** Hilfspunkt (z. B. Rechteckmitte) – wird nie exportiert. */
  construction?: boolean;
  /** Unveränderlich fest (nur der Ursprung). */
  locked?: boolean;
}

interface EntityBase {
  id: Id;
  /** Konstruktionsgeometrie: gestrichelt, wird nie exportiert. */
  construction: boolean;
  style: Style;
  /** Ebene (fehlt = erste Ebene) */
  layer?: Id;
  /** Gruppe: Objekte mit derselben Gruppen-Id werden zusammen ausgewählt */
  group?: Id;
}

export interface LineEntity extends EntityBase {
  kind: 'line';
  p1: Id;
  p2: Id;
}

export interface CircleEntity extends EntityBase {
  kind: 'circle';
  center: Id;
  /** Radius in mm */
  r: number;
}

export type TextAlign = 'left' | 'center' | 'right';

export interface TextEntity extends EntityBase {
  kind: 'text';
  /** Ankerpunkt auf der Grundlinie (links, mittig oder rechts je nach align) */
  anchor: Id;
  text: string;
  fontFamily: string;
  /** Schriftgröße (Geviert) in mm */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: TextAlign;
}

export interface PathEdge {
  /** Id einer Linie */
  id: Id;
  /** true = Kante wird von p2 nach p1 durchlaufen */
  reversed: boolean;
}

/**
 * Geschlossener (oder offener) Pfad aus Linien. Der Pfad trägt den Stil;
 * die Linien selbst werden dann nicht einzeln gezeichnet oder exportiert.
 */
export interface PathEntity extends EntityBase {
  kind: 'path';
  edges: PathEdge[];
  closed: boolean;
}

/** Knoten einer Form: Punkt plus optionale Bézier-Griffe (absolut, lokale Koordinaten). */
export interface ShapeNode {
  x: number;
  y: number;
  /** Griff vor dem Knoten */
  ix?: number;
  iy?: number;
  /** Griff nach dem Knoten */
  ox?: number;
  oy?: number;
}

export interface Contour {
  closed: boolean;
  nodes: ShapeNode[];
}

/**
 * Freie Form (Ergebnis von „Text in Pfade“, booleschen Operationen, Versatz …).
 * Die Kontur liegt in lokalen Koordinaten (mm, Y nach oben) um den Ankerpunkt; Lage über den
 * Anker (vom Solver bemaßbar), Größe über `scale`, Drehung in Grad, Spiegeln über `flipX`.
 * Mehrere Konturen bilden Löcher nach der Füllregel.
 */
export interface ShapeEntity extends EntityBase {
  kind: 'shape';
  anchor: Id;
  contours: Contour[];
  fillRule: 'nonzero' | 'evenodd';
  scale: number;
  rotation: number;
  flipX?: boolean;
  /** Ursprung, z. B. „Text TEAM“ */
  name?: string;
}

export type Entity = LineEntity | CircleEntity | TextEntity | PathEntity | ShapeEntity;

export interface Layer {
  id: Id;
  name: string;
  visible: boolean;
  locked: boolean;
}
export type EntityKind = Entity['kind'];

export type ConstraintKind =
  | 'coincident'
  | 'horizontal'
  | 'vertical'
  | 'parallel'
  | 'perpendicular'
  | 'collinear'
  | 'tangent'
  | 'concentric'
  | 'equal'
  | 'symmetric'
  | 'midpoint'
  | 'fix';

/**
 * Geometrische Abhängigkeit. refs je Art:
 * - coincident:    [Punkt, Punkt | Linie | Kreis]
 * - horizontal/vertical: [Linie] oder [Punkt, Punkt]
 * - parallel/perpendicular/collinear: [Linie, Linie]
 * - tangent:       [Linie, Kreis] | [Kreis, Kreis]
 * - concentric:    [Kreis, Kreis] | [Kreis, Punkt]
 * - equal:         [Linie, Linie] | [Kreis, Kreis]
 * - symmetric:     [Punkt, Punkt, Achse(Linie) | Mittelpunkt(Punkt)]
 * - midpoint:      [Punkt, Linie]
 * - fix:           [Punkt]  (fixedAt = [x, y]) oder [Kreis] (fixedAt = [x, y, r])
 */
export interface Constraint {
  id: Id;
  kind: ConstraintKind;
  refs: Id[];
  fixedAt?: number[];
}

/**
 * Bemaßungsarten. refs je Art:
 * - distance:  [Punkt A, Punkt B]           ausgerichteter Abstand |AB|
 * - distanceX: [Punkt A, Punkt B]           horizontal: B.x − A.x (> 0)
 * - distanceY: [Punkt A, Punkt B]           vertikal:   B.y − A.y (> 0)
 * - pointLine: [Punkt, Linie]               senkrechter Abstand
 * - lineLine:  [Linie A, Linie B]           Abstand paralleler Linien (B.p1 zu A)
 * - radius / diameter: [Kreis]
 * - angle:     [A1, A2, B1, B2] (Punkte)    Winkel von A1→A2 nach B1→B2, gegen den Uhrzeigersinn
 * - angleX:    [Punkt A, Punkt B]           Winkel von A→B zur X-Achse
 * - width / height: [Form]                  Breite/Höhe einer Form (steuert deren Maßstab, nicht der Solver)
 */
export type DimensionKind =
  | 'distance'
  | 'distanceX'
  | 'distanceY'
  | 'pointLine'
  | 'lineLine'
  | 'radius'
  | 'diameter'
  | 'angle'
  | 'angleX'
  | 'width'
  | 'height';

export interface Dimension {
  id: Id;
  /** Parametername, z. B. d0 */
  name: string;
  kind: DimensionKind;
  refs: Id[];
  /** Eingegebener Ausdruck, z. B. "80", "20+5", "d1*2" */
  expr: string;
  /** Aktueller Wert in mm bzw. Grad */
  value: number;
  /** Getriebene Bemaßung (Referenz, in Klammern) – steuert nichts */
  driven: boolean;
  /** Platzierung: Abstand der Maßlinie (mm) bzw. Bogenradius / Textabstand */
  offset: number;
  /** Platzierung: Verschiebung des Textes entlang der Maßlinie (mm) */
  shift: number;
  /** Platzierung von Radius/Durchmesser: Richtung der Maßlinie (Bogenmaß) */
  angle?: number;
}

export interface SketchDoc {
  format: 'vektordesign';
  version: 1;
  name: string;
  points: Record<Id, SketchPoint>;
  entities: Record<Id, Entity>;
  constraints: Record<Id, Constraint>;
  dims: Record<Id, Dimension>;
  /** Zeichenreihenfolge der sichtbaren Objekte, hinten → vorne (innerhalb der Ebenen) */
  order: Id[];
  /** Ebenen, unten → oben. Fehlt in alten Dateien (dann eine Ebene „Motiv“). */
  layers?: Layer[];
  /** Zähler für eindeutige Ids */
  nextId: number;
  /** Zähler für Bemaßungsnamen d0, d1 … */
  nextDim: number;
}

export const ORIGIN_ID = 'O';

export type SketchStatus = 'empty' | 'under' | 'full' | 'over';
