#!/usr/bin/env node
/**
 * Setzt die Versionsnummer an allen Stellen gleich:
 * package.json, package-lock.json, src-tauri/Cargo.toml und Cargo.lock.
 * Oberfläche, Projektdateien und Installer (tauri.conf.json) lesen die Version aus package.json.
 *
 *   npm run version:set -- 0.2.0
 *   node scripts/set-version.mjs v0.2.0     (z. B. direkt der Git-Tag im Release-Workflow)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const input = (process.argv[2] ?? '').trim();
const version = input.replace(/^v/i, '');

// Der MSI-Installer (WiX) erlaubt nur Zahlen: Haupt.Neben.Patch, Haupt/Neben ≤ 255, Patch ≤ 65535
const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
if (!m || Number(m[1]) > 255 || Number(m[2]) > 255 || Number(m[3]) > 65535) {
  console.error(`Ungültige Version „${input}“. Erwartet z. B. 0.2.0 oder v0.2.0 (nur Zahlen, wegen des MSI-Installers).`);
  process.exit(1);
}

function edit(rel, fn) {
  const file = resolve(root, rel);
  if (!existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log(`  ${rel}`);
  }
}

const json = (fn) => (s) => {
  const j = JSON.parse(s);
  fn(j);
  return `${JSON.stringify(j, null, 2)}\n`;
};

edit(
  'package.json',
  json((j) => {
    j.version = version;
  }),
);
edit(
  'package-lock.json',
  json((j) => {
    j.version = version;
    if (j.packages?.['']) j.packages[''].version = version;
  }),
);
edit('src-tauri/Cargo.toml', (s) => s.replace(/^(\[package\][\s\S]*?^version\s*=\s*)"[^"]*"/m, `$1"${version}"`));
edit('src-tauri/Cargo.lock', (s) => s.replace(/(\[\[package\]\]\r?\nname = "vektordesign"\r?\nversion = )"[^"]*"/, `$1"${version}"`));

console.log(`Version ${version} gesetzt.`);
