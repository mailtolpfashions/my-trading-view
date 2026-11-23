'use client';

// The option pivot buy forward paper test (the owner's own rule): on, off, its settings, the two versions side by side,
// today's levels, every trade and the log.

import { useCallback, useEffect, useState } from 'react';
import { useShell } from '@/components/app/shell-context';
import { pivotApi, signedInr, type PivotReport, type PivotRule } from '@/lib/tradelab';
import { InfoTip } from '../info-tip';
import { Button, Card, inputCls } from '../ui';

const clock = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(11, 16);
const stamp = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(0, 16).replace('T', ' ');
const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const px = (p: number | null) => (p == null ? '—' : (p / 100).toFixed(2));
const SEL = `${inputCls} h-8 w-[88px] text-[13px]`;
const WHY = { target: 'Target', stop: 'Stop', trail: 'Trailing stop', time: 'Time' } as const;

const sentence = (r: PivotRule) => `Every trading day: the NIFTY call and put at the strike nearest the index (nearest expiry). Buy when the premium crosses above one of its daily pivot levels (from its previous day), ${r.entryFrom}–${r.entryTo}, up to ${r.maxTrades} trades a day each. Fixed version: +${r.targetPts} / −${r.stopPts} points. Ladder version: stop one level below, moving up level by level. All out at ${r.exit}.`;

export function PivotBuyPanel() {
  const { notify } = useShell();
  const [data, setData] = useState<PivotReport | null>(null);
  const [draft, setDraft] = useState<Partial<PivotRule> | null>(null);
  const load = useCallback(() => { pivotApi.report().then(setData, () => {}); }, []);
  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);
  const save = (p: Partial<PivotRule>, msg: string) => pivotApi.save(p).then(() => { notify(msg); setDraft(null); load(); }, (e: Error) => notify(e.message));
  if (!data) return null;
  const r = data.rule, today = data.days[0];

  return (
    <Card title={<span className="flex items-center gap-1.5">Option pivot buy paper test <InfoTip label="About this paper test">
      <p>Your pivot rule, run forward on live prices because there is no minute-by-minute history of option prices before November 2026.</p>
      <p>Levels are TradingView&rsquo;s Traditional daily pivots worked out on each option&rsquo;s own previous-day high, low and close (NSE&rsquo;s figures). The two versions follow the same live prices without placing orders: buys at the ask, sells at the bid, charges included.</p>
      <p>A day the app started after {r.entryFrom}, or was not running at {r.exit}, is shown but left out of the totals. Paper fills are kinder than real ones (no queue). It needs a few weeks of days before the numbers mean much.</p>
    </InfoTip></span>} actions={
      <button type="button" role="switch" aria-checked={r.enabled} onClick={() => void save({ enabled: !r.enabled }, r.enabled ? 'Option pivot test switched off' : 'Option pivot test switched on')} title={r.enabled ? 'Switch off' : 'Switch on'}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${r.enabled ? 'bg-up' : 'bg-line-strong'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${r.enabled ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    }>
      <p className="text-[12.5px] text-ink-2">{sentence(r)} <span className={`font-semibold ${r.enabled ? 'text-up' : 'text-muted'}`}>{r.enabled ? 'On' : 'Off'}</span></p>

      <div className="mt-2 flex flex-wrap items-end gap-2 text-[12.5px]">
        {draft ? (
          <>
            <label className="grid gap-0.5">Target pts<input className={SEL} type="number" value={draft.targetPts ?? r.targetPts} onChange={(e) => setDraft({ ...draft, targetPts: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Stop pts<input className={SEL} type="number" value={draft.stopPts ?? r.stopPts} onChange={(e) => setDraft({ ...draft, stopPts: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Trades a day<input className={SEL} type="number" value={draft.maxTrades ?? r.maxTrades} onChange={(e) => setDraft({ ...draft, maxTrades: Number(e.target.value) })} /></label>
            <label className="grid gap-0.5">Lots<input className={SEL} type="number" value={draft.lots ?? r.lots} onChange={(e) => setDraft({ ...draft, lots: Number(e.target.value) })} /></label>
            <Button variant="primary" className="h-8" onClick={() => void save(draft, 'Option pivot test saved')}>Save</Button>
            <Button className="h-8" onClick={() => setDraft(null)}>Cancel</Button>
          </>
        ) : <Button className="h-8" onClick={() => setDraft({})}>Change settings</Button>}
      </div>

      <div className="num mt-3 grid gap-1 text-[12.5px] text-muted">
        <span>Days counted {data.cleanDays}</span>
        {(['fixed', 'ladder'] as const).map((v) => {
          const t = data.totals[v];
          return (
            <span key={v} className="flex flex-wrap gap-x-4">
              <b className="w-[150px] text-ink-2">{v === 'fixed' ? `Fixed +${r.targetPts} / −${r.stopPts}` : 'Ladder (pivot trailing)'}</b>
              <span>Trades {t.trades}, won {t.won}</span>
              <span>Net after charges <b className={tone(t.netPaise)}>{signedInr(t.netPaise)}</b></span>
              <span>CE {signedInr(t.byKind.CE.netPaise)} · PE {signedInr(t.byKind.PE.netPaise)}</span>
            </span>
          );
        })}
      </div>

      {today && today.legs.length > 0 && (
        <div className="mt-2 grid gap-1 text-[12.5px]">
          <span className="text-muted">Levels for {today.date}{!today.clean && today.note ? ` (${today.note})` : ''}</span>
          {today.legs.map((l) => (
            <span key={l.label} className="num"><b>{l.label}</b> now {px(l.lastPaise)} · {l.levels.map((x) => `${x.name} ${px(x.paise)}`).join(' · ')}</span>
          ))}
        </div>
      )}

      {data.trades.length > 0 && (
        <div className="mt-2 max-h-[300px] overflow-auto">
          <table className="num w-full text-[12.5px]">
            <thead><tr className="text-left text-muted"><th>Day</th><th>Version</th><th>Option</th><th>Crossed</th><th className="text-right">Bought</th><th className="text-right">Sold</th><th>Why</th><th className="text-right">Points</th><th className="text-right">Net</th></tr></thead>
            <tbody>
              {data.trades.map((t, k) => (
                <tr key={`${t.entryAt}-${t.version}-${t.leg}-${k}`} className={`border-t border-line ${t.clean ? '' : 'opacity-50'}`} title={t.clean ? undefined : 'Left out of the totals'}>
                  <td>{t.date}</td><td>{t.version === 'fixed' ? 'Fixed' : 'Ladder'}</td><td>{t.leg}</td><td>{t.level}</td>
                  <td className="text-right">{px(t.entryPaise)} <span className="text-muted">{clock(t.entryAt)}</span></td>
                  <td className="text-right">{px(t.exitPaise)} {t.exitAt != null && <span className="text-muted">{clock(t.exitAt)}</span>}</td>
                  <td>{t.why ? WHY[t.why] : 'Open'}{t.version === 'ladder' && t.reached ? ` (reached ${t.reached})` : ''}</td>
                  <td className={`text-right ${t.exitPaise != null ? tone(t.exitPaise - t.entryPaise) : ''}`}>{t.exitPaise != null ? ((t.exitPaise - t.entryPaise) / 100).toFixed(2) : '—'}</td>
                  <td className={`text-right font-semibold ${t.netPaise != null ? tone(t.netPaise) : ''}`}>{t.netPaise != null ? signedInr(t.netPaise) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.events.length > 0 && (
        <ul className="mt-2 grid max-h-[160px] gap-1 overflow-y-auto border-t border-line pt-2 text-[12.5px]">
          {data.events.slice(0, 40).map((e, k) => (
            <li key={`${e.at}-${k}`} className="flex gap-2">
              <span className="num shrink-0 text-muted">{stamp(e.at)}</span>
              <span className={`shrink-0 font-semibold ${e.action === 'bought' ? 'text-up' : e.action === 'error' ? 'text-down' : e.action === 'skipped' ? 'text-accent-deep' : 'text-muted'}`}>{e.action === 'bought' ? 'Bought' : e.action === 'sold' ? 'Sold' : e.action === 'error' ? 'Error' : e.action === 'skipped' ? 'Skip' : 'Start'}</span>
              <span className="min-w-0">{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
