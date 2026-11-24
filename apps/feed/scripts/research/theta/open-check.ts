// One recorded weekend (Fri 2026-11-06 → Mon 2026-11-09, expiry Tue 11-10): ATM straddle at minute times vs NSE EOD close/open.
import { OptionStore } from '../../../src/intraday/options';
const st = new OptionStore();
const fri = await st.read('NIFTY', '2026-11-06'), mon = await st.read('NIFTY', '2026-11-09');
const exp = [...new Set(fri.map(r => r.expiry))].sort()[0];
const hm = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(11, 16);
const at = (rows: typeof fri, k: number, r: 'CE'|'PE', time: string) => rows.filter(x => x.expiry === exp && x.strike === k && x.right === r && hm(x.time) <= time).at(-1);
// ATM = strike with smallest |CE−PE| at Friday 15:29
const ks = [...new Set(fri.filter(x => x.expiry === exp).map(x => x.strike))];
const k = ks.map(s => ({ s, d: Math.abs((at(fri, s, 'CE', '15:29')?.close ?? 1e9) - (at(fri, s, 'PE', '15:29')?.close ?? -1e9)) })).sort((a, b) => a.d - b.d)[0].s;
console.log('expiry', exp, 'ATM', k);
for (const [rows, day, times] of [[fri, 'Fri', ['15:00','15:15','15:25','15:29']], [mon, 'Mon', ['09:15','09:16','09:20','09:25','09:30','10:00','11:20','13:25','15:00','15:29']]] as const) for (const t of times) {
  const c = at(rows, k, 'CE', t), p = at(rows, k, 'PE', t);
  if (!c || !p) { console.log(day, t, 'missing'); continue; }
  const first = hm(c.time) === t;
  console.log(day, t, 'straddle close', (c.close + p.close).toFixed(1), ' open-of-minute', (c.open + p.open).toFixed(1), ' mid', ((c.bid + c.ask + p.bid + p.ask) / 2).toFixed(1), ' spread', (c.ask - c.bid + p.ask - p.bid).toFixed(1));
}
