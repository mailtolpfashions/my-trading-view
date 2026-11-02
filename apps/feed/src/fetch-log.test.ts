import { describe, expect, it } from 'vitest';
import { missIsFinal } from './fetch-log';

describe('missIsFinal', () => {
  const at = (iso: string) => new Date(iso);
  it('retries a miss recorded on the day itself (NSE posted the 27 Oct 2026 file late)', () => {
    // Checked 27 Oct 13:47 UTC (19:17 IST); four hours later it must be tried again.
    expect(missIsFinal('2026-10-27', at('2026-10-27T13:47:00Z'), Date.parse('2026-10-27T17:47:00Z'))).toBe(false);
  });
  it('waits between retries', () => {
    expect(missIsFinal('2026-10-27', at('2026-10-27T13:47:00Z'), Date.parse('2026-10-27T15:00:00Z'))).toBe(true);
  });
  it('treats a miss checked two or more days later as a closed day', () => {
    expect(missIsFinal('2026-10-20', at('2026-10-26T10:42:57Z'), Date.parse('2026-11-02T00:00:00Z'))).toBe(true);
  });
});
