import url from './avatar-data/makehuman.bin?url';
import { parseHumanData, type HumanData } from './human';

/** Menschen-Modell (ca. 0,6 MB) einmalig laden; null, wenn es nicht verfügbar ist. */
let pending: Promise<HumanData | null> | null = null;

export function loadHumanData(): Promise<HumanData | null> {
  pending ??= fetch(url)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => parseHumanData(b))
    .catch((e) => {
      console.warn('Menschen-Modell nicht verfügbar, einfache Puppe wird benutzt', e);
      return null;
    });
  return pending;
}
