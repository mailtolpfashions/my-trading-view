// Builds the evidence the intraday seller engine weighs itself with (packages/options/src/intraday): each past session
// is replayed through the engine's own directionalSides() at every decision time, so what is measured is exactly what
// the engine scores. Also measures E4 and the odds of price going k×ATR beyond the day's high / low by 15:30.
// Writes .data/research/seller-v14-evidence.json (read by the feed) and prints the tables.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/seller-v14-evidence.ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { intraday } from '@mtv/options';
import { MinuteStore, dateOfIst } from '../../src/intraday/store';

type Minute = intraday.Minute;
const { directionalSides, candles15, istMinute, hhmm } = intraday;
const TIMES = [570, 585, 600, 615, 630, 675, 720, 780, 840, 885]; // 09:30 … 14:45; checks only from 10:15 (gate)
const GATE = 615, K = [0, 0.1, 0.25, 0.5, 0.75, 1, 1.5];
const HEAVY = ['HDFCBANK', 'ICICIBANK', 'RELIANCE', 'INFY', 'TCS'];

// ATR(14) Wilder known at the start of each date
const daily = (await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, orderBy: { date: 'asc' } })).map((r) => ({ date: r.date, h: r.highPaise / 100, l: r.lowPaise / 100, c: r.closePaise / 100 }));
const atrOf = new Map<string, number>();
{ let atr: number | null = null; const trs: number[] = []; for (let i = 1; i < daily.length; i++) { if (atr != null) atrOf.set(daily[i].date, atr); const d = daily[i], p = daily[i - 1], tr = Math.max(d.h - d.l, Math.abs(d.h - p.c), Math.abs(d.l - p.c)); if (atr == null) { trs.push(tr); if (trs.length === 14) atr = trs.reduce((a, b) => a + b, 0) / 14; } else atr = (atr * 13 + tr) / 14; } }

const store = new MinuteStore();
async function sessions(sym: string) {
  const m = new Map<string, Minute[]>();
  for (const b of (await store.read(sym, Math.floor(Date.parse('2024-01-01') / 1000))) as Minute[]) {
    const mm = istMinute(b.time); if (mm < 555 || mm >= 930) continue;
    (m.get(dateOfIst(b.time)) ?? m.set(dateOfIst(b.time), []).get(dateOfIst(b.time))!).push(b);
  }
  for (const v of m.values()) v.sort((a, b) => a.time - b.time);
  return m;
}
const N = await sessions('NIFTY'), BN = await sessions('BANKNIFTY');
const H = Object.fromEntries(await Promise.all(HEAVY.map(async (s) => [s, await sessions(s)] as const)));
const all = [...N.keys()].sort();
const days = all.filter((d) => N.get(d)!.length >= 360 && atrOf.has(d) && istMinute(N.get(d)!.at(-1)!.time) >= 929);
const prevOf = (m: Map<string, Minute[]>, d: string) => { const k = [...m.keys()].filter((x) => x < d).sort().at(-1); return k ? m.get(k)! : null; };
const closes15 = new Map(all.map((d) => [d, candles15(N.get(d)!, 930).map((c) => c.close)]));

type Row = { day: string; t: number; sides: Record<string, 1 | -1 | 0 | null>; move: number; spot: number; atr: number; hiAfter: number; loAfter: number; dayHi: number; dayLo: number };
const rows: Row[] = [];
for (const d of days) {
  const bars = N.get(d)!, prev = prevOf(N, d);
  if (!prev) continue;
  const atr = atrOf.get(d)!, last = bars.at(-1)!;
  const prev15 = all.filter((x) => x < d).flatMap((x) => closes15.get(x)!).slice(-60);
  for (const T of TIMES) {
    const now = bars[0].time - (istMinute(bars[0].time) - T) * 60; // epoch of T on this day
    const before = bars.filter((b) => b.time + 60 <= now), after = bars.filter((b) => b.time + 60 > now);
    if (before.length < 10 || !after.length) continue;
    const snap: intraday.Snapshot = {
      now, live: true, source: `study ${d}`, nifty: bars, refClose: prev.at(-1)!.close, officialPrevClose: null, atr, atrNote: '', vix: null, vixNote: '', prev15Closes: prev15,
      bank: BN.get(d) ? { minutes: BN.get(d)!, refClose: prevOf(BN, d)?.at(-1)?.close ?? null } : null,
      heavy: HEAVY.filter((s) => H[s].get(d)).map((s) => ({ symbol: s, minutes: H[s].get(d)!, refClose: prevOf(H[s], d)?.at(-1)?.close ?? null })),
      chain: null, unknown: [],
    };
    const sides = T >= GATE ? Object.fromEntries(Object.entries(directionalSides(snap)).map(([k, v]) => [k, v.side])) : {};
    const spot = before.at(-1)!.close;
    rows.push({ day: d, t: T, sides, move: last.close - spot, spot, atr, hiAfter: Math.max(...after.map((b) => b.high)), loAfter: Math.min(...after.map((b) => b.low)), dayHi: Math.max(...before.map((b) => b.high)), dayLo: Math.min(...before.map((b) => b.low)) });
  }
}
console.log(`sessions ${days.length} (${days[0]} → ${days.at(-1)}), rows ${rows.length}`);

const IDS = ['refClose', 'vwap', 'structure', 'rsi', 'opening', 'heavyGreen', 'heavyVwap', 'bank', 'drift'] as const;
const checks: intraday.Evidence['checks'] = {};
for (const id of IDS) {
  checks[id] = {};
  for (const T of TIMES.filter((t) => t >= GATE)) {
    const act = rows.filter((r) => r.t === T && r.sides[id] != null && r.sides[id] !== 0 && r.move !== 0);
    const hit = act.length ? act.filter((r) => Math.sign(r.move) === r.sides[id]).length / act.length : null;
    checks[id]![hhmm(T)] = { hit, n: act.length };
  }
}
const e4: intraday.Evidence['e4'] = {}, breach: intraday.Evidence['breach'] = {};
for (const T of TIMES) {
  const L = rows.filter((r) => r.t === T), n = L.length;
  e4[hhmm(T)] = { stay: L.filter((r) => r.hiAfter <= r.spot + 0.25 * r.atr && r.loAfter >= r.spot - 0.25 * r.atr).length / n, n };
  breach[hhmm(T)] = { n, high: Object.fromEntries(K.map((k) => [String(k), L.filter((r) => r.hiAfter > r.dayHi + k * r.atr).length / n])), low: Object.fromEntries(K.map((k) => [String(k), L.filter((r) => r.loAfter < r.dayLo - k * r.atr).length / n])) };
}

// Base rates for display (from the phase-1 study's output)
const p1 = JSON.parse(await readFile(path.resolve(import.meta.dirname, '../../.data/research/seller-v14-phase1.json'), 'utf8').catch(() => '{}'));
const br = p1.baseRates?.lastYear;
const baseRates = br ? [
  { label: 'Gap direction continues into the close', ...br.gapContinues, dates: br.dates },
  { label: 'After a gap down, close above open', ...br.afterGapDownCloseAboveOpen, dates: br.dates },
  { label: 'After a gap up, close below open', ...br.afterGapUpCloseBelowOpen, dates: br.dates },
  { label: 'Gap fills during the day', ...br.gapFills, dates: br.dates },
  { label: 'Trend day (body ≥ 50% of range)', ...br.bodyShare.atLeast50, dates: br.dates },
  { label: 'Indecisive day (body < 35% of range)', ...br.bodyShare.under35, dates: br.dates },
] : [];

const ev: intraday.Evidence = {
  built: new Date().toISOString(), sessions: days.length, from: days[0], to: days.at(-1)!, times: TIMES, checks, e4, breach, baseRates,
  notes: ['Outcome for checks: NIFTY at the decision time → 15:29 close.', 'VWAP proxy measured as a time-weighted average (no NIFTYBEES / futures minutes yet).', 'Intraday OI shift not measured: option minutes start 2026-11-04.'],
};
const OUT = path.resolve(import.meta.dirname, '../../.data/research');
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'seller-v14-evidence.json'), JSON.stringify(ev, null, 1));

console.log('\ncheck'.padEnd(14) + TIMES.filter((t) => t >= GATE).map((t) => hhmm(t).padStart(14)).join(''));
for (const id of IDS) console.log(id.padEnd(13) + TIMES.filter((t) => t >= GATE).map((t) => { const x = checks[id]![hhmm(t)]; return `${x.hit == null ? '–' : (x.hit * 100).toFixed(1) + '%'} (${x.n})`.padStart(14); }).join(''));
console.log('\ntime   E4      breach high/low at 0.25 ATR   0.5 ATR');
for (const T of TIMES) { const b = breach[hhmm(T)]; console.log(`${hhmm(T)}  ${(e4[hhmm(T)].stay * 100).toFixed(1).padStart(5)}%   ${(b.high['0.25'] * 100).toFixed(1)}% / ${(b.low['0.25'] * 100).toFixed(1)}%            ${(b.high['0.5'] * 100).toFixed(1)}% / ${(b.low['0.5'] * 100).toFixed(1)}%   (n ${b.n})`); }
console.log('\nwritten .data/research/seller-v14-evidence.json');
await prisma.$disconnect();
