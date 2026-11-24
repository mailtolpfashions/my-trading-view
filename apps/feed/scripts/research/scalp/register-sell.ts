// Records the intraday-selling study (intraday-sell.ts) in the quant registry.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/register-sell.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { register, saveDetail } from '../quant/registry';

type R = { date: string; year: string; dte: number; rs: number };
const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
const j = JSON.parse(await readFile(path.join(dir, 'intraday-sell.json'), 'utf8')) as { runs: Record<string, R[]> };
const stats = (r: R[]) => {
  let eq = 0, pk = 0, dd = 0; for (const x of r) { eq += x.rs; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const by: Record<string, number> = {}; for (const x of r) by[x.year] = Math.round((by[x.year] ?? 0) + x.rs);
  return { n: r.length, avgRs: Math.round(r.reduce((a, x) => a + x.rs, 0) / r.length), win: +(r.filter((x) => x.rs > 0).length / r.length).toFixed(3), worstRs: Math.round(Math.min(...r.map((x) => x.rs))), maxDdRs: Math.round(dd), byYear: by, losingYears: Object.entries(by).filter(([, v]) => v < 0).map(([y]) => y) };
};
const cases: [string, string, (x: R) => boolean, 'lead' | 'fail', string][] = [
  ['straddle no stop', 'every day', () => true, 'fail', 'Positive at ₹1 slippage (₹1.1 lakh/yr per lot) but about zero at ₹3: the edge is the size of the execution cost.'],
  ['straddle 50% leg stop', 'every day', () => true, 'fail', 'Same cost sensitivity as no stop.'],
  ['strangle no stop', 'every day', () => true, 'fail', 'About zero at ₹3 slippage; strikes ±100 pts are relatively wider in early years.'],
  ['straddle no stop', 'expiry day (0 DTE)', (x) => x.dte === 0, 'lead', 'Positive in 8/8 years at ₹1 and 7/8 at ₹3 slippage (2023 −₹14k). Entry is the 9:15 open: needs a forward test in the 9:30–15:00 window.'],
  ['straddle 50% leg stop', 'expiry day (0 DTE)', (x) => x.dte === 0, 'lead', 'Halves the worst day (−₹27k vs −₹53k); 6/8 years positive at ₹3 slippage.'],
];
for (const [base, when, filt, verdict, notes] of cases) {
  const r1 = j.runs[`${base} slip 1`].filter(filt), r3 = j.runs[`${base} slip 3`].filter(filt);
  const id = await register({
    name: `Intraday sell: ${base}, ${when}`, family: 'S-scalp', script: 'scripts/research/scalp/intraday-sell.ts',
    hypothesis: 'Selling NIFTY weekly options at the day open and buying back at the close earns intraday time decay after costs.',
    params: { structure: base, days: when, entry: '9:15 open (NSE daily open = first trade)', exit: 'NSE close, or the leg stop judged from the day high', lot: 65, money: "₹ per lot at today's index level" },
    period: { from: '2019-02-11', to: '2026-11-23', role: 'other' },
    costs: { broker: 'zerodha', slippage: '₹1 per fill (₹3 stress; stop fills +₹2)', charges: 'itemised, dated' },
    metrics: { slip1: stats(r1), slip3: stats(r3) }, validation: { stressSlippage3: stats(r3) },
    caveats: ['Real NSE daily option prices; entry at the 9:15 open and exit at the close, not the 9:30–15:00 window', 'Stop time unknown (judged from the day high)', 'Open-auction fills may cost more than ₹1–3', 'Margin ~₹2.5 lakh per lot (NSE SPAN, 2026-11-23), more on expiry day'],
    verdict, notes,
  });
  saveDetail(id, 'days', { slip1: r1, slip3: r3 });
}
await prisma.$disconnect();
