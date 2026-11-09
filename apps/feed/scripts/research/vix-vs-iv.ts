// India VIX against our ATM IV as the "high fear" filter, on the same strangle/straddle trades (selling-three.json,
// every month, no crash put, no booking). VIX history is complete only from 2015, so the comparison starts in 2016, when
// a full past year of VIX exists. Filter = reading on the entry day above the median of the previous 250 readings.
// Run: npx dotenv -e ../../.env -- npx tsx scripts/research/vix-vs-iv.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { prisma } from '@mtv/db';
import { ivAboveMedian, ivRank } from '@mtv/options';
import { ivHistory } from '../../src/selling/books';

const vix = (await prisma.indexEod.findMany({ where: { name: 'INDIA VIX' }, select: { date: true, closePaise: true }, orderBy: { date: 'asc' } })).map((r) => ({ date: r.date, iv: r.closePaise / 100 }));
const atm = await ivHistory('NIFTY');
// How closely they move: correlation of daily levels and of daily changes, 2015 on, days with both.
const A = new Map(atm.map((p) => [p.date, p.iv * 100]));
const both = vix.filter((v) => v.date >= '2015-01-01' && A.has(v.date)).map((v) => [v.iv, A.get(v.date)!] as const);
const corr = (xs: number[], ys: number[]) => { const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length; let sxy = 0, sx = 0, sy = 0; for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sx += (xs[i] - mx) ** 2; sy += (ys[i] - my) ** 2; } return sxy / Math.sqrt(sx * sy); };
const lv = both.map((b) => b[0]), la = both.map((b) => b[1]);
console.log(`days with both, 2015 on: ${both.length} | correlation of levels ${corr(lv, la).toFixed(3)} | of daily changes ${corr(lv.slice(1).map((v, i) => v - lv[i]), la.slice(1).map((v, i) => v - la[i])).toFixed(3)} | average VIX ${(lv.reduce((a, b) => a + b, 0) / lv.length).toFixed(2)} vs ATM IV ${(la.reduce((a, b) => a + b, 0) / la.length).toFixed(2)}`);

const three = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../.data/research/selling-three.json'), 'utf8'));
const FROM = '2016-01-01';
for (const [strat, name] of [['n16', '0.16 strangle'], ['n25', '0.25 strangle'], ['fwd', 'Straddle at forward']] as const) {
  const trades = three.variants.find((v: { strat: string; exit: number; put: boolean; book: boolean }) => v.strat === strat && v.exit === 21 && !v.put && !v.book).trades.filter((t: { entry: string }) => t.entry >= FROM);
  const tag = trades.map((t: { entry: string; hi: boolean; rank: number | null; net: number; worstMtm: number }) => ({ ...t, vixHi: ivAboveMedian(vix, t.entry), vixTop: (ivRank(vix, t.entry) ?? 0) >= 0.67, atmTop: (t.rank ?? 0) >= 0.67 }));
  const s = (label: string, f: (t: (typeof tag)[number]) => boolean) => {
    const a = tag.filter(f), n = a.map((t: { net: number }) => t.net), sum = n.reduce((x: number, y: number) => x + y, 0);
    const years = (Date.parse(three.to) - Date.parse(FROM)) / (365.25 * 86400_000);
    const byYear: Record<string, number> = {}; for (const t of a) byYear[t.exit.slice(0, 4)] = (byYear[t.exit.slice(0, 4)] ?? 0) + t.net;
    return `${label.padEnd(22)} n ${String(a.length).padStart(3)} won ${String(Math.round((n.filter((x: number) => x > 0).length / Math.max(1, a.length)) * 100)).padStart(3)}% total ${String(Math.round(sum)).padStart(8)} /yr ${String(Math.round(sum / years)).padStart(7)} worst ${String(Math.min(...n)).padStart(7)} worstMTM ${String(Math.min(...a.map((t: { worstMtm: number }) => t.worstMtm))).padStart(7)} losing yrs ${Object.values(byYear).filter((v) => v < 0).length}/${Object.keys(byYear).length}`;
  };
  const agree = tag.filter((t: { hi: boolean; vixHi: boolean | null }) => t.vixHi != null && t.hi === t.vixHi).length;
  console.log(`\n${name}, entries ${FROM} on: ${tag.length}; the two filters agree on ${agree} (${Math.round((agree / tag.length) * 100)}%)`);
  console.log('  ' + s('every month', () => true));
  console.log('  ' + s('ATM IV above median', (t) => t.hi === true));
  console.log('  ' + s('VIX above median', (t) => t.vixHi === true));
  console.log('  ' + s('both above median', (t) => t.hi === true && t.vixHi === true));
  console.log('  ' + s('ATM IV top third', (t) => t.atmTop));
  console.log('  ' + s('VIX top third', (t) => t.vixTop));
  console.log('  ' + s('only ATM IV high', (t) => t.hi === true && t.vixHi === false));
  console.log('  ' + s('only VIX high', (t) => t.hi === false && t.vixHi === true));
}
await prisma.$disconnect();
