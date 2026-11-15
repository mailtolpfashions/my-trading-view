import { describe, expect, it } from 'vitest';
import { black76 } from '@mtv/options';
import { DEFAULT_PREMIUM_RULE, entryDue, ivDecision, pickStrikes, sellPrice, type ChainQuote } from './premium';

/** A fake NIFTY chain priced by Black-76 at one volatility, one day to expiry, bid 5 paise under and ask 5 over the model price. */
function chain(F = 25_000, sigma = 0.14, T = 1 / 365): ChainQuote[] {
  const out: ChainQuote[] = [];
  for (let k = F - 1000; k <= F + 1000; k += 50) for (const kind of ['CE', 'PE'] as const) {
    const px = Math.round(black76(kind, F, k, T, 0.065, sigma).price * 100);
    out.push({ symbol: `NIFTY${k}${kind}`, kind, strikePaise: k * 100, bidPaise: Math.max(5, px - 5), askPaise: px + 5, ltpPaise: px });
  }
  return out;
}

describe('weekly premium rule', () => {
  it('picks the out-of-the-money call and put nearest the delta from live quotes', () => {
    const p = pickStrikes(chain(), 25_000_00, 1 / 365, 0.16);
    expect(typeof p).toBe('object');
    const legs = p as Exclude<typeof p, string>;
    expect(legs.CE.strikePaise).toBeGreaterThan(25_000_00);
    expect(legs.PE.strikePaise).toBeLessThan(25_000_00);
    expect(Math.abs(legs.CE.delta - 0.16)).toBeLessThan(0.05);
    expect(Math.abs(legs.PE.delta - 0.16)).toBeLessThan(0.05);
    // one day out at 14% vol, one standard deviation is about 0.73%: the 0.16 delta sits near one deviation away
    expect(legs.CE.strikePaise / 100 - 25_000).toBeGreaterThanOrEqual(150);
    expect(legs.CE.strikePaise / 100 - 25_000).toBeLessThanOrEqual(300);
  });
  it('says why it cannot pick', () => {
    expect(pickStrikes(chain(), 25_000_00, 0, 0.16)).toBe('The expiry is not ahead');
    expect(pickStrikes(chain().filter((c) => c.kind === 'PE'), 25_000_00, 1 / 365, 0.16)).toMatch(/No quoted CE/);
    const farOnly = chain().filter((c) => Math.abs(c.strikePaise - 25_000_00) > 800_00);
    expect(pickStrikes(farOnly, 25_000_00, 1 / 365, 0.16)).toMatch(/No CE near 0.16/);
  });
  it('sells at the bid, or the last trade when the book is empty', () => {
    expect(sellPrice({ bidPaise: 1200, ltpPaise: 1250 })).toBe(1200);
    expect(sellPrice({ bidPaise: 0, ltpPaise: 1250 })).toBe(1250);
  });
  it('is due once, on its weekday, from its time', () => {
    const r = { ...DEFAULT_PREMIUM_RULE, enabled: true };
    expect(entryDue(r, '2026-11-16', 15 * 60 + 25, false)).toBe(true); // a Monday
    expect(entryDue(r, '2026-11-16', 15 * 60 + 24, false)).toBe(false);
    expect(entryDue(r, '2026-11-16', 15 * 60 + 25, true)).toBe(false);
    expect(entryDue(r, '2026-11-17', 15 * 60 + 25, false)).toBe(false); // Tuesday
    expect(entryDue({ ...r, enabled: false }, '2026-11-16', 15 * 60 + 25, false)).toBe(false);
  });
  it('reads the IV decision from the latest end-of-day point', () => {
    const hist = Array.from({ length: 300 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), iv: 12 + (i % 7) }));
    expect(ivDecision([...hist, { date: '2026-01-01', iv: 30 }])).toEqual({ high: true, asOf: '2026-01-01' });
    expect(ivDecision([...hist, { date: '2026-01-01', iv: 5 }])).toEqual({ high: false, asOf: '2026-01-01' });
    expect(ivDecision([])).toEqual({ high: null, asOf: null });
  });
});
