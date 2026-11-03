// The one condition format behind the screener, strategy entries and exits, alerts and historical scans. The visual
// builder edits this tree and the formula editor parses to it, so both always compute the same thing.

/** Bar size: m = minutes, h = hours, D / W / M = day, week, month (as TradingView writes them; 1m ≠ 1M). */
export type Tf = '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '2h' | '4h' | 'D' | 'W' | 'M';
export const TFS: Tf[] = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', 'D', 'W', 'M'];
export const INTRADAY_TFS: Tf[] = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h'];
const INTRADAY = new Set<Tf>(INTRADAY_TFS);
export const isIntraday = (tf: Tf) => INTRADAY.has(tf);
/** Bar length in minutes for intraday timeframes. */
export const TF_MINUTES: Partial<Record<Tf, number>> = { '1m': 1, '3m': 3, '5m': 5, '15m': 15, '30m': 30, '1h': 60, '2h': 120, '4h': 240 };

export type CmpOp = '>' | '<' | '>=' | '<=' | '=' | '!=';
export type MathOp = '+' | '-' | '*' | '/';

/** Character range [start, end) in the formula text, kept for error messages. */
export type Span = [number, number];

export type Node =
  | { t: 'num'; v: number; span?: Span }
  /** A price field (CLOSE, VOLUME, HLC3 …) or an option word inside a call (CAMARILLA, R1 …). */
  | { t: 'id'; name: string; span?: Span }
  | { t: 'call'; fn: string; args: Node[]; span?: Span }
  | { t: 'neg'; a: Node; span?: Span }
  | { t: 'bin'; op: MathOp; a: Node; b: Node; span?: Span }
  | { t: 'cmp'; op: CmpOp; a: Node; b: Node; span?: Span }
  | { t: 'logic'; op: 'AND' | 'OR'; items: Node[]; span?: Span }
  | { t: 'not'; a: Node; span?: Span }
  /** Evaluate `a` on another timeframe's bars, e.g. [1h] RSI(CLOSE, 14). */
  | { t: 'tf'; tf: Tf; a: Node; span?: Span }
  /** `a` as it was `n` bars ago on the current timeframe, e.g. HIGH[1]. */
  | { t: 'ref'; a: Node; n: number; span?: Span };

export type ValueType = 'num' | 'bool';

export class RuleError extends Error {
  constructor(message: string, readonly span?: Span) {
    super(message);
  }
}
