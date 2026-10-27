'use client';

import { Fragment, useEffect, useState } from 'react';
import { BadgeCheck, Info, ShieldAlert } from 'lucide-react';
import { fmt, signed } from '@/lib/format';
import { describeCondition, fetchSignal, fetchSignals, type LatestSignal, type SignalStats, type SignalTrade, type StrategyDetail, type StrategySummary } from '@/lib/signals';

const pct = (n: number | null | undefined, digits = 2) => (n == null ? '—' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(digits)}%`);
const plain = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toFixed(digits));
const tone = (n: number | null | undefined) => (n == null ? '' : n > 0 ? 'text-up' : n < 0 ? 'text-down' : '');
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const istTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const REASON: Record<string, string> = { stop: 'Stop loss', target: 'Target', signal: 'Exit rule', time: 'Max sessions', open: 'Open' };

/** Signals module: published rule-based strategies, today's signals, and each strategy's full record. */
export function SignalsView({ onOpenChart }: { onOpenChart: (symbol: string) => void }) {
  const [list, setList] = useState<{ strategies: StrategySummary[]; date: string | null; signals: LatestSignal[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<StrategyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSignals().then((r) => { setList(r); setSelected((s) => s ?? r.strategies[0]?.id ?? null); }, (e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!selected) return;
    setDetail(null);
    fetchSignal(selected).then(setDetail, (e: Error) => setError(e.message));
  }, [selected]);

  if (error) return <div className="panel grid place-items-center p-10 text-center"><p className="font-bold">{error}</p><p className="mt-1 text-[13px] text-muted">Is the feed service running?</p></div>;
  if (!list) return <div className="panel grid place-items-center p-10 text-[13px] text-muted">Loading signals…</div>;
  const computing = list.strategies.every((s) => !s.computedFor);

  return (
    <main className="grid min-h-0 grid-cols-[380px_1fr] gap-2">
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <p className="eyebrow">Published strategies</p>
          <p className="mt-0.5 text-[12px] text-muted">Rule-based, on NSE&rsquo;s official end-of-day data. Not investment advice.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.strategies.map((s) => (
            <button key={s.id} type="button" onClick={() => setSelected(s.id)} aria-current={s.id === selected}
              className={`block w-full border-b border-line px-4 py-3 text-left ${s.id === selected ? 'bg-accent-soft' : 'hover:bg-raised'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-bold">{s.name}</span>
                <span className="num text-[11px] text-muted">v{s.version}</span>
              </div>
              {s.problem ? <p className="mt-1 text-[12px] font-semibold text-down">{s.problem}</p> : (
                <div className="num mt-1.5 grid grid-cols-3 gap-2 text-[11.5px]">
                  <span><span className="block text-muted">Win rate</span>{s.backtest ? plain(s.backtest.winRatePct, 0) + '%' : '—'}</span>
                  <span><span className="block text-muted">Avg / trade</span><span className={tone(s.backtest?.avgReturnPct)}>{pct(s.backtest?.avgReturnPct)}</span></span>
                  <span><span className="block text-muted">Open now</span>{s.computedFor ? s.openPositions : '—'}</span>
                </div>
              )}
            </button>
          ))}
        </div>
        <div className="border-t border-line">
          <p className="eyebrow px-4 pt-3">Signals for the next session {list.date && <span className="num normal-case">· after {day(list.date)} close</span>}</p>
          <div className="max-h-[260px] overflow-y-auto px-2 pb-2">
            {!list.signals.length && <p className="px-2 py-3 text-[12.5px] text-muted">{computing ? 'Signals appear once NSE history has finished downloading.' : 'No signals were triggered at the latest close.'}</p>}
            {list.signals.map((g) => (
              <button key={`${g.strategyId}-${g.symbol}-${g.action}`} type="button" onClick={() => onOpenChart(g.symbol)} className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12.5px] hover:bg-raised">
                <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${g.action === 'ENTER' ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>{g.action === 'ENTER' ? 'ENTRY' : 'EXIT'}</span>
                <span className="font-bold">{g.symbol}</span>
                <span className="truncate text-muted">{g.strategy}</span>
                <span className="num ml-auto">{fmt(g.close)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel min-h-0 overflow-y-auto p-5">
        {!detail ? <p className="text-[13px] text-muted">Loading…</p> : <StrategyPanel d={detail} onOpenChart={onOpenChart} />}
      </section>
    </main>
  );
}

/** Terminal side-panel version: the signals for the next session, each opening its chart. */
export function SignalsSide({ onOpenChart, onOpenModule }: { onOpenChart: (symbol: string) => void; onOpenModule: () => void }) {
  const [list, setList] = useState<{ date: string | null; signals: LatestSignal[]; strategies: StrategySummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { fetchSignals().then(setList, (e: Error) => setError(e.message)); }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2.5">
      <div className="flex items-center justify-between px-1">
        <p className="text-[12px] text-muted">{list?.date ? `After the ${day(list.date)} close` : 'Rule-based, end of day'}</p>
        <button type="button" onClick={onOpenModule} className="rounded-full px-2 py-1 text-[12px] font-bold hover:bg-raised">All strategies →</button>
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-2 py-3 text-[12.5px] font-semibold text-down">{error}</p>}
        {list && !list.signals.length && (
          <p className="px-2 py-4 text-center text-[12.5px] text-muted">
            {list.strategies.every((s) => !s.computedFor) ? 'Signals appear once NSE history has finished downloading.' : 'No signals were triggered at the latest close.'}
          </p>
        )}
        {list?.signals.map((g) => (
          <button key={`${g.strategyId}-${g.symbol}-${g.action}`} type="button" onClick={() => onOpenChart(g.symbol)} className="flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12.5px] hover:bg-raised">
            <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-bold ${g.action === 'ENTER' ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>{g.action === 'ENTER' ? 'ENTRY' : 'EXIT'}</span>
            <span className="font-bold">{g.symbol}</span>
            <span className="truncate text-[11.5px] text-muted">{g.strategy}</span>
          </button>
        ))}
      </div>
      <p className="px-1 pt-1 text-[10.5px] text-muted">Research tool. Not investment advice.</p>
    </div>
  );
}

function StrategyPanel({ d, onOpenChart }: { d: StrategyDetail; onOpenChart: (s: string) => void }) {
  const r = d.rules;
  const published = day(d.publishedDay);
  return (
    <div className="space-y-5">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[22px] font-extrabold tracking-[-0.03em]">{d.name}</h2>
          <span className="num rounded-full bg-raised px-2 py-0.5 text-[11.5px] font-semibold">v{d.version} · published {published}</span>
        </div>
        <p className="mt-1 max-w-[760px] text-[13.5px] text-ink-2">{d.description}</p>
      </header>

      {d.problem && <p className="flex items-center gap-2 rounded-[12px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down"><ShieldAlert size={16} /> {d.problem}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        <StatsBlock title="Backtest" note={d.backtest?.from ? `Signals before publishing, ${day(d.backtest.from)} – ${day(d.backtest.to)}` : 'Signals before publishing'} s={d.backtest} />
        <StatsBlock title="Live record" note={`Only signals stored before the session they acted on opened, since ${published}`} s={d.live} live />
      </div>

      <div className="rounded-[14px] bg-raised p-4">
        <p className="text-[13px] font-extrabold">Exact rules</p>
        <ul className="mt-2 space-y-1 text-[13px]">
          <li><b>Enter</b> (next session&rsquo;s open) when {r.entry.match === 'all' ? 'all' : 'any'} of: {r.entry.conditions.map(describeCondition).join('; ')}.</li>
          {r.exit?.conditions.length ? <li><b>Exit</b> (next session&rsquo;s open) when {r.exit.conditions.map(describeCondition).join('; ')}.</li> : null}
          {r.stopLossPct != null && <li><b>Stop loss</b> {r.stopLossPct}% below entry, checked against each session&rsquo;s low (a gap below fills at the open).</li>}
          {r.targetPct != null && <li><b>Target</b> {r.targetPct}% above entry.</li>}
          {r.maxBars != null && <li><b>Time exit</b> after {r.maxBars} sessions.</li>}
          <li><b>Costs</b>: every trade pays delivery (CNC) brokerage, STT, exchange, SEBI, stamp duty, GST and DP charges. Returns are net.</li>
        </ul>
        <p className="num mt-2 text-[11px] break-all text-muted">Rules fingerprint (SHA-256): {d.rulesHash}</p>
      </div>

      <Table title={`Open positions (${d.open.length})`} trades={d.open} onOpenChart={onOpenChart} empty="No open positions." />
      <Table title="Recent signals" trades={d.recent.slice(0, 60)} onOpenChart={onOpenChart} empty="No signals yet." />

      <div>
        <p className="text-[13px] font-extrabold">Issue log</p>
        <p className="text-[12px] text-muted">Every signal as it was stored, with the time it was issued. Rows are never edited or deleted.</p>
        {!d.issues.length ? <p className="mt-2 text-[12.5px] text-muted">Nothing issued yet.</p> : (
          <table className="num mt-2 w-full text-[12.5px]">
            <thead><tr className="text-left text-[11.5px] text-muted"><th className="py-1 font-semibold">Close of</th><th className="font-semibold">Stock</th><th className="font-semibold">Signal</th><th className="text-right font-semibold">Close (as traded)</th><th className="text-right font-semibold">Issued (IST)</th></tr></thead>
            <tbody>{d.issues.slice(0, 50).map((i) => (
              <tr key={`${i.date}-${i.symbol}-${i.action}`} className="border-t border-line">
                <td className="py-1.5">{day(i.date)}</td>
                <td><button type="button" className="font-sans font-bold hover:underline" onClick={() => onOpenChart(i.symbol)}>{i.symbol}</button></td>
                <td className={i.action === 'ENTER' ? 'text-up' : 'text-down'}>{i.action === 'ENTER' ? 'Entry' : 'Exit'}</td>
                <td className="text-right">{fmt(i.close)}</td>
                <td className="text-right">{istTime(i.issuedAt)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <p className="flex gap-2 rounded-[12px] bg-accent-soft px-3 py-2.5 text-[12px] text-accent-ink">
        <Info size={15} className="mt-0.5 shrink-0" />
        Signals are generated automatically from the published rules above, for research and education. My Trading View is not registered with SEBI as an
        investment adviser or research analyst. Backtests and past results do not guarantee future results. Trading involves risk of loss.
      </p>
    </div>
  );
}

function StatsBlock({ title, note, s, live }: { title: string; note: string; s: SignalStats | null; live?: boolean }) {
  const rows: [string, string, string?][] = s ? [
    ['Signals (closed)', `${s.signals} (${s.closed})`],
    ['Win rate', s.winRatePct == null ? '—' : `${s.winRatePct.toFixed(1)}%`],
    ['Average per trade', pct(s.avgReturnPct), tone(s.avgReturnPct)],
    ['Median per trade', pct(s.medianReturnPct), tone(s.medianReturnPct)],
    ['Average win / loss', `${pct(s.avgWinPct)} / ${pct(s.avgLossPct)}`],
    ['Profit factor', plain(s.profitFactor, 2)],
    ['Best / worst trade', `${pct(s.bestPct, 1)} / ${pct(s.worstPct, 1)}`],
    ['Longest losing streak', String(s.maxConsecutiveLosses)],
    ['Average holding', s.avgSessions == null ? '—' : `${s.avgSessions.toFixed(1)} sessions`],
  ] : [];
  return (
    <div className="rounded-[14px] border border-line p-4">
      <p className="flex items-center gap-1.5 text-[13px] font-extrabold">{live && <BadgeCheck size={15} className="text-up" />}{title}</p>
      <p className="text-[11.5px] text-muted">{note}</p>
      {!s ? <p className="mt-3 text-[12.5px] text-muted">Computed once NSE history has finished downloading.</p>
        : live && !s.closed ? <p className="mt-3 text-[12.5px] text-muted">No live signals have closed yet. {s.signals ? `${s.signals} open.` : ''}</p> : (
          <dl className="num mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[12.5px]">
            {rows.map(([k, v, c]) => (<Fragment key={k}><dt className="font-sans text-ink-2">{k}</dt><dd className={`text-right font-semibold ${c ?? ''}`}>{v}</dd></Fragment>))}
          </dl>
        )}
    </div>
  );
}

function Table({ title, trades, onOpenChart, empty }: { title: string; trades: SignalTrade[]; onOpenChart: (s: string) => void; empty: string }) {
  return (
    <div>
      <p className="text-[13px] font-extrabold">{title}</p>
      {!trades.length ? <p className="mt-1 text-[12.5px] text-muted">{empty}</p> : (
        <div className="mt-2 overflow-x-auto">
          <table className="num w-full text-[12.5px]">
            <thead><tr className="text-left text-[11.5px] text-muted">
              <th className="py-1 font-semibold">Stock</th><th className="font-semibold">Signal (close of)</th><th className="text-right font-semibold">Entry</th>
              <th className="text-right font-semibold">Exit / last</th><th className="font-semibold">&nbsp;Exit</th><th className="text-right font-semibold">Net return</th><th className="text-right font-semibold">Record</th>
            </tr></thead>
            <tbody>{trades.map((t) => (
              <tr key={`${t.symbol}-${t.signalDate}`} className="border-t border-line">
                <td className="py-1.5"><button type="button" className="font-sans font-bold hover:underline" onClick={() => onOpenChart(t.symbol)}>{t.symbol}</button></td>
                <td>{day(t.signalDate)}</td>
                <td className="text-right">{fmt(t.entryPrice)}</td>
                <td className="text-right">{fmt(t.exitPrice)}</td>
                <td className="font-sans">&nbsp;{REASON[t.exitReason] ?? t.exitReason}{t.exitDate ? ` · ${day(t.exitDate)}` : ''}</td>
                <td className={`text-right font-semibold ${tone(t.returnPct)}`}>{signed(t.returnPct)}%</td>
                <td className="text-right font-sans">{t.live ? <span className="rounded-full bg-up-soft px-1.5 py-0.5 text-[10.5px] font-bold text-up">Live</span> : <span className="text-[11px] text-muted">Backtest</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
