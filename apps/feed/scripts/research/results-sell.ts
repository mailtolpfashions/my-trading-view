// Results-day option selling on F&O stocks, as tested in a YouTube episode (The Long and the Short): sell the ATM
// straddle on the first session after results, or an iron fly (wings ~3% away), and exit at that day's close or 1–5
// trading days later. Results days: NSE board meetings with purpose "Financial Results" (CSV the user downloaded to
// .data/research/results/). Our data is end of day, so entry is at the option's opening price (the video: 9:20 a.m.) or
// at the close. Stock options exist in our data from 2024-07-08.
// Money: the lot size of the day, after charges, with slippage of 1% of the premium per option per fill (an estimate,
// labelled as such). "Gross" = no charges, no slippage, as in the video. Return % = P&L ÷ credit received.
// Run after market hours: npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=6144 -- npx tsx scripts/research/results-sell.ts
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { computeOptionCharges } from '@mtv/paper';
import { boundedMark } from '@mtv/options';

const DIR = path.resolve(import.meta.dirname, '../../.data/research/results');
// Diwali Muhurat sessions: one special hour, not a normal session for entries or exits.
const MUHURAT = new Set(['2024-11-01', '2025-10-21', '2026-11-08']);
const SLIP = 0.01, WING = 0.03, HOLD = 5;
const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const iso = (s: string) => { const m = /^(\d{2})-(\w{3})-(\d{4})/.exec(s.trim()); return m ? `${m[3]}-${MON[m[2]]}-${m[1]}` : null; };

// ---- results days
function parseCsv(txt: string): string[][] {
  const rows: string[][] = []; let cur: string[] = [], f = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { cur.push(f); f = ''; } else if (c === '\n') { cur.push(f); rows.push(cur); cur = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  return rows;
}
const meetings: { sym: string; date: string; sent: string }[] = [];
for (const file of readdirSync(DIR).filter((f) => f.toLowerCase().endsWith('.csv'))) {
  for (const r of parseCsv(readFileSync(path.join(DIR, file), 'utf8').replace(/^﻿/, '')).slice(1)) {
    if (!/financial results/i.test(r[2] ?? '')) continue;
    const date = iso(r[4] ?? ''), sent = r[6]?.trim() ?? '';
    if (date) meetings.push({ sym: r[0].trim(), date, sent });
  }
}
// One results day per company and quarter: notices within 25 days of each other are one event; the latest notice wins
// (a rescheduled meeting is announced after the first notice).
const bySym = new Map<string, { date: string; sent: string }[]>();
for (const m of meetings) (bySym.get(m.sym) ?? bySym.set(m.sym, []).get(m.sym)!).push(m);
const sentKey = (s: string) => { const d = iso(s); return d ? d + s.slice(11) : ''; };
const events: { sym: string; date: string }[] = [];
for (const [sym, list] of bySym) {
  list.sort((a, b) => a.date.localeCompare(b.date));
  const groups: { date: string; sent: string }[][] = [];
  for (const m of list) { const g = groups.at(-1); if (g && Date.parse(m.date) - Date.parse(g[0].date) <= 25 * 864e5) g.push(m); else groups.push([m]); }
  for (const g of groups) events.push({ sym, date: g.reduce((a, b) => (sentKey(b.sent) > sentKey(a.sent) ? b : a)).date });
}

// ---- market data
const days = (await prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY' }, select: { date: true }, orderBy: { date: 'asc' } })).map((d) => d.date).filter((d) => !MUHURAT.has(d));
console.log('muhurat sessions in data, skipped:', (await prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY', date: { in: [...MUHURAT] } }, select: { date: true } })).map((d) => d.date).join(', ') || 'none');
const lastDay = days.at(-1)!;
const stocks = new Set((await prisma.fnoDayMeta.findMany({ where: { isIndex: false }, distinct: ['underlying'], select: { underlying: true } })).map((x) => x.underlying));
const FIRST = '2024-07-08';
const todo = events.filter((e) => stocks.has(e.sym) && e.date >= FIRST).sort((a, b) => a.date.localeCompare(b.date) || a.sym.localeCompare(b.sym));
console.log(`results notices ${meetings.length}, events ${events.length}, on F&O stocks since ${FIRST}: ${todo.length}`);

type Leg = { kind: 'CE' | 'PE'; strike: number; q: number }; // q: -1 sold, +1 bought
type Q = { kind: string; strikePaise: number; openPaise: number; closePaise: number; settlePaise: number; traded: boolean; volume: bigint };
type Trade = { sym: string; results: string; entry: string; mode: 'open' | 'close'; strat: 'straddle' | 'fly'; exitDay: number; lot: number; credit: number; gross: number; net: number; move: number };
const trades: Trade[] = [];
const skipped: Record<string, number> = {};
const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };

for (const ev of todo) {
  const i0 = days.findIndex((d) => d > ev.date);
  if (i0 < 0 || i0 + HOLD >= days.length) { skip('not finished yet'); continue; }
  const E = days[i0], exitDays = days.slice(i0, i0 + HOLD + 1);
  const meta = await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date: E, underlying: ev.sym } } });
  const eq = await prisma.equityEod.findFirst({ where: { symbol: ev.sym, date: E, series: 'EQ' } });
  if (!meta?.lotSize || !eq) { skip('no lot size or stock price on entry day'); continue; }
  // the nearest monthly expiry still alive after the 5-day exit
  const exps = (await prisma.fnoEod.findMany({ where: { underlying: ev.sym, date: E, kind: 'CE' }, distinct: ['expiry'], select: { expiry: true } })).map((x) => x.expiry).sort();
  const expiry = exps.find((x) => x > exitDays.at(-1)!);
  if (!expiry) { skip('no expiry after the exit'); continue; }
  const rows = (await prisma.fnoEod.findMany({ where: { underlying: ev.sym, expiry, kind: { in: ['CE', 'PE'] }, date: { in: exitDays } } })) as unknown as (Q & { date: string })[];
  const on = new Map<string, Q[]>();
  for (const r of rows) (on.get(r.date) ?? on.set(r.date, []).get(r.date)!).push(r);
  const day0 = on.get(E) ?? [];
  const strikes = [...new Set(day0.map((r) => r.strikePaise))].sort((a, b) => a - b);
  if (!strikes.length) { skip('no option chain'); continue; }
  const near = (p: number) => strikes.reduce((a, b) => (Math.abs(b - p) < Math.abs(a - p) ? b : a));
  const lot = meta.lotSize;
  const closeLast = (await prisma.equityEod.findFirst({ where: { symbol: ev.sym, date: exitDays.at(-1)!, series: 'EQ' } }))?.closePaise;

  for (const mode of ['open', 'close'] as const) {
    const ref = mode === 'open' ? eq.openPaise : eq.closePaise;
    const atm = near(ref);
    const up = strikes.find((s) => s > atm && s >= ref * (1 + WING) * 0.995) ?? null, dn = [...strikes].reverse().find((s) => s < atm && s <= ref * (1 - WING) * 1.005) ?? null;
    for (const strat of ['straddle', 'fly'] as const) {
      const legs: Leg[] = [{ kind: 'CE', strike: atm, q: -1 }, { kind: 'PE', strike: atm, q: -1 }];
      if (strat === 'fly') { if (up == null || dn == null) { skip(`${mode} fly: no wing strike`); continue; } legs.push({ kind: 'CE', strike: up, q: 1 }, { kind: 'PE', strike: dn, q: 1 }); }
      const q0 = legs.map((l) => day0.find((r) => r.kind === l.kind && r.strikePaise === l.strike));
      if (q0.some((r) => !r || !r.traded || r.volume <= 0n || (mode === 'open' ? r.openPaise : r.closePaise) <= 0)) { skip(`${mode} ${strat}: a leg did not trade at entry`); continue; }
      const px0 = q0.map((r) => (mode === 'open' ? r!.openPaise : r!.closePaise));
      const credit = legs.reduce((a, l, k) => a - l.q * px0[k], 0) * lot / 100;
      if (credit <= 0) { skip(`${mode} ${strat}: no credit`); continue; }
      for (let k = mode === 'open' ? 0 : 1; k <= HOLD; k++) {
        const t = exitDays[k], chain = on.get(t) ?? [];
        const spot = (await prisma.equityEod.findFirst({ where: { symbol: ev.sym, date: t, series: 'EQ' }, select: { closePaise: true } }))?.closePaise ?? ref;
        const px1 = legs.map((l) => { const r = chain.find((x) => x.kind === l.kind && x.strikePaise === l.strike); return r?.traded && r.closePaise > 0 ? r.closePaise : boundedMark(chain, l.kind, l.strike, spot); });
        if (px1.some((p) => p == null)) { skip(`${mode} ${strat}: no exit price`); continue; }
        let gross = 0, net = 0;
        legs.forEach((l, j) => {
          const a = px0[j], b = px1[j]!;
          gross += l.q * (b - a) * lot;
          const fa = l.q > 0 ? a * (1 + SLIP) : a * (1 - SLIP), fb = l.q > 0 ? b * (1 - SLIP) : b * (1 + SLIP); // slippage against us
          net += l.q * (fb - fa) * lot;
          net -= computeOptionCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: lot, premiumPaise: Math.round(fa), date: E }).total;
          net -= computeOptionCharges({ side: l.q > 0 ? 'SELL' : 'BUY', qty: lot, premiumPaise: Math.round(fb), date: t }).total;
        });
        trades.push({ sym: ev.sym, results: ev.date, entry: E, mode, strat, exitDay: k, lot, credit: Math.round(credit), gross: Math.round(gross / 100), net: Math.round(net / 100), move: closeLast ? Math.round(((closeLast - ref) / ref) * 1000) / 10 : 0 });
      }
    }
  }
}

// ---- summary
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pctl = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
console.log(`skipped: ${JSON.stringify(skipped)}`);
for (const mode of ['open', 'close'] as const) for (const strat of ['straddle', 'fly'] as const) {
  console.log(`\n=== ${strat}, entry at the ${mode}`);
  for (let k = 0; k <= HOLD; k++) {
    const a = trades.filter((t) => t.mode === mode && t.strat === strat && t.exitDay === k);
    if (!a.length) continue;
    const line = (key: 'gross' | 'net') => {
      const v = a.map((t) => t[key]), r = a.map((t) => (t[key] / t.credit) * 100);
      return `${key} won ${((v.filter((x) => x > 0).length / v.length) * 100).toFixed(0)}% avg% ${(r.reduce((x, y) => x + y, 0) / r.length).toFixed(1)} med% ${med(r).toFixed(1)} avg₹ ${Math.round(v.reduce((x, y) => x + y, 0) / v.length)} total₹ ${v.reduce((x, y) => x + y, 0)} worst₹ ${Math.min(...v)} 1in20₹ ${pctl(v, 0.05)}`;
    };
    console.log(`  exit day ${k}: n ${a.length} | ${line('gross')}\n${' '.repeat(16)}| ${line('net')}`);
  }
}
// by stock, 5-day exit, entry at the open, after costs
for (const strat of ['straddle', 'fly'] as const) {
  const by = new Map<string, number[]>();
  for (const t of trades.filter((x) => x.mode === 'open' && x.strat === strat && x.exitDay === HOLD)) (by.get(t.sym) ?? by.set(t.sym, []).get(t.sym)!).push(t.net);
  const enough = [...by].filter(([, v]) => v.length >= 6);
  const avgPos = enough.filter(([, v]) => v.reduce((a, b) => a + b, 0) > 0).length, medPos = enough.filter(([, v]) => med(v) > 0).length;
  console.log(`\nby stock (${strat}, open entry, 5-day exit, after costs, 6+ results): ${enough.length} stocks, positive total ${avgPos}, positive median ${medPos}`);
  const rank = enough.map(([s, v]) => ({ s, n: v.length, tot: v.reduce((a, b) => a + b, 0), med: med(v) })).sort((a, b) => b.tot - a.tot);
  console.log('  best: ' + rank.slice(0, 6).map((x) => `${x.s} ${x.tot}`).join(', ') + '\n  worst: ' + rank.slice(-6).map((x) => `${x.s} ${x.tot}`).join(', '));
}
const worst = trades.filter((t) => t.strat === 'straddle' && t.mode === 'open' && t.exitDay === HOLD).sort((a, b) => a.net - b.net).slice(0, 5);
console.log('\nworst straddles (open, 5 days): ' + worst.map((t) => `${t.sym} ${t.entry} credit ${t.credit} net ${t.net} move ${t.move}%`).join(' | '));
const first = trades[0], last = trades.at(-1)!;
console.log(`first: ${JSON.stringify(first)}\nlast: ${JSON.stringify(last)}`);
writeFileSync(path.resolve(import.meta.dirname, '../../.data/research/results-sell.json'), JSON.stringify({ skipped, trades }));
await prisma.$disconnect();
