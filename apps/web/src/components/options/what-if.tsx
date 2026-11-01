'use client';

import { black76, legValue, scenarioIv, SPOT_VOL_FIT, type IvModel, type ModelLeg, type Scenario } from '@mtv/options';
import { computeOptionCharges, formatRupees, type BrokerProfile } from '@mtv/paper';
import { fmt } from '@/lib/format';
import { fmtDate, fmtStrike, type BuilderLeg } from '@/lib/options';

export type WhatIfState = { spotPaise: number; days: number; model: IvModel; shiftPts: number };

export const IV_MODELS: { id: IvModel; name: string; note: string }[] = [
  { id: 'spotvol', name: 'NSE history (recommended)', note: 'IV moves as NIFTY options did on NSE: up on falls, down on rallies' },
  { id: 'strike', name: 'Same IV per strike', note: 'every strike keeps today\'s IV' },
  { id: 'moneyness', name: 'Skew follows spot', note: 'a strike takes the IV of the strike at the same distance from the new level' },
];

/**
 * Accuracy of each model's next-day premium, measured on NSE closes Nov 2023 – Oct 2026
 * (apps/feed/scripts/research-whatif.ts): median and 90th-percentile absolute error, all days and days NIFTY moved ≥ 1.5%.
 */
const ACCURACY: Record<IvModel, { all: [number, number]; big: [number, number] }> = {
  spotvol: { all: [7.6, 29.5], big: [11.3, 41.8] },
  strike: { all: [7.7, 33.6], big: [10.8, 49.0] },
  moneyness: { all: [8.1, 34.2], big: [14.8, 54.7] },
};

const RATE = 0.065;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

/** "What if NIFTY is at X on date D?" — projected premium of every leg, P&L before and after charges, Greeks. */
export function WhatIf({ state, onChange, legs, modelLegs, spotPaise, carry, maxDays, chainDate, broker, lot }: {
  state: WhatIfState;
  onChange: (s: WhatIfState) => void;
  legs: BuilderLeg[];
  modelLegs: ModelLeg[];
  spotPaise: number;
  carry: number;
  /** Calendar days from the chain's close to the first expiry. */
  maxDays: number;
  chainDate: string;
  broker: BrokerProfile;
  lot: number;
}) {
  const S = state.spotPaise, t = state.days / 365;
  const sc: Scenario = { model: state.model, spot0: spotPaise, shift: state.shiftPts / 100, fit: SPOT_VOL_FIT.buckets };
  const move = S - spotPaise, movePct = (move / spotPaise) * 100;
  const set = (patch: Partial<WhatIfState>) => onChange({ ...state, ...patch });

  const rows = modelLegs.map((l, i) => {
    const value = legValue(l, S, t, RATE, carry, sc);
    const expired = l.years - t <= 1e-9;
    const iv = expired ? null : scenarioIv(l, S, t, carry, sc);
    const sign = l.side === 'BUY' ? 1 : -1;
    const g = !expired && iv != null ? black76(l.kind as 'CE' | 'PE', (S * Math.exp(carry * (l.years - t))) / 100, l.strikePaise / 100, l.years - t, RATE, iv) : null;
    return { leg: legs[i], l, value, expired, iv, pnl: value == null ? null : sign * l.qty * (value - l.pricePaise), g, sign };
  });
  const missing = rows.some((r) => r.value == null);
  const pnl = missing ? null : rows.reduce((s, r) => s + r.pnl!, 0);
  const charges = missing ? null : rows.reduce((s, r) => s
    + computeOptionCharges({ side: r.l.side, qty: r.l.qty, premiumPaise: r.l.pricePaise, broker }).total
    + computeOptionCharges({ side: r.l.side === 'BUY' ? 'SELL' : 'BUY', qty: r.l.qty, premiumPaise: Math.round(r.value!), broker }).total, 0);
  const greeks = rows.reduce((a, r) => (r.g ? { delta: a.delta + r.sign * r.l.qty * r.g.delta, theta: a.theta + r.sign * r.l.qty * r.g.theta, vega: a.vega + r.sign * r.l.qty * r.g.vega } : a), { delta: 0, theta: 0, vega: 0 });
  const acc = ACCURACY[state.model];
  const step = Math.round(spotPaise / 100) >= 30000 ? 100 : 50; // nudge size in points

  return (
    <div className="space-y-2 rounded-[12px] border border-line p-2.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-extrabold tracking-[-0.01em]">What if</h3>
        <span className="text-[11px] text-muted">move NIFTY, the date or IV and see every premium</span>
        <button type="button" onClick={() => onChange({ ...state, spotPaise, days: Math.min(1, maxDays), shiftPts: 0 })} className="ml-auto rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold text-muted hover:bg-raised">Reset</button>
      </div>

      <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1.5 text-[12px] sm:grid-cols-[auto_1fr] sm:gap-y-2">
        <span className="font-semibold">NIFTY at</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <input type="number" aria-label="NIFTY level" className="num h-7 w-24 rounded-md border border-line px-1.5 text-right" value={Math.round(S / 100)}
            onChange={(e) => { const v = Number(e.target.value); if (v > 0) set({ spotPaise: Math.round(v * 100) }); }} />
          <span className={`num w-28 font-semibold ${move > 0 ? 'text-up' : move < 0 ? 'text-down' : 'text-muted'}`}>{move >= 0 ? '+' : '−'}{fmt(Math.abs(move) / 100)} ({movePct >= 0 ? '+' : '−'}{Math.abs(movePct).toFixed(2)}%)</span>
          {[-500, -250, -step, step, 250, 500].map((pts) => (
            <button key={pts} type="button" onClick={() => set({ spotPaise: S + pts * 100 })}
              className={`num rounded-full px-2 py-0.5 text-[11.5px] font-bold ${pts < 0 ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>{pts > 0 ? '+' : '−'}{Math.abs(pts)}</button>
          ))}
          <input type="range" aria-label="NIFTY move" className="w-full min-w-0 flex-1 accent-ink sm:min-w-40" min={-10} max={10} step={0.1} value={Math.max(-10, Math.min(10, movePct))}
            onChange={(e) => set({ spotPaise: Math.round(spotPaise * (1 + Number(e.target.value) / 100)) })} />
        </div>

        <span className="font-semibold">On</span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input type="range" aria-label="Days ahead" className="w-full min-w-0 flex-1 accent-ink sm:min-w-40" min={0} max={Math.max(0, maxDays)} step={1} value={Math.min(state.days, maxDays)}
            onChange={(e) => set({ days: Number(e.target.value) })} />
          <span className="num text-[11.5px] sm:w-44">{state.days === 0 ? `now (close of ${fmtDate(chainDate)})` : `close of ${fmtDate(addDays(chainDate, state.days))} (+${state.days}d)`}</span>
        </div>

        <span className="font-semibold">IV</span>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <select aria-label="IV model" className="h-7 rounded-full bg-raised px-2.5 text-[12px] font-semibold" value={state.model} onChange={(e) => set({ model: e.target.value as IvModel })}>
            {IV_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <span className="text-[11px] text-muted">{IV_MODELS.find((m) => m.id === state.model)!.note}</span>
          <span className="ml-auto inline-flex items-center gap-1">
            <span className="text-[11px] text-muted">shift</span>
            <button type="button" aria-label="IV down 1 point" onClick={() => set({ shiftPts: state.shiftPts - 1 })} className="rounded-md border border-line px-1.5 font-bold">−</button>
            <span className="num w-14 text-center font-semibold">{state.shiftPts > 0 ? '+' : ''}{state.shiftPts} pts</span>
            <button type="button" aria-label="IV up 1 point" onClick={() => set({ shiftPts: state.shiftPts + 1 })} className="rounded-md border border-line px-1.5 font-bold">+</button>
          </span>
        </div>
      </div>

      <table className="num w-full text-[12px]">
        <thead className="text-[10.5px] font-bold tracking-[0.05em] text-muted">
          <tr><th className="py-1 text-left">LEG</th><th className="text-right">NOW</th><th className="text-right">PROJECTED</th><th className="text-right">CHANGE</th><th className="text-right">IV USED</th><th className="text-right">P&amp;L</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.leg.id} className="border-t border-line">
              <td className="py-1 font-sans font-semibold"><span className={r.l.side === 'BUY' ? 'text-blue' : 'text-down'}>{r.l.side === 'BUY' ? 'B' : 'S'}</span> {fmtDate(r.leg.expiry).slice(0, 6)} {fmtStrike(r.l.strikePaise)} {r.l.kind}</td>
              <td className="text-right">{fmt(r.l.pricePaise / 100)}</td>
              <td className="text-right font-semibold">{r.value == null ? '—' : fmt(r.value / 100)}{r.expired && <span className="ml-1 text-[10px] text-muted">expired</span>}</td>
              <td className={`text-right ${r.value != null && r.value >= r.l.pricePaise ? 'text-up' : 'text-down'}`}>{r.value == null ? '—' : `${r.value >= r.l.pricePaise ? '+' : '−'}${fmt(Math.abs(r.value - r.l.pricePaise) / 100)}`}</td>
              <td className="text-right text-muted">{r.iv == null ? (r.expired ? '—' : 'no IV') : `${(r.iv * 100).toFixed(1)}%`}</td>
              <td className={`text-right font-semibold ${r.pnl == null ? '' : r.pnl >= 0 ? 'text-up' : 'text-down'}`}>{r.pnl == null ? '—' : formatRupees(Math.round(r.pnl))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="grid grid-cols-4 gap-1.5">
        {([
          ['P&L at this level', pnl == null ? '—' : formatRupees(Math.round(pnl)), pnl == null ? '' : pnl >= 0 ? 'text-up' : 'text-down'],
          ['After charges', pnl == null || charges == null ? '—' : formatRupees(Math.round(pnl - charges)), pnl == null || charges == null ? '' : pnl - charges >= 0 ? 'text-up' : 'text-down'],
          ['Delta / Theta', `${greeks.delta.toFixed(1)} / ${fmt(greeks.theta)}`, ''],
          ['Vega (₹ per 1% IV)', fmt(greeks.vega), ''],
        ] as const).map(([k, v, c]) => (
          <div key={k} className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">{k}</p><p className={`num text-[13.5px] font-semibold ${c}`}>{v}</p></div>
        ))}
      </div>
      {missing && <p className="text-[11px] text-down">A leg has no IV (it did not trade), so it cannot be projected.</p>}
      <p className="text-[11px] leading-snug text-muted">
        Model estimate: the price formula (Black-76) is exact for a given IV, but the IV after a move is set by the market.
        Tested on NSE closing prices {SPOT_VOL_FIT.from} to {SPOT_VOL_FIT.to}, this model&rsquo;s next-day premium was typically within ±{acc.all[0]}% (1 in 10 off by {acc.all[1]}% or more);
        on days NIFTY moved 1.5% or more, ±{acc.big[0]}% (1 in 10 off by {acc.big[1]}% or more). After charges = entry plus squaring off at the projected prices.
      </p>
    </div>
  );
}
