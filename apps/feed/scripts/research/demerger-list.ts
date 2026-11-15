// Which stocks carry an unadjusted corporate action (e.g. demerger) in their history, and when.
import { prisma } from '@mtv/db';
import { allEquityShareSymbols, dailyHistory, loadEod } from '../../src/eod/store';
import { indexMembers } from '../../src/research/overview';
await loadEod(() => {});
const n500 = new Set((await indexMembers('NIFTY 500').catch(() => ({ symbols: [] as string[] }))).symbols);
const rows: { s: string; ex: string; purpose: string; n500: boolean }[] = [];
for (const s of allEquityShareSymbols()) for (const u of dailyHistory(s)?.unhandled ?? []) rows.push({ s, ex: u.exDate, purpose: u.purpose, n500: n500.has(s) });
const by = new Map<string, number>(); for (const r of rows) by.set(r.purpose.split(/[ -]/)[0], (by.get(r.purpose.split(/[ -]/)[0]) ?? 0) + 1);
console.log('unadjusted actions:', rows.length, 'stocks:', new Set(rows.map((r) => r.s)).size, 'by kind:', JSON.stringify([...by]));
const recent = rows.filter((r) => r.n500 && r.ex >= '2023-01-01').sort((a, b) => b.ex.localeCompare(a.ex));
console.log('NIFTY 500 stocks, since 2023:', recent.length);
for (const r of recent.slice(0, 40)) console.log(' ', r.ex, r.s, '-', r.purpose.slice(0, 70));
await prisma.$disconnect(); process.exit(0);
