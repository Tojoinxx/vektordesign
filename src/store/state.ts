import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Id, SketchDoc, Style, TextAlign } from '../model/types';
import { createDoc, DEFAULT_STYLE } from '../model/doc';
import type { Analysis } from '../solver/analysis';

export type ToolId =
  | 'select'
  | 'line'
  | 'rect'
  | 'circle'
  | 'text'
  | 'point'
  | 'dimension'
  | 'gradient'
  | `constraint:${string}`;

export interface ViewState {
  /** Bildmitte in Weltkoordinaten (mm) */
  cx: number;
  cy: number;
  /** Bildschirmpixel (CSS) pro mm */
  zoom: number;
}

export interface Settings {
  grid: boolean;
  gridSnap: boolean;
  snapEndpoint: boolean;
  snapMidpoint: boolean;
  snapIntersection: boolean;
  snapCenter: boolean;
  snapOnCurve: boolean;
  autoConstraints: boolean;
  showDims: boolean;
  showGlyphs: boolean;
  showOverlay: boolean;
  dimDisplay: 'value' | 'name' | 'expr';
}

export interface HistoryEntry {
  doc: SketchDoc;
  label: string;
}

export interface TextDefaults {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  align: TextAlign;
}

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'success';
  text: string;
}

export interface DimPrompt {
  /** Bemaßung, die gerade bearbeitet wird */
  dimId: Id;
  /** true = gerade neu angelegt (Esc behält den gemessenen Wert) */
  isNew: boolean;
}

export interface ConfirmRequest {
  title: string;
  text: string;
  confirm: string;
  cancel?: string;
  onConfirm: () => void;
  onCancel?: () => void;
}

export interface AppState {
  doc: SketchDoc;
  analysis: Analysis;
  past: HistoryEntry[];
  future: HistoryEntry[];
  selection: Id[];
  hover: Id | null;
  view: ViewState;
  tool: ToolId;
  rectMode: 'corner' | 'center';
  /** Neue Geometrie als Konstruktionsgeometrie zeichnen */
  constructionMode: boolean;
  settings: Settings;
  currentStyle: Style;
  textDefaults: TextDefaults;
  fileName: string | null;
  filePath: string | null;
  dirty: boolean;
  dimPrompt: DimPrompt | null;
  textEdit: Id | null;
  paletteOpen: boolean;
  exportOpen: boolean;
  exportPreset: { format: 'svg' | 'png'; dpi?: number } | null;
  assistantOpen: boolean;
  confirm: ConfirmRequest | null;
  toasts: Toast[];
  /** Zähler, der ein Neuzeichnen der Werkzeug-Vorschau auslöst */
  overlayTick: number;
  solverReady: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  grid: true,
  gridSnap: false,
  snapEndpoint: true,
  snapMidpoint: true,
  snapIntersection: true,
  snapCenter: true,
  snapOnCurve: true,
  autoConstraints: true,
  showDims: true,
  showGlyphs: true,
  showOverlay: true,
  dimDisplay: 'value',
};

export const EMPTY_ANALYSIS: Analysis = {
  status: 'empty',
  dof: 0,
  conflicting: [],
  redundant: [],
  label: 'Leere Skizze',
  detail: '',
  free: null,
};

export function initialState(): AppState {
  return {
    doc: createDoc(),
    analysis: EMPTY_ANALYSIS,
    past: [],
    future: [],
    selection: [],
    hover: null,
    view: { cx: 0, cy: 0, zoom: 4 },
    tool: 'select',
    rectMode: 'corner',
    constructionMode: false,
    settings: { ...DEFAULT_SETTINGS },
    currentStyle: { ...DEFAULT_STYLE },
    textDefaults: { fontFamily: 'Arial', fontSize: 10, fontWeight: 700, italic: false, align: 'left' },
    fileName: null,
    filePath: null,
    dirty: false,
    dimPrompt: null,
    textEdit: null,
    paletteOpen: false,
    exportOpen: false,
    exportPreset: null,
    assistantOpen: false,
    confirm: null,
    toasts: [],
    overlayTick: 0,
    solverReady: false,
  };
}

export type AppStore = StoreApi<AppState>;

export function createAppStore(): AppStore {
  return createStore<AppState>()(() => initialState());
}
