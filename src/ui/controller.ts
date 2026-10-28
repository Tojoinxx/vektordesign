import { createStore, type StoreApi } from 'zustand/vanilla';
import { ArcTool, EllipseTool, PenTool, PolygonTool, StarTool } from '../tools/shapeTools';
import type { ConstraintKind, Id, Vec2 } from '../model/types';
import { createAppStore, type AppStore, type ToolId } from '../store/state';
import { Editor, type PlacedPoint } from '../store/editor';
import type { SceneLayout } from '../render/renderer';
import type { Viewport } from '../render/viewport';
import { SelectTool } from '../tools/selectTool';
import { CircleTool, LineTool, PointTool, RectTool, TextTool } from '../tools/drawTools';
import { DimensionTool } from '../tools/dimensionTool';
import { ConstraintTool } from '../tools/constraintTool';
import { GradientTool } from '../tools/gradientTool';
import { CalibrateImageTool, MeasureTool, TrimExtendTool, type MeasureResult } from '../tools/editTools';
import { readImageFile } from '../model/image';
import { vectorize, type VectorizeDetail } from '../model/vectorize';
import { addShapeFromWorld } from '../model/shape';
import { newId } from '../model/doc';
import { buildBridgePrompt, parseScript, runScript } from '../assistant/bridge';
import type { AgentHost } from '../assistant/tools';
import { preflightTargetFor, runPreflight, type PreflightResult, type PreflightTarget } from '../model/preflight';
import { layersOf } from '../model/layers';
import { SketchTool } from '../tools/sketchTool';
import { booleanOp, cornerOp, offsetOp, patternOp, selectionCenter, selectionSize, textToPaths, toShape } from '../store/ops';
import type { BoolOp } from '../model/boolean';
import { evaluate } from '../params/expr';
import { docBBox } from '../model/bounds';
import { loadProfiles, profileById, saveProfiles, type ExportProfile } from '../model/profiles';
import { productionOf, articleBase, motifEntities, contrastWarnings } from '../model/production';
import type { GarmentView } from '../model/types';
import { buildPackage } from '../export/package';
import { buildArtworkSheet } from '../export/artworkSheet';
import { decodeImage, renderPdfPage } from '../platform/pdfImport';
import { deviceName, tauriLink, pickProjectWithLink, pickSaveTarget, ProjectSync, readMeta, type FileMeta, type ProjectLink, type SyncEvent } from '../platform/sync';
import type { DynamicInputSpec, Tool, ToolContext } from '../tools/types';
import { exportSvg } from '../export/svg';
import { exportPng, renderPreviewPng } from '../export/png';
import { parseDoc, serializeDoc, PROJECT_EXT } from '../model/serialize';
import { isTauri, setShareFallback, IMAGE_JPG_TYPE, IMAGE_PNG_TYPE, IMAGE_WEBP_TYPE, AI_TYPE, DXF_TYPE, EPS_TYPE, openFile, PDF_TYPE, TEMPLATE_TYPE, ZIP_TYPE, PNG_TYPE, PROJECT_TYPE, safeName, saveFile, SVG_TYPE } from '../platform/files';
import { attachImagePixels, buildScene, sceneHasImages, textOutlines } from '../export/scene';
import { exportPdf } from '../export/pdf';
import { gangPieces, layoutGang, type GangSheetSpec } from '../model/gangsheet';
import { buildSheetDocs, withoutCutLayer } from '../export/gangSheetExport';
import { buildScreenPrint, type ScreenPrintOptions } from '../export/screenPrint';
import { withWeeding } from '../model/weeding';
import { zipSync } from 'fflate';
import { exportEps } from '../export/eps';
import { exportDxf } from '../export/dxf';
import type { ExportFormat } from '../store/state';
import { Agent, type ChatEntry } from '../assistant/agent';
import { loadApiKey, loadModel } from '../assistant/api';
import { TUTORIALS, isTutorialSeen, markTutorialSeen, tutorialsEnabled, type TutorialId } from './tutorials';
import { applyAppearance, loadAppearance, onSystemThemeChange, saveAppearance, type Appearance } from './appearance';

export type SidePanel = 'props' | 'layers' | 'production' | 'claude';

export interface TextEditState {
  id: Id | null;
  at: PlacedPoint | null;
}

export interface UiState {
  dynamic: DynamicInputSpec | null;
  dynValues: Record<string, string>;
  /** Feld, das den Fokus bekommen soll (Zähler erzwingt Neufokus) */
  dynFocus: { key: string; n: number; char?: string } | null;
  textEdit: TextEditState | null;
  marking: { x: number; y: number } | null;
  tutorial: TutorialId | null;
  tutorialList: boolean;
  side: SidePanel;
  sideOpen: boolean;
  chat: ChatEntry[];
  chatBusy: boolean;
  cursorWorld: Vec2 | null;
  statusDetail: boolean;
  about: boolean;
  fileMenu: boolean;
  /** Design der Oberfläche und der Zeichenfläche */
  appearance: Appearance;
  appearanceMenu: boolean;
  /** Ergebnis des Messwerkzeugs */
  measure: MeasureResult | null;
  /** Eingabedialog für Bearbeiten-Befehle */
  paramDialog: ParamDialogSpec | null;
  ribbonTab: 'sketch' | 'edit';
  /** Werkzeugband eingeklappt (nur Registerkarten sichtbar) */
  ribbonCollapsed: boolean;
  /** Platzierungsansicht für ein Motiv (Id) */
  placement: Id | null;
  /** Export-Profile (Gerät) und Profil-Dialog */
  profiles: ExportProfile[];
  profileEditor: string | null;
  /** Fortschritt langer Exporte */
  busy: string | null;
  /** Mit Datei verbunden (Sync) */
  syncLinked: string | null;
  syncConflict: { text: string; meta: FileMeta; mode: 'watch' | 'save' } | null;
  /** Preflight-Ergebnis (Karte offen, solange gesetzt) */
  preflight: { target: PreflightTarget; minLine: number | null; result: PreflightResult | null; busy: boolean } | null;
  /** Mockup-Vorschau offen */
  mockup: boolean;
  /** DTF-/Transfer-Sammelbogen offen */
  gangSheet: boolean;
  /** Siebdruck-Paket offen */
  screenPrint: boolean;
  /** Kostenschätzung offen */
  costs: boolean;
  /** iPad: fertige Datei, die per Knopf geteilt wird */
  shareReady: { name: string; share: () => Promise<void> } | null;
}

export interface ParamField {
  key: string;
  label: string;
  unit?: string;
  value: string;
  kind?: 'number' | 'choice' | 'check';
  options?: { value: string; label: string }[];
  hint?: string;
}

export interface ParamDialogSpec {
  title: string;
  text?: string;
  fields: ParamField[];
  ok: string;
  run: (v: Record<string, string>) => void | Promise<void>;
}

export type EditCommand =
  | 'move'
  | 'rotate'
  | 'scale'
  | 'mirror'
  | 'pattern-rect'
  | 'pattern-circ'
  | 'offset'
  | 'fillet'
  | 'chamfer'
  | 'text-to-paths'
  | 'to-shape'
  | BoolOp;

export interface ExportRequest {
  format: ExportFormat;
  dpi: number;
  bounds: 'geometry' | 'stroke';
  mirror: boolean;
  /** Farbraum für PDF/EPS (Standard RGB) */
  colorMode?: 'rgb' | 'cmyk';
  /** Text als Pfade (SVG; PDF/EPS/DXF immer) – Standard: ja */
  outlines?: boolean;
  /** Entgitterungsrahmen (Plotter): Abstand in mm, Linien durch freie Streifen */
  weeding?: { margin: number; lines: boolean } | null;
}

export class AppController {
  readonly store: AppStore;
  readonly editor: Editor;
  readonly ui: StoreApi<UiState>;
  readonly agent: Agent;
  readonly agentHost: AgentHost;
  /** Verbindung zur geöffneten Projektdatei (Abgleich mit dem iPad) */
  readonly sync = new ProjectSync();
  private tools = new Map<string, Tool>();
  current: Tool;
  /** Wird von der Zeichenfläche gesetzt */
  canvas: { vp(): Viewport; layout(): SceneLayout | null; requestRender(): void } = {
    vp: () => ({ cx: 0, cy: 0, zoom: 4, width: 800, height: 600 }),
    layout: () => null,
    requestRender: () => {},
  };
  readonly ctx: ToolContext;

  constructor() {
    this.store = createAppStore();
    this.editor = new Editor(this.store);
    setShareFallback((name, share) => this.ui.setState({ shareReady: { name, share } }));
    this.ui = createStore<UiState>()(() => ({
      dynamic: null,
      dynValues: {},
      dynFocus: null,
      textEdit: null,
      marking: null,
      tutorial: null,
      tutorialList: false,
      side: 'props',
      sideOpen: true,
      chat: [],
      chatBusy: false,
      cursorWorld: null,
      statusDetail: false,
      about: false,
      fileMenu: false,
      appearance: loadAppearance(),
      appearanceMenu: false,
      measure: null,
      paramDialog: null,
      ribbonTab: 'sketch',
      ribbonCollapsed: (() => {
        try {
          return localStorage.getItem('vd.ribbon') === 'collapsed';
        } catch {
          return false;
        }
      })(),
      placement: null,
      profiles: loadProfiles(),
      profileEditor: null,
      busy: null,
      syncLinked: null,
      syncConflict: null,
      shareReady: null,
      preflight: null,
      mockup: false,
      gangSheet: false,
      screenPrint: false,
      costs: false,
    }));
    applyAppearance(this.ui.getState().appearance);
    // „Wie System“: Wechsel des Betriebssystem-Designs sofort übernehmen
    onSystemThemeChange(() => {
      const a = this.ui.getState().appearance;
      if (a.theme !== 'system') return;
      applyAppearance(a);
      this.canvas.requestRender();
    });
    const app = this;
    this.ctx = {
      editor: this.editor,
      vp: () => app.canvas.vp(),
      layout: () => app.canvas.layout(),
      requestRender: () => app.canvas.requestRender(),
      setDynamicInput: (spec) => app.ui.setState({ dynamic: spec }),
      dynamicValues: () => app.ui.getState().dynValues,
      clearDynamicValues: () => app.ui.setState({ dynValues: {}, dynFocus: null }),
      openDimEditor: (dimId, isNew) => app.store.setState({ dimPrompt: { dimId, isNew } }),
      openTextEditor: (id, at) => app.ui.setState({ textEdit: { id, at: at ?? null } }),
      setTool: (id) => app.setTool(id),
      snapExclude: () => {},
    };
    this.current = this.tool('select');
    this.agentHost = {
      editor: this.editor,
      renderPreview: () => renderPreviewPng(this.editor.s.doc, 768),
      openExport: (format, dpi) => this.openExport(format, dpi),
      fitView: () => this.editor.zoomToFit(),
    };
    this.agent = new Agent(
      this.agentHost,
      {
        apiKey: loadApiKey,
        model: loadModel,
        onEntry: (e) => this.ui.setState({ chat: [...this.ui.getState().chat, e] }),
        onBusy: (b) => this.ui.setState({ chatBusy: b }),
      },
    );
  }

  // -------------------------------------------------------------------------
  // Werkzeuge
  // -------------------------------------------------------------------------

  tool(id: ToolId): Tool {
    let t = this.tools.get(id);
    if (t) return t;
    switch (id) {
      case 'select':
        t = new SelectTool(this.ctx);
        break;
      case 'line':
        t = new LineTool(this.ctx);
        break;
      case 'rect':
        t = new RectTool(this.ctx);
        break;
      case 'circle':
        t = new CircleTool(this.ctx);
        break;
      case 'arc':
        t = new ArcTool(this.ctx);
        break;
      case 'ellipse':
        t = new EllipseTool(this.ctx);
        break;
      case 'polygon':
        t = new PolygonTool(this.ctx);
        break;
      case 'star':
        t = new StarTool(this.ctx);
        break;
      case 'pen':
        t = new PenTool(this.ctx);
        break;
      case 'text':
        t = new TextTool(this.ctx);
        break;
      case 'point':
        t = new PointTool(this.ctx);
        break;
      case 'dimension':
        t = new DimensionTool(this.ctx);
        break;
      case 'gradient':
        t = new GradientTool(this.ctx);
        break;
      case 'trim':
      case 'extend':
        t = new TrimExtendTool(this.ctx, id);
        break;
      case 'measure':
        t = new MeasureTool(this.ctx, (r) => this.ui.setState({ measure: r }));
        break;
      case 'sketch':
        t = new SketchTool(this.ctx);
        break;
      case 'imgcalib':
        t = new CalibrateImageTool(this.ctx, (a, b) => this.finishImageCalibration(a, b));
        break;
      default:
        if (id.startsWith('constraint:')) t = new ConstraintTool(this.ctx, id.slice('constraint:'.length) as ConstraintKind);
        else t = new SelectTool(this.ctx);
    }
    this.tools.set(id, t);
    return t;
  }

  setTool(id: ToolId): void {
    if (this.current.id === id && id !== 'select') return;
    this.current.deactivate?.();
    this.ui.setState({ dynamic: null, dynValues: {}, dynFocus: null });
    this.current = this.tool(id);
    this.current.activate?.();
    this.store.setState({ tool: id, hover: null });
    this.showTutorialFor(id);
    this.canvas.requestRender();
  }

  /** Abhängigkeit: mit passender Auswahl sofort anwenden, sonst Werkzeug starten. */
  constraintCommand(kind: ConstraintKind): void {
    const sel = this.editor.s.selection;
    if (sel.length) {
      const norm = this.editor.normalizeConstraint(this.editor.s.doc, kind, sel);
      if ('refs' in norm) {
        const out = this.editor.addConstraint(kind, sel);
        if (!out.ok) this.editor.toast(out.message, 'error');
        return;
      }
    }
    this.editor.select([]);
    this.setTool(`constraint:${kind}`);
  }

  /** Esc: laufende Aktion abbrechen, sonst zurück zur Auswahl. */
  escape(): void {
    const ui = this.ui.getState();
    if (ui.marking) {
      this.ui.setState({ marking: null });
      return;
    }
    if (this.current.cancel?.()) return;
    if (this.current.id !== 'select') this.setTool('select');
    else this.editor.select([]);
  }

  // -------------------------------------------------------------------------
  // Tutorials
  // -------------------------------------------------------------------------

  showTutorialFor(id: ToolId | TutorialId): void {
    const key = (id.startsWith('constraint:') ? 'constraints' : id) as TutorialId;
    if (!TUTORIALS[key]) return;
    if (!tutorialsEnabled() || isTutorialSeen(key)) return;
    this.ui.setState({ tutorial: key });
  }

  closeTutorial(dontShowAgain = true): void {
    const t = this.ui.getState().tutorial;
    if (t && dontShowAgain) markTutorialSeen(t);
    this.ui.setState({ tutorial: null });
  }

  // -------------------------------------------------------------------------
  // Dateien
  // -------------------------------------------------------------------------

  private projectName(): string {
    const s = this.editor.s;
    return s.fileName?.replace(/\.[^.]+$/, '') ?? s.doc.name ?? 'Unbenannt';
  }

  newDocument(): void {
    const run = () => {
      this.editor.newDocument();
      this.sync.detach();
      this.ui.setState({ syncLinked: null });
      this.ui.setState({ chat: [] });
      this.agent.reset();
      this.editor.zoomToFit();
    };
    if (this.editor.s.dirty && Object.keys(this.editor.s.doc.entities).length) {
      this.editor.confirm({
        title: 'Neue Zeichnung',
        text: 'Ungespeicherte Änderungen gehen verloren. Trotzdem eine neue Zeichnung beginnen?',
        confirm: 'Neue Zeichnung',
        cancel: 'Abbrechen',
        onConfirm: run,
      });
    } else run();
  }

  async openDocument(): Promise<void> {
    if (this.editor.s.dirty && Object.keys(this.editor.s.doc.entities).length) {
      this.editor.confirm({
        title: 'Projekt öffnen',
        text: 'Die aktuelle Zeichnung hat ungespeicherte Änderungen. Trotzdem ein anderes Projekt öffnen?',
        confirm: 'Öffnen',
        cancel: 'Abbrechen',
        onConfirm: () => void this.openDocumentNow(),
      });
      return;
    }
    await this.openDocumentNow();
  }

  /** Öffnet eine Projektdatei; Desktop-App und Chrome/Edge bleiben mit der Datei verbunden (Sync). */
  async openDocumentNow(file?: { name: string; text: string; link?: ProjectLink | null; mtime?: number }): Promise<boolean> {
    try {
      let f = file ?? null;
      if (!f) {
        const picked = await pickProjectWithLink();
        if (picked === null) return false;
        if (picked === 'unsupported') {
          const o = await openFile([PROJECT_TYPE]);
          if (!o) return false;
          f = { name: o.name, text: new TextDecoder().decode(o.data), link: null };
        } else f = picked;
      }
      const doc = parseDoc(f.text);
      const meta = readMeta(f.text);
      this.sync.stopWatching();
      this.sync.attach(f.link ?? null, meta, f.mtime ?? 0);
      this.editor.loadDocument(doc, f.name, null);
      this.watchFile();
      const by = meta?.savedBy ? `, zuletzt gespeichert auf ${meta.savedBy}${meta.savedAt ? ` (${new Date(meta.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })})` : ''}` : '';
      this.editor.toast(`„${f.name}“ geöffnet${by}`, 'success', 3500);
      return true;
    } catch (e) {
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
      return false;
    }
  }

  private watchFile(): void {
    if (!this.sync.link) return;
    this.ui.setState({ syncLinked: this.sync.link.name });
    this.sync.startWatching(
      () => this.editor.s.dirty,
      (ev) => this.onSyncEvent(ev),
    );
  }

  private onSyncEvent(ev: SyncEvent): void {
    if (ev.kind === 'reloaded') {
      try {
        this.editor.replaceDocument(parseDoc(ev.text));
        this.editor.toast(`Änderungen von ${ev.meta.savedBy || 'einem anderen Gerät'} übernommen`, 'success', 4000);
      } catch (e) {
        this.editor.toast(`Neuer Stand konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000);
      }
    } else if (ev.kind === 'conflict') {
      this.ui.setState({ syncConflict: { text: ev.text, meta: ev.meta, mode: 'watch' } });
    }
  }

  /** Konflikt auflösen: fremde Version laden, eigene behalten oder beide behalten. */
  async resolveConflict(choice: 'theirs' | 'mine' | 'both'): Promise<void> {
    const c = this.ui.getState().syncConflict;
    if (!c) return;
    this.ui.setState({ syncConflict: null });
    if (choice === 'theirs') {
      this.editor.replaceDocument(parseDoc(c.text));
      this.sync.adopt(c.meta);
      this.editor.toast(`Version von ${c.meta.savedBy || 'dem anderen Gerät'} geladen`, 'success');
      return;
    }
    if (choice === 'mine') {
      this.sync.acknowledge(c.meta);
      if (c.mode === 'save') await this.saveDocument();
      else this.editor.toast('Deine Version bleibt. Beim nächsten Speichern wird die Datei überschrieben.', 'info', 5000);
      return;
    }
    // Beide behalten: eigene Fassung als Kopie sichern, dann fremde laden
    const copyName = `${safeName(this.projectName())} (Konflikt ${deviceName()}).${PROJECT_EXT}`;
    const res = await saveFile(serializeDoc({ ...this.editor.s.doc, name: this.projectName() }, { revision: this.sync.revision, savedBy: deviceName(), projectId: this.sync.projectId }), copyName, PROJECT_TYPE, null);
    if (!res) {
      this.ui.setState({ syncConflict: c });
      return;
    }
    this.editor.replaceDocument(parseDoc(c.text));
    this.sync.adopt(c.meta);
    this.editor.toast(`Deine Fassung liegt in „${res.name}“, geöffnet ist jetzt die Version von ${c.meta.savedBy || 'dem anderen Gerät'}.`, 'success', 6000);
  }

  async saveDocument(saveAs = false): Promise<void> {
    const s = this.editor.s;
    try {
      const name = `${safeName(this.projectName())}.${PROJECT_EXT}`;
      let link = saveAs ? null : this.sync.link;
      if (!link && !saveAs && s.filePath && isTauri()) {
        link = tauriLink(s.filePath);
        this.sync.attach(link, { revision: this.sync.revision, savedBy: '', savedAt: '', projectId: this.sync.projectId }, 0);
      }
      if (!link) {
        const picked = await pickSaveTarget(s.fileName && !saveAs ? s.fileName : name);
        if (picked === null) return;
        if (picked !== 'unsupported') {
          link = picked;
          this.sync.stopWatching();
          this.sync.attach(link, { revision: this.sync.revision, savedBy: '', savedAt: '', projectId: this.sync.projectId }, 0);
        }
      }
      if (link) {
        const check = await this.sync.checkBeforeSave();
        if (check.kind === 'conflict') {
          this.ui.setState({ syncConflict: { text: check.text, meta: check.meta, mode: 'save' } });
          return;
        }
        const text = serializeDoc({ ...s.doc, name: this.projectName() }, { revision: check.nextRevision, savedBy: deviceName(), projectId: this.sync.projectId });
        await link.write(text);
        await this.sync.saved(check.nextRevision);
        this.store.setState({ fileName: link.name, filePath: null, dirty: false });
        this.watchFile();
        this.editor.toast(`Gespeichert: ${link.name}`, 'success', 2500);
        return;
      }
      // Ohne Dateizugriff (iPad/Safari): Teilen-Menü bzw. Download – „In Dateien sichern“ → ersetzen
      const rev = this.sync.revision + 1;
      const res = await saveFile(serializeDoc({ ...s.doc, name: this.projectName() }, { revision: rev, savedBy: deviceName(), projectId: this.sync.projectId }), s.fileName ?? name, PROJECT_TYPE, null);
      if (!res) return;
      await this.sync.saved(rev);
      this.store.setState({ fileName: res.name, filePath: res.path, dirty: false });
      this.editor.toast(`Gespeichert: ${res.name}`, 'success', 2500);
    } catch (e) {
      this.editor.toast(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000);
    }
  }

  // -------------------------------------------------------------------------
  // Bearbeiten (Meilenstein 2)
  // -------------------------------------------------------------------------

  private async runOp(p: Promise<{ ok: boolean; message?: string }> | { ok: boolean; message?: string }): Promise<boolean> {
    try {
      const out = await p;
      if (!out.ok && out.message) this.editor.toast(out.message, 'error', 6000);
      return out.ok;
    } catch (e) {
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
      return false;
    }
  }

  /** Bearbeiten-Befehle: direkt ausführen oder Eingabedialog öffnen. */
  editCommand(cmd: EditCommand): void {
    const ed = this.editor;
    const sel = ed.s.selection;
    const doc = ed.s.doc;
    const needSel = () => {
      if (!sel.length) {
        ed.toast('Zuerst Objekte auswählen.', 'info', 3000);
        return true;
      }
      return false;
    };
    const num = (v: string, name: string): number => {
      try {
        return evaluate(v.trim() || '0');
      } catch {
        throw new Error(`${name}: „${v}“ ist keine Zahl.`);
      }
    };
    const pivot = (v: string) => (v === 'origin' ? { x: 0, y: 0 } : selectionCenter(this.editor.s.doc, sel) ?? { x: 0, y: 0 });
    const pivotField: ParamField = {
      key: 'pivot',
      label: 'Bezugspunkt',
      value: 'center',
      kind: 'choice',
      options: [
        { value: 'center', label: 'Mitte der Auswahl' },
        { value: 'origin', label: 'Ursprung' },
      ],
    };
    const copyField: ParamField = { key: 'copy', label: 'Als Kopie', value: '', kind: 'check' };
    const open = (spec: ParamDialogSpec) => this.ui.setState({ paramDialog: spec });
    switch (cmd) {
      case 'union':
      case 'subtract':
      case 'intersect':
      case 'exclude':
        if (!needSel()) void this.runOp(booleanOp(ed, cmd));
        return;
      case 'text-to-paths':
        if (!needSel()) void this.runOp(textToPaths(ed));
        return;
      case 'to-shape':
        if (!needSel()) void this.runOp(toShape(ed));
        return;
      case 'move':
        if (needSel()) return;
        open({
          title: 'Verschieben',
          fields: [{ key: 'dx', label: 'Waagrecht', unit: 'mm', value: '10' }, { key: 'dy', label: 'Senkrecht', unit: 'mm', value: '0' }, copyField],
          ok: 'Verschieben',
          run: (v) => void this.runOp(ed.transform({ kind: 'move', dx: num(v.dx, 'Waagrecht'), dy: num(v.dy, 'Senkrecht') }, { copy: !!v.copy })),
        });
        return;
      case 'rotate':
        if (needSel()) return;
        open({
          title: 'Drehen',
          text: 'Positive Winkel drehen gegen den Uhrzeigersinn.',
          fields: [{ key: 'angle', label: 'Winkel', unit: '°', value: '90' }, pivotField, copyField],
          ok: 'Drehen',
          run: (v) => {
            const c = pivot(v.pivot);
            void this.runOp(ed.transform({ kind: 'rotate', angle: num(v.angle, 'Winkel'), cx: c.x, cy: c.y }, { copy: !!v.copy }));
          },
        });
        return;
      case 'scale': {
        if (needSel()) return;
        const size = selectionSize(doc, sel);
        open({
          title: 'Skalieren',
          text: size ? `Aktuelle Größe: ${fmt(size.w)} × ${fmt(size.h)} mm. Entweder Faktor oder neue Breite angeben.` : undefined,
          fields: [
            { key: 'factor', label: 'Faktor', unit: '%', value: '100' },
            { key: 'width', label: 'Neue Breite', unit: 'mm', value: '', hint: 'leer = Faktor gilt' },
            pivotField,
            copyField,
          ],
          ok: 'Skalieren',
          run: (v) => {
            let k = num(v.factor, 'Faktor') / 100;
            if (v.width.trim() && size && size.w > 0) k = num(v.width, 'Neue Breite') / size.w;
            if (!(k > 0)) throw new Error('Der Faktor muss größer als 0 sein.');
            const c = pivot(v.pivot);
            void this.runOp(ed.transform({ kind: 'scale', k, cx: c.x, cy: c.y }, { copy: !!v.copy }));
          },
        });
        return;
      }
      case 'mirror':
        if (needSel()) return;
        open({
          title: 'Spiegeln',
          fields: [
            {
              key: 'axis',
              label: 'Richtung',
              value: 'y',
              kind: 'choice',
              options: [
                { value: 'y', label: 'Links ↔ rechts' },
                { value: 'x', label: 'Oben ↕ unten' },
              ],
            },
            pivotField,
            { ...copyField, value: '1' },
          ],
          ok: 'Spiegeln',
          run: (v) => {
            const c = pivot(v.pivot);
            void this.runOp(ed.transform({ kind: 'mirror', axis: v.axis === 'x' ? 'x' : 'y', cx: c.x, cy: c.y }, { copy: !!v.copy }));
          },
        });
        return;
      case 'pattern-rect':
        if (needSel()) return;
        open({
          title: 'Rechteckiges Muster',
          fields: [
            { key: 'nx', label: 'Spalten', value: '3' },
            { key: 'ny', label: 'Zeilen', value: '1' },
            { key: 'dx', label: 'Abstand waagrecht', unit: 'mm', value: '20' },
            { key: 'dy', label: 'Abstand senkrecht', unit: 'mm', value: '20' },
          ],
          ok: 'Muster erzeugen',
          run: (v) => void this.runOp(patternOp(ed, { kind: 'rect', nx: Math.round(num(v.nx, 'Spalten')), ny: Math.round(num(v.ny, 'Zeilen')), dx: num(v.dx, 'Abstand'), dy: num(v.dy, 'Abstand') })),
        });
        return;
      case 'pattern-circ':
        if (needSel()) return;
        open({
          title: 'Kreisförmiges Muster',
          fields: [{ key: 'n', label: 'Anzahl', value: '6' }, { key: 'angle', label: 'Gesamtwinkel', unit: '°', value: '360' }, { ...pivotField, label: 'Mittelpunkt', value: 'origin' }],
          ok: 'Muster erzeugen',
          run: (v) => {
            const c = pivot(v.pivot);
            void this.runOp(patternOp(ed, { kind: 'circ', n: Math.round(num(v.n, 'Anzahl')), angle: num(v.angle, 'Winkel'), cx: c.x, cy: c.y }));
          },
        });
        return;
      case 'offset':
        if (needSel()) return;
        open({
          title: 'Versatz',
          text: 'Erzeugt eine neue Kontur im Abstand um die Auswahl, z. B. als Rand oder Entgitterungshilfe. Negativ = nach innen.',
          fields: [
            { key: 'd', label: 'Abstand', unit: 'mm', value: '2' },
            {
              key: 'join',
              label: 'Ecken',
              value: 'round',
              kind: 'choice',
              options: [
                { value: 'round', label: 'Rund' },
                { value: 'miter', label: 'Spitz' },
              ],
            },
          ],
          ok: 'Versatz erzeugen',
          run: (v) => void this.runOp(offsetOp(ed, num(v.d, 'Abstand'), v.join === 'miter' ? 'miter' : 'round')),
        });
        return;
      case 'fillet':
      case 'chamfer':
        if (needSel()) return;
        open({
          title: cmd === 'fillet' ? 'Abrunden' : 'Fase',
          text: 'Wirkt auf alle Ecken der gewählten Flächen. Skizzenflächen werden dabei zu Formen (ihre Bemaßungen entfallen).',
          fields: [{ key: 'r', label: cmd === 'fillet' ? 'Radius' : 'Abstand', unit: 'mm', value: '3' }],
          ok: cmd === 'fillet' ? 'Abrunden' : 'Fase anlegen',
          run: (v) => {
            const r = num(v.r, 'Radius');
            if (!(r > 0)) throw new Error('Der Wert muss größer als 0 sein.');
            void this.runOp(cornerOp(ed, r, cmd));
          },
        });
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Produktion (Meilenstein 3)
  // -------------------------------------------------------------------------

  saveProfile(p: ExportProfile): void {
    const list = this.ui.getState().profiles.map((x) => (x.id === p.id ? p : x));
    if (!list.some((x) => x.id === p.id)) list.push(p);
    saveProfiles(list);
    this.ui.setState({ profiles: list });
  }

  resetProfile(id: string): void {
    const list = this.ui.getState().profiles.filter((x) => x.id !== id);
    saveProfiles(list);
    this.ui.setState({ profiles: loadProfiles() });
  }

  currentProfile(): ExportProfile {
    return profileById(productionOf(this.editor.s.doc).profileId, this.ui.getState().profiles);
  }

  private async pngBytes(doc: import('../model/types').SketchDoc, dpi: number, mirror: boolean, bounds: 'geometry' | 'stroke'): Promise<Uint8Array> {
    return (await exportPng(doc, { dpi, mirror, bounds })).bytes;
  }

  /** Ein-Klick-Paket (ZIP) mit allen Motiven, Varianten und dem Artwork-Blatt. */
  async exportPackage(path?: string | null, force = false): Promise<boolean> {
    const doc = this.editor.s.doc;
    const p = productionOf(doc);
    const profile = this.currentProfile();
    if (!force) {
      // Vorher je Motiv prüfen (Veredelungsart)
      const { outlines } = await textOutlines(doc).catch(() => ({ outlines: new Map() }));
      const problems: string[] = [];
      for (const m of p.motifs) {
        const only = new Set(motifEntities(doc, m).map((e) => e.id));
        if (!only.size) continue;
        const r = runPreflight(doc, preflightTargetFor(m.technique), { only, outlines });
        for (const i of r.issues) if (i.severity === 'error') problems.push(`${m.name}: ${i.message}`);
      }
      if (problems.length) {
        this.editor.confirm({
          title: 'Prüfung meldet Probleme',
          text: `${problems.slice(0, 4).join('\n')}${problems.length > 4 ? `\n… und ${problems.length - 4} weitere` : ''}\n\nDetails unter „Bearbeiten → Prüfen“. Trotzdem exportieren?`,
          confirm: 'Trotzdem exportieren',
          cancel: 'Abbrechen',
          onConfirm: () => void this.exportPackage(path, true),
        });
        return false;
      }
    }
    this.ui.setState({ busy: 'Paket wird erstellt …' });
    try {
      const res = await buildPackage(doc, p, profile, {
        renderPng: (d, dpi, mirror, bounds) => this.pngBytes(d, dpi, mirror, bounds),
        decodeTemplate: (t) => decodeImage(t.image),
        decodeImage: (src) => decodeImage(src, 2400),
        onProgress: (t) => this.ui.setState({ busy: t }),
      });
      this.ui.setState({ busy: null });
      const saved = await saveFile(res.zip, res.fileName, ZIP_TYPE, path);
      if (!saved) return false;
      const n = res.files.filter((f) => f.includes('/Motive/')).length;
      this.editor.toast(`Paket ${res.fileName} exportiert: ${n} Motivdateien${profile.sheet ? ' und Artwork-Blatt' : ''}`, 'success', 5000);
      for (const w of res.warnings) this.editor.toast(w, 'info', 8000);
      return true;
    } catch (e) {
      this.ui.setState({ busy: null });
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 7000);
      return false;
    }
  }

  async exportArtworkSheet(path?: string | null): Promise<boolean> {
    const doc = this.editor.s.doc;
    const p = productionOf(doc);
    const profile = this.currentProfile();
    try {
      this.ui.setState({ busy: 'Artwork-Blatt wird erstellt …' });
      const bytes = await buildArtworkSheet(doc, p, { colorMode: profile.colorMode, decodeTemplate: (t) => decodeImage(t.image) });
      this.ui.setState({ busy: null });
      const saved = await saveFile(bytes, `${articleBase(p)}_Artwork-Blatt.pdf`, PDF_TYPE, path);
      if (saved) this.editor.toast('Artwork-Blatt exportiert', 'success');
      return !!saved;
    } catch (e) {
      this.ui.setState({ busy: null });
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 7000);
      return false;
    }
  }

  /** Siebdruck-Paket (Filme je Farbe, Andruck) als ZIP speichern. */
  async exportScreenPrint(motifId: string, variantId: string, opts: Partial<ScreenPrintOptions>, path?: string | null): Promise<boolean> {
    const doc = this.editor.s.doc;
    const p = productionOf(doc);
    const m = p.motifs.find((x) => x.id === motifId) ?? p.motifs[0];
    const v = p.variants.find((x) => x.id === variantId) ?? p.variants[0];
    if (!m || !v) {
      this.editor.toast('Kein Motiv vorhanden.', 'error');
      return false;
    }
    const cur = JSON.stringify(p.screenPrint ?? null);
    const next = { underbase: opts.underbase, choke: opts.choke, trap: opts.trap, dropFabricColor: opts.dropFabricColor, marks: opts.marks, mirror: opts.mirror };
    if (cur !== JSON.stringify(next))
      this.editor.updateProduction('Siebdruck-Einstellungen', (q) => {
        q.screenPrint = next;
      });
    try {
      this.ui.setState({ busy: 'Siebdruck-Filme werden erstellt …' });
      const r = await buildScreenPrint(doc, p, m, v, opts);
      this.ui.setState({ busy: null });
      const saved = await saveFile(r.zip, r.fileName, ZIP_TYPE, path);
      if (saved) this.editor.toast(`Siebdruck-Paket gespeichert: ${r.separation.plates.length} Filme${r.warnings.length ? ` – ${r.warnings.length} Hinweis${r.warnings.length === 1 ? '' : 'e'} in LIESMICH.txt` : ''}`, 'success', 6000);
      return !!saved;
    } catch (e) {
      this.ui.setState({ busy: null });
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 7000);
      return false;
    }
  }

  /** Sammelbogen-Einstellungen im Projekt speichern (ein Rückgängig-Schritt). */
  saveGangSheet(spec: GangSheetSpec): void {
    const cur = JSON.stringify((productionOf(this.editor.s.doc) as { gangSheet?: GangSheetSpec }).gangSheet ?? null);
    if (cur === JSON.stringify(spec)) return;
    this.editor.updateProduction('Sammelbogen', (p) => {
      p.gangSheet = JSON.parse(JSON.stringify(spec)) as GangSheetSpec;
    });
  }

  /**
   * Sammelbogen exportieren: PDF (Vektor, Schnittlinien als eigene Ebene), PNG 300 dpi
   * (transparent, ohne Schnittlinien) oder SVG. Mehrere Bögen kommen als ZIP.
   */
  async exportGangSheet(spec: GangSheetSpec, format: 'pdf' | 'png' | 'svg', path?: string | null): Promise<boolean> {
    const doc = this.editor.s.doc;
    const p = productionOf(doc);
    try {
      const pieces = gangPieces(doc, spec, p);
      if (!pieces.length) throw new Error('Der Sammelbogen ist leer: Stückzahlen bei den Motiven eintragen oder Namen/Nummern hinzufügen.');
      this.ui.setState({ busy: 'Sammelbogen wird erstellt …' });
      const layout = layoutGang(pieces, spec);
      const sheets = await buildSheetDocs(layout, spec, { cutLines: spec.cutLines && format !== 'png', name: p.article });
      const base = `${articleBase(p)}_Sammelbogen_${Math.round(spec.width)}mm${spec.mirror ? '_gespiegelt' : ''}`;
      const files: { name: string; data: Uint8Array }[] = [];
      for (const sh of sheets) {
        const name = `${base}${sheets.length > 1 ? `_Bogen${sh.index + 1}` : ''}`;
        if (format === 'pdf') {
          const scene = buildScene(sh.doc, { frame: sh.frame });
          await attachImagePixels(scene, (src) => decodeImage(src, 2400));
          files.push({ name: `${name}.pdf`, data: exportPdf(scene, { title: name }) });
        } else if (format === 'png') {
          const r = await exportPng(withoutCutLayer(sh.doc), { dpi: 300, frame: sh.frame, background: null });
          files.push({ name: `${name}.png`, data: r.bytes });
        } else {
          files.push({ name: `${name}.svg`, data: new TextEncoder().encode(exportSvg(sh.doc, { frame: sh.frame, title: name }).svg) });
        }
      }
      this.ui.setState({ busy: null });
      const type = format === 'pdf' ? PDF_TYPE : format === 'png' ? PNG_TYPE : SVG_TYPE;
      const saved =
        files.length === 1
          ? await saveFile(files[0].data, files[0].name, type, path)
          : await saveFile(zipSync(Object.fromEntries(files.map((f) => [f.name, f.data]))), `${base}.zip`, ZIP_TYPE, path);
      if (saved) {
        const len = sheets.reduce((s, x) => s + x.length, 0) / 1000;
        this.editor.toast(`Sammelbogen exportiert: ${sheets.length} Bogen, ${len.toFixed(2).replace('.', ',')} m${layout.tooWide.length ? ` – ${layout.tooWide.length} Stück zu breit, nicht enthalten` : ''}`, layout.tooWide.length ? 'error' : 'success', 6000);
      }
      return !!saved;
    } catch (e) {
      this.ui.setState({ busy: null });
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 7000);
      return false;
    }
  }

  /** Vorlage (PDF/AI) als Hintergrund der Platzierung importieren. */
  async importTemplate(view: GarmentView, file?: { name: string; data: Uint8Array }, pageNo = 1): Promise<boolean> {
    const f = file ?? (await openFile([TEMPLATE_TYPE, AI_TYPE]));
    if (!f) return false;
    try {
      this.ui.setState({ busy: 'Vorlage wird gelesen …' });
      const r = await renderPdfPage(f.data, pageNo);
      this.ui.setState({ busy: null });
      const out = this.editor.updateProduction('Vorlage importieren', (p) => {
        p.templates = { ...(p.templates ?? {}) };
        p.templates[view] = { name: f.name, image: r.image, widthMm: r.widthMm, heightMm: r.heightMm, originX: r.widthMm / 2, originY: r.heightMm * 0.18 };
      });
      if (!out.ok) {
        this.editor.toast(out.message, 'error');
        return false;
      }
      this.editor.toast(
        `Vorlage „${f.name}“ importiert (${Math.round(r.widthMm)} × ${Math.round(r.heightMm)} mm${r.pages > 1 ? `, Seite ${pageNo} von ${r.pages}` : ''}). Jetzt den Bezugspunkt und den Maßstab festlegen.`,
        'success',
        7000,
      );
      return true;
    } catch (e) {
      this.ui.setState({ busy: null });
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 8000);
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Claude ohne API-Schlüssel (Abo-Brücke)
  // -------------------------------------------------------------------------

  private chatAdd(e: { role: ChatEntry['role']; text: string; images?: []; error?: boolean }): void {
    const entry = { images: [], ...e, id: Date.now() + Math.random() } as unknown as ChatEntry;
    this.ui.setState({ chat: [...this.ui.getState().chat, entry] });
  }

  /** Auftrag samt Zeichnung für claude.ai in die Zwischenablage legen. */
  async copyBridgePrompt(request: string): Promise<string> {
    const text = buildBridgePrompt(this.agentHost, request);
    try {
      await navigator.clipboard.writeText(text);
      this.editor.toast('Auftrag kopiert – jetzt in claude.ai einfügen und senden.', 'success', 4000);
    } catch {
      this.editor.toast('Kopieren nicht erlaubt – bitte den Text im Feld markieren und kopieren.', 'info', 5000);
    }
    this.chatAdd({ role: 'user', text: request || '(Auftrag ohne Text)', images: [] });
    this.chatAdd({ role: 'action', text: 'Auftrag für claude.ai kopiert – Antwort unten einfügen' });
    return text;
  }

  /** Antwort aus claude.ai ausführen. */
  async runBridgeReply(reply: string): Promise<boolean> {
    try {
      const steps = parseScript(reply);
      const rep = await runScript(this.agentHost, steps);
      const intro = reply.split('```')[0].trim();
      if (intro) this.chatAdd({ role: 'assistant', text: intro.slice(0, 600) });
      for (const l of rep.lines) this.chatAdd({ role: 'action', text: l.text, error: l.error });
      this.editor.toast(`${rep.done} Schritt${rep.done === 1 ? '' : 'e'} ausgeführt${rep.failed ? `, ${rep.failed} fehlgeschlagen` : ''} – Strg+Z macht alles rückgängig.`, rep.failed ? 'info' : 'success', 4500);
      return rep.failed === 0;
    } catch (e) {
      this.chatAdd({ role: 'error', text: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Preflight (Prüfung je Veredelungsart)
  // -------------------------------------------------------------------------

  private preflightRun = 0;

  /** Prüfung öffnen bzw. neu rechnen. Ohne Angabe: Veredelung des ersten Motivs. */
  async preflight(target?: PreflightTarget, minLine?: number | null): Promise<PreflightResult> {
    const cur = this.ui.getState().preflight;
    const t = target ?? cur?.target ?? preflightTargetFor(productionOf(this.editor.s.doc).motifs[0]?.technique);
    const ml = minLine !== undefined ? minLine : (cur?.minLine ?? null);
    const run = ++this.preflightRun;
    this.ui.setState({ preflight: { target: t, minLine: ml, result: cur?.result ?? null, busy: true } });
    const doc = this.editor.s.doc;
    const { outlines } = await textOutlines(doc).catch(() => ({ outlines: new Map() }));
    const result = runPreflight(doc, t, { minLine: ml ?? undefined, outlines });
    // Kontrast Druckfarbe ↔ Stofffarbe der Varianten
    const weak = contrastWarnings(doc);
    if (weak.length) {
      result.issues = result.issues.filter((i) => i.severity !== 'info' || !/Keine Probleme/.test(i.message));
      for (const w of weak) result.issues.push({ severity: 'warn', message: `Kontrast: ${w.color.toUpperCase()} auf Stoff „${w.fabric}“ (${w.variant}) ist kaum sichtbar (${w.ratio.toFixed(1).replace('.', ',')} : 1).`, ids: [] });
    }
    if (run === this.preflightRun && this.ui.getState().preflight) this.ui.setState({ preflight: { target: t, minLine: ml, result, busy: false } });
    return result;
  }

  closePreflight(): void {
    this.preflightRun++;
    this.ui.setState({ preflight: null });
  }

  // -------------------------------------------------------------------------
  // Bilder (Vorlage zum Nachzeichnen)
  // -------------------------------------------------------------------------

  private calibrating: string | null = null;

  /** Bild aus Datei (Dialog), Drag & Drop oder Zwischenablage einfügen. */
  async insertImage(file?: { name: string; data: Uint8Array; mime?: string }, at?: Vec2): Promise<boolean> {
    try {
      const f = file ?? (await openFile([IMAGE_PNG_TYPE, IMAGE_JPG_TYPE, IMAGE_WEBP_TYPE]));
      if (!f) return false;
      const mime = ('mime' in f && f.mime) || (/\.jpe?g$/i.test(f.name) ? 'image/jpeg' : /\.webp$/i.test(f.name) ? 'image/webp' : 'image/png');
      const img = await readImageFile(f.data, mime);
      const out = this.editor.insertImage({ ...img, name: f.name }, { center: at });
      if (!out.ok) {
        this.editor.toast(out.message, 'error');
        return false;
      }
      this.setTool('select');
      this.ui.setState({ side: 'props', sideOpen: true });
      this.editor.toast('Bild als Vorlage eingefügt (halbtransparent, wird nicht exportiert). Größe unter „Eigenschaften“ einstellen, dann Ebene „Vorlage“ sperren und nachzeichnen.', 'success', 7000);
      return true;
    } catch (e) {
      this.editor.toast(`Bild konnte nicht gelesen werden: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000);
      return false;
    }
  }

  /** Maßstab eines Bildes über eine bekannte Strecke festlegen. */
  calibrateImage(id: string): void {
    this.calibrating = id;
    this.setTool('imgcalib');
  }

  private finishImageCalibration(a: Vec2, b: Vec2): void {
    const id = this.calibrating;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    this.setTool('select');
    if (!id) return;
    this.ui.setState({
      paramDialog: {
        title: 'Maßstab des Bildes',
        text: `Die angeklickte Strecke ist im Moment ${fmt(len)} mm lang. Wie lang ist sie in Wirklichkeit? Das Bild wird passend skaliert (Bezugspunkt: erster Klick).`,
        fields: [{ key: 'len', label: 'Echtes Maß', unit: 'mm', value: fmt(len).replace(',', '.') }],
        ok: 'Übernehmen',
        run: (v) => {
          const real = evaluate(v.len.replace(',', '.'));
          if (!(real > 0)) throw new Error('Bitte ein Maß größer als 0 eingeben.');
          void this.runOp(this.editor.transform({ kind: 'scale', k: real / len, cx: a.x, cy: a.y }, { ids: [id], label: 'Bild skalieren' }));
          this.editor.select([id]);
        },
      },
    });
  }

  /** Vektorisieren-Dialog für ein Bild. */
  vectorizeImageDialog(id: string): void {
    this.ui.setState({
      paramDialog: {
        title: 'Bild vektorisieren',
        text: 'Erzeugt je Farbe eine Form in genau der Größe und Lage des Bildes. Für Logos und Grafiken mit klaren Flächen; Fotos werden stark vereinfacht.',
        fields: [
          { key: 'colors', label: 'Farben', value: '4', hint: '2–16 (Hintergrund zählt mit)' },
          {
            key: 'detail',
            label: 'Details',
            value: 'medium',
            kind: 'choice',
            options: [
              { value: 'fine', label: 'Fein (genau, mehr Punkte)' },
              { value: 'medium', label: 'Mittel' },
              { value: 'coarse', label: 'Grob (glatt, wenige Punkte)' },
            ],
          },
          { key: 'bg', label: 'Hintergrund weglassen', value: '1', kind: 'check' },
          { key: 'hide', label: 'Bild danach ausblenden', value: '1', kind: 'check' },
        ],
        ok: 'Vektorisieren',
        run: (v) => {
          const n = Math.round(Number(v.colors));
          if (!(n >= 2 && n <= 16)) throw new Error('Bitte 2 bis 16 Farben angeben.');
          void this.vectorizeImage(id, { colors: n, detail: v.detail as VectorizeDetail, removeBackground: !!v.bg, hideImage: !!v.hide });
        },
      },
    });
  }

  async vectorizeImage(id: string, o: { colors: number; detail: VectorizeDetail; removeBackground: boolean; hideImage: boolean }): Promise<boolean> {
    const doc = this.editor.s.doc;
    const e = doc.entities[id];
    if (!e || e.kind !== 'image') return false;
    this.ui.setState({ busy: 'Vektorisiere …' });
    this.editor.toast('Bild wird vektorisiert …', 'info', 2500);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const px = await decodeImage(e.src, o.detail === 'fine' ? 1600 : o.detail === 'medium' ? 1000 : 600);
      if (!px) throw new Error('Bild konnte nicht gelesen werden.');
      const c = doc.points[e.anchor];
      const a = (e.rotation * Math.PI) / 180;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const map = (x: number, y: number) => {
        let lx = (x / px.width - 0.5) * e.width;
        const ly = (0.5 - y / px.height) * e.height;
        if (e.flipX) lx = -lx;
        return { x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos };
      };
      const layers = vectorize({ width: px.width, height: px.height, data: px.rgba as Uint8ClampedArray }, o, map);
      if (!layers.length) throw new Error('Keine Flächen gefunden – mehr Farben oder „Hintergrund weglassen“ abschalten.');
      const ls = layersOf(doc);
      const imgLayer = e.layer ?? ls[0].id;
      let target = this.editor.targetLayer(doc);
      const tl = ls.find((l) => l.id === target);
      if (target === imgLayer || !tl || tl.name === 'Vorlage' || tl.locked) target = [...ls].reverse().find((l) => l.id !== imgLayer && l.name !== 'Vorlage' && !l.locked)?.id ?? target;
      const created: string[] = [];
      const out = this.editor.commit('Bild vektorisieren', (d) => {
        const g = newId(d, 'g');
        for (const l of layers) {
          const sh = addShapeFromWorld(d, l.contours, { fill: l.color, stroke: null, strokeWidth: 0.3, opacity: 1 }, { name: `Vektor ${l.color.toUpperCase()}`, fillRule: 'evenodd', layer: target });
          sh.group = g;
          created.push(sh.id);
        }
        if (o.hideImage) {
          const il = d.layers?.find((x) => x.id === imgLayer);
          if (il && il.name === 'Vorlage') il.visible = false;
        }
      });
      if (!out.ok) throw new Error(out.message);
      this.editor.select(created);
      this.editor.toast(`${layers.length} Form${layers.length === 1 ? '' : 'en'} erzeugt (${layers.map((l) => l.color.toUpperCase()).join(', ')}). Strg+Z macht es rückgängig.`, 'success', 6000);
      return true;
    } catch (err) {
      this.editor.toast(err instanceof Error ? err.message : String(err), 'error', 6000);
      return false;
    } finally {
      this.ui.setState({ busy: null });
    }
  }

  /** Bild fixieren: Ebene sperren (nicht mehr versehentlich verschieben). */
  lockImageLayer(id: string): void {
    const e = this.editor.s.doc.entities[id];
    if (!e) return;
    const layer = e.layer ?? layersOf(this.editor.s.doc)[0].id;
    const out = this.editor.updateLayer(layer, { locked: true });
    if (out.ok) this.editor.toast('Ebene gesperrt – das Bild bleibt liegen. Entsperren im Tab „Ebenen“.', 'success', 4000);
  }

  /** Begrenzungsrahmen (mm) der gegebenen Objekte bzw. der ganzen Zeichnung – für Tests und den Assistenten. */
  bbox(ids?: string[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
    return docBBox(this.editor.s.doc, ids ? { only: new Set(ids) } : {});
  }

  /** Design umschalten (Oberfläche und/oder Zeichenfläche); wird auf diesem Gerät gespeichert. */
  setAppearance(patch: Partial<Appearance>): void {
    const next = { ...this.ui.getState().appearance, ...patch };
    saveAppearance(next);
    this.ui.setState({ appearance: next });
    applyAppearance(next);
    this.canvas.requestRender();
  }

  openExport(format: ExportFormat = 'svg', dpi?: number): void {
    this.store.setState({ exportOpen: true, exportPreset: { format, dpi } });
  }

  /** Exportiert die Zeichnung. Ohne `path` fragt ein Speichern-Dialog nach dem Ziel (mit `path`: nur Desktop). */
  async exportFile(req: ExportRequest, path?: string | null): Promise<boolean> {
    let doc = this.editor.s.doc;
    const base = safeName(this.projectName());
    try {
      const suffix = `${req.mirror ? '_gespiegelt' : ''}${req.colorMode === 'cmyk' && (req.format === 'pdf' || req.format === 'eps') ? '_CMYK' : ''}`;
      if (req.format !== 'png') {
        const wantOutlines = req.format !== 'svg' || req.outlines !== false;
        let outlines: Map<string, import('../model/types').Contour[]> | undefined;
        if (wantOutlines) {
          const t = await textOutlines(doc);
          outlines = t.outlines;
          if (t.substituted.length) this.editor.toast(`Schrift nicht gefunden, ersetzt: ${t.substituted.join(', ')}`, 'info', 6000);
        }
        if (req.weeding) doc = withWeeding(doc, req.weeding, outlines);
        const title = this.projectName();
        let data: Uint8Array | string;
        let w: number;
        let h: number;
        let type = SVG_TYPE;
        let note = '';
        if (req.format === 'svg') {
          const r = exportSvg(doc, { bounds: req.bounds, mirror: req.mirror, title, outlines });
          data = r.svg;
          w = r.widthMm;
          h = r.heightMm;
        } else {
          const scene = buildScene(doc, { bounds: req.bounds, outlines });
          w = scene.widthMm;
          h = scene.heightMm;
          if (sceneHasImages(scene) && req.format !== 'pdf') note = ` – Hinweis: ${req.format.toUpperCase()} enthält keine Pixelbilder`;
          if (req.format === 'pdf') {
            await attachImagePixels(scene, (src) => decodeImage(src, 2400));
            data = exportPdf(scene, { colorMode: req.colorMode, mirror: req.mirror, title });
            type = PDF_TYPE;
          } else if (req.format === 'eps') {
            const r = exportEps(scene, { colorMode: req.colorMode, mirror: req.mirror, title });
            data = r.bytes;
            type = EPS_TYPE;
            if (r.lostTransparency) note += ' – Hinweis: EPS kennt keine Transparenz, Deckkraft wurde ignoriert';
          } else {
            data = exportDxf(scene, { mirror: req.mirror });
            type = DXF_TYPE;
            note += ' – nur Konturen, ohne Farben';
          }
        }
        const res = await saveFile(data, `${base}${suffix}.${type.ext}`, type, path);
        if (res) this.editor.toast(`${type.ext.toUpperCase()} exportiert (${fmtMm(w)} × ${fmtMm(h)} mm)${note}`, 'success', note ? 6000 : undefined);
        return !!res;
      }
      const out = await exportPng(doc, { dpi: req.dpi, bounds: req.bounds, mirror: req.mirror });
      const res = await saveFile(out.bytes, `${base}_${req.dpi}dpi${req.mirror ? '_gespiegelt' : ''}.png`, PNG_TYPE, path);
      if (res) this.editor.toast(`PNG exportiert (${out.widthPx} × ${out.heightPx} px, ${req.dpi} dpi)`, 'success');
      return !!res;
    } catch (e) {
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
      return false;
    }
  }
}

const fmt = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
const fmtMm = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
