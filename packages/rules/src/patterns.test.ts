import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import { Evaluator } from './evaluate';
import { parseFormula } from './parse';
import { PATTERNS, findPatterns, patternLabel } from './patterns';

const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({ time: 1_700_000_000 + i * 86_400, open, high, low, close, volume: 1000 });

/** 20 ordinary bars drifting down (body 1), then a black candle and a white one that engulfs it. */
function engulfingChart(): Candle[] {
  const c: Candle[] = [];
  for (let i = 0; i < 20; i++) { const o = 200 - i; c.push(bar(i, o, o + 0.5, o - 1.5, o - 1)); }
  c.push(bar(20, 180, 180.5, 177.5, 178)); // black, body 2
  c.push(bar(21, 177.5, 182, 177, 181.5)); // white, opens below 178, closes above 180, body 4
  return c;
}

describe('findPatterns', () => {
  it('finds a bullish engulfing on the bar where it completes', () => {
    const c = engulfingChart();
    const hits = findPatterns(c, ['BULLISH_ENGULFING']);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ index: 21, time: c[21].time, name: 'BULLISH_ENGULFING', label: 'Bullish engulfing', side: 'bullish', bars: 2 });
  });

  it('agrees with the screener formula for every pattern', () => {
    const c = engulfingChart();
    const hits = findPatterns(c);
    const ev = new Evaluator(() => c);
    for (const p of PATTERNS) {
      const parsed = parseFormula(p.name);
      if (!parsed.ok) throw new Error(parsed.error);
      const ser = ev.series(parsed.node, 'D');
      const fromFormula = ser.flatMap((v, i) => (v === 1 ? [i] : []));
      expect(hits.filter((h) => h.name === p.name).map((h) => h.index), p.name).toEqual(fromFormula);
    }
  });

  it('returns nothing for no candles or no patterns', () => {
    expect(findPatterns([])).toEqual([]);
    expect(findPatterns(engulfingChart(), [])).toEqual([]);
  });

  it('writes plain names', () => {
    expect(patternLabel('THREE_WHITE_SOLDIERS')).toBe('Three white soldiers');
    expect(patternLabel('DOJI')).toBe('Doji');
  });
});
