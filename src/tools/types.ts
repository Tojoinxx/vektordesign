import type { Id, Vec2 } from '../model/types';
import type { Editor, PlacedPoint } from '../store/editor';
import type { ToolId } from '../store/state';
import type { SceneLayout } from '../render/renderer';
import type { Viewport } from '../render/viewport';
import type { SnapResult } from './snap';

export interface ToolPointer {
  /** Position in CSS-Pixeln relativ zur Zeichenfläche */
  screen: Vec2;
  /** Rohe Weltposition (mm) */
  world: Vec2;
  /** Gefangene Position */
  snap: SnapResult;
  button: number;
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  pointerType: string;
}

export interface DynamicField {
  key: string;
  label: string;
  unit: string;
  /** Live-Wert als Platzhalter (aktueller Mauswert) */
  live: string;
}

export interface DynamicInputSpec {
  fields: DynamicField[];
  /** Bildschirmposition für die Eingabefelder */
  at: Vec2;
}

export interface ToolContext {
  editor: Editor;
  vp(): Viewport;
  layout(): SceneLayout | null;
  requestRender(): void;
  /** Direkte Werteingabe anzeigen/aktualisieren (null = aus) */
  setDynamicInput(spec: DynamicInputSpec | null): void;
  /** Aktuell eingetippte Werte der direkten Eingabe */
  dynamicValues(): Record<string, string>;
  clearDynamicValues(): void;
  openDimEditor(dimId: Id, isNew: boolean): void;
  openTextEditor(textId: Id | null, at?: PlacedPoint): void;
  setTool(id: ToolId): void;
  /** Fang-Optionen für dieses Werkzeug */
  snapExclude(ids: Id[]): void;
}

export interface Tool {
  readonly id: ToolId;
  /** Eingabeaufforderung in der Statusleiste */
  hint(): string;
  /** CSS-Mauszeiger */
  cssCursor?: string;
  /** Fängt dieses Werkzeug Punkte? */
  readonly snaps: boolean;
  activate?(): void;
  deactivate?(): void;
  pointerDown?(p: ToolPointer): void;
  pointerMove?(p: ToolPointer): void;
  pointerUp?(p: ToolPointer): void;
  doubleClick?(p: ToolPointer): void;
  /** true = Taste verarbeitet */
  keyDown?(e: KeyboardEvent): boolean;
  /** Esc: true = laufende Aktion abgebrochen, false = Werkzeug kann beendet werden */
  cancel?(): boolean;
  /** Enter / „Fertig“ */
  finish?(): void;
  /** Eingetippte Werte bestätigt (Enter in der direkten Eingabe) */
  submitInput?(values: Record<string, string>): void;
  /** Eingetippte Werte geändert (Vorschau) */
  inputChanged?(values: Record<string, string>): void;
  drawOverlay?(ctx: CanvasRenderingContext2D, vp: Viewport): void;
}
