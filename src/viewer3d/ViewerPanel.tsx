import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ExternalLink, Eye, EyeOff, Gauge, Loader2, Palette, PersonStanding, RotateCcw, Shirt, X } from 'lucide-react';
import type { Id, PatternAvatar, PatternMaterial, SketchDoc } from '../model/types';
import { HEIGHT_RANGE, avatarBody, buildLabel, defaultAvatar, genderOfSize, sizesFor } from '../sim3d/avatar';
import { bodyForSize } from '../pattern/body';
import { productionOf } from '../model/production';
import { FABRICS } from '../store/patternOps';
import { ColorButton } from '../ui/ColorPicker';
import { DEFAULT_SKIN, GarmentViewer, type CameraView, type ViewMode, type ViewerStatus } from './viewer';

const SKINS = [
  { hex: '#f2d3bf', name: 'Hell' },
  { hex: DEFAULT_SKIN, name: 'Mittel' },
  { hex: '#b9805c', name: 'Oliv' },
  { hex: '#8a5a3e', name: 'Dunkel' },
  { hex: '#5a3826', name: 'Sehr dunkel' },
  { hex: '#d8d2c8', name: 'Schneiderpuppe (neutral)' },
];
import type { MaterialPatch, PieceLookPatch } from '../pattern/edit';

/**
 * 3D-Ansicht als Bedienfeld: Werkzeugleiste (Aussehen/Passform, Puppe, Ansichten, Variante, Bild),
 * Statuszeile und – bei angeklicktem Teil – Farbe und Stoff dieses Teils.
 * Wird rechts im Hauptprogramm und als ganzes Fenster in „Vektordesign 3D“ benutzt.
 */

export interface ViewerPanelProps {
  doc: SketchDoc;
  dark: boolean;
  selected: Id | null;
  onSelect: (pieceId: Id | null) => void;
  onPieceLook: (pieceId: Id, patch: PieceLookPatch) => void;
  onMaterial: (materialId: Id, patch: MaterialPatch) => void;
  /** Puppe ändern (null = Körpermaße des Schnitts) */
  onAvatar: (avatar: PatternAvatar | null) => void;
  onSnapshot: (dataUrl: string) => void;
  onClose?: () => void;
  onPopOut?: () => void;
  /** Großes Fenster: Stoffliste dauerhaft zeigen */
  full?: boolean;
}

const fmt = (n: number, d = 1) => n.toLocaleString('de-DE', { maximumFractionDigits: d, minimumFractionDigits: d });

export default function ViewerPanel(p: ViewerPanelProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const viewer = useRef<GarmentViewer | null>(null);
  const [status, setStatus] = useState<ViewerStatus | null>(null);
  const [mode, setMode] = useState<ViewMode>('look');
  const [body, setBody] = useState(true);
  const [variant, setVariant] = useState<string | null>(null);
  const [quality, setQuality] = useState<'preview' | 'high'>('preview');
  const [hoodUp, setHoodUp] = useState(false);
  const [glError, setGlError] = useState<string | null>(null);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const onSelect = useRef(p.onSelect);
  onSelect.current = p.onSelect;

  useEffect(() => {
    if (!host.current) return;
    try {
      viewer.current = new GarmentViewer(host.current, { onStatus: setStatus, onPick: (id) => onSelect.current(id) });
    } catch (e) {
      setGlError(e instanceof Error ? e.message : String(e));
      return;
    }
    (window as unknown as { vektordesign3d?: GarmentViewer }).vektordesign3d = viewer.current;
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, []);
  useEffect(() => viewer.current?.setOptions({ dark: p.dark }), [p.dark]);
  useEffect(() => viewer.current?.setDoc(p.doc), [p.doc]);
  useEffect(() => viewer.current?.select(p.selected), [p.selected]);
  useEffect(() => viewer.current?.setOptions({ mode, showBody: body, variantId: variant, quality, hoodUp }), [mode, body, variant, quality, hoodUp]);

  const pattern = p.doc.pattern;
  const variants = useMemo(() => productionOf(p.doc).variants, [p.doc]);
  const piece = pattern?.pieces.find((x) => x.id === p.selected) ?? null;
  const pieceMat = piece ? pattern?.materials.find((m) => m.id === piece.material) : undefined;
  const view = (v: CameraView) => viewer.current?.view(v);

  let line: string;
  if (glError) line = '3D wird auf diesem Gerät nicht unterstützt (WebGL fehlt).';
  else if (!status || status.state === 'empty') line = status?.message ?? 'Lädt …';
  else if (status.state === 'error') line = `Fehler: ${status.message}`;
  else if (status.state === 'simulating') line = `Stoff fällt … ${fmt(status.stats?.time ?? 0)} s`;
  else {
    const gap = status.stats?.seamGap ?? 0;
    line = `Fertig · ${status.parts} Teile · Nähte ${gap < 8 ? 'geschlossen' : `bis ${fmt(gap, 0)} mm offen`}`;
  }

  return (
    <div className={`viewer3d ${p.full ? 'full' : ''}`} data-testid="viewer3d">
      <div className="v3-bar" role="toolbar" aria-label="3D-Ansicht">
        <div className="seg" role="radiogroup" aria-label="Darstellung">
          <button className={mode === 'look' ? 'on' : ''} onClick={() => setMode('look')} title="Aussehen: Farben, Stoffe, Motive" data-testid="v3-look">
            <Shirt size={15} /> <span className="lbl">Aussehen</span>
          </button>
          <button className={mode === 'fit' ? 'on' : ''} onClick={() => setMode('fit')} title="Passform-Karte: wo es spannt, anliegt oder locker sitzt" data-testid="v3-fit">
            <Gauge size={15} /> <span className="lbl">Passform</span>
          </button>
        </div>
        <span className="sep" />
        <button className="icon-btn" onClick={() => view('front')} title="Vorderansicht" aria-label="Vorderansicht">
          V
        </button>
        <button className="icon-btn" onClick={() => view('back')} title="Rückansicht" aria-label="Rückansicht">
          R
        </button>
        <button className="icon-btn" onClick={() => view('left')} title="Seitenansicht" aria-label="Seitenansicht">
          S
        </button>
        <button className="icon-btn" onClick={() => view('free')} title="Schräg von vorne" aria-label="Schräg von vorne">
          ¾
        </button>
        <span className="sep" />
        <button
          className={`icon-btn ${avatarOpen ? 'on' : ''}`}
          onClick={() => setAvatarOpen((o) => !o)}
          title="Puppe: männlich/weiblich, Körpergröße, Körperbau"
          aria-label="Puppe einstellen"
          data-testid="v3-avatar"
        >
          <PersonStanding size={16} />
        </button>
        <button className={`icon-btn ${body ? '' : 'on'}`} onClick={() => setBody((b) => !b)} title={body ? 'Puppe ausblenden' : 'Puppe einblenden'} aria-label="Puppe ein/aus" data-testid="v3-body">
          {body ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
        <button className="icon-btn" onClick={() => viewer.current?.resimulate()} title="Neu drapieren" aria-label="Neu drapieren" data-testid="v3-resim">
          <RotateCcw size={16} />
        </button>
        <button
          className="icon-btn"
          onClick={() => {
            const url = viewer.current?.snapshot(2);
            if (url) p.onSnapshot(url);
          }}
          title="Bild speichern (PNG)"
          aria-label="Bild speichern"
          data-testid="v3-snapshot"
        >
          <Camera size={16} />
        </button>
        <span className="spacer" />
        {p.onPopOut && (
          <button className="icon-btn" onClick={p.onPopOut} title="In Vektordesign 3D öffnen (eigenes Fenster)" aria-label="In eigenem Fenster öffnen" data-testid="v3-popout">
            <ExternalLink size={16} />
          </button>
        )}
        {p.onClose && (
          <button className="icon-btn" onClick={p.onClose} title="3D-Vorschau schließen" aria-label="3D-Vorschau schließen" data-testid="v3-close">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="v3-stage">
        <div className="v3-canvas" ref={host} />
        <div className={`v3-status ${status?.state ?? ''}`} data-testid="v3-status" data-state={status?.state ?? 'loading'}>
          {status?.state === 'simulating' && <Loader2 size={13} className="spin" />} {line}
        </div>
        {mode === 'fit' && (
          <div className="v3-legend" aria-label="Legende Passform">
            <span>
              <i style={{ background: '#d7263d' }} /> spannt
            </span>
            <span>
              <i style={{ background: '#f4c430' }} /> leicht gedehnt
            </span>
            <span>
              <i style={{ background: '#3aa76d' }} /> liegt an
            </span>
            <span>
              <i style={{ background: '#3d7bd9' }} /> locker
            </span>
          </div>
        )}
        {variants.length > 1 && (
          <select className="v3-variant" value={variant ?? ''} onChange={(e) => setVariant(e.target.value || null)} aria-label="Farbvariante" data-testid="v3-variant">
            <option value="">Originalfarben</option>
            {variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        )}
        {avatarOpen && <AvatarControls doc={p.doc} onAvatar={p.onAvatar} onClose={() => setAvatarOpen(false)} />}
        <div className="v3-toggles">
          {pattern?.pieces.some((x) => x.role === 'hood') && (
            <label className="check small" title="Kapuze aufsetzen oder auf dem Rücken ablegen">
              <input type="checkbox" checked={hoodUp} onChange={(e) => setHoodUp(e.target.checked)} data-testid="v3-hood-up" /> Kapuze auf
            </label>
          )}
          <label className="check small">
            <input type="checkbox" checked={quality === 'high'} onChange={(e) => setQuality(e.target.checked ? 'high' : 'preview')} /> Fein
          </label>
        </div>
      </div>

      {piece && pattern && (
        <div className="v3-piece" data-testid="v3-piece">
          <div className="row">
            <Palette size={15} />
            <strong className="spacer">{piece.name}</strong>
            <button className="icon-btn" onClick={() => p.onSelect(null)} aria-label="Auswahl aufheben" title="Auswahl aufheben">
              <X size={15} />
            </button>
          </div>
          <div className="form-grid">
            <span>Farbe</span>
            <span className="row">
              <ColorButton value={piece.color ?? pieceMat?.color ?? '#888888'} label={`Farbe ${piece.name}`} onChange={(c) => p.onPieceLook(piece.id, { color: c })} testId="v3-piece-color" />
              {piece.color ? (
                <button className="link-btn small" onClick={() => p.onPieceLook(piece.id, { color: null })}>
                  wie Stoff
                </button>
              ) : (
                <span className="muted small">vom Stoff</span>
              )}
            </span>
            <span>Stoff</span>
            <select value={piece.material ?? ''} onChange={(e) => p.onPieceLook(piece.id, { material: e.target.value })} aria-label="Stoff des Teils" data-testid="v3-piece-material">
              {pattern.materials.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {pieceMat && (
              <>
                <span>Stoffart</span>
                <FabricSelect m={pieceMat} onChange={(patch) => p.onMaterial(pieceMat.id, patch)} />
                <span>Gewicht</span>
                <GsmSlider m={pieceMat} onChange={(gsm) => p.onMaterial(pieceMat.id, { gsm })} />
              </>
            )}
          </div>
        </div>
      )}
      {!piece && pattern?.pieces.length ? <p className="v3-hint muted small">Tipp: ein Teil anklicken, um es einzufärben oder einen anderen Stoff zu wählen.</p> : null}
    </div>
  );
}

export function FabricSelect({ m, onChange }: { m: PatternMaterial; onChange: (patch: MaterialPatch) => void }) {
  return (
    <select
      value={m.fabric}
      aria-label="Stoffart"
      onChange={(e) => {
        const f = FABRICS.find((x) => x.id === e.target.value)!;
        onChange({ fabric: f.id, gsm: f.gsm });
      }}
    >
      {FABRICS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

/** Puppe einstellen: Geschlecht, Ausgangsgröße, Körpergröße und Körperbau (Regler). */
function AvatarControls({ doc, onAvatar, onClose }: { doc: SketchDoc; onAvatar: (a: PatternAvatar | null) => void; onClose: () => void }) {
  const pat = doc.pattern;
  const current: PatternAvatar =
    pat?.avatar ??
    (() => {
      const g = genderOfSize(pat?.bodySize ?? 'H-M');
      const base = pat?.bodySize && pat.bodySize !== 'custom' ? pat.bodySize : defaultAvatar(g).base;
      return { gender: g, base, height: pat?.body.height ?? bodyForSize(base).height, build: 0 };
    })();
  const [draft, setDraft] = useState<PatternAvatar>(current);
  const key = JSON.stringify(current);
  useEffect(() => setDraft(JSON.parse(key) as PatternAvatar), [key]);
  const commit = (a: PatternAvatar) => {
    if (JSON.stringify(a) !== key || !pat?.avatar) onAvatar(a);
  };
  const b = avatarBody(draft);
  const cm = (v: number) => Math.round(v / 10);
  return (
    <div className="v3-avatar" data-testid="v3-avatar-panel" onKeyDown={(e) => e.stopPropagation()}>
      <div className="row">
        <strong className="spacer">Puppe</strong>
        <button className="icon-btn" onClick={onClose} aria-label="Schließen">
          <X size={15} />
        </button>
      </div>
      <div className="seg wide" role="radiogroup" aria-label="Geschlecht">
        {(['female', 'male'] as const).map((g) => (
          <button
            key={g}
            className={draft.gender === g ? 'on' : ''}
            data-testid={`v3-gender-${g}`}
            onClick={() => {
              const d = defaultAvatar(g);
              const next = { ...d, build: draft.build };
              setDraft(next);
              commit(next);
            }}
          >
            {g === 'female' ? 'Weiblich' : 'Männlich'}
          </button>
        ))}
      </div>
      <label className="v3-field">
        <span>Ausgangsgröße</span>
        <select
          value={draft.base}
          aria-label="Ausgangsgröße"
          onChange={(e) => {
            const next = { ...draft, base: e.target.value, height: bodyForSize(e.target.value).height };
            setDraft(next);
            commit(next);
          }}
        >
          {sizesFor(draft.gender).map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label className="v3-field">
        <span>
          Körpergröße <b>{cm(draft.height)} cm</b>
        </span>
        <input
          type="range"
          min={HEIGHT_RANGE.min}
          max={HEIGHT_RANGE.max}
          step={10}
          value={draft.height}
          data-testid="v3-height"
          onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) })}
          onPointerUp={() => commit(draft)}
          onKeyUp={() => commit(draft)}
        />
      </label>
      <label className="v3-field">
        <span>
          Körperbau <b>{buildLabel(draft.build)}</b>
        </span>
        <input
          type="range"
          min={-1}
          max={1}
          step={0.05}
          value={draft.build}
          data-testid="v3-build"
          onChange={(e) => setDraft({ ...draft, build: Number(e.target.value) })}
          onPointerUp={() => commit(draft)}
          onKeyUp={() => commit(draft)}
        />
      </label>
      <div className="v3-field">
        <span>Hautton</span>
        <span className="skin-row" role="radiogroup" aria-label="Hautton">
          {SKINS.map((c) => (
            <button
              key={c.hex}
              className={`skin ${(draft.skin ?? DEFAULT_SKIN) === c.hex ? 'on' : ''}`}
              style={{ background: c.hex }}
              title={c.name}
              aria-label={c.name}
              onClick={() => {
                const next = { ...draft, skin: c.hex };
                setDraft(next);
                commit(next);
              }}
            />
          ))}
        </span>
      </div>
      <p className="muted small">
        Brust {cm(b.chest)} · Taille {cm(b.waist)} · Hüfte {cm(b.hip)} cm
      </p>
      {pat?.avatar && (
        <button className="link-btn small" onClick={() => onAvatar(null)} title="Puppe wieder mit den Körpermaßen des Schnitts">
          Maße wie Schnitt
        </button>
      )}
    </div>
  );
}

/** Flächengewicht per Regler (80–600 g/m²): schwerer Stoff hängt anders, steht steifer ab, trägt dicker auf. */
export function GsmSlider({ m, onChange }: { m: PatternMaterial; onChange: (gsm: number) => void }) {
  const [v, setV] = useState(m.gsm);
  useEffect(() => setV(m.gsm), [m.gsm]);
  const commit = () => v !== m.gsm && onChange(v);
  const label = v < 160 ? 'leicht' : v < 260 ? 'mittel' : v < 380 ? 'schwer' : 'sehr schwer';
  return (
    <span className="gsm-slider">
      <input
        type="range"
        min={80}
        max={600}
        step={10}
        value={v}
        aria-label={`Flächengewicht ${m.name}`}
        data-testid="v3-gsm"
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
      <span className="small">
        <b>{v} g/m²</b> <span className="muted">{label}</span>
      </span>
    </span>
  );
}
