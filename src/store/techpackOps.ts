import type { TechPack, TechReference } from '../model/types';
import type { CommitOutcome, Editor } from './editor';

/** Editor-Befehle für die Tech-Pack-Angaben (ein Rückgängig-Schritt je Änderung). */

export function emptyTechPack(): TechPack {
  return { styleNo: '', season: '', brand: '', designer: '', status: 'Entwurf', description: '', notes: '', references: [], trims: [], tolerances: {}, construction: {} };
}

export function techPackOf(tp: TechPack | undefined): TechPack {
  return { ...emptyTechPack(), ...(tp ?? {}) };
}

export function updateTechPack(ed: Editor, label: string, recipe: (tp: TechPack) => void): CommitOutcome {
  return ed.commit(
    label,
    (d) => {
      if (!d.techPack) d.techPack = emptyTechPack();
      else d.techPack = { ...emptyTechPack(), ...d.techPack };
      recipe(d.techPack);
    },
    { skipSolve: true },
  );
}

export function addReferences(ed: Editor, refs: Omit<TechReference, 'id'>[]): CommitOutcome {
  return updateTechPack(ed, refs.length > 1 ? 'Referenzen hinzufügen' : 'Referenz hinzufügen', (tp) => {
    for (const r of refs) tp.references.push({ ...r, id: newIdFor(tp, 'ref') });
  });
}

function newIdFor(tp: TechPack, prefix: string): string {
  const used = new Set([...tp.references.map((r) => r.id), ...tp.trims.map((t) => t.id)]);
  let i = used.size + 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

export function addTrim(ed: Editor, name = '', spec = ''): CommitOutcome {
  return updateTechPack(ed, 'Zutat hinzufügen', (tp) => {
    tp.trims.push({ id: newIdFor(tp, 'tr'), name, spec, qty: '1', placement: '' });
  });
}

/** Häufige Zutaten als Schnellauswahl. */
export const TRIM_PRESETS: { name: string; spec: string; placement: string }[] = [
  { name: 'Hauptetikett', spec: 'Gewebt, 50 × 20 mm', placement: 'Nacken innen, mittig' },
  { name: 'Größenetikett', spec: 'Gewebt, 15 × 15 mm', placement: 'Unter dem Hauptetikett' },
  { name: 'Pflegeetikett', spec: 'Satin, bedruckt (Material, Pflege, Herkunft)', placement: 'Linke Seitennaht innen, 8 cm über Saum' },
  { name: 'Nackenband', spec: 'Köperband 10 mm, Stofffarbe', placement: 'Hals hinten, Schulter zu Schulter' },
  { name: 'Kordel', spec: 'Rund, 6 mm, Enden mit Metall-Endkappen', placement: 'Kapuzentunnel' },
  { name: 'Ösen', spec: 'Metall, 8 mm, vernickelt', placement: 'Kapuze vorne, 2 Stück' },
  { name: 'Nähgarn', spec: 'Polyester, Farbe passend zum Oberstoff', placement: 'Alle Nähte' },
];

export const REF_CATEGORIES: TechReference['category'][] = ['Inspiration', 'Detail', 'Etikett', 'Zutat', 'Stoff/Farbe', 'Passform', 'Sonstiges'];
