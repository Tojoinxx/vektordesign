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
import { MeasureTool, TrimExtendTool, type MeasureResult } from '../tools/editTools';
import { booleanOp, cornerOp, offsetOp, patternOp, selectionCenter, selectionSize, textToPaths, toShape } from '../store/ops';
import type { BoolOp } from '../model/boolean';
import { evaluate } from '../params/expr';
import { docBBox } from '../model/bounds';
import type { DynamicInputSpec, Tool, ToolContext } from '../tools/types';
import { exportSvg } from '../export/svg';
import { exportPng, renderPreviewPng } from '../export/png';
import { parseDoc, serializeDoc, PROJECT_EXT } from '../model/serialize';
import { DXF_TYPE, EPS_TYPE, openFile, PDF_TYPE, PNG_TYPE, PROJECT_TYPE, safeName, saveFile, SVG_TYPE } from '../platform/files';
import { buildScene, textOutlines } from '../export/scene';
import { exportPdf } from '../export/pdf';
import { exportEps } from '../export/eps';
import { exportDxf } from '../export/dxf';
import type { ExportFormat } from '../store/state';
import { Agent, type ChatEntry } from '../assistant/agent';
import { loadApiKey, loadModel } from '../assistant/api';
import { TUTORIALS, isTutorialSeen, markTutorialSeen, tutorialsEnabled, type TutorialId } from './tutorials';
import { applyAppearance, loadAppearance, onSystemThemeChange, saveAppearance, type Appearance } from './appearance';

export type SidePanel = 'props' | 'layers' | 'claude';

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
      appearance: loadAppearance(),
      appearanceMenu: false,
      measure: null,
      paramDialog: null,
      ribbonTab: 'sketch',
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
      case 'trim':
      case 'extend':
        t = new TrimExtendTool(this.ctx, id);
        break;
      case 'measure':
        t = new MeasureTool(this.ctx, (r) => this.ui.setState({ measure: r }));
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
    const doc = this.editor.s.doc;
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
          if (req.format === 'pdf') {
            data = exportPdf(scene, { colorMode: req.colorMode, mirror: req.mirror, title });
            type = PDF_TYPE;
          } else if (req.format === 'eps') {
            const r = exportEps(scene, { colorMode: req.colorMode, mirror: req.mirror, title });
            data = r.bytes;
            type = EPS_TYPE;
            if (r.lostTransparency) note = ' – Hinweis: EPS kennt keine Transparenz, Deckkraft wurde ignoriert';
          } else {
            data = exportDxf(scene, { mirror: req.mirror });
            type = DXF_TYPE;
            note = ' – nur Konturen, ohne Farben';
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
