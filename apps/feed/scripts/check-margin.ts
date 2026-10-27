// Compares our SPAN margin with Zerodha Kite's basket margin for a set of NIFTY baskets.
// Owner's personal Kite session only (verification). Run: npx tsx --env-file=../../.env scripts/check-margin.ts [YYYY-MM-DD] [i1..i5|s]
import { positionMargin, type MarginLeg } from '@mtv/options';
import { loadSession, activeSession, kiteApiKey } from '../src/providers/kite/session';
import { fetchSpan } from '../src/fno/span';

const date = process.argv[2] ?? new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const part = process.argv[3] ?? 'i5';
await loadSession();
const s = activeSession();
if (!s) throw new Error('Kite login required');
const auth = { 'X-Kite-Version': '3', Authorization: `token ${kiteApiKey()}:${s.accessToken}` };

const span = (await fetchSpan(date, part))?.NIFTY;
if (!span) throw new Error(`SPAN ${date} ${part} not published`);
console.log(`SPAN ${span.file} created ${span.created} spot ${span.spot}`);

// NFO instruments → tradingsymbol for (expiry, strike, type)
const csv = await (await fetch('https://api.kite.trade/instruments/NFO', { headers: auth })).text();
const lines = csv.trim().split('\n');
const head = lines[0].split(',');
const col = (n: string) => head.indexOf(n);
const sym = new Map<string, { ts: string; lot: number }>();
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (c[col('name')] !== '"NIFTY"' && c[col('name')] !== 'NIFTY') continue;
  const type = c[col('instrument_type')], exp = c[col('expiry')], k = Number(c[col('strike')]);
  sym.set(`${type}|${exp}|${type === 'FUT' ? 0 : k}`, { ts: c[col('tradingsymbol')], lot: Number(c[col('lot_size')]) });
}
const expiries = [...new Set([...sym.keys()].filter((k) => k.startsWith('CE|')).map((k) => k.split('|')[1]))].sort();
const futs = [...new Set([...sym.keys()].filter((k) => k.startsWith('FUT|')).map((k) => k.split('|')[1]))].sort();
const lot = [...sym.values()][0].lot;
const atm = Math.round(span.spot / 50) * 50;
const [e0, e1] = [expiries.find((e) => e >= date)!, expiries.find((e) => e > date)!];
const e2 = expiries.filter((e) => e > e1)[0];
console.log(`lot ${lot} ATM ${atm} expiries ${e0} ${e1} ${e2} fut ${futs[0]}`);

type L = MarginLeg & { side: 'BUY' | 'SELL' };
const leg = (kind: 'CE' | 'PE' | 'FUT', side: 'BUY' | 'SELL', expiry: string, strike: number, lots = 1): L => ({ kind, side, expiry, strike, qty: (side === 'BUY' ? 1 : -1) * lots * lot });
const baskets: [string, L[]][] = [
  ['short ATM CE', [leg('CE', 'SELL', e1, atm)]],
  ['long ATM CE', [leg('CE', 'BUY', e1, atm)]],
  ['short straddle', [leg('CE', 'SELL', e1, atm), leg('PE', 'SELL', e1, atm)]],
  ['iron condor', [leg('PE', 'SELL', e1, atm - 200), leg('PE', 'BUY', e1, atm - 400), leg('CE', 'SELL', e1, atm + 200), leg('CE', 'BUY', e1, atm + 400)]],
  ['bull call spread', [leg('CE', 'BUY', e1, atm), leg('CE', 'SELL', e1, atm + 200)]],
  ['short future', [leg('FUT', 'SELL', futs[0], 0)]],
  ['calendar (sell near, buy next)', [leg('CE', 'SELL', e1, atm), leg('CE', 'BUY', e2, atm)]],
  ['short ATM CE expiring today', [leg('CE', 'SELL', e0, atm)]],
  ['calendar on expiry day (sell today, buy next)', [leg('CE', 'SELL', e0, atm), leg('CE', 'BUY', e1, atm)]],
];
let failures = 0;

for (const [name, legs] of baskets) {
  const orders = legs.map((l) => {
    const m = sym.get(`${l.kind}|${l.expiry}|${l.kind === 'FUT' ? 0 : l.strike}`);
    if (!m) throw new Error(`no Kite symbol for ${l.kind} ${l.expiry} ${l.strike}`);
    return { exchange: 'NFO', tradingsymbol: m.ts, transaction_type: l.side, variety: 'regular', product: 'NRML', order_type: 'MARKET', quantity: Math.abs(l.qty), price: 0 };
  });
  const res = await fetch('https://api.kite.trade/margins/basket?consider_positions=false', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(orders) });
  const body = await res.json() as { data?: { initial: Record<string, number>; final: Record<string, number>; orders: Record<string, number>[] }; message?: string };
  if (!body.data) { console.log(name, 'Kite error', body.message); continue; }
  // Kite prices premiums and exposure at last traded prices: use the same.
  const ids = ['NSE:NIFTY 50', ...orders.map((o) => `NFO:${o.tradingsymbol}`)];
  const qd = (await (await fetch(`https://api.kite.trade/quote/ltp?${ids.map((i) => 'i=' + encodeURIComponent(i)).join('&')}`, { headers: auth })).json()).data as Record<string, { last_price: number }>;
  const priced = legs.map((l, i) => ({ ...l, pricePaise: Math.round(qd[ids[i + 1]].last_price * 100) }));
  const ours = positionMargin(span, priced, Math.round(qd['NSE:NIFTY 50'].last_price * 100), new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10));
  const f = body.data.final;
  const r = (p: number) => (p / 100).toFixed(2);
  const ok = (a: number, b: number) => (Math.abs(a - b) <= 1 ? 'OK' : (failures++, `DIFF ${(a - b).toFixed(2)}`));
  console.log(`\n${name}: ${orders.map((o) => `${o.transaction_type} ${o.tradingsymbol}`).join(', ')}`);
  console.log(`  CHECK span ${r(ours.spanPaise)} vs ${f.span} ${ok(ours.spanPaise / 100, f.span)} | exposure ${r(ours.exposurePaise)} vs ${f.exposure} ${ok(ours.exposurePaise / 100, f.exposure)} | funds ${r(ours.fundsPaise)} vs ${f.total} ${ok(ours.fundsPaise / 100, f.total)} | without hedge ${r(ours.withoutHedgePaise)}, benefit ${r(ours.hedgeBenefitPaise)}`);
  console.log(`  Kite final: span ${f.span} exposure ${f.exposure} option_premium ${f.option_premium} total ${f.total} | initial total ${body.data.initial.total}`);
  console.log(`  ours: scan ${ours.scanRiskPaise / 100} spread ${ours.spreadChargePaise / 100} nov ${ours.netOptionValuePaise / 100} span ${ours.spanPaise / 100}${ours.missing.length ? ' MISSING ' + JSON.stringify(ours.missing) : ''}`);
  console.log(`  per order (Kite): ${body.data.orders.map((o) => `span ${o.span} exp ${o.exposure} prem ${o.option_premium}`).join(' | ')}`);
  await new Promise((r) => setTimeout(r, 400));
}
console.log(failures ? `\n${failures} figure(s) differ from Kite by more than ₹1` : '\nAll figures within ₹1 of Kite');
