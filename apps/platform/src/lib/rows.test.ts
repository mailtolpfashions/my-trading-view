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
  it('reads candles-ago values and any multiplier, and writes them back the same', () => {
    for (const f of [
      'RSI(CLOSE, 14)[1] < 30 AND CLOSE > CLOSE[1]',
      'CLOSE[1] < SMA(CLOSE, 20)[1] AND CLOSE > SMA(CLOSE, 20)',
      'SUPERTREND_DIR(10, 3) = 1 AND SUPERTREND_DIR(10, 3)[1] = -1',
      'CLOSE >= 0.98 * [D] HIGHEST(HIGH, 252)[1]',
      'CLOSE > OR_HIGH(15) AND RVOL_CUM(20) > 1.5',
    ]) {
      const rows = formulaToRows(f);
      expect(rows, f).not.toBeNull();
      expect(rowsToFormula(rows!), f).toBe(parseFormula(f).ok ? (parseFormula(f) as { formula: string }).formula : f);
    }
    const r = formulaToRows('RSI(CLOSE, 14)[1] < 30')!;
    expect(r[0].left).toMatchObject({ ind: 'rsi', p: [14], ago: 1 });
    expect(rowsWords(r)).toBe('RSI 14 1 candle ago is less than 30');
    // a multiplier written after the value reads the same
    expect(formulaToRows('CLOSE >= HIGHEST(HIGH, 252) * 0.98')).toBeNull(); // no [1]: not the 52-week-high row, stays a formula
    expect(formulaToRows('VOLUME > SMA(VOLUME, 20) * 1.7')![0].right).toMatchObject({ ind: 'volsma', mult: 1.7 });
  });
  it('leaves rules the rows cannot show to the formula view', () => {
    expect(formulaToRows('HAMMER AND CLOSE > OPEN')).toBeNull();
    expect(formulaToRows('')).toEqual([]);
  });
});

describe('Backtest templates and Scanner presets', () => {
  it('every Backtest template opens as rows (entry and exit)', async () => {
    const { TEMPLATES } = await import('./strategy');
    for (const t of TEMPLATES) {
      expect(formulaToRows(t.patch.entry ?? ''), `${t.id} entry`).not.toBeNull();
      if (t.patch.exit) expect(formulaToRows(t.patch.exit), `${t.id} exit`).not.toBeNull();
    }
  });
  it('a scan handed to Backtest keeps its rule, timeframe and stocks', async () => {
    const { strategyFromScan } = await import('./strategy');
    const d = strategyFromScan({ name: 'ORB', formula: 'CLOSE > OR_HIGH(15)', tf: '5m', universe: { kind: 'index', name: 'NIFTY 50' } });
    expect(d.strategy).toMatchObject({ tf: '5m', entry: 'CLOSE > OR_HIGH(15)', intraday: { squareOff: '15:00' }, stop: { kind: 'pct', value: 1 } });
    expect(d.universe).toEqual({ kind: 'index', name: 'NIFTY 50' });
    expect(strategyFromScan({ name: 'x', formula: 'CLOSE > 1', tf: 'D', universe: { kind: 'index', name: 'NIFTY 50' } }).strategy.intraday).toBeUndefined();
  });
});
