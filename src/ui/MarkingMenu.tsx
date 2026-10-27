import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Copy, Lock, Maximize, Palette, RotateCcw, Trash2, ArrowUpToLine, ArrowDownToLine } from 'lucide-react';
import type { AppController } from './controller';
import { useApp, useAppState, useUi } from './hooks';
import { IconCircle, IconConstruction, IconDimension, IconGradient, IconLine, IconRect, IconText } from './icons';

interface Item {
  label: string;
  icon?: ReactNode;
  run: (app: AppController) => void;
  disabled?: boolean;
}

/** Feste Richtungen wie in Inventors Markierungsmenü (N, NO, O, SO, S, SW, W, NW). */
const RADIAL: Item[] = [
  { label: 'Linie', icon: <IconLine size={18} />, run: (a) => a.setTool('line') },
  { label: 'Kreis', icon: <IconCircle size={18} />, run: (a) => a.setTool('circle') },
  { label: 'Rechteck', icon: <IconRect size={18} />, run: (a) => a.setTool('rect') },
  { label: 'Text', icon: <IconText size={18} />, run: (a) => a.setTool('text') },
  { label: 'Bemaßung', icon: <IconDimension size={18} />, run: (a) => a.setTool('dimension') },
  { label: 'Verlauf', icon: <IconGradient size={18} />, run: (a) => a.setTool('gradient') },
  { label: 'Rückgängig', icon: <RotateCcw size={18} />, run: (a) => void a.editor.undo() },
  { label: 'Alles anzeigen', icon: <Maximize size={18} />, run: (a) => a.editor.zoomToFit() },
];

/** Geste: rechte Maustaste gedrückt halten und in eine Richtung ziehen. */
export function markingDirectionCommand(app: AppController, dx: number, dy: number): void {
  // Winkel: N = oben (Bildschirm-Y nach unten)
  const ang = Math.atan2(dx, -dy);
  const idx = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  RADIAL[idx].run(app);
}

function contextItems(app: AppController): Item[] {
  const s = app.store.getState();
  const sel = s.selection;
  const items: Item[] = [];
  if (s.tool !== 'select') {
    items.push({ label: 'Fertig (Esc)', run: (a) => a.setTool('select') });
  }
  const dim = sel.length === 1 ? s.doc.dims[sel[0]] : undefined;
  if (dim) {
    if (!dim.driven) items.push({ label: `${dim.name} ändern …`, run: (a) => a.store.setState({ dimPrompt: { dimId: dim.id, isNew: false } }) });
    items.push({
      label: dim.driven ? 'Treibend machen' : 'Getrieben machen (Referenz)',
      run: (a) => {
        const out = a.editor.setDimensionDriven(dim.id, !dim.driven);
        if (!out.ok) a.editor.toast(out.message, 'error');
      },
    });
    if (dim.kind === 'radius' || dim.kind === 'diameter') items.push({ label: dim.kind === 'radius' ? 'Als Durchmesser' : 'Als Radius', run: (a) => void a.editor.toggleRadiusDiameter(dim.id) });
  }
  if (sel.length) {
    items.push({ label: 'Duplizieren', icon: <Copy size={15} />, run: (a) => void a.editor.duplicate() });
    items.push({ label: 'Konstruktion ein/aus', icon: <IconConstruction size={15} />, run: (a) => void a.editor.toggleConstruction(a.editor.s.selection) });
    items.push({ label: 'Fixieren', icon: <Lock size={15} />, run: (a) => a.constraintCommand('fix') });
    items.push({ label: 'Ganz nach vorne', icon: <ArrowUpToLine size={15} />, run: (a) => void a.editor.arrange(a.editor.s.selection, 'front') });
    items.push({ label: 'Ganz nach hinten', icon: <ArrowDownToLine size={15} />, run: (a) => void a.editor.arrange(a.editor.s.selection, 'back') });
    items.push({ label: 'Stilvorschläge', icon: <Palette size={15} />, run: (a) => a.ui.setState({ side: 'props', sideOpen: true }) });
    items.push({ label: 'Löschen', icon: <Trash2 size={15} />, run: (a) => void a.editor.deleteSelection() });
  } else {
    items.push({ label: 'Alle Abhängigkeiten anzeigen (F8)', run: (a) => a.store.setState({ settings: { ...a.store.getState().settings, showGlyphs: true } }) });
    items.push({ label: 'Abhängigkeiten ausblenden (F9)', run: (a) => a.store.setState({ settings: { ...a.store.getState().settings, showGlyphs: false } }) });
  }
  return items;
}

export function MarkingMenu() {
  const app = useApp();
  const at = useUi((s) => s.marking);
  useAppState((s) => s.selection);

  useEffect(() => {
    if (!at) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') app.ui.setState({ marking: null });
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [at, app]);

  if (!at) return null;
  const R = 92;
  // Menü vollständig in der Zeichenfläche halten
  const host = document.querySelector('[data-testid="canvas-wrap"]')?.getBoundingClientRect();
  const W = host?.width ?? 1000;
  const H = host?.height ?? 800;
  const pos = { x: Math.min(Math.max(at.x, R + 80), W - R - 80), y: Math.min(Math.max(at.y, R + 26), H - R - 26 - 34 * 4) };
  const run = (it: Item) => {
    app.ui.setState({ marking: null });
    it.run(app);
  };
  const ctx = contextItems(app);
  return (
    <div className="marking-layer" onPointerDown={() => app.ui.setState({ marking: null })} onContextMenu={(e) => e.preventDefault()}>
      <div className="marking" style={{ left: pos.x, top: pos.y }} onPointerDown={(e) => e.stopPropagation()} role="menu" aria-label="Markierungsmenü">
        <div className="marking-center" />
        {RADIAL.map((it, i) => {
          const a = (i * Math.PI) / 4;
          const x = Math.sin(a) * R;
          const y = -Math.cos(a) * R;
          return (
            <button key={it.label} role="menuitem" className="marking-item" style={{ transform: `translate(calc(${x}px - 50%), calc(${y}px - 50%))` }} onClick={() => run(it)}>
              {it.icon}
              <span>{it.label}</span>
            </button>
          );
        })}
        {ctx.length > 0 && (
          <div className="marking-list" style={{ top: R + 34 }}>
            {ctx.map((it) => (
              <button key={it.label} role="menuitem" onClick={() => run(it)} disabled={it.disabled}>
                {it.icon}
                <span>{it.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
