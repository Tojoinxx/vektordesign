import type { Dimension, Id, SketchDoc } from '../model/types';
import { ExprError, evalExpr, exprNames, parseExpr, type Node } from './expr';

export interface DimEvalResult {
  /** Neue Werte der treibenden Bemaßungen */
  values: Record<Id, number>;
  /** Fehlermeldungen je Bemaßung */
  errors: Record<Id, string>;
}

export const isAngleKind = (k: Dimension['kind']) => k === 'angle' || k === 'angleX';

/** Prüft, ob ein Wert für die Bemaßungsart zulässig ist. Gibt eine Meldung zurück oder null. */
export function validateDimValue(dim: Pick<Dimension, 'kind'>, value: number): string | null {
  if (!Number.isFinite(value)) return 'Ungültiger Wert';
  if (isAngleKind(dim.kind)) {
    if (dim.kind === 'angle' && (value <= 0 || value >= 360)) return 'Winkel muss zwischen 0° und 360° liegen';
    return null;
  }
  if (value <= 0) return 'Wert muss größer als 0 sein';
  if (value > 100000) return 'Wert ist zu groß (max. 100 m)';
  return null;
}

/**
 * Wertet alle treibenden Bemaßungen in Abhängigkeitsreihenfolge aus.
 * Getriebene Bemaßungen liefern ihren gemessenen Wert, können also referenziert werden.
 */
export function evaluateDims(doc: SketchDoc, overrides: Record<Id, string> = {}): DimEvalResult {
  const byName = new Map<string, Dimension>();
  for (const d of Object.values(doc.dims)) byName.set(d.name, d);

  const parsed = new Map<Id, Node | ExprError>();
  for (const d of Object.values(doc.dims)) {
    if (d.driven) continue;
    const src = overrides[d.id] ?? d.expr;
    try {
      parsed.set(d.id, parseExpr(src));
    } catch (e) {
      parsed.set(d.id, e instanceof ExprError ? e : new ExprError(String(e)));
    }
  }

  const values: Record<Id, number> = {};
  const errors: Record<Id, string> = {};
  const state = new Map<Id, 'visiting' | 'done'>();

  const visit = (d: Dimension, stack: string[]): number | undefined => {
    if (d.driven) return d.value;
    const st = state.get(d.id);
    if (st === 'done') return errors[d.id] ? undefined : values[d.id];
    if (st === 'visiting') {
      throw new ExprError(`Zirkelbezug: ${[...stack, d.name].join(' → ')}`);
    }
    state.set(d.id, 'visiting');
    const node = parsed.get(d.id)!;
    try {
      if (node instanceof ExprError) throw node;
      const v = evalExpr(node, (name) => {
        const ref = byName.get(name);
        if (!ref) return undefined;
        if (ref.id === d.id) throw new ExprError(`${d.name} verweist auf sich selbst`);
        const rv = visit(ref, [...stack, d.name]);
        if (rv === undefined) throw new ExprError(`${name} hat einen Fehler`);
        return rv;
      });
      const msg = validateDimValue(d, v);
      if (msg) throw new ExprError(msg);
      values[d.id] = v;
    } catch (e) {
      errors[d.id] = e instanceof Error ? e.message : String(e);
    }
    state.set(d.id, 'done');
    return errors[d.id] ? undefined : values[d.id];
  };

  for (const d of Object.values(doc.dims)) {
    if (!d.driven) visit(d, []);
  }
  return { values, errors };
}

/** Namen, die ein Ausdruck verwendet (leer bei Syntaxfehler). */
export function namesInExpr(src: string): string[] {
  try {
    return [...exprNames(parseExpr(src))];
  } catch {
    return [];
  }
}

/** Ersetzt einen Parameternamen in einem Ausdruck durch einen festen Text. */
export function replaceName(src: string, name: string, replacement: string): string {
  const re = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, 'g');
  return src.replace(re, `(${replacement})`);
}
