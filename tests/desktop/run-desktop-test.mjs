/**
 * Startet die echte Desktop-App und lässt tests/desktop/selftest.js im Fenster laufen.
 *
 *   npm run test:desktop
 *       baut eine Debug-Version mit eingebetteter Oberfläche (tauri build --debug --no-bundle) und testet sie
 *   node tests/desktop/run-desktop-test.mjs --binary <pfad>
 *       testet ein vorhandenes Programm (Release-Builds nur mit Cargo-Feature „selftest“)
 *
 * Unter Linux ohne Bildschirm läuft das Fenster in Xvfb (xvfb-run).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const argv = process.argv.slice(2);
const binArg = argv.includes('--binary') ? argv[argv.indexOf('--binary') + 1] : null;
const win = process.platform === 'win32';
const binary = binArg ? resolve(binArg) : join(ROOT, 'src-tauri', 'target', 'debug', `vektordesign${win ? '.exe' : ''}`);

if (!binArg) {
  console.log('Baue Debug-Version mit eingebetteter Oberfläche …');
  const r = spawnSync('npx', ['tauri', 'build', '--debug', '--no-bundle'], { cwd: ROOT, stdio: 'inherit', shell: win });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (!existsSync(binary)) {
  console.error(`Programm nicht gefunden: ${binary}`);
  process.exit(2);
}

// Testordner mit Umlaut und Leerzeichen im Namen
const dir = mkdtempSync(join(tmpdir(), 'vektordesign selbsttest ä-'));
const out = join(dir, 'ergebnis.json');
const script = readFileSync(join(import.meta.dirname, 'selftest.js'), 'utf8')
  .replace('const OUT = __OUT__;', `const OUT = ${JSON.stringify(out)};`)
  .replace('const DIR = __DIR__;', `const DIR = ${JSON.stringify(dir)};`);
const scriptPath = join(dir, 'selftest.js');
writeFileSync(scriptPath, script);

const env = { ...process.env, VEKTORDESIGN_SELFTEST: scriptPath };
const xvfb = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
if (process.platform === 'linux') {
  env.WEBKIT_DISABLE_DMABUF_RENDERER ??= '1';
  env.NO_AT_BRIDGE ??= '1';
}
const child = xvfb
  ? spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', binary], { env, stdio: ['ignore', 'inherit', 'inherit'], detached: true })
  : spawn(binary, [], { env, stdio: ['ignore', 'inherit', 'inherit'], detached: !win });

let exited = false;
child.on('exit', () => {
  exited = true;
});

const t0 = Date.now();
const timeout = Number(process.env.SELFTEST_TIMEOUT_MS ?? 120000);
let report = null;
while (Date.now() - t0 < timeout && !exited) {
  if (existsSync(out)) {
    try {
      report = JSON.parse(readFileSync(out, 'utf8'));
      break;
    } catch {
      /* wird noch geschrieben */
    }
  }
  await new Promise((r) => setTimeout(r, 250));
}

// Fenster schließen
try {
  if (win) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
  else process.kill(-child.pid, 'SIGTERM');
} catch {
  child.kill();
}
rmSync(dir, { recursive: true, force: true });

if (!report) {
  console.error(exited ? 'Die App wurde beendet, bevor der Selbsttest fertig war.' : `Kein Ergebnis nach ${timeout / 1000} s.`);
  process.exit(1);
}
console.log(`\nDesktop-Selbsttest (${report.userAgent})`);
for (const c of report.checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail && (!c.ok || c.name.includes('Schrift')) ? ` – ${c.detail}` : ''}`);
if (report.problems.length) {
  console.log('\nProbleme im Fenster:');
  for (const p of report.problems) console.log(`  ${p}`);
}
const passed = report.checks.filter((c) => c.ok).length;
console.log(`\n${passed} von ${report.checks.length} Prüfungen bestanden in ${report.ms} ms.`);
process.exit(report.ok ? 0 : 1);
