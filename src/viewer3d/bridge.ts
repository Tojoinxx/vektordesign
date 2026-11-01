import type { Id, SketchDoc } from '../model/types';
import type { MaterialPatch, PieceLookPatch } from '../pattern/edit';

/**
 * Verbindung Vektordesign ↔ Vektordesign 3D im selben Browser (oder derselben Desktop-App) über
 * einen BroadcastChannel. Das Hauptprogramm schickt jeden neuen Stand, die 3D-Anwendung schickt
 * Farb- und Stoffänderungen zurück – so bleiben beide Fenster live auf demselben Projekt.
 */

export const CHANNEL = 'vektordesign-3d';

export type BridgeMessage =
  | { type: 'hello'; from: '3d' }
  | { type: 'doc'; doc: SketchDoc; name: string; selected: Id | null }
  | { type: 'select'; pieceId: Id | null }
  | { type: 'piece'; pieceId: Id; patch: PieceLookPatch }
  | { type: 'material'; materialId: Id; patch: MaterialPatch }
  | { type: 'bye'; from: 'main' | '3d' };

export function openChannel(onMessage: (m: BridgeMessage) => void): { post: (m: BridgeMessage) => void; close: () => void } | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => onMessage(e.data as BridgeMessage);
  return {
    post: (m) => {
      try {
        ch.postMessage(m);
      } catch {
        // z. B. nicht übertragbare Daten – Verbindung ist bestmöglich
      }
    },
    close: () => ch.close(),
  };
}
