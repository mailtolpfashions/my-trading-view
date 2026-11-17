'use client';

// The 9:20 straddle forward paper test: the rule from a YouTube episode, run every day on live prices. On, off, its
// settings, results by days to expiry, every day's legs, and its log.

import { useCallback, useEffect, useState } from 'react';
import { useShell } from '@/components/app/shell-context';
import { inr, s920Api, signedInr, type S920Report, type S920Rule } from '@/lib/tradelab';
import { InfoTip } from '../info-tip';
import { Button, Card, inputCls } from '../ui';

const clock = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const SEL = `${inputCls} h-8 w-[88px] text-[13px]`;
const DTE = (n: number) => (n === 0 ? 'Expiry day' : `${n} day${n > 1 ? 's' : ''} before`);
const HOW = { stop: 'Stop', time: '15:20', open: 'Open' } as const;

const sentence = (r: S920Rule) => `Every trading day at ${r.entry}: sell ${r.lots} lot${r.lots > 1 ? 's' : ''} each of the NIFTY ATM call and put on the nearest expiry (expiry day included), each with a ${r.stopPct}% stop on its own; whatever is left is bought back at ${r.exit}.`;

export function Straddle920Panel() {
  const { notify } = useShell();
  const [data, setData] = useState<S920Report | null>(null);
  const [draft, setDraft] = useState<Partial<S920Rule> | null>(null);
  const load = useCallback(() => { s920Api.report().then(setData, () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const save = (p: Partial<S920Rule>, msg: string) => s920Api.save(p).then(() => { notify(msg); setDraft(null); load(); }, (e: Error) => notify(e.message));
  if (!data) return null;
  const r = data.rule, t = data.totals;

  return (
    <Card title={<span className="flex items-center gap-1.5">9:20 straddle paper test <InfoTip label="About this paper test">
      <p>The &ldquo;9:20 straddle&rdquo; from the YouTube episode you shared, run forward on live prices because we have no history of option prices minute by minute. It uses the video&rsquo;s times (9:20 to 3:20), not your 9:30 to 3:00 window, for this test only.</p>
      <p>Each leg&rsquo;s stop is a stop-loss buy at {r.stopPct}% above its own fill. Results are after charges and are grouped by days to expiry, as in the video (counted in weekdays; a holiday can shift it by one). A day the app was not running at {r.exit} is closed later and left out of the results.</p>
      <p>Paper fills are kinder than real ones (no queue). It needs about 3 to 6 months of days before the numbers mean much.</p>
    </InfoTip></span>} actions={
      <button type="button" role="switch" aria-checked={r.enabled} onClick={() => void save({ enabled: !r.enabled }, r.enabled ? '9:20 straddle switched off' : '9:20 straddle switched on')} title={r.enabled ? 'Switch off' : 'Switch on'}
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
            <Button variant="primary" className="h-8" onClick={() => void save(draft, '9:20 straddle saved')}>Save</Button>
            <Button className="h-8" onClick={() => setDraft(null)}>Cancel</Button>
          </>
        ) : <Button className="h-8" onClick={() => setDraft({})}>Change settings</Button>}
      </div>

      <p className="num mt-3 flex flex-wrap gap-x-4 text-[12.5px] text-muted">
        <span>Days {t.clean}{t.days > t.clean ? ` (+${t.days - t.clean} left out)` : ''}</span>
        <span>Won {t.won}</span>
        <span>Stops hit {t.stopsHit} (both legs {t.bothStopped} days)</span>
        <span>Net after charges <b className={tone(t.netPaise)}>{signedInr(t.netPaise)}</b> (charges {inr(t.chargesPaise)})</span>
      </p>

      <p className="num mt-1 flex flex-wrap items-center gap-x-4 text-[12.5px] text-muted">
        <span className="flex items-center gap-1">Breakout-shift version <InfoTip label="Breakout-shift version">
          <p>Tracked beside the real paper trade on the same live prices, without placing orders: the same 9:20 straddle with no stop. If NIFTY breaks the last 2 sessions&rsquo; high, the call is bought back and a call priced at about half the put is sold; below their low, the same with the put. Back inside the range, the shifted leg returns to ATM. At most 4 shifts a day; everything is bought back at {r.exit}. Sells at the bid, buys at the ask, with charges.</p>
          <p>This is rule 5 of the YouTube short-straddle series, to compare with the 20% stops.</p>
        </InfoTip></span>
        <span>Days {data.shadow.days}, won {data.shadow.won}, shifts {data.shadow.shifts}</span>
        <span>Net after charges <b className={tone(data.shadow.netPaise)}>{signedInr(data.shadow.netPaise)}</b></span>
      </p>

      {data.byDte.length > 0 && (
        <table className="num mt-2 w-full text-[12.5px]">
          <thead><tr className="text-left text-muted"><th>Days to expiry</th><th className="text-right">Days</th><th className="text-right">Won</th><th className="text-right">Net</th><th className="text-right">Worst day</th><th className="text-right">Breakout-shift net</th></tr></thead>
          <tbody>{data.byDte.map((b) => {
            const sh = data.shadow.byDte.find((x) => x.dte === b.dte);
            return (
              <tr key={b.dte} className="border-t border-line"><td>{DTE(b.dte)}</td><td className="text-right">{b.days}</td><td className="text-right">{b.won}</td><td className={`text-right font-semibold ${tone(b.netPaise)}`}>{signedInr(b.netPaise)}</td><td className={`text-right ${tone(b.worstPaise)}`}>{b.worstPaise < 0 ? signedInr(b.worstPaise) : '—'}</td><td className={`text-right ${sh ? tone(sh.netPaise) : ''}`}>{sh ? signedInr(sh.netPaise) : '—'}</td></tr>
            );
          })}</tbody>
        </table>
      )}

      {data.days.length > 0 && (
        <div className="mt-2 max-h-[300px] overflow-auto">
          <table className="num w-full text-[12.5px]">
            <thead><tr className="text-left text-muted"><th>Day</th><th>Expiry</th><th>Leg</th><th className="text-right">Sold</th><th className="text-right">Stop</th><th className="text-right">Bought back</th><th>How</th><th className="text-right">Net</th><th className="text-right">Shift version</th></tr></thead>
            <tbody>
              {data.days.flatMap((d) => d.legs.map((l, i) => (
                <tr key={`${d.date}-${l.symbol}`} className="border-t border-line" title={d.note ?? undefined}>
                  <td>{i === 0 ? `${d.date} (${DTE(d.dte)})` : ''}</td><td>{i === 0 ? d.expiry : ''}</td>
                  <td>{l.label}</td><td className="text-right">{inr(l.fillPaise)}</td><td className="text-right">{inr(l.stopPaise)}</td><td className="text-right">{inr(l.exitPaise)}</td>
                  <td>{l.how ? HOW[l.how] : '—'}</td>
                  <td className={`text-right ${i === 0 && d.netPaise != null ? tone(d.netPaise) : ''}`}>{i === 0 ? (!d.clean ? 'left out' : d.netPaise == null ? 'open' : signedInr(d.netPaise)) : ''}</td>
                  <td className={`text-right ${i === 0 && d.shadow?.netPaise != null ? tone(d.shadow.netPaise) : ''}`} title={i === 0 && d.shadow ? d.shadow.events.map((x) => x.text).join('\n') : undefined}>{i === 0 ? (!d.shadow ? '—' : d.shadow.netPaise == null ? `open (${d.shadow.shifts} shift${d.shadow.shifts === 1 ? '' : 's'})` : signedInr(d.shadow.netPaise)) : ''}</td>
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
