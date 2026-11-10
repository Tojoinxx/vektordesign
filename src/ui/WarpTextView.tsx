import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import type { Font } from 'opentype.js';
import type { Contour, WarpSource, WarpStyle } from '../model/types';
import { WARP_STYLES } from '../model/warp';
import { segments } from '../model/shape';
import { loadFont } from '../platform/fontOutline';
import { listFonts } from '../platform/fonts';
import { warpedTextContours, warpTextOp } from '../store/ops';
import { paintColor } from '../model/paint';
import { Modal } from './Chrome';
import { useApp, useUi } from './hooks';

/**
 * Text verformen mit Live-Vorschau (Bogen, Wölbung, Taille, Welle, Flagge, Ansteigen). Bleibt bearbeitbar:
 * Doppelklick auf den verformten Text öffnet den Dialog wieder.
 */
export function WarpTextView() {
  const id = useUi((s) => s.warpText);
  if (!id) return null;
  return <WarpInner id={id} />;
}

/** Kleine Symbole für die Arten (Grundlinie als Kurve). */
const STYLE_ICON: Record<WarpStyle, string> = {
  arch: 'M3 17 Q12 3 21 17',
  bulge: 'M3 9 Q12 2 21 9 M3 15 Q12 22 21 15',
  squeeze: 'M3 4 Q12 11 21 4 M3 20 Q12 13 21 20',
  wave: 'M3 12 C7 3 9 3 12 12 S17 21 21 12',
  flag: 'M3 12 C5 8 7 8 9 12 S13 16 15 12 S19 6 21 10',
  rise: 'M3 18 C10 18 14 6 21 6',
};

function WarpInner({ id }: { id: string }) {
  const app = useApp();
  const doc = app.editor.s.doc;
  const e = doc.entities[id];
  const initial: WarpSource =
    e?.kind === 'shape' && e.warp
      ? e.warp
      : e?.kind === 'text'
        ? { text: e.text, fontFamily: e.fontFamily, fontSize: e.fontSize, fontWeight: e.fontWeight, italic: e.italic, style: 'arch', amount: 35 }
        : { text: 'TEXT', fontFamily: 'Arial', fontSize: 20, fontWeight: 700, italic: false, style: 'arch', amount: 35 };
  const [w, setW] = useState<WarpSource>(initial);
  const [font, setFont] = useState<Font | null>(null);
  const [fonts, setFonts] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const close = () => app.ui.setState({ warpText: null });
  const set = (p: Partial<WarpSource>) => setW((x) => ({ ...x, ...p }));
  const color = e ? (paintColor(e.style.fill) ?? e.style.stroke ?? '#1e2328') : '#1e2328';

  useEffect(() => {
    void listFonts().then(setFonts);
  }, []);
  useEffect(() => {
    let alive = true;
    void loadFont(w.fontFamily, w.fontWeight, w.italic).then((f) => alive && setFont(f.font));
    return () => {
      alive = false;
    };
  }, [w.fontFamily, w.fontWeight, w.italic]);

  const contours = useMemo<Contour[]>(() => {
    if (!font || !w.text.trim()) return [];
    try {
      return warpedTextContours(font, w);
    } catch {
      return [];
    }
  }, [font, w]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const W = 360;
    const H = 250;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#eef0f3';
    ctx.fillRect(0, 0, W, H);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const ct of contours)
      for (const q of ct.nodes) {
        minX = Math.min(minX, q.x);
        minY = Math.min(minY, q.y);
        maxX = Math.max(maxX, q.x);
        maxY = Math.max(maxY, q.y);
      }
    if (!Number.isFinite(minX)) return;
    const k = Math.min((W - 40) / (maxX - minX || 1), (H - 40) / (maxY - minY || 1));
    const T = (q: { x: number; y: number }) => ({ x: W / 2 + (q.x - (minX + maxX) / 2) * k, y: H / 2 - (q.y - (minY + maxY) / 2) * k });
    ctx.beginPath();
    for (const ct of contours) {
      if (!ct.nodes.length) continue;
      const s0 = T(ct.nodes[0]);
      ctx.moveTo(s0.x, s0.y);
      for (const sg of segments(ct)) {
        const p3 = T(sg.p3);
        ctx.lineTo(p3.x, p3.y);
      }
      if (ct.closed) ctx.closePath();
    }
    ctx.fillStyle = color === '#ffffff' || color.toLowerCase() === '#fff' ? '#1e2328' : color;
    ctx.fill('nonzero');
    ctx.fillStyle = '#6b7480';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText(`${(maxX - minX || 0).toFixed(1).replace('.', ',')} × ${(maxY - minY || 0).toFixed(1).replace('.', ',')} mm`, 10, H - 10);
  }, [contours, color]);

  const apply = async () => {
    const out = await warpTextOp(app.editor, id, w);
    if (!out.ok) {
      app.editor.toast(out.message, 'error');
      return;
    }
    close();
  };
  const fontList = fonts.includes(w.fontFamily) ? fonts : [w.fontFamily, ...fonts];
  const hint = WARP_STYLES.find((s) => s.id === w.style)?.hint;

  return (
    <Modal title="Text verformen" onClose={close} testId="warp-text" wide>
      <div className="gen-body">
        <div className="gen-side">
          <div className="warp-styles" role="radiogroup" aria-label="Art">
            {WARP_STYLES.map((s) => (
              <button key={s.id} className={w.style === s.id ? 'on' : ''} role="radio" aria-checked={w.style === s.id} onClick={() => set({ style: s.id })} title={s.hint} data-testid={`warp-${s.id}`}>
                <svg width="30" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d={STYLE_ICON[s.id]} />
                </svg>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <p className="muted small">{hint}</p>
          <div className="gen-fields">
            <label className="field wide">
              <span>
                Stärke ({w.amount > 0 ? '+' : ''}
                {w.amount} %)
              </span>
              <input type="range" min={-100} max={100} step={1} value={w.amount} onChange={(ev) => set({ amount: Number(ev.target.value) })} data-testid="warp-amount" />
            </label>
            <label className="field wide">
              <span>Text</span>
              <input type="text" value={w.text} onChange={(ev) => set({ text: ev.target.value })} onKeyDown={(ev) => ev.stopPropagation()} data-testid="warp-text-input" />
            </label>
            <label className="field">
              <span>Schrift</span>
              <select value={w.fontFamily} onChange={(ev) => set({ fontFamily: ev.target.value })}>
                {fontList.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Größe (mm)</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={String(w.fontSize).replace('.', ',')}
                onChange={(ev) => {
                  const v = Number(ev.target.value.replace(',', '.'));
                  if (v > 0) set({ fontSize: v });
                }}
                onKeyDown={(ev) => ev.stopPropagation()}
              />
            </label>
            <label className="check">
              <input type="checkbox" checked={w.fontWeight >= 600} onChange={(ev) => set({ fontWeight: ev.target.checked ? 700 : 400 })} /> Fett
            </label>
            <label className="check">
              <input type="checkbox" checked={w.italic} onChange={(ev) => set({ italic: ev.target.checked })} /> Kursiv
            </label>
          </div>
        </div>
        <figure className="gen-preview">
          <canvas ref={canvasRef} aria-label="Vorschau" />
          <figcaption className="muted small">Der Text wird zur Form (Umrisse), bleibt aber änderbar: Doppelklick öffnet diesen Dialog wieder.</figcaption>
        </figure>
      </div>
      <div className="row end">
        <button className="btn" onClick={close}>
          Abbrechen
        </button>
        <button className="btn accent" onClick={() => void apply()} disabled={!contours.length} data-testid="warp-apply">
          <Check size={15} /> Übernehmen
        </button>
      </div>
    </Modal>
  );
}
