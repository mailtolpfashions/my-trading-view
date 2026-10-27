import { describe, expect, it } from 'vitest';
import { datesToFetch } from './store';

describe('datesToFetch', () => {
  const ist = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m) / 1000 - 5.5 * 3600;
  it('lists weekdays and includes today only after 18:30 IST', () => {
    expect(datesToFetch('2026-10-22', ist(26, 18, 0))).toEqual(['2026-10-22', '2026-10-23']); // Mon before publish
    expect(datesToFetch('2026-10-22', ist(26, 18, 31))).toEqual(['2026-10-22', '2026-10-23', '2026-10-26']);
  });
  it('with weekends, includes Saturday and Sunday (special sessions such as Muhurat trading)', () => {
    expect(datesToFetch('2026-10-23', ist(26, 18, 31), true)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
  });
});
