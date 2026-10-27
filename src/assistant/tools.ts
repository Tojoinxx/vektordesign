import type { ConstraintKind, DimensionKind, Gradient, Id, SketchDoc, Style, Vec2 } from '../model/types';
import { ORIGIN_ID } from '../model/types';
import { circleOf, lineOf, pathOfLine, pathVertices, pt } from '../model/doc';
import { entityBBox } from '../model/bounds';
import { bboxValid, dist } from '../model/geometry';
import { makeGradient, type GradientDirection } from '../model/paint';
import { normalizeHex } from '../model/color';
import { allColors, motifSize, productionOf } from '../model/production';
import { areaOf, garmentOf, TECHNIQUES } from '../model/garments';
import { numberToExpr } from '../params/expr';
import type { Analysis } from '../solver/analysis';
import type { CommitOutcome, Editor, PlacedPoint } from '../store/editor';
import { drawableTargets } from '../store/editor';
import { linearSpec, angleSpec } from '../tools/dimensionTool';
import type { ContentBlock, ToolDef } from './api';

/** Was der Agent von der App braucht. */
export interface AgentHost {
  editor: Editor;
  /** PNG-Vorschau des Designs (base64) */
  renderPreview(): Promise<{ base64: string } | null>;
  openExport(format: 'svg' | 'png', dpi?: number): void;
  fitView(): void;
}

export interface ToolRun {
  /** Inhalt für Claude */
  content: string | ContentBlock[];
  isError?: boolean;
  /** Kurzzeile für den Chatverlauf (deutsch) */
  summary: string;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pair = (p: Vec2) => [r3(p.x), r3(p.y)];

const COLOR = { type: 'string', description: 'Color as #rrggbb, or "none".' };
const TARGETS = { type: 'array', items: { type: 'string' }, description: 'Object ids from get_sketch (points p…, lines l…, circles c…, texts t…, paths pa…, dimensions dim…/d0, constraints k…).' };
const GRADIENT = {
  type: 'object',
  description: 'Gradient fill. Use fade=true to let the first color fade into transparency.',
  properties: {
    type: { type: 'string', enum: ['linear', 'radial'] },
    colors: { type: 'array', items: { type: 'string' }, description: '2–5 colors #rrggbb, evenly spaced from start to end' },
    direction: { type: 'string', enum: ['left_to_right', 'right_to_left', 'top_to_bottom', 'bottom_to_top', 'center'] },
    fade: { type: 'boolean', description: 'true = last stop fully transparent (Verblassen)' },
  },
  required: ['colors'],
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'get_sketch',
    description:
      'Return the current sketch as JSON: objects with ids, coordinates (mm, Y up), styles, dimensions (names d0, d1… with values/expressions), constraints, selection and the constraint status (degrees of freedom). Call this first when you need ids or positions.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'draw_rectangle',
    description:
      'Draw a filled/stroked rectangle (4 lines with horizontal/vertical constraints, a closed path and a construction center point). If the center (or corner) lies exactly on an existing point such as the origin (0,0) it is attached with a coincident constraint. With dimension=true (default) width/height become driving dimensions.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'mm' },
        y: { type: 'number', description: 'mm' },
        width: { type: 'number', description: 'mm, > 0' },
        height: { type: 'number', description: 'mm, > 0' },
        anchor: { type: 'string', enum: ['center', 'corner'], description: 'center: (x,y) is the center; corner: (x,y) is the lower-left corner' },
        dimension: { type: 'boolean' },
        fill: COLOR,
        stroke: COLOR,
        stroke_width: { type: 'number', description: 'mm' },
        construction: { type: 'boolean', description: 'Construction geometry (dashed, never exported)' },
      },
      required: ['x', 'y', 'width', 'height'],
    },
  },
  {
    name: 'draw_circle',
    description:
      'Draw a circle. If the center lies exactly on an existing point (origin, rectangle center, another circle center) it is attached (coincident/concentric). With dimension=true (default) the diameter becomes a driving dimension.',
    input_schema: {
      type: 'object',
      properties: {
        cx: { type: 'number' },
        cy: { type: 'number' },
        diameter: { type: 'number', description: 'mm, > 0' },
        dimension: { type: 'boolean' },
        fill: COLOR,
        stroke: COLOR,
        stroke_width: { type: 'number' },
        construction: { type: 'boolean' },
      },
      required: ['cx', 'cy', 'diameter'],
    },
  },
  {
    name: 'draw_polyline',
    description:
      'Draw connected straight lines through points [[x,y],…] (mm). closed=true closes the shape and creates a fillable closed path (use this for triangles, stars, letters, polygons, arrows, approximated curves with many points). Exactly horizontal/vertical segments get H/V constraints. Points that land exactly on existing points are attached.',
    input_schema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, minItems: 2 },
        closed: { type: 'boolean' },
        dimension_lengths: { type: 'boolean', description: 'add a driving length dimension per segment' },
        fill: COLOR,
        stroke: COLOR,
        stroke_width: { type: 'number' },
        construction: { type: 'boolean' },
      },
      required: ['points'],
    },
  },
  {
    name: 'add_text',
    description: 'Place text. (x,y) is the baseline anchor (left/center/right per align). font_size_mm is the em size in mm (cap height ≈ 0.7 × size).',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        font_size_mm: { type: 'number' },
        font_family: { type: 'string', description: 'Installed font, e.g. Arial, Impact, Georgia, Segoe UI, Bahnschrift' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        align: { type: 'string', enum: ['left', 'center', 'right'] },
        color: COLOR,
      },
      required: ['text', 'x', 'y', 'font_size_mm'],
    },
  },
  {
    name: 'add_dimension',
    description:
      'Add a dimension (Inventor-style). type length|horizontal|vertical|aligned: targets [line] or [point, point]; point_line: [point, line]; line_line: [line, line] (parallel); radius|diameter: [circle]; angle: [line, line]. value is an expression in mm (or degrees for angle), e.g. "80", "20+5", "d0*2". Omit value to keep the current size. driven=true creates a reference dimension that does not drive geometry. Fails with a message if the sketch would become over-constrained.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['length', 'horizontal', 'vertical', 'aligned', 'point_line', 'line_line', 'radius', 'diameter', 'angle'] },
        targets: TARGETS,
        value: { type: 'string' },
        driven: { type: 'boolean' },
      },
      required: ['type', 'targets'],
    },
  },
  {
    name: 'set_dimension',
    description: 'Change the value/expression of an existing driving dimension by its name (d0, d1…) or id. Geometry follows automatically.',
    input_schema: { type: 'object', properties: { dimension: { type: 'string' }, value: { type: 'string' } }, required: ['dimension', 'value'] },
  },
  {
    name: 'add_constraint',
    description:
      'Add a geometric constraint. coincident [point, point|line|circle]; horizontal/vertical [line] or [point, point]; parallel/perpendicular/collinear/equal [line, line]; equal [circle, circle]; tangent [line, circle] or [circle, circle]; concentric [circle, circle|point]; symmetric [point, point, axis_line] or [line, line, axis_line]; midpoint [point, line]; fix [point|line|circle].',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'tangent', 'concentric', 'equal', 'symmetric', 'midpoint', 'fix'],
        },
        targets: TARGETS,
      },
      required: ['type', 'targets'],
    },
  },
  {
    name: 'set_style',
    description: 'Change fill (color or gradient), stroke, stroke width (mm), opacity (0–1), line cap and dash of objects. Lines that belong to a closed path style the whole path.',
    input_schema: {
      type: 'object',
      properties: {
        targets: TARGETS,
        fill: COLOR,
        gradient: GRADIENT,
        stroke: COLOR,
        stroke_width: { type: 'number' },
        opacity: { type: 'number' },
        line_cap: { type: 'string', enum: ['butt', 'round', 'square'] },
        dash: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
      },
      required: ['targets'],
    },
  },
  {
    name: 'set_text',
    description: 'Change text content or typography of a text object.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string' },
        text: { type: 'string' },
        font_family: { type: 'string' },
        font_size_mm: { type: 'number' },
        bold: { type: 'boolean' },
        italic: { type: 'boolean' },
        align: { type: 'string', enum: ['left', 'center', 'right'] },
      },
      required: ['target'],
    },
  },
  {
    name: 'move',
    description: 'Move objects by dx, dy (mm). Constraints are respected: fully constrained geometry does not move – change its dimensions instead.',
    input_schema: { type: 'object', properties: { targets: TARGETS, dx: { type: 'number' }, dy: { type: 'number' } }, required: ['targets', 'dx', 'dy'] },
  },
  {
    name: 'arrange',
    description: 'Change stacking order: front (topmost), back (bottom), forward, backward.',
    input_schema: { type: 'object', properties: { targets: TARGETS, order: { type: 'string', enum: ['front', 'back', 'forward', 'backward'] } }, required: ['targets', 'order'] },
  },
  {
    name: 'duplicate',
    description: 'Duplicate objects (with their internal constraints and dimensions), offset by dx, dy mm (default 10, -10).',
    input_schema: { type: 'object', properties: { targets: TARGETS, dx: { type: 'number' }, dy: { type: 'number' } }, required: ['targets'] },
  },
  {
    name: 'delete',
    description: 'Delete objects, dimensions or constraints.',
    input_schema: { type: 'object', properties: { targets: TARGETS }, required: ['targets'] },
  },
  {
    name: 'set_construction',
    description: 'Toggle objects between normal and construction geometry (construction = dashed helper, never exported).',
    input_schema: { type: 'object', properties: { targets: TARGETS }, required: ['targets'] },
  },
  {
    name: 'select',
    description: 'Highlight objects for the user (selection).',
    input_schema: { type: 'object', properties: { targets: TARGETS }, required: ['targets'] },
  },
  {
    name: 'view_image',
    description: 'Render the current design (without dimensions/glyphs) as an image so you can check the visual result.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'undo',
    description: 'Undo the last change.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_production',
    description: 'Production data for LabwearOS: article, version, garment, motifs (placement on the garment, finishing technique), color variants, Pantone notes, available print areas and techniques.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'set_production',
    description:
      'Change production data. Placement: area id (e.g. chest-left = wearer\'s left chest), or x (mm from center line, + = right in the image) and y (mm from collar seam to top edge of motif). Variants: list replaces all variants; colors maps original design colors to print colors. pantone: map print color #rrggbb → Pantone code text (free text only).',
    input_schema: {
      type: 'object',
      properties: {
        article: { type: 'string' },
        version: { type: 'string' },
        garment: { type: 'string', enum: ['hoodie', 'tshirt', 'sweatshirt', 'cap'] },
        motif_index: { type: 'number', description: 'Motif to change (default 0)' },
        motif_name: { type: 'string' },
        technique: { type: 'string', enum: ['screen', 'dtg', 'puff', 'embroidery', 'patch', 'silicone', 'sublimation', 'transfer', 'emboss', 'allover'] },
        area: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        variants: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, fabric: COLOR, fabric_name: { type: 'string' }, colors: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['name', 'fabric'] },
        },
        pantone: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  },
  {
    name: 'open_export_dialog',
    description: 'Open the export dialog for the user (they confirm the file location). PNG dpi ≥ 300.',
    input_schema: { type: 'object', properties: { format: { type: 'string', enum: ['svg', 'png'] }, dpi: { type: 'number' } }, required: ['format'] },
  },
];

// ---------------------------------------------------------------------------
// Zustand für Claude
// ---------------------------------------------------------------------------

function styleJson(s: Style) {
  return {
    fill: s.fill === null ? 'none' : typeof s.fill === 'string' ? s.fill : { gradient: s.fill.kind, stops: s.fill.stops.map((x) => [x.color, r3(x.offset), r3(x.opacity)]) },
    stroke: s.stroke ?? 'none',
    stroke_width: s.strokeWidth,
    ...(s.opacity < 1 ? { opacity: s.opacity } : {}),
  };
}

export function sketchSummary(doc: SketchDoc, analysis: Analysis, selection: Id[]): Record<string, unknown> {
  const objects: Record<string, unknown>[] = [];
  const lines: Record<string, unknown>[] = [];
  for (const e of Object.values(doc.entities)) {
    if (e.kind === 'line') {
      const path = pathOfLine(doc, e.id);
      lines.push({
        id: e.id,
        p1: e.p1,
        p2: e.p2,
        from: pair(pt(doc, e.p1)),
        to: pair(pt(doc, e.p2)),
        ...(path ? { in_path: path.id } : { ...styleJson(e.style) }),
        ...(e.construction ? { construction: true } : {}),
      });
      continue;
    }
    const box = entityBBox(doc, e);
    const bbox = bboxValid(box) ? [r3(box.minX), r3(box.minY), r3(box.maxX), r3(box.maxY)] : null;
    if (e.kind === 'circle') {
      objects.push({ id: e.id, type: 'circle', center_point: e.center, center: pair(pt(doc, e.center)), diameter: r3(e.r * 2), ...styleJson(e.style), ...(e.construction ? { construction: true } : {}) });
    } else if (e.kind === 'text') {
      objects.push({
        id: e.id,
        type: 'text',
        text: e.text,
        anchor_point: e.anchor,
        position: pair(pt(doc, e.anchor)),
        font: e.fontFamily,
        size_mm: e.fontSize,
        bold: e.fontWeight >= 600,
        italic: e.italic,
        align: e.align,
        bbox,
        ...styleJson(e.style),
      });
    } else if (e.kind === 'path') {
      const helpers = Object.values(doc.points).filter((p) => p.owner === e.id).map((p) => p.id);
      objects.push({
        id: e.id,
        type: e.closed ? 'closed_path' : 'open_path',
        edges: e.edges.map((x) => x.id),
        vertices: pathVertices(doc, e).map(pair),
        ...(helpers.length ? { center_point: helpers[0] } : {}),
        bbox,
        ...styleJson(e.style),
      });
    }
  }
  const points = Object.values(doc.points)
    .filter((p) => !p.owner || doc.entities[p.owner]?.kind === 'path')
    .map((p) => ({ id: p.id, at: pair(p), role: p.id === ORIGIN_ID ? 'origin (fixed)' : p.owner ? 'shape center (construction)' : p.construction ? 'construction point' : 'sketch point' }));
  return {
    units: 'mm',
    y_axis: 'up',
    status: analysis.status,
    degrees_of_freedom: analysis.dof,
    status_message: analysis.detail || analysis.label,
    draw_order_back_to_front: doc.order,
    objects,
    lines,
    points,
    dimensions: Object.values(doc.dims).map((d) => ({ id: d.id, name: d.name, type: d.kind, targets: d.refs, value: r3(d.value), expression: d.expr, driven: d.driven })),
    constraints: Object.values(doc.constraints).map((c) => ({ id: c.id, type: c.kind, targets: c.refs })),
    selection,
  };
}

// ---------------------------------------------------------------------------
// Ausführung
// ---------------------------------------------------------------------------

/** Vorhandener Punkt genau an dieser Stelle (Ursprung bevorzugt). */
function pointAt(doc: SketchDoc, pos: Vec2, exclude: Set<Id> = new Set()): Id | null {
  const tol = 1e-6;
  if (dist(doc.points[ORIGIN_ID], pos) < tol) return ORIGIN_ID;
  let best: Id | null = null;
  for (const p of Object.values(doc.points)) {
    if (exclude.has(p.id) || p.id === ORIGIN_ID) continue;
    if (dist(p, pos) < tol) {
      const owner = p.owner ? doc.entities[p.owner] : undefined;
      // Mittelpunkte (Rechteck/Kreis) und freie Punkte bevorzugen
      if (!owner || owner.kind === 'path' || owner.kind === 'circle') return p.id;
      best = best ?? p.id;
    }
  }
  return best;
}

function placed(doc: SketchDoc, pos: Vec2): PlacedPoint {
  const id = pointAt(doc, pos);
  return { pos, snap: id ? { kind: 'point', id } : null };
}

const num = (v: unknown, name: string): number => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${name} muss eine Zahl sein`);
  return v;
};

function colorOrNull(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === 'none' || v === '') return null;
  const hex = normalizeHex(String(v));
  if (!hex) throw new Error(`Ungültige Farbe „${String(v)}“ (erwartet #rrggbb)`);
  return hex;
}

const DIRS: Record<string, GradientDirection> = {
  left_to_right: 'lr',
  right_to_left: 'rl',
  top_to_bottom: 'tb',
  bottom_to_top: 'bt',
  center: 'center',
};

export function gradientFromInput(g: Record<string, unknown>): Gradient {
  const colors = (Array.isArray(g.colors) ? g.colors : []).map((c) => colorOrNull(c)).filter((c): c is string => !!c);
  if (!colors.length) throw new Error('Verlauf braucht mindestens eine Farbe');
  const fade = g.fade === true;
  const list = colors.length === 1 && !fade ? [colors[0], colors[0]] : colors;
  const stops = list.map((color, i) => ({ offset: list.length === 1 ? 0 : i / (list.length - 1), color, opacity: 1 }));
  if (fade) {
    if (stops.length === 1) stops.push({ offset: 1, color: stops[0].color, opacity: 0 });
    else stops[stops.length - 1].opacity = 0;
  }
  const dir = DIRS[String(g.direction ?? 'left_to_right')] ?? 'lr';
  return makeGradient(stops, dir, g.type === 'radial' ? 'radial' : dir === 'center' ? 'radial' : 'linear');
}

function styleFrom(input: Record<string, unknown>, base: Style): Style {
  const s: Style = { ...base };
  const fill = colorOrNull(input.fill);
  if (fill !== undefined) s.fill = fill;
  const stroke = colorOrNull(input.stroke);
  if (stroke !== undefined) s.stroke = stroke;
  if (typeof input.stroke_width === 'number') s.strokeWidth = Math.max(0, input.stroke_width);
  return s;
}

function outcomeText(o: CommitOutcome): string | null {
  return o.ok ? null : o.message;
}

function statusLine(ed: Editor): string {
  const a = ed.s.analysis;
  return `Sketch status: ${a.status === 'full' ? 'fully constrained' : a.status === 'under' ? `under-constrained (${a.dof} degrees of freedom left)` : a.status === 'over' ? `OVER-CONSTRAINED: ${a.detail}` : 'empty'}.`;
}

/** Bemaßungsziele in Editor-Spezifikation übersetzen. */
function dimensionSpec(doc: SketchDoc, type: string, targets: Id[]) {
  const t = targets;
  const isLine = (id: Id) => !!lineOf(doc, id);
  const isCircle = (id: Id) => !!circleOf(doc, id);
  const isPoint = (id: Id) => !!doc.points[id];
  const pts = (): [Id, Id] | null => {
    if (t.length === 1 && isLine(t[0])) {
      const l = lineOf(doc, t[0])!;
      return [l.p1, l.p2];
    }
    if (t.length === 2 && isPoint(t[0]) && isPoint(t[1])) return [t[0], t[1]];
    return null;
  };
  switch (type) {
    case 'length':
    case 'horizontal':
    case 'vertical':
    case 'aligned': {
      const p = pts();
      if (!p) throw new Error(`${type}: eine Linie oder zwei Punkte angeben`);
      const A = pt(doc, p[0]);
      const B = pt(doc, p[1]);
      if (type === 'aligned') return linearSpec(doc, p[0], p[1], A, true);
      if (type === 'horizontal') return { kind: 'distanceX' as DimensionKind, refs: B.x >= A.x ? [p[0], p[1]] : [p[1], p[0]], offset: -8 };
      if (type === 'vertical') return { kind: 'distanceY' as DimensionKind, refs: B.y >= A.y ? [p[0], p[1]] : [p[1], p[0]], offset: 8 };
      // length: nach Lage der Linie
      const dx = Math.abs(B.x - A.x);
      const dy = Math.abs(B.y - A.y);
      if (dy < 1e-6) return { kind: 'distanceX' as DimensionKind, refs: B.x >= A.x ? [p[0], p[1]] : [p[1], p[0]], offset: -8 };
      if (dx < 1e-6) return { kind: 'distanceY' as DimensionKind, refs: B.y >= A.y ? [p[0], p[1]] : [p[1], p[0]], offset: 8 };
      return { kind: 'distance' as DimensionKind, refs: [p[0], p[1]], offset: 8 };
    }
    case 'point_line': {
      const [a, b] = t;
      const [p, l] = isPoint(a) ? [a, b] : [b, a];
      if (!isPoint(p) || !isLine(l)) throw new Error('point_line: einen Punkt und eine Linie angeben');
      return { kind: 'pointLine' as DimensionKind, refs: [p, l], offset: 0 };
    }
    case 'line_line':
      if (t.length !== 2 || !isLine(t[0]) || !isLine(t[1])) throw new Error('line_line: zwei Linien angeben');
      return { kind: 'lineLine' as DimensionKind, refs: [t[0], t[1]], offset: 0 };
    case 'radius':
    case 'diameter':
      if (t.length !== 1 || !isCircle(t[0])) throw new Error(`${type}: einen Kreis angeben`);
      return { kind: type as DimensionKind, refs: [t[0]], offset: 0, angle: Math.PI / 4 };
    case 'angle': {
      if (t.length !== 2 || !isLine(t[0]) || !isLine(t[1])) throw new Error('angle: zwei Linien angeben');
      const a = lineOf(doc, t[0])!;
      const b = lineOf(doc, t[1])!;
      // Maus in die Winkelhalbierende der angegebenen Richtungen legen → kleiner Winkel
      const A1 = pt(doc, a.p1);
      const A2 = pt(doc, a.p2);
      const B1 = pt(doc, b.p1);
      const B2 = pt(doc, b.p2);
      const ua = { x: A2.x - A1.x, y: A2.y - A1.y };
      const ub = { x: B2.x - B1.x, y: B2.y - B1.y };
      const la = Math.hypot(ua.x, ua.y) || 1;
      const lb = Math.hypot(ub.x, ub.y) || 1;
      const bis = { x: ua.x / la + ub.x / lb, y: ua.y / la + ub.y / lb };
      const den = ua.x * ub.y - ua.y * ub.x;
      let V: Vec2 = { x: A1.x, y: A1.y };
      if (Math.abs(den) > 1e-12) {
        const tt = ((B1.x - A1.x) * ub.y - (B1.y - A1.y) * ub.x) / den;
        V = { x: A1.x + ua.x * tt, y: A1.y + ua.y * tt };
      }
      const cursor = { x: V.x + bis.x * 10, y: V.y + bis.y * 10 };
      const spec = angleSpec(doc, a.p1, a.p2, b.p1, b.p2, cursor);
      if (!spec) throw new Error('angle: Linien sind parallel');
      return spec;
    }
  }
  throw new Error(`Unbekannte Bemaßungsart „${type}“`);
}

/** Führt einen Werkzeugaufruf von Claude aus. */
export async function runTool(host: AgentHost, name: string, input: Record<string, unknown>): Promise<ToolRun> {
  const ed = host.editor;
  const doc = ed.s.doc;
  const fail = (msg: string, summary?: string): ToolRun => ({ content: `Error: ${msg}`, isError: true, summary: summary ?? `✗ ${msg}` });
  try {
    switch (name) {
      case 'get_sketch': {
        return { content: JSON.stringify(sketchSummary(doc, ed.s.analysis, ed.s.selection)), summary: 'Zeichnung gelesen' };
      }
      case 'draw_rectangle': {
        const x = num(input.x, 'x');
        const y = num(input.y, 'y');
        const w = num(input.width, 'width');
        const h = num(input.height, 'height');
        if (w <= 0 || h <= 0) return fail('width und height müssen > 0 sein');
        const center = input.anchor !== 'corner';
        const p1 = placed(doc, { x, y });
        const p2: PlacedPoint = center ? { pos: { x: x + w / 2, y: y + h / 2 } } : { pos: { x: x + w, y: y + h } };
        if (!center) {
          const c2 = pointAt(doc, p2.pos);
          if (c2) p2.snap = { kind: 'point', id: c2 };
        }
        const style = styleFrom(input, ed.s.currentStyle);
        const dimension = input.dimension !== false;
        const out = ed.createRectangle(p1, p2, center ? 'center' : 'corner', {
          width: dimension ? numberToExpr(w) : null,
          height: dimension ? numberToExpr(h) : null,
          construction: input.construction === true,
          style,
        });
        const err = outcomeText(out);
        if (err || !out.ok) return fail(err ?? 'Rechteck fehlgeschlagen');
        const d = ed.s.doc;
        const dims = [out.widthDim, out.heightDim].filter(Boolean).map((id) => d.dims[id!]?.name);
        return {
          content: `Created rectangle: path ${out.pathId ?? '(construction)'}, lines ${out.lineIds!.join(', ')} (bottom, right, top, left), center point ${out.centerId}${dims.length ? `, dimensions ${dims.join(', ')} (width, height)` : ''}. ${statusLine(ed)}`,
          summary: `Rechteck ${numberToExpr(w)} × ${numberToExpr(h)} mm`,
        };
      }
      case 'draw_circle': {
        const cx = num(input.cx, 'cx');
        const cy = num(input.cy, 'cy');
        const dia = num(input.diameter, 'diameter');
        if (dia <= 0) return fail('diameter muss > 0 sein');
        const style = styleFrom(input, ed.s.currentStyle);
        const out = ed.createCircle(placed(doc, { x: cx, y: cy }), dia / 2, {
          diameter: input.dimension === false ? null : numberToExpr(dia),
          construction: input.construction === true,
          style,
        });
        const err = outcomeText(out);
        if (err || !out.ok) return fail(err ?? 'Kreis fehlgeschlagen');
        const dimName = out.dimId ? ed.s.doc.dims[out.dimId]?.name : null;
        return {
          content: `Created circle ${out.circleId} (center point ${(ed.s.doc.entities[out.circleId!] as { center: string }).center})${dimName ? `, diameter dimension ${dimName}` : ''}. ${statusLine(ed)}`,
          summary: `Kreis Ø${numberToExpr(dia)} mm`,
        };
      }
      case 'draw_polyline': {
        const raw = input.points;
        if (!Array.isArray(raw) || raw.length < 2) return fail('points braucht mindestens 2 Punkte');
        const ptsIn: Vec2[] = raw.map((p, i) => {
          if (!Array.isArray(p) || p.length < 2) throw new Error(`Punkt ${i} ungültig`);
          return { x: num(p[0], `points[${i}][0]`), y: num(p[1], `points[${i}][1]`) };
        });
        const closed = input.closed === true && ptsIn.length >= 3;
        // doppelten Schlusspunkt entfernen
        if (closed && dist(ptsIn[0], ptsIn[ptsIn.length - 1]) < 1e-9) ptsIn.pop();
        const style = styleFrom(input, ed.s.currentStyle);
        const construction = input.construction === true;
        const lineIds: Id[] = [];
        let prevEnd: Id | null = null;
        let firstPoint: Id | null = null;
        const segs = closed ? ptsIn.length : ptsIn.length - 1;
        for (let i = 0; i < segs; i++) {
          const a = ptsIn[i];
          const b = ptsIn[(i + 1) % ptsIn.length];
          if (dist(a, b) < 1e-9) continue;
          const cur = ed.s.doc;
          const start = prevEnd ? { pos: a } : placed(cur, a);
          let end: PlacedPoint = placed(cur, b);
          if (closed && i === segs - 1 && firstPoint) end = { pos: b, snap: { kind: 'point', id: firstPoint } };
          const hv = Math.abs(a.y - b.y) < 1e-9 ? 'h' : Math.abs(a.x - b.x) < 1e-9 ? 'v' : null;
          const out = ed.createLine(start, end, {
            prevEnd,
            hv,
            length: input.dimension_lengths === true ? numberToExpr(dist(a, b)) : null,
            construction,
            style,
          });
          if (!out.ok || !out.line) return fail(outcomeText(out) ?? `Segment ${i + 1} fehlgeschlagen`);
          lineIds.push(out.line.id);
          if (!firstPoint) firstPoint = out.line.p1;
          prevEnd = out.line.p2;
        }
        let pathId: Id | undefined;
        if (closed && !construction && lineIds.length >= 2) {
          const p = ed.createPathFromLines(lineIds, true, style);
          pathId = p.pathId;
        }
        return {
          content: `Created ${lineIds.length} lines (${lineIds.join(', ')})${pathId ? ` forming closed path ${pathId}` : ''}. ${statusLine(ed)}`,
          summary: closed ? `Geschlossene Form (${lineIds.length} Kanten)` : `Linienzug (${lineIds.length} Linien)`,
        };
      }
      case 'add_text': {
        const out = ed.createText(placed(doc, { x: num(input.x, 'x'), y: num(input.y, 'y') }), String(input.text ?? ''), {
          fontSize: num(input.font_size_mm, 'font_size_mm'),
          fontFamily: typeof input.font_family === 'string' ? input.font_family : undefined,
          fontWeight: input.bold === false ? 400 : input.bold === true ? 700 : undefined,
          italic: input.italic === true,
          align: input.align === 'center' || input.align === 'right' ? input.align : 'left',
          style: { fill: colorOrNull(input.color) ?? '#1e2328', stroke: null, strokeWidth: 0.3, opacity: 1 },
        });
        if (!out.ok) return fail(out.message);
        return { content: `Created text ${out.textId}. ${statusLine(ed)}`, summary: `Text „${String(input.text).slice(0, 24)}“` };
      }
      case 'add_dimension': {
        const targets = (input.targets as Id[]) ?? [];
        const spec = dimensionSpec(doc, String(input.type), targets);
        const value = typeof input.value === 'string' ? input.value : typeof input.value === 'number' ? numberToExpr(input.value) : undefined;
        const out = ed.addDimension(spec, { expr: value, driven: input.driven === true });
        if (!out.ok) return fail(out.message);
        const dim = ed.s.doc.dims[out.dimId!];
        return { content: `Created dimension ${dim.name} (${dim.kind}) = ${dim.expr}${dim.driven ? ' (driven)' : ''}. ${statusLine(ed)}`, summary: `Bemaßung ${dim.name} = ${dim.expr}` };
      }
      case 'set_dimension': {
        const key = String(input.dimension);
        const dim = Object.values(doc.dims).find((d) => d.name === key || d.id === key);
        if (!dim) return fail(`Bemaßung „${key}“ nicht gefunden`);
        const value = typeof input.value === 'number' ? numberToExpr(input.value) : String(input.value);
        const out = ed.setDimensionExpr(dim.id, value);
        if (!out.ok) return fail(out.message);
        return { content: `${dim.name} = ${value}. ${statusLine(ed)}`, summary: `${dim.name} = ${value}` };
      }
      case 'add_constraint': {
        const out = ed.addConstraint(String(input.type) as ConstraintKind, (input.targets as Id[]) ?? []);
        if (!out.ok) return fail(out.message);
        return { content: `Added constraint ${out.ids?.join(', ')}. ${statusLine(ed)}`, summary: `Abhängigkeit „${String(input.type)}“` };
      }
      case 'set_style': {
        const targets = resolveTargets(doc, input.targets);
        const patch: Partial<Style> = {};
        if (input.gradient && typeof input.gradient === 'object') patch.fill = gradientFromInput(input.gradient as Record<string, unknown>);
        else {
          const f = colorOrNull(input.fill);
          if (f !== undefined) patch.fill = f;
        }
        const st = colorOrNull(input.stroke);
        if (st !== undefined) patch.stroke = st;
        if (typeof input.stroke_width === 'number') patch.strokeWidth = Math.max(0, input.stroke_width);
        if (typeof input.opacity === 'number') patch.opacity = Math.min(1, Math.max(0, input.opacity));
        if (input.line_cap === 'butt' || input.line_cap === 'round' || input.line_cap === 'square') patch.lineCap = input.line_cap;
        if (input.dash === 'solid' || input.dash === 'dashed' || input.dash === 'dotted') patch.dash = input.dash;
        const drawables = drawableTargets(doc, targets);
        if (!drawables.length) return fail('Keine gültigen Objekte für set_style (ids aus get_sketch verwenden)');
        const out = ed.setStyle(drawables, patch);
        if (!out.ok) return fail(out.message);
        return { content: `Styled ${drawables.join(', ')}.`, summary: `Stil für ${drawables.length} Objekt${drawables.length === 1 ? '' : 'e'}` };
      }
      case 'set_text': {
        const id = String(input.target);
        const e = doc.entities[id];
        if (e?.kind !== 'text') return fail(`${id} ist kein Text`);
        const out = ed.setTextProps(id, {
          ...(typeof input.text === 'string' ? { text: input.text } : {}),
          ...(typeof input.font_family === 'string' ? { fontFamily: input.font_family } : {}),
          ...(typeof input.font_size_mm === 'number' ? { fontSize: input.font_size_mm } : {}),
          ...(typeof input.bold === 'boolean' ? { fontWeight: input.bold ? 700 : 400 } : {}),
          ...(typeof input.italic === 'boolean' ? { italic: input.italic } : {}),
          ...(input.align === 'left' || input.align === 'center' || input.align === 'right' ? { align: input.align } : {}),
        });
        if (!out.ok) return fail(out.message);
        return { content: `Updated text ${id}.`, summary: 'Text geändert' };
      }
      case 'move': {
        const targets = resolveTargets(doc, input.targets);
        const dx = num(input.dx, 'dx');
        const dy = num(input.dy, 'dy');
        const ids = new Set<Id>();
        for (const t of targets) {
          const e = doc.entities[t];
          if (doc.points[t]) ids.add(t);
          else if (e?.kind === 'line') [e.p1, e.p2].forEach((p) => ids.add(p));
          else if (e?.kind === 'circle') ids.add(e.center);
          else if (e?.kind === 'text') ids.add(e.anchor);
          else if (e?.kind === 'path')
            e.edges.forEach((ed2) => {
              const l = lineOf(doc, ed2.id);
              if (l) [l.p1, l.p2].forEach((p) => ids.add(p));
            });
        }
        ids.delete(ORIGIN_ID);
        if (!ids.size) return fail('Nichts zu verschieben');
        ed.beginDrag('Verschieben');
        const targetsPos = [...ids].map((id) => ({ id, x: doc.points[id].x + dx, y: doc.points[id].y + dy }));
        ed.dragTo({ kind: 'points', targets: targetsPos });
        ed.endDrag();
        const after = ed.s.doc;
        const moved = [...ids].reduce((m, id) => Math.max(m, dist(after.points[id], doc.points[id])), 0);
        const full = Math.hypot(dx, dy);
        return {
          content: moved >= full - 1e-6 ? `Moved by (${dx}, ${dy}).` : `Only partly moved (${r3(moved)} of ${r3(full)} mm) because constraints/dimensions hold the geometry. Change dimensions or delete constraints instead.`,
          summary: `Verschoben (${numberToExpr(dx)}, ${numberToExpr(dy)})`,
        };
      }
      case 'arrange': {
        const out = ed.arrange(resolveTargets(doc, input.targets), (input.order as 'front' | 'back' | 'forward' | 'backward') ?? 'front');
        if (!out.ok) return fail(out.message);
        return { content: `New order (back to front): ${ed.s.doc.order.join(', ')}`, summary: 'Reihenfolge geändert' };
      }
      case 'duplicate': {
        const targets = resolveTargets(doc, input.targets);
        ed.copy(targets);
        const out = ed.paste({ x: typeof input.dx === 'number' ? input.dx : 10, y: typeof input.dy === 'number' ? input.dy : -10 });
        if (!out.ok) return fail(out.message);
        return { content: `Duplicated as ${out.ids?.join(', ')}. ${statusLine(ed)}`, summary: `${out.ids?.length ?? 0} Objekt(e) dupliziert` };
      }
      case 'delete': {
        const out = ed.deleteIds(resolveTargets(doc, input.targets));
        if (!out.ok) return fail(out.message);
        return { content: `Deleted. ${statusLine(ed)}`, summary: 'Gelöscht' };
      }
      case 'set_construction': {
        const out = ed.toggleConstruction(resolveTargets(doc, input.targets));
        if (!out.ok) return fail(out.message);
        return { content: 'Toggled construction.', summary: 'Konstruktion umgeschaltet' };
      }
      case 'select': {
        ed.select(resolveTargets(doc, input.targets));
        return { content: 'Selected.', summary: 'Auswahl gesetzt' };
      }
      case 'view_image': {
        const img = await host.renderPreview();
        if (!img) return { content: 'The design is empty (nothing visible to render).', summary: 'Vorschau: leer' };
        return {
          content: [
            { type: 'text', text: 'Current design (dimensions and constraint glyphs are not shown):' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img.base64 } },
          ],
          summary: 'Ergebnis angesehen',
        };
      }
      case 'undo': {
        const ok = ed.undo();
        return { content: ok ? 'Undone.' : 'Nothing to undo.', summary: 'Rückgängig' };
      }
      case 'get_production': {
        const p = productionOf(doc);
        const g = garmentOf(p.garment);
        return {
          content: JSON.stringify({
            ...p,
            templates: undefined,
            design_colors: allColors(doc, p),
            motif_sizes_mm: p.motifs.map((m) => motifSize(doc, m)).map((sz) => (sz ? [r3(sz.w), r3(sz.h)] : null)),
            print_areas: g.areas.map((a) => ({ id: a.id, name: a.name, view: a.view, x: a.x, y: a.y, w: a.w, h: a.h })),
            techniques: TECHNIQUES.map((t) => `${t.id} = ${t.name}`),
          }),
          summary: 'Produktionsangaben gelesen',
        };
      }
      case 'set_production': {
        const out = ed.updateProduction('Produktion (Claude)', (p) => {
          if (typeof input.article === 'string') p.article = input.article;
          if (typeof input.version === 'string') p.version = input.version;
          if (typeof input.garment === 'string') p.garment = input.garment as typeof p.garment;
          const g = garmentOf(p.garment);
          const m = p.motifs[typeof input.motif_index === 'number' ? input.motif_index : 0];
          if (m) {
            if (typeof input.motif_name === 'string') m.name = input.motif_name;
            if (typeof input.technique === 'string') m.technique = input.technique as typeof m.technique;
            if (typeof input.area === 'string') {
              const a = areaOf(g, input.area);
              if (!a) throw new Error(`Unknown print area ${input.area}`);
              m.placement = { view: a.view, area: a.id, x: a.x, y: a.y };
            }
            if (typeof input.x === 'number') m.placement.x = input.x;
            if (typeof input.y === 'number') m.placement.y = input.y;
          }
          if (Array.isArray(input.variants)) {
            p.variants = (input.variants as { name: string; fabric: string; fabric_name?: string; colors?: Record<string, string> }[]).map((v, i) => ({
              id: `v${i + 1}`,
              name: v.name,
              fabric: normalizeHex(v.fabric) ?? '#ffffff',
              fabricName: v.fabric_name,
              colors: Object.fromEntries(Object.entries(v.colors ?? {}).map(([k, c]) => [(normalizeHex(k) ?? k).toLowerCase(), (normalizeHex(c) ?? c).toLowerCase()])),
            }));
          }
          if (input.pantone && typeof input.pantone === 'object') {
            for (const [k, v] of Object.entries(input.pantone as Record<string, string>)) {
              const key = (normalizeHex(k) ?? k).toLowerCase();
              p.colorSpecs[key] = { ...(p.colorSpecs[key] ?? {}), pantone: String(v).replace(/^pantone\s*/i, '') };
            }
          }
        });
        if (!out.ok) return fail(out.message);
        return { content: 'OK', summary: 'Produktionsangaben geändert' };
      }
      case 'open_export_dialog': {
        const fmt = input.format === 'png' ? 'png' : 'svg';
        host.openExport(fmt, typeof input.dpi === 'number' ? Math.max(300, input.dpi) : undefined);
        return { content: 'Export dialog opened; the user chooses where to save.', summary: `Exportdialog (${fmt.toUpperCase()}) geöffnet` };
      }
    }
    return fail(`Unbekanntes Werkzeug ${name}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

function resolveTargets(doc: SketchDoc, v: unknown): Id[] {
  const arr = Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [];
  if (arr.length === 1 && arr[0] === 'all') return [...doc.order];
  // Bemaßungsnamen (d0) in Ids übersetzen
  return arr.map((x) => Object.values(doc.dims).find((d) => d.name === x)?.id ?? x);
}
