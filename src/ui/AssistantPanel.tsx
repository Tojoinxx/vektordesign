import { useEffect, useRef, useState } from 'react';
import { ClipboardCopy, ClipboardPaste, ExternalLink, ImagePlus, KeyRound, Play, RotateCcw, Send, Settings2, Sparkles, Square, X } from 'lucide-react';
import { loadApiKey, loadModel, MODELS, saveApiKey, saveModel } from '../assistant/api';
import type { ChatImage } from '../assistant/agent';
import { useApp, useUi } from './hooks';

const EXAMPLES = [
  'Rechteck 80 × 40 mm mittig, darin ein Kreis Ø10 – vollständig bemaßt',
  'Rundes Badge Ø60 mit dem Text „TEAM 2026“ in Weiß auf Dunkelblau',
  'Bau das angehängte Logo als Vektorgrafik nach, 90 mm breit',
  'Gib der Auswahl einen Verlauf von Rot nach Transparent, oben nach unten',
];

const MAX_SIDE = 1568;
let imgId = 1;

/** Bild für Claude vorbereiten: unterstütztes Format, höchstens 1568 px lange Seite. */
async function prepareImage(file: Blob, name: string): Promise<ChatImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`„${name}“ ist kein lesbares Bild.`));
      i.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    const png = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
    const mediaType = png ? 'image/png' : 'image/jpeg';
    const dataUrl = c.toDataURL(mediaType, 0.9);
    return {
      id: `img${imgId++}`,
      name,
      mediaType,
      base64: dataUrl.split(',')[1],
      url: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AssistantPanel() {
  const app = useApp();
  const chat = useUi((s) => s.chat);
  const busy = useUi((s) => s.chatBusy);
  const [text, setText] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [hasKey, setHasKey] = useState(() => !!loadApiKey());
  const [mode, setModeState] = useState<'abo' | 'api'>(() => {
    try {
      const m = localStorage.getItem('vd.claudeMode');
      if (m === 'abo' || m === 'api') return m;
    } catch {
      /* kein Speicher */
    }
    return loadApiKey() ? 'api' : 'abo';
  });
  const setMode = (m: 'abo' | 'api') => {
    setModeState(m);
    try {
      localStorage.setItem('vd.claudeMode', m);
    } catch {
      /* kein Speicher */
    }
  };
  const [reply, setReply] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [model, setModel] = useState(loadModel);
  const [drag, setDrag] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [chat.length, busy]);

  const addFiles = async (files: Iterable<File>) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    try {
      const prepared = await Promise.all(list.slice(0, 5).map((f) => prepareImage(f, f.name || 'Bild')));
      setImages((cur) => [...cur, ...prepared].slice(0, 5));
    } catch (e) {
      app.editor.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  const send = (t = text) => {
    if (mode === 'abo') {
      void app.copyBridgePrompt(t).then((p) => setCopied(p));
      setText('');
      return;
    }
    if (busy || (!t.trim() && !images.length)) return;
    if (!hasKey) {
      setSettings(true);
      return;
    }
    const imgs = images;
    setText('');
    setImages([]);
    void app.agent.send(t.trim(), imgs);
  };

  const saveKey = () => {
    const k = keyInput.trim();
    saveApiKey(k);
    setHasKey(!!k);
    setKeyInput('');
    if (k) setSettings(false);
  };

  return (
    <div
      className={`assistant ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void addFiles(e.dataTransfer.files);
      }}
      data-testid="assistant"
    >
      <div className="assistant-head">
        <Sparkles size={16} className="accent-icon" />
        <strong>Claude</strong>
        <span className="muted small">Design-Agent</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Neues Gespräch"
          aria-label="Neues Gespräch"
          onClick={() => {
            app.agent.reset();
            app.ui.setState({ chat: [] });
          }}
        >
          <RotateCcw size={15} />
        </button>
        <button className={`icon-btn ${settings ? 'on' : ''}`} title="Einstellungen" aria-label="Einstellungen" onClick={() => setSettings((s) => !s)}>
          <Settings2 size={15} />
        </button>
      </div>

      <div className="segmented assistant-mode" role="radiogroup" aria-label="Wie Claude arbeitet">
        <button className={mode === 'abo' ? 'on' : ''} onClick={() => setMode('abo')} role="radio" aria-checked={mode === 'abo'} data-testid="claude-mode-abo">
          Mit Claude-Abo <small>kostenlos, Kopieren</small>
        </button>
        <button className={mode === 'api' ? 'on' : ''} onClick={() => setMode('api')} role="radio" aria-checked={mode === 'api'} data-testid="claude-mode-api">
          Mit API-Schlüssel <small>direkt, kostet pro Auftrag</small>
        </button>
      </div>

      {mode === 'abo' && (
        <div className="assistant-settings">
          <p className="small">
            So geht’s ohne API-Schlüssel: <strong>1.</strong> Wunsch unten eintippen und „Auftrag kopieren“. <strong>2.</strong> In{' '}
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer">
              claude.ai <ExternalLink size={11} />
            </a>{' '}
            einfügen (Bilder dort anhängen) und senden. <strong>3.</strong> Claudes Antwort komplett kopieren, unten einfügen und „Ausführen“.
          </p>
        </div>
      )}

      {mode === 'api' && (settings || !hasKey) && (
        <div className="assistant-settings">
          <p>
            <KeyRound size={14} /> Claude braucht einen eigenen <strong>API-Schlüssel</strong> (erstellen unter{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>
            ). Er wird nur auf diesem Gerät gespeichert und nur an Anthropic gesendet.
          </p>
          <div className="row">
            <input
              type="password"
              value={keyInput}
              placeholder={hasKey ? '•••••••• (gespeichert)' : 'sk-ant-…'}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="API-Schlüssel"
            />
            <button className="btn accent" onClick={saveKey}>
              Speichern
            </button>
          </div>
          {hasKey && (
            <button
              className="link"
              onClick={() => {
                saveApiKey('');
                setHasKey(false);
              }}
            >
              Schlüssel entfernen
            </button>
          )}
          <label className="field wide">
            <span>Modell</span>
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                saveModel(e.target.value);
              }}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">Nur der Assistent braucht Internet – alles andere funktioniert offline.</p>
        </div>
      )}

      <div className="chat" ref={listRef} aria-live="polite">
        {!chat.length && (
          <div className="chat-empty">
            <p>Sag Claude, was es zeichnen oder ändern soll – oder zieh Bilder hierher, die nachgebaut werden sollen.</p>
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => setText(ex)}>
                {ex}
              </button>
            ))}
          </div>
        )}
        {chat.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.images.length > 0 && (
                <div className="msg-images">
                  {m.images.map((im) => (
                    <img key={im.id} src={im.url} alt={im.name} />
                  ))}
                </div>
              )}
              {m.text && <p>{m.text}</p>}
            </div>
          ) : m.role === 'assistant' ? (
            <div key={m.id} className="msg bot">
              {m.text.split('\n').map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          ) : m.role === 'action' ? (
            <div key={m.id} className={`msg action ${m.error ? 'bad' : ''}`}>
              {m.error ? '✗' : '✓'} {m.text}
            </div>
          ) : (
            <div key={m.id} className="msg error">
              {m.text}
            </div>
          ),
        )}
        {busy && <div className="msg thinking">Claude arbeitet …</div>}
      </div>

      <div className="composer">
        {images.length > 0 && (
          <div className="composer-images">
            {images.map((im, i) => (
              <span key={im.id} className="img-chip">
                <img src={im.url} alt={im.name} />
                <span>Bild {i + 1}</span>
                <button aria-label={`Bild ${i + 1} entfernen`} onClick={() => setImages((l) => l.filter((x) => x.id !== im.id))}>
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          id="claude-eingabe"
          value={text}
          rows={3}
          placeholder={
            mode === 'abo'
              ? 'Was soll Claude zeichnen oder ändern? (Enter kopiert den Auftrag für claude.ai)'
              : images.length
                ? 'Was soll Claude mit den Bildern machen? (z. B. Bild 1 vorne, Bild 2 als Hintergrund mit Verblassen)'
                : 'Auftrag an Claude … (Enter sendet, Umschalt+Enter neue Zeile)'
          }
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.some((f) => f.type.startsWith('image/'))) {
              e.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          aria-label="Nachricht an Claude"
        />
        {mode === 'abo' ? (
          <>
            <div className="row">
              <span className="muted small spacer">{copied ? 'Auftrag erstellt – in claude.ai einfügen.' : 'Bilder direkt in claude.ai anhängen.'}</span>
              <button className="btn accent" onClick={() => send()} data-testid="bridge-copy">
                <ClipboardCopy size={14} /> Auftrag kopieren
              </button>
            </div>
            {copied && (
              <details className="bridge-prompt">
                <summary className="muted small">Auftrag anzeigen (falls Kopieren nicht ging)</summary>
                <textarea readOnly value={copied} rows={4} onFocus={(e) => e.currentTarget.select()} aria-label="Auftrag für claude.ai" />
              </details>
            )}
            <textarea
              value={reply}
              rows={3}
              placeholder="Antwort von Claude hier einfügen …"
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              aria-label="Antwort von Claude"
              data-testid="bridge-reply"
            />
            <div className="row">
              <button
                className="icon-btn"
                title="Aus der Zwischenablage einfügen"
                aria-label="Aus der Zwischenablage einfügen"
                onClick={() => {
                  void navigator.clipboard
                    .readText()
                    .then((t) => setReply(t))
                    .catch(() => app.editor.toast('Zugriff auf die Zwischenablage nicht erlaubt – bitte mit Strg+V einfügen.', 'info'));
                }}
              >
                <ClipboardPaste size={16} />
              </button>
              <span className="spacer" />
              <button
                className="btn accent"
                disabled={!reply.trim()}
                onClick={() => {
                  void app.runBridgeReply(reply).then((ok) => ok && setReply(''));
                }}
                data-testid="bridge-run"
              >
                <Play size={14} /> Ausführen
              </button>
            </div>
          </>
        ) : (
          <div className="row">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
            <button className="icon-btn" title="Bilder anhängen (oder hineinziehen / Strg+V)" aria-label="Bilder anhängen" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={17} />
            </button>
            <span className="spacer" />
            {busy ? (
              <button className="btn" onClick={() => app.agent.stop()}>
                <Square size={13} /> Stopp
              </button>
            ) : (
              <button className="btn accent" onClick={() => send()} disabled={!text.trim() && !images.length}>
                <Send size={14} /> Senden
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
