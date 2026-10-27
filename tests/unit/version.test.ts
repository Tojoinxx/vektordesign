import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION } from '../../src/model/serialize';

const root = resolve(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('Versionsnummer', () => {
  it('ist in App, package.json, Cargo.toml und Tauri-Konfiguration gleich', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    expect(/^\d+\.\d+\.\d+$/.test(pkg.version)).toBe(true);
    const cargo = /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(read('src-tauri/Cargo.toml'));
    expect(cargo?.[1]).toBe(pkg.version);
    const tauri = JSON.parse(read('src-tauri/tauri.conf.json')) as { version: string };
    expect(tauri.version).toBe('../package.json');
  });
});
