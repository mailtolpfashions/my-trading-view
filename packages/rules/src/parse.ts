// Formula text → checked, normalised condition tree, and back.
//
//   CLOSE > EMA(CLOSE, 50) AND RSI(14) > 55 AND ([1h] MACD_LINE > [1h] MACD_SIGNAL OR SUPERTREND_DIR(10, 3) = 1)
//
// - Words are case-insensitive except timeframes, which follow TradingView: 5m = 5 minutes, 1M = 1 month.
// - [tf] before a value evaluates it on that timeframe: [D] HIGH. A number after a value is an offset: HIGH[1] is the
//   previous bar's high, [D] HIGH[1] the previous day's high. REF(x, n) means the same as x[n].
// - Missing parameters take their defaults and a call may leave out its source: RSI(14) = RSI(CLOSE, 14). The tree
//   always holds every argument, so the formula printed back (and what the visual builder shows) is fully explicit.

import { RuleError, TFS, type CmpOp, type Node, type Span, type Tf, type ValueType } from './ast';
import { ALIASES, FIELD_BY_NAME, FN_BY_NAME, type Param } from './functions';

type Tok =
  | { k: 'num'; v: number; s: number; e: number }
  | { k: 'word'; v: string; s: number; e: number }
  | { k: 'op'; v: string; s: number; e: number }
  | { k: 'end'; v: ''; s: number; e: number };

const TF_WORDS: Record<string, Tf> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m', '60m': '1h', '1h': '1h', '1H': '1h', '2h': '2h', '2H': '2h',
  '120m': '2h', '4h': '4h', '4H': '4h', '240m': '4h', D: 'D', d: 'D', '1D': 'D', '1d': 'D', W: 'W', w: 'W', '1W': 'W', '1w': 'W', M: 'M', '1M': 'M',
};

function lex(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) { i++; continue; }
    const s = i;
    if (/[0-9.]/.test(ch)) {
      while (i < text.length && /[0-9.]/.test(text[i])) i++;
      const exp = /^[eE][+-]?[0-9]+/.exec(text.slice(i)); // 1e7 = ₹1 crore
      if (exp && !/[A-Za-z_]/.test(text[i + exp[0].length] ?? '')) i += exp[0].length;
      if (i < text.length && /[A-Za-z_]/.test(text[i])) {
        while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
        out.push({ k: 'word', v: text.slice(s, i), s, e: i });
        continue;
      }
      const v = Number(text.slice(s, i));
      if (!Number.isFinite(v)) throw new RuleError(`"${text.slice(s, i)}" is not a number`, [s, i]);
      out.push({ k: 'num', v, s, e: i });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) i++;
      out.push({ k: 'word', v: text.slice(s, i), s, e: i });
      continue;
    }
    const two = text.slice(i, i + 2);
    if (['>=', '<=', '!=', '<>', '==', '&&', '||'].includes(two)) { out.push({ k: 'op', v: two, s, e: i + 2 }); i += 2; continue; }
    if ('><=+-*/()[],!'.includes(ch)) { out.push({ k: 'op', v: ch, s, e: i + 1 }); i++; continue; }
    throw new RuleError(`Unexpected character "${ch}"`, [i, i + 1]);
  }
  out.push({ k: 'end', v: '', s: text.length, e: text.length });
  return out;
}

const CMP: Record<string, CmpOp> = { '>': '>', '<': '<', '>=': '>=', '<=': '<=', '=': '=', '==': '=', '!=': '!=', '<>': '!=' };

class Parser {
  private p = 0;
  constructor(private toks: Tok[]) {}
  private cur(): Tok { return this.toks[this.p]; }
  private take(): string { return (this.toks[this.p++] as { v: string }).v; }
  private isOp(v: string) { return this.cur().k === 'op' && this.cur().v === v; }
  private isWord(v: string) { const t = this.cur(); return t.k === 'word' && t.v.toUpperCase() === v; }
  private expect(v: string, what: string) {
    if (!this.isOp(v)) throw new RuleError(`Expected ${what}`, [this.cur().s, Math.max(this.cur().e, this.cur().s + 1)]);
    return this.toks[this.p++];
  }

  parse(): Node {
    if (this.cur().k === 'end') throw new RuleError('The formula is empty', [0, 0]);
    const n = this.or();
    if (this.cur().k !== 'end') throw new RuleError('Unexpected text here: is an AND / OR missing?', [this.cur().s, this.cur().e]);
    return n;
  }

  private or(): Node {
    const items = [this.and()];
    while (this.isWord('OR') || this.isOp('||')) { this.p++; items.push(this.and()); }
    return items.length === 1 ? items[0] : { t: 'logic', op: 'OR', items, span: [items[0].span![0], items.at(-1)!.span![1]] };
  }
  private and(): Node {
    const items = [this.not()];
    while (this.isWord('AND') || this.isOp('&&')) { this.p++; items.push(this.not()); }
    return items.length === 1 ? items[0] : { t: 'logic', op: 'AND', items, span: [items[0].span![0], items.at(-1)!.span![1]] };
  }
  private not(): Node {
    if (this.isWord('NOT') || this.isOp('!')) {
      const s = this.toks[this.p++].s;
      const a = this.not();
      return { t: 'not', a, span: [s, a.span![1]] };
    }
    return this.cmp();
  }
  private cmp(): Node {
    const a = this.add();
    // Chartink-style: a CROSSES ABOVE b (also CROSSES_ABOVE, CROSSED ABOVE) = CROSSOVER(a, b).
    const cross = this.crossWord();
    if (cross) {
      const b = this.add();
      return { t: 'call', fn: cross, args: [a, b], span: [a.span![0], b.span![1]] };
    }
    if (this.cur().k === 'op' && CMP[this.cur().v]) {
      const op = CMP[this.take()];
      const b = this.add();
      if (this.cur().k === 'op' && CMP[this.cur().v]) throw new RuleError('Write two comparisons with AND, or use BETWEEN(x, low, high)', [this.cur().s, this.cur().e]);
      return { t: 'cmp', op, a, b, span: [a.span![0], b.span![1]] };
    }
    return a;
  }
  private crossWord(): 'CROSSOVER' | 'CROSSUNDER' | null {
    const t = this.cur();
    if (t.k !== 'word') return null;
    const w = t.v.toUpperCase();
    const dir = (x: string) => (x === 'ABOVE' ? 'CROSSOVER' : x === 'BELOW' ? 'CROSSUNDER' : null);
    const joined = /^CROSS(ES|ED)?_(ABOVE|BELOW)$/.exec(w);
    if (joined) { this.p++; return dir(joined[2]); }
    if (/^CROSS(ES|ED)?$/.test(w)) {
      const next = this.toks[this.p + 1];
      const d = next?.k === 'word' ? dir(next.v.toUpperCase()) : null;
      if (!d) throw new RuleError('Write CROSSES ABOVE or CROSSES BELOW', [this.cur().s, next?.e ?? this.cur().e]);
      this.p += 2;
      return d;
    }
    return null;
  }
  private add(): Node {
    let a = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.take() as '+' | '-';
      const b = this.mul();
      a = { t: 'bin', op, a, b, span: [a.span![0], b.span![1]] };
    }
    return a;
  }
  private mul(): Node {
    let a = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.take() as '*' | '/';
      const b = this.unary();
      a = { t: 'bin', op, a, b, span: [a.span![0], b.span![1]] };
    }
    return a;
  }
  private unary(): Node {
    if (this.isOp('-')) {
      const s = this.toks[this.p++].s;
      const a = this.unary();
      return a.t === 'num' ? { t: 'num', v: -a.v, span: [s, a.span![1]] } : { t: 'neg', a, span: [s, a.span![1]] };
    }
    if (this.isOp('+')) { this.p++; return this.unary(); }
    return this.postfix();
  }
  private postfix(): Node {
    let tf: { tf: Tf; s: number } | null = null;
    if (this.isOp('[')) {
      const s = this.toks[this.p++].s;
      const w = this.cur();
      const word = w.k === 'word' ? w.v : w.k === 'num' ? String(w.v) : '';
      const t = TF_WORDS[word];
      if (!t) throw new RuleError(`"${word || '…'}" is not a timeframe. Use one of ${TFS.join(', ')}`, [w.s, Math.max(w.e, w.s + 1)]);
      this.p++;
      this.expect(']', '"]" after the timeframe');
      tf = { tf: t, s };
    }
    let a = this.primary();
    while (this.isOp('[')) {
      this.p++;
      const n = this.cur();
      if (n.k !== 'num' || !Number.isInteger(n.v) || n.v < 0) throw new RuleError('An offset is a whole number of bars, e.g. HIGH[1]', [n.s, Math.max(n.e, n.s + 1)]);
      this.p++;
      const end = this.expect(']', '"]" after the offset').e;
      a = { t: 'ref', a, n: n.v, span: [a.span![0], end] };
    }
    return tf ? { t: 'tf', tf: tf.tf, a, span: [tf.s, a.span![1]] } : a;
  }
  private primary(): Node {
    const t = this.cur();
    if (t.k === 'num') { this.p++; return { t: 'num', v: t.v, span: [t.s, t.e] }; }
    if (this.isOp('(')) {
      this.p++;
      const n = this.or();
      const e = this.expect(')', 'a closing ")"').e;
      return { ...n, span: [t.s, e] };
    }
    if (t.k === 'word') {
      this.p++;
      const name = t.v.toUpperCase();
      if (['AND', 'OR', 'NOT'].includes(name)) throw new RuleError(`"${name}" needs a condition before it`, [t.s, t.e]);
      if (this.isOp('(')) {
        this.p++;
        const args: Node[] = [];
        if (!this.isOp(')')) {
          args.push(this.or());
          while (this.isOp(',')) { this.p++; args.push(this.or()); }
        }
        const e = this.expect(')', `")" to close ${name}(`).e;
        return { t: 'call', fn: name, args, span: [t.s, e] };
      }
      return { t: 'id', name, span: [t.s, t.e] };
    }
    if (t.k === 'end') throw new RuleError('The formula ends too early', [t.s, t.s]);
    throw new RuleError(`Unexpected "${t.v}"`, [t.s, t.e]);
  }
}

// ---- checking and normalising ----

const MAX_LEN = 5000;
const describeKind = (p: Param) => (typeof p.kind === 'object' ? `one of ${p.kind.oneOf.join(', ')}` : p.kind === 'int' ? 'a whole number' : p.kind === 'number' ? 'a number' : p.kind === 'bool' ? 'a condition' : 'a value');
const literal = (n: Node): number | null => (n.t === 'num' ? n.v : n.t === 'neg' && n.a.t === 'num' ? -n.a.v : null);

/** Checks a tree and returns it normalised (aliases resolved, defaults filled, REF(x, n) as x[n]) with its type. */
export function check(n: Node): { node: Node; type: ValueType } {
  const span = n.span;
  switch (n.t) {
    case 'num': return { node: n, type: 'num' };
    case 'id': {
      const name = ALIASES[n.name] ?? n.name;
      if (FIELD_BY_NAME.has(name)) return { node: { t: 'id', name, span }, type: 'num' };
      const f = FN_BY_NAME.get(name);
      if (f && f.params.every((p) => p.def != null)) return check({ t: 'call', fn: name, args: [], span });
      if (f) throw new RuleError(`${name} needs arguments: ${name}(${f.params.map((p) => p.name).join(', ')})`, span);
      throw new RuleError(`Unknown name "${n.name}"`, span);
    }
    case 'call': {
      const name = ALIASES[n.fn] ?? n.fn;
      if (name === 'REF') {
        if (n.args.length !== 2 || literal(n.args[1]) == null) throw new RuleError('REF(value, bars), e.g. REF(CLOSE, 1)', span);
        return check({ t: 'ref', a: n.args[0], n: literal(n.args[1])!, span });
      }
      const f = FN_BY_NAME.get(name);
      if (!f) throw new RuleError(`Unknown function "${n.fn}"`, span);
      let args = n.args;
      const p0 = f.params[0];
      // Source left out: RSI(14) means RSI(CLOSE, 14).
      if (p0?.kind === 'series' && p0.def != null && args.length < f.params.length && args.length > 0 && literal(args[0]) != null && f.params[1] && (f.params[1].kind === 'int' || f.params[1].kind === 'number'))
        args = [{ t: 'id', name: String(p0.def) }, ...args];
      if (args.length > f.params.length) throw new RuleError(`${name} takes ${f.params.length} argument${f.params.length === 1 ? '' : 's'}: ${name}(${f.params.map((p) => p.name).join(', ')})`, span);
      const out: Node[] = f.params.map((p, i) => {
        const a = args[i];
        if (!a) {
          if (p.def == null) throw new RuleError(`${name} needs ${p.name}: ${name}(${f.params.map((q) => q.name).join(', ')})`, span);
          if (p.kind === 'series') return { t: 'id', name: String(p.def) };
          if (typeof p.kind === 'object') return { t: 'id', name: String(p.def) };
          return { t: 'num', v: Number(p.def) };
        }
        if (typeof p.kind === 'object') {
          const word = a.t === 'id' ? a.name : null;
          if (!word || !p.kind.oneOf.includes(word)) throw new RuleError(`${name}: ${p.name} must be ${describeKind(p)}`, a.span);
          return { t: 'id', name: word, span: a.span };
        }
        if (p.kind === 'int' || p.kind === 'number') {
          const v = literal(a);
          if (v == null) throw new RuleError(`${name}: ${p.name} must be ${describeKind(p)}`, a.span);
          if (p.kind === 'int' && (!Number.isInteger(v) || v < 1 || v > MAX_LEN)) throw new RuleError(`${name}: ${p.name} must be a whole number from 1 to ${MAX_LEN}`, a.span);
          return { t: 'num', v, span: a.span };
        }
        const c = check(a);
        if (p.kind === 'series' && c.type !== 'num') throw new RuleError(`${name}: ${p.name} must be a value, not a condition`, a.span);
        if (p.kind === 'bool' && c.type !== 'bool') throw new RuleError(`${name}: ${p.name} must be a condition, e.g. CLOSE > OPEN`, a.span);
        return c.node;
      });
      return { node: { t: 'call', fn: name, args: out, span }, type: f.returns };
    }
    case 'neg': {
      const a = check(n.a);
      if (a.type !== 'num') throw new RuleError('Only a value can be negated; use NOT for a condition', span);
      return { node: { t: 'neg', a: a.node, span }, type: 'num' };
    }
    case 'bin': {
      const a = check(n.a), b = check(n.b);
      if (a.type !== 'num' || b.type !== 'num') throw new RuleError(`"${n.op}" works on values, not conditions`, span);
      return { node: { t: 'bin', op: n.op, a: a.node, b: b.node, span }, type: 'num' };
    }
    case 'cmp': {
      const a = check(n.a), b = check(n.b);
      if (a.type !== 'num' || b.type !== 'num') throw new RuleError(`"${n.op}" compares two values; combine conditions with AND / OR`, span);
      return { node: { t: 'cmp', op: n.op, a: a.node, b: b.node, span }, type: 'bool' };
    }
    case 'logic': {
      const items = n.items.map((x) => {
        const c = check(x);
        if (c.type !== 'bool') throw new RuleError(`${n.op} joins conditions; this is a value. Compare it, e.g. … > 50`, x.span);
        return c.node;
      });
      return { node: { t: 'logic', op: n.op, items, span }, type: 'bool' };
    }
    case 'not': {
      const a = check(n.a);
      if (a.type !== 'bool') throw new RuleError('NOT needs a condition', span);
      return { node: { t: 'not', a: a.node, span }, type: 'bool' };
    }
    case 'tf': {
      const a = check(n.a);
      return { node: { t: 'tf', tf: n.tf, a: a.node, span }, type: a.type };
    }
    case 'ref': {
      if (!Number.isInteger(n.n) || n.n < 0 || n.n > MAX_LEN) throw new RuleError(`An offset must be 0 to ${MAX_LEN} bars`, span);
      const a = check(n.a);
      return { node: n.n === 0 ? a.node : { t: 'ref', a: a.node, n: n.n, span }, type: a.type };
    }
  }
}

export type Parsed = { ok: true; node: Node; type: ValueType; formula: string } | { ok: false; error: string; span?: Span };

/** Parses and checks a formula. On success, `formula` is the normalised text (every argument written out). */
export function parseFormula(text: string): Parsed {
  try {
    const raw = new Parser(lex(text)).parse();
    const { node, type } = check(raw);
    return { ok: true, node, type, formula: print(node) };
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message, span: e.span };
    throw e;
  }
}

// ---- printing ----

const PREC = { logicOR: 1, logicAND: 2, not: 3, cmp: 4, add: 5, mul: 6, unary: 7, atom: 8 };
function prec(n: Node): number {
  switch (n.t) {
    case 'logic': return n.op === 'OR' ? PREC.logicOR : PREC.logicAND;
    case 'not': return PREC.not;
    case 'cmp': return PREC.cmp;
    case 'bin': return n.op === '+' || n.op === '-' ? PREC.add : PREC.mul;
    case 'neg': return PREC.unary;
    case 'tf': return PREC.unary;
    default: return PREC.atom;
  }
}
const fmtNum = (v: number) => (Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12))));

/** The tree as formula text, with only the parentheses it needs. */
export function print(n: Node): string {
  const wrap = (x: Node, min: number) => (prec(x) < min ? `(${print(x)})` : print(x));
  switch (n.t) {
    case 'num': return fmtNum(n.v);
    case 'id': return n.name;
    case 'call': return n.args.length ? `${n.fn}(${n.args.map(print).join(', ')})` : n.fn;
    case 'neg': return `-${wrap(n.a, PREC.unary)}`;
    case 'bin': {
      const p = prec(n);
      // Left-associative: the right side needs parentheses at equal precedence (a - (b - c)).
      return `${wrap(n.a, p)} ${n.op} ${wrap(n.b, p + 1)}`;
    }
    case 'cmp': return `${wrap(n.a, PREC.add)} ${n.op} ${wrap(n.b, PREC.add)}`;
    case 'logic': {
      const p = prec(n);
      return n.items.map((x) => wrap(x, p + (x.t === 'logic' && x.op === n.op ? 1 : 0))).join(` ${n.op} `);
    }
    case 'not': return `NOT ${wrap(n.a, PREC.not)}`;
    case 'tf': return `[${n.tf}] ${wrap(n.a, PREC.atom)}`;
    case 'ref': return `${wrap(n.a, PREC.atom)}[${n.n}]`;
  }
}
