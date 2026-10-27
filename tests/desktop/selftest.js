/**
 * Selbsttest der Desktop-App im echten Fenster (WebView2 unter Windows, WebKitGTK unter Linux).
 *
 * run-desktop-test.mjs ersetzt __OUT__ und __DIR__ und übergibt die Datei über die
 * Umgebungsvariable VEKTORDESIGN_SELFTEST. Die App bindet sie nur in Debug-Builds oder mit dem
 * Cargo-Feature „selftest“ ein. Geprüft wird, was nur im Desktop-Fenster vorkommt: Solver
 * (WebAssembly) unter der strengen CSP, Export und Speichern über die Rust-Befehle (Binärdaten,
 * Umlaute im Pfad), Fehlermeldungen und die Liste der installierten Schriftarten.
 */
(() => {
  if (window.top !== window.self) return;
  const OUT = __OUT__;
  const DIR = __DIR__;
  const SEP = DIR.includes('\\') ? '\\' : '/';
  const join = (name) => DIR + SEP + name;

  const problems = [];
  window.addEventListener('securitypolicyviolation', (e) => problems.push(`CSP blockiert: ${e.violatedDirective} ${e.blockedURI}`));
  window.addEventListener('error', (e) => problems.push(`Fehler: ${e.message} (${e.filename}:${e.lineno})`));
  window.addEventListener('unhandledrejection', (e) => problems.push(`Promise abgelehnt: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));
  const origError = console.error.bind(console);
  console.error = (...a) => {
    problems.push(`console.error: ${a.map(String).join(' ')}`);
    origError(...a);
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const start = () => run().catch((e) => origError(e));
  if (document.readyState === 'complete') setTimeout(start, 0);
  else window.addEventListener('load', start, { once: true });

  async function run() {
    const t0 = performance.now();
    const checks = [];
    const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
    const invoke = (cmd, args, opts) => window.__TAURI_INTERNALS__.invoke(cmd, args, opts);
    const write = (path, bytes) => invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
    const read = async (path) => new Uint8Array(await invoke('read_file', { path }));
    const text = (bytes) => new TextDecoder().decode(bytes);
    let app = null;
    const lastToast = () => {
      const t = app ? app.store.getState().toasts : [];
      return t.length ? JSON.stringify(t[t.length - 1]) : '';
    };

    try {
      for (let i = 0; i < 300 && !(window.vektordesign && window.vektordesign.store.getState().solverReady); i++) await sleep(100);
      app = window.vektordesign;
      check('Oberfläche geladen, Solver (WebAssembly) bereit', app && app.store.getState().solverReady);

      // Abnahme Meilenstein 1 über dieselben Befehle wie die Werkzeuge
      const ed = app.editor;
      ed.newDocument();
      const r = ed.createRectangle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: 'O' } }, { pos: { x: 31, y: 17 } }, 'center', { width: '80', height: '40' });
      const c = ed.createCircle({ pos: { x: 0, y: 0 }, snap: { kind: 'point', id: r.centerId } }, 6, { diameter: '10' });
      const an = app.store.getState().analysis;
      check('Abnahme M1: Rechteck 80 × 40, Kreis Ø10, vollständig bestimmt', r.ok && c.ok && an.status === 'full', an.label);

      // SVG-Export über den echten Speicherweg (Pfad statt Dialog), Umlaute im Dateinamen
      const svgPath = join('Abnahme M1 äöü ß.svg');
      check('SVG-Export gespeichert', await app.exportFile({ format: 'svg', dpi: 300, bounds: 'geometry', mirror: false }, svgPath), lastToast());
      const svg = text(await read(svgPath));
      check('SVG hat exakt 80 × 40 mm', svg.includes('width="80mm" height="40mm" viewBox="0 0 80 40"'), svg.slice(0, 160));
      check('SVG: Rechteck und Kreis Ø10 mittig', svg.includes('d="M0 40 L80 40 L80 0 L0 0 Z"') && /cx="40" cy="20" r="5"/.test(svg));

      // PNG-Export: Größe und Auflösung aus den Bytes
      const pngPath = join('Abnahme M1.png');
      check('PNG-Export gespeichert', await app.exportFile({ format: 'png', dpi: 300, bounds: 'geometry', mirror: false }, pngPath), lastToast());
      const png = await read(pngPath);
      const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
      const w = dv.getUint32(16);
      const h = dv.getUint32(20);
      check('PNG: 945 × 473 px', w === 945 && h === 473, `${w} × ${h}`);
      let ppm = 0;
      for (let i = 8; i + 12 <= png.length; ) {
        const len = dv.getUint32(i);
        if (text(png.subarray(i + 4, i + 8)) === 'pHYs') {
          ppm = dv.getUint32(i + 8);
          break;
        }
        i += 12 + len;
      }
      check('PNG: 300 dpi', Math.round(ppm * 0.0254) === 300, `${ppm} Pixel/m`);

      // Projektdatei speichern: bekannter Pfad → kein Dialog
      const projPath = join('Projekt Test.vdp');
      app.store.setState({ filePath: projPath });
      await app.saveDocument();
      const proj = JSON.parse(text(await read(projPath)));
      const nDims = Object.keys(proj.dims || {}).length;
      check('Projektdatei gespeichert und wieder lesbar', nDims === 3 && app.store.getState().dirty === false, `${nDims} Bemaßungen ${lastToast()}`);

      // Binärdaten mit allen Bytewerten, Leerzeichen und Umlaute im Pfad
      const bin = new Uint8Array(70000).map((_, i) => (i * 7 + (i >> 8)) & 255);
      const binPath = join('Binär Test äöü.bin');
      await write(binPath, bin);
      const back = await read(binPath);
      check('Binärdaten kommen unverändert an (70 kB)', back.length === bin.length && back.every((b, i) => b === bin[i]), `${back.length} Bytes`);

      let err = '';
      try {
        await read(join('gibt-es-nicht.vdp'));
      } catch (e) {
        err = String(e);
      }
      check('Lesefehler wird verständlich gemeldet', err.includes('nicht gelesen'), err);

      const fonts = await invoke('list_fonts');
      check('Installierte Schriftarten werden gelistet', Array.isArray(fonts) && fonts.length > 0, `${fonts.length} Familien, z. B. ${fonts.slice(0, 3).join(', ')}`);
    } catch (e) {
      check('Unerwartete Ausnahme', false, e && e.stack ? e.stack : e);
    }

    const report = {
      ok: checks.every((c) => c.ok) && problems.length === 0,
      ms: Math.round(performance.now() - t0),
      userAgent: navigator.userAgent,
      checks,
      problems,
    };
    await write(OUT, new TextEncoder().encode(JSON.stringify(report, null, 2)));
  }
})();
