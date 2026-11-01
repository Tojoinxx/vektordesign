import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, FolderOpen, Link2, Link2Off, Save, Scissors } from 'lucide-react';
import type { Id, SketchDoc } from '../model/types';
import { parseDoc, serializeDoc } from '../model/serialize';
import { openFile, PNG_TYPE, PROJECT_TYPE, safeName, saveFile } from '../platform/files';
import { readAutosave } from '../platform/autosave';
import { applyMaterial, applyPieceLook, type MaterialPatch, type PieceLookPatch } from '../pattern/edit';
import { openChannel, type BridgeMessage } from '../viewer3d/bridge';
import ViewerPanel, { FabricSelect } from '../viewer3d/ViewerPanel';
import { ColorButton } from '../ui/ColorPicker';
import { ROLE_NAMES, sizeName } from '../store/patternOps';
import { loadAppearance, resolveTheme, applyAppearance } from '../ui/appearance';

/**
 * Vektordesign 3D: eigenes Fenster für die Visualisierung. Verbindet sich automatisch mit einem offenen
 * Vektordesign (live), öffnet sonst die zuletzt bearbeitete Zeichnung oder eine .vdp-Datei.
 */

type Source = 'live' | 'autosave' | 'file' | 'none';

export function App3D() {
  const [doc, setDoc] = useState<SketchDoc | null>(null);
  const [name, setName] = useState('Unbenannt');
  const [source, setSource] = useState<Source>('none');
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<Id | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const chan = useRef<ReturnType<typeof openChannel>>(null);
  const live = useRef(false);
  const dark = resolveTheme(loadAppearance().theme) === 'dark';

  const say = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((x) => (x === t ? null : x)), 3500);
  };

  useEffect(() => {
    applyAppearance(loadAppearance());
    const c = openChannel((m: BridgeMessage) => {
      if (m.type === 'doc') {
        live.current = true;
        setSource('live');
        setDoc(m.doc);
        setName(m.name);
        setSelected(m.selected);
        setDirty(false);
      } else if (m.type === 'bye' && m.from === 'main') {
        live.current = false;
        setSource((s) => (s === 'live' ? 'file' : s));
        say('Vektordesign wurde geschlossen – Änderungen jetzt hier speichern.');
      }
    });
    chan.current = c;
    c?.post({ type: 'hello', from: '3d' });
    // Ohne Antwort: zuletzt bearbeitete Zeichnung öffnen
    const t = setTimeout(async () => {
      if (live.current) return;
      const saved = await readAutosave();
      if (live.current) return;
      if (saved?.doc.pattern?.pieces.length) {
        setDoc(saved.doc);
        setName(saved.fileName?.replace(/\.[^.]+$/, '') ?? saved.doc.name);
        setSource('autosave');
      }
    }, 700);
    const bye = () => c?.post({ type: 'bye', from: '3d' });
    window.addEventListener('beforeunload', bye);
    return () => {
      clearTimeout(t);
      window.removeEventListener('beforeunload', bye);
      c?.close();
    };
  }, []);

  useEffect(() => {
    document.title = `${name}${dirty ? ' •' : ''} – Vektordesign 3D`;
  }, [name, dirty]);

  const pieceLook = useCallback((id: Id, patch: PieceLookPatch) => {
    setDoc((d) => (d ? applyPieceLook(d, id, patch) : d));
    if (live.current) chan.current?.post({ type: 'piece', pieceId: id, patch });
    else setDirty(true);
  }, []);
  const material = useCallback((id: Id, patch: MaterialPatch) => {
    setDoc((d) => (d ? applyMaterial(d, id, patch) : d));
    if (live.current) chan.current?.post({ type: 'material', materialId: id, patch });
    else setDirty(true);
  }, []);
  const select = useCallback((id: Id | null) => {
    setSelected(id);
    if (live.current) chan.current?.post({ type: 'select', pieceId: id });
  }, []);

  const open = async (data?: { name: string; data: Uint8Array }) => {
    const f = data ?? (await openFile([PROJECT_TYPE]));
    if (!f) return;
    try {
      const d = parseDoc(new TextDecoder().decode(f.data));
      live.current = false;
      setDoc(d);
      setName(f.name.replace(/\.[^.]+$/, ''));
      setSource('file');
      setDirty(false);
      setSelected(null);
      if (!d.pattern?.pieces.length) say('Diese Datei enthält noch keine Schnittteile.');
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  };
  const save = async () => {
    if (!doc) return;
    const res = await saveFile(serializeDoc({ ...doc, name }), `${safeName(name)}.vdp`, PROJECT_TYPE);
    if (res) {
      setDirty(false);
      say(`Gespeichert als ${res.name}`);
    }
  };

  const pattern = doc?.pattern;
  return (
    <div
      className="app3d"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void f.arrayBuffer().then((b) => open({ name: f.name, data: new Uint8Array(b) }));
      }}
    >
      <header className="topbar a3-top">
        <span className="brand">
          <Box size={18} /> <strong>Vektordesign 3D</strong>
        </span>
        <span className="doc-name">{name}</span>
        {dirty && <span className="dirty" title="Ungespeicherte Änderungen" />}
        <span className={`a3-src ${source}`} data-testid="a3-source">
          {source === 'live' ? (
            <>
              <Link2 size={14} /> Live mit Vektordesign
            </>
          ) : source === 'autosave' ? (
            <>
              <Link2Off size={14} /> Letzte Sitzung (nicht live)
            </>
          ) : source === 'file' ? (
            <>
              <Link2Off size={14} /> Datei
            </>
          ) : (
            <>
              <Link2Off size={14} /> Kein Projekt
            </>
          )}
        </span>
        <span className="spacer" />
        <button className="topbtn" onClick={() => void open()} data-testid="a3-open">
          <FolderOpen size={16} /> Öffnen
        </button>
        <button className="topbtn" onClick={() => void save()} disabled={!doc || source === 'live'} title={source === 'live' ? 'Wird in Vektordesign gespeichert' : 'Als .vdp speichern'}>
          <Save size={16} /> Speichern
        </button>
      </header>
      <aside className="a3-side">
        {!pattern?.pieces.length ? (
          <div className="props-section">
            <h3>So geht’s</h3>
            <p className="muted small">
              In Vektordesign im Tab <Scissors size={12} /> „Schnitt“ einen Grundschnitt erzeugen oder eigene Teile anlegen und Kanten verbinden. Ist Vektordesign im selben Browser offen, erscheint
              alles hier live. Alternativ eine .vdp-Datei öffnen oder hierher ziehen.
            </p>
          </div>
        ) : (
          <>
            <section className="props-section">
              <h3>Teile</h3>
              <ul className="piece-list" data-testid="a3-pieces">
                {pattern.pieces.map((pc) => {
                  const m = pattern.materials.find((x) => x.id === pc.material);
                  return (
                    <li key={pc.id} className={selected === pc.id ? 'on' : ''}>
                      <div className="piece-row">
                        <ColorButton value={pc.color ?? m?.color ?? '#888888'} label={`Farbe ${pc.name}`} onChange={(c) => pieceLook(pc.id, { color: c })} />
                        <button className="link-like spacer" onClick={() => select(selected === pc.id ? null : pc.id)}>
                          {pc.name}
                          <span className="muted small"> · {ROLE_NAMES[pc.role]}</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <section className="props-section">
              <h3>Stoffe</h3>
              {pattern.materials.map((m) => (
                <div key={m.id} className="material-row a3">
                  <ColorButton value={m.color} label={`Farbe ${m.name}`} onChange={(c) => material(m.id, { color: c })} />
                  <span>{m.name}</span>
                  <FabricSelect m={m} onChange={(patch) => material(m.id, patch)} />
                </div>
              ))}
            </section>
            <section className="props-section">
              <h3>Körper</h3>
              <p className="muted small">
                {sizeName(pattern.bodySize)} · Größe {Math.round(pattern.body.height / 10)} cm · Brust {Math.round(pattern.body.chest / 10)} cm · Taille {Math.round(pattern.body.waist / 10)} cm
              </p>
              <p className="muted small">Maße und Schnitt änderst du in Vektordesign, Tab „Schnitt“.</p>
            </section>
          </>
        )}
      </aside>
      <main className="a3-main">
        {doc ? (
          <ViewerPanel
            full
            doc={doc}
            dark={dark}
            selected={selected}
            onSelect={select}
            onPieceLook={pieceLook}
            onMaterial={material}
            onSnapshot={(url) => {
              const b64 = url.slice(url.indexOf(',') + 1);
              void saveFile(
                Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
                `${safeName(name)}_3D.png`,
                PNG_TYPE,
              ).then((r) => r && say(`Bild gespeichert: ${r.name}`));
            }}
          />
        ) : (
          <div className="a3-empty">
            <Box size={42} />
            <p>Kein Projekt geöffnet.</p>
            <button className="btn accent" onClick={() => void open()}>
              <FolderOpen size={16} /> Projekt öffnen
            </button>
          </div>
        )}
      </main>
      {toast && <div className="a3-toast">{toast}</div>}
    </div>
  );
}
