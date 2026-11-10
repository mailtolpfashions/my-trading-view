// Basic condition rows, every part a dropdown:
//   [time] [indicator] [compare] [time] [indicator or Number] [× n]   [AND / OR / NOT → next row]  on/off  ↑ ↓ ✕
// A row is a comparison of two values; rows join with AND / OR / NOT (= AND NOT), AND before OR. Rows become the one
// formula language the engine runs, and a formula made of such rows reads back into rows (anything else is left to
// the formula editor).

import { parseFormula, print, type Node, type Tf } from '@mtv/rules';

/** A value a row compares: an indicator (with its settings) on a timeframe ('' = the main one), or a number. */
/** `ago`: the value N candles back (on its timeframe). `mult`: any multiplier (2 × average volume, 0.98 × high). */
export type Operand = { tf: string; ind: string; p: number[]; num?: number; mult?: number; ago?: number };
export type RowOp = '>' | '<' | '>=' | '<=' | '=' | 'xup' | 'xdn';
/** `join`: how the NEXT row connects to this one. `on`: false = kept on screen, left out of the rule. */
export type CondRow = { id: string; left: Operand; op: RowOp; right: Operand; join: 'AND' | 'OR' | 'NOT'; on: boolean };

type Ind = { id: string; label: (p: number[]) => string; group: string; tpl: string; presets: number[][]; intraday?: boolean };
/** {0} {1}: the indicator's settings. Each preset is one choice in the dropdown. */
export const INDICATORS: Ind[] = [
  { id: 'close', group: 'Price', label: () => 'Close', tpl: 'CLOSE', presets: [[]] },
  { id: 'open', group: 'Price', label: () => 'Open', tpl: 'OPEN', presets: [[]] },
  { id: 'high', group: 'Price', label: () => 'High', tpl: 'HIGH', presets: [[]] },
  { id: 'low', group: 'Price', label: () => 'Low', tpl: 'LOW', presets: [[]] },
  { id: 'pclose', group: 'Price', label: () => 'Previous close', tpl: 'CLOSE[1]', presets: [[]] },
  { id: 'phigh', group: 'Price', label: () => 'Previous high', tpl: 'HIGH[1]', presets: [[]] },
  { id: 'plow', group: 'Price', label: () => 'Previous low', tpl: 'LOW[1]', presets: [[]] },
  { id: 'chg', group: 'Price', label: () => '% change from previous candle', tpl: 'CHANGE_PCT(CLOSE, 1)', presets: [[]] },
  { id: 'vwap', group: 'Price', label: () => 'VWAP', tpl: 'VWAP', presets: [[]], intraday: true },
  { id: 'gap', group: 'Price', label: () => 'Gap % at the open', tpl: 'GAP_PCT', presets: [[]] },
  { id: 'sma', group: 'Moving averages', label: (p) => `SMA ${p[0]}`, tpl: 'SMA(CLOSE, {0})', presets: [[5], [10], [20], [50], [100], [200]] },
  { id: 'ema', group: 'Moving averages', label: (p) => `EMA ${p[0]}`, tpl: 'EMA(CLOSE, {0})', presets: [[5], [9], [13], [20], [21], [50], [100], [200]] },
  { id: 'rsi', group: 'Momentum', label: (p) => `RSI ${p[0]}`, tpl: 'RSI(CLOSE, {0})', presets: [[7], [9], [14], [21]] },
  { id: 'macd', group: 'Momentum', label: () => 'MACD line', tpl: 'MACD_LINE(CLOSE, 12, 26, 9)', presets: [[]] },
  { id: 'macds', group: 'Momentum', label: () => 'MACD signal', tpl: 'MACD_SIGNAL(CLOSE, 12, 26, 9)', presets: [[]] },
  { id: 'macdh', group: 'Momentum', label: () => 'MACD histogram', tpl: 'MACD_HIST(CLOSE, 12, 26, 9)', presets: [[]] },
  { id: 'stoch', group: 'Momentum', label: (p) => `Stochastic %K ${p[0]}${p[1] !== 1 ? ` (smoothed ${p[1]})` : ''}`, tpl: 'STOCH_K({0}, {1})', presets: [[14, 1], [14, 3]] },
  { id: 'stochd', group: 'Momentum', label: (p) => `Stochastic %D ${p[0]}`, tpl: 'STOCH_D({0}, {1}, 3)', presets: [[14, 1]] },
  { id: 'willr', group: 'Momentum', label: (p) => `Williams %R ${p[0]}`, tpl: 'WILLR({0})', presets: [[14]] },
  { id: 'cci', group: 'Momentum', label: (p) => `CCI ${p[0]}`, tpl: 'CCI(HLC3, {0})', presets: [[20]] },
  { id: 'mfi', group: 'Momentum', label: (p) => `MFI ${p[0]}`, tpl: 'MFI({0})', presets: [[14]] },
  { id: 'roc', group: 'Momentum', label: (p) => `Rate of change ${p[0]} (%)`, tpl: 'ROC(CLOSE, {0})', presets: [[9]] },
  { id: 'adx', group: 'Trend', label: (p) => `ADX ${p[0]}`, tpl: 'ADX({0}, {0})', presets: [[14]] },
  { id: 'pdi', group: 'Trend', label: (p) => `+DI ${p[0]}`, tpl: 'PLUS_DI({0})', presets: [[14]] },
  { id: 'mdi', group: 'Trend', label: (p) => `−DI ${p[0]}`, tpl: 'MINUS_DI({0})', presets: [[14]] },
  { id: 'st', group: 'Trend', label: (p) => `Supertrend ${p[0]}, ${p[1]}`, tpl: 'SUPERTREND({0}, {1})', presets: [[7, 3], [10, 2], [10, 3], [14, 2], [21, 1]] },
  { id: 'stdir', group: 'Trend', label: (p) => `Supertrend ${p[0]}, ${p[1]} direction (1 up, −1 down)`, tpl: 'SUPERTREND_DIR({0}, {1})', presets: [[7, 3], [10, 2], [10, 3], [14, 2], [21, 1]] },
  { id: 'chop', group: 'Trend', label: (p) => `Choppiness ${p[0]}`, tpl: 'CHOP({0})', presets: [[14]] },
  { id: 'bbu', group: 'Trend', label: (p) => `Bollinger upper ${p[0]}`, tpl: 'BB_UPPER(CLOSE, {0}, 2)', presets: [[20]] },
  { id: 'bbm', group: 'Trend', label: (p) => `Bollinger middle ${p[0]}`, tpl: 'BB_MIDDLE(CLOSE, {0}, 2)', presets: [[20]] },
  { id: 'bbl', group: 'Trend', label: (p) => `Bollinger lower ${p[0]}`, tpl: 'BB_LOWER(CLOSE, {0}, 2)', presets: [[20]] },
  { id: 'atr', group: 'Volatility', label: (p) => `ATR ${p[0]}`, tpl: 'ATR({0})', presets: [[14]] },
  { id: 'atrp', group: 'Volatility', label: (p) => `ATR ${p[0]} as % of price`, tpl: 'ATR_PCT({0})', presets: [[14]] },
  { id: 'hv', group: 'Volatility', label: (p) => `Historical volatility ${p[0]} (%)`, tpl: 'HV({0})', presets: [[10], [20]] },
  { id: 'vol', group: 'Volume', label: () => 'Volume', tpl: 'VOLUME', presets: [[]] },
  { id: 'volsma', group: 'Volume', label: (p) => `Volume SMA ${p[0]}`, tpl: 'SMA(VOLUME, {0})', presets: [[5], [10], [20], [50]] },
  { id: 'avgvol', group: 'Volume', label: (p) => `Average volume ${p[0]} (this candle included)`, tpl: 'AVG_VOLUME({0})', presets: [[20]] },
  { id: 'rvoltod', group: 'Volume', label: (p) => `Relative volume at this time of day (vs last ${p[0]} days)`, tpl: 'RVOL_TOD({0})', presets: [[20]], intraday: true },
  { id: 'rvol', group: 'Volume', label: (p) => `Relative volume (vs last ${p[0]} candles)`, tpl: 'RVOL({0})', presets: [[20]] },
  { id: 'rvolc', group: 'Volume', label: (p) => `Relative volume so far today (vs last ${p[0]} days)`, tpl: 'RVOL_CUM({0})', presets: [[20]], intraday: true },
  { id: 'hh', group: 'Levels', label: (p) => (p[0] === 252 ? '52-week high (before today)' : `Highest high of last ${p[0]}`), tpl: 'HIGHEST(HIGH, {0})[1]', presets: [[5], [10], [20], [50], [252]] },
  { id: 'll', group: 'Levels', label: (p) => (p[0] === 252 ? '52-week low (before today)' : `Lowest low of last ${p[0]}`), tpl: 'LOWEST(LOW, {0})[1]', presets: [[5], [10], [20], [50], [252]] },
  { id: 'pp', group: 'Levels', label: () => 'Pivot P (daily)', tpl: 'PIVOT(CLASSIC, P, D)', presets: [[]] },
  { id: 'r1', group: 'Levels', label: () => 'Pivot R1 (daily)', tpl: 'PIVOT(CLASSIC, R1, D)', presets: [[]] },
  { id: 'r2', group: 'Levels', label: () => 'Pivot R2 (daily)', tpl: 'PIVOT(CLASSIC, R2, D)', presets: [[]] },
  { id: 's1', group: 'Levels', label: () => 'Pivot S1 (daily)', tpl: 'PIVOT(CLASSIC, S1, D)', presets: [[]] },
  { id: 's2', group: 'Levels', label: () => 'Pivot S2 (daily)', tpl: 'PIVOT(CLASSIC, S2, D)', presets: [[]] },
  { id: 'orh', group: 'Levels', label: (p) => `Opening range high ${p[0]} min`, tpl: 'OR_HIGH({0})', presets: [[15], [30]], intraday: true },
  { id: 'orl', group: 'Levels', label: (p) => `Opening range low ${p[0]} min`, tpl: 'OR_LOW({0})', presets: [[15], [30]], intraday: true },
];
export const IND_GROUPS = ['Price', 'Moving averages', 'Momentum', 'Trend', 'Volatility', 'Volume', 'Levels'];

export const OPS: [RowOp, string][] = [['>', 'greater than'], ['<', 'less than'], ['>=', 'greater or equal'], ['<=', 'less or equal'], ['xup', 'crosses above'], ['xdn', 'crosses below'], ['=', 'equal to']];
export const TFS: [string, string][] = [['1m', '1 min'], ['3m', '3 min'], ['5m', '5 min'], ['15m', '15 min'], ['30m', '30 min'], ['1h', '1 hour'], ['D', 'Daily'], ['W', 'Weekly'], ['M', 'Monthly']];
export const AGOS = [0, 1, 2, 3, 4, 5, 10, 20];
export const agoLabel = (n: number) => (n ? `${n} candle${n === 1 ? '' : 's'} ago` : 'now');

/** Example rules to start from (each one is plain rows: change anything after). */
export const ROW_EXAMPLES: { label: string; formula: string; intraday?: boolean }[] = [
  { label: 'Price crosses above yesterday\'s high', formula: 'CROSSOVER(CLOSE, [D] HIGH[1])' },
  { label: 'Price crosses above R1, RSI above 60', formula: 'CROSSOVER(CLOSE, PIVOT(CLASSIC, R1, D)) AND RSI(CLOSE, 14) > 60' },
  { label: 'Opening range breakout, above VWAP', formula: 'CLOSE > OR_HIGH(15) AND CLOSE > VWAP', intraday: true },
  { label: 'EMA 9 crosses above EMA 21', formula: 'CROSSOVER(EMA(CLOSE, 9), EMA(CLOSE, 21))' },
  { label: 'Price crosses above Supertrend 10, 3', formula: 'CROSSOVER(CLOSE, SUPERTREND(10, 3))' },
  { label: 'RSI 14 crosses back above 30', formula: 'CROSSOVER(RSI(CLOSE, 14), 30)' },
  { label: 'Volume more than 2 × its 20 average', formula: 'VOLUME > 2 * SMA(VOLUME, 20)' },
  { label: 'Close above the 52-week high', formula: '[D] CLOSE > [D] HIGHEST(HIGH, 252)[1]' },
];

export const indKey = (o: Operand) => (o.ind === 'num' ? 'num' : `${o.ind}:${o.p.join(',')}`);
export const indOf = (id: string) => INDICATORS.find((i) => i.id === id);
/** Indicators that already look back (Previous close, Highest high of last N…) take no extra "candles ago". */
export const canGoBack = (o: Pick<Operand, 'ind'>) => o.ind !== 'num' && !(indOf(o.ind)?.tpl ?? ']').endsWith(']');
export const operandLabel =(o: Operand) => (o.ind === 'num' ? String(o.num ?? 0) : indOf(o.ind)?.label(o.p) ?? o.ind);

let seq = 0;
export const newRow = (): CondRow => ({ id: `r${++seq}`, left: { tf: '', ind: 'close', p: [] }, op: '>', right: { tf: '', ind: 'sma', p: [20] }, join: 'AND', on: true });

// ---------------------------------------------------------------- rows → formula

const fill = (tpl: string, p: number[]) => tpl.replace(/\{(\d)\}/g, (_, k: string) => String(p[Number(k)] ?? p[0]));
function operandText(o: Operand): string {
  if (o.ind === 'num') return String(o.num ?? 0);
  const i = indOf(o.ind);
  if (!i) return 'CLOSE';
  const back = o.ago && canGoBack(o) ? `[${o.ago}]` : '';
  const core = `${o.tf ? `[${o.tf}] ` : ''}${fill(i.tpl, o.p)}${back}`;
  return o.mult && o.mult !== 1 ? `${o.mult} * ${core}` : core;
}
export function rowText(r: CondRow): string {
  const a = operandText(r.left), b = operandText(r.right);
  return r.op === 'xup' ? `CROSSOVER(${a}, ${b})` : r.op === 'xdn' ? `CROSSUNDER(${a}, ${b})` : `${a} ${r.op} ${b}`;
}
/** The rows as one formula: switched-off rows left out; each row's join says how the next active row connects. */
export function rowsToFormula(rows: CondRow[]): string {
  const on = rows.filter((r) => r.on);
  let f = '';
  on.forEach((r, i) => {
    const t = `(${rowText(r)})`;
    if (!i) { f = t; return; }
    const j = on[i - 1].join;
    f += j === 'OR' ? ` OR ${t}` : j === 'NOT' ? ` AND NOT ${t}` : ` AND ${t}`;
  });
  const p = f ? parseFormula(f) : null;
  return p?.ok ? p.formula : f;
}

// ---------------------------------------------------------------- formula → rows

const TEMPLATES = INDICATORS.map((i) => {
  const keys: number[] = [];
  const src = i.tpl.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{(\d)\\?\}/g, (_, k: string) => { keys.push(Number(k)); return '(\\d+(?:\\.\\d+)?)'; });
  return { i, re: new RegExp(`^${src}$`), keys };
});

function readOperand(n: Node): Operand | null {
  let mult: number | undefined, tf = '';
  if (n.t === 'bin' && n.op === '*' && n.a.t === 'num') { mult = n.a.v; n = n.b; }
  else if (n.t === 'bin' && n.op === '*' && n.b.t === 'num') { mult = n.b.v; n = n.a; }
  if (n.t === 'num') return mult ? null : { tf: '', ind: 'num', p: [], num: n.v };
  if (n.t === 'neg' && n.a.t === 'num') return mult ? null : { tf: '', ind: 'num', p: [], num: -n.a.v };
  if (n.t === 'tf') { tf = n.tf; n = n.a; }
  const m = mult ? { mult } : {};
  const whole = matchInd(n);
  if (whole) return { tf, ...whole, ...m };
  // An indicator N candles ago: RSI(CLOSE, 14)[1]
  if (n.t === 'ref' && n.n > 0) {
    const inner = matchInd(n.a);
    if (inner && canGoBack(inner)) return { tf, ...inner, ago: n.n, ...m };
  }
  return null;
}

function matchInd(n: Node): { ind: string; p: number[] } | null {
  const text = print(n);
  for (const { i, re, keys } of TEMPLATES) {
    const m = re.exec(text);
    if (!m) continue;
    const p: number[] = [];
    keys.forEach((k, j) => { p[k] = Number(m[j + 1]); });
    if (i.id === 'adx' && p.length > 1 && p[0] !== p[1]) continue;
    return { ind: i.id, p: p.filter((x) => x != null) };
  }
  return null;
}

function readLeaf(n: Node): Omit<CondRow, 'id' | 'join' | 'on'> | null {
  if (n.t === 'cmp' && n.op !== '!=') {
    const l = readOperand(n.a), r = readOperand(n.b);
    return l && r ? { left: l, op: n.op as RowOp, right: r } : null;
  }
  if (n.t === 'call' && (n.fn === 'CROSSOVER' || n.fn === 'CROSSUNDER') && n.args.length === 2) {
    const l = readOperand(n.args[0]), r = readOperand(n.args[1]);
    return l && r ? { left: l, op: n.fn === 'CROSSOVER' ? 'xup' : 'xdn', right: r } : null;
  }
  return null;
}

/** Rows for a formula; [] for an empty one; null when it isn't made of such rows (the formula editor keeps it). */
export function formulaToRows(formula: string): CondRow[] | null {
  if (!formula.trim()) return [];
  const p = parseFormula(formula);
  if (!p.ok || p.type !== 'bool') return null;
  const runs = p.node.t === 'logic' && p.node.op === 'OR' ? p.node.items : [p.node];
  const rows: CondRow[] = [];
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    const items = run.t === 'logic' && run.op === 'AND' ? run.items : [run];
    for (let k = 0; k < items.length; k++) {
      let node = items[k], negated = false;
      if (node.t === 'not') { negated = true; node = node.a; }
      if (negated && k === 0) return null; // NOT can only follow a row
      const leaf = readLeaf(node);
      if (!leaf) return null;
      if (rows.length) rows[rows.length - 1].join = k === 0 ? 'OR' : negated ? 'NOT' : 'AND';
      rows.push({ ...leaf, id: `r${++seq}`, join: 'AND', on: true });
    }
  }
  return rows;
}

export type { Tf };

const OP_WORDS: Record<RowOp, string> = { '>': 'is greater than', '<': 'is less than', '>=': 'is at least', '<=': 'is at most', '=': 'equals', xup: 'crosses above', xdn: 'crosses below' };
const TF_WORDS: Record<string, string> = Object.fromEntries(TFS);
const operandWords = (o: Operand) => (o.ind === 'num' ? String(o.num ?? 0) : `${o.mult && o.mult !== 1 ? `${o.mult} × ` : ''}${operandLabel(o)}${o.tf ? ` (${TF_WORDS[o.tf] ?? o.tf})` : ''}${o.ago ? ` ${agoLabel(o.ago)}` : ''}`);
/** The rows in plain words: "Close crosses above SMA 20 (Daily) and RSI 14 is greater than 60". */
export function rowsWords(rows: CondRow[]): string {
  const on = rows.filter((r) => r.on);
  return on.map((r, i) => `${i ? (on[i - 1].join === 'OR' ? ' or ' : on[i - 1].join === 'NOT' ? ' and not ' : ' and ') : ''}${operandWords(r.left)} ${OP_WORDS[r.op]} ${operandWords(r.right)}`).join('');
}
