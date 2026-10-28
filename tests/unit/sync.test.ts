import { describe, expect, it } from 'vitest';
import { ProjectSync, readMeta, type ProjectLink } from '../../src/platform/sync';

/** Datei im Cloud-Ordner, auf die PC und iPad abwechselnd schreiben. */
function cloudFile(initial: object) {
  const f = { text: JSON.stringify(initial), mtime: 1000 };
  const link: ProjectLink = {
    kind: 'memory',
    name: 'Logo.vdp',
    stat: async () => ({ mtime: f.mtime, size: f.text.length }),
    read: async () => f.text,
    write: async (t) => {
      f.text = t;
      f.mtime += 1000;
    },
  };
  const otherDeviceSaves = (patch: object) => {
    const cur = JSON.parse(f.text);
    f.text = JSON.stringify({ ...cur, ...patch, revision: cur.revision + 1, savedBy: 'iPad' });
    f.mtime += 1000;
  };
  return { f, link, otherDeviceSaves };
}

const base = { format: 'vektordesign', version: 1, revision: 3, savedBy: 'PC', projectId: 'abc', name: 'A' };

describe('Sync über Cloud-Ordner (PC ↔ iPad)', () => {
  it('liest Revision, Gerät und Projekt-Id aus der Datei', () => {
    expect(readMeta(JSON.stringify(base))).toMatchObject({ revision: 3, savedBy: 'PC', projectId: 'abc' });
    expect(readMeta('kein json')).toBeNull();
  });

  it('übernimmt eine neuere Fassung vom iPad automatisch, wenn hier nichts geändert wurde', async () => {
    const { link, otherDeviceSaves } = cloudFile(base);
    const s = new ProjectSync();
    s.attach(link, readMeta(await link.read()), 1000);
    expect(await s.check(false)).toBeNull(); // unverändert
    otherDeviceSaves({ name: 'vom iPad' });
    const ev = await s.check(false);
    expect(ev?.kind).toBe('reloaded');
    if (ev?.kind === 'reloaded') expect(JSON.parse(ev.text).name).toBe('vom iPad');
    expect(s.revision).toBe(4);
    expect(await s.check(false)).toBeNull(); // nur einmal melden
  });

  it('meldet einen Konflikt bei eigenen ungespeicherten Änderungen – nur einmal', async () => {
    const { link, otherDeviceSaves } = cloudFile(base);
    const s = new ProjectSync();
    s.attach(link, readMeta(await link.read()), 1000);
    otherDeviceSaves({});
    expect((await s.check(true))?.kind).toBe('conflict');
    expect(await s.check(true)).toBeNull();
  });

  it('Speichern erkennt, dass inzwischen das iPad gespeichert hat; „meine behalten“ überschreibt danach', async () => {
    const { link, otherDeviceSaves } = cloudFile(base);
    const s = new ProjectSync();
    s.attach(link, readMeta(await link.read()), 1000);
    expect(await s.checkBeforeSave()).toEqual({ kind: 'ok', nextRevision: 4 });
    otherDeviceSaves({});
    const c = await s.checkBeforeSave();
    expect(c.kind).toBe('conflict');
    if (c.kind === 'conflict') s.acknowledge(c.meta);
    const ok = await s.checkBeforeSave();
    expect(ok).toEqual({ kind: 'ok', nextRevision: 5 });
    await link.write(JSON.stringify({ ...base, revision: 5 }));
    await s.saved(5);
    expect(await s.check(false)).toBeNull(); // eigene Speicherung löst nichts aus
  });
});
