import type { PatternExchange } from '../pattern/exchange';
import type { SimOptions, SimStats } from './garment';
import type { Motion } from './rig';

/** Nachrichten zwischen 3D-Ansicht und Simulations-Worker. */

export interface LayoutPart {
  key: string;
  pieceId: string;
  copy: 0 | 1;
  offset: number;
  count: number;
  uv: Float64Array;
  tris: Uint32Array;
}

export type ToWorker =
  | { type: 'start'; id: number; ex: PatternExchange; opts: SimOptions }
  | { type: 'stop' }
  /** Live-Physik: Stoff rechnet in Echtzeit weiter; Bewegung der Puppe und Wind (0 … 1) */
  | { type: 'live'; on: boolean; motion: Motion; wind: number }
  /** Stoff anfassen (Partikel-Index, Griffpunkt in mm), ziehen, loslassen */
  | { type: 'grab'; index: number; x: number; y: number; z: number }
  | { type: 'drag'; x: number; y: number; z: number }
  | { type: 'release' };

export type FromWorker =
  | { type: 'layout'; id: number; parts: LayoutPart[]; n: number }
  /** `bones`: Haltung der Puppe (11 Knochen × 12 Werte), nur wenn sie nicht in Ruhehaltung steht */
  | { type: 'frame'; id: number; pos: Float32Array; stats: SimStats; gap?: Float32Array; strain?: Float32Array; bones?: Float32Array }
  | { type: 'error'; id: number; message: string };
