import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Font } from 'opentype.js';
import { badge, banner, frame, neckLabel, qr, shield, type GenPart, type TextShaper } from '../model/generators';
import { segments } from '../model/shape';
import { loadFont, makeShaper } from '../platform/fontOutline';
import { listFonts } from '../platform/fonts';
import { Modal } from './Chrome';
import { ColorButton } from './ColorPicker';
import { useApp, useUi } from './hooks';

/** Vorlagen-Generatoren mit Live-Vorschau: Badge, Wappen, Banner, Rahmen, QR-Code, Nackendruck. */

type Kind = 'badge' | 'shield' | 'banner' | 'frame' | 'qr' | 'neck';

const KINDS: { id: Kind; label: string }[] = [
  { id: 'badge', label: 'Badge' },
  { id: 'shield', label: 'Wappen' },
  { id: 'banner', label: 'Banner' },
  { id: 'frame', label: 'Rahmen' },
  { id: 'qr', label: 'QR-Code' },
  { id: 'neck', label: 'Nackendruck' },
];

type Values = Record<string, string>;

const DEFAULTS: Record<Kind, Values> = {
  badge: { diameter: '80', ring: '16', top: 'SPORTVEREIN', bottom: 'SEIT 1920', center: 'SV', stars: '1', color: '#1f3a93', accent: '#ffffff' },
  shield: { width: '60', height: '72', border: '4', band: 'FC MUSTER', initials: '1920', color: '#c8102e', accent: '#ffffff' },
  banner: { width: '90', height: '18', text: 'CHAMPIONS', color: '#c8102e', shade: '#7b1e2b', textColor: '#ffffff' },
  frame: { width: '100', height: '60', radius: '8', line: '1.5', double: '1', color: '#1e2328' },
  qr: { text: 'https://example.com', size: '30', quiet: '2', level: 'M', color: '#1e2328' },
  neck: { brand: 'MARKE', size: 'M', lines: '100 % Baumwolle\n30 °C waschen\nHergestellt in Portugal', width: '50', color: '#ffffff', frame: '0' },
};

const FIELDS: Record<Kind, { key: string; label: string; unit?: string; kind?: 'text' | 'color' | 'check' | 'area' | 'choice'; options?: string[] }[]> = {
  badge: [
    { key: 'diameter', label: 'Durchmesser', unit: 'mm' },
    { key: 'ring', label: 'Ringbreite', unit: 'mm' },
    { key: 'top', label: 'Text oben', kind: 'text' },
    { key: 'bottom', label: 'Text unten', kind: 'text' },
    { key: 'center', label: 'Mitte', kind: 'text' },
    { key: 'stars', label: 'Sterne', kind: 'check' },
    { key: 'color', label: 'Farbe', kind: 'color' },
    { key: 'accent', label: 'Schrift', kind: 'color' },
  ],
  shield: [
    { key: 'width', label: 'Breite', unit: 'mm' },
    { key: 'height', label: 'Höhe', unit: 'mm' },
    { key: 'border', label: 'Rand', unit: 'mm' },
    { key: 'band', label: 'Bandtext', kind: 'text' },
    { key: 'initials', label: 'Unten', kind: 'text' },
    { key: 'color', label: 'Farbe', kind: 'color' },
    { key: 'accent', label: 'Akzent', kind: 'color' },
  ],
  banner: [
    { key: 'width', label: 'Breite', unit: 'mm' },
    { key: 'height', label: 'Höhe', unit: 'mm' },
    { key: 'text', label: 'Text', kind: 'text' },
    { key: 'color', label: 'Band', kind: 'color' },
    { key: 'shade', label: 'Umschlag', kind: 'color' },
    { key: 'textColor', label: 'Schrift', kind: 'color' },
  ],
  frame: [
    { key: 'width', label: 'Breite', unit: 'mm' },
    { key: 'height', label: 'Höhe', unit: 'mm' },
    { key: 'radius', label: 'Eckenradius', unit: 'mm' },
    { key: 'line', label: 'Linienstärke', unit: 'mm' },
    { key: 'double', label: 'Doppelte Linie', kind: 'check' },
    { key: 'color', label: 'Farbe', kind: 'color' },
  ],
  qr: [
    { key: 'text', label: 'Inhalt (Link, Text)', kind: 'text' },
    { key: 'size', label: 'Kantenlänge', unit: 'mm' },
    { key: 'quiet', label: 'Ruhezone', unit: 'Module' },
    { key: 'level', label: 'Fehlerkorrektur', kind: 'choice', options: ['L', 'M', 'Q', 'H'] },
    { key: 'color', label: 'Farbe', kind: 'color' },
  ],
  neck: [
    { key: 'brand', label: 'Marke', kind: 'text' },
    { key: 'size', label: 'Größe', kind: 'text' },
    { key: 'lines', label: 'Zeilen (Material, Pflege, Herkunft)', kind: 'area' },
    { key: 'width', label: 'Breite', unit: 'mm' },
    { key: 'frame', label: 'Rahmen', kind: 'check' },
    { key: 'color', label: 'Farbe', kind: 'color' },
  ],
};

const n = (v: string, d: number) => {
  const x = Number(String(v).replace(',', '.'));
  return Number.isFinite(x) && x > 0 ? x : d;
};

function build(kind: Kind, v: Values, shape: TextShaper | null): GenPart[] {
  if (kind === 'frame')
    return frame({ width: n(v.width, 100), height: n(v.height, 60), radius: Math.max(0, Number(v.radius.replace(',', '.')) || 0), line: n(v.line, 1.5), double: v.double === '1', color: v.color });
  if (kind === 'qr') return qr({ text: v.text, size: n(v.size, 30), quiet: Math.max(0, Math.round(Number(v.quiet) || 0)), level: (v.level as 'L' | 'M' | 'Q' | 'H') || 'M', color: v.color });
  if (!shape) return [];
  if (kind === 'badge')
    return badge({ diameter: n(v.diameter, 80), ring: n(v.ring, 16), top: v.top, bottom: v.bottom, center: v.center, stars: v.stars === '1', color: v.color, accent: v.accent }, shape);
  if (kind === 'shield') return shield({ width: n(v.width, 60), height: n(v.height, 72), border: n(v.border, 4), band: v.band, initials: v.initials, color: v.color, accent: v.accent }, shape);
  if (kind === 'banner') return banner({ width: n(v.width, 90), height: n(v.height, 18), text: v.text, color: v.color, shade: v.shade, textColor: v.textColor }, shape);
  return neckLabel({ brand: v.brand, size: v.size, lines: v.lines, width: n(v.width, 50), color: v.color, frame: v.frame === '1' }, shape);
}

export function GeneratorView() {
  const open = useUi((s) => s.generator);
  if (!open) return null;
  return <GeneratorInner />;
}

function GeneratorInner() {
  const app = useApp();
  const [kind, setKind] = useState<Kind>('badge');
  const [values, setValues] = useState<Record<Kind, Values>>(() => structuredClone(DEFAULTS));
  const [fontFamily, setFontFamily] = useState('Arial');
  const [bold, setBold] = useState(true);
  const [fonts, setFonts] = useState<string[]>([]);
  const [font, setFont] = useState<Font | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const close = () => app.ui.setState({ generator: false });
  const v = values[kind];
  const set = (k: string, x: string) => setValues((all) => ({ ...all, [kind]: { ...all[kind], [k]: x } }));

  useEffect(() => {
    void listFonts().then(setFonts);
  }, []);
  useEffect(() => {
    let alive = true;
    void loadFont(fontFamily, bold ? 700 : 400, false).then((f) => alive && setFont(f.font));
    return () => {
      alive = false;
    };
  }, [fontFamily, bold]);

  const parts = useMemo(() => {
    try {
      return build(kind, v, font ? makeShaper(font) : null);
    } catch {
      return [];
    }
  }, [kind, v, font]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const W = 420;
    const H = 300;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = kind === 'neck' ? '#2b2f36' : '#eef0f3';
    ctx.fillRect(0, 0, W, H);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of parts)
      for (const ct of p.contours)
        for (const q of ct.nodes) {
          minX = Math.min(minX, q.x);
          minY = Math.min(minY, q.y);
          maxX = Math.max(maxX, q.x);
          maxY = Math.max(maxY, q.y);
        }
    if (!Number.isFinite(minX)) return;
    const k = Math.min((W - 40) / (maxX - minX || 1), (H - 40) / (maxY - minY || 1));
    const T = (q: { x: number; y: number }) => ({ x: W / 2 + (q.x - (minX + maxX) / 2) * k, y: H / 2 - (q.y - (minY + maxY) / 2) * k });
    for (const p of parts) {
      ctx.beginPath();
      for (const ct of p.contours) {
        if (!ct.nodes.length) continue;
        const s0 = T(ct.nodes[0]);
        ctx.moveTo(s0.x, s0.y);
        for (const sg of segments(ct)) {
          const p3 = T(sg.p3);
          if (sg.curved) {
            const p1 = T(sg.p1);
            const p2 = T(sg.p2);
            ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
          } else ctx.lineTo(p3.x, p3.y);
        }
        if (ct.closed) ctx.closePath();
      }
      ctx.fillStyle = typeof p.style.fill === 'string' ? p.style.fill : '#000';
      ctx.fill(p.fillRule ?? 'nonzero');
    }
  }, [parts, kind]);

  const insert = () => {
    const label = `Vorlage: ${KINDS.find((x) => x.id === kind)!.label}`;
    const out = app.editor.insertParts(parts, label);
    if (!out.ok) {
      app.editor.toast(out.message, 'error');
      return;
    }
    app.editor.zoomToFit();
    close();
  };
  const needsFont = kind !== 'frame' && kind !== 'qr';
  const fontList = fonts.includes(fontFamily) ? fonts : [fontFamily, ...fonts];

  return (
    <Modal title="Vorlagen-Generator" onClose={close} testId="generator" wide>
      <div className="gen-body">
        <div className="gen-side">
          <div className="segmented" role="tablist" aria-label="Vorlage">
            {KINDS.map((x) => (
              <button key={x.id} className={kind === x.id ? 'on' : ''} onClick={() => setKind(x.id)} role="tab" aria-selected={kind === x.id} data-testid={`gen-${x.id}`}>
                {x.label}
              </button>
            ))}
          </div>
          <div className="gen-fields">
            {FIELDS[kind].map((f) => (
              <label key={f.key} className={`field ${f.kind === 'area' || f.kind === 'text' ? 'wide' : ''}`}>
                <span>
                  {f.label}
                  {f.unit ? ` (${f.unit})` : ''}
                </span>
                {f.kind === 'color' ? (
                  <ColorButton value={v[f.key]} label={f.label} onChange={(c) => set(f.key, c)} />
                ) : f.kind === 'check' ? (
                  <input type="checkbox" checked={v[f.key] === '1'} onChange={(e) => set(f.key, e.target.checked ? '1' : '0')} />
                ) : f.kind === 'area' ? (
                  <textarea rows={3} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.kind === 'choice' ? (
                  <select value={v[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                    {f.options!.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input type="text" inputMode={f.kind === 'text' ? undefined : 'decimal'} value={v[f.key]} onChange={(e) => set(f.key, e.target.value)} data-testid={`gen-field-${f.key}`} />
                )}
              </label>
            ))}
            {needsFont && (
              <>
                <label className="field">
                  <span>Schrift</span>
                  <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
                    {fontList.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="check">
                  <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} /> Fett
                </label>
              </>
            )}
          </div>
          {kind === 'qr' && (
            <p className="muted small">QR-Codes für den Druck mindestens 20 mm groß anlegen und mit kräftigem Kontrast zur Stofffarbe; zum Testen nach dem Einfügen mit dem Handy scannen.</p>
          )}
          {kind === 'neck' && <p className="muted small">Pflegesymbole sind geschützt und daher nicht eingebaut – Pflegehinweise als Text angeben.</p>}
        </div>
        <figure className="gen-preview">
          <canvas ref={canvasRef} aria-label="Vorschau" />
          <figcaption className="muted small">Wird als Gruppe aus Formen am Ursprung eingefügt; Texte sind in Pfade umgewandelt.</figcaption>
        </figure>
      </div>
      <div className="row end">
        <button className="btn" onClick={close}>
          Abbrechen
        </button>
        <button className="btn accent" onClick={insert} disabled={!parts.length} data-testid="gen-insert">
          <Plus size={15} /> Einfügen
        </button>
      </div>
    </Modal>
  );
}
