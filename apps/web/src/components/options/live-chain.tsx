'use client';

import { useEffect, useRef, useState } from 'react';
import { fmt } from '@/lib/format';
import { ChainAccessError, fetchLiveChain, fmtDate, fmtStrike, type Chain } from '@/lib/options';

const oiLakh = (n: number) => (n >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : n.toLocaleString('en-IN'));

/** Compact live option chain for the terminal side panel: refreshes every 2 seconds. */
export function LiveChain({ onOpenModule }: { onOpenModule: () => void }) {
  const [underlying, setUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [expiry, setExpiry] = useState<string | undefined>();
  const [chain, setChain] = useState<(Chain & { asOf: number }) | null>(null);
  const [error, setError] = useState<ChainAccessError | null>(null);
  const atmRef = useRef<HTMLTableRowElement>(null);
  const scrolledFor = useRef('');

  useEffect(() => {
    let stop = false;
    let id: ReturnType<typeof setInterval> | undefined;
    const load = () => fetchLiveChain(underlying, expiry).then(
      (c) => { if (!stop) { setChain(c); setError(null); } },
      (e) => {
        if (stop) return;
        const err = e instanceof ChainAccessError ? e : new ChainAccessError('Live option chain unavailable', 'failed');
        setError(err);
        if (['live_plan_required', 'needs_broker'].includes(err.code)) clearInterval(id); // retrying won't change the answer
      },
    );
    void load();
    id = setInterval(load, 2000);
    return () => { stop = true; clearInterval(id); };
  }, [underlying, expiry]);

  // Centre the ATM strike once per underlying/expiry, not on every refresh.
  useEffect(() => {
    const key = `${chain?.underlying}:${chain?.expiry}`;
    if (chain && scrolledFor.current !== key && atmRef.current) { atmRef.current.scrollIntoView({ block: 'center' }); scrolledFor.current = key; }
  }, [chain]);

  if (error && !chain) {
    return (
      <div className="m-auto max-w-[300px] px-4 text-center">
        <h3 className="text-[15px] font-extrabold tracking-[-0.02em]">Live option chain</h3>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{error.message}</p>
        <button type="button" onClick={onOpenModule} className="mt-3 rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white hover:bg-black">Open end-of-day chain</button>
      </div>
    );
  }
  if (!chain) return <p className="m-auto text-[13px] text-muted">Loading live chain…</p>;

  const spot = chain.spotPaise;
  const ceOi = chain.rows.reduce((s, r) => s + (r.CE?.oi ?? 0), 0), peOi = chain.rows.reduce((s, r) => s + (r.PE?.oi ?? 0), 0);
  const maxOi = Math.max(1, ...chain.rows.flatMap((r) => [r.CE?.oi ?? 0, r.PE?.oi ?? 0]));
  const bar = (oi: number, side: 'CE' | 'PE') => (
    <span className={`absolute inset-y-1 ${side === 'CE' ? 'right-0 bg-down-soft' : 'left-0 bg-up-soft'}`} style={{ width: `${(oi / maxOi) * 100}%` }} aria-hidden="true" />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2.5 pb-2">
      <div className="flex items-center gap-1.5">
        {(['NIFTY', 'BANKNIFTY'] as const).map((u) => (
          <button key={u} type="button" onClick={() => { setUnderlying(u); setExpiry(undefined); }} aria-pressed={u === underlying}
            className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${u === underlying ? 'bg-ink text-white' : 'bg-raised text-ink-2'}`}>{u}</button>
        ))}
        <select className="ml-auto h-7 rounded-full bg-raised px-2 text-[11.5px] font-semibold" value={chain.expiry} aria-label="Expiry" onChange={(e) => setExpiry(e.target.value)}>
          {chain.expiries.slice(0, 8).map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}
        </select>
      </div>
      <div className="num mt-1.5 flex justify-between px-1 text-[11px] text-muted">
        <span>Spot <b className="text-ink">{spot != null ? fmt(spot / 100) : '—'}</b></span>
        <span>PCR <b className="text-ink">{ceOi ? (peOi / ceOi).toFixed(2) : '—'}</b></span>
        <span>Lot <b className="text-ink">{chain.lotSize ?? '—'}</b></span>
        <span className="flex items-center gap-1"><span className="live-dot h-1.5 w-1.5 rounded-full bg-up" />Live</span>
      </div>
      <div className="mt-1 min-h-0 flex-1 overflow-y-auto">
        <table className="num w-full text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-panel text-[10.5px] text-muted">
            <tr><th className="py-1 text-left font-semibold">Call OI</th><th className="text-right font-semibold">LTP</th><th className="text-center font-semibold">Strike</th><th className="text-left font-semibold">LTP</th><th className="text-right font-semibold">Put OI</th></tr>
          </thead>
          <tbody>
            {chain.rows.map((r) => {
              const atm = r.strikePaise === chain.atmStrikePaise;
              const ceItm = spot != null && r.strikePaise < spot, peItm = spot != null && r.strikePaise > spot;
              const chg = (s: typeof r.CE) => (s && s.settlePaise > 0 && s.closePaise > 0 ? (s.closePaise - s.settlePaise) / s.settlePaise * 100 : null);
              const cell = (s: typeof r.CE) => {
                const c = chg(s);
                return s && s.closePaise > 0 ? <>{fmt(s.closePaise / 100)}{c != null && <span className={`block text-[9.5px] ${c >= 0 ? 'text-up' : 'text-down'}`}>{c >= 0 ? '+' : ''}{c.toFixed(1)}%</span>}</> : '—';
              };
              return (
                <tr key={r.strikePaise} ref={atm ? atmRef : undefined} className={`border-t border-line ${atm ? 'bg-accent-soft font-bold' : ''}`}>
                  <td className={`relative py-1 pl-1 text-left ${ceItm ? 'bg-raised' : ''}`}>{r.CE && bar(r.CE.oi, 'CE')}<span className="relative">{r.CE ? oiLakh(r.CE.oi) : '—'}</span></td>
                  <td className={`text-right ${ceItm ? 'bg-raised' : ''}`} title={r.CE?.iv != null ? `IV ${(r.CE.iv * 100).toFixed(1)}% · Δ ${r.CE.delta!.toFixed(2)}` : undefined}>{cell(r.CE)}</td>
                  <td className="px-1 text-center font-bold">{fmtStrike(r.strikePaise)}</td>
                  <td className={`text-left ${peItm ? 'bg-raised' : ''}`} title={r.PE?.iv != null ? `IV ${(r.PE.iv * 100).toFixed(1)}% · Δ ${r.PE.delta!.toFixed(2)}` : undefined}>{cell(r.PE)}</td>
                  <td className={`relative pr-1 text-right ${peItm ? 'bg-raised' : ''}`}>{r.PE && bar(r.PE.oi, 'PE')}<span className="relative">{r.PE ? oiLakh(r.PE.oi) : '—'}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="px-1 pt-1 text-[11px] font-semibold text-down">Refresh failed: {error.message}. Showing the last update.</p>}
    </div>
  );
}
