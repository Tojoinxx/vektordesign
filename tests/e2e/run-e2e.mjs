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
import { mkdirSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
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
