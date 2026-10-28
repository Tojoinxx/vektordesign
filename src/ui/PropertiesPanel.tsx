import { useEffect, useMemo, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Bold, CircleDot, Italic, Repeat, Trash2 } from 'lucide-react';
import type { Gradient, GradientStop, Id, ImageEntity, ShapeEntity, Style, TextEntity } from '../model/types';
import { contoursBBox, shapeWorldContours } from '../model/shape';
import { DEFAULT_STYLE } from '../model/doc';
import { colorAt, DIRECTION_LABELS, DIRECTION_POINTS, fadeGradient, isFade, isGradient, paintColor, sortedStops, type GradientDirection } from '../model/paint';
import { rgba } from '../model/color';
import { formatNumber } from '../params/expr';
import { CONSTRAINT_LABELS } from '../solver/analysis';
import { DIM_KIND_LABELS, drawableTargets } from '../store/editor';
import { listFonts } from '../platform/fonts';
import { ColorButton } from './ColorPicker';
import { useApp, useAppState } from './hooks';
import { StyleSuggestions } from './StyleSuggestions';
import { ArrangeSection } from './ArrangeSection';

const KIND_NAMES: Record<string, string> = { path: 'Fläche', line: 'Linie', circle: 'Kreis', text: 'Text', shape: 'Form', image: 'Bild' };

/** Wendet Stiländerungen an – live beim Ziehen, als ein Rückgängig-Schritt. */
function useStyleApply(targets: Id[]) {
  const app = useApp();
  return {
    preview(patch: Partial<Style>) {
      if (!targets.length) return;
      if (!app.editor.dragging) app.editor.beginDrag('Stil ändern');
      app.editor.dragDoc((d) => {
        for (const id of targets) {
          const e = d.entities[id];
          if (e) e.style = { ...e.style, ...patch, ...(e.kind === 'line' ? { fill: null } : {}) };
        }
      });
    },
    commit(patch: Partial<Style>) {
      if (!targets.length) {
        app.store.setState({ currentStyle: { ...app.store.getState().currentStyle, ...patch } });
        return;
      }
      if (app.editor.dragging) {
        this.preview(patch);
        app.editor.endDrag();
      } else app.editor.setStyle(targets, patch);
    },
  };
}

export function PropertiesPanel() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const selection = useAppState((s) => s.selection);
  const currentStyle = useAppState((s) => s.currentStyle);
  const targets = useMemo(() => drawableTargets(doc, selection), [doc, selection]);
  const dimSel = selection.map((id) => doc.dims[id]).filter(Boolean);
  const conSel = selection.map((id) => doc.constraints[id]).filter(Boolean);

  const first = targets.length ? doc.entities[targets[0]] : undefined;
  const style: Style = first ? first.style : currentStyle;
  const canFill = !first || first.kind !== 'line';
  const onlyImages = targets.length > 0 && targets.every((id) => doc.entities[id]?.kind === 'image');
  const images = targets.map((id) => doc.entities[id]).filter((e): e is ImageEntity => e?.kind === 'image');
  const texts = targets.map((id) => doc.entities[id]).filter((e): e is TextEntity => e?.kind === 'text');

  let title = 'Neue Objekte';
  if (targets.length === 1 && first) title = first.kind === 'path' && first.edges.length === 4 ? 'Rechteck' : KIND_NAMES[first.kind];
  else if (targets.length > 1) title = `${targets.length} Objekte`;
  else if (dimSel.length === 1) title = `Bemaßung ${dimSel[0].name}`;
  else if (conSel.length === 1) title = `Abhängigkeit „${CONSTRAINT_LABELS[conSel[0].kind]}“`;
  else if (selection.length) title = `${selection.length} Elemente`;

  return (
    <div className="props" data-testid="props">
      <section className="props-section">
        <h3>{title}</h3>
        {!targets.length && !selection.length && <p className="muted">Diese Einstellungen gelten für die nächsten Formen, die du zeichnest.</p>}
        {dimSel.length === 1 && <DimensionProps id={dimSel[0].id} />}
        {conSel.length >= 1 && (
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                const out = app.editor.deleteIds(conSel.map((c) => c.id));
                if (!out.ok) app.editor.toast(out.message, 'error');
              }}
            >
              <Trash2 size={15} /> {conSel.length === 1 ? 'Abhängigkeit löschen' : `${conSel.length} Abhängigkeiten löschen`}
            </button>
          </div>
        )}
      </section>

      {targets.length > 0 && <ArrangeSection targets={targets} />}

      {images.length === 1 && <ImageProps image={images[0]} />}

      {onlyImages && (
        <section className="props-section">
          <h4>Deckkraft</h4>
          <OpacityEditor targets={targets} style={style} />
        </section>
      )}

      {!onlyImages && (targets.length > 0 || !selection.length) && (
        <section className="props-section">
          <h4>Füllung</h4>
          {canFill ? <FillEditor targets={targets} style={style} /> : <p className="muted">Offene Linien haben keine Füllung – Farbe über die Kontur.</p>}
          <h4>Kontur</h4>
          <StrokeEditor targets={targets} style={style} />
          <h4>Deckkraft</h4>
          <OpacityEditor targets={targets} style={style} />
        </section>
      )}

      {texts.length === 1 && <TextProps text={texts[0]} />}
      {targets.length === 1 && first?.kind === 'shape' && <ShapeProps shape={first} />}

      {!onlyImages && (targets.length > 0 || (!selection.length && doc.order.length > 0)) && (
        <StyleSuggestions targets={targets.length ? targets : doc.order.filter((id) => !doc.entities[id]?.construction)} whole={!targets.length} />
      )}

      <SketchInfo />
    </div>
  );
}

// ---------------------------------------------------------------------------

function Segmented<T extends string>({ value, options, onChange, testId }: { value: T; options: { value: T; label: string; icon?: React.ReactNode }[]; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="segmented" role="radiogroup" data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)} title={o.label}>
          {o.icon ?? o.label}
        </button>
      ))}
    </div>
  );
}

function FillEditor({ targets, style }: { targets: Id[]; style: Style }) {
  const apply = useStyleApply(targets);
  const mode: 'none' | 'solid' | 'gradient' = !style.fill ? 'none' : isGradient(style.fill) ? 'gradient' : 'solid';
  const color = paintColor(style.fill) ?? '#2f6fd6';
  return (
    <div className="stack">
      <Segmented
        testId="fill-mode"
        value={mode}
        options={[
          { value: 'none', label: 'Keine' },
          { value: 'solid', label: 'Farbe' },
          { value: 'gradient', label: 'Verlauf' },
        ]}
        onChange={(m) => {
          if (m === 'none') apply.commit({ fill: null });
          else if (m === 'solid') apply.commit({ fill: color });
          else apply.commit({ fill: fadeGradient(color, 'lr') });
        }}
      />
      {mode === 'solid' && (
        <div className="row">
          <ColorButton testId="fill-color" label="Füllfarbe" value={color} onPreview={(c) => apply.preview({ fill: c })} onChange={(c) => apply.commit({ fill: c })} />
          <code className="hex">{color}</code>
        </div>
      )}
      {mode === 'gradient' && isGradient(style.fill) && <GradientEditor gradient={style.fill} onChange={(g) => apply.commit({ fill: g })} onPreview={(g) => apply.preview({ fill: g })} />}
    </div>
  );
}

function GradientEditor({ gradient, onChange, onPreview }: { gradient: Gradient; onChange: (g: Gradient) => void; onPreview: (g: Gradient) => void }) {
  const app = useApp();
  const stops = sortedStops(gradient);
  const [selIdx, setSelIdx] = useState(0);
  const sel = stops[Math.min(selIdx, stops.length - 1)];
  const css = `linear-gradient(to right, ${stops.map((s) => `${rgba(s.color, s.opacity)} ${s.offset * 100}%`).join(', ')}), repeating-conic-gradient(var(--check-a) 0 25%, var(--check-b) 0 50%) 0 0 / 10px 10px`;

  const setStops = (next: GradientStop[], final = true) => (final ? onChange : onPreview)({ ...gradient, stops: next });
  const setDir = (dir: GradientDirection) => {
    const p = DIRECTION_POINTS[dir];
    onChange({ ...gradient, kind: dir === 'center' ? 'radial' : 'linear', from: { ...p.from }, to: { ...p.to } });
  };

  const onBarDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.stop) return;
    const r = e.currentTarget.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const c = colorAt(gradient, t);
    const next = [...stops, { offset: t, color: c.color, opacity: c.opacity }].sort((a, b) => a.offset - b.offset);
    setSelIdx(next.findIndex((s) => s.offset === t));
    setStops(next);
  };
  const dragStop = (i: number) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setSelIdx(i);
    const bar = e.currentTarget.parentElement!;
    const r = bar.getBoundingClientRect();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    let cur = stops;
    const move = (ev: PointerEvent) => {
      const t = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      cur = stops.map((s, k) => (k === i ? { ...s, offset: t } : s));
      setStops(cur, false);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (app.editor.dragging) {
        onPreview({ ...gradient, stops: cur });
        app.editor.endDrag();
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  return (
    <div className="gradient-editor" data-testid="gradient-editor">
      <Segmented
        value={gradient.kind}
        options={[
          { value: 'linear', label: 'Linear' },
          { value: 'radial', label: 'Kreisförmig' },
        ]}
        onChange={(k) => onChange({ ...gradient, kind: k })}
      />
      <div className="gbar" style={{ background: css }} onPointerDown={onBarDown} title="Klicken fügt eine Farbstufe hinzu">
        {stops.map((s, i) => (
          <button
            key={i}
            data-stop="1"
            className={`gstop ${i === selIdx ? 'on' : ''}`}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
            onPointerDown={dragStop(i)}
            aria-label={`Farbstufe ${i + 1}: ${s.color}, ${Math.round(s.opacity * 100)} %`}
          />
        ))}
      </div>
      {sel && (
        <div className="row wrap">
          <ColorButton
            label="Farbe der Stufe"
            value={sel.color}
            onPreview={(c) => setStops(stops.map((s, k) => (k === selIdx ? { ...s, color: c } : s)), false)}
            onChange={(c) => {
              const next = stops.map((s, k) => (k === selIdx ? { ...s, color: c } : s));
              if (app.editor.dragging) {
                onPreview({ ...gradient, stops: next });
                app.editor.endDrag();
              } else setStops(next);
            }}
          />
          <label className="slider">
            <span>Deckkraft</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(sel.opacity * 100)}
              onChange={(e) => setStops(stops.map((s, k) => (k === selIdx ? { ...s, opacity: Number(e.target.value) / 100 } : s)), false)}
              onPointerUp={() => app.editor.dragging && app.editor.endDrag()}
              onKeyUp={() => app.editor.dragging && app.editor.endDrag()}
            />
            <em>{Math.round(sel.opacity * 100)} %</em>
          </label>
          {stops.length > 2 && (
            <button
              className="icon-btn"
              title="Farbstufe entfernen"
              aria-label="Farbstufe entfernen"
              onClick={() => {
                setStops(stops.filter((_, k) => k !== selIdx));
                setSelIdx(0);
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      )}
      <div className="row wrap">
        <div className="segmented" aria-label="Richtung">
          {(
            [
              ['lr', <ArrowRight size={15} key="r" />],
              ['rl', <ArrowLeft size={15} key="l" />],
              ['tb', <ArrowDown size={15} key="d" />],
              ['bt', <ArrowUp size={15} key="u" />],
              ['center', <CircleDot size={15} key="c" />],
            ] as [GradientDirection, React.ReactNode][]
          ).map(([d, icon]) => (
            <button key={d} title={DIRECTION_LABELS[d]} aria-label={DIRECTION_LABELS[d]} onClick={() => setDir(d)}>
              {icon}
            </button>
          ))}
        </div>
        <button className="icon-btn" title="Verlauf umkehren" aria-label="Verlauf umkehren" onClick={() => setStops(stops.map((s) => ({ ...s, offset: 1 - s.offset })))}>
          <Repeat size={15} />
        </button>
      </div>
      <div className="row wrap">
        <button
          className={`btn ${isFade(gradient) ? 'on' : ''}`}
          data-testid="fade-btn"
          onClick={() => {
            const firstStop = stops[0];
            onChange({ ...gradient, stops: [{ ...firstStop, offset: 0, opacity: 1 }, { offset: 1, color: firstStop.color, opacity: 0 }] });
          }}
        >
          Verblassen
        </button>
        <button className="btn" onClick={() => app.setTool('gradient')}>
          Verlauf ziehen (G)
        </button>
      </div>
    </div>
  );
}

function StrokeEditor({ targets, style }: { targets: Id[]; style: Style }) {
  const apply = useStyleApply(targets);
  const [w, setW] = useState(formatNumber(style.strokeWidth, 2));
  useEffect(() => setW(formatNumber(style.strokeWidth, 2)), [style.strokeWidth]);
  const on = !!style.stroke;
  const commitW = () => {
    const n = Number(w.replace(',', '.'));
    if (Number.isFinite(n) && n >= 0) apply.commit({ strokeWidth: n });
    else setW(formatNumber(style.strokeWidth, 2));
  };
  return (
    <div className="stack">
      <div className="row">
        <Segmented
          value={on ? 'on' : 'off'}
          options={[
            { value: 'off', label: 'Keine' },
            { value: 'on', label: 'Farbe' },
          ]}
          onChange={(v) => apply.commit({ stroke: v === 'on' ? style.stroke ?? DEFAULT_STYLE.stroke : null })}
        />
        {on && <ColorButton label="Konturfarbe" value={style.stroke!} onPreview={(c) => apply.preview({ stroke: c })} onChange={(c) => apply.commit({ stroke: c })} />}
      </div>
      {on && (
        <>
          <label className="field">
            <span>Stärke</span>
            <input
              value={w}
              inputMode="decimal"
              onChange={(e) => setW(e.target.value)}
              onBlur={commitW}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitW();
              }}
              aria-label="Konturstärke in mm"
            />
            <em>mm</em>
          </label>
          <div className="row wrap">
            <Segmented
              value={style.lineCap ?? 'butt'}
              options={[
                { value: 'butt', label: 'Flach' },
                { value: 'round', label: 'Rund' },
                { value: 'square', label: 'Eckig' },
              ]}
              onChange={(v) => apply.commit({ lineCap: v })}
            />
            <Segmented
              value={style.dash ?? 'solid'}
              options={[
                { value: 'solid', label: '——' },
                { value: 'dashed', label: '– –' },
                { value: 'dotted', label: '···' },
              ]}
              onChange={(v) => apply.commit({ dash: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function OpacityEditor({ targets, style }: { targets: Id[]; style: Style }) {
  const apply = useStyleApply(targets);
  const app = useApp();
  const v = Math.round((style.opacity ?? 1) * 100);
  return (
    <label className="slider">
      <input
        type="range"
        min={0}
        max={100}
        value={v}
        aria-label="Deckkraft"
        onChange={(e) => apply.preview({ opacity: Number(e.target.value) / 100 })}
        onPointerUp={(e) => apply.commit({ opacity: Number((e.target as HTMLInputElement).value) / 100 })}
        onKeyUp={(e) => apply.commit({ opacity: Number((e.target as HTMLInputElement).value) / 100 })}
        onBlur={() => app.editor.dragging && app.editor.endDrag()}
      />
      <em>{v} %</em>
    </label>
  );
}

/** Bild: Größe in mm, Vorlage (nicht exportieren), Maßstab über Strecke, fixieren. */
function ImageProps({ image }: { image: ImageEntity }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const [wv, setWv] = useState('');
  const [hv, setHv] = useState('');
  useEffect(() => {
    setWv(formatNumber(image.width, 1));
    setHv(formatNumber(image.height, 1));
  }, [image.width, image.height]);
  const layer = doc.layers?.find((l) => l.id === image.layer);
  const apply = (k: 'width' | 'height', v: string) => {
    const n = Number(v.replace(',', '.'));
    if (!(n > 0)) return;
    if (Math.abs(n - (k === 'width' ? image.width : image.height)) < 1e-9) return;
    const out = app.editor.updateImage(image.id, { [k]: n });
    if (!out.ok) app.editor.toast(out.message, 'error');
  };
  const field = (k: 'width' | 'height', label: string, v: string, set: (x: string) => void) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={v}
        onChange={(e) => set(e.target.value)}
        onBlur={() => apply(k, v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{ width: 76 }}
        aria-label={`${label} in mm`}
        data-testid={`image-${k}`}
      />
      <span className="muted">mm</span>
    </label>
  );
  return (
    <section className="props-section" data-testid="image-props">
      <h4>Bild{image.name ? ` – ${image.name}` : ''}</h4>
      <div className="row">
        {field('width', 'Breite', wv, setWv)}
        {field('height', 'Höhe', hv, setHv)}
      </div>
      <p className="muted small">
        {image.pxWidth} × {image.pxHeight} px · entspricht {Math.round((image.pxWidth / image.width) * 25.4)} dpi
      </p>
      <label className="check">
        <input type="checkbox" checked={image.reference} onChange={(e) => app.editor.updateImage(image.id, { reference: e.target.checked })} data-testid="image-reference" />
        Nur Vorlage zum Nachzeichnen (wird nicht exportiert)
      </label>
      <div className="stack">
 <button className="btn accent" onClick={() => app.vectorizeImageDialog(image.id)} data-testid="image-vectorize" title="Aus dem Bild saubere Vektorformen machen (je Farbe eine Form)">
          Vektorisieren …
        </button>
        <button className="btn" onClick={() => app.calibrateImage(image.id)} data-testid="image-calibrate" title="Zwei Punkte einer bekannten Strecke anklicken und das echte Maß eingeben">
          Maßstab über bekannte Strecke festlegen
        </button>
        <button className="btn" onClick={() => app.lockImageLayer(image.id)} disabled={!!layer?.locked} data-testid="image-lock">
          {layer?.locked ? 'Fixiert (Ebene gesperrt)' : `Fixieren – Ebene „${layer?.name ?? 'Vorlage'}“ sperren`}
        </button>
      </div>
      <p className="muted small">Tipp: Deckkraft etwa 40–60 %, dann mit Linie, Kreis oder Freihand darübergezeichnet – Fang und Bemaßungen funktionieren wie gewohnt.</p>
    </section>
  );
}

/** Größe einer freien Form: Breite oder Höhe eingeben (proportional, als Bemaßung gespeichert). */
function ShapeProps({ shape }: { shape: ShapeEntity }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const b = contoursBBox(shapeWorldContours(doc, shape));
  const w = b ? b.maxX - b.minX : 0;
  const h = b ? b.maxY - b.minY : 0;
  const dims = Object.values(doc.dims).filter((m) => m.refs[0] === shape.id && (m.kind === 'width' || m.kind === 'height'));
  const driving = dims.find((m) => !m.driven);
  const [wv, setWv] = useState('');
  const [hv, setHv] = useState('');
  useEffect(() => {
    setWv(formatNumber(w, 2));
    setHv(formatNumber(h, 2));
  }, [w, h]);
  const apply = (kind: 'width' | 'height', v: string) => {
    const current = kind === 'width' ? w : h;
    if (v.trim() === formatNumber(current, 2)) return;
    const out = app.editor.setShapeSize(shape.id, kind, v.replace(',', '.'));
    if (!out.ok) {
      app.editor.toast(out.message, 'error');
      setWv(formatNumber(w, 2));
      setHv(formatNumber(h, 2));
    }
  };
  const field = (kind: 'width' | 'height', label: string, v: string, set: (x: string) => void) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={v}
        onChange={(e) => set(e.target.value)}
        onBlur={() => apply(kind, v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
        style={{ width: 76 }}
        aria-label={`${label} in mm`}
        data-testid={`shape-${kind}`}
      />
      <span className="muted">mm</span>
    </label>
  );
  return (
    <section className="props-section">
      <h4>Größe</h4>
      <div className="row">
        {field('width', 'Breite', wv, setWv)}
        {field('height', 'Höhe', hv, setHv)}
      </div>
      <p className="muted small">
        {driving ? `Festgelegt durch ${driving.name} (${driving.kind === 'width' ? 'Breite' : 'Höhe'}) – Seitenverhältnis bleibt erhalten.` : 'Wert eingeben – die Form wird proportional skaliert. Ausdrücke wie 100/2 sind erlaubt.'}
      </p>
    </section>
  );
}

function TextProps({ text }: { text: TextEntity }) {
  const app = useApp();
  const [fonts, setFonts] = useState<string[]>([]);
  const [size, setSize] = useState(formatNumber(text.fontSize, 2));
  useEffect(() => setSize(formatNumber(text.fontSize, 2)), [text.fontSize]);
  useEffect(() => {
    void listFonts().then(setFonts);
  }, []);
  const set = (patch: Parameters<typeof app.editor.setTextProps>[1]) => {
    const out = app.editor.setTextProps(text.id, patch);
    if (!out.ok) app.editor.toast(out.message, 'error');
    const { text: _ignored, ...typo } = patch;
    void _ignored;
    app.store.setState({ textDefaults: { ...app.store.getState().textDefaults, ...typo } });
  };
  const commitSize = () => {
    const n = Number(size.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) set({ fontSize: n });
    else setSize(formatNumber(text.fontSize, 2));
  };
  const list = fonts.includes(text.fontFamily) ? fonts : [text.fontFamily, ...fonts];
  return (
    <section className="props-section">
      <h4>Text</h4>
      <div className="stack">
        <input className="text-field" value={text.text} onChange={(e) => set({ text: e.target.value })} onKeyDown={(e) => e.stopPropagation()} aria-label="Textinhalt" />
        <select
          value={text.fontFamily}
          onChange={(e) => set({ fontFamily: e.target.value })}
          onFocus={() => {
            // Im Browser: einmalig nach allen installierten Schriften fragen
            void listFonts(true).then(setFonts);
          }}
          aria-label="Schriftart"
          style={{ fontFamily: text.fontFamily }}
        >
          {list.map((f) => (
            <option key={f} value={f} style={{ fontFamily: f }}>
              {f}
            </option>
          ))}
        </select>
        <div className="row">
          <label className="field">
            <span>Größe</span>
            <input
              value={size}
              inputMode="decimal"
              onChange={(e) => setSize(e.target.value)}
              onBlur={commitSize}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitSize();
              }}
              aria-label="Schriftgröße in mm"
            />
            <em>mm</em>
          </label>
          <button className={`icon-btn ${text.fontWeight >= 600 ? 'on' : ''}`} onClick={() => set({ fontWeight: text.fontWeight >= 600 ? 400 : 700 })} title="Fett" aria-label="Fett">
            <Bold size={15} />
          </button>
          <button className={`icon-btn ${text.italic ? 'on' : ''}`} onClick={() => set({ italic: !text.italic })} title="Kursiv" aria-label="Kursiv">
            <Italic size={15} />
          </button>
        </div>
        <Segmented
          value={text.align}
          options={[
            { value: 'left', label: 'Links', icon: <AlignLeft size={15} /> },
            { value: 'center', label: 'Mitte', icon: <AlignCenter size={15} /> },
            { value: 'right', label: 'Rechts', icon: <AlignRight size={15} /> },
          ]}
          onChange={(v) => set({ align: v })}
        />
      </div>
    </section>
  );
}

function DimensionProps({ id }: { id: Id }) {
  const app = useApp();
  const dim = useAppState((s) => s.doc.dims[id]);
  const [expr, setExpr] = useState(dim?.expr ?? '');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setExpr(dim?.expr ?? '');
    setErr(null);
  }, [dim?.expr]);
  if (!dim) return null;
  const apply = () => {
    if (expr === dim.expr) return;
    const out = app.editor.setDimensionExpr(id, expr);
    if (!out.ok) setErr(out.message);
  };
  return (
    <div className="stack">
      <p className="muted">{DIM_KIND_LABELS[dim.kind]}</p>
      {!dim.driven ? (
        <label className="field wide">
          <span>{dim.name} =</span>
          <input
            value={expr}
            onChange={(e) => {
              setExpr(e.target.value);
              setErr(null);
            }}
            onBlur={apply}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') apply();
            }}
            aria-label={`Ausdruck für ${dim.name}`}
          />
          <em>{dim.kind === 'angle' || dim.kind === 'angleX' ? '°' : 'mm'}</em>
        </label>
      ) : (
        <p>
          Getrieben: ({formatNumber(dim.value, 3)} {dim.kind === 'angle' || dim.kind === 'angleX' ? '°' : 'mm'})
        </p>
      )}
      {err && <p className="error-text">{err}</p>}
      <div className="row wrap">
        <button
          className="btn"
          onClick={() => {
            const out = app.editor.setDimensionDriven(id, !dim.driven);
            if (!out.ok) app.editor.toast(out.message, 'error');
          }}
        >
          {dim.driven ? 'Treibend machen' : 'Getrieben machen'}
        </button>
        {(dim.kind === 'radius' || dim.kind === 'diameter') && (
          <button className="btn" onClick={() => app.editor.toggleRadiusDiameter(id)}>
            {dim.kind === 'radius' ? 'Als Durchmesser' : 'Als Radius'}
          </button>
        )}
        <button className="btn" onClick={() => app.editor.deleteIds([id])}>
          <Trash2 size={15} /> Löschen
        </button>
      </div>
    </div>
  );
}

function SketchInfo() {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const analysis = useAppState((s) => s.analysis);
  const dims = Object.values(doc.dims);
  return (
    <section className="props-section">
      <h4>Skizze</h4>
      <p className={`status-text st-${analysis.status}`} data-testid="sketch-status-panel">
        {analysis.label}
      </p>
      {analysis.detail && <p className="muted">{analysis.detail}</p>}
      {dims.length > 0 && (
        <table className="dim-table" aria-label="Bemaßungen">
          <thead>
            <tr>
              <th>Name</th>
              <th>Ausdruck</th>
              <th className="num">Wert</th>
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => (
              <DimRow key={d.id} id={d.id} />
            ))}
          </tbody>
        </table>
      )}
      {!dims.length && <p className="muted">Noch keine Bemaßungen. Mit D bemaßen – Werte lassen sich hier später als Tabelle ändern.</p>}
      <p className="muted small">
        {Object.keys(doc.entities).length} Objekte · {Object.keys(doc.constraints).length} Abhängigkeiten
      </p>
      <button className="link" onClick={() => app.ui.setState({ tutorialList: true })}>
        Tutorials ansehen
      </button>
    </section>
  );
}

function DimRow({ id }: { id: Id }) {
  const app = useApp();
  const d = useAppState((s) => s.doc.dims[id]);
  const selected = useAppState((s) => s.selection.includes(id));
  const [expr, setExpr] = useState(d?.expr ?? '');
  const [err, setErr] = useState(false);
  useEffect(() => setExpr(d?.expr ?? ''), [d?.expr]);
  if (!d) return null;
  const unit = d.kind === 'angle' || d.kind === 'angleX' ? '°' : '';
  const apply = () => {
    if (expr === d.expr) return;
    const out = app.editor.setDimensionExpr(id, expr);
    if (!out.ok) {
      setErr(true);
      app.editor.toast(out.message, 'error');
    } else setErr(false);
  };
  return (
    <tr className={selected ? 'sel' : ''}>
      <td>
        <button className="link" onClick={() => app.editor.select([id])}>
          {d.name}
        </button>
      </td>
      <td>
        {d.driven ? (
          <span className="muted">getrieben</span>
        ) : (
          <input
            className={err ? 'bad' : ''}
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onBlur={apply}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') apply();
            }}
            aria-label={`Ausdruck ${d.name}`}
          />
        )}
      </td>
      <td className="num">{d.driven ? `(${formatNumber(d.value, 2)}${unit})` : `${formatNumber(d.value, 2)}${unit}`}</td>
    </tr>
  );
}
