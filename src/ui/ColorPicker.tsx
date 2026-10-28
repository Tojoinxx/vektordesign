import { useEffect, useRef, useState } from 'react';
import { Pipette } from 'lucide-react';
import { loadLibrary } from '../model/library';
import { cmykToRgb, hexToRgb, hsvToRgb, normalizeHex, rgbToCmyk, rgbToHex, rgbToHsv, type HSV } from '../model/color';

/** Grundfarben für Textildruck (keine Pantone-Bibliothek – lizenzpflichtig). */
export const BASIC_SWATCHES = [
  '#ffffff',
  '#1e2328',
  '#111111',
  '#8a94a6',
  '#d62828',
  '#e8590c',
  '#f5c518',
  '#2f9e5b',
  '#15aabf',
  '#2f6fd6',
  '#1c2e5c',
  '#7048e8',
  '#f783ac',
  '#a0522d',
  '#e9dcc3',
  '#6b8e23',
];

const RECENT_KEY = 'vd.recentColors';

function loadRecent(): string[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).slice(0, 8);
  } catch {
    return [];
  }
}

function pushRecent(c: string): void {
  try {
    const list = [c, ...loadRecent().filter((x) => x !== c)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* privater Modus */
  }
}

export interface ColorPickerProps {
  value: string;
  /** Live-Änderung (beim Ziehen) */
  onPreview?: (hex: string) => void;
  /** Endgültige Änderung */
  onChange: (hex: string) => void;
  onClose: () => void;
}

const r1 = (n: number) => Math.round(n);

/** Farbwähler mit Farbfeld, Farbton, HEX/RGB/HSV/CMYK, Pipette und Farbfeldern. */
export function ColorPicker({ value, onPreview, onChange, onClose }: ColorPickerProps) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value)));
  const [hexText, setHexText] = useState(value);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const hex = rgbToHex(hsvToRgb(hsv));
  const rgb = hexToRgb(hex);
  const cmyk = rgbToCmyk(rgb);
  const recent = loadRecent();
  const palettes = loadLibrary().palettes.slice(0, 3);

  useEffect(() => setHexText(hex), [hex]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  const commit = (h: string) => {
    pushRecent(h);
    onChange(h);
  };

  const setFromHex = (h: string) => {
    const n = normalizeHex(h);
    if (!n) return;
    setHsv(rgbToHsv(hexToRgb(n)));
    commit(n);
  };

  const drag = (ref: React.RefObject<HTMLDivElement | null>, fn: (fx: number, fy: number) => HSV) => (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      const fx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const fy = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      const next = fn(fx, fy);
      setHsv(next);
      onPreview?.(rgbToHex(hsvToRgb(next)));
      return next;
    };
    let last = move(e);
    const onMove = (ev: PointerEvent) => {
      last = move(ev);
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      commit(rgbToHex(hsvToRgb(last)));
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  };

  const pick = async () => {
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!ED) return;
    try {
      const r = await new ED().open();
      setFromHex(r.sRGBHex);
    } catch {
      /* abgebrochen */
    }
  };
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  const num = (v: number, min: number, max: number, set: (n: number) => void, label: string) => (
    <label className="cp-num">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={r1(v)}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) set(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => commit(rgbToHex(hsvToRgb(hsv)))}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commit(rgbToHex(hsvToRgb(hsv)));
        }}
      />
    </label>
  );

  return (
    <div className="color-picker" ref={rootRef} role="dialog" aria-label="Farbwähler">
      <div
        className="cp-sv"
        ref={svRef}
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h}, 100%, 50%))` }}
        onPointerDown={drag(svRef, (fx, fy) => ({ h: hsv.h, s: fx * 100, v: (1 - fy) * 100 }))}
      >
        <div className="cp-sv-knob" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%`, background: hex }} />
      </div>
      <div className="cp-hue" ref={hueRef} onPointerDown={drag(hueRef, (fx) => ({ ...hsv, h: fx * 359.9 }))}>
        <div className="cp-hue-knob" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="cp-row">
        <div className="cp-preview" style={{ background: hex }} />
        <label className="cp-hex">
          <span>HEX</span>
          <input
            value={hexText}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={() => setFromHex(hexText)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') setFromHex(hexText);
            }}
            spellCheck={false}
          />
        </label>
        {hasEyeDropper && (
          <button className="icon-btn" onClick={pick} title="Pipette: Farbe vom Bildschirm aufnehmen" aria-label="Pipette">
            <Pipette size={16} />
          </button>
        )}
      </div>
      <div className="cp-grid">
        {num(rgb.r, 0, 255, (n) => setHsv(rgbToHsv({ ...rgb, r: n })), 'R')}
        {num(rgb.g, 0, 255, (n) => setHsv(rgbToHsv({ ...rgb, g: n })), 'G')}
        {num(rgb.b, 0, 255, (n) => setHsv(rgbToHsv({ ...rgb, b: n })), 'B')}
        {num(hsv.h, 0, 360, (n) => setHsv({ ...hsv, h: n }), 'H')}
        {num(hsv.s, 0, 100, (n) => setHsv({ ...hsv, s: n }), 'S')}
        {num(hsv.v, 0, 100, (n) => setHsv({ ...hsv, v: n }), 'V')}
      </div>
      <div className="cp-grid cp-grid-4">
        {num(cmyk.c, 0, 100, (n) => setHsv(rgbToHsv(cmykToRgb({ ...cmyk, c: n }))), 'C')}
        {num(cmyk.m, 0, 100, (n) => setHsv(rgbToHsv(cmykToRgb({ ...cmyk, m: n }))), 'M')}
        {num(cmyk.y, 0, 100, (n) => setHsv(rgbToHsv(cmykToRgb({ ...cmyk, y: n }))), 'Y')}
        {num(cmyk.k, 0, 100, (n) => setHsv(rgbToHsv(cmykToRgb({ ...cmyk, k: n }))), 'K')}
      </div>
      <div className="cp-swatches" aria-label="Farbfelder">
        {[...recent, ...BASIC_SWATCHES.filter((c) => !recent.includes(c))].slice(0, 16).map((c) => (
          <button key={c} className="swatch" style={{ background: c }} title={c} aria-label={c} onClick={() => setFromHex(c)} />
        ))}
      </div>
      {palettes.map((p) => (
        <div key={p.id} className="cp-palette" title={p.name}>
          <span className="cp-palette-name">{p.name}</span>
          <div className="cp-swatches">
            {p.colors.slice(0, 16).map((c) => (
              <button key={c} className="swatch" style={{ background: c }} title={`${p.name}: ${c}`} aria-label={c} onClick={() => setFromHex(c)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Farbknopf, der den Farbwähler öffnet. */
export function ColorButton({ value, onChange, onPreview, label, testId }: { value: string; onChange: (hex: string) => void; onPreview?: (hex: string) => void; label: string; testId?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="color-button-wrap">
      <button className="color-button" style={{ background: value }} onClick={() => setOpen((o) => !o)} aria-label={`${label}: ${value}`} title={`${label}: ${value}`} data-testid={testId} />
      {open && <ColorPicker value={value} onChange={onChange} onPreview={onPreview} onClose={() => setOpen(false)} />}
    </span>
  );
}
