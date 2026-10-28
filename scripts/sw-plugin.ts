import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Erzeugt beim Build einen Service Worker (sw.js), der alle Dateien der App vorab speichert.
 * Damit startet die Web-Version auf dem iPad auch ohne Internet (Home-Bildschirm).
 * Bewusst ohne Zusatzpaket: Liste der Dateien + Versionskennung, mehr braucht es nicht.
 */
export function serviceWorker(): Plugin {
  let outDir = 'dist';
  let enabled = true;
  return {
    name: 'vektordesign-sw',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
      // Einzeldatei-Build (ohne public/) braucht keinen Service Worker
      enabled = c.build.copyPublicDir !== false;
    },
    async writeBundle() {
      if (!enabled) return;
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const n of readdirSync(dir)) {
          const p = join(dir, n);
          if (statSync(p).isDirectory()) walk(p);
          else files.push(relative(outDir, p).split('\\').join('/'));
        }
      };
      walk(outDir);
      const list = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const hash = createHash('sha256');
      for (const f of list) hash.update(f).update(String(statSync(join(outDir, f)).size));
      const version = hash.digest('hex').slice(0, 12);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(join(outDir, 'sw.js'), SW.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...list.map((f) => `./${f}`)])));
    },
  };
}

const SW = `// Vektordesign – Service Worker (automatisch erzeugt)
const VERSION = '__VERSION__';
const CACHE = 'vektordesign-' + VERSION;
const FILES = __FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('vektordesign-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // z. B. Anthropic-API: nie zwischenspeichern
  if (req.mode === 'navigate') {
    // Seite: aus dem Speicher (offline), sonst Netz
    event.respondWith(caches.match('./index.html').then((r) => r || caches.match('./')).then((r) => r || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r || fetch(req)));
});
`;
