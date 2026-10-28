import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, FileUp, Ruler, Trash2, X } from 'lucide-react';
import type { GarmentView, Motif, Production, SketchDoc } from '../model/types';
import { areaOf, drawingBounds, garmentOf, techniqueName, type PrintArea } from '../model/garments';
import { applyVariant, motifDoc, motifSize, motifWarnings, productionOf } from '../model/production';
import { luminance } from '../model/color';
import { drawDesign } from '../render/drawDesign';
import { formatNumber } from '../params/expr';
import { Field } from './ProductionPanel';
import { useApp, useAppState, useUi } from './hooks';

/**
 * Platzierung wie auf dem Tisch: Kleidungsstück (eingebaute Skizze oder importierte
 * LabwearOS-Vorlage) in echter Größe, Motiv per Ziehen oder Werteingabe positionieren.
 * Koordinaten in mm, Ursprung = Kragennaht Mitte, y nach unten.
 */

type Mode = { kind: 'idle' } | { kind: 'origin' } | { kind: 'scale'; a?: { x: number; y: number }; b?: { x: number; y: number } };

const mm = (n: number) => formatNumber(n, 1);
const ACCENT = '#e8590c';

export function PlacementView() {
  const motifId = useUi((s) => s.placement);
  if (!motifId) return null;
  return <PlacementInner motifId={motifId} />;
}

function PlacementInner({ motifId }: { motifId: string }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const p = useMemo(() => productionOf(doc), [doc]);
  const motif = p.motifs.find((m) => m.id === motifId) ?? p.motifs[0];
  const g = garmentOf(p.garment);
  const [view, setView] = useState<GarmentView>(motif.placement.view);
  const [variantId, setVariantId] = useState(p.variants[0].id);
  const variant = p.variants.find((v) => v.id === variantId) ?? p.variants[0];
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [scaleInput, setScaleInput] = useState('');
  const [tplPage, setTplPage] = useState(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const close = useCallback(() => app.ui.setState({ placement: null }), [app]);
  const upd = (label: string, fn: (q: Production) => void) => {
    const out = app.editor.updateProduction(label, fn);
    if (!out.ok) app.editor.toast(out.message, 'error');
  };

  useEffect(() => setView(motif.placement.view), [motif.id, motif.placement.view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (mode.kind !== 'idle') setMode({ kind: 'idle' });
        else close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close, mode.kind]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const tpl = p.templates?.[view];
  const [tplImg, setTplImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!tpl) {
      setTplImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setTplImg(img);
    img.src = tpl.image;
  }, [tpl?.image, tpl]);

  // Abbildung Kleidungsstück-mm → Bildschirm
  const drawing = useMemo(() => g.draw(view), [g, view]);
  const frame = useMemo(() => {
    let b = drawingBounds(drawing);
    if (tpl) b = { minX: -tpl.originX, minY: -tpl.originY, maxX: tpl.widthMm - tpl.originX, maxY: tpl.heightMm - tpl.originY };
    const pad = 36;
    const s = Math.min((size.w - 2 * pad) / (b.maxX - b.minX), (size.h - 2 * pad) / (b.maxY - b.minY));
    const ox = size.w / 2 - ((b.minX + b.maxX) / 2) * s;
    const oy = size.h / 2 - ((b.minY + b.maxY) / 2) * s;
    return { s, ox, oy };
  }, [drawing, tpl, size]);
  const toScr = (x: number, y: number) => ({ x: frame.ox + x * frame.s, y: frame.oy + y * frame.s });
  const toG = (sx: number, sy: number) => ({ x: (sx - frame.ox) / frame.s, y: (sy - frame.oy) / frame.s });

  const motifsHere = p.motifs.filter((m) => m.placement.view === view);
  const placementOf = (m: Motif) => (drag && drag.id === m.id ? { ...m.placement, x: drag.x, y: drag.y } : m.placement);
  const docs = useMemo(() => {
    const out = new Map<string, { d: SketchDoc; box: { minX: number; minY: number; maxX: number; maxY: number }; w: number; h: number }>();
    for (const m of p.motifs) {
      const sz = motifSize(doc, m);
      if (sz) out.set(m.id, { d: applyVariant(motifDoc(doc, m), variant), box: sz.box, w: sz.w, h: sz.h });
    }
    return out;
  }, [doc, p.motifs, variant]);

  // Zeichnen
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const dark = luminance(variant.fabric) < 0.3;
    const lineCol = dark ? '#8b939c' : '#59616b';
    if (tpl && tplImg) {
      const a = toScr(-tpl.originX, -tpl.originY);
      ctx.drawImage(tplImg, a.x, a.y, tpl.widthMm * frame.s, tpl.heightMm * frame.s);
    } else {
      ctx.lineJoin = 'round';
      for (const f of drawing.fills) {
        ctx.beginPath();
        f.pts.forEach(([x, y], i) => {
          const q = toScr(x, y);
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        });
        if (f.closed) ctx.closePath();
        ctx.fillStyle = variant.fabric;
        ctx.fill();
        ctx.strokeStyle = lineCol;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1;
      for (const l of drawing.lines) {
        ctx.beginPath();
        l.pts.forEach(([x, y], i) => {
          const q = toScr(x, y);
          if (i) ctx.lineTo(q.x, q.y);
          else ctx.moveTo(q.x, q.y);
        });
        if (l.closed) ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    // Druckbereiche
    const areaCol = dark ? 'rgba(255,255,255,0.18)' : 'rgba(30,35,40,0.16)';
    for (const a of g.areas.filter((x) => x.view === view)) {
      const tl = toScr(a.x - a.w / 2, a.y);
      ctx.strokeStyle = a.id === motif.placement.area ? ACCENT : areaCol;
      ctx.setLineDash([3, 4]);
      ctx.lineWidth = 1;
      ctx.strokeRect(tl.x, tl.y, a.w * frame.s, a.h * frame.s);
    }
    ctx.setLineDash([]);
    // Mittellinie und Bezugspunkt
    const o = toScr(0, 0);
    ctx.strokeStyle = 'rgba(232,89,12,0.55)';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(o.x, o.y - 40);
    ctx.lineTo(o.x, size.h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(o.x, o.y, 4, 0, Math.PI * 2);
    ctx.fill();
    // Motive
    for (const m of motifsHere) {
      const md = docs.get(m.id);
      if (!md) continue;
      const pl = placementOf(m);
      const left = pl.x - md.w / 2;
      drawDesign(
        {
          ctx,
          scale: frame.s,
          minStrokePx: 0.5,
          design: true,
          toScreen: (w) => toScr(left + (w.x - md.box.minX), pl.y + (md.box.maxY - w.y)),
        },
        md.d,
      );
      if (m.id === motif.id) {
        const tl = toScr(left, pl.y);
        const br = toScr(left + md.w, pl.y + md.h);
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.setLineDash([]);
        // Maße
        ctx.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
        const label = (t: string, x: number, y: number) => {
          const w = ctx.measureText(t).width + 8;
          ctx.fillStyle = ACCENT;
          ctx.fillRect(x - w / 2, y - 9, w, 18);
          ctx.fillStyle = '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(t, x, y);
        };
        const dx = pl.x >= 0 ? br.x + 18 : tl.x - 18;
        ctx.strokeStyle = ACCENT;
        ctx.beginPath();
        ctx.moveTo(dx, o.y);
        ctx.lineTo(dx, tl.y);
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(dx, o.y);
        ctx.stroke();
        label(`${mm(pl.y)} mm`, dx, (o.y + tl.y) / 2);
        if (Math.abs(pl.x) > 0.5) {
          const cx = toScr(pl.x, 0).x;
          const yy = br.y + 40;
          ctx.beginPath();
          ctx.moveTo(o.x, yy);
          ctx.lineTo(cx, yy);
          ctx.stroke();
          label(`${mm(Math.abs(pl.x))} mm`, (o.x + cx) / 2, yy);
        }
        label(`${mm(md.w)} × ${mm(md.h)} mm`, (tl.x + br.x) / 2, br.y + 16);
      }
    }
    // Kalibrierpunkte
    if (mode.kind === 'scale') {
      ctx.fillStyle = '#2f6fd6';
      ctx.strokeStyle = '#2f6fd6';
      for (const q of [mode.a, mode.b]) {
        if (!q) continue;
        const s = toScr(q.x, q.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      if (mode.a && mode.b) {
        const a = toScr(mode.a.x, mode.a.y);
        const b = toScr(mode.b.x, mode.b.y);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  });

  const hitMotif = (gx: number, gy: number): Motif | null => {
    for (const m of [...motifsHere].reverse()) {
      const md = docs.get(m.id);
      if (!md) continue;
      const pl = m.placement;
      if (gx >= pl.x - md.w / 2 - 3 && gx <= pl.x + md.w / 2 + 3 && gy >= pl.y - 3 && gy <= pl.y + md.h + 3) return m;
    }
    return null;
  };

  const dragStart = useRef<{ gx: number; gy: number; x: number; y: number } | null>(null);
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const q = toG(e.clientX - r.left, e.clientY - r.top);
    if (mode.kind === 'origin' && tpl) {
      upd('Bezugspunkt der Vorlage', (pp) => {
        const t = pp.templates![view]!;
        t.originX += q.x;
        t.originY += q.y;
      });
      setMode({ kind: 'idle' });
      return;
    }
    if (mode.kind === 'scale') {
      if (!mode.a) setMode({ kind: 'scale', a: q });
      else if (!mode.b) setMode({ kind: 'scale', a: mode.a, b: q });
      else setMode({ kind: 'scale', a: q });
      return;
    }
    const m = hitMotif(q.x, q.y);
    if (!m) return;
    if (m.id !== motif.id) {
      app.ui.setState({ placement: m.id });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { gx: q.x, gy: q.y, x: m.placement.x, y: m.placement.y };
    setDrag({ id: m.id, x: m.placement.x, y: m.placement.y });
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const st = dragStart.current;
    if (!st || !drag) return;
    const r = e.currentTarget.getBoundingClientRect();
    const q = toG(e.clientX - r.left, e.clientY - r.top);
    let x = st.x + q.x - st.gx;
    let y = st.y + q.y - st.gy;
    // Fang: Mittellinie, Vorgaben der Druckbereiche, ganze Millimeter
    const tol = 6 / frame.s;
    if (Math.abs(x) < tol) x = 0;
    for (const a of g.areas.filter((v) => v.view === view)) {
      if (Math.abs(x - a.x) < tol) x = a.x;
      if (Math.abs(y - a.y) < tol) y = a.y;
    }
    if (!e.altKey) {
      x = Math.round(x);
      y = Math.round(y);
    }
    setDrag({ id: drag.id, x, y });
  };
  const onUp = () => {
    const d = drag;
    dragStart.current = null;
    setDrag(null);
    if (!d || (d.x === motif.placement.x && d.y === motif.placement.y)) return;
    upd('Motiv platzieren', (pp) => {
      const t = pp.motifs.find((m) => m.id === d.id);
      if (!t) return;
      const a = areaOf(g, t.placement.area);
      t.placement = { ...t.placement, x: d.x, y: d.y, area: a ? a.id : 'custom' };
    });
  };

  const setArea = (a: PrintArea) =>
    upd('Druckbereich', (pp) => {
      const t = pp.motifs.find((m) => m.id === motif.id);
      if (t) t.placement = { view: a.view, area: a.id, x: a.x, y: a.y };
    });

  const applyScale = () => {
    if (mode.kind !== 'scale' || !mode.a || !mode.b || !tpl) return;
    const D = Number(scaleInput.replace(',', '.'));
    const cur = Math.hypot(mode.b.x - mode.a.x, mode.b.y - mode.a.y);
    if (!(D > 0) || !(cur > 0)) {
      app.editor.toast('Bitte das echte Maß in mm eingeben.', 'error');
      return;
    }
    const f = D / cur;
    upd('Maßstab der Vorlage', (pp) => {
      const t = pp.templates![view]!;
      t.widthMm *= f;
      t.heightMm *= f;
      t.originX *= f;
      t.originY *= f;
    });
    setMode({ kind: 'idle' });
    setScaleInput('');
  };

  const md = docs.get(motif.id);
  const warnings = motifWarnings(doc, p, motif);
  const hint =
    mode.kind === 'origin'
      ? `Auf den Bezugspunkt der Vorlage klicken: ${g.reference[view]}.`
      : mode.kind === 'scale'
        ? !mode.a
          ? 'Ersten Punkt einer bekannten Strecke anklicken (z. B. Brustbreite).'
          : !mode.b
            ? 'Zweiten Punkt anklicken.'
            : 'Echtes Maß der Strecke eingeben und übernehmen.'
        : 'Motiv ziehen (rastet an Mittellinie und Druckbereichen ein, Alt = ohne Raster) oder Werte rechts eingeben. Esc schließt.';

  return (
    <div className="placement-back" role="dialog" aria-modal="true" aria-label="Platzierung" data-testid="placement">
      <div className="placement">
        <div className="placement-head">
          <h2>Platzierung</h2>
          <div className="segmented" role="tablist" aria-label="Motiv">
            {p.motifs.map((m) => (
              <button key={m.id} className={m.id === motif.id ? 'on' : ''} onClick={() => app.ui.setState({ placement: m.id })}>
                {m.name}
              </button>
            ))}
          </div>
          <span className="spacer" />
          {g.views.length > 1 && (
            <div className="segmented" role="tablist" aria-label="Ansicht">
              {g.views.map((v) => (
                <button key={v} className={v === view ? 'on' : ''} onClick={() => setView(v)} data-testid={`placement-view-${v}`}>
                  {v === 'front' ? 'Vorne' : 'Hinten'}
                </button>
              ))}
            </div>
          )}
          <select value={variant.id} onChange={(e) => setVariantId(e.target.value)} aria-label="Farbvariante">
            {p.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          <button className="icon-btn" onClick={close} aria-label="Schließen" data-testid="placement-close">
            <X size={18} />
          </button>
        </div>
        <div className="placement-body">
          <div className="placement-canvas" ref={wrapRef}>
            <canvas
              ref={canvasRef}
              style={{ width: size.w, height: size.h, cursor: mode.kind !== 'idle' ? 'crosshair' : drag ? 'grabbing' : 'grab', touchAction: 'none' }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              data-testid="placement-canvas"
            />
            <div className="placement-hint">{hint}</div>
          </div>
          <aside className="placement-side">
            <h3>{motif.name}</h3>
            <p className="muted small">
              {techniqueName(motif.technique)} · {md ? `${mm(md.w)} × ${mm(md.h)} mm` : 'leer'}
            </p>
            <h4>Druckbereich</h4>
            <div className="area-list">
              {g.areas
                .filter((a) => a.view === view)
                .map((a) => (
                  <button key={a.id} className={`btn ${motif.placement.area === a.id && motif.placement.view === view ? 'on' : ''}`} onClick={() => setArea(a)} data-testid={`area-${a.id}`}>
                    {a.name}
                    <small>
                      {a.w} × {a.h} mm
                    </small>
                  </button>
                ))}
            </div>
            <h4>Lage</h4>
            <div className="form-grid">
              <span>Unter {view === 'front' ? 'Kragen' : 'Nacken'}</span>
              <span className="row">
                <Field
                  value={mm(motif.placement.y)}
                  numeric
                  width={70}
                  label="Oberkante unter Bezugspunkt (mm)"
                  testId="placement-y"
                  onCommit={(v) => {
                    const n = Number(v.replace(',', '.'));
                    if (Number.isFinite(n)) upd('Platzierung', (pp) => void (pp.motifs.find((m) => m.id === motif.id)!.placement.y = n));
                  }}
                />
                mm
              </span>
              <span>Von Mitte</span>
              <span className="row">
                <Field
                  value={mm(motif.placement.x)}
                  numeric
                  width={70}
                  label="Motivmitte von der Mittellinie (mm, + = im Bild rechts)"
                  testId="placement-x"
                  onCommit={(v) => {
                    const n = Number(v.replace(',', '.'));
                    if (Number.isFinite(n)) upd('Platzierung', (pp) => void (pp.motifs.find((m) => m.id === motif.id)!.placement.x = n));
                  }}
                />
                mm
              </span>
            </div>
            <p className="muted small">Bezug: {g.reference[view]}. Oberkante des Motivs; seitlich die Motivmitte (positiv = im Bild rechts).</p>
            {motif.placement.view !== view && (
              <button className="btn" onClick={() => setArea(g.areas.find((a) => a.view === view)!)}>
                Motiv auf diese Ansicht legen
              </button>
            )}
            {warnings.map((w) => (
              <p key={w} className="error-text small">
                {w}
              </p>
            ))}
            <h4>Vorlage ({view === 'front' ? 'vorne' : 'hinten'})</h4>
            {tpl ? (
              <>
                <p className="small">
                  {tpl.name} · {Math.round(tpl.widthMm)} × {Math.round(tpl.heightMm)} mm
                </p>
                <div className="stack">
                  <button className={`btn ${mode.kind === 'origin' ? 'on' : ''}`} onClick={() => setMode({ kind: 'origin' })}>
                    <Crosshair size={15} /> Bezugspunkt setzen
                  </button>
                  <button className={`btn ${mode.kind === 'scale' ? 'on' : ''}`} onClick={() => setMode({ kind: 'scale' })}>
                    <Ruler size={15} /> Maßstab festlegen
                  </button>
                  {mode.kind === 'scale' && mode.a && mode.b && (
                    <div className="row">
                      <input
                        type="text"
                        inputMode="decimal"
                        autoFocus
                        placeholder="echtes Maß"
                        value={scaleInput}
                        onChange={(e) => setScaleInput(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === 'Enter') applyScale();
                        }}
                        style={{ width: 90 }}
                        aria-label="Echtes Maß der Strecke in mm"
                      />
                      mm
                      <button className="btn accent" onClick={applyScale}>
                        Übernehmen
                      </button>
                    </div>
                  )}
                  <button
                    className="btn"
                    onClick={() =>
                      upd('Vorlage entfernen', (pp) => {
                        if (pp.templates) delete pp.templates[view];
                      })
                    }
                  >
                    <Trash2 size={15} /> Vorlage entfernen
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="muted small">LabwearOS-Vorlage als PDF oder AI (mit PDF-Kompatibilität) laden und das Motiv direkt darauf platzieren. Danach Bezugspunkt und Maßstab festlegen.</p>
                <div className="row">
                  <button className="btn" onClick={() => void app.importTemplate(view, undefined, tplPage)} data-testid="template-import">
                    <FileUp size={15} /> Vorlage importieren
                  </button>
                  <label className="field small">
                    Seite
                    <input type="number" min={1} value={tplPage} onChange={(e) => setTplPage(Math.max(1, Number(e.target.value) || 1))} onKeyDown={(e) => e.stopPropagation()} style={{ width: 52 }} aria-label="Seite der PDF-Vorlage" />
                  </label>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
