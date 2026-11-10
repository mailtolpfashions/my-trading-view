// Numbers for a Bank Nifty market report on the latest session, all measured, nothing assumed:
//  - the session: Kite 1-minute bars (Zerodha's data, stored by the feed), NSE's official daily bars, members' EOD
//  - technicals on 5/15/30-minute bars at the session's close: EMA 20, EMA 50, RSI 14, time-weighted average (the
//    index has no volume, so no true VWAP; labelled), structure
//  - levels: pivots / CPR from the session, previous highs and lows, option OI walls from NSE's F&O file
//  - history 2011 -> today: next-session up / down / sideways split, range in ATR, per time block; after a day like
//    this one too; ATM option breakevens against how often Bank Nifty moved that far by expiry
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/banknifty-report.ts
import { prisma } from '@mtv/db';
import { resample } from '@mtv/rules';
import type { Candle } from '@mtv/shared';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';
import { indexMemberRows } from '../../src/research/overview';

const R = (x: number, d = 2) => Number(x.toFixed(d));
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
const ist = (t: number) => { const d = new Date((t + 19800) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const ema = (xs: number[], n: number) => { const k = 2 / (n + 1); let e = xs[0]; return xs.map((x, i) => (e = i ? x * k + e * (1 - k) : x)); };
const rsi = (xs: number[], n = 14) => { let g = 0, l = 0; for (let i = 1; i <= n; i++) { const c = xs[i] - xs[i - 1]; g += Math.max(c, 0) / n; l += Math.max(-c, 0) / n; } for (let i = n + 1; i < xs.length; i++) { const c = xs[i] - xs[i - 1]; g = (g * (n - 1) + Math.max(c, 0)) / n; l = (l * (n - 1) + Math.max(-c, 0)) / n; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };

// ---- daily history (NSE official) and ATR
const D = (await prisma.indexEod.findMany({ where: { name: 'NIFTY BANK' }, orderBy: { date: 'asc' } })).map((r) => ({ date: r.date, o: r.openPaise / 100, h: r.highPaise / 100, l: r.lowPaise / 100, c: r.closePaise / 100 }));
const last = D.at(-1)!, prev = D.at(-2)!;
const atrAt: number[] = [];
{ let a: number | null = null; const tr: number[] = []; for (let i = 1; i < D.length; i++) { const t = Math.max(D[i].h - D[i].l, Math.abs(D[i].h - D[i - 1].c), Math.abs(D[i].l - D[i - 1].c)); if (a == null) { tr.push(t); if (tr.length === 14) a = tr.reduce((x, y) => x + y, 0) / 14; } else a = (a * 13 + t) / 14; atrAt[i] = a ?? NaN; } }
const atr = atrAt[D.length - 1];
console.log(`SESSION ${last.date} (NSE official): prev close ${prev.c} (${prev.date}), open ${last.o}, high ${last.h}, low ${last.l}, close ${last.c}, change ${R(last.c - prev.c)} (${pc(last.c / prev.c - 1)}), gap ${R(last.o - prev.c)} (${pc(last.o / prev.c - 1)})`);
console.log(`ATR(14) Wilder ${R(atr)} from ${D.length} daily bars (${D[0].date} -> ${last.date}); today's range ${R(last.h - last.l)} = ${R((last.h - last.l) / atr)} ATR; close at ${pc((last.c - last.l) / (last.h - last.l))} of the day's range`);

// ---- intraday technicals from Kite minutes
const store = new MinuteStore();
const mins = (await store.read('BANKNIFTY', Math.floor(Date.parse('2026-08-01') / 1000))).filter((b) => { const m = ist(b.time); return m >= 555 && m < 930; }) as Candle[];
const today = mins.filter((b) => dateOfIst(b.time) === last.date);
console.log(`\nKite minutes for ${last.date}: ${today.length} (${today.length ? new Date((today[0].time + 19800) * 1000).toISOString().slice(11, 16) : '-'} -> ${today.length ? new Date((today.at(-1)!.time + 19800) * 1000).toISOString().slice(11, 16) : '-'}); minute OHLC check vs NSE: open ${today[0]?.open} high ${Math.max(...today.map((b) => b.high))} low ${Math.min(...today.map((b) => b.low))} close ${today.at(-1)?.close}`);
const twap = today.reduce((a, b) => a + (b.high + b.low + b.close) / 3, 0) / today.length;
console.log(`time-weighted average price (VWAP stand-in, index has no volume): ${R(twap)}; close vs it: ${R(last.c - twap)}`);
for (const tf of ['5m', '15m', '30m'] as const) {
  const bars = resample(mins, tf), cl = bars.map((b) => b.close);
  const e20 = ema(cl, 20).at(-1)!, e50 = ema(cl, 50).at(-1)!, r = rsi(cl), c = cl.at(-1)!;
  const [a, b] = bars.slice(-2);
  const hh = b.high > a.high && b.low > a.low ? 'higher high + higher low' : b.high < a.high && b.low < a.low ? 'lower high + lower low' : 'inside / mixed';
  const trend = c > e20 && e20 > e50 && r > 50 ? 'Bullish' : c < e20 && e20 < e50 && r < 50 ? 'Bearish' : 'Neutral';
  const up = bars.filter((x) => dateOfIst(x.time) === last.date && x.close > x.open).length, n = bars.filter((x) => dateOfIst(x.time) === last.date).length;
  console.log(`${tf.padEnd(4)} close ${c} | EMA20 ${R(e20)} EMA50 ${R(e50)} | RSI14 ${R(r, 1)} | last two bars: ${hh} | green bars today ${up}/${n} | rule -> ${trend}`);
}
const fh = today.filter((b) => ist(b.time) < 570), orH = Math.max(...fh.map((b) => b.high)), orL = Math.min(...fh.map((b) => b.low));
console.log(`opening range 09:15-09:30: ${orL} - ${orH}; session high at ${new Date((today.reduce((a, b) => (b.high > a.high ? b : a)).time + 19800) * 1000).toISOString().slice(11, 16)}, low at ${new Date((today.reduce((a, b) => (b.low < a.low ? b : a)).time + 19800) * 1000).toISOString().slice(11, 16)}`);
for (const [s, e] of [[555, 630], [630, 720], [720, 810], [810, 930]] as const) {
  const blk = today.filter((b) => ist(b.time) >= s && ist(b.time) < e);
  console.log(`  block ${s / 60 | 0}:${String(s % 60).padStart(2, '0')}: open ${blk[0].open} close ${blk.at(-1)!.close} (${R(blk.at(-1)!.close - blk[0].open)}), range ${R(Math.max(...blk.map((b) => b.high)) - Math.min(...blk.map((b) => b.low)))}`);
}

// ---- breadth: Bank Nifty members on the session
const members = (await indexMemberRows('NIFTY BANK').catch(() => [])).map((m) => m.symbol);
const eq = await prisma.equityEod.findMany({ where: { date: last.date, symbol: { in: members } }, select: { symbol: true, closePaise: true, prevClosePaise: true } });
const ch = eq.map((e) => ({ s: e.symbol, p: e.closePaise / e.prevClosePaise - 1 })).sort((a, b) => b.p - a.p);
console.log(`\nbreadth ${last.date}: ${ch.filter((x) => x.p > 0).length} up, ${ch.filter((x) => x.p < 0).length} down of ${ch.length} members: ${ch.map((x) => `${x.s} ${x.p >= 0 ? '+' : ''}${(x.p * 100).toFixed(2)}%`).join(', ')}`);

// ---- levels
const P = (last.h + last.l + last.c) / 3, BC = (last.h + last.l) / 2, TC = 2 * P - BC;
console.log(`\nlevels for the next session (classic pivots from ${last.date}): R2 ${R(P + (last.h - last.l))} R1 ${R(2 * P - last.l)} P ${R(P)} S1 ${R(2 * P - last.h)} S2 ${R(P - (last.h - last.l))}; CPR ${R(Math.min(TC, BC))}-${R(Math.max(TC, BC))} (width ${R(Math.abs(TC - BC))} = ${pc(Math.abs(TC - BC) / last.c)}); 5-day high ${Math.max(...D.slice(-5).map((d) => d.h))} low ${Math.min(...D.slice(-5).map((d) => d.l))}; 20-day high ${Math.max(...D.slice(-20).map((d) => d.h))} low ${Math.min(...D.slice(-20).map((d) => d.l))}`);
const der = await prisma.fnoDerivedDay.findMany({ where: { underlying: 'BANKNIFTY', date: last.date }, orderBy: { expiry: 'asc' } });
const near = der.find((d) => d.expiry >= last.date)!;
console.log(`F&O (NSE file ${last.date}): expiries ${der.map((d) => d.expiry).join(' ')}; nearest ${near.expiry} (${near.daysToExpiry} calendar days): ATM IV ${near.atmIv ? (near.atmIv * 100).toFixed(1) + '%' : '-'}, straddle ${(near.straddlePaise ?? 0) / 100}, max pain ${(near.maxPainPaise ?? 0) / 100}, call wall ${(near.callWallPaise ?? 0) / 100}, put wall ${(near.putWallPaise ?? 0) / 100}, PCR ${(Number(near.peOi) / Number(near.ceOi)).toFixed(2)}`);
const chain = await prisma.fnoEod.findMany({ where: { underlying: 'BANKNIFTY', date: last.date, expiry: near.expiry, kind: { in: ['CE', 'PE'] } } });
const strikes = [...new Set(chain.map((r) => r.strikePaise / 100))].sort((a, b) => a - b);
const atm = strikes.reduce((a, b) => (Math.abs(b - last.c) < Math.abs(a - last.c) ? b : a));
const row = (k: 'CE' | 'PE', s: number) => chain.find((r) => r.kind === k && r.strikePaise / 100 === s);
const ce = row('CE', atm)!, pe = row('PE', atm)!;
console.log(`ATM ${atm}: CE close ${ce.closePaise / 100} (traded ${ce.traded}, OI ${ce.oi}), PE close ${pe.closePaise / 100} (traded ${pe.traded}, OI ${pe.oi})`);
const top = (k: 'CE' | 'PE') => chain.filter((r) => r.kind === k && (k === 'CE' ? r.strikePaise / 100 > last.c : r.strikePaise / 100 < last.c)).sort((a, b) => Number(b.oi - a.oi)).slice(0, 3).map((r) => `${r.strikePaise / 100} (${r.oi})`).join(', ');
console.log(`biggest call OI above: ${top('CE')} | biggest put OI below: ${top('PE')}`);

// ---- history: next-session split, ranges, after a day like this
const rows = D.map((d, i) => ({ d, i })).filter(({ i }) => i > 15 && i < D.length - 1 && Number.isFinite(atrAt[i]));
const split = (list: typeof rows) => {
  let up = 0, dn = 0, side = 0; const rng: number[] = [], oc: number[] = [];
  for (const { i } of list) { const n = D[i + 1], a = atrAt[i], m = n.c - n.o; if (m >= 0.25 * a) up++; else if (m <= -0.25 * a) dn++; else side++; rng.push((n.h - n.l) / a); oc.push(Math.abs(m) / a); }
  rng.sort((a, b) => a - b); oc.sort((a, b) => a - b);
  const q = (xs: number[], p: number) => xs[Math.floor(p * (xs.length - 1))];
  return { n: list.length, up: up / list.length, down: dn / list.length, side: side / list.length, rng10: q(rng, 0.1), rng50: q(rng, 0.5), rng90: q(rng, 0.9), oc50: q(oc, 0.5) };
};
const show = (label: string, s: ReturnType<typeof split>) => console.log(`${label.padEnd(44)} n ${String(s.n).padStart(4)} | up ${pc(s.up)} down ${pc(s.down)} sideways ${pc(s.side)} | next range ATR: 10% ${R(s.rng10)} median ${R(s.rng50)} 90% ${R(s.rng90)} (= ${R(s.rng10 * atr, 0)} / ${R(s.rng50 * atr, 0)} / ${R(s.rng90 * atr, 0)} pts) | median |open->close| ${R(s.oc50 * atr, 0)} pts`);
console.log(`\nnext session open->close, split at +/-0.25 ATR (${R(0.25 * atr, 0)} pts now):`);
show('all sessions', split(rows));
show('last 12 months', split(rows.filter(({ d }) => d.date >= '2025-11-09')));
const chg = last.c / prev.c - 1;
show(`after a day up ${pc(chg)} +/-0.5pp`, split(rows.filter(({ i }) => { const c = D[i].c / D[i - 1].c - 1; return Math.abs(c - chg) <= 0.005; })));
show('after a close in the top 10% of the day range', split(rows.filter(({ i }) => (D[i].c - D[i].l) / (D[i].h - D[i].l) >= 0.9)));
const nextGapHol = rows.filter(({ i }) => (Date.parse(D[i + 1].date) - Date.parse(D[i].date)) / 86400000 >= 2 && new Date(D[i].date).getUTCDay() !== 5);
show('after a midweek holiday gap (like 10 Nov)', split(nextGapHol));

// ---- time blocks, last year of Kite minutes (Bank Nifty)
const byDay = new Map<string, Candle[]>();
for (const b of mins) (byDay.get(dateOfIst(b.time)) ?? byDay.set(dateOfIst(b.time), []).get(dateOfIst(b.time))!).push(b);
const allMins = (await store.read('BANKNIFTY', Math.floor(Date.parse('2025-11-01') / 1000))).filter((b) => { const m = ist(b.time); return m >= 555 && m < 930; });
const days = new Map<string, Candle[]>();
for (const b of allMins) (days.get(dateOfIst(b.time)) ?? days.set(dateOfIst(b.time), []).get(dateOfIst(b.time))!).push(b as Candle);
console.log(`\ntime blocks, Bank Nifty, ${days.size} Kite sessions (${[...days.keys()].sort()[0]} -> ${[...days.keys()].sort().at(-1)}):`);
for (const [s, e, name] of [[555, 630, '09:15-10:30'], [630, 720, '10:30-12:00'], [720, 810, '12:00-13:30'], [810, 930, '13:30-15:30']] as const) {
  const ups: number[] = [], rngs: number[] = [], shares: number[] = [], trends: number[] = [];
  for (const list of days.values()) {
    const blk = list.filter((b) => ist(b.time) >= s && ist(b.time) < e); if (blk.length < (e - s) * 0.8) continue;
    const hi = Math.max(...blk.map((b) => b.high)), lo = Math.min(...blk.map((b) => b.low)), dayR = Math.max(...list.map((b) => b.high)) - Math.min(...list.map((b) => b.low));
    ups.push(blk.at(-1)!.close > blk[0].open ? 1 : 0); rngs.push(hi - lo); shares.push(dayR ? (hi - lo) / dayR : 0); trends.push(hi > lo ? Math.abs(blk.at(-1)!.close - blk[0].open) / (hi - lo) : 0);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`  ${name}: n ${ups.length}, closed up ${pc(avg(ups))}, median range ${R(med(rngs), 0)} pts (${pc(avg(shares))} of the day's range on average), trend strength |net move| / range ${R(avg(trends))}`);
}

// ---- ATM options: breakeven vs how often Bank Nifty moved that far by expiry (calendar days -> sessions)
const sess = D.filter((d) => d.date > last.date && d.date <= near.expiry).length; // none stored yet, so count weekdays minus NSE holidays below
const hol = new Set(['2026-11-10', '2026-11-24', '2026-12-25']);
let k = 0; for (let t = Date.parse(last.date) + 86400000; t <= Date.parse(near.expiry); t += 86400000) { const d = new Date(t); const s = d.toISOString().slice(0, 10); if (d.getUTCDay() % 6 !== 0 && !hol.has(s)) k++; }
const ceBe = atm + ce.closePaise / 100, peBe = atm - pe.closePaise / 100;
const moves = D.map((d, i) => (i + k < D.length ? D[i + k].c / d.c - 1 : null)).filter((x): x is number => x != null);
const recent = D.map((d, i) => (i + k < D.length && d.date >= '2021-01-01' ? D[i + k].c / d.c - 1 : null)).filter((x): x is number => x != null);
const p = (xs: number[], f: (x: number) => boolean) => xs.filter(f).length / xs.length;
console.log(`\nATM ${atm} to expiry ${near.expiry}: ${k} sessions (counted with NSE holidays 10 Nov, 24 Nov). ${sess ? '' : ''}`);
console.log(`  CE breakeven at expiry ${R(ceBe)} = ${pc(ceBe / last.c - 1)} from close; PE breakeven ${R(peBe)} = ${pc(peBe / last.c - 1)}`);
console.log(`  history of ${k}-session moves (all ${moves.length} | since 2021 ${recent.length}): beyond CE breakeven ${pc(p(moves, (x) => x >= ceBe / last.c - 1))} | ${pc(p(recent, (x) => x >= ceBe / last.c - 1))}; beyond PE breakeven ${pc(p(moves, (x) => x <= peBe / last.c - 1))} | ${pc(p(recent, (x) => x <= peBe / last.c - 1))}; up at all ${pc(p(moves, (x) => x > 0))} | ${pc(p(recent, (x) => x > 0))}`);
await prisma.$disconnect();
