import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Cloud,
  CloudOff,
  Share2,
  CircleHelp,
  Command as CommandIcon,
  FilePlus2,
  FolderOpen,
  Menu,
  Moon,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Save,
  Search,
  Sparkles,
  Sun,
  SunMoon,
  Undo2,
  X,
  Download,
} from 'lucide-react';
import { formatNumber } from '../params/expr';
import { describeItem } from '../solver/analysis';
import { pngSize } from '../export/png';
import { docBBox } from '../model/bounds';
import type { ExportFormat, Settings } from '../store/state';
import { PREFLIGHT_RULES, type PreflightTarget } from '../model/preflight';
import { buildCommands, type Command } from './commands';
import { useApp, useAppState, useUi } from './hooks';
import { refreshTutorialColors, setTutorialsEnabled, TUTORIALS, tutorialsEnabled, type TutorialId } from './tutorials';
import { APP_VERSION } from '../model/serialize';
import { CANVAS_LABELS, THEME_LABELS, resolveTheme, type CanvasPref, type ThemePref } from './appearance';

// ---------------------------------------------------------------------------
// Kopfzeile
// ---------------------------------------------------------------------------

export function TopBar() {
  const app = useApp();
  const fileName = useAppState((s) => s.fileName);
  const dirty = useAppState((s) => s.dirty);
  const canUndo = useAppState((s) => s.past.length > 0);
  const canRedo = useAppState((s) => s.future.length > 0);
  const undoLabel = useAppState((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useAppState((s) => s.future[s.future.length - 1]?.label);
  const sideOpen = useUi((s) => s.sideOpen);
  const side = useUi((s) => s.side);
  const menu = useUi((s) => s.fileMenu);
  const appearanceMenu = useUi((s) => s.appearanceMenu);
  const theme = useUi((s) => s.appearance.theme);
  const ThemeIcon = theme === 'system' ? SunMoon : resolveTheme(theme) === 'dark' ? Moon : Sun;

  return (
    <header className="topbar">
      <div className="menu-wrap">
        <button className="topbtn" onClick={() => app.ui.setState({ fileMenu: !menu })} aria-haspopup="menu" aria-expanded={menu} data-testid="file-menu">
          <Menu size={17} /> <span>Datei</span>
        </button>
        {menu && <FileMenu />}
      </div>
      <div className="brand" aria-label="Vektordesign">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Vektordesign</span>
        <span className="doc-name" title={fileName ?? 'Noch nicht gespeichert'}>
          {fileName ?? 'Unbenannt'}
          {dirty && (
            <span className="dirty" title="Ungespeicherte Änderungen">
              {' '}
              •
            </span>
          )}
        </span>
      </div>
      <span className="spacer" />
      <button
        className="topbtn icon"
        onClick={() => app.editor.undo()}
        disabled={!canUndo}
        title={canUndo ? `Rückgängig: ${undoLabel} (Strg+Z)` : 'Rückgängig (Strg+Z)'}
        aria-label="Rückgängig"
        data-testid="undo"
      >
        <Undo2 size={17} />
      </button>
      <button className="topbtn icon" onClick={() => app.editor.redo()} disabled={!canRedo} title={canRedo ? `Wiederholen: ${redoLabel} (Strg+Y)` : 'Wiederholen (Strg+Y)'} aria-label="Wiederholen">
        <Redo2 size={17} />
      </button>
      <button className="search-btn" onClick={() => app.store.setState({ paletteOpen: true })} title="Befehlssuche (Strg+K)">
        <Search size={15} /> <span>Befehl suchen</span> <kbd>Strg K</kbd>
      </button>
      <div className="menu-wrap">
        <button
          className={`topbtn icon ${appearanceMenu ? 'on' : ''}`}
          onClick={() => app.ui.setState({ appearanceMenu: !appearanceMenu })}
          title="Darstellung: Design und Zeichenfläche"
          aria-label="Darstellung"
          aria-haspopup="dialog"
          aria-expanded={appearanceMenu}
          data-testid="appearance"
        >
          <ThemeIcon size={17} />
        </button>
        {appearanceMenu && <AppearanceMenu />}
      </div>
      <button className="topbtn icon" onClick={() => app.ui.setState({ tutorialList: true })} title="Tutorials und Hilfe" aria-label="Tutorials und Hilfe">
        <CircleHelp size={17} />
      </button>
      <button
        className={`topbtn claude-btn ${sideOpen && side === 'claude' ? 'on' : ''}`}
        onClick={() => {
          app.ui.setState({ side: 'claude', sideOpen: true });
          app.showTutorialFor('claude');
        }}
        title="Claude-Assistent (Strg+I)"
      >
        <Sparkles size={16} /> <span>Claude</span>
      </button>
      <button
        className="topbtn icon"
        onClick={() => app.ui.setState({ sideOpen: !sideOpen })}
        title={sideOpen ? 'Seitenleiste ausblenden' : 'Seitenleiste einblenden'}
        aria-label="Seitenleiste umschalten"
      >
        {sideOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
      </button>
    </header>
  );
}

const THEME_ORDER: ThemePref[] = ['dark', 'light', 'system'];
const CANVAS_ORDER: CanvasPref[] = ['auto', 'light', 'dark'];

/** Darstellung: Design der Oberfläche und, unabhängig davon, die Zeichenfläche. */
function AppearanceMenu() {
  const app = useApp();
  const a = useUi((s) => s.appearance);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-testid="appearance"]')) app.ui.setState({ appearanceMenu: false });
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') app.ui.setState({ appearanceMenu: false });
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', esc, true);
    };
  }, [app]);
  return (
    <div className="dropdown right appearance-menu" role="dialog" aria-label="Darstellung" ref={ref}>
      <div className="am-row">
        <span id="am-theme">Design</span>
        <div className="segmented" role="radiogroup" aria-labelledby="am-theme">
          {THEME_ORDER.map((t) => (
            <button key={t} role="radio" aria-checked={a.theme === t} className={a.theme === t ? 'on' : ''} onClick={() => app.setAppearance({ theme: t })} data-testid={`theme-${t}`}>
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="am-row">
        <span id="am-canvas">Zeichenfläche</span>
        <div className="segmented" role="radiogroup" aria-labelledby="am-canvas">
          {CANVAS_ORDER.map((c) => (
            <button key={c} role="radio" aria-checked={a.canvas === c} className={a.canvas === c ? 'on' : ''} onClick={() => app.setAppearance({ canvas: c })} data-testid={`canvas-${c}`}>
              {CANVAS_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      <p className="am-note">Auf heller Zeichenfläche sind dunkle Motive besser zu sehen. Exportiert wird immer mit transparentem Hintergrund.</p>
    </div>
  );
}

function FileMenu() {
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-testid="file-menu"]')) app.ui.setState({ fileMenu: false });
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [app]);
  const item = (label: string, kbd: string, icon: React.ReactNode, run: () => void) => (
    <button
      role="menuitem"
      onClick={() => {
        app.ui.setState({ fileMenu: false });
        run();
      }}
    >
      {icon}
      <span>{label}</span>
      <kbd>{kbd}</kbd>
    </button>
  );
  return (
    <div className="dropdown" role="menu" ref={ref}>
      {item('Neue Zeichnung', 'Strg+N', <FilePlus2 size={15} />, () => app.newDocument())}
      {item('Öffnen …', 'Strg+O', <FolderOpen size={15} />, () => void app.openDocument())}
      {item('Speichern', 'Strg+S', <Save size={15} />, () => void app.saveDocument())}
      {item('Speichern unter …', 'Strg+Umschalt+S', <Save size={15} />, () => void app.saveDocument(true))}
      <hr />
      {item('Als SVG exportieren …', 'Strg+E', <Download size={15} />, () => app.openExport('svg'))}
      {item('Als PNG exportieren …', '', <Download size={15} />, () => app.openExport('png', 300))}
      <hr />
      {item('Tutorials', '', <CircleHelp size={15} />, () => app.ui.setState({ tutorialList: true }))}
      {item('Über Vektordesign', '', <CommandIcon size={15} />, () => app.ui.setState({ about: true }))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statusleiste
// ---------------------------------------------------------------------------

const SNAPS: [keyof Settings, string, string][] = [
  ['snapEndpoint', 'Endpunkt', 'End'],
  ['snapMidpoint', 'Linienmitte', 'Mitte'],
  ['snapIntersection', 'Schnittpunkt', 'Schnitt'],
  ['snapCenter', 'Kreismittelpunkt', 'Zentrum'],
  ['snapOnCurve', 'Auf Kurve', 'Kurve'],
  ['gridSnap', 'Raster', 'Raster'],
];

export function StatusBar() {
  const app = useApp();
  useAppState((s) => s.tool);
  useAppState((s) => s.selection);
  useUi((s) => s.dynValues);
  const cursor = useUi((s) => s.cursorWorld);
  const settings = useAppState((s) => s.settings);
  const analysis = useAppState((s) => s.analysis);
  const zoom = useAppState((s) => s.view.zoom);
  const detail = useUi((s) => s.statusDetail);
  const doc = useAppState((s) => s.doc);
  const problems = [...new Set([...analysis.conflicting, ...analysis.redundant])];

  return (
    <footer className="statusbar">
      <span className="hint" data-testid="hint">
        {app.current.hint()}
      </span>
      <span className="spacer" />
      <SyncBadge />
      <span className="coords" aria-label="Mausposition">
        {cursor ? `X ${formatNumber(cursor.x, 2)}  Y ${formatNumber(cursor.y, 2)} mm` : '—'}
      </span>
      <span className="snaps" role="group" aria-label="Fang">
        {SNAPS.map(([k, title, short]) => (
          <button
            key={k}
            className={settings[k] ? 'on' : ''}
            title={`Fang: ${title}`}
            aria-pressed={!!settings[k]}
            onClick={() =>
              app.store.setState({
                settings: { ...settings, [k]: !settings[k] },
              })
            }
          >
            {short}
          </button>
        ))}
      </span>
      <span className="status-wrap">
        <button className={`status-pill st-${analysis.status}`} onClick={() => app.ui.setState({ statusDetail: !detail })} data-testid="sketch-status" title="Bestimmtheit der Skizze">
          <span className="dot" />
          {analysis.label}
        </button>
        {detail && (
          <div className="status-pop" role="dialog" aria-label="Skizzenstatus">
            <button className="close" onClick={() => app.ui.setState({ statusDetail: false })} aria-label="Schließen">
              <X size={14} />
            </button>
            <strong>{analysis.label}</strong>
            {analysis.status === 'under' && (
              <p>
                Die Skizze hat noch {analysis.dof} Freiheitsgrad
                {analysis.dof === 1 ? '' : 'e'}. Blaue Geometrie ist noch beweglich – bemaße sie oder setze Abhängigkeiten. Ziehen zeigt, was sich noch bewegt. Für eine feste Lage einen Punkt mit dem
                Ursprung verbinden oder fixieren.
              </p>
            )}
            {analysis.status === 'full' && <p>Alle Maße und die Lage sind festgelegt. Keine Geometrie ist mehr blau, also nichts mehr beweglich.</p>}
            {analysis.status === 'over' && (
              <>
                <p>{analysis.detail}</p>
                <ul>
                  {problems.map((id) => (
                    <li key={id}>
                      <button className="link" onClick={() => app.editor.select([id])}>
                        {describeItem(doc, id)}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {analysis.status === 'empty' && <p>Zeichne eine Form, z. B. mit R ein Rechteck.</p>}
          </div>
        )}
      </span>
      <span className="zoom" title="Zoom (100 % ≈ Originalgröße)">
        {Math.round((zoom / (96 / 25.4)) * 100)} %
      </span>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Dialoge
// ---------------------------------------------------------------------------

export function Modal({ title, onClose, children, wide, testId }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; testId?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Schließen">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const FORMATS: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'svg', label: 'SVG', hint: 'Illustrator, Cricut, Silhouette' },
  { id: 'pdf', label: 'PDF', hint: 'Druckerei, LabwearOS' },
  { id: 'eps', label: 'EPS', hint: 'ältere Programme' },
  { id: 'dxf', label: 'DXF', hint: 'Plotter, Schnittmuster' },
  { id: 'png', label: 'PNG', hint: 'DTF, Vorschau' },
];

export function ExportDialog() {
  const app = useApp();
  const open = useAppState((s) => s.exportOpen);
  const preset = useAppState((s) => s.exportPreset);
  const doc = useAppState((s) => s.doc);
  const [format, setFormat] = useState<ExportFormat>('svg');
  const [dpi, setDpi] = useState(300);
  const [bounds, setBounds] = useState<'geometry' | 'stroke'>('geometry');
  const [mirror, setMirror] = useState(false);
  const [cmyk, setCmyk] = useState(false);
  const [outlines, setOutlines] = useState(true);
  const [weed, setWeed] = useState(false);
  const [perColor, setPerColor] = useState(false);
  const [weedMargin, setWeedMargin] = useState('3');
  const [weedLines, setWeedLines] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open && preset) {
      setFormat(preset.format);
      if (preset.dpi) setDpi(Math.max(300, preset.dpi));
    }
  }, [open, preset]);
  if (!open) return null;
  const close = () => app.store.setState({ exportOpen: false, exportPreset: null });
  const box = docBBox(doc, { includeStroke: bounds === 'stroke' });
  const px = format === 'png' ? pngSize(doc, dpi, bounds) : null;
  const hasText = Object.values(doc.entities).some((e) => e.kind === 'text' && !e.construction);
  const run = async () => {
    setBusy(true);
    const ok = await app.exportFile({
      format,
      dpi,
      bounds,
      mirror,
      colorMode: cmyk ? 'cmyk' : 'rgb',
      outlines,
      perColor: perColor && format !== 'png',
      weeding: weed && format !== 'png' ? { margin: Math.max(0, Number(weedMargin.replace(',', '.')) || 0), lines: weedLines } : null,
    });
    setBusy(false);
    if (ok) close();
  };
  return (
    <Modal title="Exportieren" onClose={close} testId="export-dialog">
      <div className="stack">
        <div className="segmented big formats" role="radiogroup" aria-label="Format">
          {FORMATS.map((f) => (
            <button key={f.id} className={format === f.id ? 'on' : ''} onClick={() => setFormat(f.id)} role="radio" aria-checked={format === f.id} data-testid={`format-${f.id}`}>
              {f.label} <small>{f.hint}</small>
            </button>
          ))}
        </div>
        {format === 'png' && (
          <label className="field wide">
            <span>Auflösung</span>
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} aria-label="Auflösung in dpi">
              {[300, 360, 600, 720, 1200].map((d) => (
                <option key={d} value={d}>
                  {d} dpi
                </option>
              ))}
            </select>
          </label>
        )}
        {(format === 'pdf' || format === 'eps') && (
          <div className="segmented" role="radiogroup" aria-label="Farbraum">
            <button className={!cmyk ? 'on' : ''} onClick={() => setCmyk(false)} role="radio" aria-checked={!cmyk}>
              RGB
            </button>
            <button className={cmyk ? 'on' : ''} onClick={() => setCmyk(true)} role="radio" aria-checked={cmyk} data-testid="export-cmyk">
              CMYK
            </button>
          </div>
        )}
        {format === 'svg' && hasText && (
          <label className="check">
            <input type="checkbox" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} data-testid="export-outlines" />
            Text in Pfade umwandeln (empfohlen – die Schrift muss beim Empfänger dann nicht installiert sein)
          </label>
        )}
        <label className="check">
          <input type="checkbox" checked={bounds === 'stroke'} onChange={(e) => setBounds(e.target.checked ? 'stroke' : 'geometry')} />
          Konturstärke in die Größe einrechnen (sonst exakt die Geometrie)
        </label>
        <label className="check">
          <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
          Spiegeln (für Flexfolie / Transferdruck)
        </label>
        {format !== 'png' && (
          <label className="check">
            <input type="checkbox" checked={perColor} onChange={(e) => setPerColor(e.target.checked)} data-testid="export-percolor" />
            Je Farbe eine Datei (Folienfarben, Siebe) – alle mit gleichem Rahmen, als ZIP
          </label>
        )}
        {format !== 'png' && (
          <div className="weed-row">
            <label className="check">
              <input type="checkbox" checked={weed} onChange={(e) => setWeed(e.target.checked)} data-testid="export-weed" />
              Entgitterungsrahmen (Plotter)
            </label>
            {weed && (
              <>
                <label className="field inline">
                  <span>Abstand</span>
                  <input type="text" inputMode="decimal" value={weedMargin} onChange={(e) => setWeedMargin(e.target.value)} aria-label="Abstand des Rahmens in mm" style={{ width: 56 }} />
                  <span>mm</span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={weedLines} onChange={(e) => setWeedLines(e.target.checked)} />
                  Entgitterungslinien zwischen Motivteilen
                </label>
              </>
            )}
          </div>
        )}
        <div className="export-info" data-testid="export-info">
          {box ? (
            <>
              <strong>
                {formatNumber(box.maxX - box.minX, 2)} × {formatNumber(box.maxY - box.minY, 2)} mm
              </strong>
              {px && (
                <span>
                  {' '}
                  · {px.wPx} × {px.hPx} px bei {dpi} dpi, transparenter Hintergrund
                </span>
              )}
              <p className="muted small">
                {format === 'pdf' && 'Vektor-PDF in Originalgröße mit benannten Ebenen; Text immer als Pfade. '}
                {format === 'eps' && 'EPS kennt keine Transparenz – Deckkraft und Verblassen werden ignoriert; Text immer als Pfade. '}
                {format === 'dxf' && 'DXF enthält nur Konturen in mm (keine Farben); Text immer als Pfade. '}
                {weed &&
                  `Mit Entgitterungsrahmen ${formatNumber(box.maxX - box.minX + 2 * (Number(weedMargin.replace(',', '.')) || 0), 2)} × ${formatNumber(box.maxY - box.minY + 2 * (Number(weedMargin.replace(',', '.')) || 0), 2)} mm (eigene Ebene „Entgitterung“). `}
                Bemaßungen, Abhängigkeitssymbole und Konstruktionsgeometrie werden nicht exportiert.
              </p>
            </>
          ) : (
            <span className="error-text">Nichts zu exportieren – zeichne zuerst eine Form (Konstruktionsgeometrie zählt nicht).</span>
          )}
        </div>
        <div className="row end">
          <button className="btn" onClick={close}>
            Abbrechen
          </button>
          <button className="btn accent" onClick={() => void run()} disabled={!box || busy} data-testid="export-run">
            {busy ? 'Exportiere …' : `${format.toUpperCase()} exportieren`}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function fuzzy(q: string, c: Command): number {
  const hay = `${c.label} ${c.group} ${c.keywords ?? ''} ${c.shortcut ?? ''}`.toLowerCase();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  let score = 0;
  for (const t of terms) {
    const i = hay.indexOf(t);
    if (i < 0) return 0;
    score += c.label.toLowerCase().startsWith(t) ? 5 : i === 0 ? 3 : 1;
  }
  return score;
}

export function CommandPalette() {
  const app = useApp();
  const open = useAppState((s) => s.paletteOpen);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const cmds = useMemo(() => buildCommands(), []);
  const list = useMemo(
    () =>
      cmds
        .map((c) => ({ c, s: fuzzy(q, c) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 12)
        .map((x) => x.c),
    [q, cmds],
  );
  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
    }
  }, [open]);
  if (!open) return null;
  const close = () => app.store.setState({ paletteOpen: false });
  const run = (c: Command) => {
    close();
    c.run(app);
  };
  return (
    <div className="modal-back top" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Befehlssuche">
        <div className="palette-input">
          <Search size={16} />
          <input
            autoFocus
            value={q}
            placeholder="Befehl suchen, z. B. Rechteck, parallel, Export …"
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') close();
              else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(list.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && list[idx]) run(list[idx]);
            }}
            aria-label="Befehl suchen"
          />
        </div>
        <ul>
          {list.map((c, i) => (
            <li key={c.id}>
              <button className={i === idx ? 'on' : ''} onMouseEnter={() => setIdx(i)} onClick={() => run(c)}>
                <span className="pg">{c.group}</span>
                <span>{c.label}</span>
                {c.shortcut && <kbd>{c.shortcut}</kbd>}
              </button>
            </li>
          ))}
          {!list.length && <li className="muted pad">Kein Befehl gefunden.</li>}
        </ul>
      </div>
    </div>
  );
}

export function ConfirmDialog() {
  const app = useApp();
  const req = useAppState((s) => s.confirm);
  if (!req) return null;
  const close = () => app.store.setState({ confirm: null });
  return (
    <Modal
      title={req.title}
      onClose={() => {
        close();
        req.onCancel?.();
      }}
      testId="confirm-dialog"
    >
      <p style={{ whiteSpace: 'pre-line' }}>{req.text}</p>
      <div className="row end">
        <button
          className="btn"
          onClick={() => {
            close();
            req.onCancel?.();
          }}
        >
          {req.cancel ?? 'Abbrechen'}
        </button>
        <button
          className="btn accent"
          autoFocus
          onClick={() => {
            close();
            req.onConfirm();
          }}
          data-testid="confirm-ok"
        >
          {req.confirm}
        </button>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useAppState((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function TutorialCard() {
  const app = useApp();
  const id = useUi((s) => s.tutorial);
  const appearance = useUi((s) => s.appearance);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Reduzierte Bewegung respektieren
    const svg = ref.current?.querySelector('svg') as SVGSVGElement | null;
    if (svg && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      svg.pauseAnimations();
      svg.setCurrentTime(3.4);
    }
  }, [id]);
  if (!id) return null;
  const t = TUTORIALS[id];
  // Farben aus dem aktuellen Design; neuer Schlüssel startet die Animation mit den neuen Farben
  refreshTutorialColors();
  const artKey = `${id}-${appearance.theme}-${appearance.canvas}`;
  return (
    <aside className="tutorial" ref={ref} role="dialog" aria-label={`Tutorial: ${t.title}`} data-testid="tutorial">
      <div className="tutorial-head">
        <strong>{t.title}</strong>
        <button className="icon-btn" onClick={() => app.closeTutorial()} aria-label="Schließen">
          <X size={15} />
        </button>
      </div>
      <div key={artKey}>{t.anim()}</div>
      <ul>
        {t.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <div className="row">
        <button
          className="link"
          onClick={() => {
            setTutorialsEnabled(false);
            app.closeTutorial();
          }}
        >
          Keine Tutorials mehr zeigen
        </button>
        <span className="spacer" />
        <button className="btn accent" onClick={() => app.closeTutorial()} data-testid="tutorial-ok">
          Verstanden
        </button>
      </div>
    </aside>
  );
}

export function TutorialList() {
  const app = useApp();
  const open = useUi((s) => s.tutorialList);
  const [on, setOn] = useState(tutorialsEnabled);
  if (!open) return null;
  const close = () => app.ui.setState({ tutorialList: false });
  return (
    <Modal title="Tutorials" onClose={close} wide>
      <div className="tut-grid">
        {(Object.keys(TUTORIALS) as TutorialId[]).map((k) => (
          <button
            key={k}
            className="tut-tile"
            onClick={() => {
              close();
              app.ui.setState({ tutorial: k });
            }}
          >
            <span>{TUTORIALS[k].title}</span>
          </button>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            setTutorialsEnabled(e.target.checked);
          }}
        />
        Tutorials beim ersten Benutzen eines Werkzeugs zeigen
      </label>
      <h3>Tastenkürzel</h3>
      <table className="kbd-table">
        <tbody>
          {[
            ['L / R / C / T / P', 'Linie, Rechteck, Kreis, Text, Punkt'],
            ['D', 'Bemaßung'],
            ['G', 'Farbverlauf ziehen'],
            ['F', 'Alles anzeigen'],
            ['Esc', 'Abbrechen / zurück zur Auswahl'],
            ['Entf', 'Löschen'],
            ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'],
            ['Strg+C / V / D', 'Kopieren / Einfügen / Duplizieren'],
            ['Strg+K', 'Befehlssuche'],
            ['Strg+I', 'Claude-Assistent'],
            ['F8 / F9', 'Abhängigkeiten zeigen / ausblenden'],
            ['Q', 'Auswahl ↔ Konstruktionsgeometrie'],
            ['Mausrad / mittlere Taste', 'Zoomen / Verschieben (auch Leertaste + Ziehen)'],
            ['Rechtsklick', 'Markierungsmenü (gedrückt halten und ziehen = Geste)'],
            ['Zahl tippen beim Zeichnen', 'Direkte Werteingabe, Tab wechselt das Feld'],
            ['Alt beim Zeichnen', 'Fang aus · Strg: ohne automatische Abhängigkeiten'],
          ].map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}

export function AboutDialog() {
  const app = useApp();
  const open = useUi((s) => s.about);
  if (!open) return null;
  return (
    <Modal title="Über Vektordesign" onClose={() => app.ui.setState({ about: false })}>
      <p>
        <strong>Vektordesign {APP_VERSION}</strong> – maßgenaue Vektorgrafik für Textil-Designs. Bedienung wie im Inventor-Skizzenmodus: grob zeichnen, dann über Bemaßungen und Abhängigkeiten exakt
        festlegen.
      </p>
      <p className="muted small">Constraint-Solver: planegcs (FreeCAD, LGPL-2.1), React, Tauri. Schrift: IBM Plex Sans (OFL). Lizenz: MIT.</p>
    </Modal>
  );
}

/** Eingabedialog für Bearbeiten-Befehle (Verschieben, Drehen, Versatz …); Ausdrücke wie 20+5 sind erlaubt. */
export function ParamDialog() {
  const app = useApp();
  const spec = useUi((s) => s.paramDialog);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const first = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!spec) return;
    setVals(Object.fromEntries(spec.fields.map((f) => [f.key, f.value])));
    setErr(null);
    setTimeout(() => {
      first.current?.focus();
      first.current?.select();
    }, 30);
  }, [spec]);
  if (!spec) return null;
  const close = () => app.ui.setState({ paramDialog: null });
  const run = async () => {
    try {
      await spec.run(vals);
      close();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  let firstSet = false;
  return (
    <Modal title={spec.title} onClose={close} testId="param-dialog">
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        {spec.text && <p className="muted small">{spec.text}</p>}
        <div className="param-grid">
          {spec.fields.map((f) => {
            const v = vals[f.key] ?? '';
            const set = (nv: string) => setVals((o) => ({ ...o, [f.key]: nv }));
            if (f.kind === 'check')
              return (
                <label key={f.key} className="check" style={{ gridColumn: '1 / -1' }}>
                  <input type="checkbox" checked={!!v} onChange={(e) => set(e.target.checked ? '1' : '')} data-testid={`param-${f.key}`} />
                  {f.label}
                </label>
              );
            const label = <span key={`${f.key}-l`}>{f.label}</span>;
            if (f.kind === 'choice')
              return [
                label,
                <select key={f.key} value={v} onChange={(e) => set(e.target.value)} aria-label={f.label} data-testid={`param-${f.key}`}>
                  {f.options!.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>,
              ];
            const ref = !firstSet ? first : undefined;
            firstSet = true;
            return [
              label,
              <div key={f.key} className="param-input">
                <input ref={ref} type="text" inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} aria-label={f.label} data-testid={`param-${f.key}`} />
                {f.unit && <em>{f.unit}</em>}
              </div>,
              f.hint ? (
                <div key={`${f.key}-h`} className="param-hint">
                  {f.hint}
                </div>
              ) : null,
            ];
          })}
        </div>
        {err && <p className="error-text">{err}</p>}
        <div className="row end">
          <button type="button" className="btn" onClick={close}>
            Abbrechen
          </button>
          <button type="submit" className="btn accent" data-testid="param-ok">
            {spec.ok}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Ergebnis des Messwerkzeugs (verändert die Zeichnung nicht). */
export function MeasureCard() {
  const r = useUi((s) => s.measure);
  const tool = useAppState((s) => s.tool);
  if (!r || tool !== 'measure') return null;
  return (
    <div className="measure-card" role="status" aria-live="polite" data-testid="measure-card">
      <h3>{r.title}</h3>
      <dl>{r.rows.map(([k, v]) => [<dt key={`${k}-k`}>{k}</dt>, <dd key={`${k}-v`}>{v}</dd>])}</dl>
      <p className="muted">Die Zeichnung bleibt unverändert · Esc beendet</p>
    </div>
  );
}

/** Anzeige der Datei-Verbindung (Abgleich mit dem iPad über iCloud Drive/OneDrive). */
function SyncBadge() {
  const linked = useUi((s) => s.syncLinked);
  const dirty = useAppState((s) => s.dirty);
  if (!linked) return null;
  return (
    <span
      className={`sync-badge ${dirty ? 'dirty' : ''}`}
      title={`Verbunden mit „${linked}“: Änderungen anderer Geräte werden automatisch übernommen.${dirty ? ' Es gibt ungespeicherte Änderungen.' : ''}`}
      data-testid="sync-badge"
    >
      {dirty ? <CloudOff size={14} /> : <Cloud size={14} />} {linked}
    </span>
  );
}

/** Konflikt: Die Datei wurde auf einem anderen Gerät geändert, während hier ungespeicherte Änderungen bestehen. */
export function SyncConflictDialog() {
  const app = useApp();
  const c = useUi((s) => s.syncConflict);
  if (!c) return null;
  const when = c.meta.savedAt
    ? new Date(c.meta.savedAt).toLocaleString('de-DE', {
        dateStyle: 'short',
        timeStyle: 'short',
      })
    : '';
  const who = c.meta.savedBy || 'einem anderen Gerät';
  return (
    <Modal title="Datei wurde woanders geändert" onClose={() => app.ui.setState({ syncConflict: null })} testId="sync-conflict">
      <div className="stack">
        <p>
          Die Projektdatei wurde auf <strong>{who}</strong>
          {when ? ` (${when})` : ''} gespeichert, während du hier ungespeicherte Änderungen hast. Welche Fassung soll gelten?
        </p>
        <button className="btn wide" onClick={() => void app.resolveConflict('theirs')} data-testid="conflict-theirs">
          Version von {who} laden <small className="muted">– meine Änderungen verwerfen</small>
        </button>
        <button className="btn wide" onClick={() => void app.resolveConflict('mine')} data-testid="conflict-mine">
          Meine Version behalten <small className="muted">– {c.mode === 'save' ? 'jetzt speichern und Datei überschreiben' : 'beim nächsten Speichern überschreiben'}</small>
        </button>
        <button className="btn accent wide" onClick={() => void app.resolveConflict('both')} data-testid="conflict-both">
          Beide behalten <small>– meine als Kopie sichern, dann {who} laden</small>
        </button>
      </div>
    </Modal>
  );
}

/** iPad: Teilen braucht eine frische Berührung – Datei ist fertig, Knopf startet das Teilen-Menü. */
export function ShareReadyDialog() {
  const app = useApp();
  const r = useUi((s) => s.shareReady);
  if (!r) return null;
  const close = () => app.ui.setState({ shareReady: null });
  return (
    <Modal title="Datei ist bereit" onClose={close} testId="share-ready">
      <div className="stack">
        <p>
          <strong>{r.name}</strong> kann jetzt geteilt werden – „In Dateien sichern“ (iCloud Drive, OneDrive), AirDrop, Mail oder die Cricut-App.
        </p>
        <div className="row end">
          <button className="btn" onClick={close}>
            Schließen
          </button>
          <button
            className="btn accent"
            onClick={() => {
              void r.share();
              close();
            }}
          >
            <Share2 size={16} /> Teilen
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Prüfung je Veredelungsart: Meldungen, Klick wählt die betroffenen Objekte aus. */
export function PreflightCard() {
  const app = useApp();
  const pf = useUi((s) => s.preflight);
  const doc = useAppState((s) => s.doc);
  const [ml, setMl] = useState('');
  useEffect(() => {
    if (pf) setMl(pf.minLine != null ? String(pf.minLine).replace('.', ',') : '');
  }, [pf?.target, pf?.minLine]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bei Änderungen an der Zeichnung neu prüfen
  useEffect(() => {
    if (!pf) return;
    const t = setTimeout(() => void app.preflight(), 350);
    return () => clearTimeout(t);
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pf) return null;
  const r = pf.result;
  const rules = r?.rules ?? PREFLIGHT_RULES[pf.target];
  const icon = (s: string) => (s === 'error' ? '✕' : s === 'warn' ? '!' : '✓');
  return (
    <div className="preflight-card" role="dialog" aria-label="Prüfung" data-testid="preflight">
      <div className="row">
        <h3 className="spacer">Prüfen für</h3>
        <button className="icon-btn" onClick={() => app.closePreflight()} aria-label="Prüfung schließen">
          <X size={15} />
        </button>
      </div>
      <div className="row">
        <select value={pf.target} onChange={(e) => void app.preflight(e.target.value as PreflightTarget, null)} aria-label="Veredelungsart" data-testid="preflight-target">
          {(Object.keys(PREFLIGHT_RULES) as PreflightTarget[]).map((k) => (
            <option key={k} value={k}>
              {PREFLIGHT_RULES[k].name}
            </option>
          ))}
        </select>
        <label className="field small" title="Mindestbreite von Linien und Details">
          min.
          <input
            type="text"
            inputMode="decimal"
            value={ml}
            placeholder={String(PREFLIGHT_RULES[pf.target].minLine).replace('.', ',')}
            onChange={(e) => setMl(e.target.value)}
            onBlur={() => {
              const n = Number(ml.replace(',', '.'));
              void app.preflight(pf.target, ml.trim() && n > 0 ? n : null);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            style={{ width: 52 }}
            aria-label="Mindestbreite in mm"
            data-testid="preflight-minline"
          />
          mm
        </label>
      </div>
      <p className="muted small">{rules.hint}</p>
      {r && (
        <ul className="preflight-list">
          {r.issues.map((i, k) => (
            <li key={k} className={`sev-${i.severity}`}>
              <button
                onClick={() => {
                  if (!i.ids.length) return;
                  app.editor.select(i.ids);
                }}
                disabled={!i.ids.length}
              >
                <span className="sev">{icon(i.severity)}</span>
                <span>{i.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {r && r.colors.length > 0 && (
        <div className="preflight-colors" title="Druckfarben im Design">
          {r.colors.map((c) => (
            <span key={c} className="swatch" style={{ background: c }} title={c} />
          ))}
          <span className="muted small">
            {r.colors.length} Farbe{r.colors.length === 1 ? '' : 'n'}
          </span>
        </div>
      )}
      {pf.busy && <p className="muted small">Prüfe …</p>}
    </div>
  );
}
