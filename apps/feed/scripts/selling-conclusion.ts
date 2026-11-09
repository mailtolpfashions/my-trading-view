// The "Conclusion" screen's figures, computed from the saved studies (nothing typed in by hand), plus a slim copy of the
// strategy search for the browser. Run after the studies: selling-three, selling-callratio, selling-workshop,
// selling-calendar, selling-calendar-far, selling-search, selling-combo, selling-weekly-buy, selling-yearly.
// Writes .data/research/selling-conclusion.json and selling-search-ui.json.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/selling-conclusion.ts

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { ivAboveMedian } from '@mtv/options';
import { ivHistory } from '../src/selling/books';

const DIR = path.resolve(import.meta.dirname, '../.data/research'), R = Math.round, DAY = 86400_000;
const read = (n: string) => JSON.parse(readFileSync(path.join(DIR, `selling-${n}.json`), 'utf8'));
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const yrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * DAY);
type T = { entry: string; exit: string; net: number; worstMtm: number; hi?: boolean; rank?: number | null };
function stats(rows: T[], from: string, to: string) {
  const n = rows.map((t) => t.net), w = n.filter((x) => x > 0), l = n.filter((x) => x <= 0);
  const byYear: Record<string, number> = {}; for (const t of rows) byYear[t.exit.slice(0, 4)] = (byYear[t.exit.slice(0, 4)] ?? 0) + t.net;
  return {
    trades: rows.length, won: rows.length ? R((w.length / rows.length) * 100) : 0, total: R(sum(n)), perYear: R(sum(n) / yrs(from, to)),
    avgWin: w.length ? R(sum(w) / w.length) : 0, avgLoss: l.length ? R(sum(l) / l.length) : 0, wonOverLost: l.length ? Math.round((sum(w) / -sum(l)) * 10) / 10 : null,
    worst: n.length ? Math.min(...n) : 0, worstMtm: rows.length ? Math.min(...rows.map((t) => t.worstMtm)) : 0,
    losingYears: Object.values(byYear).filter((v) => v < 0).length, yearCount: Object.keys(byYear).length,
    since2023: R(sum(rows.filter((t) => t.entry >= '2023').map((t) => t.net))),
  };
}

// 1. The rules that work: high IV, 45 → 21 days, no crash put.
const three = read('three'), FROM = three.from as string, TO = three.to as string;
const v3 = (s: string, exit: number, put: boolean, book: boolean) => three.variants.find((v: { strat: string; exit: number; put: boolean; book: boolean }) => v.strat === s && v.exit === exit && v.put === put && v.book === book).trades as T[];
const RULES = [['n25', '0.25 strangle'], ['fwd', 'Straddle at forward'], ['n16', '0.16 strangle']] as const;
const best = RULES.map(([s, name]) => {
  const all = v3(s, 21, false, false), hi = all.filter((t) => t.hi);
  return {
    id: s, name, margin: three.margins[s].none as number | null, full: stats(hi, FROM, TO),
    to2020: stats(hi.filter((t) => t.entry < '2021'), '2011-01-01', '2021-01-01'), from2021: stats(hi.filter((t) => t.entry >= '2021'), '2021-01-01', TO),
    everyMonth: stats(all, FROM, TO), everyMonthFrom2016: stats(all.filter((t) => t.entry >= '2016'), '2016-01-01', TO), highFrom2016: stats(hi.filter((t) => t.entry >= '2016'), '2016-01-01', TO),
  };
});

// 2. The crash put on the same entries.
const crashPut = ([['n16', 21, false, (t: T) => t.hi === true, '0.16 strangle'], ['n25', 21, false, (t: T) => t.hi === true, '0.25 strangle'], ['fwd', 25, true, (t: T) => (t.rank ?? 0) >= 0.67, 'Straddle, top third IV, book 50%']] as const).map(([s, exit, book, f, name]) => {
  const withPut = v3(s, exit, true, book).filter(f), base = new Map(v3(s, exit, false, book).filter(f).map((t) => [t.entry, t]));
  const same = withPut.filter((t) => base.has(t.entry)), bare = same.map((t) => base.get(t.entry)!);
  return { name, trades: same.length, noPutMonths: base.size - same.length, without: { total: R(sum(bare.map((t) => t.net))), worstMtm: Math.min(...bare.map((t) => t.worstMtm)) }, with: { total: R(sum(same.map((t) => t.net))), worstMtm: Math.min(...same.map((t) => t.worstMtm)) } };
});

// 3. India VIX against our ATM IV as the filter, 2016 on (VIX history is complete from 2015).
const vixRows = (await prisma.indexEod.findMany({ where: { name: 'INDIA VIX' }, select: { date: true, closePaise: true }, orderBy: { date: 'asc' } })).map((r) => ({ date: r.date, iv: r.closePaise / 100 }));
const atm = await ivHistory('NIFTY'), A = new Map(atm.map((p) => [p.date, p.iv * 100]));
const pairs = vixRows.filter((v) => v.date >= '2015-01-01' && A.has(v.date)).map((v) => [v.iv, A.get(v.date)!] as const);
const corr = (xs: number[], ys: number[]) => { const mx = sum(xs) / xs.length, my = sum(ys) / ys.length; let a = 0, b = 0, c = 0; for (let i = 0; i < xs.length; i++) { a += (xs[i] - mx) * (ys[i] - my); b += (xs[i] - mx) ** 2; c += (ys[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const vixCoverage: Record<string, number> = {}; for (const v of vixRows) vixCoverage[v.date.slice(0, 4)] = (vixCoverage[v.date.slice(0, 4)] ?? 0) + 1;
const vix = {
  correlation: Math.round(corr(pairs.map((p) => p[0]), pairs.map((p) => p[1])) * 1000) / 1000, days: pairs.length, avgVix: Math.round((sum(pairs.map((p) => p[0])) / pairs.length) * 100) / 100, avgAtm: Math.round((sum(pairs.map((p) => p[1])) / pairs.length) * 100) / 100, coverage: vixCoverage,
  rules: RULES.map(([s, name]) => {
    const t = v3(s, 21, false, false).filter((x) => x.entry >= '2016').map((x) => ({ ...x, vixHi: ivAboveMedian(vixRows, x.entry) }));
    return { name, agree: t.filter((x) => x.vixHi != null && x.hi === x.vixHi).length, trades: t.length, atm: stats(t.filter((x) => x.hi), '2016-01-01', TO), vix: stats(t.filter((x) => x.vixHi === true), '2016-01-01', TO) };
  }),
};

// 4. The strategy search: how the 2011–2020 winners did on 2021 on.
const search = read('search');
type SRow = { id: string; family: string; params: number[]; frame: string; exit: string; iv: string; stop: number | null; margin: number | null; train: { n: number; won: number; perYear: number; pf: number; worstMtm: number; h1: number; h2: number }; test: { n: number; won: number; perYear: number; total: number; worst: number; worstMtm: number } };
const passedKey = new Set((search.passed as { id: string; frame: string; exit: string; iv: string; stop: number | null }[]).map((p) => `${p.id}|${p.frame}|${p.exit}|${p.iv}|${p.stop}`));
const passedRows = (search.rows as SRow[]).filter((r) => passedKey.has(`${r.id}|${r.frame}|${r.exit}|${r.iv}|${r.stop}`));
const distinct = new Map<string, SRow>(); for (const r of passedRows) { const k = `${r.id}|${r.frame}|${r.exit}|${r.iv}`; if (!distinct.has(k) || r.train.perYear > distinct.get(k)!.train.perYear) distinct.set(k, r); }
const searchOut = { shapes: search.shapes, combinations: search.rows.length, passed: distinct.size, top: [...distinct.values()].sort((a, b) => b.test.perYear - a.test.perYear).slice(0, 8).map((r) => ({ family: r.family, params: r.params, frame: r.frame, exit: r.exit, iv: r.iv, stop: r.stop, margin: r.margin, train: r.train, test: r.test })) };

// 5. Calendars: best version of each month pair.
const far = read('calendar-far');
const calendars = [1, 2, 3, 4, 5, 6].map((n) => {
  const ts = (far.tests as { n: number; off: number; exit: string; years: number; trades: (T & { soldDays: number; boughtDays: number })[] }[]).filter((t) => t.n === n);
  if (!ts.length) return { n, trades: 0 };
  const scored = ts.map((t) => ({ t, s: stats(t.trades, t.trades[0].entry, t.trades.at(-1)!.exit) })).sort((a, b) => b.s.perYear - a.s.perYear)[0];
  return { n, off: scored.t.off, exit: scored.t.exit, soldDays: R(sum(scored.t.trades.map((x) => x.soldDays)) / scored.t.trades.length), boughtDays: R(sum(scored.t.trades.map((x) => x.boughtDays)) / scored.t.trades.length), ...scored.s };
});

// 6. Ideas brought in from outside, as written.
const combo = read('combo').result.BANKNIFTY.tests.find((t: { months: number; wide: boolean; part1: string; part2: string }) => t.months === 1 && !t.wide && t.part1 === 'target' && t.part2 === 'hold');
const weekly = read('weekly-buy').tests.find((t: { version: string; rule: string }) => t.version.startsWith('A') && t.rule === 'hold');
const yearlyDone = (read('yearly').years as { modelPriced?: number; spotOut?: number | null; hold?: { net: number } }[]).filter((y) => y.hold && y.spotOut != null && !y.modelPriced);
const ideas = {
  combo: { total: combo.both.total, losingYears: combo.losingYears, yearCount: combo.yearCount, doubleWin: combo.doubleWin, doubleLoss: combo.doubleLoss },
  weekly: { total: weekly.all.total, since2023: weekly.since2023.total, losingYears: weekly.losingYears, yearCount: weekly.yearCount },
  yearly: { years: yearlyDone.length, total: R(sum(yearlyDone.map((y) => y.hold!.net))) },
};

writeFileSync(path.join(DIR, 'selling-conclusion.json'), JSON.stringify({ ranAt: new Date().toISOString(), from: FROM, to: TO, lot: three.lot, spot: three.spot, best, crashPut, vix, search: searchOut, calendars, ideas }));
// Slim copy of the search for the browser: one compact row per combination.
writeFileSync(path.join(DIR, 'selling-search-ui.json'), JSON.stringify({
  ranAt: search.ranAt, shapes: search.shapes, stops: search.stops,
  rows: (search.rows as SRow[]).map((r) => [r.family, r.params, r.frame, r.exit, r.iv, r.stop, r.margin, r.train.n, r.train.won, r.train.perYear, r.train.pf, r.train.worstMtm, r.train.h1, r.train.h2, r.test.n, r.test.won, r.test.perYear, r.test.total, r.test.worst, passedKey.has(`${r.id}|${r.frame}|${r.exit}|${r.iv}|${r.stop}`) ? 1 : 0]),
}));
console.log('written', JSON.stringify({ best: best.map((b) => [b.name, b.to2020.perYear, b.from2021.perYear]), searchPassed: distinct.size, calendars: calendars.map((c) => [c.n, c.trades, (c as { perYear?: number }).perYear]) }));
await prisma.$disconnect();
