import { useEffect, useMemo, useRef, useState } from 'react';
import { FileArchive, X } from 'lucide-react';
import type { Vec2 } from '../model/types';
import { applyVariant, motifDoc, productionOf } from '../model/production';
import { isDarkFabric, separate, type Plate, type Separation, type UnderbaseMode } from '../model/separation';
import { textOutlines } from '../export/scene';
import { DEFAULT_SCREEN, plateName, type ScreenPrintOptions } from '../export/screenPrint';
import { useApp, useAppState, useUi } from './hooks';

/**
 * Siebdruck-Paket: Farbseparation mit Vorschau je Sieb (schwarz wie auf dem Film) und
 * Andruck auf Stofffarbe. Unterlage, Rückzug, Überfüllung und Passermarken einstellbar.
 */

export function ScreenPrintView() {
  const open = useUi((s) => s.screenPrint);
  if (!open) return null;
  return <ScreenPrintInner />;
}

function drawPolys(c: HTMLCanvasElement | null, plates: { polys: Vec2[][]; color: string }[], box: NonNullable<Separation['box']>, bg: string | null, cssW: number, cssH: number): void {
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);
  }
  const pad = 10;
  const w = box.maxX - box.minX || 1;
  const h = box.maxY - box.minY || 1;
  const k = Math.min((cssW - 2 * pad) / w, (cssH - 2 * pad) / h);
  const ox = (cssW - w * k) / 2;
  const oy = (cssH - h * k) / 2;
  for (const p of plates) {
    ctx.beginPath();
    for (const poly of p.polys) {
      poly.forEach((q, i) => {
        const x = ox + (q.x - box.minX) * k;
        const y = oy + (box.maxY - q.y) * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fillStyle = p.color;
    ctx.fill('nonzero');
  }
}

function num(v: string, fallback: number): number {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function ScreenPrintInner() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const busy = useUi((s) => s.busy);
  const p = useMemo(() => productionOf(doc), [doc]);
  const [motifId, setMotifId] = useState(p.motifs[0]?.id ?? '');
  const [variantId, setVariantId] = useState(p.variants[0]?.id ?? '');
  const [opts, setOpts] = useState<ScreenPrintOptions>(() => ({ ...DEFAULT_SCREEN, ...(p.screenPrint ?? {}) }) as ScreenPrintOptions);
  const [sep, setSep] = useState<Separation | null>(null);
  const [computing, setComputing] = useState(false);
  const proofRef = useRef<HTMLCanvasElement | null>(null);
  const plateRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const motif = p.motifs.find((m) => m.id === motifId) ?? p.motifs[0];
  const variant = p.variants.find((v) => v.id === variantId) ?? p.variants[0];
  const fabric = variant?.fabric ?? '#ffffff';
  const set = (patch: Partial<ScreenPrintOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const close = () => app.ui.setState({ screenPrint: false });

  useEffect(() => {
    if (!motif || !variant) return;
    let alive = true;
    setComputing(true);
    const t = setTimeout(() => {
      const md = applyVariant(motifDoc(doc, motif), variant);
      void textOutlines(md).then(({ outlines }) => {
        if (!alive) return;
        setSep(separate(md, { outlines, fabric, dropFabricColor: opts.dropFabricColor, underbase: opts.underbase, choke: opts.choke, trap: opts.trap }));
        setComputing(false);
      });
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [doc, motif, variant, fabric, opts.dropFabricColor, opts.underbase, opts.choke, opts.trap]);

  useEffect(() => {
    if (!sep?.box) return;
    drawPolys(proofRef.current, sep.plates, sep.box, fabric, 360, 260);
    for (const pl of sep.plates) drawPolys(plateRefs.current[pl.key], [{ polys: pl.polys, color: '#000000' }], sep.box, '#ffffff', 170, 120);
  }, [sep, fabric]);

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

  const label = (pl: Plate) => plateName(pl, p);
  const dark = isDarkFabric(fabric);

  return (
    <div className="placement-back" role="dialog" aria-modal="true" aria-label="Siebdruck" data-testid="screenprint">
      <div className="placement">
        <div className="placement-head">
          <h2>Siebdruck-Filme</h2>
          {p.motifs.length > 1 && (
            <select value={motif?.id} onChange={(e) => setMotifId(e.target.value)} aria-label="Motiv">
              {p.motifs.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
          <select value={variant?.id} onChange={(e) => setVariantId(e.target.value)} aria-label="Farbvariante" data-testid="screen-variant">
            {p.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <span className="muted small" data-testid="screen-summary">
            {computing ? 'wird berechnet …' : sep ? `${sep.plates.length} Sieb${sep.plates.length === 1 ? '' : 'e'}${sep.underbase ? ' inkl. Unterlage' : ''}` : ''}
          </span>
          <span className="spacer" />
          <button className="btn accent" disabled={!!busy || !sep?.plates.length} onClick={() => void app.exportScreenPrint(motif!.id, variant!.id, opts)} data-testid="screen-export">
            <FileArchive size={15} /> {busy ?? 'ZIP mit Filmen speichern'}
          </button>
          <button className="icon-btn" onClick={close} aria-label="Schließen" data-testid="screen-close">
            <X size={18} />
          </button>
        </div>
        <div className="placement-body">
          <div className="placement-canvas screen-stage">
            {sep?.box ? (
              <>
                <figure className="screen-proof">
                  <canvas ref={proofRef} aria-label="Andruck auf Stofffarbe" />
                  <figcaption>Andruck auf {variant?.fabricName || fabric.toUpperCase()}</figcaption>
                </figure>
                <div className="screen-plates" data-testid="screen-plates">
                  {sep.plates.map((pl) => (
                    <figure key={pl.key} className="screen-plate">
                      <canvas
                        ref={(el) => {
                          plateRefs.current[pl.key] = el;
                        }}
                        aria-label={`Film ${pl.order}`}
                      />
                      <figcaption>
                        <span className="swatch" style={{ background: pl.color }} />
                        {pl.order}. {label(pl)}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </>
            ) : (
              <p className="gang-empty">{computing ? 'Separation wird berechnet …' : 'Keine druckbaren Flächen im Motiv.'}</p>
            )}
          </div>
          <aside className="placement-side gang-side">
            <h4>Weiße Unterlage</h4>
            <div className="swatch-row">
              {(
                [
                  ['auto', `Automatisch (${dark ? 'dunkler Stoff → ja' : 'heller Stoff → nein'})`],
                  ['on', 'Immer'],
                  ['off', 'Nie'],
                ] as [UnderbaseMode, string][]
              ).map(([k, t]) => (
                <button key={k} className={`btn small ${opts.underbase === k ? 'on' : ''}`} onClick={() => set({ underbase: k })} data-testid={`screen-base-${k}`}>
                  {t}
                </button>
              ))}
            </div>
            <div className="gang-grid">
              <label className="gang-field">
                <span>Rückzug Unterlage (mm)</span>
                <input type="text" inputMode="decimal" defaultValue={String(opts.choke).replace('.', ',')} onBlur={(e) => set({ choke: num(e.target.value, opts.choke) })} />
              </label>
              <label className="gang-field">
                <span>Überfüllung (mm)</span>
                <input type="text" inputMode="decimal" defaultValue={String(opts.trap).replace('.', ',')} onBlur={(e) => set({ trap: num(e.target.value, opts.trap) })} data-testid="screen-trap" />
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={opts.dropFabricColor} onChange={(e) => set({ dropFabricColor: e.target.checked })} /> Flächen in Stofffarbe nicht drucken
            </label>
            <label className="check">
              <input type="checkbox" checked={opts.marks} onChange={(e) => set({ marks: e.target.checked })} /> Passermarken und Schnittmarken
            </label>
            <label className="check">
              <input type="checkbox" checked={opts.mirror} onChange={(e) => set({ mirror: e.target.checked })} /> Filme seitenverkehrt
            </label>
            <p className="muted small">
              Gedruckt wird in der angezeigten Reihenfolge: Unterlage, dann helle vor dunklen Farben. Mit Überfüllung laufen helle Farben ein Stück unter dunkle – das verhindert Blitzer bei leichtem
              Versatz. Üblich sind 0,1–0,3 mm.
            </p>
            {sep && sep.warnings.length > 0 && (
              <ul className="screen-warn" data-testid="screen-warnings">
                {sep.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <p className="muted small">
              Das ZIP enthält je Farbe einen Film (PDF, schwarz, 1:1), alle Filme in einer PDF, den Andruck mit Farbliste und eine LIESMICH-Datei. Pantone-Angaben kommen aus den Farbangaben im
              Produktions-Bereich.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
