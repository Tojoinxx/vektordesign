import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { Id, SketchDoc } from '../model/types';
import { docBBox } from '../model/bounds';
import { drawDesign } from '../render/drawDesign';
import { aiSuggestions, localSuggestions, previewDoc, type StyleSuggestion } from '../design/suggestions';
import { loadApiKey, loadModel } from '../assistant/api';
import { useApp, useAppState } from './hooks';

function Thumb({ doc, only }: { doc: SketchDoc; only: Set<Id> }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 96;
    const H = 64;
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
    drawDesign({ ctx, toScreen: (p) => ({ x: ox + (p.x - box.minX) * s, y: oy + (box.maxY - p.y) * s }), scale: s, minStrokePx: 0.75 }, doc, { only });
  }, [doc, only]);
  return <canvas ref={ref} className="sugg-thumb" style={{ width: 96, height: 64 }} />;
}

/** Stilvorschläge für Auswahl oder ganzes Motiv. */
export function StyleSuggestions({ targets }: { targets: Id[] }) {
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

  if (!targets.length) return null;

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

  const grid = (list: StyleSuggestion[]) => (
    <div className="sugg-grid">
      {list.map((s) => (
        <button key={s.id} className="sugg" onClick={() => apply(s)} title={`Übernehmen: ${s.name}`} data-testid="suggestion">
          <Thumb doc={previewDoc(doc, s)} only={only} />
          <span>{s.name}</span>
        </button>
      ))}
    </div>
  );

  return (
    <section className="props-section" id="stilvorschlaege">
      <h4>Stilvorschläge</h4>
      <p className="muted small">{targets.length === 1 ? 'Für die Auswahl' : `Für ${targets.length} Objekte`} · Klick übernimmt, Strg+Z nimmt zurück</p>
      {ai.length > 0 && (
        <>
          <p className="sugg-label">
            <Sparkles size={13} /> Von Claude
          </p>
          {grid(ai)}
        </>
      )}
      {grid(local)}
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
    </section>
  );
}
