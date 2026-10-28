import { createPortal } from 'react-dom';
/**
 * Eingeblendeter Ziffernblock für Bemaßungen auf dem iPad: große Tasten, keine
 * Bildschirmtastatur, die die Zeichnung verdeckt. Ausdrücke (20+5, d0*2) gehen auch.
 */

export function touchUi(): boolean {
  if (typeof matchMedia === 'undefined') return false;
  try {
    if (localStorage.getItem('vd.keypad') === 'on') return true;
    if (localStorage.getItem('vd.keypad') === 'off') return false;
  } catch {
    /* kein Speicher */
  }
  return matchMedia('(pointer: coarse)').matches || matchMedia('(hover: none)').matches;
}

const KEYS = ['7', '8', '9', '⌫', '4', '5', '6', '+', '1', '2', '3', '−', '0', ',', 'd', '×', '(', ')', '÷', 'OK'] as const;

let lastUp = 0;

export function Keypad({ onKey, onOk }: { onKey: (k: string) => void; onOk: () => void }) {
  const press = (k: string) => (k === 'OK' ? onOk() : onKey(k));
  return createPortal(
    <div className="keypad" role="group" aria-label="Ziffernblock" data-testid="keypad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          className={`key ${k === 'OK' ? 'ok' : ''} ${/[0-9,]/.test(k) ? 'num' : ''}`}
          // Fokus im Eingabefeld behalten (sonst würde das Feld übernehmen und schließen)
          onPointerDown={(e) => e.preventDefault()}
          onMouseDown={(e) => e.preventDefault()}
          // Auslösen beim Loslassen: zuverlässiger als „click“, das Touch-Browser nach Gesten
          // gelegentlich verschlucken oder verzögern
          onPointerUp={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            lastUp = Date.now();
            press(k);
          }}
          onClick={() => {
            if (Date.now() - lastUp < 600) return;
            press(k);
          }}
          aria-label={k === '⌫' ? 'Löschen' : k === 'OK' ? 'Übernehmen' : k}
          data-testid={`key-${k === '⌫' ? 'back' : k === 'OK' ? 'ok' : k}`}
        >
          {k}
        </button>
      ))}
    </div>,
    document.body,
  );
}

/** Taste auf einen Eingabewert anwenden (am Ende oder an der Cursorposition). */
export function applyKey(value: string, k: string, sel?: { start: number; end: number } | null): { value: string; caret: number } {
  const start = Math.min(sel?.start ?? value.length, value.length);
  const end = Math.min(sel?.end ?? value.length, value.length);
  if (k === '⌫') {
    if (start !== end) return { value: value.slice(0, start) + value.slice(end), caret: start };
    if (start === 0) return { value, caret: 0 };
    return { value: value.slice(0, start - 1) + value.slice(end), caret: start - 1 };
  }
  const ch = k === '−' ? '-' : k === '×' ? '*' : k === '÷' ? '/' : k === ',' ? '.' : k;
  return { value: value.slice(0, start) + ch + value.slice(end), caret: start + ch.length };
}
