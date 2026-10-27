import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SceneLayout } from '../render/renderer';
import { toScreen, type Viewport } from '../render/viewport';
import { pt } from '../model/doc';
import { useApp, useAppState, useUi } from './hooks';
import type { AppController } from './controller';

type AppControllerUi = AppController['ui'];

/** Direkte Werteingabe beim Zeichnen (Länge/Winkel, Breite/Höhe, Durchmesser). */
export function DynamicInput() {
  const app = useApp();
  const spec = useUi((s) => s.dynamic);
  const values = useUi((s) => s.dynValues);
  const focus = useUi((s) => s.dynFocus);
  const refs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    if (!focus) return;
    const el = refs.current[focus.key];
    if (!el) return;
    el.focus({ preventScroll: true });
    if (focus.char !== undefined) {
      const v = { ...app.ui.getState().dynValues, [focus.key]: focus.char };
      app.ui.setState({ dynValues: v });
      app.current.inputChanged?.(v);
    } else el.select();
  }, [focus, app]);

  if (!spec) return null;
  const keys = spec.fields.map((f) => f.key);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, key: string) => {
    e.stopPropagation();
    if (e.key === 'Tab') {
      e.preventDefault();
      const i = keys.indexOf(key);
      const next = keys[(i + (e.shiftKey ? keys.length - 1 : 1)) % keys.length];
      refs.current[next]?.focus();
      refs.current[next]?.select();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      app.current.submitInput?.(app.ui.getState().dynValues);
      // Fokus zurück zur Zeichenfläche, Werte sind verbraucht
      (document.querySelector('[data-testid="canvas-wrap"]') as HTMLElement | null)?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      app.ui.setState({ dynValues: {} });
      (e.target as HTMLInputElement).blur();
      app.escape();
    }
  };

  return (
    <div className="dyn-input" style={{ left: Math.round(spec.at.x), top: Math.round(spec.at.y) }} data-testid="dyn-input">
      {spec.fields.map((f) => (
        <label key={f.key} className={values[f.key] ? 'has-value' : ''}>
          <span>{f.label}</span>
          <input
            ref={(el) => {
              refs.current[f.key] = el;
            }}
            data-testid={`dyn-${f.key}`}
            inputMode="decimal"
            value={values[f.key] ?? ''}
            placeholder={f.live}
            onChange={(e) => {
              const v = { ...app.ui.getState().dynValues, [f.key]: e.target.value };
              app.ui.setState({ dynValues: v });
              app.current.inputChanged?.(v);
            }}
            onKeyDown={(e) => onKey(e, f.key)}
          />
          <em>{f.unit}</em>
        </label>
      ))}
    </div>
  );
}

/** Wert einer Bemaßung eingeben/ändern – erscheint direkt am Maß. */
export function DimensionEditor(props: { layout: () => SceneLayout | null; vp: () => Viewport }) {
  const prompt = useAppState((s) => s.dimPrompt);
  const exists = useAppState((s) => (s.dimPrompt ? !!s.doc.dims[s.dimPrompt.dimId] : false));
  if (!prompt || !exists) return null;
  // Neu einhängen je Bearbeitung: Startwert steht sofort im Feld, Markieren genau einmal
  return <DimensionEditorInner key={`${prompt.dimId}-${prompt.isNew}`} {...props} dimId={prompt.dimId} />;
}

function DimensionEditorInner({ layout, vp, dimId }: { layout: () => SceneLayout | null; vp: () => Viewport; dimId: string }) {
  const app = useApp();
  const dim = useAppState((s) => s.doc.dims[dimId]);
  useAppState((s) => s.view);
  const [value, setValue] = useState(() => app.store.getState().doc.dims[dimId]?.expr ?? '');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [, force] = useState(0);
  const closing = useRef(false);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    // Position steht erst nach dem nächsten Zeichnen fest
    const raf = requestAnimationFrame(() => force((n) => n + 1));
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!dim) return null;
  const box = layout()?.dims.find((d) => d.id === dimId)?.textBox;
  const v = vp();
  const x = box ? box.x + box.w / 2 : v.width / 2;
  const y = box ? box.y + box.h / 2 : v.height / 2;

  const close = () => {
    closing.current = true;
    app.store.setState({ dimPrompt: null });
    (document.querySelector('[data-testid="canvas-wrap"]') as HTMLElement | null)?.focus({ preventScroll: true });
  };
  const apply = () => {
    if (value.trim() === dim.expr) return close();
    const out = app.editor.setDimensionExpr(dim.id, value);
    if (out.ok) close();
    else setError(out.message);
  };

  return (
    <div className="dim-editor" style={{ left: Math.round(x), top: Math.round(y) }} data-testid="dim-editor">
      <div className="dim-editor-row">
        <span className="dim-name">{dim.name} =</span>
        <input
          ref={inputRef}
          data-testid="dim-input"
          value={value}
          inputMode="decimal"
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              apply();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
          onBlur={() => {
            if (closing.current) return;
            // Klick daneben übernimmt wie in Inventor, wenn der Wert gültig ist
            if (value.trim() !== dim.expr) {
              const out = app.editor.setDimensionExpr(dim.id, value);
              if (!out.ok) {
                setError(out.message);
                return;
              }
            }
            close();
          }}
          aria-label={`Wert für ${dim.name}`}
        />
        <span className="dim-unit">{dim.kind === 'angle' || dim.kind === 'angleX' ? '°' : 'mm'}</span>
      </div>
      {error ? <div className="dim-error">{error}</div> : <div className="dim-hint">Enter übernimmt · Ausdrücke wie 20+5 oder d0*2</div>}
    </div>
  );
}

/** Texteingabe direkt auf der Zeichenfläche. */
export function TextEditor({ vp }: { vp: () => Viewport }) {
  const st = useUi((s) => s.textEdit);
  if (!st) return null;
  return <TextEditorInner key={st.id ?? `neu-${st.at?.pos.x}-${st.at?.pos.y}`} vp={vp} st={st} />;
}

function TextEditorInner({ vp, st }: { vp: () => Viewport; st: NonNullable<ReturnType<AppControllerUi['getState']>['textEdit']> }) {
  const app = useApp();
  const doc = useAppState((s) => s.doc);
  useAppState((s) => s.view);
  const [value, setValue] = useState(() => {
    const e = st.id ? app.store.getState().doc.entities[st.id] : undefined;
    return e?.kind === 'text' ? e.text : '';
  });
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useLayoutEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.select();
  }, []);

  const e = st.id ? doc.entities[st.id] : undefined;
  const anchor = e?.kind === 'text' ? pt(doc, e.anchor) : st.at?.pos;
  if (!anchor) return null;
  const s = toScreen(vp(), anchor);
  const size = e?.kind === 'text' ? e.fontSize : app.store.getState().textDefaults.fontSize;
  const px = Math.max(14, Math.min(64, size * vp().zoom));

  const close = () => app.ui.setState({ textEdit: null });
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const text = value;
    if (st.id) {
      if (!text.trim()) app.editor.deleteIds([st.id]);
      else if (e?.kind === 'text' && text !== e.text) app.editor.setTextProps(st.id, { text });
    } else if (text.trim() && st.at) {
      const out = app.editor.createText(st.at, text);
      if (!out.ok) app.editor.toast(out.message, 'error');
      else if (out.textId) app.editor.select([out.textId]);
    }
    close();
  };

  return (
    <input
      ref={ref}
      className="text-editor"
      data-testid="text-input"
      style={{ left: Math.round(s.x), top: Math.round(s.y - px * 1.1), fontSize: px, fontFamily: e?.kind === 'text' ? e.fontFamily : app.store.getState().textDefaults.fontFamily }}
      value={value}
      placeholder="Text eingeben"
      onChange={(ev) => setValue(ev.target.value)}
      onKeyDown={(ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          done.current = true;
          close();
        }
      }}
      onBlur={commit}
    />
  );
}
