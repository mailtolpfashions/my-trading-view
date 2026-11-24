// Weekend theta test (user idea, 2026-11-24, from "The Long and the Short" theta episode): sell NIFTY weekly options at
// Friday's close and hold over the weekend. Under Tuesday expiry the weekend sits just before 1 DTE.
//
// For every normal weekend (Friday traded, next trading day the Monday) on the nearest weekly expiry after Monday:
//   entry  Friday close (NSE close)  — the video's time
//   exits  A Monday open (the video's "weekend only")   B Monday close   C expiry (only when it is Mon or Tue)
//          D Monday close → expiry (the earlier lead, for comparison, same weeks)
//   shapes ATM straddle, 0.30Δ and 0.16Δ strangles; each also with 0.05Δ wings bought (caps a gap).
// Grouped by where the weekend falls: trading days left on Monday morning (0 = Monday expiry, 1 = Tuesday expiry …).
// Underlyings: NIFTY (Thu era = weekend before 3 DTE; Tue era from Sep 2025 = before 1 DTE), FINNIFTY weeklies
// (Tuesday expiry 2021–2024 = same setup as NIFTY now, independent sample), BANKNIFTY and MIDCPNIFTY for the gradient.
// Money: every trade rescaled to today's NIFTY notional (index × lot) so all underlyings and years weigh the same.
// Costs: Zerodha charges (dated), slippage ₹1/option/fill NIFTY, ₹2 others; +₹1 shown.
// NIFTY Tuesday era lies in the spent holdout: one look, fixed settings, nothing tuned on it.
// Run (apps/feed): npx dotenv -e ../../.env -v NODE_OPTIONS=--max-old-space-size=4096 -- npx tsx scripts/research/theta/weekend.ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { prisma } from '@mtv/db';
import type { LabQuote } from '@mtv/backtest';
import { computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { deltaOf, parityForward, yearsBetween, ivOf, gapPnl, GAP_SHOCKS, type ShockLeg } from '@mtv/options';
import { labData } from '../../../src/options-lab/data';

type U = 'NIFTY' | 'FINNIFTY' | 'BANKNIFTY' | 'MIDCPNIFTY';
const UNDER: { u: U; slip: number; index: string }[] = [
  { u: 'NIFTY', slip: 1, index: 'NIFTY 50' },
  { u: 'FINNIFTY', slip: 2, index: 'NIFTY FINANCIAL SERVICES' },
  { u: 'BANKNIFTY', slip: 2, index: 'NIFTY BANK' },
  { u: 'MIDCPNIFTY', slip: 2, index: 'NIFTY MIDCAP SELECT' },
];
type Leg = { kind: 'CE' | 'PE'; side: 'SELL' | 'BUY'; strike: number; px: number };
type Shape = 'straddle' | 's30' | 's16' | 'straddle+w' | 's30+w' | 's16+w';
const SHAPES: Shape[] = ['straddle', 's30', 's16', 'straddle+w', 's30+w', 's16+w'];
type Exit = 'monOpen' | 'monClose' | 'expiry' | 'monToExp';

type Trade = {
  u: U; fri: string; mon: string; expiry: string; dteMon: number; era: string; shape: Shape; spot: number; scale: number;
  credit: number; // ₹ today-scale, net premium received at Friday close
  gapPct: number | null; // index Monday open vs Friday close
  pnl: Partial<Record<Exit, number>>; pnlSlip1: Partial<Record<Exit, number>>;
  worstMtm: number | null; // worst of Monday open / close marks, for the hold-to-expiry exit
  decayPct?: number; // straddle only: premium change Fri close → Mon open, % of Friday premium (video check)
  stress: Record<string, number>;
};

const NIFTY_TODAY = await (async () => { const d = await labData('NIFTY'); const t = d.days.at(-1)!; return { notional: t.spotPaise! * t.lotSize!, spot: t.spotPaise! / 100, lot: t.lotSize! }; })();
const dayGap = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

function eraOf(u: U, expiry: string): string {
  const w = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd(expiry)];
  if (u === 'NIFTY' && expiry >= '2024-11-20' && expiry < '2025-09-01') return `${w} (post-SEBI, left out)`;
  return w;
}

async function run(u: U, slip: number, indexName: string): Promise<Trade[]> {
  const data = await labData(u as 'NIFTY');
  const days = data.days.filter((d) => d.spotPaise && d.lotSize);
  const idx = new Map((await prisma.indexEod.findMany({ where: { name: indexName }, select: { date: true, openPaise: true, closePaise: true } })).map((r) => [r.date, r]));
  const out: Trade[] = [];
  for (let i = 0; i + 1 < days.length; i++) {
    const f = days[i], m = days[i + 1];
    if (wd(f.date) !== 5 || dayGap(f.date, m.date) !== 3) continue; // normal weekend only
    const e = data.expiries.find((x) => x >= m.date);
    if (!e || dayGap(m.date, e) > 6) continue;
    // weekly only: skip if the nearest expiry is a monthly in an era without weeklies (gap to previous expiry > 8 days)
    const prev = data.expiries.filter((x) => x < e).at(-1);
    if (!prev || dayGap(prev, e) > 8) continue;
    const dteMon = days.filter((d) => d.date >= m.date && d.date < e).length; // trading days left on Monday morning before expiry day
    const fullWeek = days.filter((d) => d.date > prev && d.date <= e).length;
    const normal = fullWeek === 5; // five trading days in the cycle, as the video keeps
    if (!normal) continue;
    const chains = await data.chains(e, f.date, e);
    const cf = chains.get(f.date), cm = chains.get(m.date), ce = chains.get(e);
    if (!cf || !cm) continue;
    const spot = f.spotPaise!, lot = f.lotSize!;
    const scale = NIFTY_TODAY.notional / (spot * lot);
    const T = yearsBetween(f.date, e) || 1 / 365;
    const q = (x: LabQuote) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded });
    const F = parityForward(cf.filter((x) => x.kind === 'CE').map(q), cf.filter((x) => x.kind === 'PE').map(q), spot, T) ?? spot;
    const traded = (k: 'CE' | 'PE') => cf.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
    const byDelta = (k: 'CE' | 'PE', d: number) => {
      let best: LabQuote | null = null, gap = Infinity;
      for (const x of traded(k)) {
        if ((k === 'CE' ? 1 : -1) * (x.strikePaise - F) <= 0) continue;
        const v = deltaOf(k, x.closePaise, F, x.strikePaise, T);
        if (v == null) continue;
        const g = Math.abs(Math.abs(v) - d);
        if (g < gap) { gap = g; best = x; }
      }
      return best && gap < 0.06 ? best : null;
    };
    const puts = new Set(traded('PE').map((x) => x.strikePaise));
    const atm = traded('CE').filter((x) => puts.has(x.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - F) - Math.abs(b.strikePaise - F))[0];
    const atmP = atm && traded('PE').find((x) => x.strikePaise === atm.strikePaise);
    const wing = { CE: byDelta('CE', 0.05), PE: byDelta('PE', 0.05) };
    const bodies: Record<'straddle' | 's30' | 's16', [LabQuote | null | undefined, LabQuote | null | undefined]> = {
      straddle: [atm, atmP], s30: [byDelta('CE', 0.3), byDelta('PE', 0.3)], s16: [byDelta('CE', 0.16), byDelta('PE', 0.16)],
    };
    const ix = idx.get(f.date), im = idx.get(m.date);
    const gapPct = ix && im ? ((im.openPaise - ix.closePaise) / ix.closePaise) * 100 : null;
    const spotE = days.find((d) => d.date === e)?.spotPaise ?? null;
    for (const shape of SHAPES) {
      const base = shape.replace('+w', '') as 'straddle' | 's30' | 's16';
      const [c, p] = bodies[base];
      if (!c || !p) continue;
      const legs: Leg[] = [{ kind: 'CE', side: 'SELL', strike: c.strikePaise, px: c.closePaise }, { kind: 'PE', side: 'SELL', strike: p.strikePaise, px: p.closePaise }];
      if (shape.endsWith('+w')) {
        if (!wing.CE || !wing.PE || wing.CE.strikePaise <= c.strikePaise || wing.PE.strikePaise >= p.strikePaise) continue;
        legs.push({ kind: 'CE', side: 'BUY', strike: wing.CE.strikePaise, px: wing.CE.closePaise }, { kind: 'PE', side: 'BUY', strike: wing.PE.strikePaise, px: wing.PE.closePaise });
      }
      const find = (rows: LabQuote[] | undefined, l: Leg) => rows?.find((x) => x.kind === l.kind && x.strikePaise === l.strike);
      const sgn = (l: Leg) => (l.side === 'SELL' ? 1 : -1);
      const charge = (l: Leg, opening: boolean, px: number, date: string) => computeOptionCharges({ side: (l.side === 'SELL') === opening ? 'SELL' : 'BUY', qty: lot, premiumPaise: px, date }).total;
      // P&L in paise for one lot, entering at Friday close, leaving with price function `at` (null = can't price)
      const pnlFor = (s: number, at: (l: Leg) => { px: number; settle: boolean } | null, date: string): number | null => {
        let cash = 0, ch = 0;
        for (const l of legs) {
          const inPx = l.side === 'SELL' ? Math.max(5, l.px - s) : l.px + s;
          cash += sgn(l) * inPx * lot; ch += charge(l, true, inPx, f.date);
          const x = at(l);
          if (!x) return null;
          if (x.settle) { cash -= sgn(l) * x.px * lot; ch += expirySettlementCharges({ side: l.side === 'SELL' ? 'BUY' : 'SELL', qty: lot, intrinsicPaise: x.px, date }); }
          else { const outPx = l.side === 'SELL' ? x.px + s : Math.max(5, x.px - s); cash -= sgn(l) * outPx * lot; ch += charge(l, false, outPx, date); }
        }
        return cash - ch;
      };
      const openAt = (l: Leg) => { const r = find(cm, l); return r && r.traded && r.openPaise > 0 ? { px: r.openPaise, settle: false } : null; };
      const closeAt = (l: Leg) => {
        if (m.date === e && spotE) return { px: Math.max(0, l.kind === 'CE' ? spotE - l.strike : l.strike - spotE), settle: true };
        const r = find(cm, l); return r && r.traded && r.closePaise > 0 ? { px: r.closePaise, settle: false } : null;
      };
      const expAt = (l: Leg) => (spotE ? { px: Math.max(0, l.kind === 'CE' ? spotE - l.strike : l.strike - spotE), settle: true } : null);
      const money = (p: number | null) => (p == null ? undefined : Math.round((p * scale) / 100));
      const pnl: Trade['pnl'] = {}, pnl1: Trade['pnlSlip1'] = {};
      for (const [k, at, date] of [['monOpen', openAt, m.date], ['monClose', closeAt, m.date], ...(dteMon <= 1 ? [['expiry', expAt, e]] : [])] as [Exit, typeof openAt, string][]) {
        pnl[k] = money(pnlFor(slip, at, date)); pnl1[k] = money(pnlFor(slip + 1, at, date));
      }
      // D: the earlier lead on the same week — sell the same shape fresh at Monday close, settle at expiry (only 1 DTE)
      if (dteMon === 1 && m.date !== e && cm && spotE) {
        // rebuild the shape at Monday's close with the same rules
        const Tm = yearsBetween(m.date, e) || 1 / 365;
        const Fm = parityForward(cm.filter((x) => x.kind === 'CE').map(q), cm.filter((x) => x.kind === 'PE').map(q), m.spotPaise!, Tm) ?? m.spotPaise!;
        const tm = (k: 'CE' | 'PE') => cm.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
        const dm = (k: 'CE' | 'PE', d: number) => { let best: LabQuote | null = null, g0 = Infinity; for (const x of tm(k)) { if ((k === 'CE' ? 1 : -1) * (x.strikePaise - Fm) <= 0) continue; const v = deltaOf(k, x.closePaise, Fm, x.strikePaise, Tm); if (v == null) continue; const g = Math.abs(Math.abs(v) - d); if (g < g0) { g0 = g; best = x; } } return best && g0 < 0.06 ? best : null; };
        const pm = new Set(tm('PE').map((x) => x.strikePaise));
        const a2 = tm('CE').filter((x) => pm.has(x.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - Fm) - Math.abs(b.strikePaise - Fm))[0];
        const pick: Record<string, [LabQuote | null | undefined, LabQuote | null | undefined]> = { straddle: [a2, a2 && tm('PE').find((x) => x.strikePaise === a2.strikePaise)], s30: [dm('CE', 0.3), dm('PE', 0.3)], s16: [dm('CE', 0.16), dm('PE', 0.16)] };
        const [c2, p2] = pick[base];
        const w2 = shape.endsWith('+w') ? [dm('CE', 0.05), dm('PE', 0.05)] : [];
        if (c2 && p2 && (!shape.endsWith('+w') || (w2[0] && w2[1]))) {
          const legs2: Leg[] = [{ kind: 'CE', side: 'SELL', strike: c2.strikePaise, px: c2.closePaise }, { kind: 'PE', side: 'SELL', strike: p2.strikePaise, px: p2.closePaise }];
          if (w2[0] && w2[1]) legs2.push({ kind: 'CE', side: 'BUY', strike: w2[0].strikePaise, px: w2[0].closePaise }, { kind: 'PE', side: 'BUY', strike: w2[1].strikePaise, px: w2[1].closePaise });
          const lotM = m.lotSize!, scaleM = NIFTY_TODAY.notional / (m.spotPaise! * lotM);
          const calc = (s: number) => { let cash = 0, ch = 0; for (const l of legs2) { const inPx = l.side === 'SELL' ? Math.max(5, l.px - s) : l.px + s; cash += sgn(l) * inPx * lotM; ch += computeOptionCharges({ side: l.side, qty: lotM, premiumPaise: inPx, date: m.date }).total; const iv = Math.max(0, l.kind === 'CE' ? spotE - l.strike : l.strike - spotE); cash -= sgn(l) * iv * lotM; ch += expirySettlementCharges({ side: l.side === 'SELL' ? 'BUY' : 'SELL', qty: lotM, intrinsicPaise: iv, date: e }); } return Math.round(((cash - ch) * scaleM) / 100); };
          pnl.monToExp = calc(slip); pnl1.monToExp = calc(slip + 1);
        }
      }
      const marks = [pnl.monOpen, pnl.monClose].filter((x): x is number => x != null);
      const credit = Math.round((legs.reduce((a, l) => a + sgn(l) * l.px, 0) * lot * scale) / 100);
      // model gap at Friday close (instant, at today's size)
      const shock: ShockLeg[] = [];
      for (const l of legs) { const iv = ivOf(l.kind, l.px, F, l.strike, T); if (iv == null) { shock.length = 0; break; } shock.push({ kind: l.kind, side: l.side, qty: lot, strikePaise: l.strike, pricePaise: l.px, iv, T, forwardPaise: F }); }
      const stress = Object.fromEntries(shock.length ? GAP_SHOCKS.filter((g) => Math.abs(g.gapPct) <= 8).map((g) => [String(g.gapPct), Math.round((gapPnl(shock, g) * scale) / 100)]) : []);
      const t: Trade = { u, fri: f.date, mon: m.date, expiry: e, dteMon, era: eraOf(u, e), shape, spot: spot / 100, scale, credit, gapPct, pnl, pnlSlip1: pnl1, worstMtm: marks.length ? Math.min(0, ...marks) : null, stress };
      if (shape === 'straddle') {
        const o = legs.map((l) => openAt(l)?.px);
        if (o.every((x) => x != null)) t.decayPct = ((o[0]! + o[1]! - (legs[0].px + legs[1].px)) / (legs[0].px + legs[1].px)) * 100;
      }
      out.push(t);
    }
  }
  return out;
}

const all: Trade[] = [];
for (const x of UNDER) { const t0 = Date.now(); const r = await run(x.u, x.slip, x.index); all.push(...r); console.log(`${x.u}: ${r.length} trade rows in ${((Date.now() - t0) / 1000).toFixed(0)} s`); }
mkdirSync('.data/research/theta', { recursive: true });
writeFileSync('.data/research/theta/weekend.json', JSON.stringify({ built: new Date().toISOString(), niftyToday: NIFTY_TODAY, trades: all }));

// ---- report
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const groups = new Map<string, Trade[]>();
for (const t of all) { const k = `${t.u}|${t.era}|${t.dteMon}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(t); }
console.log(`\nNIFTY today ${NIFTY_TODAY.spot} × lot ${NIFTY_TODAY.lot}. ₹ per weekend, 1 lot at today's NIFTY size, after charges.`);
console.log('\n== Video check: ATM straddle premium change Friday close → Monday open (median %, weeks)');
for (const [k, ts] of groups) { const d = ts.filter((t) => t.shape === 'straddle' && t.decayPct != null).map((t) => t.decayPct!); if (d.length) console.log(`  ${k.padEnd(36)} ${med(d).toFixed(1)}%  (${d.length} weekends, ${ts[0].fri.slice(0, 7)} → ${ts.at(-1)!.fri.slice(0, 7)})`); }
for (const exit of ['monOpen', 'monClose', 'expiry', 'monToExp'] as Exit[]) {
  console.log(`\n== Exit ${exit}: per weekend avg ₹ (slip+₹1) | won% | worst | years + | by year (₹k)`);
  for (const [k, ts0] of groups) for (const shape of SHAPES) {
    const ts = ts0.filter((t) => t.shape === shape && t.pnl[exit] != null);
    if (ts.length < 8) continue;
    const v = ts.map((t) => t.pnl[exit]!), v1 = ts.map((t) => t.pnlSlip1[exit] ?? 0);
    const by = new Map<string, number>(); for (const t of ts) by.set(t.fri.slice(0, 4), (by.get(t.fri.slice(0, 4)) ?? 0) + t.pnl[exit]!);
    const avg = v.reduce((a, b) => a + b, 0) / v.length, avg1 = v1.reduce((a, b) => a + b, 0) / v1.length;
    console.log(`  ${(k + ' ' + shape).padEnd(44)} ${String(Math.round(avg)).padStart(6)} (${String(Math.round(avg1)).padStart(6)}) | ${ts.length} wk ${Math.round((100 * v.filter((x) => x > 0).length) / v.length)}% | ${Math.min(...v)} | ${[...by.values()].filter((x) => x > 0).length}/${by.size} | ${[...by].map(([y, s]) => `${y.slice(2)}:${(s / 1000).toFixed(0)}`).join(' ')}`);
  }
}
await prisma.$disconnect();
