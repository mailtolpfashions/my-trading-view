import { describe, expect, it } from 'vitest';
import { parseFormula } from '@mtv/rules';
import { INDICATORS, ROW_EXAMPLES, formulaToRows, rowsToFormula, rowsWords, type CondRow } from './rows';

const row = (p: Partial<CondRow>): CondRow => ({ id: 'x', left: { tf: '', ind: 'close', p: [] }, op: '>', right: { tf: '', ind: 'num', p: [], num: 1 }, join: 'AND', on: true, ...p });

describe('condition rows', () => {
  it('every indicator choice, on any time, makes a valid rule that reads back', () => {
    for (const i of INDICATORS) for (const p of i.presets) for (const tf of ['', 'D', '5m']) {
      const f = rowsToFormula([row({ left: { tf, ind: i.id, p }, op: 'xup' })]);
      expect(parseFormula(f).ok, f).toBe(true);
      expect(formulaToRows(f)?.[0].left, f).toMatchObject({ tf, ind: i.id, p });
    }
  });
  it('joins rows with AND / OR / NOT and leaves switched-off rows out', () => {
    const rows = [
      row({ left: { tf: '5m', ind: 'vol', p: [] }, right: { tf: '5m', ind: 'volsma', p: [10], mult: 2 }, join: 'OR' }),
      row({ op: 'xup', right: { tf: 'D', ind: 'ema', p: [50] }, join: 'NOT' }),
      row({ left: { tf: '', ind: 'rsi', p: [14] }, op: '<', right: { tf: '', ind: 'num', p: [], num: 30 } }),
      row({ on: false }),
    ];
    const f = rowsToFormula(rows);
    expect(f).toBe('[5m] VOLUME > 2 * [5m] SMA(VOLUME, 10) OR CROSSOVER(CLOSE, [D] EMA(CLOSE, 50)) AND NOT RSI(CLOSE, 14) < 30');
    expect(formulaToRows(f)?.map((r) => r.join)).toEqual(['OR', 'NOT', 'AND']);
    expect(rowsWords(rows)).toBe('Volume (5 min) is greater than 2 × Volume SMA 10 (5 min) or Close crosses above EMA 50 (Daily) and not RSI 14 is less than 30');
  });
  it('every example opens as rows', () => {
    for (const x of ROW_EXAMPLES) expect(formulaToRows(x.formula), x.label).not.toBeNull();
  });
  it('leaves rules the rows cannot show to the formula view', () => {
    expect(formulaToRows('HAMMER AND CLOSE > OPEN')).toBeNull();
    expect(formulaToRows('')).toEqual([]);
  });
});
