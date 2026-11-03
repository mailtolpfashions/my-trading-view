import { describe, expect, it } from 'vitest';
import { dayRows, derive, nextDayRows, periodRows, type FiiDay } from './fii';

const pos = (futLong: number, futShort: number) => ({ futLong, futShort, callLong: 0, callShort: 0, putLong: 0, putShort: 0 });
const d = (date: string, long: number, short: number, close: number, changePct: number | null, futBuy = 0, futSell = 0): FiiDay => ({
  date, positions: { FII: pos(long, short) }, stats: { 'INDEX FUTURES': { buyContracts: 0, buyCr: futBuy, sellContracts: 0, sellCr: futSell, oiContracts: 0, oiCr: 0 } },
  fpiEquityNetCr: null, fpiTotalNetCr: null, nifty: { close, changePct },
});

describe('FII footprints', () => {
  it('derives net position, long share and option nets', () => {
    expect(derive({ futLong: 147711, futShort: 60897, callLong: 10, callShort: 4, putLong: 3, putShort: 8 })).toEqual({ futNet: 86814, longPct: (147711 / 208608) * 100, callNet: 6, putNet: -5 });
  });
  // FII raise their net on 2 Jan (NIFTY rises 3 Jan), cut it on 3 Jan (NIFTY falls 4 Jan).
  const days = [d('2024-01-01', 100, 100, 100, null), d('2024-01-02', 150, 100, 101, 1, 50, 20), d('2024-01-03', 120, 110, 102, 0.99), d('2024-01-04', 120, 110, 100, -1.96)];
  const rows = dayRows(days);
  it('day rows carry the change in net position and the next day\'s NIFTY move', () => {
    expect(rows[1]).toMatchObject({ fiiFutNetChange: 50, niftyNextPct: 0.99, fiiIndexFutNetCr: 30 });
    expect(rows[3].niftyNextPct).toBeNull();
  });
  it('period rows: first and last net, long-share extremes with dates, totals', () => {
    const [y] = periodRows(rows, 'year');
    expect(y).toMatchObject({ period: '2024', days: 4, fiiNetStart: 0, fiiNetEnd: 10, niftyStart: 100, niftyEnd: 100, fiiIndexFutNetCrTotal: 30 });
    expect(y.longPctHigh!.date).toBe('2024-01-02');
  });
  it('next-day counts per year', () => {
    expect(nextDayRows(rows)).toEqual([{ year: '2024', addedLongs: { up: 1, down: 0 }, cutLongs: { up: 0, down: 1 }, unchanged: 0 }]); // 4 Jan is unchanged but has no next day yet
  });
});
