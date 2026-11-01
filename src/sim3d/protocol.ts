import type { PatternExchange } from '../pattern/exchange';
import type { SimOptions, SimStats } from './garment';

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

export type ToWorker = { type: 'start'; id: number; ex: PatternExchange; opts: SimOptions } | { type: 'stop' };

export type FromWorker =
  | { type: 'layout'; id: number; parts: LayoutPart[]; n: number }
  | { type: 'frame'; id: number; pos: Float32Array; stats: SimStats; gap?: Float32Array; strain?: Float32Array }
  | { type: 'error'; id: number; message: string };
