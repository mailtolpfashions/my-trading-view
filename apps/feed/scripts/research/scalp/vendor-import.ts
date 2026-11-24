// Imports a vendor's 1-minute NIFTY option files into the app's minute stores, kept apart from the live recordings:
//   options → apps/feed/.data/vendor/opt1m/NIFTY/YYYY-MM-DD.bin (OptionStore format; bid/ask 0 = not supplied)
//   spot    → apps/feed/.data/vendor/1m/NIFTY/YYYY-MM.bin       (MinuteStore format; volume 0)
// Input layout (Cloud Trader Pro): one folder per expiry YYYYMMDD with <strike><CE|PE>_<expiry>.csv
// (timestamp,open,high,low,close,volume,oi,strike,option_type; IST) and nifty_spot.csv.
// The vendor stores are rebuilt from scratch on every run (no duplicates). Check first: vendor-check.ts.
// Read back: new OptionStore(VENDOR_OPT).read('NIFTY', date) / new MinuteStore(VENDOR_1M).read('NIFTY', from).
// Run (apps/feed): npx tsx scripts/research/scalp/vendor-import.ts <folder> "<source note>"
import { readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Candle } from '@mtv/shared';
import { OptionStore, type OptionMinute } from '../../../src/intraday/options';
import { MinuteStore, dateOfIst } from '../../../src/intraday/store';

const root = process.argv[2], source = process.argv[3] ?? 'vendor';
if (!root) throw new Error('usage: vendor-import.ts <folder> "<source note>"');
const VENDOR = path.resolve(import.meta.dirname, '../../../.data/vendor');
export const VENDOR_OPT = path.join(VENDOR, 'opt1m'), VENDOR_1M = path.join(VENDOR, '1m');
await rm(path.join(VENDOR_OPT, 'NIFTY'), { recursive: true, force: true });
await rm(path.join(VENDOR_1M, 'NIFTY'), { recursive: true, force: true });
const opt = new OptionStore(VENDOR_OPT), spotStore = new MinuteStore(VENDOR_1M);

const toSec = (ts: string) => Date.parse(`${ts.replace(' ', 'T')}+05:30`) / 1000;
let optRows = 0, spotRows = 0, badRows = 0, files = 0;
const expiries: string[] = [], dates = new Set<string>();
for (const folder of (await readdir(root)).filter((f) => /^\d{8}$/.test(f)).sort()) {
  const expiry = `${folder.slice(0, 4)}-${folder.slice(4, 6)}-${folder.slice(6, 8)}`;
  expiries.push(expiry);
  for (const f of await readdir(path.join(root, folder))) {
    const text = await readFile(path.join(root, folder, f), 'utf8');
    const lines = text.trim().split('\n').slice(1);
    files++;
    if (f === 'nifty_spot.csv') {
      const bars: Candle[] = [];
      for (const l of lines) {
        const [ts, o, h, lo, c] = l.split(',');
        const time = toSec(ts), v = [+o, +h, +lo, +c];
        if (!Number.isFinite(time) || v.some((x) => !(x > 0))) { badRows++; continue; }
        bars.push({ time, open: v[0], high: v[1], low: v[2], close: v[3], volume: 0 });
      }
      const days = [...new Set(bars.map((b) => dateOfIst(b.time)))];
      await spotStore.replaceDays('NIFTY', days, bars); // replaceDays: a day seen in two folders keeps one copy
      spotRows += bars.length;
      continue;
    }
    const m = /^(\d+)(CE|PE)_/.exec(f);
    if (!m) continue;
    const byDate = new Map<string, OptionMinute[]>();
    for (const l of lines) {
      const [ts, o, h, lo, c, vol, oi] = l.split(',');
      const time = toSec(ts), v = [+o, +h, +lo, +c];
      if (!Number.isFinite(time) || v.some((x) => !(x >= 0)) || v[1] < v[2]) { badRows++; continue; }
      const d = dateOfIst(time);
      dates.add(d);
      (byDate.get(d) ?? byDate.set(d, []).get(d)!).push({ time, expiry, strike: Number(m[1]), right: m[2] as 'CE' | 'PE', open: v[0], high: v[1], low: v[2], close: v[3], volume: Math.round(+vol || 0), oi: Math.round(+oi || 0), bid: 0, ask: 0 });
    }
    for (const rows of byDate.values()) { await opt.append('NIFTY', rows); optRows += rows.length; }
  }
}
const manifest = {
  source, importedAt: new Date().toISOString(), from: root, expiries, optionDays: dates.size, files, optRows, spotRows, badRows,
  licence: 'Provider: "strictly for educational and backtesting purposes", as-is, no warranty.',
  notes: 'bid/ask not supplied (0). Checked vs NSE daily (vendor-check.ts): high/low match 98.4%, open 96.7%, last price vs NSE close median ₹1.45 (no bias).',
};
await mkdir(VENDOR, { recursive: true });
await writeFile(path.join(VENDOR, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(manifest);

// read-back check
const d0 = [...dates].sort()[0], back = await opt.read('NIFTY', d0);
console.log(`read back ${d0}: ${back.length} option minutes, e.g.`, back[0]);
const sp = await spotStore.read('NIFTY', 0);
console.log(`spot minutes stored: ${sp.length} (${dateOfIst(sp[0].time)} → ${dateOfIst(sp[sp.length - 1].time)})`);
