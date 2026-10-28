import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './styles/app.css';
import { createRoot } from 'react-dom/client';
import wasmUrl from '@salusoft89/planegcs/dist/planegcs_dist/planegcs.wasm?url';
import { AppController } from './ui/controller';
import { App } from './ui/App';
import { createSolver } from './solver/solver';
import { readAutosave, startAutosave } from './platform/autosave';
import { registerServiceWorker } from './platform/pwa';

const app = new AppController();
// Für Tests und Fehlersuche im Browser erreichbar
(window as unknown as { vektordesign: AppController }).vektordesign = app;

/** WebAssembly-Solver laden (bei eingebetteter Datei ohne Netzwerkzugriff). */
async function loadSolver() {
  const args: Record<string, unknown> = {};
  if (wasmUrl.startsWith('data:')) {
    const b64 = wasmUrl.slice(wasmUrl.indexOf(',') + 1);
    args.wasmBinary = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  } else args.locateFile = () => wasmUrl;
  return createSolver(args);
}

async function boot() {
  try {
    app.editor.attachSolver(await loadSolver());
  } catch (e) {
    console.error(e);
    app.editor.toast('Der Constraint-Solver konnte nicht geladen werden – Bemaßungen und Abhängigkeiten sind nicht verfügbar.', 'error', 15000);
  }
  const saved = await readAutosave();
  if (saved && Object.keys(saved.doc.entities).length) {
    app.editor.loadDocument(saved.doc, saved.fileName, saved.filePath);
    app.store.setState({ dirty: true });
    app.editor.toast('Letzte Sitzung wiederhergestellt.', 'info', 3000);
  }
  startAutosave(app.store);
}

createRoot(document.getElementById('root')!).render(<App app={app} />);
registerServiceWorker((apply) =>
  app.editor.confirm({
    title: 'Neue Version verfügbar',
    text: 'Eine neue Version von Vektordesign ist geladen. Jetzt neu starten? Deine Zeichnung bleibt erhalten (automatisch zwischengespeichert).',
    confirm: 'Jetzt neu starten',
    cancel: 'Später',
    onConfirm: apply,
  }),
);
void boot();
