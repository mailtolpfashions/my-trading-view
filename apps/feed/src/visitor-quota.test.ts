import { describe, expect, it } from 'vitest';
import { VisitorQuota, istDay } from './visitor-quota';

const t = (iso: string) => Date.parse(iso);

describe('VisitorQuota', () => {
  it('allows the daily runs, then refuses without counting', () => {
    const q = new VisitorQuota(3, 10);
    const now = t('2026-11-01T06:00:00Z');
    expect([q.take('a', 'ip1', now), q.take('a', 'ip1', now), q.take('a', 'ip1', now)]).toEqual([2, 1, 0]);
    expect(q.take('a', 'ip1', now)).toBeNull();
    expect(q.remaining('a', 'ip1', now)).toBe(0);
    expect(q.remaining('b', 'ip1', now)).toBe(3); // another visitor on the same address
  });

  it('caps an address even when the visitor id changes (cleared cookies)', () => {
    const q = new VisitorQuota(3, 4);
    const now = t('2026-11-01T06:00:00Z');
    q.take('a', 'ip1', now); q.take('a', 'ip1', now); q.take('a', 'ip1', now);
    expect(q.take('b', 'ip1', now)).toBe(0);
    expect(q.take('c', 'ip1', now)).toBeNull();
    expect(q.take('c', 'ip2', now)).toBe(2);
  });

  it('resets at midnight IST, not UTC', () => {
    const q = new VisitorQuota(1, 5);
    expect(q.take('a', 'ip', t('2026-11-01T18:00:00Z'))).toBe(0); // 23:30 IST on 1 Nov
    expect(q.take('a', 'ip', t('2026-11-01T18:29:00Z'))).toBeNull(); // 23:59 IST
    expect(q.take('a', 'ip', t('2026-11-01T18:30:00Z'))).toBe(0); // 00:00 IST on 2 Nov
    expect(istDay(t('2026-11-01T18:30:00Z'))).toBe('2026-11-02');
  });
});
