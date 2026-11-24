'use client';

// The weekend theta test: a Friday → Tuesday-expiry paper rule (0.30-delta strangle with 0.05-delta wings, off by
// default) and the Monday price check that runs whenever Kite is connected: the ATM straddle at Friday's close against
// Monday's times, to see what a seller really gets for the weekend.

import { useCallback, useEffect, useState } from 'react';
import { useShell } from '@/components/app/shell-context';
import { inr, signedInr, weekendApi, type WeekendReport, type WeekendRule } from '@/lib/tradelab';
import { InfoTip } from '../info-tip';
import { Button, Card, inputCls } from '../ui';

const clock = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const tone = (v: number | null) => (v == null ? 'text-ink-2' : v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const SEL = `${inputCls} h-8 w-[88px] text-[13px]`;
const pc = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);

function sentence(r: WeekendRule) {
  return `Every Friday at ${r.time}: sell ${r.lots} lot${r.lots > 1 ? 's' : ''} each of the NIFTY call and put nearest ${r.delta} delta on the coming expiry${r.wings ? `, and buy the ${r.wingDelta}-delta call and put as wings` : ''}. Held over the weekend to expiry settlement.`;
}

export function WeekendPanel() {
  const { notify } = useShell();
  const [data, setData] = useState<WeekendReport | null>(null);
  const [draft, setDraft] = useState<Partial<WeekendRule> | null>(null);
  const load = useCallback(() => { weekendApi.report().then(setData, () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const save = (p: Partial<WeekendRule>, msg: string) => weekendApi.save(p).then(() => { notify(msg); setDraft(null); load(); }, (e: Error) => notify(e.message));
  if (!data) return null;
  const r = data.rule, t = data.totals;
  const shown = data.medians.filter((m) => m.weekends > 0);

  return (
    <Card title={<span className="flex items-center gap-1.5">Weekend theta test <InfoTip label="About this test">
      <p>Your idea from the theta video: sell on Friday and let the weekend decay work. On past data (NIFTY since Sep 2025, FINNIFTY 2021–24), buying back on Monday morning lost money. Holding to Tuesday expiry earned about 10% a year on ₹5 lakh with 1 lot, mostly from Monday and expiry day.</p>
      <p>The Monday price check runs even when the rule is off. It records the ATM straddle at Friday 15:25 and 15:29 and at several Monday times, at Friday&rsquo;s strike and at Monday&rsquo;s own ATM strike (the video&rsquo;s way). It sets them against NSE&rsquo;s daily open, which the backtest used. The app must be running at those times.</p>
      <p>Paper only. Paper fills are kinder than real ones.</p>
    </InfoTip></span>} actions={
      <button type="button" role="switch" aria-checked={r.enabled} onClick={() => void save({ enabled: !r.enabled }, r.enabled ? 'Weekend rule switched off' : 'Weekend rule switched on')} title={r.enabled ? 'Switch off' : 'Switch on'}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-up' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    }>
      <p className="text-[12.5px] text-ink-2">{sentence(r)} <span className={`font-semibold ${r.enabled ? 'text-up' : 'text-muted'}`}>{r.enabled ? 'On' : 'Off'}</span></p>

      <div className="mt-2 flex flex-wrap items-end gap-2 text-[12.5px]">
        {draft ? (
          <>
            <label className="grid gap-0.5">Time<input className={SEL} value={draft.time ?? r.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} /></label>
            <label className="grid gap-0.5">Delta<input className={SEL} type="number" step="0.01" value={draft.delta ?? r.delta} onChange={(e) => setDraft({ ...draft, delta: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Wings<select className={SEL} value={(draft.wings ?? r.wings) ? 'yes' : 'no'} onChange={(e) => setDraft({ ...draft, wings: e.target.value === 'yes' })}><option value="yes">Yes</option><option value="no">No</option></select></label>
            <label className="grid gap-0.5">Wing delta<input className={SEL} type="number" step="0.01" value={draft.wingDelta ?? r.wingDelta} onChange={(e) => setDraft({ ...draft, wingDelta: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Lots<input className={SEL} type="number" value={draft.lots ?? r.lots} onChange={(e) => setDraft({ ...draft, lots: Number(e.target.value) })} /></label>
            <Button variant="primary" className="h-8" onClick={() => void save(draft, 'Weekend rule saved')}>Save</Button>
            <Button className="h-8" onClick={() => setDraft(null)}>Cancel</Button>
          </>
        ) : <Button className="h-8" onClick={() => setDraft({})}>Change settings</Button>}
      </div>

      <p className="num mt-3 flex flex-wrap gap-x-4 text-[12.5px] text-muted">
        <span>Weekends checked {t.weekends}</span>
        <span>Traded {t.traded}</span>
        <span>Settled net after charges <b className={tone(t.netPaise)}>{signedInr(t.netPaise)}</b></span>
      </p>

      <h3 className="mt-3 text-[13px] font-semibold">Monday price check</h3>
      {shown.length === 0 ? (
        <p className="text-[12.5px] text-muted">No full weekend recorded yet. The first one needs the app running this Friday at 15:25 and next Monday from 09:15.</p>
      ) : (
        <div className="mt-1 overflow-x-auto">
          <table className="num w-full text-[12.5px]">
            <thead><tr className="text-left text-muted"><th>Monday</th><th className="text-right">Weekends</th><th className="text-right">Friday&rsquo;s strike</th><th className="text-right">Monday ATM</th></tr></thead>
            <tbody>{shown.map((m) => (
              <tr key={m.time} className="border-t border-line"><td>{m.time}</td><td className="text-right">{m.weekends}</td><td className={`text-right ${tone(m.fixedPct == null ? null : -m.fixedPct)}`}>{pc(m.fixedPct)}</td><td className={`text-right ${tone(m.rolledPct == null ? null : -m.rolledPct)}`}>{pc(m.rolledPct)}</td></tr>
            ))}</tbody>
          </table>
          <p className="mt-1 text-[12px] text-muted">Median change of the straddle from Friday 15:29 (mid price). &ldquo;NSE open&rdquo; is NSE&rsquo;s daily open against its daily close, as the backtest used. A fall is good for a seller.</p>
        </div>
      )}

      {data.checks.length > 0 && (
        <details className="mt-2 text-[12.5px]">
          <summary className="cursor-pointer text-muted">Each weekend</summary>
          {data.checks.map((c) => (
            <div key={c.friday} className="mt-2">
              <p className="num">{c.friday} → {c.monday ?? 'Monday not recorded'} · expiry {c.expiry} · strike {c.strikePaise / 100} · Friday 15:29 {inr(c.basePaise)} (NSE close {inr(c.nse.friClosePaise)})</p>
              <table className="num w-full">
                <tbody>{c.rows.filter((x) => x.fixedPaise != null).map((x) => (
                  <tr key={x.time} className="border-t border-line"><td>{x.time}</td><td className="text-right">{inr(x.fixedPaise)}</td><td className="text-right">{pc(x.fixedPct)}</td><td className="text-right">{x.rolledPaise == null ? '' : `ATM ${inr(x.rolledPaise)} (${pc(x.rolledPct)})`}</td><td className="text-right text-muted">{x.spreadPaise == null ? '' : `spread ${inr(x.spreadPaise)}`}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ))}
        </details>
      )}

      {data.entries.length > 0 && (
        <div className="mt-3 max-h-[300px] overflow-auto">
          <table className="num w-full text-[12.5px]">
            <thead><tr className="text-left text-muted"><th>Friday</th><th>Expiry</th><th>Leg</th><th className="text-right">Delta</th><th className="text-right">Bid / ask</th><th className="text-right">Fill</th><th className="text-right">Settled</th><th className="text-right">Net</th></tr></thead>
            <tbody>
              {data.entries.flatMap((e) => e.legs.map((l, i) => (
                <tr key={`${e.date}-${l.symbol}`} className="border-t border-line">
                  <td>{i === 0 ? e.date : ''}</td><td>{i === 0 ? e.expiry : ''}</td>
                  <td>{l.side === 'BUY' ? 'Buy ' : 'Sell '}{e.labels[i] ?? l.symbol}</td><td className="text-right">{l.delta}</td>
                  <td className="text-right">{inr(l.bidPaise)} / {inr(l.askPaise)}</td><td className="text-right">{inr(l.fillPaise)}</td>
                  <td className="text-right">{inr(e.settlePaise[i])}</td>
                  <td className={`text-right ${i === 0 ? tone(e.netPaise) : ''}`}>{i === 0 ? (e.netPaise == null ? (e.done ? '—' : 'open') : signedInr(e.netPaise)) : ''}</td>
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
