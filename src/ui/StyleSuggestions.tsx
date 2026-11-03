import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { Id, SketchDoc } from '../model/types';
import { docBBox } from '../model/bounds';
import { drawDesign } from '../render/drawDesign';
import { THEME } from '../render/theme';
import { aiSuggestions, localSuggestions, previewDoc, type StyleSuggestion } from '../design/suggestions';
import { loadApiKey, loadModel } from '../assistant/api';
import { useApp, useAppState, useUi } from './hooks';

function Thumb({ doc, only }: { doc: SketchDoc; only: Set<Id> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Neu zeichnen, wenn die Zeichenfläche hell/dunkel umschaltet (Hilfsumriss passt sich an)
  const appearance = useUi((s) => s.appearance);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 120;
    const H = 80;
    c.width = W * dpr;
    c.height = H * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const box = docBBox(doc, { only });
    if (!box) return;
    const w = Math.max(box.maxX - box.minX, 0.1);
    const h = Math.max(box.maxY - box.minY, 0.1);
    const s = Math.min((W - 12) / w, (H - 12) / h);
    const ox = (W - w * s) / 2;
    const oy = (H - h * s) / 2;
    drawDesign(
      {
        ctx,
        toScreen: (p) => ({ x: ox + (p.x - box.minX) * s, y: oy + (box.maxY - p.y) * s }),
        scale: s,
        minStrokePx: 0.75,
        design: true,
        contrast: { background: THEME.paper, hint: THEME.contrastHint },
      },
      doc,
      { only },
    );
  }, [doc, only, appearance]);
  return <canvas ref={ref} className="sugg-thumb" />;
}

/** Stilvorschläge für Auswahl oder ganzes Motiv. */
const OPEN_KEY = 'vd.suggestions.open';
function loadOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return true;
  }
}

/** Stilvorschläge – einklappbar; eingeklappt wird nichts berechnet. */
export function StyleSuggestions(p: { targets: Id[]; whole?: boolean }) {
  const [open, setOpen] = useState(loadOpen);
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1');
      } catch {
        /* egal */
      }
      return !o;
    });
  };
  if (!p.targets.length) return null;
  return (
    <section className="props-section" id="stilvorschlaege">
      <button className="section-toggle" onClick={toggle} aria-expanded={open} data-testid="suggestions-toggle">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <h4>Stilvorschläge</h4>
      </button>
      {open && <SuggestionsBody targets={p.targets} whole={p.whole} />}
    </section>
  );
}

function SuggestionsBody({ targets, whole = false }: { targets: Id[]; whole?: boolean }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  const [ai, setAi] = useState<StyleSuggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const key = targets.join(',');
  // Stile der Ziele als Schlüssel: Vorschläge nur bei Stil-/Zieländerung neu berechnen
  const styleKey = targets.map((id) => JSON.stringify(doc.entities[id]?.style)).join('|');
  const only = useMemo(() => new Set(targets), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const local = useMemo(() => localSuggestions(doc, targets), [key, styleKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setAi([]);
    setErr(null);
  }, [key]);
  // Vorschau-Dokumente nur neu bauen, wenn sich Ziele, Stile oder Vorschläge ändern
  const localPreviews = useMemo(() => local.map((s) => previewDoc(doc, s)), [local, doc]);
  const aiPreviews = useMemo(() => ai.map((s) => previewDoc(doc, s)), [ai, doc]);

  const apply = (s: StyleSuggestion) => {
    const out = app.editor.setStyles(s.styles, `Stilvorschlag „${s.name}“`);
    if (!out.ok) app.editor.toast(out.message, 'error');
  };

  const askClaude = async () => {
    const apiKey = loadApiKey();
    if (!apiKey) {
      app.ui.setState({ side: 'claude', sideOpen: true });
      app.editor.toast('Für KI-Vorschläge im Claude-Tab einen API-Schlüssel hinterlegen.', 'info', 5000);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      setAi(await aiSuggestions(doc, targets, keyword, apiKey, loadModel()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const grid = (list: StyleSuggestion[], previews: SketchDoc[]) => (
    <div className="sugg-grid">
      {list.map((s, i) => (
        <button key={s.id} className="sugg" onClick={() => apply(s)} title={`Übernehmen: ${s.name}`} data-testid="suggestion">
          <Thumb doc={previews[i]} only={only} />
          <span>{s.name}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <p className="muted small">
        {whole ? `Für das ganze Motiv (${targets.length} Objekt${targets.length === 1 ? '' : 'e'})` : targets.length === 1 ? 'Für die Auswahl' : `Für ${targets.length} ausgewählte Objekte`} · Klick
        übernimmt, Strg+Z nimmt zurück
      </p>
      {ai.length > 0 && (
        <>
          <p className="sugg-label">
            <Sparkles size={13} /> Von Claude
          </p>
          {grid(ai, aiPreviews)}
        </>
      )}
      {grid(local, localPreviews)}
      <div className="sugg-ai">
        <input
          value={keyword}
          placeholder="Stichwort, z. B. Vintage, Neon"
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') void askClaude();
          }}
          aria-label="Stichwort für KI-Vorschläge"
        />
        <button className="btn accent" onClick={() => void askClaude()} disabled={busy}>
          <Sparkles size={15} /> {busy ? 'Claude denkt …' : 'KI-Vorschläge'}
        </button>
      </div>
      {err && <p className="error-text">{err}</p>}
    </>
  );
}
