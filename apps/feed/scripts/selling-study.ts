// The option-selling study: every playbook on NSE's official NIFTY end-of-day history, written to
// apps/feed/.data/research/selling/ for the app to show. Every result is kept, not only the winners. Rules are chosen on
// the years up to 2022 and confirmed on 2023 to today. Read-only on the database; takes a few minutes.
// Run: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=8192 -- npx tsx scripts/selling-study.ts

import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import {
  CRISIS_TAGS, STRIKE_STEP_PAISE, passCheck, runOptionsBacktest, runSelling, summariseSelling,
  type OptionsData, type PassMark, type SellingConfig, type SellingResult,
} from '@mtv/backtest';
import { GAP_SHOCKS, PLAYBOOKS, deltaOf, entryLegs, parityForward, positionMargin, yearsBetween, type Kind, type MarginLeg, type MarketSnapshot, type SellEntry } from '@mtv/options';
import { spanOn } from '../src/fno/span';
import { loadBooks } from '../src/selling/books';

const OUT = path.resolve(import.meta.dirname, '../.data/research/selling');
const U = 'NIFTY';
const WEEKLY_FROM = '2019-03-01'; // NIFTY weekly options began in February 2019
const CAPITAL = 5_00_000_00; // ₹5 lakh, in paise
const PASS: PassMark = { capitalPaise: CAPITAL, worstMonthPct: 5, worstYearPct: 15, gapPct: 8, gapLimitPct: 15 };
const BASE = { fill: 'next-close' as const, slippagePaise: 100 };
const SENSITIVITY = [
  { key: 'slip0', label: '₹0 slippage', fill: 'next-close' as const, slippagePaise: 0 },
  { key: 'slip50', label: '₹0.50 slippage', fill: 'next-close' as const, slippagePaise: 50 },
  { key: 'slip200', label: '₹2 slippage', fill: 'next-close' as const, slippagePaise: 200 },
  { key: 'sameClose', label: 'Same-close fills, ₹1 (best case)', fill: 'same-close' as const, slippagePaise: 100 },
];
const TENORS = [
  { id: 'm20', label: 'Monthly, 20 days before', cycle: 'monthly' as const, daysBefore: 20 },
  { id: 'm10', label: 'Monthly, 10 days before', cycle: 'monthly' as const, daysBefore: 10 },
  { id: 'w4', label: 'Weekly, 4 days before', cycle: 'weekly' as const, daysBefore: 4 },
];
const DELTAS = [0.1, 0.16, 0.25];
const WINGS: (number | null)[] = [null, 2, 4];

// --- Load ---------------------------------------------------------------------------------------------------------

console.time('load');
const { books, monthly, stale } = await loadBooks(console.log);
console.timeEnd('load');

const latest = books.at(-1)!;
const todayLot = latest.lotSize!;
const todayNotionalPaise = latest.spotPaise! * todayLot;
const calendar = books.map((b) => b.date);

// --- The same trades must agree with the plain backtester on real data ---------------------------------------------

const memoryData: OptionsData = {
  tradingDates: async (_u, from, to) => calendar.filter((d) => d >= from && d <= to),
  meta: async (_u, d) => { const b = books[calendar.indexOf(d)]; return b ? { spotPaise: b.spotPaise, lotSize: b.lotSize } : null; },
  expiries: async (_u, d) => books[calendar.indexOf(d)]?.expiries ?? [],
  chain: async (_u, d, e, k) => books[calendar.indexOf(d)]?.rows.get(`${e}|${k}`) ?? [],
  lotFor: async (_u, d, e) => books[calendar.indexOf(d)]?.lotByExpiry.get(e) ?? null,
  quotes: async (_u, d, cs) => new Map(cs.flatMap((c) => { const k = `${c.expiry}|${c.strikePaise}|${c.kind}`; const r = books[calendar.indexOf(d)]?.byLeg.get(k); return r ? [[k, r] as const] : []; })),
};
console.time('match check');
const from = '2023-01-01';
const plain = await runOptionsBacktest({
  name: 'check', underlying: 'NIFTY', from, entry: { when: 'daysToExpiry', days: 15 }, exit: {},
  legs: (['CE', 'PE'] as const).map((kind) => ({ kind, side: 'SELL' as const, lots: 1, strike: { by: 'moneyness' as const, moneyness: 'OTM' as const, steps: 8 }, expiry: 'month0' as const })),
}, memoryData);
const ours = runSelling({
  entry: { cycle: 'monthly', daysBefore: 15, short: { stepsOtm: 8 }, wingPct: null, lots: 1 }, playbook: PLAYBOOKS[0], fill: 'same-close', slippagePaise: 0,
  todayNotionalPaise, from, reenterSameDay: false,
}, books, monthly);
const key = (a: { entryDate: string; exitDate: string; netPaise: number }[]) => a.map((t) => `${t.entryDate} ${t.exitDate} ${t.netPaise}`);
const [pk, ok] = [key(plain.trades), key(ours.trades.filter((t) => t.exitReason !== 'end-of-data'))];
const pkDone = key(plain.trades.filter((t) => t.exitReason !== 'end-of-data'));
const same = pkDone.length === ok.length && pkDone.every((x, i) => x === ok[i]);
console.log(`Match with the plain backtester on real data: ${same ? 'exact' : 'DIFFERENT'} (${pk.length} and ${ok.length} trades)`);
if (!same) { for (let i = 0; i < Math.max(pkDone.length, ok.length); i++) if (pkDone[i] !== ok[i]) { console.log(' plain:', pkDone[i], '\n ours: ', ok[i]); break; } throw new Error('Engines disagree'); }
console.timeEnd('match check');

// --- Today's margin for each shape of position (SPAN + exposure, today's rules on today's chain) --------------------

const span = (await spanOn(latest.date, U))?.data?.[U] ?? null;
const snapshotToday = (): MarketSnapshot => {
  const spot = latest.spotPaise!, q = (e: string, k: Kind) => (latest.rows.get(`${e}|${k}`) ?? []).map((r) => ({ strikePaise: r.strikePaise, pricePaise: r.traded ? r.closePaise : r.settlePaise, traded: r.traded }));
  return {
    date: latest.date, spotPaise: spot, expiries: latest.expiries.filter((e) => e > latest.date), isMonthly: (e) => monthly.has(e), chain: q,
    quote: (l) => { const r = latest.byLeg.get(`${l.expiry}|${l.strikePaise}|${l.kind}`); return r ? { strikePaise: l.strikePaise, pricePaise: r.traded ? r.closePaise : r.settlePaise, traded: r.traded } : null; },
    delta: (l) => {
      const r = latest.byLeg.get(`${l.expiry}|${l.strikePaise}|${l.kind}`), T = yearsBetween(latest.date, l.expiry);
      if (!r?.traded || T <= 0) return null;
      return deltaOf(l.kind, r.closePaise, parityForward(q(l.expiry, 'CE'), q(l.expiry, 'PE'), spot, T) ?? spot, l.strikePaise, T);
    },
  };
};
function marginToday(e: SellEntry): { marginPaise: number; spare: number } | null {
  if (!span) return null;
  const m = snapshotToday();
  const expiry = e.cycle === 'weekly' ? m.expiries[1] ?? m.expiries[0] : m.expiries.find((x) => monthly.has(x));
  if (!expiry) return null;
  const r = entryLegs(m, expiry, e, todayLot, STRIKE_STEP_PAISE[U]);
  if ('skip' in r) return null;
  const legs: MarginLeg[] = r.legs.map((l) => ({ kind: l.kind, expiry: l.expiry, strike: l.strikePaise / 100, qty: l.side === 'SELL' ? -l.qty : l.qty, pricePaise: m.quote(l)?.pricePaise }));
  const res = positionMargin(span, legs, m.spotPaise, latest.date);
  return res.missing.length ? null : { marginPaise: res.marginPaise, spare: CAPITAL - res.marginPaise };
}

// --- The grid --------------------------------------------------------------------------------------------------------

await rm(OUT, { recursive: true, force: true });
await mkdir(path.join(OUT, 'trades'), { recursive: true });

const splitBefore = '2023-01-01';
function chosenScore(r: SellingResult) {
  let peak = 0, dd = 0, last = 0;
  for (const e of r.equity) { if (e.date >= splitBefore) break; peak = Math.max(peak, e.equityTodayPaise); dd = Math.max(dd, peak - e.equityTodayPaise); last = e.equityTodayPaise; }
  return dd > 0 ? last / dd : 0;
}

console.time('grid');
const configs = [];
let n = 0;
for (const t of TENORS) for (const delta of DELTAS) for (const wingPct of WINGS) {
  const entry: SellEntry = { cycle: t.cycle, daysBefore: t.daysBefore, short: { delta }, wingPct, lots: 1 };
  const margin = marginToday(entry);
  for (const pb of PLAYBOOKS) {
    if (wingPct != null && pb.adjust?.action === 'add-hedge') continue; // already protected
    const id = `${t.id}-d${Math.round(delta * 100)}-${wingPct == null ? 'naked' : `w${wingPct}`}-${pb.id}`;
    const common = { entry, playbook: pb, todayNotionalPaise, calendar, from: t.cycle === 'weekly' ? WEEKLY_FROM : undefined } satisfies Partial<SellingConfig>;
    const run = runSelling({ ...common, ...BASE }, books, monthly);
    const summary = summariseSelling(run);
    const pass = passCheck(summary, PASS);
    const fits = margin ? margin.marginPaise <= CAPITAL : null;
    const sens = Object.fromEntries(SENSITIVITY.map((s) => {
      const x = summariseSelling(runSelling({ ...common, fill: s.fill, slippagePaise: s.slippagePaise }, books, monthly));
      return [s.key, { netPaise: x.netPaise, confirmPeriodNetPaise: x.confirmPeriodNetPaise, worstMonthPaise: x.worstMonthPaise, maxDrawdownPaise: x.maxDrawdownPaise }];
    }));
    configs.push({
      id, tenor: t.id, tenorLabel: t.label, delta, wingPct, playbook: pb.id, playbookName: pb.name,
      summary, pass, sensitivity: sens, marginPaise: margin?.marginPaise ?? null, fitsCapital: fits, chosenScore: chosenScore(run),
    });
    await writeFile(path.join(OUT, 'trades', `${id}.json`), JSON.stringify({
      trades: run.trades.map((x) => ({ entryDate: x.entryDate, exitDate: x.exitDate, exitReason: x.exitReason, spotEntryPaise: x.spotEntryPaise, spotExitPaise: x.spotExitPaise, creditPaise: x.creditPaise, netPaise: x.netPaise, netTodayPaise: x.netTodayPaise, adjustments: x.adjustments, notes: x.notes })),
      equity: run.equity.filter((_, i) => i % 5 === 0 || i === run.equity.length - 1).map((e) => [e.date, Math.round(e.equityTodayPaise / 100)]),
      skipped: run.skipped.slice(0, 200), skippedCount: run.skipped.length,
    }));
    if (++n % 25 === 0) console.log(n, 'runs', id);
  }
}
console.timeEnd('grid');

const best = (rows: typeof configs) => [...rows].sort((a, b) => b.chosenScore - a.chosenScore)[0] ?? null;
const naked = configs.filter((c) => c.wingPct == null), hedged = configs.filter((c) => c.wingPct != null);

await writeFile(path.join(OUT, 'summary.json'), JSON.stringify({
  ranAt: new Date().toISOString(), underlying: U, from: calendar[0], to: calendar.at(-1), days: calendar.length,
  capitalPaise: CAPITAL, passMark: PASS, todayLot, todaySpotPaise: latest.spotPaise, todayNotionalPaise, baseFill: BASE,
  marginAvailable: !!span, gaps: GAP_SHOCKS, crisis: CRISIS_TAGS, sensitivity: SENSITIVITY.map(({ key: k, label }) => ({ key: k, label })),
  engineMatch: same, staleSetAside: stale, tenors: TENORS, deltas: DELTAS, wings: WINGS, playbooks: PLAYBOOKS.map((p) => ({ id: p.id, name: p.name })),
  chosen: { naked: best(naked)?.id ?? null, hedged: best(hedged)?.id ?? null }, passed: configs.filter((c) => c.pass.pass).map((c) => c.id),
  configs,
}));
console.log(`${configs.length} rule sets written. Passed: ${configs.filter((c) => c.pass.pass).length}. Margin data: ${span ? 'yes' : 'no'}`);
await prisma.$disconnect();
