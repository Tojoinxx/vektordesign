/**
 * Leistungsmessung im echten Browser: Startzeit, Zeichenzeit pro Bild, Mausbewegung, Ziehen,
 * Zoom und wie viele React-Komponenten dabei neu rendern.
 *
 * Aufruf:  npm run build && CHROME_PATH=/pfad/zu/chrome node scripts/perf.mjs
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = resolve(import.meta.dirname, '..');
const chromePath = process.env.CHROME_PATH;
if (!chromePath) {
  console.error('CHROME_PATH fehlt.');
  process.exit(2);
}
const server = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('4174') && res()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: chromePath, args: (process.env.CHROME_ARGS ?? '--no-sandbox').split(' '), headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.evaluateOnNewDocument(() => {
  // Zählt gerenderte Komponenten je Commit (Hook wie die React-Entwicklerwerkzeuge)
  const stats = { commits: 0, fibers: 0, names: {}, roots: {} };
  const ids = new WeakMap();
  const seen = new WeakMap();
  window.__perf = stats;
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true,
    renderers: new Map(),
    inject() {
      return 1;
    },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    onCommitFiberRoot(_id, root) {
      stats.commits++;
      const walk = (f, parentRendered) => {
        while (f) {
          let rendered = false;
          if (typeof f.type === 'function') {
            const alt = f.alternate;
            let id = ids.get(f) || (alt && ids.get(alt));
            if (!id) id = {};
            ids.set(f, id);
            if (alt) ids.set(alt, id);
            const last = seen.get(id);
            rendered = !last || last.p !== f.memoizedProps || last.s !== f.memoizedState;
            seen.set(id, { p: f.memoizedProps, s: f.memoizedState });
            if (rendered && last) {
              stats.fibers++;
              const n = f.type.displayName || f.type.name || '?';
              stats.names[n] = (stats.names[n] || 0) + 1;
              if (!parentRendered) stats.roots[n] = (stats.roots[n] || 0) + 1;
            }
          }
          if (f.child) walk(f.child, rendered || (parentRendered && typeof f.type !== 'function'));
          f = f.sibling;
        }
      };
      walk(root.current.child, false);
    },
  };
  window.__long = [];
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ type: 'longtask', buffered: true });
});
const resetStats = () =>
  page.evaluate(() => {
    window.__perf.commits = 0;
    window.__perf.fibers = 0;
    window.__perf.names = {};
    window.__perf.roots = {};
    window.__long = [];
  });
const readStats = () =>
  page.evaluate(() => ({
    commits: window.__perf.commits,
    fibers: window.__perf.fibers,
    top: Object.entries(window.__perf.names)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([k, v]) => `${k}×${v}`)
      .join(' '),
    roots: Object.entries(window.__perf.roots)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([k, v]) => `${k}×${v}`)
      .join(' '),
    long: window.__long.length,
    longMax: Math.round(Math.max(0, ...window.__long)),
  }));

const t0 = Date.now();
await page.goto('http://localhost:4174/', { waitUntil: 'load' });
await page.waitForFunction(() => window.vektordesign?.canvas, { timeout: 30000 });
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0];
  const js = performance
    .getEntriesByType('resource')
    .filter((r) => r.name.endsWith('.js'))
    .reduce((a, r) => a + r.decodedBodySize, 0);
  return { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: Math.round(fcp?.startTime ?? 0), jsKB: Math.round(js / 1024) };
});
console.log(`Start: FCP ${nav.fcp} ms, DOMContentLoaded ${nav.dcl} ms, bereit nach ${Date.now() - t0} ms, JS geladen ${nav.jsKB} KB`);
// Tutorial/Willkommen schließen
await page.keyboard.press('Escape');
await sleep(300);

async function profile(label, fn) {
  if (!process.env.PROFILE) return;
  const cdp = await page.createCDPSession();
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  await cdp.send('Profiler.start');
  await fn();
  const { profile: prof } = await cdp.send('Profiler.stop');
  const self = new Map();
  const dt = prof.timeDeltas;
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const cnt = new Map();
  prof.samples.forEach((id, i) => cnt.set(id, (cnt.get(id) ?? 0) + (dt[i] ?? 0)));
  for (const [id, t] of cnt) {
    const n = byId.get(id);
    const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
    self.set(k, (self.get(k) ?? 0) + t);
  }
  const tot = [...self.values()].reduce((a, b) => a + b, 0);
  console.log(`  Profil ${label} (${(tot / 1000).toFixed(0)} ms):`);
  [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 18)
    .forEach(([k, t]) => console.log(`    ${((100 * t) / tot).toFixed(1).padStart(5)} %  ${k}`));
}

async function measureDraw(label) {
  await profile(label, () =>
    page.evaluate(() => {
      for (let i = 0; i < 15; i++) {
        window.vektordesign.canvas.invalidate();
        window.__vdRenderNow();
      }
    }),
  );
  const r = await page.evaluate(() => {
    const ts = [];
    for (let i = 0; i < 15; i++) {
      const t = performance.now();
      window.vektordesign.canvas.invalidate();
      window.__vdRenderNow();
      ts.push(performance.now() - t);
    }
    ts.sort((a, b) => a - b);
    return { med: ts[7], max: ts[14] };
  });
  console.log(`  ${label}: Bild zeichnen Median ${r.med.toFixed(1)} ms, max ${r.max.toFixed(1)} ms`);
}

async function scenario(name, build) {
  console.log(`\n== ${name}`);
  await build();
  await page.keyboard.press('f');
  await sleep(400);
  await measureDraw('Ruhe');
  await page.evaluate(() => window.vektordesign.editor.select(Object.keys(window.vektordesign.store.getState().doc.entities).slice(0, 40)));
  await sleep(100);
  await measureDraw('40 ausgewählt');
  await page.evaluate(() => window.vektordesign.editor.select([]));

  // Mausbewegung über der Zeichenfläche
  const c = await page.$eval('[data-testid="canvas"]', (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  await profile('Maus', async () => {
    for (let i = 0; i < 60; i++) await page.mouse.move(c.x + 100 + i * 12, c.y + 210 + (i % 10) * 20);
  });
  await page.keyboard.press('l');
  await profile('Maus mit Linienwerkzeug', async () => {
    for (let i = 0; i < 60; i++) await page.mouse.move(c.x + 100 + i * 12, c.y + 210 + (i % 10) * 20);
  });
  await page.keyboard.press('Escape');
  await resetStats();
  let t0 = Date.now();
  for (let i = 0; i < 60; i++) await page.mouse.move(c.x + 100 + i * 12, c.y + 200 + (i % 10) * 20);
  await sleep(50);
  let st0 = await readStats();
  console.log(
    `  Maus 60 Bewegungen: ${((Date.now() - t0) / 60).toFixed(1)} ms/Ereignis, ${st0.commits} React-Commits, ${st0.fibers} Komponenten (${st0.top}) [Auslöser: ${st0.roots}], lange Aufgaben ${st0.long} (max ${st0.longMax} ms)`,
  );

  // Zoomen: so schnell wie möglich neu zeichnen (Bilder pro Sekunde)
  const zoomFps = () =>
    page.evaluate(async () => {
      const a = window.vektordesign;
      const z0 = a.store.getState().view.zoom;
      const t0 = performance.now();
      let n = 0;
      await new Promise((res) => {
        const loop = () => {
          a.editor.setView({ zoom: z0 * (1 + 0.3 * Math.sin(n / 10)) });
          n++;
          if (performance.now() - t0 < 1500) requestAnimationFrame(loop);
          else res();
        };
        requestAnimationFrame(loop);
      });
      a.editor.setView({ zoom: z0 });
      return Math.round(n / 1.5);
    });
  let fps = 0;
  await profile('Zoomen', async () => {
    fps = await zoomFps();
  });
  if (!process.env.PROFILE) fps = await zoomFps();
  console.log(`  Zoomen: ${fps} Bilder/s`);

  let st;
  let t;
  // Geometrie ziehen über die Editor-Schnittstelle (Solver + Neuzeichnen + React)
  await resetStats();
  let dragMs = 0;
  await profile('Geometrie ziehen', async () => {
    dragMs = await page.evaluate(async () => {
      const a = window.vektordesign;
      const d = a.store.getState().doc;
      const p = Object.values(d.entities).find((e) => e.kind === 'line');
      if (!p) return 0;
      a.editor.beginDrag();
      const t0 = performance.now();
      for (let k = 0; k < 30; k++) {
        a.editor.dragTo({ kind: 'points', targets: [{ id: p.p1, x: d.points[p.p1].x + k * 0.2, y: d.points[p.p1].y + k * 0.3 }] });
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
      const ms = (performance.now() - t0) / 30;
      a.editor.endDrag();
      return ms;
    });
  });
  st = await readStats();
  console.log(`  Geometrie ziehen: ${dragMs.toFixed(1)} ms/Bild, ${st.commits} Commits, ${st.fibers} Komponenten (${st.top}) [Auslöser: ${st.roots}]`);
  // Ziehen eines Objekts mit dem Auswahlwerkzeug
  const tgt = await page.evaluate(() => {
    const a = window.vektordesign;
    const d = a.store.getState().doc;
    const e = Object.values(d.entities).find((x) => x.kind === 'line' || x.kind === 'circle');
    if (!e) return null;
    const p = d.points[e.kind === 'line' ? e.p1 : e.center];
    const vp = a.canvas.vp();
    const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    return { x: r.left + (p.x - vp.cx) * vp.zoom + vp.width / 2, y: r.top + vp.height / 2 - (p.y - vp.cy) * vp.zoom };
  });
  if (tgt) {
    await page.keyboard.press('Escape');
    await page.mouse.move(tgt.x, tgt.y);
    await resetStats();
    t = Date.now();
    await page.mouse.down();
    await profile('Ziehen', async () => {
      for (let i = 0; i < 30; i++) {
        await page.mouse.move(tgt.x + i * 3, tgt.y + i * 2);
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      }
    });
    await page.mouse.up();
    st = await readStats();
    console.log(
      `  Ziehen 30 Schritte: ${((Date.now() - t) / 30).toFixed(1)} ms/Schritt, ${st.commits} Commits, ${st.fibers} Komponenten (${st.top}) [Auslöser: ${st.roots}], lange Aufgaben ${st.long} (max ${st.longMax} ms)`,
    );
  }
}

await scenario('300 Rechtecke mit Bemaßungen + 40 Texte + 60 Kreise', () =>
  page.evaluate(() => {
    const a = window.vektordesign;
    a.editor.newDocument();
    a.editor.transaction('Viele', () => {
      for (let i = 0; i < 300; i++) {
        const x = (i % 20) * 30;
        const y = Math.floor(i / 20) * 30;
        a.editor.createRectangle({ pos: { x, y } }, { pos: { x: x + 20, y: y + 12 } }, 'corner', { width: '20', height: '12' });
      }
      for (let i = 0; i < 60; i++) a.editor.createCircle({ pos: { x: (i % 20) * 30 + 10, y: -40 - Math.floor(i / 20) * 30 } }, 8);
      for (let i = 0; i < 40; i++) a.editor.createText({ pos: { x: (i % 10) * 60, y: 480 + Math.floor(i / 10) * 20 } }, `Text ${i}`);
    });
  }),
);

await scenario('Schnitt Hoodie', async () => {
  await page.evaluate(() => window.vektordesign.store.setState({ dirty: false }));
  await page.keyboard.down('Control');
  await page.keyboard.press('n');
  await page.keyboard.up('Control');
  await page.waitForSelector('[data-testid="new-pattern"]');
  await page.click('[data-testid="new-pattern"]');
  await page.waitForSelector('[data-testid="block-kind"]');
  await page.select('[data-testid="block-kind"]', 'hoodie');
  await page.click('[data-testid="block-generate"]');
  await sleep(500);
});

await resetStats();
console.log('\nFehler:', errs.length ? errs : 'keine');
await browser.close();
process.kill(-server.pid);
