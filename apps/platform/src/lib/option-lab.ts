// The option strategy lab's templates and data calls. The engine is packages/backtest/src/lab.ts; the templates are the
// rules from our option studies (apps/feed/scripts/selling-*.ts), checked against them in apps/feed/scripts/lab-check.ts.

import type { LabLeg, LabPreview, LabResult, LabStrategy } from '@mtv/backtest';
import { feed } from './feed';

export type { LabAdjust, LabLeg, LabPreview, LabResult, LabStrategy, LabTrade } from '@mtv/backtest';
export type LabResponse = { result: LabResult; preview: LabPreview | string; margin: { rupees: number; tradeDate: string } | null };
export type SavedLab = { id: string; name: string; strategy: LabStrategy; createdAt: string; updatedAt: string };

export const labApi = {
  run: (s: LabStrategy) => feed<LabResponse>('options-lab/run', { strategy: s }),
  list: () => feed<SavedLab[]>('user/option-strategies'),
  save: (id: string | undefined, s: LabStrategy) => feed<SavedLab>('user/option-strategies', { id, name: s.name, strategy: s }),
  remove: (id: string) => feed<{ ok: true }>('user/option-strategies/delete', { id }),
};

const BASE = { underlying: 'NIFTY', iv: 'any', exit: {}, missing: 'skip', slippage: 1, money: 'today' } as const;
const sell = (kind: LabLeg['kind'], strike: LabLeg['strike'], lots = 1, expiry: LabLeg['expiry'] = 0): LabLeg => ({ side: 'SELL', kind, lots, strike, expiry });
const buy = (kind: LabLeg['kind'], strike: LabLeg['strike'], lots = 1, expiry: LabLeg['expiry'] = 0): LabLeg => ({ side: 'BUY', kind, lots, strike, expiry });
const before45 = { every: 'expiry', cycle: 'monthly', daysBefore: 45 } as const;
const callRatio = (schedule: LabStrategy['schedule']): Pick<LabStrategy, 'schedule' | 'legs' | 'adjust' | 'missing' | 'distanceFrom'> => ({
  schedule, missing: 'settlement', distanceFrom: 'atm',
  legs: [buy('CE', { by: 'atm' }), sell('CE', { by: 'pct', pct: 8 }, 2), sell('PE', { by: 'pct', pct: -8 })],
  adjust: [
    { when: { leg: 1 }, dir: 'up', actions: [{ close: 1, lots: 1 }] },
    { when: { pct: 12 }, dir: 'up', after: 0, actions: [{ close: 0, lots: 1 }, { add: buy('CE', { by: 'pct', pct: 4 }) }] },
    { when: { leg: 2 }, dir: 'down', actions: [{ close: 2, lots: 1 }] },
  ],
});

/** `tested`: one of our study rules, reproduced by the lab to the rupee (see lab-check.ts). */
export const LAB_TEMPLATES: { id: string; about: string; tested: boolean; s: LabStrategy }[] = [
  { id: 'paper', tested: true, about: 'Your paper rule: sell the 0.16 delta call and put 45 days before the monthly expiry, buy a put 15% below as crash protection, only when IV is high, out at 21 days left.',
    s: { ...BASE, name: '0.16 strangle + crash put', schedule: before45, iv: 'high', exit: { daysLeft: 21 }, legs: [sell('CE', { by: 'delta', delta: 0.16 }), sell('PE', { by: 'delta', delta: 0.16 }), buy('PE', { by: 'pct', pct: -15 })] } },
  { id: 'n25', tested: true, about: 'Sell the 0.25 delta call and put 45 days before the monthly expiry, only when IV is high, out at 21 days left. No protection.',
    s: { ...BASE, name: '0.25 strangle', schedule: before45, iv: 'high', exit: { daysLeft: 21 }, legs: [sell('CE', { by: 'delta', delta: 0.25 }), sell('PE', { by: 'delta', delta: 0.25 })] } },
  { id: 'straddle', tested: true, about: 'Sell the call and put at the forward 45 days out, only in the top third of the past year\'s IV; book 50% of the credit, else out at 25 days left.',
    s: { ...BASE, name: 'Straddle at the forward', schedule: before45, iv: 'top-third', exit: { daysLeft: 25, bookPct: 50 }, legs: [sell('CE', { by: 'forward' }), sell('PE', { by: 'forward' })] } },
  { id: 'ratio2', tested: true, about: 'Your call ratio: buy the ATM call, sell 2 calls 8% up and a put 8% down, on the expiry 2 months out. Buy back a call at its strike, roll the bought call at +12%, buy back the put at its strike.',
    s: { ...BASE, name: 'Call ratio, 2 months', ...callRatio({ every: 'after-expiry', months: 2 }) } },
  { id: 'ratioYear', tested: true, about: 'The same call ratio as a yearly trade: enter on the last Monday of January, hold to the December expiry.',
    s: { ...BASE, name: 'Call ratio, January → December', ...callRatio({ every: 'year', month: 1, day: 'last-monday', expiryMonth: 12 }) } },
  { id: 'condor', tested: false, about: 'A starting point: sell the 0.16 delta call and put, buy the 0.05 delta call and put as wings, 45 to 21 days.',
    s: { ...BASE, name: 'Iron condor', schedule: before45, exit: { daysLeft: 21 }, legs: [sell('CE', { by: 'delta', delta: 0.16 }), sell('PE', { by: 'delta', delta: 0.16 }), buy('CE', { by: 'delta', delta: 0.05 }), buy('PE', { by: 'delta', delta: 0.05 })] } },
  { id: 'bullput', tested: false, about: 'A starting point: sell the 0.25 delta put, buy the 0.10 delta put, 45 to 21 days. Less margin than a strangle.',
    s: { ...BASE, name: 'Bull put spread', schedule: before45, exit: { daysLeft: 21 }, legs: [sell('PE', { by: 'delta', delta: 0.25 }), buy('PE', { by: 'delta', delta: 0.1 })] } },
  { id: 'calendar', tested: false, about: 'A starting point: the day after each monthly expiry, sell the next month\'s ATM call and buy the month after\'s; out when the sold call expires.',
    s: { ...BASE, name: 'Call calendar', schedule: { every: 'after-expiry', months: 1 }, legs: [sell('CE', { by: 'atm' }), buy('CE', { by: 'atm' }, 1, 1)] } },
  { id: 'futput', tested: false, about: 'The "195% in 12 weeks" idea we checked (weekly expiries from 2019): every Monday buy 2 lots of the monthly future and 2 ATM weekly puts, stop at ₹5,000, else hold to the weekly expiry.',
    s: { ...BASE, name: 'Future + ATM put, weekly', from: '2019-02-11', schedule: { every: 'week', weekday: 1, expiry: 'weekly' }, exit: { stopRupees: 5000 }, legs: [buy('FUT', { by: 'atm' }, 2), buy('PE', { by: 'atm' }, 2)] } },
];

export const NEW_LAB: LabStrategy = LAB_TEMPLATES[0].s;

/** "Build my own": one leg to start from, everything else plain (any IV, hold to expiry, no adjustments). */
export const BLANK_LAB: LabStrategy = { ...BASE, name: 'My strategy', schedule: before45, legs: [sell('PE', { by: 'delta', delta: 0.16 })] };

// ---- words

export const inr = (n: number | null | undefined) => (n == null ? '–' : `${n < 0 ? '−' : ''}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`);
export const lakh = (n: number) => (Math.abs(n) >= 100_000 ? `${n < 0 ? '−' : ''}₹${(Math.abs(n) / 100_000).toFixed(2)} lakh` : inr(n));
export const KIND_WORD: Record<LabLeg['kind'], string> = { CE: 'Call', PE: 'Put', FUT: 'Future' };
export const EXPIRY_WORD = ['this expiry', 'next month', 'month after'] as const;

export function strikeWords(st: LabLeg['strike']): string {
  switch (st.by) {
    case 'atm': return 'ATM';
    case 'forward': return 'ATM (forward)';
    case 'delta': return `${st.delta} delta`;
    case 'pct': return `${st.pct > 0 ? '+' : ''}${st.pct}%`;
    case 'points': return `${st.points > 0 ? '+' : ''}${st.points} pts`;
    case 'premium': return `₹${st.rupees} premium`;
  }
}
export const legWords = (l: LabLeg) => `${l.side === 'BUY' ? 'Buy' : 'Sell'} ${l.lots} ${KIND_WORD[l.kind]}${l.kind === 'FUT' ? '' : ` ${strikeWords(l.strike)}`}${l.expiry ? `, ${EXPIRY_WORD[l.expiry]}` : ''}`;
