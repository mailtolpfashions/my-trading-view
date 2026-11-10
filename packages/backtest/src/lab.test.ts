import { describe, expect, it } from 'vitest';
import { computeOptionCharges } from '@mtv/paper';
import { runLab, validateLab, type LabData, type LabQuote, type LabStrategy } from './lab';

// A small made-up market: weekdays Jan–Mar 2024, monthly expiries, an option worth ₹1 a calendar day left plus intrinsic.
const days: string[] = [];
for (let t = Date.UTC(2024, 0, 1); t <= Date.UTC(2024, 2, 29); t += 86_400_000) { const d = new Date(t); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); }
const EXP = ['2024-01-25', '2024-02-29', '2024-03-28'];
function market(spotOn: (d: string) => number): LabData {
  const left = (d: string, e: string) => (Date.parse(e) - Date.parse(d)) / 86_400_000;
  const chainOn = (d: string, e: string): LabQuote[] => {
    const s = spotOn(d) * 100, out: LabQuote[] = [];
    for (let k = 18_000; k <= 22_000; k += 100) for (const kind of ['CE', 'PE'] as const) {
      const iv = Math.max(0, kind === 'CE' ? s - k * 100 : k * 100 - s);
      const px = iv + left(d, e) * 100;
      out.push({ kind, strikePaise: k * 100, closePaise: px, settlePaise: px, traded: px > 0 });
    }
    return out;
  };
  return {
    days: days.map((date) => ({ date, spotPaise: spotOn(date) * 100, lotSize: 50 })),
    monthly: EXP, expiries: EXP, iv: [],
    chains: async (e, from, to) => new Map(days.filter((d) => d >= from && d <= to).map((d) => [d, chainOn(d, e)])),
    futures: async (_e, from, to) => new Map(days.filter((d) => d >= from && d <= to).map((d) => [d, spotOn(d) * 100])),
  };
}
const base = (p: Partial<LabStrategy> = {}): LabStrategy => ({
  name: 't', underlying: 'NIFTY', schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 20 }, iv: 'any', exit: {}, missing: 'skip', slippage: 0, money: 'actual',
  legs: [
    { side: 'SELL', kind: 'CE', lots: 1, strike: { by: 'pct', pct: 2 }, expiry: 0 },
    { side: 'SELL', kind: 'PE', lots: 1, strike: { by: 'pct', pct: -2 }, expiry: 0 },
  ],
  ...p,
});

describe('option strategy lab', () => {
  it('a strangle held to expiry in a flat market keeps the credit, less charges', async () => {
    const r = await runLab(base(), market(() => 20_000));
    expect(r.trades.map((t) => [t.entry, t.expiry, t.reason])).toEqual([['2024-01-05', '2024-01-25', 'expiry'], ['2024-02-09', '2024-02-29', 'expiry'], ['2024-03-08', '2024-03-28', 'expiry']]);
    const t = r.trades[0];
    expect(t.legs.map((l) => `${l.side} ${l.strike} ${l.kind}`)).toEqual(['SELL 20400 CE', 'SELL 19600 PE']);
    // 20 calendar days left: ₹20 each, 50 qty, two legs
    expect(t.credit).toBe(2000);
    const ch = 2 * computeOptionCharges({ side: 'SELL', qty: 50, premiumPaise: 2000, date: '2024-01-05' }).total;
    expect(t.net).toBe(Math.round((200_000 - ch) / 100));
  });

  it('books profit at a close once the share of the credit is earned', async () => {
    const r = await runLab(base({ exit: { bookPct: 50 } }), market(() => 20_000));
    // ₹20 → ₹10 a leg after 10 calendar days
    expect(r.trades[0]).toMatchObject({ entry: '2024-01-05', exit: '2024-01-15', reason: 'booked' });
  });

  it('exits with days left, and the next trade waits for the last one', async () => {
    const r = await runLab(base({ schedule: { every: 'expiry', cycle: 'monthly', daysBefore: 45 }, exit: {} }), market(() => 20_000));
    // 45 days before 25 Jan is before the data starts: no January trade. 45 days before 29 Feb is 15 Jan.
    expect(r.trades[0]).toMatchObject({ entry: '2024-01-15', expiry: '2024-02-29' });
    expect(r.skipped.find((s) => s.date === '2024-02-12')?.reason).toBe('Still in the previous trade');
  });

  it('adjusts once, at the close that reaches the level', async () => {
    const spot = (d: string) => (d >= '2024-02-20' ? 20_500 : 20_000);
    const r = await runLab(base({ adjust: [{ when: { leg: 0 }, dir: 'up', actions: [{ close: 0, lots: 1 }] }] }), market(spot));
    const t = r.trades[1];
    expect(t.events).toEqual([{ date: '2024-02-20', text: 'Bought back 1 lot of 20400 CE (2024-02-29) at ₹109.00' }]);
    expect(t.legs[0]).toMatchObject({ closed: '2024-02-20', exit: 109 });
  });

  it('refuses a strategy it cannot run', () => {
    expect(validateLab(base({ legs: [] }))).toBe('Add at least one leg');
    expect(validateLab(base({ legs: [{ side: 'BUY', kind: 'FUT', lots: 1, strike: { by: 'pct', pct: 2 }, expiry: 0 }] }))).toMatch(/future has no strike/);
  });
});
