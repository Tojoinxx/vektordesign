#!/usr/bin/env node
/**
 * Baut das kompakte Menschen-Modell für die 3D-Puppe aus dem MakeHuman-Grundnetz (CC0).
 *
 *   node scripts/build-avatar.mjs [Ordner mit base.obj und targets/]
 *
 * Ohne Ordner werden die Dateien von github.com/makehumancommunity/makehuman geladen.
 * Ergebnis: src/sim3d/avatar-data/makehuman.bin – nur die Körperoberfläche, Augen, die nötigen Gelenke
 * und die Ziele (Targets) für Geschlecht, Gewicht und Muskeln. Einheit mm, y nach oben, z nach vorne.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = process.argv[2];
const RAW = 'https://raw.githubusercontent.com/makehumancommunity/makehuman/master/makehuman/data';

async function read(rel) {
  if (SRC && existsSync(join(SRC, rel))) return readFileSync(join(SRC, rel), 'utf8');
  const r = await fetch(`${RAW}/${rel.replace(/^targets\//, 'targets/macrodetails/').replace(/^base\.obj$/, '3dobjs/base.obj')}`);
  if (!r.ok) throw new Error(`${rel}: ${r.status}`);
  return r.text();
}

const DM = 100; // MakeHuman-Einheit Dezimeter → mm
const obj = await read('base.obj');
const V = [];
const faces = new Map();
const groups = new Map();
let g = null;
for (const line of obj.split('\n')) {
  if (line.startsWith('v ')) V.push(line.split(/\s+/).slice(1, 4).map(Number));
  else if (line.startsWith('g ')) g = line.slice(2).trim();
  else if (line.startsWith('f ')) {
    const idx = line
      .trim()
      .split(/\s+/)
      .slice(1)
      .map((t) => Number(t.split('/')[0]) - 1);
    if (!faces.has(g)) faces.set(g, []);
    faces.get(g).push(idx);
    if (!groups.has(g)) groups.set(g, new Set());
    for (const i of idx) groups.get(g).add(i);
  }
}
const JOINTS = [
  'joint-neck',
  'joint-head',
  'joint-l-shoulder',
  'joint-r-shoulder',
  'joint-l-elbow',
  'joint-r-elbow',
  'joint-l-hand',
  'joint-r-hand',
  'joint-l-upper-leg',
  'joint-r-upper-leg',
  'joint-l-knee',
  'joint-r-knee',
  'joint-l-ankle',
  'joint-r-ankle',
  'joint-pelvis',
  'joint-spine-1',
  'joint-spine-2',
  'joint-spine-3',
  'joint-ground',
];
const keep = new Set([...groups.get('body'), ...groups.get('helper-l-eye'), ...groups.get('helper-r-eye')]);
for (const j of JOINTS) for (const i of groups.get(j)) keep.add(i);
const order = [...keep].sort((a, b) => a - b);
const remap = new Map(order.map((v, i) => [v, i]));
const tris = (name) => {
  const out = [];
  for (const f of faces.get(name)) {
    const q = f.map((i) => remap.get(i));
    out.push(q[0], q[1], q[2]);
    if (q.length === 4) out.push(q[0], q[2], q[3]);
  }
  return Uint16Array.from(out);
};
const base = new Float32Array(order.length * 3);
order.forEach((v, i) => V[v].forEach((c, k) => (base[3 * i + k] = c * DM)));
const joints = Object.fromEntries(JOINTS.map((j) => [j.replace('joint-', ''), [...groups.get(j)].map((i) => remap.get(i))]));

const TARGETS = [];
for (const s of ['female', 'male']) {
  TARGETS.push(`caucasian-${s}-young`);
  for (const m of ['average', 'max']) for (const w of ['min', 'average', 'max']) TARGETS.push(`universal-${s}-young-${m}muscle-${w}weight`);
}
const Q = 0.05; // mm je Einheit der gespeicherten Verschiebungen
const blocks = [];
const meta = {
  format: 'vektordesign-avatar',
  version: 1,
  source: 'MakeHuman 1.x base mesh and macro targets, CC0 (makehumancommunity.org)',
  unit: 'mm',
  q: Q,
  count: order.length,
  joints,
  targets: [],
};
const push = (name, arr) => {
  blocks.push({ name, arr });
};
push('base', base);
push('body', tris('body'));
push('eyes', Uint16Array.from([...tris('helper-l-eye'), ...tris('helper-r-eye')]));
for (const t of TARGETS) {
  const txt = await read(`targets/${t}.target`);
  const idx = [];
  const d = [];
  for (const line of txt.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const [i, x, y, z] = line.trim().split(/\s+/).map(Number);
    if (!remap.has(i)) continue;
    idx.push(remap.get(i));
    d.push(Math.round((x * DM) / Q), Math.round((y * DM) / Q), Math.round((z * DM) / Q));
  }
  meta.targets.push({ name: t, n: idx.length });
  push(`${t}:i`, Uint16Array.from(idx));
  push(`${t}:d`, Int16Array.from(d));
}
// Datei: [u32 Länge Kopf][Kopf JSON][Füllung auf 4][Blöcke, je auf 4 ausgerichtet]
let off = 0;
meta.blocks = blocks.map((b) => {
  const bytes = b.arr.byteLength;
  const e = { name: b.name, type: b.arr.constructor.name, offset: off, length: b.arr.length };
  off += Math.ceil(bytes / 4) * 4;
  return e;
});
const head = new TextEncoder().encode(JSON.stringify(meta));
const headLen = Math.ceil((head.length + 4) / 4) * 4;
const out = new Uint8Array(headLen + off);
new DataView(out.buffer).setUint32(0, head.length, true);
out.set(head, 4);
blocks.forEach((b, i) => out.set(new Uint8Array(b.arr.buffer, b.arr.byteOffset, b.arr.byteLength), headLen + meta.blocks[i].offset));
mkdirSync(join(ROOT, 'src/sim3d/avatar-data'), { recursive: true });
writeFileSync(join(ROOT, 'src/sim3d/avatar-data/makehuman.bin'), out);
console.log(`makehuman.bin: ${order.length} Punkte, ${meta.blocks[1].length / 3} Dreiecke, ${TARGETS.length} Ziele, ${(out.length / 1024).toFixed(0)} KB`);
