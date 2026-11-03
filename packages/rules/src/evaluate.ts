// Evaluates a checked tree on one instrument's bars. Every value is a series aligned with the bars of the timeframe it
// is evaluated on; conditions are 1 (true), 0 (false) or null (unknown: warm-up or missing data, never a match).
//
// Mixing timeframes ("[W] HIGH[1]" in a daily scan): bar 0 of the other timeframe is its bar that CONTAINS the current
// bar, built only from data up to the end of the current bar, exactly what a live scanner would have shown at that
// moment. So [W] HIGH[1] is last week's high, [W] CLOSE > [W] EMA(CLOSE, 20) on a Wednesday uses this week's bar as
// of Wednesday, and no historical bar ever sees later data.
// - A coarser timeframe (weekly in a daily scan) whose expression uses only completed bars (all offsets ≥ 1) is read
//   straight from its finished bars. When it uses bar 0, that bar is rebuilt from the scan's own bars up to the
//   current one and the expression is recomputed on it: exact, and costly only on bars where it is needed (`from`).
// - A finer timeframe (hourly in a daily scan) contributes its last bar that ended within the current bar.

import type { Series } from '@mtv/indicators';
import type { Candle } from '@mtv/shared';
import { RuleError, TF_MINUTES, isIntraday, type Node, type Tf } from './ast';
import { FIELD_BY_NAME, FN_BY_NAME, type Arg } from './functions';
import { print } from './parse';

const IST = 5.5 * 3600;
const DAY = 86400;
const SESSION_CLOSE = 15 * 3600 + 30 * 60; // 15:30 IST

/** When a bar that opened at `time` (UTC seconds) closes: intraday bars at their length, capped at 15:30 IST. */
export function barEnd(time: number, tf: Tf): number {
  const local = time + IST;
  const midnight = local - (local % DAY);
  if (isIntraday(tf)) return Math.min(local + TF_MINUTES[tf]! * 60, midnight + SESSION_CLOSE) - IST;
  if (tf === 'D') return midnight + SESSION_CLOSE - IST;
  if (tf === 'W') {
    const dow = (Math.floor(local / DAY) + 4) % 7; // 1 Jan 1970 was a Thursday. Weekly bars close Friday 15:30
    return midnight - ((dow + 6) % 7) * DAY + 4 * DAY + SESSION_CLOSE - IST;
  }
  const d = new Date(local * 1000);
  let last = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / 1000; // last calendar day of the month
  while ([0, 6].includes(new Date(last * 1000).getUTCDay())) last -= DAY; // back to a weekday
  return last + SESSION_CLOSE - IST;
}

// Close times of a series' bars, computed once per series (the alignment loops read them many times).
const endCache = new WeakMap<Candle[], Map<Tf, Float64Array>>();
function endsOf(c: Candle[], tf: Tf): Float64Array {
  let m = endCache.get(c);
  if (!m) endCache.set(c, (m = new Map()));
  let e = m.get(tf);
  if (!e) {
    e = new Float64Array(c.length);
    for (let i = 0; i < c.length; i++) e[i] = barEnd(c[i].time, tf);
    m.set(tf, e);
  }
  return e;
}

/** Orders timeframes by bar length. */
export const tfRank = (tf: Tf) => (isIntraday(tf) ? TF_MINUTES[tf]! : tf === 'D' ? 1e4 : tf === 'W' ? 1e5 : 1e6);

/** Functions that read the bars directly besides their series arguments. */
const READS_BARS = new Set(['BULL_DIV', 'BEAR_DIV']);

/** Smallest bar offset the value depends on (0 = the current bar; Infinity = a constant). */
export function minOffset(n: Node): number {
  switch (n.t) {
    case 'num': return Infinity;
    case 'id': return 0;
    case 'call': {
      const f = FN_BY_NAME.get(n.fn)!;
      const series = f.params.map((p, i) => (p.kind === 'series' || p.kind === 'bool' ? n.args[i] : null)).filter((a): a is Node => !!a);
      if (!series.length || READS_BARS.has(n.fn)) return 0;
      return Math.min(...series.map(minOffset));
    }
    case 'neg': case 'not': case 'tf': return minOffset(n.a);
    case 'bin': case 'cmp': return Math.min(minOffset(n.a), minOffset(n.b));
    case 'logic': return Math.min(...n.items.map(minOffset));
    case 'ref': return minOffset(n.a) + n.n;
  }
}

/** How many earlier bars of the scan's own timeframe the value at a bar can depend on (Infinity = all history). */
export function lookback(n: Node): number {
  switch (n.t) {
    case 'num': case 'id': case 'tf': return 0;
    case 'neg': case 'not': return lookback(n.a);
    case 'bin': case 'cmp': return Math.max(lookback(n.a), lookback(n.b));
    case 'logic': return Math.max(0, ...n.items.map(lookback));
    case 'ref': return n.n + lookback(n.a);
    case 'call': {
      const inner = Math.max(0, ...n.args.map(lookback));
      const len = (i: number) => (n.args[i] as { v: number }).v;
      switch (n.fn) {
        case 'ABS': case 'MAX': case 'MIN': case 'BETWEEN': return inner;
        case 'CROSSOVER': case 'CROSSUNDER': return inner + 1;
        case 'RISING': case 'FALLING': return inner + len(1);
        case 'EVERY': case 'ANY': case 'COUNT': return inner + len(1) - 1;
        default: return n.args.some(hasTf) ? Infinity : inner; // e.g. EMA of a weekly value needs all of it
      }
    }
  }
}
const hasTf = (n: Node): boolean => {
  switch (n.t) {
    case 'tf': return true;
    case 'num': case 'id': return false;
    case 'neg': case 'not': case 'ref': return hasTf(n.a);
    case 'bin': case 'cmp': return hasTf(n.a) || hasTf(n.b);
    case 'logic': return n.items.some(hasTf);
    case 'call': return n.args.some(hasTf);
  }
};

/** A timeframe block may not contain another timeframe (it would make the "as of" rule ambiguous). */
export function checkTimeframes(n: Node, outer: Tf | null = null): void {
  if (n.t === 'tf') {
    if (outer && n.tf !== outer) throw new RuleError(`[${n.tf}] is inside a [${outer}] block; write them as separate conditions`, n.span);
    return checkTimeframes(n.a, n.tf);
  }
  if (n.t === 'neg' || n.t === 'not' || n.t === 'ref') return checkTimeframes(n.a, outer);
  if (n.t === 'bin' || n.t === 'cmp') { checkTimeframes(n.a, outer); checkTimeframes(n.b, outer); return; }
  if (n.t === 'logic') return n.items.forEach((x) => checkTimeframes(x, outer));
  if (n.t === 'call') n.args.forEach((x) => checkTimeframes(x, outer));
}

/** The timeframes a tree reads, besides the scan's own. */
export function timeframesOf(n: Node, out = new Set<Tf>()): Set<Tf> {
  if (n.t === 'tf') out.add(n.tf);
  if (n.t === 'neg' || n.t === 'not' || n.t === 'ref' || n.t === 'tf') timeframesOf(n.a, out);
  if (n.t === 'bin' || n.t === 'cmp') { timeframesOf(n.a, out); timeframesOf(n.b, out); }
  if (n.t === 'logic') n.items.forEach((x) => timeframesOf(x, out));
  if (n.t === 'call') n.args.forEach((x) => timeframesOf(x, out));
  return out;
}

export type CandleSource = (tf: Tf) => Candle[] | null;

export class Evaluator {
  private cache = new Map<string, Series>();
  private keys = new WeakMap<Node, string>();
  /** Timeframes a condition asked for but the source had no bars for. */
  readonly missing = new Set<Tf>();

  /**
   * `from`: first bar of a scan timeframe that must be exact when a coarser timeframe's bar 0 has to be rebuilt; earlier
   * bars are left unknown there. A scan reading only its newest bar passes lastIndex - lookback(condition).
   */
  constructor(private source: CandleSource, private from = 0) {}

  candles(tf: Tf): Candle[] {
    const c = this.source(tf);
    if (!c) this.missing.add(tf);
    return c ?? [];
  }

  private key(n: Node): string {
    let k = this.keys.get(n);
    if (!k) this.keys.set(n, (k = print(n)));
    return k;
  }

  /** The node's series on `tf`'s bars. */
  series(n: Node, tf: Tf): Series {
    const k = `${tf}|${this.key(n)}`;
    let s = this.cache.get(k);
    if (!s) this.cache.set(k, (s = this.compute(n, tf)));
    return s;
  }

  private compute(n: Node, tf: Tf): Series {
    const c = this.candles(tf);
    switch (n.t) {
      case 'num': return new Array(c.length).fill(n.v);
      case 'id': {
        const f = FIELD_BY_NAME.get(n.name);
        if (!f) throw new Error(`Unknown field ${n.name}`);
        return f.get(c);
      }
      case 'call': {
        const f = FN_BY_NAME.get(n.fn);
        if (!f) throw new Error(`Unknown function ${n.fn}`);
        const args: Arg[] = f.params.map((p, i) => {
          const a = n.args[i];
          if (typeof p.kind === 'object') return (a as { name: string }).name;
          if (p.kind === 'int' || p.kind === 'number') return (a as { v: number }).v;
          return this.series(a, tf);
        });
        return c.length ? f.compute(c, args, tf) : [];
      }
      case 'neg': return this.series(n.a, tf).map((v) => (v == null ? null : -v));
      case 'bin': {
        const a = this.series(n.a, tf), b = this.series(n.b, tf);
        return a.map((x, i) => {
          const y = b[i];
          if (x == null || y == null) return null;
          switch (n.op) {
            case '+': return x + y;
            case '-': return x - y;
            case '*': return x * y;
            case '/': return y === 0 ? null : x / y;
          }
        });
      }
      case 'cmp': {
        const a = this.series(n.a, tf), b = this.series(n.b, tf);
        return a.map((x, i) => {
          const y = b[i];
          if (x == null || y == null) return null;
          const eq = Math.abs(x - y) <= 1e-10 * Math.max(1, Math.abs(x), Math.abs(y));
          switch (n.op) {
            case '>': return x > y && !eq ? 1 : 0;
            case '<': return x < y && !eq ? 1 : 0;
            case '>=': return x > y || eq ? 1 : 0;
            case '<=': return x < y || eq ? 1 : 0;
            case '=': return eq ? 1 : 0;
            case '!=': return eq ? 0 : 1;
          }
        });
      }
      case 'logic': {
        const parts = n.items.map((x) => this.series(x, tf));
        const and = n.op === 'AND';
        return c.map((_, i) => {
          let unknown = false;
          for (const p of parts) {
            const v = p[i];
            if (v == null) unknown = true;
            else if (and ? v === 0 : v === 1) return and ? 0 : 1;
          }
          return unknown ? null : and ? 1 : 0;
        });
      }
      case 'not': return this.series(n.a, tf).map((v) => (v == null ? null : v ? 0 : 1));
      case 'ref': {
        const s = this.series(n.a, tf);
        return s.map((_, i) => (i >= n.n ? s[i - n.n] : null));
      }
      case 'tf': {
        if (n.tf === tf) return this.series(n.a, tf);
        return tfRank(n.tf) < tfRank(tf) ? this.fromFiner(n, c, tf) : this.fromCoarser(n, c, tf);
      }
    }
  }

  /** A finer timeframe: its last bar that ended within each bar of ours. */
  private fromFiner(n: Node & { t: 'tf' }, to: Candle[], toTf: Tf): Series {
    const from = this.candles(n.tf), s = this.series(n.a, n.tf);
    const out: Series = new Array(to.length).fill(null);
    const toEnd = endsOf(to, toTf), fromEnd = endsOf(from, n.tf);
    let j = -1;
    for (let i = 0; i < to.length; i++) {
      const end = toEnd[i];
      while (j + 1 < from.length && fromEnd[j + 1] <= end) j++;
      // On the newest bar, a finer bar that started but has not ended is the latest data there is.
      if (i === to.length - 1 && j + 1 < from.length && from[j + 1].time < end) j++;
      if (j >= 0 && from[j].time >= to[i].time) out[i] = s[j]; // only a finer bar inside this bar, never a stale one
    }
    return out;
  }

  /** A coarser timeframe: its bar that contains each bar of ours, as of the end of that bar. */
  private fromCoarser(n: Node & { t: 'tf' }, to: Candle[], toTf: Tf): Series {
    const X = n.tf, from = this.candles(X);
    const out: Series = new Array(to.length).fill(null);
    if (!from.length) return out;
    const finals = this.series(n.a, X);
    const usesBar0 = minOffset(n.a) === 0;
    const toEnd = endsOf(to, toTf), fromEnd = endsOf(from, X);
    let j = -1, periodStart = 0;
    for (let i = 0; i < to.length; i++) {
      const t = to[i].time;
      let moved = false;
      while (j + 1 < from.length && from[j + 1].time <= t) { j++; moved = true; }
      if (moved) periodStart = i;
      if (j < 0 || t >= fromEnd[j]) continue; // before the first bar, or in a gap the coarser data lacks
      const complete = fromEnd[j] <= toEnd[i];
      if (!usesBar0 || complete) { out[i] = finals[j]; continue; }
      if (i < this.from) continue;
      // Rebuild bar j from our bars of that period up to bar i, and recompute on bars 0..j.
      let hi = -Infinity, lo = Infinity, vol = 0;
      for (let k = periodStart; k <= i; k++) { hi = Math.max(hi, to[k].high); lo = Math.min(lo, to[k].low); vol += to[k].volume; }
      const partial: Candle = { time: from[j].time, open: to[periodStart].open, high: hi, low: lo, close: to[i].close, volume: vol };
      const bars = [...from.slice(0, j), partial];
      const sub = new Evaluator((tf) => (tf === X ? bars : null));
      out[i] = sub.series(n.a, X)[j];
    }
    return out;
  }
}

/** Value of each leaf condition at bar `i` (1, 0 or null), for "why did this match". */
export function explain(ev: Evaluator, n: Node, tf: Tf, i: number): { formula: string; value: number | null }[] {
  const out: { formula: string; value: number | null }[] = [];
  const walk = (x: Node) => {
    if (x.t === 'logic') return x.items.forEach(walk);
    if (x.t === 'not') return walk(x.a);
    out.push({ formula: print(x), value: ev.series(x, tf)[i] ?? null });
  };
  walk(n);
  return out;
}
