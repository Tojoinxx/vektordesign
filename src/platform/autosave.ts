import type { SketchDoc } from '../model/types';
import type { AppStore } from '../store/state';

/** Automatisches Zwischenspeichern in IndexedDB (Desktop und Browser). */

const DB = 'vektordesign';
const STORE = 'kv';
const KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface AutosaveEntry {
  doc: SketchDoc;
  fileName: string | null;
  filePath: string | null;
  savedAt: number;
}

export async function readAutosave(): Promise<AutosaveEntry | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as AutosaveEntry) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function writeAutosave(entry: AutosaveEntry): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Zwischenspeichern ist bestmöglich – Fehler stören die Arbeit nicht
  }
}

/** Speichert bei jeder Änderung verzögert (800 ms). Gibt eine Abmeldefunktion zurück. */
export function startAutosave(store: AppStore): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastDoc: SketchDoc | null = null;
  const unsub = store.subscribe((s) => {
    if (s.doc === lastDoc) return;
    lastDoc = s.doc;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const st = store.getState();
      void writeAutosave({ doc: st.doc, fileName: st.fileName, filePath: st.filePath, savedAt: Date.now() });
    }, 800);
  });
  return () => {
    unsub();
    if (timer) clearTimeout(timer);
  };
}
