import { zipSync, strToU8 } from 'fflate';
import type { Production, SketchDoc } from '../model/types';
import { applyVariant, articleBase, cmykOf, cmykText, fileSafe, motifColors, motifDoc, motifSize, motifWarnings, variantColor } from '../model/production';
import { garmentOf, techniqueName, areaOf } from '../model/garments';
import type { ExportProfile } from '../model/profiles';
import { serializeDoc, APP_NAME, APP_VERSION } from '../model/serialize';
import { attachImagePixels, buildScene, textOutlines } from './scene';
import { exportSvg } from './svg';
import { exportPdf } from './pdf';
import { exportEps } from './eps';
import { exportDxf } from './dxf';
import { buildArtworkSheet, type SheetOptions } from './artworkSheet';

/**
 * Ein-Klick-Paket (ZIP) für den Produzenten: alle Motive in allen Varianten und Formaten
 * des Profils, Artwork-Blatt, Farbliste und optional die Projektdatei – sauber benannt
 * nach Artikel und Version.
 */

export interface PackageOptions extends SheetOptions {
  /** PNG-Erzeugung (braucht eine Zeichenfläche, im Browser vorhanden) */
  renderPng?: (doc: SketchDoc, dpi: number, mirror: boolean, bounds: 'geometry' | 'stroke') => Promise<Uint8Array>;
  onProgress?: (text: string) => void;
  /** Pixelbilder für PDF dekodieren (Browser) */
  decodeImage?: (src: string) => Promise<{ rgba: Uint8Array | Uint8ClampedArray; width: number; height: number } | null>;
}

export interface PackageResult {
  zip: Uint8Array;
  fileName: string;
  files: string[];
  warnings: string[];
}

export async function buildPackage(doc: SketchDoc, p: Production, profile: ExportProfile, opts: PackageOptions = {}): Promise<PackageResult> {
  const base = articleBase(p);
  const files: Record<string, Uint8Array> = {};
  const warnings: string[] = [];
  const put = (path: string, data: Uint8Array | string) => {
    files[`${base}/${path}`] = typeof data === 'string' ? strToU8(data) : data;
  };
  for (const m of p.motifs) warnings.push(...motifWarnings(doc, p, m));
  if (profile.formats.includes('png') && profile.minDpi && profile.pngDpi < profile.minDpi) {
    warnings.push(`PNG mit ${profile.pngDpi} dpi liegt unter der Mindestauflösung ${profile.minDpi} dpi des Profils.`);
  }

  opts.onProgress?.('Schriften in Pfade umwandeln …');
  const { outlines, substituted } = await textOutlines(doc);
  if (substituted.length) warnings.push(`Schrift ersetzt (nicht verfügbar): ${substituted.join(', ')}`);

  const many = p.variants.length > 1;
  for (const m of p.motifs) {
    if (!motifSize(doc, m)) continue;
    for (const v of p.variants) {
      const md = applyVariant(motifDoc(doc, m), v);
      const name = `${base}_${fileSafe(m.name)}${many || p.variants[0].name !== 'Variante A' ? `_${fileSafe(v.name)}` : ''}${profile.mirror ? '_gespiegelt' : ''}`;
      const title = `${p.article} – ${m.name} – ${v.name}`;
      opts.onProgress?.(`${m.name}, ${v.name} …`);
      for (const f of profile.formats) {
        const path = `Motive/${name}.${f}`;
        if (f === 'svg') put(path, exportSvg(md, { bounds: profile.bounds, mirror: profile.mirror, title, outlines }).svg);
        else if (f === 'png') {
          if (!opts.renderPng) {
            warnings.push('PNG kann hier nicht erzeugt werden (keine Zeichenfläche).');
            continue;
          }
          put(path, await opts.renderPng(md, profile.pngDpi, profile.mirror, profile.bounds));
        } else {
          const scene = buildScene(md, { bounds: profile.bounds, outlines });
          if (f === 'pdf' && opts.decodeImage) await attachImagePixels(scene, opts.decodeImage);
          if (f === 'pdf') put(path, exportPdf(scene, { colorMode: profile.colorMode, mirror: profile.mirror, title }));
          else if (f === 'eps') {
            const r = exportEps(scene, { colorMode: profile.colorMode, mirror: profile.mirror, title });
            if (r.lostTransparency && !warnings.some((w) => w.startsWith('EPS'))) warnings.push('EPS kennt keine Transparenz – Deckkraft und Verblassen fehlen dort.');
            put(path, r.bytes);
          } else if (f === 'dxf') put(path, exportDxf(scene, { mirror: profile.mirror }));
        }
      }
    }
  }

  if (profile.sheet) {
    opts.onProgress?.('Artwork-Blatt …');
    put(`${base}_Artwork-Blatt.pdf`, await buildArtworkSheet(doc, p, { colorMode: profile.colorMode === 'cmyk' ? 'cmyk' : 'rgb', decodeTemplate: opts.decodeTemplate, date: opts.date }));
  }
  put('Farben.csv', colorsCsv(doc, p));
  if (profile.project) put(`${base}.vdp`, serializeDoc(doc));
  put('LIESMICH.txt', readme(doc, p, profile, Object.keys(files).map((f) => f.slice(base.length + 1)), warnings));

  const zip = zipSync(files, { level: 6, mtime: opts.date ?? new Date() });
  return { zip, fileName: `${base}.zip`, files: Object.keys(files), warnings };
}

function csvCell(s: string): string {
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function colorsCsv(doc: SketchDoc, p: Production): string {
  const rows = [['Variante', 'Stofffarbe', 'Motiv', 'Veredelung', 'Originalfarbe', 'Druckfarbe HEX', 'CMYK', 'Pantone (Angabe Gestalter)', 'Name']];
  for (const v of p.variants)
    for (const m of p.motifs)
      for (const orig of motifColors(doc, m)) {
        const c = variantColor(v, orig);
        const spec = p.colorSpecs[c];
        rows.push([v.name, `${v.fabricName ? `${v.fabricName} ` : ''}${v.fabric.toUpperCase()}`, m.name, techniqueName(m.technique), orig.toUpperCase(), c.toUpperCase(), cmykText(cmykOf(c, spec)), spec?.pantone ?? '', spec?.name ?? '']);
      }
  // BOM, damit Excel Umlaute richtig liest
  return `﻿${rows.map((r) => r.map(csvCell).join(';')).join('\r\n')}\r\n`;
}

function readme(doc: SketchDoc, p: Production, profile: ExportProfile, files: string[], warnings: string[]): string {
  const g = garmentOf(p.garment);
  const lines = [
    `${p.article} – Version ${p.version}`,
    `${g.name}`,
    '',
    `Erstellt mit ${APP_NAME} ${APP_VERSION} am ${new Date().toLocaleString('de-DE')}, Export-Profil „${profile.name}“ (${profile.colorMode.toUpperCase()}${profile.mirror ? ', gespiegelt' : ''}).`,
    'Alle Motivdateien haben Originalgröße (Maßstab 1:1, Einheit mm). Text ist in Pfade umgewandelt, es gibt keine verknüpften Dateien.',
    '',
    'Motive:',
  ];
  for (const m of p.motifs) {
    const s = motifSize(doc, m);
    const a = areaOf(g, m.placement.area);
    lines.push(
      `- ${m.name}: ${s ? `${fmt(s.w)} × ${fmt(s.h)} mm` : 'leer'}, ${techniqueName(m.technique)}, ${a ? a.name : 'frei platziert'}; Oberkante ${fmt(m.placement.y)} mm unter ${g.reference[m.placement.view]}, Mitte ${fmt(Math.abs(m.placement.x))} mm ${m.placement.x > 0 ? 'rechts' : m.placement.x < 0 ? 'links' : 'auf'} der Mittellinie (Bildansicht).`,
    );
  }
  lines.push('', 'Varianten:');
  for (const v of p.variants) lines.push(`- ${v.name}: Stoff ${v.fabricName ? `${v.fabricName} ` : ''}${v.fabric.toUpperCase()}`);
  lines.push('', 'Dateien:', ...files.map((f) => `- ${f}`));
  if (warnings.length) lines.push('', 'Hinweise:', ...warnings.map((w) => `- ${w}`));
  if (profile.note) lines.push('', `Profil-Notiz: ${profile.note}`);
  return `${lines.join('\r\n')}\r\n`;
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString('de-DE');
