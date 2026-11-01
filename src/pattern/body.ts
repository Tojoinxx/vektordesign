import type { BodyMeasures } from '../model/types';

/**
 * Körpermaße: Maßtabellen für Herren/Unisex und Damen (Richtwerte nach gängigen Konfektionstabellen,
 * gerundet) und Beschriftungen. Alle Werte in mm, Umfänge als ganzer Umfang.
 */

export interface SizeRow {
  id: string;
  name: string;
  group: 'Herren / Unisex' | 'Damen';
  body: BodyMeasures;
}

type Row = [string, number, number, number, number, number, number, number, number, number, number, number];
//          id     height chest waist hip   neck  shoul arm   upArm wrist back  head
const HERREN: Row[] = [
  ['XS', 1680, 860, 740, 900, 360, 420, 590, 280, 160, 420, 560],
  ['S', 1740, 920, 800, 950, 375, 440, 610, 300, 165, 430, 565],
  ['M', 1790, 1000, 880, 1010, 390, 460, 625, 320, 170, 440, 570],
  ['L', 1830, 1080, 960, 1070, 405, 480, 640, 340, 175, 450, 575],
  ['XL', 1860, 1160, 1060, 1130, 420, 500, 650, 360, 180, 455, 580],
  ['XXL', 1890, 1240, 1160, 1190, 435, 520, 660, 380, 185, 460, 585],
  ['3XL', 1910, 1320, 1260, 1250, 450, 540, 665, 400, 190, 465, 590],
];
const DAMEN: Row[] = [
  ['XS', 1620, 800, 640, 880, 320, 370, 560, 250, 145, 400, 545],
  ['S', 1660, 860, 700, 940, 330, 380, 570, 265, 150, 405, 550],
  ['M', 1690, 920, 760, 1000, 340, 390, 580, 280, 155, 410, 555],
  ['L', 1720, 990, 830, 1060, 350, 400, 590, 300, 160, 415, 560],
  ['XL', 1740, 1070, 910, 1130, 360, 410, 595, 320, 165, 420, 565],
];

function toBody(r: Row): BodyMeasures {
  const [, height, chest, waist, hip, neck, shoulder, arm, upperArm, wrist, backLength, head] = r;
  return { height, chest, waist, hip, neck, shoulder, arm, upperArm, wrist, backLength, head };
}

export const SIZE_TABLE: SizeRow[] = [
  ...HERREN.map((r) => ({ id: `H-${r[0]}`, name: `Herren/Unisex ${r[0]}`, group: 'Herren / Unisex' as const, body: toBody(r) })),
  ...DAMEN.map((r) => ({ id: `D-${r[0]}`, name: `Damen ${r[0]}`, group: 'Damen' as const, body: toBody(r) })),
];

export const DEFAULT_SIZE = 'H-M';

export function sizeRow(id: string): SizeRow | undefined {
  return SIZE_TABLE.find((r) => r.id === id);
}

export function bodyForSize(id: string): BodyMeasures {
  return { ...(sizeRow(id) ?? sizeRow(DEFAULT_SIZE)!).body };
}

export const BODY_FIELDS: { key: keyof BodyMeasures; label: string; hint: string }[] = [
  { key: 'height', label: 'Körpergröße', hint: 'Scheitel bis Sohle' },
  { key: 'chest', label: 'Brustumfang', hint: 'Waagrecht über die stärkste Stelle der Brust' },
  { key: 'waist', label: 'Taillenumfang', hint: 'An der schmalsten Stelle' },
  { key: 'hip', label: 'Hüftumfang', hint: 'Über die stärkste Stelle des Gesäßes' },
  { key: 'neck', label: 'Halsumfang', hint: 'Am Halsansatz' },
  { key: 'shoulder', label: 'Schulterbreite', hint: 'Schulterpunkt zu Schulterpunkt über den Rücken' },
  { key: 'arm', label: 'Armlänge', hint: 'Schulterpunkt bis Handgelenk, Arm leicht angewinkelt' },
  { key: 'upperArm', label: 'Oberarmumfang', hint: 'Stärkste Stelle des Oberarms' },
  { key: 'wrist', label: 'Handgelenk', hint: 'Umfang am Handgelenk' },
  { key: 'backLength', label: 'Rückenlänge', hint: '7. Halswirbel bis Taille' },
  { key: 'head', label: 'Kopfumfang', hint: 'Über Stirn und Hinterkopf (für Kapuzen)' },
];

/** Plausibilitätsprüfung: Liste verständlicher Fehlermeldungen (leer = in Ordnung). */
export function checkBody(b: BodyMeasures): string[] {
  const out: string[] = [];
  for (const f of BODY_FIELDS) {
    const v = b[f.key];
    if (!Number.isFinite(v) || v <= 0) out.push(`${f.label}: bitte einen Wert größer 0 eingeben.`);
  }
  if (out.length) return out;
  if (b.height < 1000 || b.height > 2300) out.push('Körpergröße liegt außerhalb von 100–230 cm.');
  if (b.chest < 500 || b.chest > 1800) out.push('Brustumfang liegt außerhalb von 50–180 cm.');
  if (b.shoulder > b.chest * 0.65) out.push('Schulterbreite ist im Verhältnis zum Brustumfang sehr groß.');
  if (b.neck > b.chest * 0.6) out.push('Halsumfang ist im Verhältnis zum Brustumfang sehr groß.');
  if (b.wrist > b.upperArm) out.push('Handgelenk ist größer als der Oberarm.');
  return out;
}
