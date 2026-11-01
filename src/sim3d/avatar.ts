import type { BodyMeasures, PatternAvatar } from '../model/types';
import { SIZE_TABLE, bodyForSize } from '../pattern/body';
import type { Gender } from './body';

/**
 * Puppe zum Anprobieren: unabhängig vom Schnitt wählbar (männlich/weiblich, Konfektionsgröße als
 * Ausgangspunkt, Körpergröße und Körperbau per Regler). Daraus entstehen die Körpermaße der Puppe.
 */

export const HEIGHT_RANGE = { min: 1500, max: 2050 };
export const BUILD_LABELS = ['sehr schlank', 'schlank', 'normal', 'kräftig', 'sehr kräftig'];

export function defaultAvatar(gender: Gender): PatternAvatar {
  const base = gender === 'female' ? 'D-M' : 'H-M';
  return { gender, base, height: bodyForSize(base).height, build: 0 };
}

export function sizesFor(gender: Gender) {
  return SIZE_TABLE.filter((r) => (gender === 'female' ? r.id.startsWith('D-') : r.id.startsWith('H-')));
}

/** Körpermaße der Puppe aus Ausgangsgröße, Körpergröße und Körperbau (−1 schlank … +1 kräftig). */
export function avatarBody(a: PatternAvatar): BodyMeasures {
  const b = bodyForSize(a.base);
  const k = a.height / b.height;
  const build = Math.max(-1, Math.min(1, a.build));
  // Längen mit der Körpergröße, Umfänge nur leicht (größere Menschen sind etwas breiter)
  const circ = Math.sqrt(k);
  const w = (f: number) => 1 + f * build;
  return {
    height: a.height,
    chest: b.chest * circ * w(0.13),
    waist: b.waist * circ * w(a.gender === 'female' ? 0.2 : 0.25),
    hip: b.hip * circ * w(a.gender === 'female' ? 0.15 : 0.11),
    neck: b.neck * circ * w(0.09),
    shoulder: b.shoulder * Math.pow(k, 0.8) * w(0.05),
    arm: b.arm * k,
    upperArm: b.upperArm * circ * w(0.2),
    wrist: b.wrist * circ * w(0.07),
    backLength: b.backLength * k,
    head: b.head * Math.pow(k, 0.3),
  };
}

export function buildLabel(build: number): string {
  return BUILD_LABELS[Math.max(0, Math.min(4, Math.round((build + 1) * 2)))];
}

/** Geschlecht der Puppe ohne eigene Angabe: aus der Größe des Schnitts (Damen = weiblich). */
export function genderOfSize(size: string): Gender {
  return size.startsWith('D-') ? 'female' : 'male';
}
