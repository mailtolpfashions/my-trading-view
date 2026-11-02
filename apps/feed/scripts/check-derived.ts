// Parses a downloaded NSE F&O bhavcopy CSV (UDiFF) and prints the derived chain statistics, to cross-check by hand
// against the raw file. Run: npx tsx scripts/check-derived.ts <file.csv> <YYYY-MM-DD> [SYMBOL ...]
import { readFileSync } from 'node:fs';
import { parseUdiffFo } from '../src/fno/bhavcopy';
import { deriveDay } from '../src/fno/derive';

const [file, date, ...symbols] = process.argv.slice(2);
const t0 = Date.now();
const day = parseUdiffFo(readFileSync(file, 'utf8'), date, 'all');
const t1 = Date.now();
const derived = deriveDay(day);
const t2 = Date.now();
console.log(`rows ${day.rows.length}, underlyings ${new Set(day.rows.map((r) => r.underlying)).size} (indices ${[...day.indices].join(' ')}), derived ${derived.length}; parse ${t1 - t0} ms, derive ${t2 - t1} ms`);
const rs = (p: number | null) => (p == null ? '—' : (p / 100).toFixed(2));
for (const u of symbols.length ? symbols : ['NIFTY']) {
  for (const d of derived.filter((x) => x.underlying === u).slice(0, 2)) {
    console.log(`${u} ${d.expiry} (${d.daysToExpiry}d): spot ${rs(d.spotPaise)} fwd ${rs(d.forwardPaise)} step ${rs(d.strikeStepPaise)} ATM ${rs(d.atmStrikePaise)} IV ${d.atmIv?.toFixed(4)} straddle ${rs(d.straddlePaise)}${d.straddleTraded ? '' : ' (untraded)'}`);
    console.log(`   CE OI ${d.ceOi} PE OI ${d.peOi} PCR ${(Number(d.peOi) / Number(d.ceOi)).toFixed(4)} maxPain ${rs(d.maxPainPaise)} GEX ₹${d.gexNet?.toExponential(3)}/1% callWall ${rs(d.callWallPaise)} putWall ${rs(d.putWallPaise)} flip ${rs(d.gammaFlipPaise)} ivFilled ${d.gexIvFilled}`);
  }
}
