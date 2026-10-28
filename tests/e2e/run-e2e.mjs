/**
 * End-to-End-Test im echten Browser (Chromium über puppeteer-core).
 *
 * Ablauf: Produktionsbuild mit `vite preview` starten, die Oberfläche mit Maus und Tastatur
 * bedienen und die exportierten Dateien prüfen – inklusive Abnahmekriterium Meilenstein 1.
 *
 * Aufruf:  CHROME_PATH=/pfad/zu/chrome npm run test:e2e
 * Optional: CHROME_ARGS="--no-sandbox --headless=new", E2E_URL=http://localhost:4173/
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '../..');
const OUT = join(ROOT, 'tests/e2e/output');
const DL = join(OUT, 'downloads');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const chromePath = process.env.CHROME_PATH;
if (!chromePath) {
  console.error('CHROME_PATH fehlt (Pfad zu Chrome/Chromium).');
  process.exit(2);
}
const extraArgs = (process.env.CHROME_ARGS ?? '--no-sandbox --disable-gpu').split(/\s+/).filter(Boolean);

let server = null;
const url = process.env.E2E_URL ?? 'http://localhost:4173/';
if (!process.env.E2E_URL) {
  server = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite preview startet nicht')), 30000);
    server.stdout.on('data', (d) => {
      if (String(d).includes('4173')) {
        clearTimeout(t);
        res();
      }
    });
    server.on('exit', (c) => rej(new Error(`vite preview beendet (${c})`)));
  });
}

const results = [];
let failed = 0;
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push(`✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    failed++;
    let dump = '';
    try {
      dump = await page.evaluate(() => {
        const s = window.vektordesign.store.getState();
        return JSON.stringify({ tool: s.tool, dimPrompt: s.dimPrompt, dims: Object.values(s.doc.dims).map((d) => `${d.name}=${d.expr}`), sel: s.selection, active: `${document.activeElement?.tagName}.${document.activeElement?.className}` });
      });
    } catch {
      /* egal */
    }
    results.push(`✗ ${name}: ${e.message}\n     Zustand: ${dump}`);
    try {
      await page.screenshot({ path: join(OUT, `FEHLER-${name.replace(/[^a-z0-9]+/gi, '_')}.png`) });
    } catch {
      /* egal */
    }
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await puppeteer.launch({ executablePath: chromePath, args: extraArgs, headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`);
});
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
// Downloads statt Speichern-Dialog; Tutorials im Hauptablauf aus
await page.evaluateOnNewDocument(() => {
  try {
    delete window.showSaveFilePicker;
    window.showSaveFilePicker = undefined;
  } catch {
    /* egal */
  }
});

// ---------------------------------------------------------------------------
// Hilfen: Weltkoordinaten (mm) → Bildschirm
// ---------------------------------------------------------------------------

const app = (fn, ...args) => page.evaluate(fn, ...args);
async function screenOf(x, y) {
  return app(
    ([wx, wy]) => {
      const a = window.vektordesign;
      const vp = a.canvas.vp();
      const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
      return { x: c.left + (wx - vp.cx) * vp.zoom + vp.width / 2, y: c.top + vp.height / 2 - (wy - vp.cy) * vp.zoom };
    },
    [x, y],
  );
}
async function clickWorld(x, y) {
  const s = await screenOf(x, y);
  await page.mouse.move(s.x, s.y, { steps: 4 });
  await page.mouse.click(s.x, s.y);
}
/** Klick relativ zu einem Weltpunkt, Versatz in Bildschirmpixeln (unabhängig vom Zoom). */
async function clickNear(x, y, dx, dy) {
  const s = await screenOf(x, y);
  await page.mouse.move(s.x + dx, s.y + dy, { steps: 4 });
  await page.mouse.click(s.x + dx, s.y + dy);
}
async function moveWorld(x, y) {
  const s = await screenOf(x, y);
  await page.mouse.move(s.x, s.y, { steps: 6 });
}
const statusText = () => page.$eval('[data-testid="sketch-status"]', (e) => e.textContent.trim());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(name) {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}
async function waitDownload(ext, before) {
  for (let i = 0; i < 60; i++) {
    const f = readdirSync(DL).filter((n) => n.endsWith(`.${ext}`) && !before.includes(n));
    if (f.length) return join(DL, f[0]);
    await sleep(100);
  }
  throw new Error(`Kein ${ext}-Download`);
}
async function newDoc() {
  await app(() => {
    const a = window.vektordesign;
    a.editor.newDocument();
    a.setTool('select');
  });
  await sleep(100);
}

// ---------------------------------------------------------------------------

await step('App lädt, Solver bereit, Willkommens-Tutorial erscheint', async () => {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.vektordesign?.store.getState().solverReady === true, { timeout: 15000 });
  await page.waitForSelector('[data-testid="tutorial"]', { timeout: 5000 });
  await shot('01-start');
  await page.click('[data-testid="tutorial-ok"]');
  await app(() => localStorage.setItem('vd.tutorials.off', '1'));
});

await step('Dunkles Design ist Standard; Design und Zeichenfläche getrennt umschaltbar und gespeichert', async () => {
  // Helligkeit der leeren Zeichenfläche unten rechts (Gerätepixel)
  const canvasLum = () =>
    app(() => {
      const c = document.querySelector('[data-testid="canvas"]');
      const d = c.getContext('2d').getImageData(c.width - 40, c.height - 40, 1, 1).data;
      return (d[0] + d[1] + d[2]) / 3;
    });
  const attrs = () => app(() => `${document.documentElement.dataset.theme}/${document.documentElement.dataset.canvas}`);
  assert((await attrs()) === 'dark/dark', `Start: ${await attrs()}`);
  assert((await canvasLum()) < 60, `Zeichenfläche nicht dunkel (${await canvasLum()})`);
  await page.click('[data-testid="appearance"]');
  await page.waitForSelector('.appearance-menu');
  await page.click('[data-testid="canvas-light"]');
  await sleep(120);
  assert((await attrs()) === 'dark/light', `Helle Fläche: ${await attrs()}`);
  assert((await canvasLum()) > 200, `Zeichenfläche nicht hell (${await canvasLum()})`);
  await page.click('[data-testid="theme-light"]');
  await sleep(80);
  assert((await attrs()) === 'light/light', `Helles Design: ${await attrs()}`);
  const bg = await app(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor);
  assert(bg === 'rgb(255, 255, 255)', `Kopfzeile ${bg}`);
  const stored = await app(() => localStorage.getItem('vd.appearance'));
  assert(stored.includes('"theme":"light"') && stored.includes('"canvas":"light"'), `gespeichert: ${stored}`);
  await page.click('[data-testid="theme-dark"]');
  await page.click('[data-testid="canvas-auto"]');
  await page.keyboard.press('Escape');
  await sleep(80);
  assert((await attrs()) === 'dark/dark', `Zurück: ${await attrs()}`);
  assert(!(await page.$('.appearance-menu')), 'Menü bleibt offen');
});

await step('Abnahme M1 (Variante A): Mittelpunkt-Rechteck mit Werteingabe, Kreis Ø10 → vollständig bestimmt', async () => {
  await page.click('[data-testid="rect-mode-center"]');
  await clickWorld(0, 0); // fängt den Ursprung
  await moveWorld(28, 14);
  await page.keyboard.type('80');
  await page.keyboard.press('Tab');
  await page.keyboard.type('40');
  await shot('02-rechteck-werteingabe');
  await page.keyboard.press('Enter');
  await sleep(150);
  assert((await statusText()) === 'Vollständig bestimmt', `Status nach Rechteck: ${await statusText()}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await clickWorld(0, 0); // Rechteckmitte
  await moveWorld(9, 3);
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await sleep(150);
  const st = await statusText();
  assert(st === 'Vollständig bestimmt', `Status: ${st}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await sleep(150);
  await shot('03-abnahme-vollstaendig-bestimmt');
});

await step('SVG-Export über die Oberfläche hat exakt 80 × 40 mm', async () => {
  const before = readdirSync(DL);
  await page.click('[data-testid="export-svg"]');
  await page.waitForSelector('[data-testid="export-dialog"]');
  const info = await page.$eval('[data-testid="export-info"]', (e) => e.textContent);
  assert(info.includes('80 × 40 mm'), `Exportdialog zeigt: ${info}`);
  await shot('04-exportdialog');
  await page.click('[data-testid="export-run"]');
  const file = await waitDownload('svg', before);
  const svg = readFileSync(file, 'utf8');
  assert(svg.includes('width="80mm" height="40mm" viewBox="0 0 80 40"'), 'SVG-Maße falsch');
  assert(svg.includes('d="M0 40 L80 40 L80 0 L0 0 Z"'), 'Rechteckpfad falsch');
  assert(/<circle id="c\d+" cx="40" cy="20" r="5"/.test(svg), 'Kreis falsch');
  assert(!/<text/.test(svg), 'SVG enthält Bemaßungstext');
});

await step('PNG-Export: 300 dpi, 945 × 473 px, transparenter Hintergrund', async () => {
  const before = readdirSync(DL);
  await page.click('[data-testid="export-png"]');
  await page.waitForSelector('[data-testid="export-dialog"]');
  await page.click('[data-testid="export-run"]');
  const file = await waitDownload('png', before);
  const bytes = readFileSync(file);
  const w = bytes.readUInt32BE(16);
  const h = bytes.readUInt32BE(20);
  assert(w === 945 && h === 473, `Größe ${w} × ${h}`);
  const i = bytes.indexOf(Buffer.from('pHYs'));
  assert(i > 0, 'pHYs fehlt');
  const ppm = bytes.readUInt32BE(i + 4);
  assert(Math.round(ppm * 0.0254) === 300, `dpi ${ppm * 0.0254}`);
  // Transparenz zwischen Rechteckkante und Kreis prüfen (im Browser dekodieren)
  const alpha = await app(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return [ctx.getImageData(200, 236, 1, 1).data[3], ctx.getImageData(472, 236, 1, 1).data[3]];
  }, bytes.toString('base64'));
  assert(alpha[0] === 0, `Hintergrund nicht transparent (Alpha ${alpha[0]})`);
});

await step('Abnahme M1 (Variante B): grob zeichnen, mit Bemaßungswerkzeug und Abhängigkeiten festlegen', async () => {
  await newDoc();
  await page.click('[data-testid="rect-mode-corner"]');
  await clickWorld(-31, -17);
  await clickWorld(35, 23);
  await page.keyboard.press('Escape');
  const ids = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const path = Object.values(d.entities).find((e) => e.kind === 'path');
    const lines = path.edges.map((e) => d.entities[e.id]);
    const P = (id) => d.points[id];
    const center = Object.values(d.points).find((p) => p.owner === path.id);
    return {
      bottom: [P(lines[0].p1), P(lines[0].p2)],
      right: [P(lines[1].p1), P(lines[1].p2)],
      center: { x: center.x, y: center.y },
    };
  });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  // Breite bemaßen
  await page.keyboard.press('d');
  const mb = mid(...ids.bottom);
  await clickNear(mb.x, mb.y, 30, 0);
  await clickNear(mb.x, mb.y, 0, 50);
  await page.waitForSelector('[data-testid="dim-input"]');
  await shot('05-bemassung-eingabe');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('80');
  await page.keyboard.press('Enter');
  await sleep(120);
  // Ansicht anpassen, Werkzeug bleibt aktiv
  await app(() => window.vektordesign.editor.zoomToFit());
  await sleep(80);
  // Höhe bemaßen (rechte Linie hat sich verschoben → neu lesen)
  const right = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const path = Object.values(d.entities).find((e) => e.kind === 'path');
    const l = d.entities[path.edges[1].id];
    return [d.points[l.p1], d.points[l.p2]];
  });
  const mr = mid(...right);
  await clickNear(mr.x, mr.y, 0, -30);
  await clickNear(mr.x, mr.y, 50, 0);
  await page.waitForSelector('[data-testid="dim-input"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('d0/2');
  await page.keyboard.press('Enter');
  await sleep(120);
  await page.keyboard.press('Escape');
  let st = await statusText();
  assert(st.startsWith('Unterbestimmt – noch 2 Bemaßungen'), `Status: ${st}`);
  // Mitte koinzident mit dem Ursprung
  const c = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const p = Object.values(d.points).find((q) => q.owner && d.entities[q.owner]?.kind === 'path');
    return { x: p.x, y: p.y };
  });
  await app(() => window.vektordesign.editor.zoomToFit());
  await sleep(80);
  await page.click('[data-testid="constraint-coincident"]');
  await clickWorld(c.x, c.y);
  await clickWorld(0, 0);
  await page.keyboard.press('Escape');
  await sleep(120);
  st = await statusText();
  assert(st === 'Vollständig bestimmt', `Status nach Koinzidenz: ${st}`);
  // Kreis grob, dann konzentrisch + Durchmesser
  await page.keyboard.press('c');
  await clickWorld(6, 4);
  await clickWorld(13, 4);
  await page.keyboard.press('Escape');
  st = await statusText();
  assert(st.includes('noch 3 Bemaßungen'), `Status mit freiem Kreis: ${st}`);
  await page.click('[data-testid="constraint-concentric"]');
  await clickWorld(13, 4); // Kreislinie
  await clickWorld(0, 0); // Rechteckmitte (= Ursprung)
  await page.keyboard.press('Escape');
  await page.keyboard.press('d');
  const circ = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const ci = Object.values(d.entities).find((e) => e.kind === 'circle');
    return { r: ci.r };
  });
  await clickWorld(circ.r, 0);
  await clickNear(circ.r, 0, 50, -50);
  await page.waitForSelector('[data-testid="dim-input"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await sleep(150);
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  st = await statusText();
  assert(st === 'Vollständig bestimmt', `Status am Ende: ${st}`);
  const vals = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const path = Object.values(d.entities).find((e) => e.kind === 'path');
    const xs = path.edges.flatMap((e) => [d.points[d.entities[e.id].p1].x, d.points[d.entities[e.id].p2].x]);
    const ys = path.edges.flatMap((e) => [d.points[d.entities[e.id].p1].y, d.points[d.entities[e.id].p2].y]);
    const ci = Object.values(d.entities).find((e) => e.kind === 'circle');
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys), r: ci.r, cx: d.points[ci.center].x, cy: d.points[ci.center].y };
  });
  assert(vals.minX === -40 && vals.maxX === 40 && vals.minY === -20 && vals.maxY === 20, `Rechteck ${JSON.stringify(vals)}`);
  assert(vals.r === 5 && vals.cx === 0 && vals.cy === 0, `Kreis ${JSON.stringify(vals)}`);
  await shot('06-variante-b-vollstaendig');
});

await step('Überbestimmung: verständliche Meldung und getriebene Bemaßung', async () => {
  const top = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const path = Object.values(d.entities).find((e) => e.kind === 'path');
    const l = d.entities[path.edges[2].id];
    return [d.points[l.p1], d.points[l.p2]];
  });
  await page.keyboard.press('d');
  await clickNear((top[0].x + top[1].x) / 2, top[0].y, 30, 0);
  await clickNear((top[0].x + top[1].x) / 2, top[0].y, 0, -45);
  await page.waitForSelector('[data-testid="confirm-dialog"]');
  const txt = await page.$eval('[data-testid="confirm-dialog"]', (e) => e.textContent);
  assert(txt.includes('überbestimmen'), `Meldung: ${txt}`);
  await shot('07-ueberbestimmt-dialog');
  await page.click('[data-testid="confirm-ok"]');
  await sleep(120);
  const driven = await app(() => Object.values(window.vektordesign.store.getState().doc.dims).filter((x) => x.driven).length);
  assert(driven === 1, 'keine getriebene Bemaßung');
  await page.keyboard.press('Escape');
  assert((await statusText()) === 'Vollständig bestimmt', 'Status nach getriebener Bemaßung');
});

await step('Doppelklick auf Bemaßung ändert den Wert, abhängige Bemaßung d1 = d0/2 folgt', async () => {
  const pos = await app(() => {
    const a = window.vektordesign;
    const d = Object.values(a.store.getState().doc.dims).find((x) => x.name === 'd0');
    const b = a.canvas.layout().dims.find((x) => x.id === d.id).textBox;
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    return { x: c.left + b.x + b.w / 2, y: c.top + b.y + b.h / 2 };
  });
  await page.mouse.click(pos.x, pos.y, { count: 2 });
  await page.waitForSelector('[data-testid="dim-input"]');
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await sleep(150);
  const w = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const path = Object.values(d.entities).find((e) => e.kind === 'path');
    const l = d.entities[path.edges[0].id];
    return [d.points[l.p2].x - d.points[l.p1].x, Object.values(d.dims).find((x) => x.name === 'd1').value];
  });
  assert(w[0] === 100 && w[1] === 50, `Breite/Höhe ${w}`);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
});

await step('Farbverlauf: Füllung setzen, Strich durch die Form ziehen, Verblassen', async () => {
  await page.keyboard.press('Escape');
  await clickWorld(-30, 15); // in die Fläche (Pfad) klicken → noch keine Füllung → Kante?
  // Pfad über die Auswahl setzen
  await app(() => {
    const a = window.vektordesign;
    const d = a.store.getState().doc;
    const path = Object.values(d.entities).find((e) => e.kind === 'path');
    a.editor.select([path.id]);
    a.editor.setStyle([path.id], { fill: '#2f6fd6' });
  });
  await page.keyboard.press('g');
  await sleep(100);
  const box = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    const xs = Object.values(d.points).map((p) => p.x);
    return { minX: Math.min(...xs), maxX: Math.max(...xs) };
  });
  const a = await screenOf(box.minX + 5, 0);
  const b = await screenOf(box.maxX - 5, 0);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  await sleep(120);
  const fill = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    return Object.values(d.entities).find((e) => e.kind === 'path').style.fill;
  });
  assert(typeof fill === 'object' && fill.kind === 'linear', 'kein Verlauf');
  assert(fill.from.x < 0.1 && fill.to.x > 0.9, `Richtung ${JSON.stringify(fill)}`);
  assert(fill.stops[fill.stops.length - 1].opacity === 0, 'Verblassen fehlt');
  await page.keyboard.press('Escape');
  await page.click('[data-testid="tab-props"]');
  await app(() => {
    const a = window.vektordesign;
    const d = a.store.getState().doc;
    a.editor.select([Object.values(d.entities).find((e) => e.kind === 'path').id]);
  });
  await sleep(100);
  await shot('08-farbverlauf');
});

await step('Stilvorschläge: mindestens 8 Vorschaubilder, Klick übernimmt', async () => {
  const n = await page.$$eval('[data-testid="suggestion"]', (l) => l.length);
  assert(n >= 8, `nur ${n} Vorschläge`);
  const before = await app(() => window.vektordesign.store.getState().past.length);
  const btns = await page.$$('[data-testid="suggestion"]');
  await btns[1].click();
  await sleep(100);
  const after = await app(() => window.vektordesign.store.getState().past.length);
  assert(after === before + 1, 'Vorschlag nicht übernommen');
  await shot('09-stilvorschlaege');
});

await step('Markierungsmenü (Rechtsklick) und Befehlssuche (Strg+K)', async () => {
  await page.keyboard.press('f');
  await sleep(80);
  const cv = await page.$eval('[data-testid="canvas"]', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 120, y: r.bottom - 120 }; });
  await page.mouse.click(cv.x, cv.y, { button: 'right' });
  await page.waitForSelector('.marking');
  await shot('10-markierungsmenue');
  await page.keyboard.press('Escape');
  await page.keyboard.down('Control');
  await page.keyboard.press('k');
  await page.keyboard.up('Control');
  await page.waitForSelector('.palette');
  await page.keyboard.type('parallel');
  await shot('11-befehlssuche');
  await page.keyboard.press('Enter');
  const tool = await app(() => window.vektordesign.store.getState().tool);
  assert(tool === 'constraint:parallel', `Werkzeug ${tool}`);
  await page.keyboard.press('Escape');
});

await step('Text setzen und bearbeiten', async () => {
  await newDoc();
  await page.keyboard.press('t');
  await clickWorld(-20, 0);
  await page.waitForSelector('[data-testid="text-input"]');
  await page.keyboard.type('TEAM');
  await page.keyboard.press('Enter');
  await sleep(100);
  const t = await app(() => Object.values(window.vektordesign.store.getState().doc.entities).find((e) => e.kind === 'text')?.text);
  assert(t === 'TEAM', `Text ${t}`);
  await page.keyboard.press('Escape');
});

await step('Claude-Tab: Einrichtung ohne Schlüssel, Bild anhängen möglich', async () => {
  await page.click('[data-testid="tab-claude"]');
  await page.waitForSelector('[data-testid="assistant"]');
  const txt = await page.$eval('[data-testid="assistant"]', (e) => e.textContent);
  assert(txt.includes('API-Schlüssel'), 'Einrichtungshinweis fehlt');
  await shot('12-claude-tab');
});

await step('Linie im Kettenmodus schließt Kontur, Esc beendet', async () => {
  await newDoc();
  await page.keyboard.press('l');
  await clickWorld(0, 0);
  await clickWorld(40, 0);
  await clickWorld(40, 30);
  await clickWorld(0, 0);
  await sleep(100);
  const r = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    return { paths: Object.values(d.entities).filter((e) => e.kind === 'path').length, h: Object.values(d.constraints).filter((c) => c.kind === 'horizontal').length };
  });
  assert(r.paths === 1, 'keine geschlossene Kontur');
  assert(r.h >= 1, 'keine automatische Horizontal-Abhängigkeit');
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await shot('13-kettenlinie');
});

await step('Rückgängig/Wiederholen über Tastatur', async () => {
  const n0 = await app(() => Object.keys(window.vektordesign.store.getState().doc.entities).length);
  await page.keyboard.down('Control');
  await page.keyboard.press('z');
  await page.keyboard.up('Control');
  const n1 = await app(() => Object.keys(window.vektordesign.store.getState().doc.entities).length);
  await page.keyboard.down('Control');
  await page.keyboard.press('y');
  await page.keyboard.up('Control');
  const n2 = await app(() => Object.keys(window.vektordesign.store.getState().doc.entities).length);
  assert(n1 < n0 && n2 === n0, `${n0} → ${n1} → ${n2}`);
});

// ---------------------------------------------------------------------------
// Meilenstein 2
// ---------------------------------------------------------------------------

const entities = () => app(() => Object.values(window.vektordesign.store.getState().doc.entities).map((e) => ({ id: e.id, kind: e.kind, fill: e.style.fill, layer: e.layer ?? null })));
async function waitFor(fn, msg, ms = 6000) {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return;
    await sleep(100);
  }
  throw new Error(msg);
}
async function exportVia(format, ext) {
  // gleicher Dateiname wie vorher → Chromium überschreibt; daher Ordner leeren
  for (const f of readdirSync(DL)) rmSync(join(DL, f), { force: true });
  const before = [];
  await app(() => window.vektordesign.openExport('svg'));
  await page.waitForSelector('[data-testid="export-dialog"]');
  await page.click(`[data-testid="format-${format}"]`);
  await page.click('[data-testid="export-run"]');
  try {
    const f = await waitDownload(ext, before);
    await sleep(100);
    copyFileSync(f, join(OUT, `m2-logo.${ext}`));
    return f;
  } catch (e) {
    const toasts = await app(() => window.vektordesign.store.getState().toasts.map((t) => `${t.kind}: ${t.text}`));
    throw new Error(`${e.message} – Meldungen: ${toasts.join(' | ')}`);
  }
}

await step('Bearbeiten-Leiste: Registerkarte, Messen (Fläche/Umfang), Drehen über Dialog, Muster', async () => {
  await newDoc();
  await app(() => {
    const ed = window.vektordesign.editor;
    ed.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'center', { width: '80', height: '40' });
  });
  await page.click('[data-testid="ribbon-edit"]');
  await page.waitForSelector('[data-testid="tool-measure"]');
  await shot('20-leiste-bearbeiten');
  await page.click('[data-testid="tool-measure"]');
  await clickWorld(17, 9);
  await page.waitForSelector('[data-testid="measure-card"]');
  const card = await page.$eval('[data-testid="measure-card"]', (e) => e.textContent);
  assert(card.includes('3200 mm²') || card.includes('3.200 mm²'), `Messkarte: ${card}`);
  assert(card.includes('240 mm'), `Umfang fehlt: ${card}`);
  await shot('21-messen');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Drehen: alles auswählen, Dialog, 90°
  await app(() => window.vektordesign.editor.selectAll());
  await page.click('[data-testid="edit-rotate"]');
  await page.waitForSelector('[data-testid="param-dialog"]');
  await shot('22-dialog-drehen');
  await page.click('[data-testid="param-ok"]');
  await sleep(200);
  let b = await app(() => window.vektordesign.bbox());
  assert(Math.abs(b.maxX - b.minX - 40) < 1e-6 && Math.abs(b.maxY - b.minY - 80) < 1e-6, `Nach Drehen ${b.maxX - b.minX} × ${b.maxY - b.minY}`);
  // Muster: 3 Spalten im Abstand 50
  await app(() => window.vektordesign.editor.selectAll());
  await page.click('[data-testid="edit-pattern-rect"]');
  await page.waitForSelector('[data-testid="param-dialog"]');
  await page.$eval('[data-testid="param-dx"]', (el) => {
    el.focus();
    el.select();
  });
  await page.keyboard.type('50');
  await page.keyboard.press('Enter');
  await sleep(250);
  b = await app(() => window.vektordesign.bbox());
  assert(Math.abs(b.maxX - b.minX - 140) < 1e-6, `Musterbreite ${b.maxX - b.minX}`);
  const paths = (await entities()).filter((e) => e.kind === 'path').length;
  assert(paths === 3, `${paths} Rechtecke statt 3`);
  await page.keyboard.press('Escape');
});

await step('Stutzen (X): Mittelstück einer gekreuzten Linie entfernen', async () => {
  await newDoc();
  await app(() => {
    const ed = window.vektordesign.editor;
    ed.createLine({ pos: { x: -30, y: 0 } }, { pos: { x: 30, y: 0 } }, {});
    ed.createLine({ pos: { x: -10, y: -20 } }, { pos: { x: -10, y: 20 } }, {});
    ed.createLine({ pos: { x: 10, y: -20 } }, { pos: { x: 10, y: 20 } }, {});
  }).catch(() => {});
  let lines = (await entities()).filter((e) => e.kind === 'line').length;
  if (lines < 3) {
    // Fallback über die Oberfläche
    await page.keyboard.press('l');
    for (const [a, c] of [[[-30, 0], [30, 0]], [[-10, -20], [-10, 20]], [[10, -20], [10, 20]]]) {
      await clickWorld(...a);
      await clickWorld(...c);
      await page.keyboard.press('Escape');
    }
    await page.keyboard.press('Escape');
    lines = (await entities()).filter((e) => e.kind === 'line').length;
  }
  assert(lines === 3, `${lines} Linien`);
  await page.keyboard.press('x');
  await clickWorld(0, 0);
  await sleep(150);
  const lens = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    return Object.values(d.entities)
      .filter((e) => e.kind === 'line')
      .map((l) => Math.hypot(d.points[l.p2].x - d.points[l.p1].x, d.points[l.p2].y - d.points[l.p1].y))
      .sort((a, b) => a - b);
  });
  assert(lens.length === 4 && Math.abs(lens[0] - 20) < 1e-6 && Math.abs(lens[1] - 20) < 1e-6, `Längen nach Stutzen: ${lens.join(', ')}`);
  await page.keyboard.press('Escape');
});

await step('Abnahme M2: Logo aus Text und Formen, 100 mm breit, zwei Farben, Text in Pfade, vereinigt', async () => {
  await newDoc();
  await page.click('[data-testid="ribbon-sketch"]');
  // Text über die Oberfläche
  await page.keyboard.press('t');
  await clickWorld(-15, 0);
  await page.waitForSelector('[data-testid="text-input"]');
  await page.keyboard.type('TEAM');
  await page.keyboard.press('Enter');
  await sleep(100);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const textId = (await entities()).find((e) => e.kind === 'text').id;
  // Text in Pfade über die Bearbeiten-Leiste
  await app((id) => window.vektordesign.editor.select([id]), textId);
  await page.click('[data-testid="ribbon-edit"]');
  await page.click('[data-testid="edit-text-to-paths"]');
  await waitFor(async () => (await entities()).some((e) => e.kind === 'shape') && !(await entities()).some((e) => e.kind === 'text'), 'Text wurde nicht in Pfade umgewandelt');
  const tb = await app(() => window.vektordesign.bbox());
  // Unterstrich als Form, dann vereinigen
  const barId = await app(
    (b) => window.vektordesign.editor.createRectangle({ pos: { x: b.minX, y: b.minY - 3 } }, { pos: { x: b.maxX, y: b.minY - 1 } }, 'corner').pathId,
    tb,
  );
  const shapeId = (await entities()).find((e) => e.kind === 'shape').id;
  await app(([a, b]) => window.vektordesign.editor.select([a, b]), [shapeId, barId]);
  await page.click('[data-testid="bool-union"]');
  await waitFor(async () => {
    const es = await entities();
    return es.filter((e) => e.kind === 'shape').length === 1 && !es.some((e) => e.kind === 'path');
  }, 'Vereinigen hat nicht genau eine Form ergeben');
  const logo = (await entities()).find((e) => e.kind === 'shape').id;
  // Breite 100 mm über das Eigenschaftenfeld (legt eine Bemaßung an)
  await app((id) => window.vektordesign.editor.select([id]), logo);
  await page.click('[data-testid="tab-props"]').catch(() => {});
  await page.waitForSelector('[data-testid="shape-width"]');
  await page.$eval('[data-testid="shape-width"]', (el) => {
    el.focus();
    el.select();
  });
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await sleep(200);
  let b = await app((id) => window.vektordesign.bbox([id]), logo);
  assert(Math.abs(b.maxX - b.minX - 100) < 1e-6, `Logobreite ${b.maxX - b.minX}`);
  const wdim = await app(() => Object.values(window.vektordesign.store.getState().doc.dims).find((d) => d.kind === 'width'));
  assert(wdim && Math.abs(wdim.value - 100) < 1e-9 && !wdim.driven, 'Breitenbemaßung fehlt');
  // Zwei Farben: Logo gelb, Hintergrundkreis blau (innerhalb der Breite)
  await app(
    ([id, bb]) => {
      const ed = window.vektordesign.editor;
      ed.setStyle([id], { fill: '#f5c518', stroke: null });
      const c = ed.createCircle({ pos: { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2 } }, 15);
      ed.setStyle([c.circleId], { fill: '#1f3a93', stroke: null });
      ed.arrange([c.circleId], 'back');
      ed.select([]);
    },
    [logo, b],
  );
  b = await app(() => window.vektordesign.bbox());
  assert(Math.abs(b.maxX - b.minX - 100) < 1e-6, `Gesamtbreite ${b.maxX - b.minX}`);
  const H = b.maxY - b.minY;
  await page.keyboard.press('f');
  await sleep(150);
  await shot('23-abnahme-m2-logo');

  // SVG
  const svgFile = await exportVia('svg', 'svg');
  const svg = readFileSync(svgFile, 'utf8');
  const m = svg.match(/width="([\d.]+)mm" height="([\d.]+)mm"/);
  assert(m && Number(m[1]) === 100, `SVG-Breite ${m?.[1]}`);
  assert(Math.abs(Number(m[2]) - H) < 1e-3, `SVG-Höhe ${m?.[2]} statt ${H}`);
  assert(!/<text/.test(svg), 'SVG enthält lebenden Text');
  const fills = new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})"/gi)].map((x) => x[1].toLowerCase()));
  assert(fills.size === 2 && fills.has('#f5c518') && fills.has('#1f3a93'), `Farben im SVG: ${[...fills]}`);

  // PDF
  const pdfFile = await exportVia('pdf', 'pdf');
  const pdf = readFileSync(pdfFile, 'latin1');
  assert(pdf.startsWith('%PDF-'), 'kein PDF');
  assert(pdf.includes('/MediaBox [0 0 283.465 '), `PDF-Seitengröße: ${pdf.match(/\/MediaBox \[[^\]]+\]/)?.[0]}`);

  // PNG 300 dpi, transparent
  const pngFile = await exportVia('png', 'png');
  const bytes = readFileSync(pngFile);
  const w = bytes.readUInt32BE(16);
  assert(w === Math.ceil((100 / 25.4) * 300), `PNG-Breite ${w} px`); // Motiv exakt 100 mm, Bild auf ganze Pixel aufgerundet
  const i = bytes.indexOf(Buffer.from('pHYs'));
  assert(Math.round(bytes.readUInt32BE(i + 4) * 0.0254) === 300, 'PNG nicht 300 dpi');
  const alpha = await app(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(2, Math.round(img.height / 2), 1, 1).data[3]; // links neben dem T-Stamm
  }, bytes.toString('base64'));
  assert(alpha === 0, `PNG-Ecke nicht transparent (${alpha})`);
  results.push(`   Logo: 100 × ${H.toFixed(2)} mm, SVG/PDF/PNG geprüft`);
});

await step('Abnahme M3: Logo auf Hoodie-Brust, Siebdruck, zwei Farbvarianten → ZIP mit Motiven und Artwork-Blatt', async () => {
  // Fortsetzung mit dem Logo aus der Abnahme M2
  await page.click('[data-testid="tab-production"]');
  await page.waitForSelector('[data-testid="production"]');
  const setField = async (sel, value) => {
    await page.$eval(sel, (el) => {
      el.focus();
      el.select();
    });
    await page.keyboard.type(value);
    await page.keyboard.press('Enter');
    await sleep(80);
  };
  await setField('[data-testid="prod-article"]', 'Vereinshoodie');
  await setField('[data-testid="prod-version"]', '2');
  await page.select('[data-testid="prod-garment"]', 'hoodie');
  await page.select('[data-testid="motif-technique-0"]', 'screen');
  await setField('[data-testid="motif-name-0"]', 'Brustlogo');
  // Platzierung: Brust links über die Platzierungsansicht
  await page.click('[data-testid="motif-place-0"]');
  await page.waitForSelector('[data-testid="placement"]');
  await page.click('[data-testid="area-chest-left"]');
  await sleep(200);
  await shot('30-platzierung-hoodie');
  // Motiv per Ziehen 10 mm tiefer schieben, dann exakt 80 mm eingeben
  await setField('[data-testid="placement-y"]', '80');
  await page.click('[data-testid="placement-close"]');
  let p = await app(() => window.vektordesign.editor.s.doc.production);
  assert(p.motifs[0].placement.area === 'chest-left' && p.motifs[0].placement.y === 80 && p.motifs[0].placement.x === 105, `Platzierung ${JSON.stringify(p.motifs[0].placement)}`);
  // Zweite Farbvariante
  await page.click('[data-testid="variant-add"]');
  await sleep(100);
  await setField('[data-testid="variant-name-0"]', 'Schwarz');
  await setField('[data-testid="variant-name-1"]', 'Weiß');
  await app(() =>
    window.vektordesign.editor.updateProduction('Variante Weiß', (q) => {
      q.variants[1].fabric = '#f4f4f2';
      q.variants[1].fabricName = 'Weiß';
      q.variants[1].colors = { '#f5c518': '#c8102e' };
    }),
  );
  await sleep(100);
  await setField('[data-testid="pantone-f5c518"]', '116 C');
  p = await app(() => window.vektordesign.editor.s.doc.production);
  assert(p.variants.length === 2 && p.colorSpecs['#f5c518']?.pantone === '116 C', 'Varianten/Pantone fehlen');
  await page.evaluate(() => document.querySelector('[data-testid="package-export"]').scrollIntoView());
  await shot('31-produktion');
  // Paket über die Oberfläche
  for (const f of readdirSync(DL)) rmSync(join(DL, f), { force: true });
  await page.click('[data-testid="package-export"]');
  const zipFile = await waitDownload('zip', []);
  await sleep(200);
  copyFileSync(zipFile, join(OUT, 'm3-paket.zip'));
  const { unzipSync, strFromU8 } = await import('fflate');
  const files = unzipSync(readFileSync(zipFile));
  const names = Object.keys(files).sort();
  const expect = ['Brustlogo_Schwarz.pdf', 'Brustlogo_Schwarz.svg', 'Brustlogo_Schwarz.png', 'Brustlogo_Weiss.pdf', 'Brustlogo_Weiss.svg', 'Brustlogo_Weiss.png'].map((n) => `Vereinshoodie_v2/Motive/Vereinshoodie_v2_${n}`);
  for (const e of [...expect, 'Vereinshoodie_v2/Vereinshoodie_v2_Artwork-Blatt.pdf', 'Vereinshoodie_v2/Farben.csv', 'Vereinshoodie_v2/LIESMICH.txt']) assert(names.includes(e), `fehlt im ZIP: ${e} (vorhanden: ${names.join(', ')})`);
  const svgW = strFromU8(files['Vereinshoodie_v2/Motive/Vereinshoodie_v2_Brustlogo_Weiss.svg']);
  assert(/width="100mm"/.test(svgW) && svgW.includes('#c8102e') && !svgW.includes('#f5c518'), 'Variante Weiß falsch');
  const png = Buffer.from(files['Vereinshoodie_v2/Motive/Vereinshoodie_v2_Brustlogo_Schwarz.png']);
  assert(png.readUInt32BE(16) === Math.ceil((100 / 25.4) * 300), 'PNG-Breite im Paket');
  const sheet = files['Vereinshoodie_v2/Vereinshoodie_v2_Artwork-Blatt.pdf'];
  const sheetTxt = new TextDecoder('latin1').decode(sheet);
  assert(sheetTxt.startsWith('%PDF-') && /\/Count 2/.test(sheetTxt), 'Artwork-Blatt fehlerhaft');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(OUT, 'm3-artwork-blatt.pdf'), sheet);
  const readme = strFromU8(files['Vereinshoodie_v2/LIESMICH.txt']);
  assert(readme.includes('Siebdruck') && readme.includes('Oberkante 80 mm'), 'LIESMICH unvollständig');
  results.push(`   Paket: ${names.length} Dateien`);
});

await step('Mockup-Vorschau: Logo auf dem Hoodie in Stofffarbe, Kontrast je Druckfarbe', async () => {
  await page.click('[data-testid="tab-production"]');
  await page.click('[data-testid="mockup-open"]');
  await page.waitForSelector('[data-testid="mockup"]');
  await sleep(400);
  const painted = await app(() => {
    const c = document.querySelector('[data-testid="mockup"] canvas');
    const x = c.getContext('2d');
    const d = x.getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return d[3] > 0;
  });
  assert(painted, 'Mockup leer');
  const rows = await page.$$eval('[data-testid="mockup-contrast"] li', (l) => l.map((x) => x.textContent));
  assert(rows.length >= 2, `Kontrastliste: ${rows}`);
  await shot('32-mockup');
  // Schwarzer Stoff + dunkelblaue Farbe → schwacher Kontrast wird gemeldet
  const weak = await page.$$eval('[data-testid="mockup-contrast"] li.bad, [data-testid="mockup-contrast"] li.meh', (l) => l.length);
  results.push(`   Mockup: ${rows.length} Druckfarben, ${weak} mit schwachem Kontrast`);
  await page.click('[data-testid="mockup-close"]');
});

// ---------------------------------------------------------------------------
// Meilenstein 4: iPad (Touch, Apple Pencil, Web-App, Sync)
// ---------------------------------------------------------------------------

/** Touch-Gesten über das Chrome-DevTools-Protokoll (echte Touch-Ereignisse). */
async function touch(session, type, pts) {
  await session.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i, radiusX: 8, radiusY: 8, force: 1 })) });
}
/** Stift (Apple Pencil) über das Protokoll: pointerType „pen“. */
async function pen(session, pts) {
  const ev = (type, [x, y], buttons) => session.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'pen', force: 0.5 });
  await ev('mouseMoved', pts[0], 0);
  await ev('mousePressed', pts[0], 1);
  for (const p of pts.slice(1)) await ev('mouseMoved', p, 1);
  await ev('mouseReleased', pts[pts.length - 1], 0);
}

await step('Web-App: Manifest, Service Worker und Start ohne Internet', async () => {
  const manifest = await page.$eval('link[rel="manifest"]', (l) => l.href);
  assert(manifest.endsWith('manifest.webmanifest'), 'Manifest fehlt');
  const m = await app(async (u) => (await fetch(u)).json(), manifest);
  assert(m.display === 'standalone' && m.icons.some((i) => i.sizes === '512x512'), 'Manifest unvollständig');
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready.then(() => true), { timeout: 15000 });
  await app(() => navigator.serviceWorker.ready);
  // Alle Dateien im Speicher, dann offline neu laden
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith('vektordesign-')), { timeout: 15000 });
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.vektordesign?.store.getState().solverReady, { timeout: 20000 });
  await page.setOfflineMode(false);
  results.push('   offline neu geladen: App und Solver bereit');
});

const ipadPage = await browser.newPage();
ipadPage.on('pageerror', (e) => errors.push(`pageerror (iPad): ${e.message}`));
await ipadPage.emulate({
  viewport: { width: 1180, height: 820, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true },
  userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
const ipadCdp = await ipadPage.createCDPSession();
await ipadCdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await ipadCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });
await ipadPage.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('vd.tutorials.off', '1');
  } catch {
    /* egal */
  }
  // Teilen-Menü gibt es im Test-Browser nicht → Download (wie „In Dateien sichern“);
  // Datei-Dialoge von Chrome gibt es in Safari nicht
  try {
    Object.defineProperty(navigator, 'share', { value: undefined });
    window.showSaveFilePicker = undefined;
    window.showOpenFilePicker = undefined;
  } catch {
    /* egal */
  }
});
await ipadPage.goto(url);
await ipadPage.waitForFunction(() => window.vektordesign?.store.getState().solverReady, { timeout: 20000 });
const ipad = (fn, ...a) => ipadPage.evaluate(fn, ...a);
async function ipadScreen(x, y) {
  return ipad(
    ([wx, wy]) => {
      const vp = window.vektordesign.canvas.vp();
      const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
      return [c.left + (wx - vp.cx) * vp.zoom + vp.width / 2, c.top + vp.height / 2 - (wy - vp.cy) * vp.zoom];
    },
    [x, y],
  );
}

await step('iPad: Touch-Gesten (Zwei-Finger-Zoom, Zwei-/Drei-Finger-Tipp, langes Drücken)', async () => {
  await ipad(() => {
    const a = window.vektordesign;
    a.editor.newDocument();
    a.editor.setView({ cx: 0, cy: 0, zoom: 4 });
    a.editor.createRectangle({ pos: { x: -20, y: -10 } }, { pos: { x: 20, y: 10 } }, 'corner');
  });
  const coarse = await ipad(() => matchMedia('(pointer: coarse)').matches);
  // Zwei-Finger-Zoom
  const z0 = await ipad(() => window.vektordesign.store.getState().view.zoom);
  await touch(ipadCdp, 'touchStart', [[500, 400], [600, 400]]);
  for (let i = 1; i <= 8; i++) await touch(ipadCdp, 'touchMove', [[500 - i * 12, 400], [600 + i * 12, 400]]);
  await touch(ipadCdp, 'touchEnd', []);
  const z1 = await ipad(() => window.vektordesign.store.getState().view.zoom);
  assert(z1 > z0 * 1.6, `Zoom ${z0} → ${z1}`);
  // Zwei-Finger-Tipp = Rückgängig, Drei-Finger-Tipp = Wiederholen
  const n0 = await ipad(() => Object.keys(window.vektordesign.store.getState().doc.entities).length);
  await touch(ipadCdp, 'touchStart', [[300, 300], [360, 300]]);
  await touch(ipadCdp, 'touchEnd', []);
  await sleep(150);
  const n1 = await ipad(() => Object.keys(window.vektordesign.store.getState().doc.entities).length);
  assert(n1 < n0, `Zwei-Finger-Tipp hat nicht rückgängig gemacht (${n0} → ${n1})`);
  await touch(ipadCdp, 'touchStart', [[300, 300], [360, 300], [420, 300]]);
  await touch(ipadCdp, 'touchEnd', []);
  await sleep(150);
  const n2 = await ipad(() => Object.keys(window.vektordesign.store.getState().doc.entities).length);
  assert(n2 === n0, `Drei-Finger-Tipp hat nicht wiederholt (${n2})`);
  // Langes Drücken = Kontextmenü
  await touch(ipadCdp, 'touchStart', [[300, 600]]);
  await sleep(700);
  await touch(ipadCdp, 'touchEnd', []);
  await ipadPage.waitForSelector('.marking', { timeout: 2000 });
  await ipadPage.screenshot({ path: join(OUT, '40-ipad-langdruck-menue.png') });
  await ipad(() => window.vektordesign.ui.setState({ marking: null }));
  results.push(`   iPad-Emulation: pointer coarse = ${coarse}`);
});

await step('iPad: Apple Pencil zeichnet freihand, Formerkennung macht daraus einen Kreis; Finger zeichnen danach nicht', async () => {
  await ipad(() => {
    const a = window.vektordesign;
    a.editor.newDocument();
    a.editor.setView({ cx: 0, cy: 0, zoom: 4 });
    a.setTool('sketch');
  });
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2.04;
    const r = 20 + Math.sin(t * 5) * 0.6;
    pts.push(await ipadScreen(r * Math.cos(t), r * Math.sin(t)));
  }
  await pen(ipadCdp, pts);
  await sleep(200);
  const circles = await ipad(() => Object.values(window.vektordesign.store.getState().doc.entities).filter((e) => e.kind === 'circle').map((e) => e.r));
  assert(circles.length === 1 && Math.abs(circles[0] - 20) < 1.5, `Kreise: ${JSON.stringify(circles)}`);
  await ipadPage.screenshot({ path: join(OUT, '41-ipad-pencil-kreis.png') });
  // Handballen: Finger-Strich verschiebt nur
  const before = await ipad(() => [Object.keys(window.vektordesign.store.getState().doc.entities).length, window.vektordesign.store.getState().view.cx]);
  await touch(ipadCdp, 'touchStart', [[300, 300]]);
  for (let i = 1; i <= 6; i++) await touch(ipadCdp, 'touchMove', [[300 + i * 20, 300 + i * 5]]);
  await touch(ipadCdp, 'touchEnd', []);
  const after = await ipad(() => [Object.keys(window.vektordesign.store.getState().doc.entities).length, window.vektordesign.store.getState().view.cx]);
  assert(after[0] === before[0] && after[1] !== before[1], `Finger hat gezeichnet oder nicht verschoben: ${before} → ${after}`);
});

await step('iPad: Bemaßung über eingeblendeten Ziffernblock', async () => {
  await ipad(() => {
    const a = window.vektordesign;
    a.editor.newDocument();
    a.editor.setView({ cx: 0, cy: 0, zoom: 4 });
    const r = a.editor.createCircle({ pos: { x: 0, y: 0 } }, 12);
    const out = a.editor.addDimension({ kind: 'diameter', refs: [r.circleId], angle: 0.6, offset: 4 });
    a.openDimEditorFor?.(out.dimId);
    if (!a.openDimEditorFor) a.store.setState({ dimPrompt: { dimId: out.dimId, isNew: true } });
  });
  await ipadPage.waitForSelector('[data-testid="keypad"]', { timeout: 3000 });
  await ipadPage.screenshot({ path: join(OUT, '42-ipad-ziffernblock.png') });
  // Feld leeren (alles markiert) und 30 + 5 eintippen
  const trace = [];
  for (const k of ['3', '0', '+', '5']) {
    await ipadPage.tap(`[data-testid="key-${k}"]`);
    trace.push(await ipad(() => document.querySelector('[data-testid="dim-input"]')?.value));
  }
  await ipadPage.tap('[data-testid="key-ok"]');
  await sleep(200);
  const d = await ipad(() => Object.values(window.vektordesign.store.getState().doc.dims)[0]);
  assert(d && Math.abs(d.value - 35) < 1e-9, `Bemaßung ${d?.expr} = ${d?.value} (Verlauf ${trace.join(' → ')})`);
});

await step('Abnahme M4: dasselbe Projekt auf dem iPad mit dem Pencil weiterbearbeiten, Änderungen erscheinen am PC', async () => {
  // PC: Logo-Projekt liegt in einem Cloud-Ordner (hier simuliert: geteilte Datei)
  await page.bringToFront();
  await app(async () => {
    const a = window.vektordesign;
    a.editor.newDocument();
    const r = a.editor.createRectangle({ pos: { x: 0, y: 0 } }, { pos: { x: 40, y: 20 } }, 'center', { width: '80', height: '40' });
    a.editor.setStyle([r.pathId], { fill: '#f5c518' });
    window.__cloud = { text: '', mtime: 1 };
    const link = {
      kind: 'memory',
      name: 'Logo.vdp',
      stat: async () => (window.__cloud.text ? { mtime: window.__cloud.mtime, size: window.__cloud.text.length } : null),
      read: async () => window.__cloud.text,
      write: async (t) => {
        window.__cloud = { text: t, mtime: window.__cloud.mtime + 1 };
      },
    };
    a.sync.attach(link, null, 0);
    a.store.setState({ fileName: 'Logo.vdp' });
    await a.saveDocument();
  });
  const pcFile = await app(() => window.__cloud.text);
  const meta = JSON.parse(pcFile);
  assert(meta.revision === 1 && meta.savedBy, `PC-Datei: Revision ${meta.revision}`);
  const pcBadge = await page.$eval('[data-testid="sync-badge"]', (e) => e.textContent);
  assert(pcBadge.includes('Logo.vdp'), 'Sync-Anzeige fehlt');

  // iPad: Datei aus „Dateien“ (iCloud Drive) öffnen, mit dem Pencil einen Kreis ergänzen, speichern
  await ipadPage.bringToFront();
  await ipad((text) => window.vektordesign.openDocumentNow({ name: 'Logo.vdp', text }), pcFile);
  await ipad(() => {
    window.vektordesign.editor.setView({ cx: 0, cy: 0, zoom: 4 });
    window.vektordesign.setTool('sketch');
  });
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2.04;
    pts.push(await ipadScreen(8 * Math.cos(t), 8 * Math.sin(t)));
  }
  await pen(ipadCdp, pts);
  await sleep(200);
  for (const f of readdirSync(DL)) rmSync(join(DL, f), { force: true });
  await ipad(() => window.vektordesign.saveDocument());
  const saved = await waitDownload('vdp', []);
  await sleep(150);
  const ipadText = readFileSync(saved, 'utf8');
  const im = JSON.parse(ipadText);
  assert(im.revision === 2 && im.savedBy === 'iPad' && im.projectId === meta.projectId, `iPad-Datei: Revision ${im.revision}, ${im.savedBy}`);
  await ipadPage.screenshot({ path: join(OUT, '43-ipad-weiterbearbeitet.png') });

  // Cloud-Ordner gleicht ab → PC übernimmt automatisch (Beobachtung alle 3 s)
  await page.bringToFront();
  await app((t) => {
    window.__cloud = { text: t, mtime: window.__cloud.mtime + 1 };
  }, ipadText);
  await page.waitForFunction(() => Object.values(window.vektordesign.store.getState().doc.entities).some((e) => e.kind === 'circle'), { timeout: 8000 });
  const toast = await app(() => window.vektordesign.store.getState().toasts.map((t) => t.text).join(' | '));
  assert(toast.includes('iPad'), `Kein Hinweis auf iPad: ${toast}`);
  await page.keyboard.press('f');
  await sleep(200);
  await shot('44-pc-uebernimmt-ipad');

  // Konflikt: PC ändert, iPad speichert gleichzeitig → Rückfrage
  await app(() => {
    const a = window.vektordesign;
    a.editor.createCircle({ pos: { x: 30, y: 0 } }, 3);
    const cur = JSON.parse(window.__cloud.text);
    window.__cloud = { text: JSON.stringify({ ...cur, revision: cur.revision + 1, savedBy: 'iPad', name: 'iPad-Fassung' }), mtime: window.__cloud.mtime + 1 };
  });
  await page.waitForSelector('[data-testid="sync-conflict"]', { timeout: 8000 });
  await shot('45-sync-konflikt');
  await page.click('[data-testid="conflict-mine"]');
  await sleep(100);
  const st = await app(() => window.vektordesign.store.getState().dirty);
  assert(st === true, 'eigene Änderungen verloren');
  await app(() => window.vektordesign.saveDocument());
  const finalMeta = await app(() => JSON.parse(window.__cloud.text));
  assert(finalMeta.revision === 4 && finalMeta.savedBy !== 'iPad', `nach Überschreiben: Revision ${finalMeta.revision} von ${finalMeta.savedBy}`);
  await app(() => {
    window.vektordesign.sync.detach();
    window.vektordesign.ui.setState({ syncLinked: null });
  });
});
await ipadPage.close();
// Download-Ziel gilt browserweit und geht mit der Sitzung der iPad-Seite verloren
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

await step('Bild als Vorlage: einfügen, auf Maß bringen, fixieren, nachzeichnen – Export ohne Bild', async () => {
  await page.bringToFront();
  await newDoc();
  await app(() => window.vektordesign.editor.setView({ cx: 0, cy: 0, zoom: 4 }));
  // Testbild: dunkler Kreis auf hellem Grund (400 × 200 px)
  const ok = await app(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 400, 200);
    x.fillStyle = '#1f3a93';
    x.beginPath();
    x.arc(100, 100, 80, 0, Math.PI * 2);
    x.fill();
    x.fillRect(220, 40, 160, 120);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    return window.vektordesign.insertImage({ name: 'skizze.png', data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }, { x: 0, y: 0 });
  });
  assert(ok, 'Bild nicht eingefügt');
  await page.waitForSelector('[data-testid="image-props"]');
  const img = await app(() => Object.values(window.vektordesign.store.getState().doc.entities).find((e) => e.kind === 'image'));
  assert(img.reference && img.style.opacity === 0.5, 'Bild ist keine halbtransparente Vorlage');
  // Breite 100 mm über das Eigenschaftenfeld
  await page.$eval('[data-testid="image-width"]', (el) => {
    el.focus();
    el.select();
  });
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await sleep(150);
  let im = await app((id) => window.vektordesign.store.getState().doc.entities[id], img.id);
  assert(Math.abs(im.width - 100) < 1e-9 && Math.abs(im.height - 50) < 1e-9, `Bildgröße ${im.width} × ${im.height}`);
  // Maßstab über bekannte Strecke: Kreis im Bild (160 px = 40 mm) soll 50 mm sein
  await page.click('[data-testid="image-calibrate"]');
  await clickWorld(-45, 0);
  await clickWorld(-5, 0);
  await page.waitForSelector('[data-testid="param-dialog"]');
  await page.$eval('[data-testid="param-len"]', (el) => {
    el.focus();
    el.select();
  });
  await page.keyboard.type('50');
  await page.keyboard.press('Enter');
  await sleep(200);
  im = await app((id) => window.vektordesign.store.getState().doc.entities[id], img.id);
  assert(Math.abs(im.width - 125) < 1e-6, `nach Kalibrierung ${im.width} mm statt 125`);
  // Fixieren: Ebene „Vorlage“ gesperrt
  await app((id) => window.vektordesign.editor.select([id]), img.id);
  await sleep(100);
  await page.click('[data-testid="image-lock"]');
  const locked = await app(() => window.vektordesign.store.getState().doc.layers.find((l) => l.name === 'Vorlage').locked);
  assert(locked, 'Ebene nicht gesperrt');
  // Nachzeichnen: Kreis über das Bild (Mitte des Bildkreises)
  const c = await app((id) => {
    const d = window.vektordesign.store.getState().doc;
    const e = d.entities[id];
    const a = d.points[e.anchor];
    return { x: a.x - e.width / 2 + (e.width * 100) / 400, y: a.y + e.height / 2 - (e.height * 100) / 200 };
  }, img.id);
  await page.keyboard.press('Escape');
  await page.keyboard.press('c');
  await clickWorld(c.x, c.y);
  await moveWorld(c.x + 20, c.y);
  await page.keyboard.type('50');
  await page.keyboard.press('Enter');
  await sleep(150);
  await page.keyboard.press('Escape');
  await page.keyboard.press('f');
  await sleep(200);
  await shot('50-vorlage-nachgezeichnet');
  // Export: nur der nachgezeichnete Kreis (50 mm), kein Bild
  const svgFile = await exportVia('svg', 'svg');
  const svg = readFileSync(svgFile, 'utf8');
  assert(!svg.includes('<image') && /width="50mm" height="50mm"/.test(svg), `Export enthält Vorlage oder falsche Größe: ${svg.match(/width="[^"]+" height="[^"]+"/)?.[0]}`);
});

await step('Bild vektorisieren: Logo-Bild wird zu Formen je Farbe in Originalgröße', async () => {
  await newDoc();
  await app(() => window.vektordesign.editor.setView({ cx: 0, cy: 0, zoom: 3 }));
  await app(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 400, 200);
    x.fillStyle = '#1f3a93';
    x.beginPath();
    x.arc(100, 100, 80, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#c8102e';
    x.fillRect(220, 40, 160, 120);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    await window.vektordesign.insertImage({ name: 'logo.png', data: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }, { x: 0, y: 0 });
    const img = Object.values(window.vektordesign.store.getState().doc.entities).find((e) => e.kind === 'image');
    window.vektordesign.editor.updateImage(img.id, { width: 100 });
    window.vektordesign.editor.select([img.id]);
  });
  await page.waitForSelector('[data-testid="image-vectorize"]');
  await page.click('[data-testid="image-vectorize"]');
  await page.waitForSelector('[data-testid="param-dialog"]');
  await page.$eval('[data-testid="param-colors"]', (el) => {
    el.focus();
    el.select();
  });
  await page.keyboard.type('3');
  await page.click('[data-testid="param-ok"]');
  await page.waitForFunction(() => Object.values(window.vektordesign.store.getState().doc.entities).filter((e) => e.kind === 'shape').length >= 2, { timeout: 15000 });
  const shapes = await app(() => Object.values(window.vektordesign.store.getState().doc.entities).filter((e) => e.kind === 'shape').map((e) => e.style.fill));
  assert(shapes.length === 2, `Formen: ${shapes}`);
  const dbg = await app(() => {
    const d = window.vektordesign.store.getState().doc;
    return JSON.stringify({ layers: d.layers, shapes: Object.values(d.entities).filter((e) => e.kind === 'shape').map((e) => ({ l: e.layer, n: e.contours.length, nodes: e.contours[0]?.nodes.length, a: d.points[e.anchor] })) });
  });
  const b = await app(() => window.vektordesign.bbox());
  assert(b, `kein Rahmen: ${dbg}`);
  assert(Math.abs(b.maxX - b.minX - 90) < 2, `Breite der Formen ${b.maxX - b.minX} statt ≈ 90 mm`);
  await page.keyboard.press('f');
  await sleep(200);
  await shot('51-vektorisiert');
});

await step('Preflight: feine Linie für Stick und Plotter markiert, Logo für DTF in Ordnung', async () => {
  await newDoc();
  await app(() => {
    const a = window.vektordesign;
    a.editor.setView({ cx: 0, cy: 0, zoom: 4 });
    const r = a.editor.createRectangle({ pos: { x: -30, y: -10 } }, { pos: { x: 30, y: 10 } }, 'corner');
    a.editor.setStyle([r.pathId], { fill: '#1f3a93', stroke: null });
    // schmaler Steg 0,4 mm
    const s = a.editor.createRectangle({ pos: { x: 30, y: -0.2 } }, { pos: { x: 45, y: 0.2 } }, 'corner');
    a.editor.setStyle([s.pathId], { fill: '#1f3a93', stroke: null });
  });
  await page.click('[data-testid="ribbon-edit"]');
  await page.click('[data-testid="preflight-open"]');
  await page.waitForSelector('[data-testid="preflight"]');
  await page.select('[data-testid="preflight-target"]', 'embroidery');
  await page.waitForFunction(() => window.vektordesign.ui.getState().preflight?.result?.target === 'embroidery' && !window.vektordesign.ui.getState().preflight.busy);
  const txt = await page.$eval('[data-testid="preflight"]', (e) => e.textContent);
  assert(/Details schmaler als 1 mm/.test(txt), `Stick-Prüfung: ${txt}`);
  await shot('60-preflight-stick');
  await page.select('[data-testid="preflight-target"]', 'dtg');
  await page.waitForFunction(() => window.vektordesign.ui.getState().preflight?.result?.target === 'dtg' && !window.vektordesign.ui.getState().preflight.busy);
  const ok = await app(() => window.vektordesign.ui.getState().preflight.result.issues.filter((i) => !/^Kontrast/.test(i.message)).map((i) => i.severity));
  assert(!ok.includes('error') && !ok.includes('warn'), `DTG sollte passen: ${ok}`);
  await app(() => window.vektordesign.closePreflight());
  await page.click('[data-testid="ribbon-sketch"]');
});

await step('Claude ohne API-Schlüssel: Auftrag kopieren, Antwort aus claude.ai einfügen und ausführen', async () => {
  await newDoc();
  await page.click('[data-testid="tab-claude"]');
  await page.waitForSelector('[data-testid="claude-mode-abo"]');
  await page.click('[data-testid="claude-mode-abo"]');
  await page.type('#claude-eingabe', 'Rechteck 80 × 40 mit Kreis Ø10 in der Mitte');
  await page.click('[data-testid="bridge-copy"]');
  await page.waitForSelector('.bridge-prompt');
  const prompt = await page.$eval('.bridge-prompt textarea', (e) => e.value);
  assert(prompt.includes('```vektordesign') && prompt.includes('Rechteck 80 × 40'), 'Auftrag unvollständig');
  const reply = 'Fertig:\n```vektordesign\n[{"tool":"draw_rectangle","input":{"x":0,"y":0,"width":80,"height":40,"anchor":"center","fill":"#1f3a93"}},{"tool":"draw_circle","input":{"cx":3,"cy":2,"diameter":10,"fill":"#f5c518"}},{"tool":"add_constraint","input":{"type":"concentric","targets":["$2","$1.center"]}}]\n```';
  await page.$eval('[data-testid="bridge-reply"]', (el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, reply);
  await page.click('[data-testid="bridge-run"]');
  await sleep(300);
  const st = await statusText();
  const n = await app(() => Object.values(window.vektordesign.store.getState().doc.entities).filter((e) => e.kind === 'circle' || e.kind === 'path').length);
  assert(n === 2 && st === 'Vollständig bestimmt', `${n} Objekte, Status ${st}`);
  await shot('70-claude-abo');
  await page.click('[data-testid="tab-props"]');
});

await step('Leistung: 150 Rechtecke mit Bemaßungen, Ziehen bleibt flüssig', async () => {
  await newDoc();
  const t = await app(() => {
    const a = window.vektordesign;
    const t0 = performance.now();
    a.editor.transaction('Viele', () => {
      for (let i = 0; i < 150; i++) {
        const x = (i % 15) * 30;
        const y = Math.floor(i / 15) * 30;
        a.editor.createRectangle({ pos: { x, y } }, { pos: { x: x + 20, y: y + 12 } }, 'corner', { width: '20', height: '12' });
      }
    });
    const build = performance.now() - t0;
    const d = a.store.getState().doc;
    const p = Object.values(d.entities).find((e) => e.kind === 'line');
    a.editor.beginDrag();
    const t1 = performance.now();
    for (let k = 0; k < 20; k++) a.editor.dragTo({ kind: 'points', targets: [{ id: p.p1, x: d.points[p.p1].x + k * 0.2, y: d.points[p.p1].y + k * 0.3 }] });
    const drag = (performance.now() - t1) / 20;
    a.editor.endDrag();
    return { build, drag, dof: a.store.getState().analysis.dof };
  });
  results.push(`   150 Rechtecke: Aufbau ${t.build.toFixed(0)} ms, Ziehen ${t.drag.toFixed(1)} ms/Bild, Freiheitsgrade ${t.dof}`);
  assert(t.drag < 33, `Ziehen zu langsam: ${t.drag.toFixed(1)} ms pro Bild`);
  await page.keyboard.press('f');
  await sleep(100);
  const fps = await app(async () => {
    const t0 = performance.now();
    let n = 0;
    await new Promise((res) => {
      const loop = () => {
        window.vektordesign.editor.setView({ zoom: window.vektordesign.store.getState().view.zoom * 1.003 });
        n++;
        if (performance.now() - t0 < 1000) requestAnimationFrame(loop);
        else res();
      };
      requestAnimationFrame(loop);
    });
    return n;
  });
  results.push(`   Zoom-Neuzeichnen mit 600 Linien: ${fps} Bilder/s`);
  await shot('14-leistung');
});

await browser.close();
// Ganze Prozessgruppe beenden (npx startet vite als Kindprozess)
if (server) {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    server.kill();
  }
}

console.log(results.join('\n'));
if (errors.length) {
  console.log('\nBrowser-Fehler:');
  for (const e of errors) console.log(`  ${e}`);
}
console.log(`\n${results.filter((r) => r.startsWith('✓')).length} bestanden, ${failed} fehlgeschlagen. Screenshots: ${OUT}`);
process.exit(failed || errors.some((e) => e.startsWith('pageerror')) ? 1 : 0);
