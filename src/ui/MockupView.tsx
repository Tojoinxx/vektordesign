import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, X } from 'lucide-react';
import type { GarmentView, SketchDoc, Variant } from '../model/types';
import { drawingBounds, garmentOf, GARMENTS } from '../model/garments';
import { applyVariant, contrastWarnings, motifColors, motifDoc, motifSize, productionOf, variantColor } from '../model/production';
import { contrastRatio, luminance } from '../model/color';
import { drawDesign } from '../render/drawDesign';
import { preloadImages } from '../model/image';
import { saveFile, PNG_TYPE } from '../platform/files';
import { useApp, useAppState, useUi } from './hooks';
import { ColorButton } from './ColorPicker';

/**
 * Mockup-Vorschau: das Design auf dem Kleidungsstück in Stofffarbe, mit leichter Schattierung
 * und Stoffstruktur – zum Abstimmen mit Kunden oder fürs Team. Zeigt schwache Kontraste an.
 */

const SWATCHES = ['#ffffff', '#f4f1ea', '#c9ccd1', '#7a7f87', '#2b2f36', '#111317', '#1f3a93', '#0e2a47', '#7b1e2b', '#c8102e', '#2e6b3a', '#d9a900', '#e9a6b4'];

let noise: HTMLCanvasElement | null = null;
function noisePattern(): HTMLCanvasElement {
  if (noise) return noise;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const x = c.getContext('2d')!;
  const img = x.createImageData(96, 96);
  let s = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 16807) % 2147483647;
    const v = 128 + ((s % 64) - 32);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  // feine Webstruktur
  x.globalAlpha = 0.25;
  x.strokeStyle = '#000';
  for (let k = 0; k < 96; k += 3) {
    x.beginPath();
    x.moveTo(k, 0);
    x.lineTo(k, 96);
    x.stroke();
  }
  noise = c;
  return c;
}

export interface MockupRenderOptions {
  doc: SketchDoc;
  garmentId: ReturnType<typeof productionOf>['garment'];
  view: GarmentView;
  variant: Variant;
  fabric: string;
  width: number;
  height: number;
  pad?: number;
}

/** Zeichnet ein Mockup (Kleidungsstück, Schattierung, Motive, Struktur) in einen Canvas-Kontext. */
export function renderMockup(ctx: CanvasRenderingContext2D, o: MockupRenderOptions): void {
  const p = productionOf(o.doc);
  const g = garmentOf(o.garmentId);
  const drawing = g.draw(o.view);
  const b = drawingBounds(drawing);
  const pad = o.pad ?? 24;
  const s = Math.min((o.width - 2 * pad) / (b.maxX - b.minX), (o.height - 2 * pad) / (b.maxY - b.minY));
  const ox = o.width / 2 - ((b.minX + b.maxX) / 2) * s;
  const oy = o.height / 2 - ((b.minY + b.maxY) / 2) * s;
  const T = (x: number, y: number) => ({ x: ox + x * s, y: oy + y * s });
  const dark = luminance(o.fabric) < 0.25;
  const outline = new Path2D();
  for (const f of drawing.fills) {
    f.pts.forEach(([x, y], i) => {
      const q = T(x, y);
      if (i) outline.lineTo(q.x, q.y);
      else outline.moveTo(q.x, q.y);
    });
    outline.closePath();
  }
  // Schatten unter dem Kleidungsstück
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.28)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = o.fabric;
  ctx.fill(outline);
  ctx.restore();
  // Flächen einzeln (Kapuze hinten etwas dunkler)
  drawing.fills.forEach((f, i) => {
    const path = new Path2D();
    f.pts.forEach(([x, y], k) => {
      const q = T(x, y);
      if (k) path.lineTo(q.x, q.y);
      else path.moveTo(q.x, q.y);
    });
    path.closePath();
    ctx.fillStyle = o.fabric;
    ctx.fill(path);
    if (i < drawing.fills.length - 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.08)';
      ctx.fill(path);
    }
  });
  ctx.save();
  ctx.clip(outline);
  // Motive
  for (const m of p.motifs) {
    if (m.placement.view !== o.view) continue;
    const size = motifSize(o.doc, m);
    if (!size) continue;
    const md = applyVariant(motifDoc(o.doc, m), o.variant);
    const left = m.placement.x - size.w / 2;
    drawDesign({ ctx, scale: s, minStrokePx: 0.4, design: true, toScreen: (w) => T(left + (w.x - size.box.minX), m.placement.y + (size.box.maxY - w.y)) }, md);
  }
  // Licht und Falten
  const top = T(0, b.minY);
  const bottom = T(0, b.maxY);
  const lg = ctx.createLinearGradient(0, top.y, 0, bottom.y);
  lg.addColorStop(0, dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.25)');
  lg.addColorStop(0.55, 'rgba(0,0,0,0)');
  lg.addColorStop(1, dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.16)');
  ctx.fillStyle = lg;
  ctx.fill(outline);
  ctx.strokeStyle = dark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 6;
  ctx.filter = 'blur(6px)';
  for (const fx of [-0.28, 0.3]) {
    const a = T((b.maxX - b.minX) * fx * 0.6, b.maxY * 0.35);
    const c = T((b.maxX - b.minX) * fx * 0.5, b.maxY * 0.95);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(a.x + 12, (a.y + c.y) / 2, c.x, c.y);
    ctx.stroke();
  }
  ctx.filter = 'none';
  // Stoffstruktur (auch über dem Druck – wirkt eingedruckt)
  const pat = ctx.createPattern(noisePattern(), 'repeat');
  if (pat) {
    ctx.globalAlpha = 0.07;
    ctx.globalCompositeOperation = 'overlay';
    ctx.fillStyle = pat;
    ctx.fill(outline);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
  // Nähte
  ctx.save();
  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  for (const l of drawing.lines) {
    ctx.beginPath();
    l.pts.forEach(([x, y], i) => {
      const q = T(x, y);
      if (i) ctx.lineTo(q.x, q.y);
      else ctx.moveTo(q.x, q.y);
    });
    if (l.closed) ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export function MockupView() {
  const open = useUi((s) => s.mockup);
  if (!open) return null;
  return <MockupInner />;
}

function MockupInner() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const p = useMemo(() => productionOf(doc), [doc]);
  const [variantId, setVariantId] = useState(p.variants[0].id);
  const variant = p.variants.find((v) => v.id === variantId) ?? p.variants[0];
  const [fabric, setFabric] = useState<string | null>(null);
  const [garmentId, setGarmentId] = useState(p.garment);
  const fab = fabric ?? variant.fabric;
  const g = garmentOf(garmentId);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const refs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [ready, setReady] = useState(0);
  const [compare, setCompare] = useState(false);
  const close = () => app.ui.setState({ mockup: false });

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    void preloadImages(doc).then(() => setReady((n) => n + 1));
  }, [doc]);
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

  const views = g.views;
  // Vergleich: alle Varianten nebeneinander (Ansicht, auf der Motive liegen)
  const compareView = (p.motifs.find((m) => views.includes(m.placement.view))?.placement.view ?? views[0]) as GarmentView;
  const panels = compare
    ? p.variants.map((v) => ({ key: v.id, view: compareView, variant: v, fabric: v.fabric, label: v.name }))
    : views.map((v) => ({ key: v, view: v, variant, fabric: fab, label: v === 'front' ? 'Vorderansicht' : 'Rückansicht' }));
  const cw = Math.floor((size.w - 16 * (panels.length - 1)) / panels.length);
  const capH = compare ? 24 : 0;
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    for (const pn of panels) {
      const c = refs.current[pn.key];
      if (!c) continue;
      c.width = Math.round(cw * dpr);
      c.height = Math.round((size.h - capH) * dpr);
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, size.h - capH);
      renderMockup(ctx, { doc, garmentId, view: pn.view, variant: pn.variant, fabric: pn.fabric, width: cw, height: size.h - capH });
    }
  }, [doc, garmentId, variant, fab, cw, size.h, views, ready, compare]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kontrast der Druckfarben auf diesem Stoff
  const colors = useMemo(() => {
    const set = new Set<string>();
    for (const m of p.motifs) for (const c of motifColors(doc, m)) set.add(variantColor(variant, c));
    return [...set].map((c) => ({ c, r: contrastRatio(c, fab) }));
  }, [doc, p.motifs, variant, fab]);
  const weak = colors.filter((x) => x.r < 1.6);
  const allWarn = contrastWarnings(doc, p);

  const savePng = async () => {
    const W = 1600 * panels.length;
    const H = compare ? 1900 : 1800;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#eceef1';
    ctx.fillRect(0, 0, W, H);
    await preloadImages(doc);
    panels.forEach((pn, i) => {
      ctx.save();
      ctx.translate(i * 1600, 0);
      renderMockup(ctx, { doc, garmentId, view: pn.view, variant: pn.variant, fabric: pn.fabric, width: 1600, height: 1800, pad: 120 });
      if (compare) {
        ctx.fillStyle = '#1e2328';
        ctx.font = '600 56px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(pn.label, 800, 1860);
      }
      ctx.restore();
    });
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
    if (!blob) return;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const name = `${p.article}_Mockup_${compare ? 'Varianten' : variant.name}.png`.replace(/[\\/:*?"<>|]+/g, '_');
    const res = await saveFile(bytes, name, PNG_TYPE).catch(() => null);
    if (res) app.editor.toast(`Mockup gespeichert: ${res.name}`, 'success');
  };

  return (
    <div className="placement-back" role="dialog" aria-modal="true" aria-label="Mockup" data-testid="mockup">
      <div className="placement">
        <div className="placement-head">
          <h2>Mockup</h2>
          <select value={garmentId} onChange={(e) => setGarmentId(e.target.value as typeof garmentId)} aria-label="Kleidungsstück">
            {GARMENTS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            value={variant.id}
            onChange={(e) => {
              setVariantId(e.target.value);
              setFabric(null);
            }}
            aria-label="Farbvariante"
            data-testid="mockup-variant"
          >
            {p.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          {p.variants.length > 1 && (
            <label className="check">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} data-testid="mockup-compare" /> Alle Varianten vergleichen
            </label>
          )}
          <span className="spacer" />
          <button className="btn" onClick={() => void savePng()} data-testid="mockup-save">
            <Download size={15} /> Als Bild speichern
          </button>
          <button className="icon-btn" onClick={close} aria-label="Schließen" data-testid="mockup-close">
            <X size={18} />
          </button>
        </div>
        <div className="placement-body">
          <div className="placement-canvas mockup-stage" ref={wrapRef}>
            <div className="mockup-row" data-testid="mockup-panels">
              {panels.map((pn) => (
                <figure key={pn.key} className="mockup-panel">
                  <canvas
                    ref={(el) => {
                      refs.current[pn.key] = el;
                    }}
                    style={{ width: cw, height: size.h - capH }}
                    aria-label={pn.label}
                  />
                  {compare && <figcaption>{pn.label}</figcaption>}
                </figure>
              ))}
            </div>
          </div>
          <aside className="placement-side">
            <h4>Stofffarbe</h4>
            <div className="swatch-row">
              {SWATCHES.map((c) => (
                <button key={c} className={`swatch-btn ${fab.toLowerCase() === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setFabric(c)} aria-label={`Stofffarbe ${c}`} title={c} />
              ))}
              <ColorButton value={fab} label="Eigene Stofffarbe" onChange={(c) => setFabric(c)} />
            </div>
            {fabric && (
              <button className="link" onClick={() => setFabric(null)}>
                Stofffarbe der Variante „{variant.name}“ verwenden
              </button>
            )}
            <h4>Kontrast der Druckfarben</h4>
            <ul className="contrast-list" data-testid="mockup-contrast">
              {colors.map(({ c, r }) => (
                <li key={c} className={r < 1.6 ? 'bad' : r < 2.5 ? 'meh' : 'ok'}>
                  <span className="swatch" style={{ background: c }} />
                  <code>{c.toUpperCase()}</code>
                  <span className="spacer" />
                  <span>{r.toFixed(1).replace('.', ',')} : 1</span>
                  <span className="tag">{r < 1.6 ? 'kaum sichtbar' : r < 2.5 ? 'schwach' : 'gut'}</span>
                </li>
              ))}
            </ul>
            {weak.length > 0 && (
              <p className="error-text small">Diese Farbe{weak.length > 1 ? 'n heben' : ' hebt'} sich auf diesem Stoff kaum ab. Hellere/dunklere Druckfarbe wählen oder eine Kontur ergänzen.</p>
            )}
            {allWarn.length > 0 && (
              <>
                <h4>Alle Varianten</h4>
                <ul className="contrast-list">
                  {allWarn.map((w) => (
                    <li key={`${w.variant}-${w.color}`} className="bad">
                      <span className="swatch" style={{ background: w.color }} />
                      <span>
                        {w.variant}: {w.color.toUpperCase()} auf {w.fabric}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <p className="muted small">Vorschau zur Abstimmung – Farben am Bildschirm weichen vom echten Druck ab. Maße und Lage entsprechen der Platzierung.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
