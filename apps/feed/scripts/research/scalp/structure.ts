// Scalping study, step 2: rebuild the "Long and the Short" scalping series' market-structure tables on our own
// NIFTY 50 spot minutes (3-minute bars, 2023-01 → yesterday), so we know our data and method match theirs before
// testing any setup. Adds what the videos skipped: how far price goes AGAINST a breakout before / after it pays.
// Spot points, gross (no costs). Special sessions (Muhurat, Saturday DR drills: < 120 three-minute bars) are left out.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/structure.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';
import { resample } from '@mtv/rules';
import { MinuteStore, dateOfIst } from '../../../src/intraday/store';

const IST = 5.5 * 3600;
const hm = (t: number) => { const d = new Date((t + IST) * 1000); return d.getUTCHours() * 100 + d.getUTCMinutes(); };
const weekday = (d: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${d}T12:00:00Z`).getUTCDay()];
const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pct = (n: number, d = 1) => `${f(n * 100, d)}%`;
const hiOf = (b: Candle[]) => Math.max(...b.map((c) => c.high));
const loOf = (b: Candle[]) => Math.min(...b.map((c) => c.low));

type Day = { date: string; year: string; wd: string; bars: Candle[]; open: number; high: number; low: number; close: number; range: number };

const store = new MinuteStore();
const today = dateOfIst(Date.now() / 1000);
const mins = (await store.read('NIFTY', Date.parse('2023-01-01T00:00:00+05:30') / 1000)).filter((c) => dateOfIst(c.time) < today);
const byDate = new Map<string, Candle[]>();
for (const c of mins) { const d = dateOfIst(c.time); (byDate.get(d) ?? byDate.set(d, []).get(d)!).push(c); }
const days: Day[] = [];
const skipped: string[] = [];
for (const [date, m] of [...byDate].sort()) {
  const bars = resample(m.filter((c) => hm(c.time) >= 915 && hm(c.time) < 1530), '3m');
  if (bars.length < 120) { skipped.push(date); continue; }
  const high = hiOf(bars), low = loOf(bars);
  days.push({ date, year: date.slice(0, 4), wd: weekday(date), bars, open: bars[0].open, high, low, close: bars[bars.length - 1].close, range: high - low });
}
const years = [...new Set(days.map((d) => d.year))];
const out: Record<string, unknown> = { days: days.length, from: days[0].date, to: days[days.length - 1].date, skipped };
const lines: string[] = [];
const log = (s = '') => { lines.push(s); console.log(s); };
log(`NIFTY spot 3-min, ${days[0].date} → ${days[days.length - 1].date}: ${days.length} days (special sessions left out: ${skipped.join(', ')})`);

// 1. Day range as % of open (video 2: median 0.824%).
log('\n1. Day range (high − low) as % of open');
const t1 = years.map((y) => { const r = days.filter((d) => d.year === y).map((d) => d.range / d.open); return { y, n: r.length, median: med(r), mean: mean(r), pts: med(days.filter((d) => d.year === y).map((d) => d.range)) }; });
for (const r of t1) log(`  ${r.y}: n ${r.n}  median ${pct(r.median, 3)}  mean ${pct(r.mean, 3)}  median points ${f(r.pts, 0)}`);
log(`  all: median ${pct(med(days.map((d) => d.range / d.open)), 3)}`);
out.range = t1;

// 2. S1 / S2 / S3 share of the day's range (video 2: S1 70–76%, S2 11–13%, S3 12–17%).
const seg = (d: Day) => {
  const s1 = d.bars.filter((c) => hm(c.time) < 1130), s2 = d.bars.filter((c) => hm(c.time) >= 1130 && hm(c.time) < 1330), s3 = d.bars.filter((c) => hm(c.time) >= 1330);
  const h1 = hiOf(s1), l1 = loOf(s1), h2 = Math.max(h1, hiOf(s2)), l2 = Math.min(l1, loOf(s2));
  const a = h1 - l1, b = (h2 - h1) + (l1 - l2), c = (d.high - h2) + (l2 - d.low);
  return { s1, s2, s3, share: [a / d.range, b / d.range, c / d.range] };
};
log('\n2. Share of the day\'s range made in S1 (9:15–11:30) / S2 (11:30–13:30) / S3 (13:30–15:30), mean');
const t2 = years.map((y) => {
  const ds = days.filter((d) => d.year === y).map(seg);
  const narrow = ds.filter((s) => s.share[0] < 0.35);
  return { y, s1: mean(ds.map((s) => s.share[0])), s2: mean(ds.map((s) => s.share[1])), s3: mean(ds.map((s) => s.share[2])), narrowS1Days: narrow.length, s3OnNarrow: mean(narrow.map((s) => s.share[2])), s3Over40: ds.filter((s) => s.share[2] > 0.4).length, n: ds.length };
});
for (const r of t2) log(`  ${r.y}: S1 ${pct(r.s1)}  S2 ${pct(r.s2)}  S3 ${pct(r.s3)} | S1<35% days ${r.narrowS1Days} → S3 share ${pct(r.s3OnNarrow)} | S3>40% days ${r.s3Over40}/${r.n}`);
out.segments = t2;

// 3. Initial range 9:15–9:30 and breakout follow-through till 11:30 (video 2: IR median 69, extension ~0.61× up / 0.68× down).
// Breakout = first 3-min CLOSE beyond the IR (bars from 9:30 to the 11:27 bar). Extension = best move beyond the IR
// edge till 11:30, in IR multiples. Added: from the breakout close (a real entry), the worst move against (MAE) and best
// move for (MFE) till 11:30, and the 11:30 close vs entry.
log('\n3. Initial range 9:15–9:30 and first breakout (3-min close) till 11:30');
type Br = { date: string; year: string; wd: string; dir: 1 | -1; ir: number; ext: number; entry: number; mae: number; mfe: number; at1130: number; time: number };
const brs: Br[] = [];
const irs = new Map<string, number>();
let noBreak = 0;
for (const d of days) {
  const irBars = d.bars.filter((c) => hm(c.time) < 930), after = d.bars.filter((c) => hm(c.time) >= 930 && hm(c.time) < 1130);
  const ih = hiOf(irBars), il = loOf(irBars), ir = ih - il;
  irs.set(d.date, ir);
  const i = after.findIndex((c) => c.close > ih || c.close < il);
  if (i < 0) { noBreak++; continue; }
  const dir = after[i].close > ih ? 1 : -1, entry = after[i].close, rest = after.slice(i + 1);
  const tail = after.slice(i);
  const ext = dir === 1 ? (hiOf(tail) - ih) / ir : (il - loOf(tail)) / ir;
  const mae = rest.length ? (dir === 1 ? entry - loOf(rest) : hiOf(rest) - entry) : 0;
  const mfe = rest.length ? (dir === 1 ? hiOf(rest) - entry : entry - loOf(rest)) : 0;
  const at1130 = dir * ((rest[rest.length - 1] ?? after[i]).close - entry);
  brs.push({ date: d.date, year: d.year, wd: d.wd, dir, ir, ext, entry, mae: Math.max(0, mae), mfe: Math.max(0, mfe), at1130, time: hm(after[i].time) });
}
for (const y of years) {
  const irY = days.filter((d) => d.year === y).map((d) => irs.get(d.date)!);
  const b = brs.filter((r) => r.year === y), up = b.filter((r) => r.dir === 1), dn = b.filter((r) => r.dir === -1);
  log(`  ${y}: IR median ${f(med(irY), 0)} mean ${f(mean(irY), 0)} | up ${up.length} down ${dn.length} none ${days.filter((d) => d.year === y).length - b.length} | extension × IR median up ${f(med(up.map((r) => r.ext)), 2)} down ${f(med(dn.map((r) => r.ext)), 2)}`);
  log(`        from breakout close: median against ${f(med(b.map((r) => r.mae)), 0)} pts, median for ${f(med(b.map((r) => r.mfe)), 0)} pts, 11:30 close vs entry mean ${f(mean(b.map((r) => r.at1130)), 1)} median ${f(med(b.map((r) => r.at1130)), 1)}, ahead at 11:30 ${pct(b.filter((r) => r.at1130 > 0).length / b.length, 0)}`);
}
log(`  breakout time: median ${med(brs.map((r) => r.time))} (hhmm); first-bar-after-9:30 breakouts ${pct(brs.filter((r) => r.time === 930).length / brs.length, 0)}`);
log(`  against before 11:30 vs IR size: median MAE/IR ${f(med(brs.map((r) => r.mae / r.ir)), 2)}; breakouts that went ≥ 1× IR against ${pct(brs.filter((r) => r.mae >= r.ir).length / brs.length, 0)}`);
out.breakout = { noBreak, list: brs };

// 4. Trend days (video 2: ~18% of days, ~45/yr). Staircase S1→S2→S3: higher high AND higher low (or both lower);
// each step ≥ 10% of the day range; close in top / bottom 25% of the range. Step tested two ways:
// "lead" = the leading side only (highs on up days, lows on down days, as the video's example), "both" = highs and lows.
log('\n4. Trend days (staircase S1→S2→S3, steps ≥ 10% of range, close in the outer 25%)');
type TD = { date: string; year: string; wd: string; dir: 1 | -1 | 0; both: 1 | -1 | 0 };
const tds: TD[] = days.map((d) => {
  const { s1, s2, s3 } = seg(d);
  const H = [hiOf(s1), hiOf(s2), hiOf(s3)], L = [loOf(s1), loOf(s2), loOf(s3)], m = 0.1 * d.range, pos = (d.close - d.low) / d.range;
  const up = H[1] > H[0] && H[2] > H[1] && L[1] > L[0] && L[2] > L[1] && pos >= 0.75;
  const dn = H[1] < H[0] && H[2] < H[1] && L[1] < L[0] && L[2] < L[1] && pos <= 0.25;
  const upLead = up && H[1] - H[0] >= m && H[2] - H[1] >= m, dnLead = dn && L[0] - L[1] >= m && L[1] - L[2] >= m;
  const upBoth = upLead && L[1] - L[0] >= m && L[2] - L[1] >= m, dnBoth = dnLead && H[0] - H[1] >= m && H[1] - H[2] >= m;
  return { date: d.date, year: d.year, wd: d.wd, dir: upLead ? 1 : dnLead ? -1 : 0, both: upBoth ? 1 : dnBoth ? -1 : 0 };
});
for (const y of years) {
  const t = tds.filter((r) => r.year === y), n = t.length;
  log(`  ${y}: lead rule up ${t.filter((r) => r.dir === 1).length} down ${t.filter((r) => r.dir === -1).length} = ${pct(t.filter((r) => r.dir).length / n, 0)} of ${n} | both-sides rule ${pct(t.filter((r) => r.both).length / n, 0)}`);
}
const wds = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
log(`  by weekday (lead rule, up/down/days): ${wds.map((w) => { const t = tds.filter((r) => r.wd === w); return `${w} ${t.filter((r) => r.dir === 1).length}/${t.filter((r) => r.dir === -1).length}/${t.length}`; }).join('  ')}`);
const nextRatio = (dir: 1 | -1) => mean(tds.flatMap((r, i) => (r.dir === dir && days[i + 1] ? [days[i + 1].range / days[i].range] : [])));
log(`  next day's range ÷ trend day's range, mean: after up ${pct(nextRatio(1), 0)}, after down ${pct(nextRatio(-1), 0)}; all days next÷this ${pct(mean(days.slice(1).map((d, i) => d.range / days[i].range)), 0)}`);
out.trendDays = tds;

// 5. Window breakout test (video 3): range from 9:15 to X, first 3-min close beyond it after X, exit at the close
// 7 bars later (21 min; the video says 20). Gross spot points, one trade a day per window.
log('\n5. Window breakout, first 3-min close beyond the 9:15→X range, exit 21 min later (gross spot points)');
const windows = [930, 945, 1000, 1015, 1030, 1400, 1415, 1430, 1445];
const t5: Record<string, unknown>[] = [];
for (const x of windows) {
  const tr: { year: string; wd: string; dir: number; pts: number; late: boolean }[] = [];
  for (const d of days) {
    const before = d.bars.filter((c) => hm(c.time) < x), idx = d.bars.findIndex((c) => hm(c.time) >= x);
    const h = hiOf(before), l = loOf(before);
    for (let i = idx; i >= 0 && i < d.bars.length; i++) {
      const c = d.bars[i];
      if (c.close > h || c.close < l) {
        const dir = c.close > h ? 1 : -1, exit = d.bars[Math.min(d.bars.length - 1, i + 7)];
        tr.push({ year: d.year, wd: d.wd, dir, pts: dir * (exit.close - c.close), late: hm(exit.time) + 3 > 1500 });
        break;
      }
    }
  }
  const sum = (a: typeof tr) => a.reduce((s, t) => s + t.pts, 0);
  const row = { window: x, n: tr.length, avg: mean(tr.map((t) => t.pts)), win: tr.filter((t) => t.pts > 0).length / tr.length, total: sum(tr), up: mean(tr.filter((t) => t.dir === 1).map((t) => t.pts)), down: mean(tr.filter((t) => t.dir === -1).map((t) => t.pts)), pastThree: tr.filter((t) => t.late).length, byYear: Object.fromEntries(years.map((y) => [y, Math.round(sum(tr.filter((t) => t.year === y)))])) };
  t5.push(row);
  log(`  ${String(x).padStart(4, '0')}: n ${row.n}  avg ${f(row.avg, 1)}  win ${pct(row.win, 0)}  total ${f(row.total, 0)}  up ${f(row.up, 1)} down ${f(row.down, 1)}  by year ${years.map((y) => `${y.slice(2)}:${row.byYear[y]}`).join(' ')}${row.pastThree ? `  (${row.pastThree} exits after 15:00)` : ''}`);
}
out.windows = t5;

const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
await mkdir(dir, { recursive: true });
await writeFile(path.join(dir, 'structure.json'), JSON.stringify(out));
await writeFile(path.join(dir, 'structure.txt'), lines.join('\n'));
