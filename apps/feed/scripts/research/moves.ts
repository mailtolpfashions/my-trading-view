// One-off test behind the option selling report, kept to reproduce it. Heavy: run after market hours.
import { prisma } from '@mtv/db';
const rows = await prisma.indexEod.findMany({ where: { name: 'NIFTY 50' }, select: { date: true, closePaise: true, highPaise: true, lowPaise: true }, orderBy: { date: 'asc' } });
console.log('NIFTY 50 closes', rows[0].date, 'to', rows.at(-1)!.date, rows.length);
const DAY = 86400_000, W = 24;
type P = { d: string; end: number; up: number; down: number; to: string };
const pts: P[] = [];
let j = 0;
for (let i = 0; i < rows.length; i++) {
  const limit = Date.parse(rows[i].date) + W * DAY;
  if (Date.parse(rows.at(-1)!.date) < limit) break;
  let hi = 0, lo = Infinity, k = i + 1, to = rows[i].date;
  for (; k < rows.length && Date.parse(rows[k].date) <= limit; k++) { hi = Math.max(hi, rows[k].highPaise); lo = Math.min(lo, rows[k].lowPaise); to = rows[k].date; }
  if (k === i + 1) continue;
  const base = rows[i].closePaise;
  pts.push({ d: rows[i].date, to, end: (rows[k - 1].closePaise / base - 1) * 100, up: (hi / base - 1) * 100, down: (lo / base - 1) * 100 });
  j++;
}
const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
const f = (v: number) => v.toFixed(1);
const report = (name: string, a: P[]) => {
  const big = a.map((p) => Math.max(p.up, -p.down));
  console.log(`${name}: windows ${a.length} | end-to-end abs: median ${f(q(a.map((p) => Math.abs(p.end)), .5))} 80% ${f(q(a.map((p) => Math.abs(p.end)), .8))} 90% ${f(q(a.map((p) => Math.abs(p.end)), .9))} 99% ${f(q(a.map((p) => Math.abs(p.end)), .99))} | furthest touched: median ${f(q(big, .5))} 80% ${f(q(big, .8))} 90% ${f(q(big, .9))} 99% ${f(q(big, .99))} | max up ${f(Math.max(...a.map((p) => p.up)))} max down ${f(Math.min(...a.map((p) => p.down)))}`);
};
report('All', pts);
report('Since 2015', pts.filter((p) => p.d >= '2015'));
report('Since 2023', pts.filter((p) => p.d >= '2023'));
const top = [...pts].sort((a, b) => a.down - b.down).slice(0, 1)[0], topU = [...pts].sort((a, b) => b.up - a.up)[0];
console.log('worst down', top, 'best up', topU);
for (const y of [...new Set(pts.map((p) => p.d.slice(0, 4)))]) { const a = pts.filter((p) => p.d.startsWith(y)); console.log(y, 'n', a.length, 'median touched', f(q(a.map((p) => Math.max(p.up, -p.down)), .5)), 'max up', f(Math.max(...a.map((p) => p.up))), 'max down', f(Math.min(...a.map((p) => p.down)))); }
const meta = await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY' }, orderBy: { date: 'desc' } });
const E = '2026-12-29', c = await prisma.fnoEod.findMany({ where: { underlying: 'NIFTY', date: meta!.date, expiry: E, kind: { in: ['CE', 'PE'] }, traded: true }, select: { kind: true, strikePaise: true, closePaise: true } });
const s = meta!.spotPaise! / 100;
for (const k of [23800, 24000, 24100, 24200]) { const a = c.find((x) => x.kind === 'CE' && x.strikePaise === k * 100), b = c.find((x) => x.kind === 'PE' && x.strikePaise === k * 100); if (a && b) console.log(k, 'CE', a.closePaise / 100, 'PE', b.closePaise / 100, 'sum', (a.closePaise + b.closePaise) / 100); }
console.log('spot', s, 'calls', c.filter((x) => x.kind === 'CE' && x.strikePaise >= 24800_00 && x.strikePaise <= 28000_00 && x.strikePaise % 500_00 === 0).map((x) => `${x.strikePaise / 100}:${x.closePaise / 100}`).join(' '));
console.log('puts', c.filter((x) => x.kind === 'PE' && x.strikePaise >= 19000_00 && x.strikePaise <= 23000_00 && x.strikePaise % 500_00 === 0).map((x) => `${x.strikePaise / 100}:${x.closePaise / 100}`).join(' '));
await prisma.$disconnect(); process.exit(0);
