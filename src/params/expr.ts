/**
 * Ausdrücke für Bemaßungen, z. B. "80", "20+5", "d1*2", "12,5", "(d0-10)/2", "sqrt(2)*d3", "max(d1; 20)".
 *
 * - Dezimaltrennzeichen Komma oder Punkt
 * - Argumente in Funktionen mit Semikolon trennen (Komma geht, wenn danach ein Leerzeichen folgt)
 * - Einheiten: mm, cm, m, in, ° / deg, rad
 * - Winkelfunktionen arbeiten in Grad (wie in Inventor)
 */

export type Node =
  | { t: 'num'; v: number }
  | { t: 'name'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

export class ExprError extends Error {}

type Tok =
  | { k: 'num'; v: number; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'op'; v: string; pos: number }
  | { k: 'end'; pos: number };

const UNITS: Record<string, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
  zoll: 25.4,
  deg: 1,
  '°': 1,
  grad: 1,
  rad: 180 / Math.PI,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, PI: Math.PI, π: Math.PI };

const d2r = Math.PI / 180;
const FUNCS: Record<string, { min: number; max: number; f: (...a: number[]) => number }> = {
  sin: { min: 1, max: 1, f: (a) => Math.sin(a * d2r) },
  cos: { min: 1, max: 1, f: (a) => Math.cos(a * d2r) },
  tan: { min: 1, max: 1, f: (a) => Math.tan(a * d2r) },
  asin: { min: 1, max: 1, f: (a) => Math.asin(a) / d2r },
  acos: { min: 1, max: 1, f: (a) => Math.acos(a) / d2r },
  atan: { min: 1, max: 1, f: (a) => Math.atan(a) / d2r },
  sqrt: { min: 1, max: 1, f: Math.sqrt },
  wurzel: { min: 1, max: 1, f: Math.sqrt },
  abs: { min: 1, max: 1, f: Math.abs },
  round: { min: 1, max: 1, f: Math.round },
  floor: { min: 1, max: 1, f: Math.floor },
  ceil: { min: 1, max: 1, f: Math.ceil },
  min: { min: 2, max: 99, f: Math.min },
  max: { min: 2, max: 99, f: Math.max },
};

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
      continue;
    }
    if (isDigit(c) || ((c === '.' || c === ',') && isDigit(src[i + 1]))) {
      const start = i;
      let s = '';
      let seenSep = false;
      while (i < src.length) {
        const ch = src[i];
        if (isDigit(ch)) {
          s += ch;
          i++;
        } else if ((ch === '.' || ch === ',') && !seenSep && isDigit(src[i + 1])) {
          s += '.';
          seenSep = true;
          i++;
        } else break;
      }
      // Exponent, z. B. 1e3
      if ((src[i] === 'e' || src[i] === 'E') && (isDigit(src[i + 1]) || ((src[i + 1] === '-' || src[i + 1] === '+') && isDigit(src[i + 2])))) {
        s += 'e';
        i++;
        if (src[i] === '-' || src[i] === '+') s += src[i++];
        while (isDigit(src[i])) s += src[i++];
      }
      out.push({ k: 'num', v: parseFloat(s), pos: start });
      continue;
    }
    if (/[A-Za-z_À-ɏπ°"]/.test(c)) {
      const start = i;
      if (c === '°' || c === '"') {
        out.push({ k: 'id', v: c === '"' ? 'in' : '°', pos: start });
        i++;
        continue;
      }
      let s = '';
      while (i < src.length && /[A-Za-z0-9_À-ɏπ]/.test(src[i])) s += src[i++];
      out.push({ k: 'id', v: s, pos: start });
      continue;
    }
    if ('+-*/^();,×÷'.includes(c)) {
      const v = c === '×' ? '*' : c === '÷' ? '/' : c;
      out.push({ k: 'op', v, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`Unerwartetes Zeichen „${c}“`);
  }
  out.push({ k: 'end', pos: src.length });
  return out;
}

class Parser {
  private i = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i];
  }
  private next(): Tok {
    return this.toks[this.i++];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.k === 'op' && t.v === v;
  }

  parse(): Node {
    if (this.peek().k === 'end') throw new ExprError('Bitte einen Wert eingeben');
    const n = this.sum();
    const t = this.peek();
    if (t.k !== 'end') {
      if (t.k === 'op' && t.v === ')') throw new ExprError('Klammer „)“ ohne passende „(“');
      throw new ExprError(`Unerwartet: „${t.k === 'num' ? t.v : (t as { v: string }).v}“`);
    }
    return n;
  }

  private sum(): Node {
    let a = this.product();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.next() as { v: string }).v as '+' | '-';
      a = { t: 'bin', op, a, b: this.product() };
    }
    return a;
  }

  private product(): Node {
    let a = this.unary();
    for (;;) {
      if (this.isOp('*') || this.isOp('/')) {
        const op = (this.next() as { v: string }).v as '*' | '/';
        a = { t: 'bin', op, a, b: this.unary() };
      } else break;
    }
    return a;
  }

  // Vorzeichen bindet schwächer als ^:  -2^2 = -(2^2)
  private unary(): Node {
    if (this.isOp('-')) {
      this.next();
      return { t: 'neg', a: this.unary() };
    }
    if (this.isOp('+')) {
      this.next();
      return this.unary();
    }
    return this.power();
  }

  private power(): Node {
    const a = this.postfix();
    if (this.isOp('^')) {
      this.next();
      return { t: 'bin', op: '^', a, b: this.unary() };
    }
    return a;
  }

  private postfix(): Node {
    let n = this.primary();
    const t = this.peek();
    if (t.k === 'id' && t.v.toLowerCase() in UNITS) {
      this.next();
      const f = UNITS[t.v.toLowerCase()];
      if (f !== 1) n = { t: 'bin', op: '*', a: n, b: { t: 'num', v: f } };
    }
    return n;
  }

  private primary(): Node {
    const t = this.next();
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'op' && t.v === '(') {
      const n = this.sum();
      if (!this.isOp(')')) throw new ExprError('Schließende Klammer „)“ fehlt');
      this.next();
      return n;
    }
    if (t.k === 'id') {
      if (this.isOp('(')) {
        this.next();
        const args: Node[] = [];
        if (!this.isOp(')')) {
          args.push(this.sum());
          while (this.isOp(';') || this.isOp(',')) {
            this.next();
            args.push(this.sum());
          }
        }
        if (!this.isOp(')')) throw new ExprError('Schließende Klammer „)“ fehlt');
        this.next();
        const fn = t.v.toLowerCase();
        const def = FUNCS[fn];
        if (!def) throw new ExprError(`Unbekannte Funktion „${t.v}“`);
        if (args.length < def.min || args.length > def.max) {
          throw new ExprError(
            def.min === def.max
              ? `${t.v} erwartet ${def.min} Wert${def.min === 1 ? '' : 'e'}`
              : `${t.v} erwartet mindestens ${def.min} Werte (mit „;“ trennen)`,
          );
        }
        return { t: 'call', fn, args };
      }
      return { t: 'name', name: t.v };
    }
    if (t.k === 'end') throw new ExprError('Ausdruck ist unvollständig');
    throw new ExprError(`Unerwartet: „${(t as { v: string }).v}“`);
  }
}

export function parseExpr(src: string): Node {
  return new Parser(tokenize(src.trim())).parse();
}

/** Namen (Parameter), die ein Ausdruck verwendet. */
export function exprNames(node: Node, out = new Set<string>()): Set<string> {
  switch (node.t) {
    case 'name':
      if (!(node.name in CONSTANTS)) out.add(node.name);
      break;
    case 'neg':
      exprNames(node.a, out);
      break;
    case 'bin':
      exprNames(node.a, out);
      exprNames(node.b, out);
      break;
    case 'call':
      node.args.forEach((a) => exprNames(a, out));
      break;
  }
  return out;
}

export function evalExpr(node: Node, lookup: (name: string) => number | undefined): number {
  switch (node.t) {
    case 'num':
      return node.v;
    case 'name': {
      if (node.name in CONSTANTS) return CONSTANTS[node.name];
      const v = lookup(node.name);
      if (v === undefined) throw new ExprError(`Unbekannter Name „${node.name}“`);
      return v;
    }
    case 'neg':
      return -evalExpr(node.a, lookup);
    case 'bin': {
      const a = evalExpr(node.a, lookup);
      const b = evalExpr(node.b, lookup);
      switch (node.op) {
        case '+':
          return a + b;
        case '-':
          return a - b;
        case '*':
          return a * b;
        case '/':
          if (b === 0) throw new ExprError('Division durch 0');
          return a / b;
        case '^':
          return a ** b;
      }
      break;
    }
    case 'call':
      return FUNCS[node.fn].f(...node.args.map((a) => evalExpr(a, lookup)));
  }
  throw new ExprError('Ungültiger Ausdruck');
}

/** Bequem: parsen und auswerten. Wirft ExprError mit deutscher Meldung. */
export function evaluate(src: string, lookup: (name: string) => number | undefined = () => undefined): number {
  const v = evalExpr(parseExpr(src), lookup);
  if (!Number.isFinite(v)) throw new ExprError('Ergebnis ist keine gültige Zahl');
  return v;
}

/** Ist der Ausdruck eine reine Zahl (ohne Namen)? */
export function isPlainNumber(src: string): boolean {
  try {
    const n = parseExpr(src);
    return exprNames(n).size === 0;
  } catch {
    return false;
  }
}

/** Zahl für Anzeige: deutsches Komma, höchstens `decimals` Nachkommastellen, ohne überflüssige Nullen. */
export function formatNumber(n: number, decimals = 2): string {
  const f = 10 ** decimals;
  let r = Math.round(n * f) / f;
  if (Object.is(r, -0)) r = 0;
  // Schnell statt toLocaleString (wird pro Bild für jede Bemaßung aufgerufen)
  let s = r.toFixed(decimals);
  if (decimals > 0) s = s.replace(/\.?0+$/, '');
  return s.replace('.', ',');
}

/** Zahl für einen Ausdruck (Eingabefeld): Komma als Dezimaltrenner, bis 4 Stellen. */
export function numberToExpr(n: number): string {
  return formatNumber(n, 4);
}
