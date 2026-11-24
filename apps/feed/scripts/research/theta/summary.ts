import { readFileSync } from 'node:fs';
const { trades } = JSON.parse(readFileSync('.data/research/theta/weekend.json', 'utf8'));
const CAP = 500_000;
const span = (ts: any[]) => (Date.parse(ts.at(-1).expiry) - Date.parse(ts[0].fri)) / (365.25 * 864e5);
for (const [u, era] of [['NIFTY', 'Tue'], ['FINNIFTY', 'Tue']]) for (const exit of ['monOpen', 'expiry', 'monToExp']) for (const shape of ['straddle', 's30', 's16', 's30+w', 's16+w']) {
  const ts = trades.filter((t: any) => t.u === u && t.era === era && t.shape === shape && t.pnl[exit] != null).sort((a: any, b: any) => a.fri.localeCompare(b.fri));
  let eq = 0, peak = 0, dd = 0; for (const t of ts) { eq += t.pnl[exit]; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const yr = eq / span(ts);
  const g5 = ts.map((t: any) => t.stress['-5']).filter((x: any) => x != null); const g5w = Math.min(...g5);
  const worst = Math.min(...ts.map((t: any) => t.pnl[exit]));
  const w = ts.find((t: any) => t.pnl[exit] === worst);
  console.log(`${u} ${exit.padEnd(8)} ${shape.padEnd(8)} ${ts.length}wk  ₹${Math.round(yr)}/yr = ${(100 * yr / CAP).toFixed(1)}% on 5L | max DD ₹${dd} (${(100 * dd / CAP).toFixed(1)}%) | worst wk ₹${worst} (${w.fri}) | model −5% gap worst ₹${g5w}`);
}
