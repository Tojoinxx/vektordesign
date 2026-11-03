import { lazy, Suspense, useCallback, useRef } from 'react';
import { useApp, useAppState, useUi } from './hooks';
import { resolveTheme } from './appearance';
import { setAvatar, setPieceLook, updateMaterial } from '../store/patternOps';

const ViewerPanel = lazy(() => import('../viewer3d/ViewerPanel'));

/**
 * 3D-Vorschau rechts neben der Zeichenfläche: zeigt das Kleidungsstück live, während man zeichnet,
 * bemaßt und Kanten verbindet. three.js wird erst beim Öffnen geladen.
 */
export function Preview3D() {
  const app = useApp();
  const open = useUi((s) => s.preview3d);
  const width = useUi((s) => s.preview3dWidth);
  const theme = useUi((s) => s.appearance.theme);
  const doc = useAppState((s) => (open ? s.doc : null));
  const selection = useAppState((s) => s.selection);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const selected = doc?.pattern?.pieces.find((p) => selection.includes(p.outline))?.id ?? null;
  const ed = app.editor;
  const onSelect = useCallback(
    (id: string | null) => {
      const pc = id ? ed.s.doc.pattern?.pieces.find((p) => p.id === id) : null;
      ed.select(pc ? [pc.outline] : []);
      if (pc) app.ui.setState({ side: 'pattern', sideOpen: true });
    },
    [app, ed],
  );
  if (!open || !doc) return null;
  return (
    <section className="preview3d" style={{ width }} aria-label="3D-Vorschau" data-testid="preview3d">
      <div
        className="preview3d-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Breite der 3D-Vorschau"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, w: width };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const w = Math.max(280, Math.min(window.innerWidth * 0.7, drag.current.w - (e.clientX - drag.current.x)));
          app.ui.setState({ preview3dWidth: w });
        }}
        onPointerUp={() => {
          drag.current = null;
          try {
            localStorage.setItem('vd.preview3dWidth', String(Math.round(app.ui.getState().preview3dWidth)));
          } catch {
            /* egal */
          }
        }}
      />
      <Suspense fallback={<div className="viewer3d loading muted small">3D wird geladen …</div>}>
        <ViewerPanel
          doc={doc}
          dark={resolveTheme(theme) === 'dark'}
          selected={selected}
          onSelect={onSelect}
          onPieceLook={(id, patch) => {
            const out = setPieceLook(ed, id, patch);
            if (!out.ok && out.message) ed.toast(out.message, 'error');
          }}
          onMaterial={(id, patch) => void updateMaterial(ed, id, patch)}
          onAvatar={(a) => void setAvatar(ed, a)}
          onSnapshot={(url) => void app.saveSnapshot3D(url)}
          onClose={() => app.ui.setState({ preview3d: false })}
          onPopOut={() => app.openWindow3D()}
        />
      </Suspense>
    </section>
  );
}
