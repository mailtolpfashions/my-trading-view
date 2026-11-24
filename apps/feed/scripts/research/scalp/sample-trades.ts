// Prints sample trades from setups-trades.json (first and last N of a setup) with every 3-min bar from entry to exit,
// for checking on a chart. Run (apps/feed): npx tsx scripts/research/scalp/sample-trades.ts "<setup name>" [count=2]
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resample } from '@mtv/rules';
import { istHm, supertrend } from '@mtv/indicators';
import { MinuteStore, dateOfIst } from '../../../src/intraday/store';

type T = { setup: string; date: string; dir: number; entryTime: number; exitTime: number; entry: number; exit: number; pts: number; reason: string };
const dir = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
const trades = JSON.parse(await readFile(path.join(dir, 'setups-trades.json'), 'utf8')) as T[];
const name = process.argv[2], n = Number(process.argv[3] ?? 2);
const list = trades.filter((t) => t.setup === name);
if (!list.length) throw new Error(`no trades for "${name}"; setups: ${[...new Set(trades.map((t) => t.setup))].join(' | ')}`);
const pick = [...list.slice(0, n), ...list.slice(-n)];
const mins = await new MinuteStore().read('NIFTY', Date.parse('2023-01-01T00:00:00+05:30') / 1000);
const bars = resample(mins.filter((c) => istHm(c.time) >= 915 && istHm(c.time) < 1530), '3m');
const st = supertrend(bars, 5, 2).direction;
const idx = new Map(bars.map((b, i) => [b.time, i]));
const hhmm = (t: number) => String(istHm(t)).padStart(4, '0');
for (const t of pick) {
  console.log(`\n${t.setup} ${t.date} ${t.dir > 0 ? 'LONG' : 'SHORT'} entry ${hhmm(t.entryTime)} @${t.entry} → exit ${hhmm(t.exitTime)} @${t.exit} (${t.reason}) = ${t.pts.toFixed(1)} pts`);
  const day = bars.filter((b) => dateOfIst(b.time) === t.date);
  const ir = day.filter((b) => istHm(b.time) < 930);
  console.log(`  9:15–9:30 range ${Math.min(...ir.map((b) => b.low))}–${Math.max(...ir.map((b) => b.high))}`);
  for (const b of day.filter((b) => b.time >= t.entryTime && b.time <= t.exitTime)) console.log(`  ${hhmm(b.time)} O ${b.open} H ${b.high} L ${b.low} C ${b.close}  ST ${st[idx.get(b.time)!]}`);
}
