import { isTauri } from './files';

/**
 * Abgleich zwischen PC und iPad über eine Projektdatei in einem Cloud-Ordner
 * (iCloud Drive, OneDrive). Jede Speicherung erhöht die Revision in der Datei und vermerkt das
 * Gerät. Die App beobachtet die geöffnete Datei (Desktop-App und Chrome/Edge) und übernimmt
 * neuere Stände automatisch; gibt es gleichzeitig eigene ungespeicherte Änderungen, entscheidet
 * der Nutzer (Konflikt).
 */

export interface FileMeta {
  revision: number;
  savedBy: string;
  savedAt: string;
  projectId: string;
}

/** Zugriff auf die geöffnete Datei. */
export interface ProjectLink {
  kind: 'tauri' | 'handle' | 'memory';
  name: string;
  stat(): Promise<{ mtime: number; size: number } | null>;
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

export function readMeta(text: string): FileMeta | null {
  try {
    const j = JSON.parse(text) as Partial<FileMeta> & { format?: string };
    if (j.format !== 'vektordesign') return null;
    return {
      revision: typeof j.revision === 'number' ? j.revision : 0,
      savedBy: typeof j.savedBy === 'string' ? j.savedBy : '',
      savedAt: typeof j.savedAt === 'string' ? j.savedAt : '',
      projectId: typeof j.projectId === 'string' ? j.projectId : '',
    };
  } catch {
    return null;
  }
}

/** Gerätename für „gespeichert von …“ (einstellbar). */
export function deviceName(): string {
  try {
    const saved = localStorage.getItem('vd.device');
    if (saved) return saved;
  } catch {
    /* kein Speicher */
  }
  if (typeof navigator === 'undefined') return 'Gerät';
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Windows/.test(ua)) return 'PC';
  if (/Macintosh/.test(ua)) return 'Mac';
  return 'Computer';
}

export function newProjectId(): string {
  const c = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export type SyncEvent =
  | { kind: 'reloaded'; text: string; meta: FileMeta }
  | { kind: 'conflict'; text: string; meta: FileMeta }
  | { kind: 'missing' };

export type SaveCheck = { kind: 'ok'; nextRevision: number } | { kind: 'conflict'; text: string; meta: FileMeta };

/**
 * Zustand der Verbindung zur geöffneten Datei. Rein logisch (ohne Oberfläche), damit sich
 * Konfliktfälle testen lassen.
 */
export class ProjectSync {
  link: ProjectLink | null = null;
  /** Revision, auf der der Stand im Editor beruht */
  revision = 0;
  projectId = '';
  /** zuletzt gesehene Änderungszeit der Datei */
  private mtime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  /** Vom Nutzer bereits gesehene fremde Revision (kein erneuter Hinweis) */
  private acknowledged = 0;

  attach(link: ProjectLink | null, meta: FileMeta | null, mtime = 0): void {
    this.link = link;
    this.revision = meta?.revision ?? 0;
    this.projectId = meta?.projectId || newProjectId();
    this.mtime = mtime;
    this.acknowledged = this.revision;
  }

  detach(): void {
    this.stopWatching();
    this.link = null;
    this.revision = 0;
    this.projectId = newProjectId();
    this.mtime = 0;
    this.acknowledged = 0;
  }

  /** Vor dem Speichern: hat inzwischen jemand anders gespeichert? */
  async checkBeforeSave(): Promise<SaveCheck> {
    if (!this.link) return { kind: 'ok', nextRevision: this.revision + 1 };
    const st = await this.link.stat().catch(() => null);
    if (!st) return { kind: 'ok', nextRevision: this.revision + 1 };
    const text = await this.link.read();
    const meta = readMeta(text);
    if (meta && meta.revision > this.revision && meta.revision > this.acknowledged) return { kind: 'conflict', text, meta };
    return { kind: 'ok', nextRevision: Math.max(this.revision, meta?.revision ?? 0) + 1 };
  }

  /** Nach dem Schreiben aufrufen. */
  async saved(revision: number): Promise<void> {
    this.revision = revision;
    this.acknowledged = revision;
    const st = this.link ? await this.link.stat().catch(() => null) : null;
    if (st) this.mtime = st.mtime;
  }

  /** Fremde Revision als gesehen markieren („meine behalten“): nächstes Speichern überschreibt. */
  acknowledge(meta: FileMeta): void {
    this.acknowledged = Math.max(this.acknowledged, meta.revision);
  }

  /** Einmal prüfen, ob sich die Datei geändert hat. */
  async check(dirty: boolean): Promise<SyncEvent | null> {
    if (!this.link || this.checking) return null;
    this.checking = true;
    try {
      const st = await this.link.stat().catch(() => null);
      if (!st) return null;
      if (st.mtime === this.mtime) return null;
      this.mtime = st.mtime;
      const text = await this.link.read();
      const meta = readMeta(text);
      if (!meta || meta.revision <= this.revision || meta.revision <= this.acknowledged) return null;
      if (!dirty) {
        this.revision = meta.revision;
        this.acknowledged = meta.revision;
        return { kind: 'reloaded', text, meta };
      }
      this.acknowledged = meta.revision;
      return { kind: 'conflict', text, meta };
    } finally {
      this.checking = false;
    }
  }

  /** Nach Übernahme einer fremden Version. */
  adopt(meta: FileMeta): void {
    this.revision = meta.revision;
    this.acknowledged = meta.revision;
  }

  startWatching(isDirty: () => boolean, onEvent: (e: SyncEvent) => void, intervalMs = 3000): void {
    this.stopWatching();
    if (!this.link) return;
    const tick = () => {
      void this.check(isDirty()).then((e) => e && onEvent(e));
    };
    this.timer = setInterval(tick, intervalMs);
    if (typeof window !== 'undefined') window.addEventListener('focus', tick);
    this.stopTick = () => {
      if (typeof window !== 'undefined') window.removeEventListener('focus', tick);
    };
  }

  private stopTick: () => void = () => {};

  stopWatching(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopTick();
  }
}

// ---------------------------------------------------------------------------
// Verbindungen
// ---------------------------------------------------------------------------

export function tauriLink(path: string): ProjectLink {
  const name = path.split(/[\\/]/).pop() ?? path;
  return {
    kind: 'tauri',
    name,
    async stat() {
      const { invoke } = await import('@tauri-apps/api/core');
      const r = await invoke<[number, number] | null>('file_stat', { path });
      return r ? { mtime: r[0], size: r[1] } : null;
    },
    async read() {
      const { invoke } = await import('@tauri-apps/api/core');
      const buf = await invoke<ArrayBuffer>('read_file', { path });
      return new TextDecoder().decode(buf);
    },
    async write(text) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('write_file', new TextEncoder().encode(text), { headers: { 'x-path': encodeURIComponent(path) } });
    },
  };
}

interface FsHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: string }): Promise<string>;
  requestPermission?(o: { mode: string }): Promise<string>;
}

export function handleLink(handle: FsHandle): ProjectLink {
  return {
    kind: 'handle',
    name: handle.name,
    async stat() {
      const f = await handle.getFile();
      return { mtime: f.lastModified, size: f.size };
    },
    async read() {
      return (await handle.getFile()).text();
    },
    async write(text) {
      if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        await handle.requestPermission?.({ mode: 'readwrite' });
      }
      const w = await handle.createWritable();
      await w.write(new Blob([text], { type: 'application/json' }));
      await w.close();
    },
  };
}

/** Projektdatei mit Dateizugriff öffnen (Desktop-App bzw. Chrome/Edge); sonst null. */
export async function pickProjectWithLink(): Promise<{ name: string; text: string; link: ProjectLink; mtime: number } | null | 'unsupported'> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const sel = await open({ multiple: false, filters: [{ name: 'Vektordesign-Projekt', extensions: ['vdp'] }] });
    if (!sel || Array.isArray(sel)) return null;
    const link = tauriLink(sel);
    const st = await link.stat();
    return { name: link.name, text: await link.read(), link, mtime: st?.mtime ?? 0 };
  }
  const w = window as unknown as { showOpenFilePicker?: (o: unknown) => Promise<FsHandle[]> };
  if (!w.showOpenFilePicker || window.top !== window.self) return 'unsupported';
  try {
    const [h] = await w.showOpenFilePicker({ types: [{ description: 'Vektordesign-Projekt', accept: { 'application/json': ['.vdp'] } }], multiple: false });
    const f = await h.getFile();
    return { name: h.name, text: await f.text(), link: handleLink(h), mtime: f.lastModified };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    return 'unsupported';
  }
}

/** Neue Datei anlegen und verbinden (Speichern unter) – Desktop-App bzw. Chrome/Edge. */
export async function pickSaveTarget(suggested: string): Promise<ProjectLink | null | 'unsupported'> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    let target = await save({ defaultPath: suggested, filters: [{ name: 'Vektordesign-Projekt', extensions: ['vdp'] }] });
    if (!target) return null;
    if (!target.toLowerCase().endsWith('.vdp')) target += '.vdp';
    return tauriLink(target);
  }
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FsHandle> };
  if (!w.showSaveFilePicker || window.top !== window.self) return 'unsupported';
  try {
    const h = await w.showSaveFilePicker({ suggestedName: suggested, types: [{ description: 'Vektordesign-Projekt', accept: { 'application/json': ['.vdp'] } }] });
    return handleLink(h);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    return 'unsupported';
  }
}
