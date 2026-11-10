import { describe, expect, it } from 'vitest';
import { parseFormula } from '@mtv/rules';
import { CATALOGUE, parseRows, rowsFormula, rowsText, type Row, parseRules } from './simple-rules';

describe('simple rules', () => {
  const every: Row[] = CATALOGUE.flatMap((i) => i.conds.map((c) => ({ item: i.id, cond: c.id, p: {} })));

  it('makes a valid condition for every choice, and reads it back', () => {
    for (const r of every) {
      const f = rowsFormula([r]);
      const p = parseFormula(f);
      expect(p.ok, f).toBe(true);
      if (p.ok) expect(p.type, f).toBe('bool');
      const back = parseRows(f);
      expect(back, f).not.toBeNull();
      expect(rowsFormula(back!), f).toBe(f);
    }
  });

  it('reads the owner\'s Supertrend + RSI rule as rows and plain words', () => {
    const rows = parseRows('SUPERTREND_DIR(10, 3) = 1 AND RSI(CLOSE, 14) > 70 AND TIME >= 920');
    expect(rows).toEqual([{ item: 'supertrend', cond: 'bull', p: { a: 10, b: 3 } }, { item: 'rsi', cond: 'gt', p: { a: 14 }, v: 70 }, { item: 'time', cond: 'from', p: {}, v: 920 }]);
    expect(rowsText(rows!)).toBe('Supertrend (10, 3) is bullish, RSI (14) is above 70 and the candle closes at or after 09:20');
  });

  it('leaves formulas it did not make to the advanced editor', () => {
    expect(parseRows('ATR_PCT(14) > 3')).toBeNull();
    expect(parseRows('RSI(CLOSE, 14) > 70 OR CLOSE > OPEN')).toBeNull();
    expect(parseRows('')).toEqual([]);
  });
  it('reads "any of these" (OR) rules, and leaves AND mixed with OR to the advanced editor', () => {
    expect(parseRules('RSI(CLOSE, 14) > 70 OR CLOSE > OPEN')).toEqual({ mode: 'any', rows: [{ item: 'rsi', cond: 'gt', p: { a: 14 }, v: 70 }, { item: 'candle', cond: 'green', p: {} }] });
    expect(parseRules('RSI(CLOSE, 14) > 70 AND CLOSE > OPEN')?.mode).toBe('all');
    expect(parseRules('RSI(CLOSE, 14) > 70 AND CLOSE > OPEN OR CLOSE > VWAP')).toBeNull();
    expect(rowsFormula([{ item: 'rsi', cond: 'gt', p: { a: 14 }, v: 60 }, { item: 'pivot-d', cond: 'r1-x', p: {} }], 'any')).toBe('RSI(CLOSE, 14) > 60 OR CROSSOVER(CLOSE, PIVOT(CLASSIC, R1, D))');
  });
});
