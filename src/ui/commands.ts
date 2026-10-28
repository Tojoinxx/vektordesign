import type { ConstraintKind } from '../model/types';
import type { Settings } from '../store/state';
import { CONSTRAINT_LABELS } from '../solver/analysis';
import type { AppController } from './controller';
import { CONSTRAINT_ORDER } from './icons';

export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface Command {
  id: string;
  label: string;
  group: string;
  /** Anzeige in Tooltips und Befehlssuche */
  shortcut?: string;
  keys?: KeyBinding[];
  keywords?: string;
  run: (app: AppController) => void;
}

type BoolSetting = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];
const toggle = (app: AppController, key: BoolSetting) => {
  const s = app.store.getState().settings;
  app.store.setState({ settings: { ...s, [key]: !s[key] } });
};

const sel = (app: AppController) => app.editor.s.selection;
const report = (app: AppController, out: { ok: boolean; message?: string }) => {
  if (!out.ok && out.message) app.editor.toast(out.message, 'error');
};

export function buildCommands(): Command[] {
  const cmds: Command[] = [
    // Datei
    { id: 'file.new', label: 'Neue Zeichnung', group: 'Datei', shortcut: 'Strg+N', keys: [{ key: 'n', ctrl: true }], run: (a) => a.newDocument() },
    { id: 'file.open', label: 'Öffnen …', group: 'Datei', shortcut: 'Strg+O', keys: [{ key: 'o', ctrl: true }], run: (a) => void a.openDocument() },
    { id: 'file.save', label: 'Speichern', group: 'Datei', shortcut: 'Strg+S', keys: [{ key: 's', ctrl: true }], run: (a) => void a.saveDocument() },
    { id: 'file.saveAs', label: 'Speichern unter …', group: 'Datei', shortcut: 'Strg+Umschalt+S', keys: [{ key: 's', ctrl: true, shift: true }], run: (a) => void a.saveDocument(true) },
    { id: 'file.export', label: 'Exportieren …', group: 'Datei', shortcut: 'Strg+E', keys: [{ key: 'e', ctrl: true }], keywords: 'svg png datei', run: (a) => a.openExport('svg') },
    { id: 'file.exportSvg', label: 'Als SVG exportieren', group: 'Export', keywords: 'cricut silhouette illustrator', run: (a) => a.openExport('svg') },
    { id: 'file.exportPng', label: 'Als PNG exportieren (300 dpi)', group: 'Export', keywords: 'bild dtf druck', run: (a) => a.openExport('png', 300) },

    // Bearbeiten
    { id: 'edit.undo', label: 'Rückgängig', group: 'Bearbeiten', shortcut: 'Strg+Z', keys: [{ key: 'z', ctrl: true }], run: (a) => void a.editor.undo() },
    {
      id: 'edit.redo',
      label: 'Wiederholen',
      group: 'Bearbeiten',
      shortcut: 'Strg+Y',
      keys: [
        { key: 'y', ctrl: true },
        { key: 'z', ctrl: true, shift: true },
      ],
      run: (a) => void a.editor.redo(),
    },
    {
      id: 'edit.delete',
      label: 'Löschen',
      group: 'Bearbeiten',
      shortcut: 'Entf',
      keys: [{ key: 'Delete' }, { key: 'Backspace' }],
      run: (a) => {
        if (sel(a).length) report(a, a.editor.deleteSelection());
      },
    },
    { id: 'edit.selectAll', label: 'Alles auswählen', group: 'Bearbeiten', shortcut: 'Strg+A', keys: [{ key: 'a', ctrl: true }], run: (a) => a.editor.selectAll() },
    {
      id: 'edit.copy',
      label: 'Kopieren',
      group: 'Bearbeiten',
      shortcut: 'Strg+C',
      keys: [{ key: 'c', ctrl: true }],
      run: (a) => {
        const n = a.editor.copy();
        if (n) a.editor.toast(`${n} Objekt${n === 1 ? '' : 'e'} kopiert`, 'info', 1500);
      },
    },
    // Strg+V läuft über das „paste“-Ereignis (App.tsx): Bilder aus der Zwischenablage oder kopierte Objekte
    { id: 'edit.paste', label: 'Einfügen', group: 'Bearbeiten', shortcut: 'Strg+V', run: (a) => report(a, a.editor.paste()) },
    { id: 'edit.duplicate', label: 'Duplizieren', group: 'Bearbeiten', shortcut: 'Strg+D', keys: [{ key: 'd', ctrl: true }], run: (a) => report(a, a.editor.duplicate()) },
    {
      id: 'edit.construction',
      label: 'Auswahl ↔ Konstruktionsgeometrie',
      group: 'Format',
      shortcut: 'Q',
      keys: [{ key: 'q' }],
      keywords: 'hilfslinie gestrichelt',
      run: (a) => report(a, a.editor.toggleConstruction(sel(a))),
    },

    // Zeichnen
    { id: 'tool.select', label: 'Auswählen', group: 'Zeichnen', shortcut: 'Esc', run: (a) => a.setTool('select') },
    { id: 'tool.line', label: 'Linie', group: 'Zeichnen', shortcut: 'L', keys: [{ key: 'l' }], run: (a) => a.setTool('line') },
    { id: 'tool.rect', label: 'Rechteck', group: 'Zeichnen', shortcut: 'R', keys: [{ key: 'r' }], run: (a) => a.setTool('rect') },
    {
      id: 'tool.rect.corner',
      label: 'Rechteck über 2 Punkte',
      group: 'Zeichnen',
      run: (a) => {
        a.store.setState({ rectMode: 'corner' });
        a.setTool('rect');
      },
    },
    {
      id: 'tool.rect.center',
      label: 'Rechteck vom Mittelpunkt',
      group: 'Zeichnen',
      run: (a) => {
        a.store.setState({ rectMode: 'center' });
        a.setTool('rect');
      },
    },
    { id: 'tool.circle', label: 'Kreis', group: 'Zeichnen', shortcut: 'C', keys: [{ key: 'c' }], run: (a) => a.setTool('circle') },
    { id: 'tool.text', label: 'Text', group: 'Zeichnen', shortcut: 'T', keys: [{ key: 't' }], run: (a) => a.setTool('text') },
    { id: 'tool.point', label: 'Punkt', group: 'Zeichnen', shortcut: 'P', keys: [{ key: 'p' }], run: (a) => a.setTool('point') },
    { id: 'check.preflight', label: 'Prüfen für Veredelung (Preflight)', group: 'Prüfen', keywords: 'preflight check fehler linien zu fein plotter stick siebdruck dtf', run: (a) => void a.preflight() },
    { id: 'insert.image', label: 'Bild einfügen (Vorlage zum Nachzeichnen) …', group: 'Zeichnen', keywords: 'foto png jpg hintergrund nachzeichnen vorlage', run: (a) => void a.insertImage() },
    { id: 'tool.sketch', label: 'Freihandskizze mit Formerkennung', group: 'Zeichnen', shortcut: 'S', keys: [{ key: 's' }], keywords: 'freihand stift pencil skizze erkennung', run: (a) => a.setTool('sketch') },
    {
      id: 'draw.constructionMode',
      label: 'Neue Geometrie als Konstruktion',
      group: 'Zeichnen',
      keywords: 'hilfslinien gestrichelt',
      run: (a) => a.store.setState({ constructionMode: !a.store.getState().constructionMode }),
    },

    // Bemaßung
    { id: 'tool.dimension', label: 'Bemaßung', group: 'Bemaßung', shortcut: 'D', keys: [{ key: 'd' }], keywords: 'maß', run: (a) => a.setTool('dimension') },
    {
      id: 'view.dimDisplay',
      label: 'Bemaßungsanzeige: Wert / Name / Ausdruck',
      group: 'Bemaßung',
      run: (a) => {
        const s = a.store.getState().settings;
        const next = s.dimDisplay === 'value' ? 'name' : s.dimDisplay === 'name' ? 'expr' : 'value';
        a.store.setState({ settings: { ...s, dimDisplay: next } });
      },
    },

    // Format
    { id: 'tool.gradient', label: 'Farbverlauf ziehen', group: 'Format', shortcut: 'G', keys: [{ key: 'g' }], keywords: 'verlauf verblassen', run: (a) => a.setTool('gradient') },
    {
      id: 'design.suggestions',
      label: 'Stilvorschläge',
      group: 'Format',
      keywords: 'design ki vorschlag farbe',
      run: (a) => {
        a.ui.setState({ side: 'props', sideOpen: true });
        a.showTutorialFor('suggestions');
        document.getElementById('stilvorschlaege')?.scrollIntoView({ behavior: 'smooth' });
      },
    },

    // Anordnen
    { id: 'arrange.front', label: 'Ganz nach vorne', group: 'Anordnen', shortcut: 'Strg+Umschalt+]', keys: [{ key: ']', ctrl: true, shift: true }, { key: '}', ctrl: true, shift: true }], run: (a) => report(a, a.editor.arrange(sel(a), 'front')) },
    { id: 'arrange.forward', label: 'Nach vorne', group: 'Anordnen', shortcut: 'Strg+]', keys: [{ key: ']', ctrl: true }], run: (a) => report(a, a.editor.arrange(sel(a), 'forward')) },
    { id: 'arrange.backward', label: 'Nach hinten', group: 'Anordnen', shortcut: 'Strg+[', keys: [{ key: '[', ctrl: true }], run: (a) => report(a, a.editor.arrange(sel(a), 'backward')) },
    { id: 'arrange.back', label: 'Ganz nach hinten', group: 'Anordnen', shortcut: 'Strg+Umschalt+[', keys: [{ key: '[', ctrl: true, shift: true }, { key: '{', ctrl: true, shift: true }], run: (a) => report(a, a.editor.arrange(sel(a), 'back')) },

    // Gruppieren
    { id: 'arrange.group', label: 'Gruppieren', group: 'Anordnen', shortcut: 'Strg+G', keys: [{ key: 'g', ctrl: true }], run: (a) => report(a, a.editor.group()) },
    { id: 'arrange.ungroup', label: 'Gruppierung aufheben', group: 'Anordnen', shortcut: 'Strg+Umschalt+G', keys: [{ key: 'g', ctrl: true, shift: true }, { key: 'G', ctrl: true, shift: true }], run: (a) => report(a, a.editor.ungroup()) },

    // Ändern (Meilenstein 2)
    { id: 'tool.trim', label: 'Stutzen', group: 'Ändern', shortcut: 'X', keys: [{ key: 'x' }], keywords: 'trim abschneiden', run: (a) => a.setTool('trim') },
    { id: 'tool.extend', label: 'Dehnen', group: 'Ändern', shortcut: 'E', keys: [{ key: 'e' }], keywords: 'extend verlängern', run: (a) => a.setTool('extend') },
    { id: 'tool.measure', label: 'Messen', group: 'Messen', shortcut: 'M', keys: [{ key: 'm' }], keywords: 'abstand winkel fläche umfang', run: (a) => a.setTool('measure') },
    { id: 'edit.move', label: 'Verschieben …', group: 'Ändern', keywords: 'bewegen', run: (a) => a.editCommand('move') },
    { id: 'edit.rotate', label: 'Drehen …', group: 'Ändern', keywords: 'rotieren', run: (a) => a.editCommand('rotate') },
    { id: 'edit.scale', label: 'Skalieren …', group: 'Ändern', keywords: 'größe faktor', run: (a) => a.editCommand('scale') },
    { id: 'edit.mirror', label: 'Spiegeln …', group: 'Ändern', run: (a) => a.editCommand('mirror') },
    { id: 'edit.patternRect', label: 'Rechteckiges Muster …', group: 'Ändern', keywords: 'anordnung reihe raster', run: (a) => a.editCommand('pattern-rect') },
    { id: 'edit.patternCirc', label: 'Kreisförmiges Muster …', group: 'Ändern', keywords: 'polar rund', run: (a) => a.editCommand('pattern-circ') },
    { id: 'edit.offset', label: 'Versatz …', group: 'Form', shortcut: 'O', keys: [{ key: 'o' }], keywords: 'offset kontur rand', run: (a) => a.editCommand('offset') },
    { id: 'edit.fillet', label: 'Abrunden …', group: 'Form', keywords: 'radius ecke', run: (a) => a.editCommand('fillet') },
    { id: 'edit.chamfer', label: 'Fase …', group: 'Form', keywords: 'ecke abschrägen', run: (a) => a.editCommand('chamfer') },
    { id: 'edit.textToPaths', label: 'Text in Pfade umwandeln', group: 'Form', keywords: 'kontur umriss outline', run: (a) => a.editCommand('text-to-paths') },
    { id: 'edit.toShape', label: 'In Form umwandeln', group: 'Form', keywords: 'pfad fest', run: (a) => a.editCommand('to-shape') },
    { id: 'bool.union', label: 'Vereinigen', group: 'Kombinieren', keywords: 'boolesch addieren union', run: (a) => a.editCommand('union') },
    { id: 'bool.subtract', label: 'Subtrahieren', group: 'Kombinieren', keywords: 'boolesch abziehen ausschneiden', run: (a) => a.editCommand('subtract') },
    { id: 'bool.intersect', label: 'Schnittmenge', group: 'Kombinieren', keywords: 'boolesch', run: (a) => a.editCommand('intersect') },
    { id: 'bool.exclude', label: 'Ausschließen', group: 'Kombinieren', keywords: 'boolesch xor', run: (a) => a.editCommand('exclude') },
    { id: 'export.pdf', label: 'Als PDF exportieren …', group: 'Datei', keywords: 'druck', run: (a) => a.openExport('pdf') },
    { id: 'export.eps', label: 'Als EPS exportieren …', group: 'Datei', run: (a) => a.openExport('eps') },
    { id: 'export.dxf', label: 'Als DXF exportieren …', group: 'Datei', keywords: 'plotter cad', run: (a) => a.openExport('dxf') },

    // Produktion (LabwearOS)
    { id: 'prod.open', label: 'Produktion: Artikel, Motive, Varianten', group: 'Produktion', keywords: 'labwearos hoodie shirt veredelung siebdruck', run: (a) => a.ui.setState({ side: 'production', sideOpen: true }) },
    {
      id: 'prod.place',
      label: 'Motiv platzieren …',
      group: 'Produktion',
      keywords: 'brust rücken druckbereich kragen',
      run: (a) => {
        const d = a.editor.s.doc;
        a.ui.setState({ placement: d.production?.motifs[0]?.id ?? 'm1' });
      },
    },
    { id: 'prod.package', label: 'ZIP-Paket für LabwearOS exportieren', group: 'Produktion', keywords: 'export zip paket labwearos', run: (a) => void a.exportPackage() },
    { id: 'prod.sheet', label: 'Artwork-Blatt exportieren (PDF)', group: 'Produktion', keywords: 'pdf blatt platzierung', run: (a) => void a.exportArtworkSheet() },
    { id: 'prod.template', label: 'LabwearOS-Vorlage importieren (PDF/AI) …', group: 'Produktion', keywords: 'vorlage import pdf ai illustrator', run: (a) => void a.importTemplate('front') },

    // Ansicht
    { id: 'view.fit', label: 'Alles anzeigen', group: 'Ansicht', shortcut: 'F', keys: [{ key: 'f' }], keywords: 'zoom', run: (a) => a.editor.zoomToFit() },
    { id: 'view.zoomIn', label: 'Vergrößern', group: 'Ansicht', shortcut: '+', keys: [{ key: '+' }, { key: '=' }], run: (a) => zoomBy(a, 1.25) },
    { id: 'view.zoomOut', label: 'Verkleinern', group: 'Ansicht', shortcut: '−', keys: [{ key: '-' }], run: (a) => zoomBy(a, 0.8) },
    { id: 'view.zoom100', label: 'Originalgröße (100 %)', group: 'Ansicht', keywords: 'echt 1:1', run: (a) => a.editor.setView({ zoom: 96 / 25.4 }) },
    { id: 'view.grid', label: 'Raster ein/aus', group: 'Ansicht', run: (a) => toggle(a, 'grid') },
    { id: 'view.gridSnap', label: 'Am Raster fangen', group: 'Ansicht', run: (a) => toggle(a, 'gridSnap') },
    { id: 'view.dims', label: 'Bemaßungen ein/aus', group: 'Ansicht', run: (a) => toggle(a, 'showDims') },
    { id: 'view.overlay', label: 'Skizzenlinien ein/aus', group: 'Ansicht', keywords: 'vorschau design', run: (a) => toggle(a, 'showOverlay') },
    { id: 'view.theme.dark', label: 'Dunkles Design', group: 'Ansicht', keywords: 'darstellung dark mode nacht farbe', run: (a) => a.setAppearance({ theme: 'dark' }) },
    { id: 'view.theme.light', label: 'Helles Design', group: 'Ansicht', keywords: 'darstellung light mode tag farbe', run: (a) => a.setAppearance({ theme: 'light' }) },
    { id: 'view.theme.system', label: 'Design wie System', group: 'Ansicht', keywords: 'darstellung automatisch windows', run: (a) => a.setAppearance({ theme: 'system' }) },
    { id: 'view.canvas.auto', label: 'Zeichenfläche passend zum Design', group: 'Ansicht', keywords: 'hintergrund darstellung', run: (a) => a.setAppearance({ canvas: 'auto' }) },
    { id: 'view.canvas.light', label: 'Zeichenfläche hell', group: 'Ansicht', keywords: 'hintergrund weiß darstellung', run: (a) => a.setAppearance({ canvas: 'light' }) },
    { id: 'view.canvas.dark', label: 'Zeichenfläche dunkel', group: 'Ansicht', keywords: 'hintergrund schwarz darstellung', run: (a) => a.setAppearance({ canvas: 'dark' }) },
    {
      id: 'view.glyphsOn',
      label: 'Alle Abhängigkeiten anzeigen',
      group: 'Abhängigkeiten',
      shortcut: 'F8',
      keys: [{ key: 'F8' }],
      run: (a) => a.store.setState({ settings: { ...a.store.getState().settings, showGlyphs: true } }),
    },
    {
      id: 'view.glyphsOff',
      label: 'Alle Abhängigkeiten ausblenden',
      group: 'Abhängigkeiten',
      shortcut: 'F9',
      keys: [{ key: 'F9' }],
      run: (a) => a.store.setState({ settings: { ...a.store.getState().settings, showGlyphs: false } }),
    },
    { id: 'palette', label: 'Befehlssuche', group: 'Ansicht', shortcut: 'Strg+K', keys: [{ key: 'k', ctrl: true }], run: (a) => a.store.setState({ paletteOpen: true }) },

    // Claude
    {
      id: 'claude.open',
      label: 'Claude-Assistent',
      group: 'Claude',
      shortcut: 'Strg+I',
      keys: [{ key: 'i', ctrl: true }],
      keywords: 'ki agent chat bild nachbauen',
      run: (a) => {
        a.ui.setState({ side: 'claude', sideOpen: true });
        a.showTutorialFor('claude');
        setTimeout(() => document.getElementById('claude-eingabe')?.focus(), 50);
      },
    },
    {
      id: 'claude.reset',
      label: 'Neues Gespräch mit Claude',
      group: 'Claude',
      run: (a) => {
        a.agent.reset();
        a.ui.setState({ chat: [] });
      },
    },

    // Hilfe
    { id: 'help.tutorials', label: 'Tutorials', group: 'Hilfe', keywords: 'hilfe lernen anleitung', run: (a) => a.ui.setState({ tutorialList: true }) },
    { id: 'help.about', label: 'Über Vektordesign', group: 'Hilfe', run: (a) => a.ui.setState({ about: true }) },
  ];

  for (const kind of CONSTRAINT_ORDER) {
    cmds.push({
      id: `constraint.${kind}`,
      label: `Abhängigkeit: ${CONSTRAINT_LABELS[kind]}`,
      group: 'Abhängigkeiten',
      keywords: 'constraint',
      run: (a) => a.constraintCommand(kind as ConstraintKind),
    });
  }
  return cmds;
}

function zoomBy(a: AppController, f: number): void {
  const v = a.store.getState().view;
  a.editor.setView({ zoom: Math.min(400, Math.max(0.02, v.zoom * f)) });
}

/** Passt eine Taste zu einer Bindung? Buchstaben ohne Strg/Alt gelten nur ohne Modifikator. */
export function matchKey(e: KeyboardEvent, b: KeyBinding): boolean {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!!b.ctrl !== ctrl) return false;
  if (!!b.alt !== e.altKey) return false;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k !== b.key) return false;
  if (b.shift !== undefined) return !!b.shift === e.shiftKey;
  // Buchstaben-Kürzel ohne Umschalt
  if (/^[a-z]$/.test(b.key) && e.shiftKey && !b.ctrl) return false;
  return true;
}
