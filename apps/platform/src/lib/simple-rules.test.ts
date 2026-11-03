import { describe, expect, it } from 'vitest';
import { parseFormula } from '@mtv/rules';
import { CATALOGUE, parseRows, rowsFormula, rowsText, type Row } from './simple-rules';

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
    expect(parseRows('CLOSE > HIGHEST(HIGH, 20)[1]')).toBeNull();
    expect(parseRows('RSI(CLOSE, 14) > 70 OR CLOSE > OPEN')).toBeNull();
    expect(parseRows('')).toEqual([]);
  });
});
