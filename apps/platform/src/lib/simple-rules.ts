// Simple rules: pick an indicator, a condition and a value from lists; all rows must hold (AND). Each choice is a
// formula template, so a rule written here is the same formula the engine runs, and a formula made here can be read
// back into rows. Formulas written by hand (or with the advanced builder) that don't match are left to that editor.

type Param = { key: 'a' | 'b' | 'c'; label: string; def: number };
type Cond = { id: string; label: string; formula: string; text: string; value?: { def: number; label: string; time?: boolean } };
type Item = { id: string; label: string; params: Param[]; conds: Cond[]; intraday?: boolean };

/** {a} {b} {c}: the indicator's settings; {v}: the value; {t}: a time as HHMM. */
export const CATALOGUE: Item[] = [
  { id: 'supertrend', label: 'Supertrend', params: [{ key: 'a', label: 'period', def: 10 }, { key: 'b', label: 'multiplier', def: 3 }], conds: [
    { id: 'bull', label: 'is bullish', formula: 'SUPERTREND_DIR({a}, {b}) = 1', text: 'Supertrend ({a}, {b}) is bullish' },
    { id: 'bear', label: 'is bearish', formula: 'SUPERTREND_DIR({a}, {b}) = -1', text: 'Supertrend ({a}, {b}) is bearish' },
    { id: 'turn-bull', label: 'turns bullish', formula: 'CROSSOVER(SUPERTREND_DIR({a}, {b}), 0)', text: 'Supertrend ({a}, {b}) turns bullish' },
    { id: 'turn-bear', label: 'turns bearish', formula: 'CROSSUNDER(SUPERTREND_DIR({a}, {b}), 0)', text: 'Supertrend ({a}, {b}) turns bearish' },
    { id: 'above', label: 'price closes above its line', formula: 'CLOSE > SUPERTREND({a}, {b})', text: 'the candle closes above the Supertrend ({a}, {b}) line' },
    { id: 'below', label: 'price closes below its line', formula: 'CLOSE < SUPERTREND({a}, {b})', text: 'the candle closes below the Supertrend ({a}, {b}) line' },
  ] },
  { id: 'rsi', label: 'RSI', params: [{ key: 'a', label: 'length', def: 14 }], conds: [
    { id: 'gt', label: 'is above', formula: 'RSI(CLOSE, {a}) > {v}', text: 'RSI ({a}) is above {v}', value: { def: 70, label: 'level' } },
    { id: 'lt', label: 'is below', formula: 'RSI(CLOSE, {a}) < {v}', text: 'RSI ({a}) is below {v}', value: { def: 30, label: 'level' } },
    { id: 'xup', label: 'crosses above', formula: 'CROSSOVER(RSI(CLOSE, {a}), {v})', text: 'RSI ({a}) crosses above {v}', value: { def: 70, label: 'level' } },
    { id: 'xdn', label: 'crosses below', formula: 'CROSSUNDER(RSI(CLOSE, {a}), {v})', text: 'RSI ({a}) crosses below {v}', value: { def: 30, label: 'level' } },
  ] },
  { id: 'ema', label: 'EMA', params: [{ key: 'a', label: 'length', def: 20 }], conds: [
    { id: 'above', label: 'price closes above it', formula: 'CLOSE > EMA(CLOSE, {a})', text: 'the candle closes above EMA {a}' },
    { id: 'below', label: 'price closes below it', formula: 'CLOSE < EMA(CLOSE, {a})', text: 'the candle closes below EMA {a}' },
    { id: 'xup', label: 'price crosses above it', formula: 'CROSSOVER(CLOSE, EMA(CLOSE, {a}))', text: 'price crosses above EMA {a}' },
    { id: 'xdn', label: 'price crosses below it', formula: 'CROSSUNDER(CLOSE, EMA(CLOSE, {a}))', text: 'price crosses below EMA {a}' },
  ] },
  { id: 'ema-cross', label: 'Two EMAs', params: [{ key: 'a', label: 'fast', def: 9 }, { key: 'b', label: 'slow', def: 21 }], conds: [
    { id: 'xup', label: 'fast crosses above slow', formula: 'CROSSOVER(EMA(CLOSE, {a}), EMA(CLOSE, {b}))', text: 'EMA {a} crosses above EMA {b}' },
    { id: 'xdn', label: 'fast crosses below slow', formula: 'CROSSUNDER(EMA(CLOSE, {a}), EMA(CLOSE, {b}))', text: 'EMA {a} crosses below EMA {b}' },
    { id: 'above', label: 'fast is above slow', formula: 'EMA(CLOSE, {a}) > EMA(CLOSE, {b})', text: 'EMA {a} is above EMA {b}' },
    { id: 'below', label: 'fast is below slow', formula: 'EMA(CLOSE, {a}) < EMA(CLOSE, {b})', text: 'EMA {a} is below EMA {b}' },
  ] },
  { id: 'macd', label: 'MACD', params: [{ key: 'a', label: 'fast', def: 12 }, { key: 'b', label: 'slow', def: 26 }, { key: 'c', label: 'signal', def: 9 }], conds: [
    { id: 'xup', label: 'crosses above its signal', formula: 'CROSSOVER(MACD_LINE(CLOSE, {a}, {b}, {c}), MACD_SIGNAL(CLOSE, {a}, {b}, {c}))', text: 'MACD ({a}, {b}, {c}) crosses above its signal line' },
    { id: 'xdn', label: 'crosses below its signal', formula: 'CROSSUNDER(MACD_LINE(CLOSE, {a}, {b}, {c}), MACD_SIGNAL(CLOSE, {a}, {b}, {c}))', text: 'MACD ({a}, {b}, {c}) crosses below its signal line' },
    { id: 'pos', label: 'is above zero', formula: 'MACD_LINE(CLOSE, {a}, {b}, {c}) > 0', text: 'MACD ({a}, {b}, {c}) is above zero' },
  ] },
  { id: 'adx', label: 'ADX (trend strength)', params: [{ key: 'a', label: 'length', def: 14 }, { key: 'b', label: 'smoothing', def: 14 }], conds: [
    { id: 'gt', label: 'is above', formula: 'ADX({a}, {b}) > {v}', text: 'ADX ({a}) is above {v}', value: { def: 25, label: 'level' } },
  ] },
  { id: 'bb', label: 'Bollinger Bands', params: [{ key: 'a', label: 'length', def: 20 }, { key: 'b', label: 'width', def: 2 }], conds: [
    { id: 'up', label: 'price closes above the upper band', formula: 'CLOSE > BB_UPPER(CLOSE, {a}, {b})', text: 'the candle closes above the upper Bollinger Band ({a}, {b})' },
    { id: 'dn', label: 'price closes below the lower band', formula: 'CLOSE < BB_LOWER(CLOSE, {a}, {b})', text: 'the candle closes below the lower Bollinger Band ({a}, {b})' },
    { id: 'back', label: 'price crosses back above the lower band', formula: 'CROSSOVER(CLOSE, BB_LOWER(CLOSE, {a}, {b}))', text: 'price crosses back above the lower Bollinger Band ({a}, {b})' },
  ] },
  { id: 'vwap', label: 'VWAP', params: [], intraday: true, conds: [
    { id: 'above', label: 'price closes above it', formula: 'CLOSE > VWAP', text: 'the candle closes above VWAP' },
    { id: 'below', label: 'price closes below it', formula: 'CLOSE < VWAP', text: 'the candle closes below VWAP' },
    { id: 'xup', label: 'price crosses above it', formula: 'CROSSOVER(CLOSE, VWAP)', text: 'price crosses above VWAP' },
    { id: 'xdn', label: 'price crosses below it', formula: 'CROSSUNDER(CLOSE, VWAP)', text: 'price crosses below VWAP' },
  ] },
  { id: 'or', label: 'Opening range', params: [{ key: 'a', label: 'minutes', def: 15 }], intraday: true, conds: [
    { id: 'up', label: 'price closes above its high', formula: 'CLOSE > OR_HIGH({a})', text: 'the candle closes above the first {a} minutes\' high' },
    { id: 'dn', label: 'price closes below its low', formula: 'CLOSE < OR_LOW({a})', text: 'the candle closes below the first {a} minutes\' low' },
  ] },
  { id: 'prev-day', label: 'Yesterday\'s range', params: [], conds: [
    { id: 'up', label: 'price closes above yesterday\'s high', formula: 'CLOSE > [D] HIGH[1]', text: 'the candle closes above yesterday\'s high' },
    { id: 'dn', label: 'price closes below yesterday\'s low', formula: 'CLOSE < [D] LOW[1]', text: 'the candle closes below yesterday\'s low' },
  ] },
  { id: 'volume', label: 'Volume', params: [], conds: [
    { id: 'tod', label: 'is higher than usual for this time of day', formula: 'RVOL_TOD(20) > {v}', text: 'volume is over {v}× the usual for this time of day', value: { def: 1.5, label: '× usual' } },
    { id: 'avg', label: 'is higher than the 20-bar average', formula: 'RVOL(20) > {v}', text: 'volume is over {v}× its 20-bar average', value: { def: 1.5, label: '× average' } },
  ] },
  { id: 'candle', label: 'Candle', params: [], conds: [
    { id: 'green', label: 'is green (closes above its open)', formula: 'CLOSE > OPEN', text: 'the candle is green' },
    { id: 'red', label: 'is red (closes below its open)', formula: 'CLOSE < OPEN', text: 'the candle is red' },
  ] },
  { id: 'price', label: 'Price', params: [], conds: [
    { id: 'gt', label: 'closes above', formula: 'CLOSE > {v}', text: 'the candle closes above ₹{v}', value: { def: 100, label: '₹' } },
    { id: 'lt', label: 'closes below', formula: 'CLOSE < {v}', text: 'the candle closes below ₹{v}', value: { def: 100, label: '₹' } },
  ] },
  { id: 'time', label: 'Time', params: [], intraday: true, conds: [
    { id: 'from', label: 'is from', formula: 'TIME >= {t}', text: 'the candle closes at or after {t}', value: { def: 920, label: 'time', time: true } },
    { id: 'before', label: 'is before', formula: 'TIME < {t}', text: 'the candle closes before {t}', value: { def: 1500, label: 'time', time: true } },
  ] },
];

export type Row = { item: string; cond: string; p: Partial<Record<'a' | 'b' | 'c', number>>; v?: number };

export const toHHMM = (n: number) => `${String(Math.floor(n / 100)).padStart(2, '0')}:${String(n % 100).padStart(2, '0')}`;
export const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 100 + (m || 0); };
const fill = (tpl: string, r: Row, item: Item, cond: Cond) => tpl.replace(/\{([abcvt])\}/g, (_, k: string) => {
  if (k === 'v') return String(r.v ?? cond.value?.def ?? 0);
  if (k === 't') return cond.value?.time && tpl === cond.text ? toHHMM(r.v ?? cond.value.def) : String(r.v ?? cond.value?.def ?? 0);
  return String(r.p[k as 'a'] ?? item.params.find((x) => x.key === k)?.def ?? 0);
});
export const find = (r: Row) => { const item = CATALOGUE.find((i) => i.id === r.item)!; return { item, cond: item.conds.find((c) => c.id === r.cond) ?? item.conds[0] }; };

export const rowFormula = (r: Row) => { const { item, cond } = find(r); return fill(cond.formula, r, item, cond); };
export const rowText = (r: Row) => { const { item, cond } = find(r); return fill(cond.text, r, item, cond); };
export const rowsFormula = (rows: Row[]) => rows.map(rowFormula).join(' AND ');
/** "A, B and C" */
export const rowsText = (rows: Row[]) => { const t = rows.map(rowText); return t.length < 2 ? t.join('') : `${t.slice(0, -1).join(', ')} and ${t.at(-1)}`; };

/** Reads a formula made by this editor back into rows; null when any part isn't one of the catalogue's conditions. */
export function parseRows(formula: string): Row[] | null {
  const f = formula.trim();
  if (!f) return [];
  const parts = splitAnd(f);
  const rows: Row[] = [];
  for (const part of parts) {
    let hit: Row | null = null;
    for (const item of CATALOGUE) for (const cond of item.conds) {
      if (hit) break;
      const keys: string[] = [];
      const re = new RegExp(`^${cond.formula.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{([abcvt])\}/g, (_, k: string) => { keys.push(k); return '(-?\\d+(?:\\.\\d+)?)'; })}$`);
      const m = re.exec(part.replace(/\s+/g, ' ').trim());
      if (!m) continue;
      const r: Row = { item: item.id, cond: cond.id, p: {} };
      keys.forEach((k, i) => { const n = Number(m[i + 1]); if (k === 'v' || k === 't') r.v = n; else r.p[k as 'a'] = n; });
      hit = r;
    }
    if (!hit) return null;
    rows.push(hit);
  }
  return rows;
}

/** Splits on AND outside brackets. */
function splitAnd(f: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && f.startsWith(' AND ', i)) { out.push(f.slice(start, i)); start = i + 5; i += 4; }
  }
  out.push(f.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

