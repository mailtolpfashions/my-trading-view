'use client';

// The weekly premium paper trade: the one rule the research programme kept (docs/quant). On, off, its settings, every
// week's entry with the fill against NSE's close (the slippage the backtests assumed at ₹1), and its log.

import { useCallback, useEffect, useState } from 'react';
import { useShell } from '@/components/app/shell-context';
import { inr, premiumApi, signedInr, type PremiumReport, type PremiumRule } from '@/lib/tradelab';
import { InfoTip } from '../info-tip';
import { Button, Card, inputCls } from '../ui';

const WD = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const clock = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const SEL = `${inputCls} h-8 w-[88px] text-[13px]`;

export function sentence(r: PremiumRule) {
  return `Every ${WD[r.weekday] ?? 'Monday'} at ${r.time}${r.iv === 'high' ? ', if NIFTY’s ATM IV is above its one-year median' : ''}: sell ${r.lots} lot${r.lots > 1 ? 's' : ''} each of the call and put nearest ${r.delta} delta on the next weekly expiry (never today’s), overnight, held to expiry settlement.`;
}

export function PremiumPanel() {
  const { notify } = useShell();
  const [data, setData] = useState<PremiumReport | null>(null);
  const [draft, setDraft] = useState<Partial<PremiumRule> | null>(null);
  const load = useCallback(() => { premiumApi.report().then(setData, () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const save = (p: Partial<PremiumRule>, msg: string) => premiumApi.save(p).then(() => { notify(msg); setDraft(null); load(); }, (e: Error) => notify(e.message));
  if (!data) return null;
  const r = data.rule, s = data.slippage, t = data.totals;
  const perOption = (p: number | null) => (p == null ? '—' : `${p > 0 ? '+' : ''}₹${(p / 100).toFixed(2)}`);

  return (
    <Card title={<span className="flex items-center gap-1.5">Weekly premium paper trade <InfoTip label="About this paper trade">
      <p>This is the one rule the research programme kept (docs/quant/02-results). It sells a 0.16-delta NIFTY strangle at Monday&rsquo;s close in high-IV weeks and holds it to expiry. In 2016 to 2026 that window earned premium in most years on both indices; the June 2024 election gap shows its one-night risk.</p>
      <p>The backtests assumed each option fills ₹1 worse than NSE&rsquo;s close. This paper trade measures that number: each leg&rsquo;s fill is set against the official close of the same day. Nothing here is real money, and paper fills are kinder than real ones (no queue).</p>
      <p>A &ldquo;high IV&rdquo; week uses the last end-of-day ATM IV reading against the median of the year before it, the same test as the studies.</p>
    </InfoTip></span>} actions={
      <button type="button" role="switch" aria-checked={r.enabled} onClick={() => void save({ enabled: !r.enabled }, r.enabled ? 'Weekly premium rule switched off' : 'Weekly premium rule switched on')} title={r.enabled ? 'Switch off' : 'Switch on'}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-up' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    }>
      <p className="text-[12.5px] text-ink-2">{sentence(r)} <span className={`font-semibold ${r.enabled ? 'text-up' : 'text-muted'}`}>{r.enabled ? 'On' : 'Off'}</span></p>

      <div className="mt-2 flex flex-wrap items-end gap-2 text-[12.5px]">
        {draft ? (
          <>
            <label className="grid gap-0.5">Day<select className={SEL} value={draft.weekday ?? r.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{WD[d]}</option>)}</select></label>
            <label className="grid gap-0.5">Time<input className={SEL} value={draft.time ?? r.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} /></label>
            <label className="grid gap-0.5">Delta<input className={SEL} type="number" step="0.01" value={draft.delta ?? r.delta} onChange={(e) => setDraft({ ...draft, delta: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Lots<input className={SEL} type="number" value={draft.lots ?? r.lots} onChange={(e) => setDraft({ ...draft, lots: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Weeks<select className={SEL} value={draft.iv ?? r.iv} onChange={(e) => setDraft({ ...draft, iv: e.target.value as 'high' | 'any' })}><option value="high">High IV only</option><option value="any">Every week</option></select></label>
            <Button variant="primary" className="h-8" onClick={() => void save(draft, 'Weekly premium rule saved')}>Save</Button>
            <Button className="h-8" onClick={() => setDraft(null)}>Cancel</Button>
          </>
        ) : <Button className="h-8" onClick={() => setDraft({})}>Change settings</Button>}
      </div>

      <p className="num mt-3 flex flex-wrap gap-x-4 text-[12.5px] text-muted">
        <span>Weeks {t.weeks} (traded {t.traded}, skipped for IV {t.skippedIv})</span>
        <span>Fill vs close, per option: avg <b className="text-ink">{perOption(s.avgPaise)}</b>, median {perOption(s.medianPaise)}, worst {perOption(s.worstPaise)} ({s.legs} legs; the backtest assumed +₹1.00)</span>
        <span>Settled net after charges <b className={tone(t.realisedPaise)}>{signedInr(t.realisedPaise)}</b></span>
      </p>

      {data.entries.length > 0 && (
        <div className="mt-2 max-h-[300px] overflow-auto">
          <table className="num w-full text-[12.5px]">
            <thead><tr className="text-left text-muted"><th>Week</th><th>Expiry</th><th>IV</th><th>Leg</th><th className="text-right">Delta</th><th className="text-right">Bid / ask</th><th className="text-right">Fill</th><th className="text-right">NSE close</th><th className="text-right">Fill vs close</th><th className="text-right">Settled</th><th className="text-right">Net</th></tr></thead>
            <tbody>
              {data.entries.flatMap((e) => e.legs.map((l, i) => (
                <tr key={`${e.date}-${l.symbol}`} className="border-t border-line">
                  <td>{i === 0 ? e.date : ''}</td><td>{i === 0 ? e.expiry : ''}</td><td>{i === 0 ? (e.ivHigh == null ? '—' : e.ivHigh ? 'High' : 'Normal') : ''}</td>
                  <td>{l.label ?? l.symbol}</td><td className="text-right">{l.delta}</td><td className="text-right">{inr(l.bidPaise)} / {inr(l.askPaise)}</td>
                  <td className="text-right">{inr(l.fillPaise)}</td><td className="text-right">{inr(l.closePaise)}</td>
                  <td className={`text-right ${l.slipPaise == null ? '' : l.slipPaise > 100 ? 'text-down' : 'text-up'}`}>{perOption(l.slipPaise)}</td>
                  <td className="text-right">{inr(l.settlePaise)}</td>
                  <td className={`text-right ${i === 0 && e.netPaise != null ? tone(e.netPaise) : ''}`}>{i === 0 ? (e.netPaise == null ? (e.done ? '—' : 'open') : signedInr(e.netPaise)) : ''}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}

      {data.events.length > 0 && (
        <ul className="mt-2 grid max-h-[160px] gap-1 overflow-y-auto border-t border-line pt-2 text-[12.5px]">
          {data.events.slice(0, 40).map((e, k) => (
            <li key={`${e.at}-${k}`} className="flex gap-2">
              <span className="num shrink-0 text-muted">{clock(e.at)}</span>
              <span className={`shrink-0 font-semibold ${e.action === 'placed' ? 'text-up' : e.action === 'error' ? 'text-down' : e.action === 'skipped' ? 'text-accent-deep' : 'text-muted'}`}>{e.action === 'placed' ? 'Trade' : e.action === 'error' ? 'Error' : e.action === 'skipped' ? 'Skip' : 'Check'}</span>
              <span className="min-w-0">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
