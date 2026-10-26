import { describe, expect, it } from 'vitest';
import type { Instrument } from '@mtv/shared';
import { parseChart, parseSpark, withinSession } from './providers/free';
import { auditCandles } from './quality';
import { parseEquityList, searchInstruments } from './symbols';

describe('parseChart', () => {
  it('maps Yahoo bars and drops bars with missing prices', () => {
    const candles = parseChart({
      chart: {
        error: null,
        result: [{ timestamp: [100, 400, 700], indicators: { quote: [{ open: [1, null, 3], high: [2, 5, 4], low: [0.5, 1, 2], close: [1.5, 2, 3.5], volume: [10, 20, null] }] } }],
      },
    });
    expect(candles).toEqual([
      { time: 100, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { time: 700, open: 3, high: 4, low: 2, close: 3.5, volume: 0 },
    ]);
  });
  it('rounds prices to two decimals', () => {
    const [c] = parseChart({ chart: { error: null, result: [{ timestamp: [1], indicators: { quote: [{ open: [22753.19921875], high: [22760.4], low: [22750], close: [22753.19921875], volume: [0] }] } }] } });
    expect(c.close).toBe(22753.2);
  });
  it('keeps 15:25 IST bars and drops the 15:30 closing tick', () => {
    const at = (h: number, m: number) => ({ time: Date.UTC(2026, 9, 26, h, m) / 1000 - 5.5 * 3600, open: 1, high: 1, low: 1, close: 1, volume: 0 });
    expect(withinSession(at(15, 25))).toBe(true);
    expect(withinSession(at(15, 30))).toBe(false);
    expect(withinSession(at(9, 15))).toBe(true);
  });
  it('returns nothing when Yahoo has no result', () => {
    expect(parseChart({ chart: { result: null, error: { code: 'Not Found', description: '' } } })).toEqual([]);
  });
});

describe('parseSpark', () => {
  it('uses the last non-null close and maps tickers back to our symbols', () => {
    const q = parseSpark({ '^NSEI': { symbol: '^NSEI', timestamp: [1, 2, 3], close: [22500, 22753.2, null], previousClose: 22600 } }, new Map([['^NSEI', 'NIFTY']]));
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ symbol: 'NIFTY', ltp: 22753.2, prevClose: 22600, time: 2 });
    expect(q[0].change).toBeCloseTo(153.2);
    expect(q[0].changePct).toBeCloseTo(0.6779, 3);
  });
});

describe('auditCandles', () => {
  const ist = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m) / 1000 - 5.5 * 3600;
  const bar = (time: number, o = 100, h = 101, l = 99, c = 100, v = 10) => ({ time, open: o, high: h, low: l, close: c, volume: v });
  const fullDay = (d: number, skip: string[] = []) => {
    const out = [];
    for (let t = ist(d, 9, 15); t < ist(d, 15, 30); t += 300) {
      const hm = new Date((t + 5.5 * 3600) * 1000).toISOString().slice(11, 16);
      if (!skip.includes(hm)) out.push(bar(t));
    }
    return out;
  };

  it('passes a complete session', () => {
    const r = auditCandles(fullDay(23), '5');
    expect(r.quality.ok).toBe(true);
    expect(r.candles).toHaveLength(75);
  });
  it('reports missing bars inside a session and never fills them', () => {
    const r = auditCandles(fullDay(15, ['11:45', '11:50']), '5');
    expect(r.quality.missing).toEqual([ist(15, 11, 45), ist(15, 11, 50)]);
    expect(r.candles).toHaveLength(73);
  });
  it('only counts gaps before the last bar on the latest day (session may be in progress)', () => {
    const partial = fullDay(26).filter((c) => c.time <= ist(26, 11, 0));
    expect(auditCandles([...fullDay(23), ...partial], '5').quality.ok).toBe(true);
  });
  it('drops invalid, duplicate and off-grid bars', () => {
    const r = auditCandles([bar(ist(23, 9, 15)), bar(ist(23, 9, 15)), bar(ist(23, 9, 22)), bar(ist(23, 9, 25), 100, 99, 98, 100), bar(ist(23, 9, 30))], '5');
    expect(r.quality.misaligned).toEqual([ist(23, 9, 15), ist(23, 9, 22)]);
    expect(r.quality.invalid).toEqual([ist(23, 9, 25)]);
    expect(r.quality.missing).toEqual([ist(23, 9, 20), ist(23, 9, 25)]);
    expect(r.candles.map((c) => c.time)).toEqual([ist(23, 9, 15), ist(23, 9, 30)]);
  });
  it('flags frozen bars (flat and equal to the previous close) but keeps them', () => {
    const day = fullDay(23).map((c, i) => (i === 72 ? { ...c, open: 100, high: 100, low: 100, close: 100 } : c)); // 15:15
    const r = auditCandles(day, '5');
    expect(r.quality.suspect).toEqual([ist(23, 15, 15)]);
    expect(r.quality.ok).toBe(false);
    expect(r.candles).toHaveLength(75);
  });
  it('does not flag a flat bar that moved from the previous close', () => {
    const day = fullDay(23).map((c, i) => (i === 10 ? { ...c, open: 100.5, high: 100.5, low: 100.5, close: 100.5 } : c));
    expect(auditCandles(day, '5').quality.suspect).toEqual([]);
  });
  it('checks hourly bars on the 09:15 grid (09:15, 10:15 … 15:15)', () => {
    const hours = [9, 10, 11, 12, 13, 14, 15].map((h) => bar(ist(23, h, 15)));
    expect(auditCandles(hours, '60').quality.ok).toBe(true);
    expect(auditCandles([bar(ist(23, 10, 0))], '60').quality.misaligned).toHaveLength(1);
  });
});

describe('symbols', () => {
  it('parses NSE EQUITY_L.csv keeping EQ and BE series', () => {
    const csv = 'SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING\nRELIANCE,Reliance Industries Limited,EQ,29-NOV-1995\nXYZ,Xyz Ltd,BZ,01-JAN-2000\nABC,Abc Ltd,BE,01-JAN-2001\n';
    expect(parseEquityList(csv).map((i) => i.symbol)).toEqual(['RELIANCE', 'ABC']);
  });
  it('ranks exact and prefix symbol matches before name matches', () => {
    const list: Instrument[] = [
      { symbol: 'TATAMOTORS', name: 'Tata Motors Limited', exchange: 'NSE', kind: 'EQUITY' },
      { symbol: 'TCS', name: 'Tata Consultancy Services Limited', exchange: 'NSE', kind: 'EQUITY' },
      { symbol: 'TATA', name: 'Example', exchange: 'NSE', kind: 'EQUITY' },
    ];
    expect(searchInstruments('tata', 10, list).map((i) => i.symbol)).toEqual(['TATA', 'TATAMOTORS', 'TCS']);
  });
});
