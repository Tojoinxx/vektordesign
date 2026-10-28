#!/usr/bin/env node
/**
 * Baut Vektordesign als eine einzige HTML-Datei: Code, Schriften und der Solver (WebAssembly)
 * sind eingebettet. Die Datei läuft ohne Installation und ohne Internet – doppelklicken, und sie
 * öffnet sich im Browser (Chrome, Edge oder Firefox). Praktisch zum schnellen Ausprobieren
 * und Weitergeben, bis die installierbare iPad-Version (Meilenstein 4) da ist.
 *
 *   npm run build:single   →   dist-single/Vektordesign.html
 */
import { readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = join(root, 'dist-single');

await build({
  root,
  configFile: join(root, 'vite.config.ts'),
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    cssCodeSplit: false,
    // Alles als data:-URL einbetten (Schriften, Solver)
    assetsInlineLimit: () => true,
    // Ein einziges Skript, auch für dynamisch geladene Teile
    rolldownOptions: { output: { codeSplitting: false } },
  },
});

const read = (rel) => readFileSync(join(outDir, rel.replace(/^\.\//, '')), 'utf8');
let html = read('index.html');

// Skript und Stylesheet in die Seite holen. „</script“, „<script“ und „<!--“ im Code dürfen den
// HTML-Parser nicht aus dem Skript werfen; als \x3C geschrieben bleibt der Wert in Strings und Regex gleich.
const safeJs = (code) => code.replace(/<(\/?script|!--)/gi, '\\x3C$1');
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, (_, src) => `<script type="module">${safeJs(read(src))}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/, (_, href) => `<style>${read(href).replace(/<\/style/gi, '<\\/style')}</style>`);
const favicon = readFileSync(join(root, 'public', 'favicon.svg')).toString('base64');
html = html.replace('href="./favicon.svg"', `href="data:image/svg+xml;base64,${favicon}"`);
html = html.replace(/\s*<link rel="modulepreload"[^>]*>/g, '');
// Web-App-Angaben (Manifest, Home-Bildschirm-Symbol) braucht die Einzeldatei nicht
html = html.replace(/\s*<link rel="(?:manifest|apple-touch-icon)"[^>]*>/g, '');

const leftover = html.match(/(?:src|href)="\.\/[^"]+"/);
if (leftover) throw new Error(`Nicht eingebettet: ${leftover[0]}`);

const target = join(outDir, 'Vektordesign.html');
writeFileSync(target, html);
rmSync(join(outDir, 'assets'), { recursive: true, force: true });
rmSync(join(outDir, 'index.html'));
console.log(`Einzeldatei: ${target} (${(statSync(target).size / 1024 / 1024).toFixed(1)} MB)`);
