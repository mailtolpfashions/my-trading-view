import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import { breadth, indexCard, moveOn, movers, parseConstituents } from './overview';

const IST = 5.5 * 3600;
const bar = (date: string, close: number, o = close): Candle => ({ time: Date.parse(`${date}T09:15:00Z`) / 1000 - IST, open: o, high: Math.max(o, close), low: Math.min(o, close), close, volume: 0 });

describe('market overview', () => {
  it('index card: last session against the previous close', () => {
    const c = indexCard('NIFTY', [bar('2026-10-29', 24000), bar('2026-10-30', 24120, 24010)])!;
    expect(c).toMatchObject({ date: '2026-10-30', close: 24120, prevClose: 24000, change: 120, open: 24010 });
    expect(c.changePct).toBeCloseTo(0.5, 10);
    expect(indexCard('X', [])).toBeNull();
  });

  it('a stock that did not trade on the latest session is not counted as unchanged', () => {
    expect(moveOn('A', [bar('2026-10-28', 10), bar('2026-10-29', 11)], '2026-10-30')).toBeNull();
    expect(moveOn('A', [bar('2026-10-29', 10), bar('2026-10-30', 11)], '2026-10-30')!.changePct).toBeCloseTo(10, 10);
    const moves = new Map([['A', { symbol: 'A', close: 11, changePct: 10 }], ['B', { symbol: 'B', close: 9, changePct: -1 }], ['C', { symbol: 'C', close: 5, changePct: 0 }], ['D', null]]);
    expect(breadth(['A', 'B', 'C', 'D', 'E'], moves)).toEqual({ advances: 1, declines: 1, unchanged: 1, members: 5, notTraded: ['D', 'E'] });
  });

  it('movers: gainers only above zero, losers only below, stable order', () => {
    const m = movers([{ symbol: 'B', close: 1, changePct: 2 }, { symbol: 'A', close: 1, changePct: 2 }, { symbol: 'C', close: 1, changePct: -3 }, { symbol: 'D', close: 1, changePct: 0 }, { symbol: 'E', close: 1, changePct: -1 }], 2);
    expect(m.gainers.map((x) => x.symbol)).toEqual(['A', 'B']);
    expect(m.losers.map((x) => x.symbol)).toEqual(['C', 'E']);
  });

  it('reads the Symbol column of NSE\'s constituent list', () => {
    expect(parseConstituents('Company Name,Industry,Symbol,Series,ISIN Code\r\nAdani Enterprises Ltd.,Metals & Mining,ADANIENT,EQ,INE423A01024\r\nAxis Bank Ltd.,Financial Services,AXISBANK,EQ,INE238A01034\r\n')).toEqual(['ADANIENT', 'AXISBANK']);
    expect(() => parseConstituents('a,b\n1,2')).toThrow(/Symbol/);
  });
});
