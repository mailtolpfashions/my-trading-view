// Scalping study, step 1: NIFTY 50 spot 1-minute history from Kite, back to 2023-01, into the minute store.
// Writes only days the store does not have yet (never touches the live month), then checks every stored day's
// minute high/low/open against Kite's daily candle and lists mismatches and missing days. Gaps are listed, never filled.
// Light: ~20 historical requests, paced at 400 ms. Owner's Kite session required.
// Run (apps/feed): npx dotenv -e ../../.env -- npx tsx scripts/research/scalp/nifty-backfill.ts [from=2023-01-01] [to=2025-10-31]
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';
import { loadSession, activeSession, authHeader } from '../../../src/providers/kite/session';
import { parseKiteCandles } from '../../../src/providers/kite/provider';
import { MinuteStore, dateOfIst } from '../../../src/intraday/store';

const TOKEN = 256265; // NSE NIFTY 50 index
const SYMBOL = 'NIFTY';
const IST = 5.5 * 3600, DAY = 86400;
const from = process.argv[2] ?? '2023-01-01';
const to = process.argv[3] ?? '2025-10-31';
const toSec = (d: string, hm: string) => Date.parse(`${d}T${hm}:00+05:30`) / 1000;
const kiteDate = (sec: number) => new Date((sec + IST) * 1000).toISOString().slice(0, 19).replace('T', ' ');

await loadSession();
const s = activeSession();
if (!s) throw new Error('Kite login required (log in from the app first)');

let next = 0;
async function get(interval: 'minute' | 'day', a: number, b: number): Promise<Candle[]> {
  const wait = Math.max(0, next - Date.now());
  next = Math.max(Date.now(), next) + 400;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const url = `https://api.kite.trade/instruments/historical/${TOKEN}/${interval}?from=${encodeURIComponent(kiteDate(a))}&to=${encodeURIComponent(kiteDate(b))}`;
  const res = await fetch(url, { headers: authHeader(s!), signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Kite ${res.status}: ${text.slice(0, 200)}`);
  return parseKiteCandles(JSON.parse(text).data.candles, interval === 'day');
}

const store = new MinuteStore();
const start = toSec(from, '09:15'), end = toSec(to, '15:30');

// Daily candles (reference) for the whole span, in chunks of ~2000 days (one request).
const daily = new Map<string, Candle>();
for (const c of await get('day', start, end)) daily.set(dateOfIst(c.time), c);
console.log(`Kite daily candles ${from} → ${to}: ${daily.size} days`);

const have = await store.days(SYMBOL, start);
let fetched = 0, written = 0;
for (let a = start; a < end; a += 60 * DAY) {
  const b = Math.min(end, a + 60 * DAY - 1);
  const bars = await get('minute', a, b);
  fetched += bars.length;
  const byDay = new Map<string, Candle[]>();
  for (const c of bars) { const d = dateOfIst(c.time); if (d > to) continue; byDay.set(d, [...(byDay.get(d) ?? []), c]); }
  const fresh = [...byDay.keys()].filter((d) => !have.has(d));
  if (fresh.length) {
    await store.replaceDays(SYMBOL, fresh, fresh.flatMap((d) => byDay.get(d)!));
    written += fresh.length;
  }
  console.log(`${dateOfIst(a)} → ${dateOfIst(b)}: ${bars.length} minutes, ${byDay.size} days, ${fresh.length} new`);
}

// Check: every daily day has minutes; minute high/low/open agree with the daily candle.
const stored = await store.read(SYMBOL, start);
const days = new Map<string, Candle[]>();
for (const c of stored) { const d = dateOfIst(c.time); if (d <= to) days.set(d, [...(days.get(d) ?? []), c]); }
const missing: string[] = [], short: string[] = [], off: string[] = [];
for (const [d, dc] of daily) {
  const m = days.get(d);
  if (!m) { missing.push(d); continue; }
  if (m.length < 370) short.push(`${d} (${m.length} min)`);
  const hi = Math.max(...m.map((c) => c.high)), lo = Math.min(...m.map((c) => c.low));
  const dh = hi - dc.high, dl = lo - dc.low, dopen = m[0].open - dc.open;
  if (Math.abs(dh) > 1 || Math.abs(dl) > 1 || Math.abs(dopen) > 1) off.push(`${d} high ${dh.toFixed(2)} low ${dl.toFixed(2)} open ${dopen.toFixed(2)}`);
}
const extra = [...days.keys()].filter((d) => !daily.has(d));
const report = { from, to, dailyDays: daily.size, minuteDays: days.size, fetched, written, missing, short, off, extra };
const out = path.resolve(import.meta.dirname, '../../../.data/research/scalp');
await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'nifty-backfill-check.json'), JSON.stringify(report, null, 1));
console.log(`\nDays: daily ${daily.size}, with minutes ${days.size}; new days written ${written}`);
console.log(`Missing minute days: ${missing.length}${missing.length ? ' → ' + missing.slice(0, 20).join(', ') : ''}`);
console.log(`Short days (<370 min): ${short.length}${short.length ? ' → ' + short.slice(0, 20).join(', ') : ''}`);
console.log(`High/low/open off by >1 pt: ${off.length}${off.length ? '\n  ' + off.slice(0, 20).join('\n  ') : ''}`);
console.log(`Minute days not in daily: ${extra.length}${extra.length ? ' → ' + extra.slice(0, 20).join(', ') : ''}`);
