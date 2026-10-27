import { describe, expect, it } from 'vitest';
import { buildFuturesDays, classifyBuildUp, type FutContract } from './futures';

describe('build-up classification', () => {
  it('reads price change against OI change', () => {
    expect(classifyBuildUp(10, 500)).toBe('long-buildup');
    expect(classifyBuildUp(-10, 500)).toBe('short-buildup');
    expect(classifyBuildUp(10, -500)).toBe('short-covering');
    expect(classifyBuildUp(-10, -500)).toBe('long-unwinding');
  });
  it('is neutral when either side did not move or is unknown', () => {
    expect(classifyBuildUp(0, 500)).toBe('neutral');
    expect(classifyBuildUp(10, 0)).toBe('neutral');
    expect(classifyBuildUp(null, 500)).toBe('neutral');
  });
});

const c = (expiry: string, close: number, oi: number): FutContract => ({ expiry, closePaise: close * 100, oi, volume: 1, traded: true });

describe('futures day rows', () => {
  const byDate = new Map<string, FutContract[]>([
    ['2026-10-23', [c('2026-10-27', 22800, 10_000), c('2026-11-24', 22950, 4_000)]],
    ['2026-10-26', [c('2026-10-27', 22900, 12_000), c('2026-11-24', 23040, 6_000)]],
    // Expiry day passes: on 28 Oct the near contract is November's. Its change is measured against November's own
    // previous close (23,040), not October's (22,900).
    ['2026-10-28', [c('2026-10-27', 22850, 0), c('2026-11-24', 23000, 15_000), c('2026-12-29', 23150, 3_000)]],
  ]);
  const spot = new Map<string, number | null>([['2026-10-23', 22750_00], ['2026-10-26', 22840_00], ['2026-10-28', 22880_00]]);
  const rows = buildFuturesDays(byDate, spot);

  it('compares the near contract with itself the day before', () => {
    expect(rows[1].near).toMatchObject({ expiry: '2026-10-27', changePaise: 100_00, oiChange: 2_000, buildUp: 'long-buildup', basisPaise: 60_00, daysToExpiry: 1 });
    expect(rows[1].near!.premiumPct).toBeCloseTo((60 / 22840) * 100, 10);
    expect(rows[1].near!.carryPct).toBeCloseTo((60 / 22840) * 365 * 100, 8);
  });
  it('after expiry the next contract becomes near, compared with its own previous close (no false roll signal)', () => {
    expect(rows[2].near).toMatchObject({ expiry: '2026-11-24', changePaise: -40_00, oiChange: 9_000, buildUp: 'short-buildup' });
  });
  it('expired contracts are left out; rollover is the share of OI after the near month', () => {
    expect(rows[2].contracts.map((x) => x.expiry)).toEqual(['2026-11-24', '2026-12-29']);
    expect(rows[2].rolloverPct).toBeCloseTo((3_000 / 18_000) * 100, 10);
    expect(rows[1].rolloverPct).toBeCloseTo((6_000 / 18_000) * 100, 10);
  });
  it('the first day has no previous day to compare with', () => {
    expect(rows[0].near).toMatchObject({ changePaise: null, oiChange: null, buildUp: 'neutral' });
    expect(rows[0].totalOiChange).toBeNull();
    expect(rows[1].totalOiChange).toBe(4_000);
  });
});
