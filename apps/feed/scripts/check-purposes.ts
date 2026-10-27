// Lists how each PURPOSE in the given NSE Bc files is interpreted, so unrecognised wording is caught early.
// Run: npx tsx scripts/check-purposes.ts <Bc file> [more files...]
import { readFileSync } from 'node:fs';
import { parseBc, parsePurpose } from '../src/eod/corporate';

const seen = new Map<string, string>();
for (const f of process.argv.slice(2)) {
  for (const row of parseBc(readFileSync(f, 'utf8'))) {
    const parsed = parsePurpose(row.purpose);
    const label = parsed.map((p) => (p.kind === 'adjust' ? `ADJUST ${p.type} ×${p.factor.toFixed(4)}` : p.kind === 'unhandled' ? `UNHANDLED (${p.reason})` : 'ignore')).join(' + ');
    seen.set(row.purpose, label);
  }
}
const order = (l: string) => (l.includes('UNHANDLED') ? 0 : l.includes('ADJUST') ? 1 : 2);
for (const [purpose, label] of [...seen].sort((a, b) => order(a[1]) - order(b[1]))) {
  if (!label.startsWith('ignore') || label.includes('UNHANDLED')) console.log(`${label.padEnd(60)} ← ${purpose}`);
}
console.log(`${seen.size} distinct purposes; ${[...seen.values()].filter((l) => l === 'ignore').length} ignored (dividends, meetings…)`);
