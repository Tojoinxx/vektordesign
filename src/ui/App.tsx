import { useEffect } from 'react';
import { Layers, Settings2, Shirt, Sparkles } from 'lucide-react';
import type { AppController } from './controller';
import { AppCtx, useUi } from './hooks';
import { CanvasView } from './CanvasView';
import { Ribbon } from './Ribbon';
import { PropertiesPanel } from './PropertiesPanel';
import { AssistantPanel } from './AssistantPanel';
import { LayersPanel } from './LayersPanel';
import { ProductionPanel, ProfileEditor } from './ProductionPanel';
import { PlacementView } from './PlacementView';
import { AboutDialog, CommandPalette, ConfirmDialog, ExportDialog, MeasureCard, PreflightCard, ParamDialog, ShareReadyDialog, SyncConflictDialog, StatusBar, Toasts, TopBar, TutorialCard, TutorialList } from './Chrome';
import { buildCommands, matchKey } from './commands';

function SidePanel({ app }: { app: AppController }) {
  const side = useUi((s) => s.side);
  return (
    <aside className="side" aria-label="Seitenleiste">
      <div className="side-tabs" role="tablist">
        <button role="tab" aria-selected={side === 'props'} className={side === 'props' ? 'on' : ''} onClick={() => app.ui.setState({ side: 'props' })} data-testid="tab-props" title="Eigenschaften">
          <Settings2 size={15} /> <span className="tab-label">Eigenschaften</span>
        </button>
        <button role="tab" aria-selected={side === 'layers'} className={side === 'layers' ? 'on' : ''} onClick={() => app.ui.setState({ side: 'layers' })} data-testid="tab-layers" title="Ebenen">
          <Layers size={15} /> <span className="tab-label">Ebenen</span>
        </button>
        <button role="tab" aria-selected={side === 'production'} className={side === 'production' ? 'on' : ''} onClick={() => app.ui.setState({ side: 'production' })} data-testid="tab-production" title="Produktion: Artikel, Platzierung, Varianten, Export für LabwearOS">
          <Shirt size={15} /> <span className="tab-label">Produktion</span>
        </button>
        <button
          role="tab"
          aria-selected={side === 'claude'}
          className={side === 'claude' ? 'on' : ''}
          onClick={() => {
            app.ui.setState({ side: 'claude' });
            app.showTutorialFor('claude');
          }}
          data-testid="tab-claude"
          title="Claude-Assistent"
        >
          <Sparkles size={15} /> <span className="tab-label">Claude</span>
        </button>
      </div>
      <div className="side-body">{side === 'props' ? <PropertiesPanel /> : side === 'layers' ? <LayersPanel /> : side === 'production' ? <ProductionPanel /> : <AssistantPanel />}</div>
    </aside>
  );
}

function Shell({ app }: { app: AppController }) {
  const sideOpen = useUi((s) => s.sideOpen);

  // Tastatur: Kürzel wie in Inventor, Zahlen starten die direkte Werteingabe
  useEffect(() => {
    const cmds = buildCommands();
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
      const s = app.store.getState();
      if (typing || s.paletteOpen || s.exportOpen || s.confirm || app.ui.getState().paramDialog || app.ui.getState().placement || app.ui.getState().profileEditor || app.ui.getState().syncConflict || app.ui.getState().shareReady) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        app.escape();
        return;
      }
      if (e.key === 'Enter' && app.current.finish) {
        e.preventDefault();
        app.current.finish();
        return;
      }
      const ui = app.ui.getState();
      if (ui.dynamic && !e.ctrlKey && !e.metaKey && !e.altKey && /^[0-9.,\-+*/()]$/.test(e.key)) {
        e.preventDefault();
        app.ui.setState({ dynFocus: { key: ui.dynamic.fields[0].key, n: Date.now(), char: e.key } });
        return;
      }
      if (app.current.keyDown?.(e)) {
        e.preventDefault();
        return;
      }
      for (const c of cmds) {
        for (const b of c.keys ?? []) {
          if (matchKey(e, b)) {
            e.preventDefault();
            c.run(app);
            return;
          }
        }
      }
    };
    // Einfügen: Bild aus der Zwischenablage → Vorlagenbild, sonst kopierte Objekte
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const s = app.store.getState();
      if (s.paletteOpen || s.exportOpen || s.confirm) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      e.preventDefault();
      if (file) {
        void file.arrayBuffer().then((b) => app.insertImage({ name: file.name || 'Bild aus Zwischenablage', data: new Uint8Array(b), mime: file.type }));
        return;
      }
      const out = app.editor.paste();
      if (!out.ok && out.message) app.editor.toast(out.message, 'error');
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('paste', onPaste);
    };
  }, [app]);

  // Fenstertitel
  useEffect(() => {
    const update = () => {
      const s = app.store.getState();
      document.title = `${s.fileName ?? 'Unbenannt'}${s.dirty ? ' •' : ''} – Vektordesign`;
    };
    update();
    return app.store.subscribe(update);
  }, [app]);

  useEffect(() => {
    const t = setTimeout(() => app.showTutorialFor('welcome'), 600);
    return () => clearTimeout(t);
  }, [app]);

  return (
    <div className={`app ${sideOpen ? 'with-side' : ''}`}>
      <TopBar />
      <Ribbon />
      <main className="main">
        <CanvasView />
        <TutorialCard />
        <MeasureCard />
        <PreflightCard />
        <Toasts />
      </main>
      {sideOpen && <SidePanel app={app} />}
      <StatusBar />
      <ExportDialog />
      <ParamDialog />
      <PlacementView />
      <SyncConflictDialog />
      <ShareReadyDialog />
      <ProfileEditor />
      <CommandPalette />
      <ConfirmDialog />
      <TutorialList />
      <AboutDialog />
    </div>
  );
}

export function App({ app }: { app: AppController }) {
  return (
    <AppCtx.Provider value={app}>
      <Shell app={app} />
    </AppCtx.Provider>
  );
}
