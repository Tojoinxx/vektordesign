import { createStore, type StoreApi } from 'zustand/vanilla';
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
import type { DynamicInputSpec, Tool, ToolContext } from '../tools/types';
import { exportSvg } from '../export/svg';
import { exportPng, renderPreviewPng } from '../export/png';
import { parseDoc, serializeDoc, PROJECT_EXT } from '../model/serialize';
import { openFile, PNG_TYPE, PROJECT_TYPE, safeName, saveFile, SVG_TYPE } from '../platform/files';
import { Agent, type ChatEntry } from '../assistant/agent';
import { loadApiKey, loadModel } from '../assistant/api';
import { TUTORIALS, isTutorialSeen, markTutorialSeen, tutorialsEnabled, type TutorialId } from './tutorials';

export type SidePanel = 'props' | 'claude';

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
}

export interface ExportRequest {
  format: 'svg' | 'png';
  dpi: number;
  bounds: 'geometry' | 'stroke';
  mirror: boolean;
}

export class AppController {
  readonly store: AppStore;
  readonly editor: Editor;
  readonly ui: StoreApi<UiState>;
  readonly agent: Agent;
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
    }));
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
    this.agent = new Agent(
      {
        editor: this.editor,
        renderPreview: () => renderPreviewPng(this.editor.s.doc, 768),
        openExport: (format, dpi) => this.openExport(format, dpi),
        fitView: () => this.editor.zoomToFit(),
      },
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
    try {
      const f = await openFile([PROJECT_TYPE]);
      if (!f) return;
      const doc = parseDoc(new TextDecoder().decode(f.data));
      this.editor.loadDocument(doc, f.name, f.path);
      this.editor.toast(`„${f.name}“ geöffnet`, 'success', 2500);
    } catch (e) {
      this.editor.toast(e instanceof Error ? e.message : String(e), 'error', 6000);
    }
  }

  async saveDocument(saveAs = false): Promise<void> {
    const s = this.editor.s;
    try {
      const name = `${safeName(this.projectName())}.${PROJECT_EXT}`;
      const res = await saveFile(serializeDoc({ ...s.doc, name: this.projectName() }), name, PROJECT_TYPE, saveAs ? null : s.filePath);
      if (!res) return;
      this.store.setState({ fileName: res.name, filePath: res.path, dirty: false });
      this.editor.toast(`Gespeichert: ${res.name}`, 'success', 2500);
    } catch (e) {
      this.editor.toast(`Speichern fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000);
    }
  }

  openExport(format: 'svg' | 'png' = 'svg', dpi?: number): void {
    this.store.setState({ exportOpen: true, exportPreset: { format, dpi } });
  }

  /** Exportiert die Zeichnung. Ohne `path` fragt ein Speichern-Dialog nach dem Ziel (mit `path`: nur Desktop). */
  async exportFile(req: ExportRequest, path?: string | null): Promise<boolean> {
    const doc = this.editor.s.doc;
    const base = safeName(this.projectName());
    try {
      if (req.format === 'svg') {
        const { svg, widthMm, heightMm } = exportSvg(doc, { bounds: req.bounds, mirror: req.mirror, title: this.projectName() });
        const res = await saveFile(svg, `${base}${req.mirror ? '_gespiegelt' : ''}.svg`, SVG_TYPE, path);
        if (res) this.editor.toast(`SVG exportiert (${fmtMm(widthMm)} × ${fmtMm(heightMm)} mm)`, 'success');
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

const fmtMm = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
