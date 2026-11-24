'use client';

// The expiry-day straddle forward paper test (docs/quant/05-intraday-selling.md): on NIFTY's expiry day, sell the ATM
// straddle at 9:30 with a stop on each leg and buy back at 15:00; a no-stop version is priced beside it on the same
// quotes. On, off, settings, totals for both versions, every day's legs and the log.

import { useCallback, useEffect, useState } from 'react';
import { useShell } from '@/components/app/shell-context';
import { expApi, inr, signedInr, type ExpReport, type ExpRule } from '@/lib/tradelab';
import { InfoTip } from '../info-tip';
import { Button, Card, inputCls } from '../ui';

const clock = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const SEL = `${inputCls} h-8 w-[88px] text-[13px]`;
const HOW = { stop: 'Stop', time: '15:00', open: 'Open' } as const;
const sentence = (r: ExpRule) => `On NIFTY's expiry day only, at ${r.entry}: sell ${r.lots} lot${r.lots > 1 ? 's' : ''} each of the ATM call and put expiring that day, each with a ${r.stopPct}% stop on its own; whatever is left is bought back at ${r.exit}.`;

export function ExpiryStraddlePanel() {
  const { notify } = useShell();
  const [data, setData] = useState<ExpReport | null>(null);
  const [draft, setDraft] = useState<Partial<ExpRule> | null>(null);
  const load = useCallback(() => { expApi.report().then(setData, () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const save = (p: Partial<ExpRule>, msg: string) => expApi.save(p).then(() => { notify(msg); setDraft(null); load(); }, (e: Error) => notify(e.message));
  if (!data) return null;
  const r = data.rule, t = data.totals, n = data.noStop;

  return (
    <Card title={<span className="flex items-center gap-1.5">Expiry-day straddle paper test <InfoTip label="About this paper test">
      <p>From the intraday selling study on real NSE prices (2019 to 2026): selling the ATM straddle on expiry day made money in 7 of 8 years even with ₹3 slippage per fill, but that study could only use the 9:15 open and the close. This test checks it in your 9:30 to 3:00 window on live prices.</p>
      <p>The paper orders use a {r.stopPct}% stop on each leg. The no-stop version is priced beside it on the same quotes, without orders (sold at the bid at entry, bought at the ask at {r.exit}, with charges). A day the app was not running at {r.exit} is settled at expiry and left out.</p>
      <p>About 52 expiry days a year, so it needs months before the numbers mean much. Paper fills are kinder than real ones.</p>
    </InfoTip></span>} actions={
      <button type="button" role="switch" aria-checked={r.enabled} onClick={() => void save({ enabled: !r.enabled }, r.enabled ? 'Expiry-day straddle switched off' : 'Expiry-day straddle switched on')} title={r.enabled ? 'Switch off' : 'Switch on'}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-up' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    }>
      <p className="text-[12.5px] text-ink-2">{sentence(r)} <span className={`font-semibold ${r.enabled ? 'text-up' : 'text-muted'}`}>{r.enabled ? 'On' : 'Off'}</span></p>

      <div className="mt-2 flex flex-wrap items-end gap-2 text-[12.5px]">
        {draft ? (
          <>
            <label className="grid gap-0.5">Stop %<input className={SEL} type="number" value={draft.stopPct ?? r.stopPct} onChange={(e) => setDraft({ ...draft, stopPct: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Lots<input className={SEL} type="number" value={draft.lots ?? r.lots} onChange={(e) => setDraft({ ...draft, lots: Number(e.target.value) })} /></label>
            <Button variant="primary" className="h-8" onClick={() => void save(draft, 'Expiry-day straddle saved')}>Save</Button>
            <Button className="h-8" onClick={() => setDraft(null)}>Cancel</Button>
          </>
        ) : <Button className="h-8" onClick={() => setDraft({})}>Change settings</Button>}
      </div>

      <table className="num mt-3 w-full text-[12.5px]">
        <thead><tr className="text-left text-muted"><th>Version</th><th className="text-right">Days</th><th className="text-right">Won</th><th className="text-right">Net after charges</th><th className="text-right">Worst day</th></tr></thead>
        <tbody>
          <tr className="border-t border-line"><td>{r.stopPct}% stop on each leg (paper orders)</td><td className="text-right">{t.clean}{t.days > t.clean ? ` (+${t.days - t.clean} left out)` : ''}</td><td className="text-right">{t.won}</td><td className={`text-right font-semibold ${tone(t.netPaise)}`}>{signedInr(t.netPaise)}</td><td className={`text-right ${tone(t.worstPaise)}`}>{t.worstPaise < 0 ? signedInr(t.worstPaise) : '—'}</td></tr>
          <tr className="border-t border-line"><td>No stop (priced on the same quotes)</td><td className="text-right">{n.days}</td><td className="text-right">{n.won}</td><td className={`text-right font-semibold ${tone(n.netPaise)}`}>{signedInr(n.netPaise)}</td><td className={`text-right ${tone(n.worstPaise)}`}>{n.worstPaise < 0 ? signedInr(n.worstPaise) : '—'}</td></tr>
        </tbody>
      </table>
      {t.stopsHit > 0 && <p className="num mt-1 text-[12px] text-muted">Stops hit {t.stopsHit} · charges {inr(t.chargesPaise)}</p>}

      {data.days.length > 0 && (
        <div className="mt-2 max-h-[300px] overflow-auto">
          <table className="num w-full text-[12.5px]">
            <thead><tr className="text-left text-muted"><th>Day</th><th>Leg</th><th className="text-right">Sold</th><th className="text-right">Stop</th><th className="text-right">Bought back</th><th>How</th><th className="text-right">Net</th><th className="text-right">No-stop net</th></tr></thead>
            <tbody>
              {data.days.flatMap((d) => d.legs.map((l, i) => (
                <tr key={`${d.date}-${l.symbol}`} className="border-t border-line" title={d.note ?? undefined}>
                  <td>{i === 0 ? d.date : ''}</td><td>{l.label}</td>
                  <td className="text-right">{inr(l.fillPaise)}</td><td className="text-right">{inr(l.stopPaise)}</td><td className="text-right">{inr(l.exitPaise)}</td>
                  <td>{l.how ? HOW[l.how] : '—'}</td>
                  <td className={`text-right ${i === 0 && d.netPaise != null ? tone(d.netPaise) : ''}`}>{i === 0 ? (!d.clean ? 'left out' : d.netPaise == null ? 'open' : signedInr(d.netPaise)) : ''}</td>
                  <td className={`text-right ${i === 0 && d.noStop?.netPaise != null ? tone(d.noStop.netPaise) : ''}`}>{i === 0 ? (!d.noStop ? '—' : d.noStop.netPaise == null ? 'open' : signedInr(d.noStop.netPaise)) : ''}</td>
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
              <span className={`shrink-0 font-semibold ${e.action === 'placed' ? 'text-up' : e.action === 'error' ? 'text-down' : e.action === 'skipped' ? 'text-accent-deep' : 'text-muted'}`}>{e.action === 'placed' ? 'Sold' : e.action === 'closed' ? 'Closed' : e.action === 'error' ? 'Error' : e.action === 'skipped' ? 'Skip' : 'Check'}</span>
              <span className="min-w-0">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
