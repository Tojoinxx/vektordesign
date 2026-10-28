import { useEffect, useMemo, useRef, useState } from 'react';
import { FileImage, FileText, FileCode2, X } from 'lucide-react';
import { gangPieces, gangSpecOf, layoutGang, parseNames, type GangSheetSpec } from '../model/gangsheet';
import { productionOf } from '../model/production';
import { drawDesign } from '../render/drawDesign';
import { preloadImages } from '../model/image';
import { listFonts } from '../platform/fonts';
import { useApp, useAppState, useUi } from './hooks';
import { ColorButton } from './ColorPicker';

/**
 * DTF-/Transfer-Sammelbogen: Motive mit Stückzahlen und Namen/Nummern aus einer Liste
 * platzsparend auf die Rollenbreite setzen, Vorschau mit Länge und Ausnutzung, Export als
 * PDF (Vektor + Schnittlinien-Ebene), PNG 300 dpi oder SVG.
 */

const ROLLS = [300, 330, 560, 580, 600];
const MAX_PREVIEW_PX = 30000;

export function GangSheetView() {
  const open = useUi((s) => s.gangSheet);
  if (!open) return null;
  return <GangSheetInner />;
}

function num(v: string, fallback: number, min = 0): number {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= min ? n : fallback;
}

function NumberInput({ value, onChange, label, testId, min = 0, step = 1 }: { value: number; onChange: (n: number) => void; label: string; testId?: string; min?: number; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="gang-field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        step={step}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(num(text, value, min))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(num(text, value, min));
        }}
      />
    </label>
  );
}

function GangSheetInner() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const busy = useUi((s) => s.busy);
  const p = useMemo(() => productionOf(doc), [doc]);
  const [spec, setSpec] = useState<GangSheetSpec>(() => {
    const s = gangSpecOf(p);
    // Neue Motiv/Varianten-Kombinationen mit Stückzahl 0 ergänzen
    const items = [...s.items];
    for (const m of p.motifs) for (const v of p.variants) if (!items.some((i) => i.motifId === m.id && i.variantId === v.id)) items.push({ kind: 'motif', motifId: m.id, variantId: v.id, count: 0 });
    return { ...s, items: items.filter((i) => p.motifs.some((m) => m.id === i.motifId) && p.variants.some((v) => v.id === i.variantId)) };
  });
  const [fonts, setFonts] = useState<string[]>([]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [wrapW, setWrapW] = useState(600);
  const [ready, setReady] = useState(0);
  const set = (patch: Partial<GangSheetSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const setNames = (patch: Partial<GangSheetSpec['names']>) => setSpec((s) => ({ ...s, names: { ...s.names, ...patch } }));
  const close = () => {
    app.saveGangSheet(spec);
    app.ui.setState({ gangSheet: false });
  };

  useEffect(() => {
    void listFonts().then(setFonts);
    void preloadImages(doc).then(() => setReady((n) => n + 1));
  }, [doc]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const pieces = useMemo(() => gangPieces(doc, spec, p), [doc, spec, p]);
  const layout = useMemo(() => layoutGang(pieces, spec), [pieces, spec]);
  const names = useMemo(() => parseNames(spec.names.rows), [spec.names.rows]);
  const totalLen = layout.sheets.reduce((s, x) => s + x.length, 0);
  const SHEET_GAP = 40; // mm Abstand zwischen Bögen in der Vorschau

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const pad = 16;
    const k = Math.max(0.2, (wrapW - 2 * pad) / spec.width);
    const totalMm = layout.sheets.reduce((s, x) => s + x.length, 0) + SHEET_GAP * (layout.sheets.length - 1);
    const cssW = wrapW;
    const cssH = Math.min(MAX_PREVIEW_PX, Math.ceil(totalMm * k + 2 * pad));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(cssW * dpr);
    c.height = Math.round(cssH * dpr);
    c.style.width = `${cssW}px`;
    c.style.height = `${cssH}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    let top = pad;
    const sheetTop: number[] = [];
    for (const sh of layout.sheets) {
      sheetTop.push(top);
      // Folie: Schachbrett = transparent
      const w = spec.width * k;
      const h = sh.length * k;
      ctx.save();
      ctx.beginPath();
      ctx.rect(pad, top, w, h);
      ctx.clip();
      const cell = 8;
      for (let y = 0; y < h; y += cell)
        for (let x = 0; x < w; x += cell) {
          ctx.fillStyle = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? '#9aa0a8' : '#b4b9c0';
          ctx.fillRect(pad + x, top + y, cell, cell);
        }
      ctx.restore();
      ctx.strokeStyle = '#4a5059';
      ctx.lineWidth = 1;
      ctx.strokeRect(pad + 0.5, top + 0.5, w - 1, h - 1);
      top += (sh.length + SHEET_GAP) * k;
    }
    for (const pl of layout.placed) {
      const pc = pl.piece;
      const w = (pl.rotated ? pc.h : pc.w) * k;
      const h = (pl.rotated ? pc.w : pc.h) * k;
      let x = pad + pl.x * k;
      const y = sheetTop[pl.sheet] + pl.y * k;
      if (spec.mirror) x = pad + (spec.width - pl.x) * k - w;
      ctx.save();
      ctx.translate(x, y);
      if (spec.mirror) {
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
      }
      if (pl.rotated) {
        ctx.translate(w, 0);
        ctx.rotate(Math.PI / 2);
      }
      const { box } = pc;
      drawDesign({ ctx, toScreen: (q) => ({ x: (q.x - box.minX) * k, y: (box.maxY - q.y) * k }), scale: k, minStrokePx: 0, design: true }, pc.doc);
      ctx.restore();
      if (spec.cutLines) {
        const g = (spec.gap / 2) * k;
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#ff00ff';
        ctx.strokeRect(x - g, y - g, w + 2 * g, h + 2 * g);
        ctx.restore();
      }
    }
  }, [layout, spec.width, spec.gap, spec.cutLines, spec.mirror, wrapW, ready]);

  const count = (motifId: string, variantId: string) => spec.items.find((i) => i.motifId === motifId && i.variantId === variantId)?.count ?? 0;
  const setCount = (motifId: string, variantId: string, n: number) =>
    setSpec((s) => ({ ...s, items: s.items.map((i) => (i.motifId === motifId && i.variantId === variantId ? { ...i, count: Math.max(0, Math.round(n)) } : i)) }));

  const doExport = (f: 'pdf' | 'png' | 'svg') => {
    app.saveGangSheet(spec);
    void app.exportGangSheet(spec, f);
  };
  const fontList = fonts.includes(spec.names.fontFamily) ? fonts : [spec.names.fontFamily, ...fonts];

  return (
    <div className="placement-back" role="dialog" aria-modal="true" aria-label="Sammelbogen" data-testid="gangsheet">
      <div className="placement">
        <div className="placement-head">
          <h2>DTF-Sammelbogen</h2>
          <span className="muted small" data-testid="gang-summary">
            {layout.placed.length} Stück · {layout.sheets.length} {layout.sheets.length === 1 ? 'Bogen' : 'Bögen'} · {(totalLen / 1000).toFixed(2).replace('.', ',')} m Länge ·{' '}
            {Math.round(layout.usage * 100)} % genutzt
          </span>
          <span className="spacer" />
          <button className="btn" onClick={() => doExport('pdf')} disabled={!!busy || !layout.placed.length} data-testid="gang-pdf" title="Vektor-PDF in Originalgröße, Schnittlinien als eigene Ebene">
            <FileText size={15} /> PDF
          </button>
          <button className="btn" onClick={() => doExport('png')} disabled={!!busy || !layout.placed.length} data-testid="gang-png" title="PNG 300 dpi, transparenter Hintergrund, ohne Schnittlinien">
            <FileImage size={15} /> PNG 300 dpi
          </button>
          <button className="btn" onClick={() => doExport('svg')} disabled={!!busy || !layout.placed.length} data-testid="gang-svg">
            <FileCode2 size={15} /> SVG
          </button>
          <button className="icon-btn" onClick={close} aria-label="Schließen" data-testid="gang-close">
            <X size={18} />
          </button>
        </div>
        <div className="placement-body">
          <div className="placement-canvas gang-stage" ref={wrapRef}>
            {layout.placed.length ? (
              <canvas ref={canvasRef} data-testid="gang-canvas" aria-label="Vorschau des Sammelbogens" />
            ) : (
              <p className="gang-empty">Trage rechts Stückzahlen für deine Motive ein oder füge eine Namensliste hinzu. Die Vorschau ordnet alles automatisch auf der Rollenbreite an.</p>
            )}
          </div>
          <aside className="placement-side gang-side">
            {busy && <p className="muted small">{busy}</p>}
            {layout.tooWide.length > 0 && (
              <p className="warn small" data-testid="gang-toowide">
                {layout.tooWide.length} Stück {layout.tooWide.length === 1 ? 'ist' : 'sind'} breiter als die Rolle und fehlen: {[...new Set(layout.tooWide.map((t) => t.label))].join(', ')}
              </p>
            )}
            <h4>Rolle</h4>
            <div className="swatch-row">
              {ROLLS.map((w) => (
                <button key={w} className={`btn small ${spec.width === w ? 'on' : ''}`} onClick={() => set({ width: w })} data-testid={`gang-roll-${w}`}>
                  {w}
                </button>
              ))}
            </div>
            <div className="gang-grid">
              <NumberInput label="Breite (mm)" value={spec.width} min={50} onChange={(n) => set({ width: n })} testId="gang-width" />
              <NumberInput label="Max. Bogenlänge (mm)" value={spec.maxLength} min={100} onChange={(n) => set({ maxLength: n })} testId="gang-maxlen" />
              <NumberInput label="Abstand (mm)" value={spec.gap} onChange={(n) => set({ gap: n })} testId="gang-gap" />
              <NumberInput label="Rand (mm)" value={spec.margin} onChange={(n) => set({ margin: n })} testId="gang-margin" />
            </div>
            <label className="check">
              <input type="checkbox" checked={spec.rotate} onChange={(e) => set({ rotate: e.target.checked })} /> Drehen erlaubt (90°, spart Folie)
            </label>
            <label className="check">
              <input type="checkbox" checked={spec.cutLines} onChange={(e) => set({ cutLines: e.target.checked })} data-testid="gang-cut" /> Schnittlinien (eigene Ebene im PDF/SVG)
            </label>
            <label className="check">
              <input type="checkbox" checked={spec.mirror} onChange={(e) => set({ mirror: e.target.checked })} /> Gespiegelt ausgeben
            </label>

            <h4>Motive</h4>
            {!p.motifs.length && <p className="muted small">Noch keine Motive – lege sie im Bereich „Produktion“ an.</p>}
            <div className="gang-items">
              {p.motifs.map((m) =>
                p.variants.map((v) => (
                  <div key={`${m.id}/${v.id}`} className="gang-item">
                    <span>
                      {m.name}
                      {p.variants.length > 1 ? <span className="muted"> · {v.name}</span> : null}
                    </span>
                    <NumberInput label="Stück" value={count(m.id, v.id)} onChange={(n) => setCount(m.id, v.id, n)} testId={`gang-count-${m.id}-${v.id}`} />
                  </div>
                )),
              )}
            </div>

            <h4>Namen und Nummern</h4>
            <p className="muted small">Eine Zeile pro Trikot: Name;Nummer;Größe;Anzahl – z. B. aus Excel kopiert. Größe und Anzahl sind optional.</p>
            <textarea
              className="gang-names"
              rows={6}
              value={spec.names.rows}
              placeholder={'Müller;10;L\nSchmidt;7;M;2\nYilmaz;23'}
              onChange={(e) => setNames({ rows: e.target.value })}
              data-testid="gang-names"
              aria-label="Namensliste"
            />
            {names.length > 0 && (
              <p className="muted small" data-testid="gang-names-count">
                {names.reduce((s, r) => s + r.count, 0)} Sätze erkannt
              </p>
            )}
            <label className="gang-field">
              <span>Schrift</span>
              <select value={spec.names.fontFamily} onChange={(e) => setNames({ fontFamily: e.target.value })} aria-label="Schrift für Namen">
                {fontList.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <div className="gang-grid">
              <NumberInput label="Namenshöhe (mm)" value={spec.names.nameHeight} min={5} onChange={(n) => setNames({ nameHeight: n })} testId="gang-nameh" />
              <NumberInput label="Nummernhöhe (mm)" value={spec.names.numberHeight} min={5} onChange={(n) => setNames({ numberHeight: n })} testId="gang-numh" />
              <NumberInput label="Abstand (mm)" value={spec.names.spacing} onChange={(n) => setNames({ spacing: n })} />
              <label className="gang-field">
                <span>Farbe</span>
                <ColorButton value={spec.names.color} label="Farbe der Namen" onChange={(c) => setNames({ color: c })} />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={spec.names.fontWeight >= 600} onChange={(e) => setNames({ fontWeight: e.target.checked ? 700 : 400 })} /> Fett
            </label>
            <p className="muted small">Höhen gelten für Großbuchstaben bzw. Ziffern. Üblich: Rücken-Nummer 200–250 mm, Name 50–75 mm.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
