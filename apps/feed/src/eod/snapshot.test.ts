import { describe, expect, it } from 'vitest';
import { decodeSnapshot, encodeSnapshot, type Snapshot } from './snapshot';

const bar = (date: string, symbol: string, isin: string, close: number, volume: number) =>
  ({ date, symbol, isin, openPaise: close - 5, highPaise: close + 10, lowPaise: close - 20, closePaise: close, prevClosePaise: close - 1, volume });

describe('history snapshot', () => {
  it('round-trips every field, including big volumes and renamed ISINs', () => {
    const s: Snapshot = {
      writtenAt: 1_793_700_000_000,
      dates: ['2026-10-30', '2026-11-02', '2026-11-03'],
      bySymbol: new Map([
        ['ITC', [bar('2026-10-30', 'ITC', 'INE154A01025', 41_000, 12_345_678), bar('2026-11-03', 'ITC', 'INE154A01025', 41_250, 9_876_543_210)]],
        ['MRF', [bar('2026-11-02', 'MRF', 'INE883A01011', 15_000_000, 3)]],
      ]),
      indexByName: new Map([['NIFTY 50', [{ date: '2026-11-03', openPaise: 2_550_000, highPaise: 2_560_000, lowPaise: 2_540_000, closePaise: 2_555_555 }]]]),
    };
    const back = decodeSnapshot(encodeSnapshot(s));
    expect(back.writtenAt).toBe(s.writtenAt);
    expect(back.dates).toEqual(s.dates);
    expect([...back.bySymbol]).toEqual([...s.bySymbol]);
    expect([...back.indexByName]).toEqual([...s.indexByName]);
  });

  it('refuses a truncated file', () => {
    const buf = encodeSnapshot({ writtenAt: 1, dates: ['2026-11-03'], bySymbol: new Map([['A', [bar('2026-11-03', 'A', 'INE000A01010', 100, 1)]]]), indexByName: new Map() });
    expect(() => decodeSnapshot(buf.subarray(0, buf.length - 4))).toThrow(/truncated/);
  });
});
