// Stage 2 of the 30% ROI search: switch shape at each entry by trend (index vs its moving average, known at the
// entry close). Mixes stage-1 runs that share the same schedule / IV / booking, so entry dates line up.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { data } from './roi30-lib';

type T = { entry: string; exit: string; net: number; worstMtm: number; spotIn: number };
type R = { row: { name: string; margin: number | null }; trades: T[] };
const FILE = path.resolve(import.meta.dirname, '../../.data/research');
const runs: R[] = JSON.parse(readFileSync(path.join(FILE, 'roi30-sweep.json'), 'utf8'));
const byName = new Map(runs.map((r) => [r.row.name, r]));

const days = data.days.filter((d) => d.spotPaise);
const close = days.map((d) => d.spotPaise! / 100), at = new Map(days.map((d, i) => [d.date, i]));
const sma = (i: number, n: number) => (i + 1 < n ? null : close.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n);
type Sig = (d: string) => boolean | null; // true = up
const sigs: [string, Sig][] = [];
for (const n of [20, 50, 100, 200]) sigs.push([`sma${n}`, (d) => { const i = at.get(d); if (i == null) return null; const m = sma(i, n); return m == null ? null : close[i] > m; }]);
for (const n of [20, 60]) sigs.push([`mom${n}`, (d) => { const i = at.get(d); return i == null || i < n ? null : close[i] > close[i - n]; }]);

const yrs = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);
const FROM = runs[0].trades[0]?.entry ?? '2011-01-03', TO = data.days.at(-1)!.date;
const shapesUp = ['str25', 'str30', 'skew15/30', 'skew10/30', 'skew20/35', 'skew15/40', 'put30', 'put45', 'bullRR25', 'longFut', 'collar', 'skew15/35+crash12'];
const shapesDn = ['skip', 'str16', 'str20', 'str25', 'str30', 'skew15/30', 'put30'];
const suffixes = [...new Set(runs.map((r) => r.row.name.split(' ').slice(1).join(' ')))];

const res: { name: string; n: number; won: number; perYear: number; since16: number; since21: number; pre21: number; worst: number; mtm: number; lossYears: number; years: string; margin: number }[] = [];
for (const suf of suffixes)
  for (const [sn, sig] of sigs)
    for (const up of shapesUp)
      for (const dn of shapesDn) {
        const A = byName.get(`${up} ${suf}`), B = dn === 'skip' ? null : byName.get(`${dn} ${suf}`);
        if (!A || (dn !== 'skip' && !B)) continue;
        const bMap = new Map((B?.trades ?? []).map((t) => [t.entry, t]));
        const entries = [...new Set([...A.trades.map((t) => t.entry), ...(B?.trades ?? []).map((t) => t.entry)])].sort();
        const aMap = new Map(A.trades.map((t) => [t.entry, t]));
        const picked: T[] = [];
        let busy = '';
        for (const e of entries) {
          if (e < busy) continue;
          const s = sig(e);
          if (s == null) continue;
          const t = s ? aMap.get(e) : bMap.get(e);
          if (t) { picked.push(t); busy = t.exit; }
        }
        if (picked.length < 20) continue;
        const sum = (y: string) => picked.filter((t) => t.entry >= y).reduce((a, t) => a + t.net, 0);
        const by = new Map<string, number>();
        for (const t of picked) by.set(t.exit.slice(0, 4), (by.get(t.exit.slice(0, 4)) ?? 0) + t.net);
        res.push({
          name: `${sn} up:${up} dn:${dn} | ${suf}`, n: picked.length, won: picked.filter((t) => t.net > 0).length,
          perYear: Math.round(sum('0') / yrs(picked[0].entry < '2011-03' ? FROM : picked[0].entry, TO)), since16: Math.round(sum('2016') / yrs('2016-01-01', TO)), since21: Math.round(sum('2021') / yrs('2021-01-01', TO)), pre21: Math.round((sum('0') - sum('2021')) / yrs(picked[0].entry < '2011-03' ? FROM : picked[0].entry, '2021-01-01')),
          worst: Math.min(...picked.map((t) => t.net)), mtm: Math.min(...picked.map((t) => t.worstMtm)),
          lossYears: [...by.values()].filter((v) => v < 0).length,
          years: [...by.entries()].map(([y, v]) => `${y.slice(2)}:${Math.round(v / 1000)}`).join(' '),
          margin: Math.max(A.row.margin ?? 0, B?.row.margin ?? 0),
        });
      }
writeFileSync(path.join(FILE, 'roi30-trend.json'), JSON.stringify(res));
// Capital test: margin + worst open loss must fit ₹3 lakh.
const fits = res.filter((r) => r.margin > 0 && r.margin - r.mtm <= 300_000);
const show = (title: string, list: typeof res) => {
  console.log(`\n== ${title}`);
  for (const r of list.slice(0, 25)) console.log(`${r.name.padEnd(62)} n=${r.n} won=${Math.round((100 * r.won) / r.n)}% /yr=${r.perYear} s16=${r.since16} pre21=${r.pre21} s21=${r.since21} worst=${r.worst} mtm=${r.mtm} lossY=${r.lossYears} m=${r.margin}\n    ${r.years}`);
};
show('fits ₹3L, by profit a year (all years)', [...fits].sort((a, b) => b.perYear - a.perYear));
show('fits ₹3L, by the weaker of 2011-20 and 2021-26 per year (robust)', [...fits].sort((a, b) => Math.min(b.pre21, b.since21) - Math.min(a.pre21, a.since21)));
console.log('\ncombos', res.length, 'fit', fits.length);
await prisma.$disconnect();
