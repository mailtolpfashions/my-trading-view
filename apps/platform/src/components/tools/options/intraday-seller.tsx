'use client';

// The intraday option-selling engine (user's spec v14, packages/options/src/intraday) on screen: the answer first
// (direction, seller view, mode, the strike and its invalidation), then CALL vs PUT, then what would change the view;
// the full audit sits behind "Details". Live it re-checks every 5 minutes; Replay walks through a recorded day.
import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Radio, RotateCcw } from 'lucide-react';
import type { intraday } from '@mtv/options';
import { InfoTip } from '@/components/info-tip';
import { Segmented } from '@/components/ui';
import { agoText, useFeed } from '@/lib/feed';
import type { Tool } from '@/lib/tools';
import { Card, ToolShell } from '../tool-shell';

type View = intraday.View;
type Resp = {
  view: View; replay: boolean; changed: string[];
  previous: { at: number; sellerView: string; mode: string; setup: string | null } | null;
  coverage: { spot: number; spotSource: string; strikes: [number, number] | null; nearSpot: number; silent: number } | null;
  evidence: { sessions: number; from: string; to: string; built: string; notes: string[]; baseRates: { label: string; k: number; n: number; dates: string }[] };
};
type Day = { date: string; first: string; last: string; minutes: number };

const n0 = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pc = (v: number | null | undefined, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const DOT: Record<intraday.Grade, string> = { strong: 'bg-up', mixed: 'bg-accent', weak: 'bg-down', unknown: 'bg-transparent ring-1 ring-inset ring-line-strong' };
const GRADE_WORD: Record<intraday.Grade, string> = { strong: 'Strong', mixed: 'Mixed', weak: 'Weak', unknown: 'Unknown' };
const hm = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(11, 16);
const shift = (time: string, by: number) => { const [h, m] = time.split(':').map(Number); const t = Math.min(15 * 60 + 29, Math.max(9 * 60 + 16, h * 60 + m + by)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };

export function IntradaySellerTool({ tool }: { tool: Tool }) {
  const [mode, setMode] = useState<'live' | 'replay'>('live');
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState('11:00');
  const days = useFeed<Day[]>(mode === 'replay' ? 'seller/days' : null);
  useEffect(() => { if (mode === 'replay' && !day && days.data?.length) { const d = days.data.slice().sort((a, b) => b.minutes - a.minutes)[0]; setDay(d.date); setTime(shift(d.first, 30)); } }, [mode, day, days.data]);
  const path = mode === 'live' ? 'seller/view' : day ? `seller/view?at=${day}T${time}` : null;
  const r = useFeed<Resp>(path, mode === 'live' ? 300_000 : undefined);
  const res = r.data, v = res?.view;
  const picked = days.data?.find((d) => d.date === day);

  const controls = (
    <>
      <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'live', label: 'Live' }, { value: 'replay', label: 'Replay a day' }]} />
      {mode === 'replay' && (
        <>
          <select value={day ?? ''} onChange={(e) => setDay(e.target.value)} aria-label="Recorded day" className="h-10 rounded-[12px] border border-line-strong bg-panel px-3 text-[13px]">
            {(days.data ?? []).map((d) => <option key={d.date} value={d.date}>{d.date} · options {d.first}–{d.last}</option>)}
          </select>
          <div className="flex items-center rounded-[12px] border border-line-strong bg-panel">
            <button type="button" onClick={() => setTime(shift(time, -5))} aria-label="5 minutes earlier" className="grid h-10 w-9 place-items-center text-ink-2 hover:text-ink"><ChevronLeft size={16} /></button>
            <input type="time" min="09:16" max="15:29" step={300} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} aria-label="Time" className="num h-10 bg-transparent px-1 text-[13px] outline-none" />
            <button type="button" onClick={() => setTime(shift(time, 5))} aria-label="5 minutes later" className="grid h-10 w-9 place-items-center text-ink-2 hover:text-ink"><ChevronRight size={16} /></button>
          </div>
          {picked && <span className="text-[12px] text-muted">Option data recorded {picked.first}–{picked.last} ({picked.minutes} min)</span>}
        </>
      )}
      {mode === 'live' && res && r.at && <span className="flex items-center gap-1.5 text-[12px] text-muted"><Radio size={13} className={v?.stop ? '' : 'text-up'} /> checked {agoText(r.at)} · next check in 5 min</span>}
    </>
  );

  return (
    <ToolShell tool={tool} controls={controls} dataNote="Data: your Kite live feed (NIFTY, Bank Nifty, five heavyweights, NIFTY options recorded each minute). Evidence: past sessions replayed through the same engine. Analysis only — it never places orders."
      about={<p>Built from your spec v14. Every rule is labelled MEASURED, JUDGMENT or UNKNOWN under Details. Nothing here is a profit promise.</p>}>
      {r.error && !res && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13px] text-down">{r.error}</p>}
      {!res && !r.error && <div className="panel h-[260px] animate-pulse" />}
      {v && res && <Body v={v} res={res} onReplay={() => setMode('replay')} />}
    </ToolShell>
  );
}

function Body({ v, res, onReplay }: { v: View; res: Resp; onReplay: () => void }) {
  if (v.stop) return (
    <Card>
      <div className="grid gap-3 p-5">
        <p className="text-[13px] text-muted">{v.header.time} · {v.source}</p>
        <p className="text-[18px] font-bold">{v.stop}</p>
        {!res.replay && <button type="button" onClick={onReplay} className="inline-flex h-10 w-fit items-center gap-2 rounded-[12px] bg-inverse px-4 text-[13.5px] font-semibold text-on-inverse hover:bg-inverse-hover"><RotateCcw size={14} /> Replay a recorded day</button>}
      </div>
    </Card>
  );
  return (
    <div className="grid gap-3">
      <Answer v={v} res={res} />
      <Comparison v={v} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="What can change the view">
          <ul className="grid gap-1.5 p-4 text-[13px]">{v.triggers.map((t) => <li key={t} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{t}</li>)}</ul>
        </Card>
        <Card title="This time of day" right={<span>{v.header.phase}</span>}>
          <div className="grid gap-2 p-4 text-[13px]">
            <p className="text-ink-2">{v.audit.window}</p>
            <p><span className="text-muted">E4 (range hold):</span> {v.audit.e4.note}</p>
          </div>
        </Card>
      </div>
      <Details v={v} res={res} />
    </div>
  );
}

function Answer({ v, res }: { v: View; res: Resp }) {
  const s = v.setup;
  const tone = (x: string) => (x === 'NONE' || x === 'NOT ISSUED' || x === 'NOT CLEAR' ? 'text-ink-2' : 'text-ink');
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5 text-[12.5px]">
        <span className="font-semibold">{v.header.line}</span>
        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${res.replay ? 'bg-accent-soft text-accent-deep' : 'bg-up-soft text-up'}`}>{res.replay ? v.source : 'Live'}</span>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <div className="grid content-start gap-3">
          <dl className="grid grid-cols-3 gap-2">
            {([['Direction', v.direction + (v.strength ? ` · ${v.strength}` : '')], ['Seller view', v.sellerView], ['Mode', v.mode]] as const).map(([k, val]) => (
              <div key={k} className="rounded-[12px] bg-raised px-3 py-2.5">
                <dt className="text-[11.5px] text-muted">{k}</dt>
                <dd className={`mt-0.5 text-[14px] font-bold leading-tight ${tone(val)}`}>{val}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-1.5 text-[13.5px] leading-relaxed">{v.why.map((w) => <p key={w}>{w}</p>)}</div>
          {v.notice && <p className="rounded-[12px] border border-accent/40 bg-accent-soft px-3 py-2 text-[12.5px] text-accent-deep">{v.notice}</p>}
          {res.previous && (
            <p className="text-[12.5px] text-ink-2"><span className="text-muted">Previous view ({hm(res.previous.at)}):</span> {res.previous.sellerView}{res.previous.setup ? `, ${res.previous.setup}` : ''} · <span className="text-muted">What changed:</span> {res.changed.length ? res.changed.join('; ') : 'nothing material'}</p>
          )}
        </div>
        {s ? (
          <div className="rounded-[14px] border border-line p-4">
            <p className="eyebrow">Preferred sell setup</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="num text-[26px] font-extrabold tracking-[-0.02em]">{n0(s.strike)} {s.side === 'CALL SELL' ? 'CE' : 'PE'}</span>
              <span className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${s.side === 'CALL SELL' ? 'bg-down-soft text-down' : 'bg-up-soft text-up'}`}>{s.side}</span>
              <span className="text-[12.5px] text-muted">expiry {s.expiry}</span>
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
              {([['Premium', `₹${n2(s.premium)}`], ['Lot value', s.lotValue ? `₹${n0(s.lotValue)} (${s.lotSize})` : '—'], ['Breakeven', n2(s.breakeven)], ['From spot', `${n0(s.distSpot)} pts`], [`Past day's ${s.side === 'CALL SELL' ? 'high' : 'low'}`, `${n0(s.distExtreme)} pts`], ['Went this far before', s.breachOdds == null ? '—' : `${pc(s.breachOdds)} of sessions`], ['OI', n0(s.oi)], ['Volume', n0(s.volume)], ['Spread', pc(s.spreadPct, 2)]] as const).map(([k, val]) => (
                <div key={k}><dt className="text-[11.5px] text-muted">{k}</dt><dd className="num font-semibold">{val}</dd></div>
              ))}
            </dl>
            <p className="mt-3 rounded-[10px] bg-down-soft px-3 py-2 text-[13px] text-down"><b>Invalidation:</b> {s.invalidation.text}{s.premiumAtInvalidation != null && <span className="block text-[12px] text-ink-2">Premium then ≈ ₹{n2(s.premiumAtInvalidation)} — ESTIMATE, equal-moneyness interpolation from the live chain</span>}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${s.gamma === 'OK' ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>Gamma {s.gamma}</span>
              {s.flags.filter((f) => f !== 'GAMMA WARNING').map((f) => <span key={f} className="rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-semibold text-accent-deep">{f}</span>)}
            </div>
          </div>
        ) : (
          <div className="grid place-items-center rounded-[14px] border border-dashed border-line-strong p-6 text-center">
            <div>
              <p className="text-[22px] font-extrabold">SIDE: NONE</p>
              <p className="mt-1 text-[13px] text-ink-2">No trade is forced. {v.twoSided.offered ? '' : 'Two-sided selling is not offered either.'}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Comparison({ v }: { v: View }) {
  const c = v.sides.call, p = v.sides.put;
  if (!c || !p) return null;
  const head = (x: intraday.SideView, label: string) => (
    <span className="flex flex-col"><span>{label}</span><span className="text-[11px] font-normal text-muted">{x.verdict.toLowerCase()}{x.graded ? ` · graded on ${n0(x.graded.strike)}` : ''}</span></span>
  );
  return (
    <Card title={<span className="flex items-center gap-1.5">Seller comparison <InfoTip label="How to read this">Each row grades the strike shown under the side's name: the chosen strike, or the nearest one past the day's extreme when none qualifies. Green strong, amber mixed, red weak, hollow unknown. No numeric score is shown: the grading rules are judgment-calibrated until the log has enough sessions.</InfoTip></span>}
      right={<span className="flex items-center gap-3">{(['strong', 'mixed', 'weak', 'unknown'] as const).map((g) => <span key={g} className="flex items-center gap-1"><i className={`inline-block h-2.5 w-2.5 rounded-full ${DOT[g]}`} />{GRADE_WORD[g]}</span>)}</span>}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="text-left text-[12px] text-ink-2"><th className="px-4 py-2 font-semibold">Factor</th><th className="px-4 py-2 font-semibold">{head(c, 'CALL SELL')}</th><th className="px-4 py-2 font-semibold">{head(p, 'PUT SELL')}</th></tr></thead>
          <tbody>
            {v.comparison.map((row) => (
              <tr key={row.factor} className="border-t border-line hover:bg-raised">
                <td className="px-4 py-1.5 font-medium">{row.factor}</td>
                {[row.call, row.put].map((g, i) => (
                  <td key={i} className="px-4 py-1.5" title={`${GRADE_WORD[g.grade]}: ${g.note}`}>
                    <span className="flex items-center gap-2"><i className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${DOT[g.grade]}`} /><span className="truncate text-ink-2">{g.note || GRADE_WORD[g.grade]}</span></span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Details({ v, res }: { v: View; res: Resp }) {
  const a = v.audit;
  const [copied, setCopied] = useState(false);
  const sideWord = (s: number | null) => (s == null ? 'no data' : s > 0 ? 'Up' : s < 0 ? 'Down' : 'Neutral');
  const candidates = useMemo(() => [v.sides.call, v.sides.put].filter(Boolean) as intraday.SideView[], [v]);
  return (
    <details className="panel group">
      <summary className="cursor-pointer list-none px-4 py-3 text-[13px] font-bold marker:hidden">Details: checks, chain, evidence and the log <span className="font-normal text-muted">(audit)</span></summary>
      <div className="grid gap-4 border-t border-line p-4 text-[12.5px]">
        <section>
          <h3 className="mb-1.5 font-bold">Directional checks</h3>
          <p className="mb-2 text-ink-2">{a.pressureNote}{a.redundancy ? ` ${a.redundancy}` : ''}{a.conflicts.length ? ` ${a.conflicts.join(', ')}.` : ''}{a.confidence != null ? ` Confidence ${a.confidence}.` : ''}</p>
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr className="text-left text-ink-2"><th className="py-1 pr-3">Check</th><th className="py-1 pr-3">Reads</th><th className="py-1 pr-3">Weight</th><th className="py-1">Detail</th></tr></thead>
            <tbody>{a.checks.map((c) => (
              <tr key={c.id} className="border-t border-line align-top"><td className="py-1 pr-3 font-medium">{c.label}</td><td className="py-1 pr-3">{sideWord(c.side)}</td><td className="py-1 pr-3"><span className="num font-semibold">{c.weight}</span> <span className="text-muted">{c.weightBasis}</span></td><td className="py-1 text-ink-2">{c.detail}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1.5 font-bold">Market</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted">Spot</dt><dd className="num">{n2(a.spot)}</dd>
              <dt className="text-muted">Reference close</dt><dd className="num">{n2(a.refClose)} <span className="text-muted">({a.reference})</span></dd>
              <dt className="text-muted">ATR(14)</dt><dd><span className="num">{n2(a.atr)}</span> <span className="text-muted">{a.atrNote}</span></dd>
              <dt className="text-muted">India VIX</dt><dd><span className="num">{n2(a.vix)}</span> <span className="text-muted">{a.vixNote}{a.vixMovePts != null ? ` · implies ±${n0(a.vixMovePts)} pts a day` : ''}</span></dd>
              <dt className="text-muted">Day range</dt><dd className="num">{n2(a.dayLow)} – {n2(a.dayHigh)} {a.dayRangeAtr != null && <span className="text-muted">({a.dayRangeAtr.toFixed(2)} ATR)</span>}</dd>
              <dt className="text-muted">Opening</dt><dd>{a.opening}{a.openingRange ? ` (range ${n0(a.openingRange.low)}–${n0(a.openingRange.high)})` : ''}</dd>
              <dt className="text-muted">Gap</dt><dd>{a.gap ? `${a.gap.pts >= 0 ? '+' : ''}${n2(a.gap.pts)} pts${a.gap.atr != null ? ` (${a.gap.atr.toFixed(2)} ATR)` : ''}, ${a.gap.behaviour}` : '—'}</dd>
              <dt className="text-muted">Capacity</dt><dd>{a.capacity.score ?? 'UNKNOWN'} <span className="text-muted">{a.capacity.note}</span></dd>
            </dl>
          </div>
          <div>
            <h3 className="mb-1.5 font-bold">Option chain</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              {(['call', 'put'] as const).map((k) => { const w = a.walls[k]; return (
                <Fragment key={k}><dt className="text-muted">{k === 'call' ? 'Call wall' : 'Put wall'}</dt><dd>{w ? <><span className="num font-semibold">{n0(w.strike)}</span> · {w.strength.toFixed(1)}× mean · {w.tests} test{w.tests === 1 ? '' : 's'}{w.broken ? ' · broken' : ''} · unwind {pc(w.unwindPct)} · <b>{w.status}</b></> : '—'}</dd></Fragment>
              ); })}
              <dt className="text-muted">PCR (±250)</dt><dd className="num">{a.pcr?.toFixed(2) ?? '—'}</dd>
              {a.flows.map((f) => <Fragment key={f}><dt className="text-muted">Flow</dt><dd>{f}</dd></Fragment>)}
              <dt className="text-muted">Two-sided</dt><dd>{v.twoSided.offered ? 'offered' : `not offered — ${v.twoSided.failed.join('; ')}`}</dd>
              {res.coverage && <><dt className="text-muted">Recorder</dt><dd>strikes {res.coverage.strikes ? `${n0(res.coverage.strikes[0])}–${n0(res.coverage.strikes[1])}` : '—'} around {n0(res.coverage.spot)} ({res.coverage.spotSource}), {res.coverage.silent} of {res.coverage.nearSpot} near-spot contracts silent</dd></>}
            </dl>
          </div>
        </section>
        <section>
          <h3 className="mb-1.5 font-bold">Every strike checked (ATM first)</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {candidates.map((sv) => (
              <div key={sv.right} className="overflow-x-auto">
                <p className="mb-1 font-semibold">{sv.right === 'CE' ? 'Calls' : 'Puts'} · {sv.scanned} scanned</p>
                <table className="w-full">
                  <tbody>{sv.candidates.slice(0, 12).map((c) => (
                    <tr key={c.strike} className={`border-t border-line ${sv.chosen?.strike === c.strike ? 'bg-accent-soft' : ''}`}>
                      <td className="num py-0.5 pr-2 font-semibold">{n0(c.strike)}</td>
                      <td className="num py-0.5 pr-2">₹{n2(c.premium)}</td>
                      <td className={`py-0.5 ${c.pass ? 'text-up' : 'text-ink-2'}`}>{c.pass ? `passes${c.flags.length ? ` · ${c.flags.join(', ')}` : ''}` : c.fails[0]}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </div>
        </section>
        <section className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1.5 font-bold">How each rule is backed</h3>
            <ul className="grid gap-0.5">{a.labels.map((l) => <li key={l.item}><span className={`mr-1.5 rounded px-1 text-[10.5px] font-bold ${l.label === 'MEASURED' || l.label === 'VALIDATED' ? 'bg-up-soft text-up' : l.label === 'JUDGMENT' ? 'bg-accent-soft text-accent-deep' : 'bg-raised text-ink-2'}`}>{l.label}</span>{l.item}</li>)}</ul>
            <h3 className="mb-1.5 mt-3 font-bold">Not available (UNKNOWN)</h3>
            <ul className="grid gap-0.5 text-ink-2">{a.unknown.map((u) => <li key={u}>{u}</li>)}</ul>
          </div>
          <div>
            <h3 className="mb-1.5 font-bold">Evidence</h3>
            <p className="text-ink-2">{res.evidence.sessions} sessions, {res.evidence.from} → {res.evidence.to}. {res.evidence.notes.join(' ')}</p>
            <table className="mt-2 w-full"><tbody>{res.evidence.baseRates.map((b) => <tr key={b.label} className="border-t border-line"><td className="py-0.5 pr-2">{b.label}</td><td className="num py-0.5 text-right">{pc(b.k / b.n, 1)} <span className="text-muted">({b.k}/{b.n})</span></td></tr>)}</tbody></table>
          </div>
        </section>
        <section>
          <h3 className="mb-1.5 flex items-center gap-2 font-bold">Log line <button type="button" onClick={() => { void navigator.clipboard?.writeText(v.log).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold text-accent-deep hover:bg-accent-soft"><Copy size={12} />{copied ? 'Copied' : 'Copy'}</button></h3>
          <code className="block overflow-x-auto rounded-[10px] bg-raised px-3 py-2 text-[11.5px]">{v.log}</code>
        </section>
      </div>
    </details>
  );
}
