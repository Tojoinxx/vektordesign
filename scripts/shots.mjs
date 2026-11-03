/**
 * Screenshots der wichtigsten Ansichten für die Durchsicht der Oberfläche.
 * Aufruf: npm run build && CHROME_PATH=… node scripts/shots.mjs [Ausgabeordner]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'tests/e2e/output/shots'));
mkdirSync(OUT, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('4176') && res()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'], headless: true });
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

async function session(name, { width = 1440, height = 900, theme = 'light', scale = 1, touch = false } = {}, fn) {
  if (only && !only.test(name)) return;
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: scale, hasTouch: touch, isMobile: touch });
  await page.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem('vd.appearance', JSON.stringify({ theme: t }));
      localStorage.setItem('vd.tutorials.off', '1');
    } catch {
      /* egal */
    }
  }, theme);
  await page.goto('http://localhost:4176/');
  await page.waitForFunction(() => window.vektordesign?.canvas);
  await sleep(700);
  await page.keyboard.press('Escape');
  const shot = async (n) => {
    await sleep(250);
    await page.screenshot({ path: join(OUT, `${name}-${n}.png`) });
  };
  try {
    await fn(page, shot);
  } catch (e) {
    console.error(name, e.message);
  }
  await context.close();
}

const demo = () => {
  const a = window.vektordesign;
  const ed = a.editor;
  const r = ed.createRectangle({ pos: { x: -40, y: -20 } }, { pos: { x: 40, y: 20 } }, 'corner', { width: '80', height: '40' });
  ed.createCircle({ pos: { x: 0, y: 0 } }, 5);
  ed.createText({ pos: { x: -30, y: 30 } }, 'Vektordesign');
  ed.zoomToFit();
  return r;
};

for (const theme of ['light', 'dark']) {
  await session(`main-${theme}`, { theme }, async (page, shot) => {
    await shot('leer');
    await page.evaluate(demo);
    await shot('zeichnung');
    await page.evaluate(() => {
      const a = window.vektordesign;
      a.editor.select([Object.values(a.store.getState().doc.entities).find((e) => e.kind === 'path').id]);
    });
    await shot('auswahl');
    for (const tab of ['layers', 'production', 'pattern', 'library', 'claude']) {
      await page.click(`[data-testid="tab-${tab}"]`);
      await shot(`seite-${tab}`);
    }
    await page.click('[data-testid="tab-props"]');
    const tabs = await page.$$('.ribbon-tabs button, [role="tablist"].ribbon-tabs [role="tab"]');
    if (tabs[1]) {
      await tabs[1].click();
      await shot('band-bearbeiten');
    }
    await page.evaluate(() => window.vektordesign.openExport('svg'));
    await shot('export');
    await page.keyboard.press('Escape');
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await shot('befehle');
    await page.keyboard.press('Escape');
    await page.click('[data-testid="file-menu"]').catch(() => {});
    await shot('datei');
  });
}
await session('dialoge', {}, async (page, shot) => {
  await page.evaluate(demo);
  for (const [flag, value] of [
    ['mockup', true],
    ['generator', true],
    ['costs', true],
    ['gangSheet', true],
    ['screenPrint', true],
    ['techPack', true],
    ['placement', 'm1'],
  ]) {
    await page.evaluate(([f, v]) => window.vektordesign.ui.setState({ [f]: v }), [flag, value]);
    await sleep(900);
    await shot(flag);
    await page.evaluate((f) => window.vektordesign.ui.setState({ [f]: f === 'placement' ? null : false }), flag);
  }
});
await session('ipad', { width: 1180, height: 820, scale: 1, touch: true }, async (page, shot) => {
  await page.evaluate(demo);
  await shot('zeichnung');
});
await session('klein', { width: 1024, height: 700 }, async (page, shot) => {
  await page.evaluate(demo);
  await shot('zeichnung');
});

await browser.close();
process.kill(-server.pid);
console.log('Screenshots in', OUT);
