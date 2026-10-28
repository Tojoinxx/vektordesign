import type { Id, Production, SketchDoc } from './types';
import { createDoc, addText } from './doc';
import { applyVariant, motifDoc, motifSize, productionOf } from './production';
import { docBBox } from './bounds';

/**
 * DTF-/Transfer-Sammelbogen: Motive mit Stückzahlen und personalisierte Namen/Nummern
 * platzsparend auf Rollenbreite anordnen (Skyline-Verfahren, optional um 90° gedreht).
 */

export interface GangItemSpec {
  kind: 'motif';
  motifId: Id;
  variantId: Id;
  count: number;
}

export interface NamesSpec {
  /** Zeilen „Name;Nummer[;Größe][;Anzahl]“ */
  rows: string;
  fontFamily: string;
  fontWeight: number;
  /** Höhe der Großbuchstaben (mm) */
  nameHeight: number;
  numberHeight: number;
  color: string;
  /** Abstand Name ↔ Nummer (mm) */
  spacing: number;
}

export interface GangSheetSpec {
  width: number;
  gap: number;
  margin: number;
  rotate: boolean;
  /** Höchstlänge je Bogen (mm), danach neuer Bogen */
  maxLength: number;
  cutLines: boolean;
  mirror: boolean;
  items: GangItemSpec[];
  names: NamesSpec;
}

export const DEFAULT_GANG: GangSheetSpec = {
  width: 560,
  gap: 6,
  margin: 5,
  rotate: true,
  maxLength: 1000,
  cutLines: true,
  mirror: false,
  items: [],
  names: { rows: '', fontFamily: 'Arial', fontWeight: 700, nameHeight: 50, numberHeight: 200, color: '#ffffff', spacing: 20 },
};

export function gangSpecOf(p: Production): GangSheetSpec {
  const g = p.gangSheet as Partial<GangSheetSpec> | undefined;
  return { ...DEFAULT_GANG, ...(g ?? {}), names: { ...DEFAULT_GANG.names, ...(g?.names ?? {}) } };
}

export interface NameRow {
  name: string;
  number: string;
  size: string;
  count: number;
}

export function parseNames(rows: string): NameRow[] {
  const out: NameRow[] = [];
  for (const raw of rows.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^name\b/i.test(line)) continue; // Kopfzeile
    const parts = line.split(/[;\t]|,(?=\s*\d|\s*$)/).map((s) => s.trim());
    const [name = '', number = '', size = '', count = ''] = parts;
    if (!name && !number) continue;
    out.push({ name: name.toUpperCase(), number, size, count: Math.max(1, Math.round(Number(count) || 1)) });
  }
  return out;
}

/** Ein Stück auf dem Bogen: eigene kleine Zeichnung (Weltkoordinaten) mit Rahmen. */
export interface GangPiece {
  key: string;
  label: string;
  doc: SketchDoc;
  box: { minX: number; minY: number; maxX: number; maxY: number };
  w: number;
  h: number;
  hasImage: boolean;
}

export function namePieceDoc(r: NameRow, n: NamesSpec): SketchDoc {
  const d = createDoc(`${r.name} ${r.number}`);
  const style = { fill: n.color, stroke: null, strokeWidth: 0.3, opacity: 1 };
  const nameSize = n.nameHeight / 0.7;
  const numSize = n.numberHeight / 0.7;
  let y = 0;
  if (r.number) {
    addText(d, { x: 0, y: 0 }, { text: r.number, fontFamily: n.fontFamily, fontSize: numSize, fontWeight: n.fontWeight, align: 'center', style });
    y = n.numberHeight + n.spacing;
  }
  if (r.name) addText(d, { x: 0, y }, { text: r.name, fontFamily: n.fontFamily, fontSize: nameSize, fontWeight: n.fontWeight, align: 'center', style });
  return d;
}

/** Alle Stücke des Bogens (Stückzahlen ausmultipliziert). */
export function gangPieces(doc: SketchDoc, spec: GangSheetSpec, p: Production = productionOf(doc)): GangPiece[] {
  const out: GangPiece[] = [];
  for (const it of spec.items) {
    const m = p.motifs.find((x) => x.id === it.motifId);
    const v = p.variants.find((x) => x.id === it.variantId) ?? p.variants[0];
    if (!m || !v) continue;
    const size = motifSize(doc, m);
    if (!size) continue;
    const md = applyVariant(motifDoc(doc, m), v);
    const hasImage = Object.values(md.entities).some((e) => e.kind === 'image' && !e.reference);
    for (let i = 0; i < Math.max(0, Math.round(it.count)); i++) out.push({ key: `${m.id}/${v.id}/${i}`, label: `${m.name} · ${v.name}`, doc: md, box: size.box, w: size.w, h: size.h, hasImage });
  }
  for (const r of parseNames(spec.names.rows)) {
    const d = namePieceDoc(r, spec.names);
    const box = docBBox(d);
    if (!box) continue;
    for (let i = 0; i < r.count; i++)
      out.push({ key: `n/${r.name}/${r.number}/${i}`, label: `${r.name} ${r.number}${r.size ? ` (${r.size})` : ''}`, doc: d, box, w: box.maxX - box.minX, h: box.maxY - box.minY, hasImage: false });
  }
  return out;
}

export interface Placed {
  piece: GangPiece;
  /** linke obere Ecke auf dem Bogen (mm, y nach unten) */
  x: number;
  y: number;
  rotated: boolean;
  sheet: number;
}

export interface GangLayout {
  placed: Placed[];
  sheets: { length: number }[];
  /** Stücke, die nicht auf die Rollenbreite passen */
  tooWide: GangPiece[];
  usage: number;
}

/** Skyline-Packen auf einen Streifen fester Breite (y nach unten). */
export function layoutGang(pieces: GangPiece[], spec: GangSheetSpec): GangLayout {
  const inner = spec.width - 2 * spec.margin;
  const g = spec.gap;
  const order = [...pieces].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.h - a.h);
  const placed: Placed[] = [];
  const tooWide: GangPiece[] = [];
  const sheets: { length: number }[] = [];
  let sheet = 0;
  // Skyline: Segmente [x, breite, höhe]
  let sky: { x: number; w: number; y: number }[] = [{ x: 0, w: inner + g, y: 0 }];
  const maxLen = Math.max(50, spec.maxLength - 2 * spec.margin);
  const fit = (w: number, h: number) => {
    let best: { i: number; y: number; x: number } | null = null;
    for (let i = 0; i < sky.length; i++) {
      const x = sky[i].x;
      if (x + w > inner + g + 1e-9) break;
      let y = 0;
      let rem = w;
      let j = i;
      while (rem > 1e-9 && j < sky.length) {
        y = Math.max(y, sky[j].y);
        rem -= sky[j].w;
        j++;
      }
      if (rem > 1e-9) continue;
      if (y + h > maxLen + g + 1e-9) continue;
      if (!best || y < best.y - 1e-9 || (Math.abs(y - best.y) < 1e-9 && x < best.x)) best = { i, y, x };
    }
    return best;
  };
  const place = (x: number, y: number, w: number, h: number) => {
    const top = y + h;
    const next: typeof sky = [];
    for (const s of sky) {
      const s0 = s.x;
      const s1 = s.x + s.w;
      if (s1 <= x + 1e-9 || s0 >= x + w - 1e-9) next.push(s);
      else {
        if (s0 < x) next.push({ x: s0, w: x - s0, y: s.y });
        if (s1 > x + w) next.push({ x: x + w, w: s1 - (x + w), y: s.y });
      }
    }
    next.push({ x, w, y: top });
    next.sort((a, b) => a.x - b.x);
    // gleiche Höhen zusammenfassen
    sky = next.reduce<typeof sky>((acc, s) => {
      const l = acc[acc.length - 1];
      if (l && Math.abs(l.y - s.y) < 1e-9 && Math.abs(l.x + l.w - s.x) < 1e-9) l.w += s.w;
      else acc.push({ ...s });
      return acc;
    }, []);
  };
  const height = () => Math.max(0, ...placed.filter((p) => p.sheet === sheet).map((p) => p.y + (p.rotated ? p.piece.w : p.piece.h)));
  for (const pc of order) {
    const canRot = spec.rotate && !pc.hasImage;
    const options: { w: number; h: number; rot: boolean }[] = [{ w: pc.w + g, h: pc.h + g, rot: false }];
    if (canRot) options.push({ w: pc.h + g, h: pc.w + g, rot: true });
    if (options.every((o) => o.w - g > inner + 1e-9)) {
      tooWide.push(pc);
      continue;
    }
    let choice = null as { o: (typeof options)[0]; f: { i: number; y: number; x: number } } | null;
    for (let attempt = 0; attempt < 2 && !choice; attempt++) {
      for (const o of options) {
        const f = fit(o.w, o.h);
        if (f && (!choice || f.y + o.h < choice.f.y + choice.o.h - 1e-9)) choice = { o, f };
      }
      if (!choice) {
        // Bogen voll → neuer Bogen
        sheets.push({ length: height() + 2 * spec.margin });
        sheet++;
        sky = [{ x: 0, w: inner + g, y: 0 }];
      }
    }
    if (!choice) {
      tooWide.push(pc);
      continue;
    }
    place(choice.f.x, choice.f.y, choice.o.w, choice.o.h);
    placed.push({ piece: pc, x: spec.margin + choice.f.x, y: spec.margin + choice.f.y, rotated: choice.o.rot, sheet });
  }
  sheets.push({ length: height() + 2 * spec.margin });
  const used = placed.reduce((s, p) => s + p.piece.w * p.piece.h, 0);
  const total = sheets.reduce((s, x) => s + x.length * spec.width, 0);
  return { placed, sheets: sheets.filter((s, i) => s.length > 2 * spec.margin || i === 0), tooWide, usage: total > 0 ? used / total : 0 };
}
