'use client';

import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { summarise, yearsToExpiry, type Leg } from '@mtv/options';
import { computeOptionCharges, formatRupees, toPaise } from '@mtv/paper';
import { fmt } from '@/lib/format';
import { TEMPLATES, fetchChain, fmtDate, fmtStrike, type BuilderLeg, type Chain, type ChainSide } from '@/lib/options';
import { PayoffChart } from './payoff-chart';

const RATE = 0.065; // matches the feed's model rate; affects estimates only
const STEP: Record<string, number> = { NIFTY: 50_00, BANKNIFTY: 100_00 };
const VISIBLE_STEPS = 14;
let seq = 0;

export function OptionsView() {
  const [underlying, setUnderlying] = useState<'NIFTY' | 'BANKNIFTY'>('NIFTY');
  const [expiry, setExpiry] = useState<string | undefined>();
  const [chain, setChain] = useState<Chain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<BuilderLeg[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchChain(underlying, expiry).then((c) => live && setChain(c), (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [underlying, expiry]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(t); }, [notice]);

  const lot = chain?.lotSize ?? null;
  const side = (strike: number, kind: 'CE' | 'PE'): ChainSide | null => chain?.rows.find((r) => r.strikePaise === strike)?.[kind] ?? null;

  function addLeg(kind: 'CE' | 'PE', s: 'BUY' | 'SELL', strike: number) {
    if (!chain) return;
    if (legs.length && legs.some((l) => l.expiry !== chain.expiry)) return setNotice('All legs must share one expiry. Clear the strategy to switch expiry.');
    const q = side(strike, kind);
    if (!q) return;
    setLegs([...legs, { id: `l${++seq}`, kind, side: s, strikePaise: strike, expiry: chain.expiry, lots: 1, pricePaise: q.closePaise, iv: q.iv }]);
    if (!q.traded) setNotice(`${fmtStrike(strike)} ${kind} did not trade that day: its price is NSE's carried-forward close.`);
  }

  function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t || !chain?.atmStrikePaise) return;
    const out: BuilderLeg[] = [];
    for (const l of t.legs) {
      const strike = chain.atmStrikePaise + l.offset * STEP[underlying];
      const q = side(strike, l.kind);
      if (!q) return setNotice(`${fmtStrike(strike)} ${l.kind} is not listed for this expiry.`);
      out.push({ id: `l${++seq}`, kind: l.kind, side: l.side, strikePaise: strike, expiry: chain.expiry, lots: 1, pricePaise: q.closePaise, iv: q.iv });
    }
    setLegs(out);
  }

  const engineLegs: Leg[] = useMemo(() => (lot ? legs.map((l) => ({ kind: l.kind, side: l.side, strikePaise: l.strikePaise, pricePaise: l.pricePaise, qty: l.lots * lot })) : []), [legs, lot]);
  const summary = useMemo(() => (engineLegs.length ? summarise(engineLegs) : null), [engineLegs]);
  const asOf = chain ? Date.parse(`${chain.date}T15:30:00Z`) / 1000 - 5.5 * 3600 : 0;
  const T = chain ? yearsToExpiry(asOf, chain.expiry) : 0;
  const greeks = useMemo(() => {
    if (!lot || !chain) return null;
    let delta = 0, theta = 0, vega = 0, missing = false;
    for (const l of legs) {
      const q = side(l.strikePaise, l.kind);
      if (q?.delta == null) { missing = true; continue; }
      const sign = (l.side === 'BUY' ? 1 : -1) * l.lots * lot;
      delta += sign * q.delta; theta += sign * q.theta! ; vega += sign * q.vega!;
    }
    return { delta, theta, vega, missing };
  }, [legs, lot, chain]); // eslint-disable-line react-hooks/exhaustive-deps
  const entryCharges = lot ? legs.reduce((s, l) => s + computeOptionCharges({ side: l.side, qty: l.lots * lot, premiumPaise: l.pricePaise }).total, 0) : 0;

  const visible = chain?.atmStrikePaise != null
    ? chain.rows.filter((r) => Math.abs(r.strikePaise - chain.atmStrikePaise!) <= VISIBLE_STEPS * STEP[underlying])
    : chain?.rows ?? [];
  const maxOi = Math.max(1, ...visible.flatMap((r) => [r.CE?.oi ?? 0, r.PE?.oi ?? 0]));
  const spot = chain?.spotPaise ?? null;

  const cell = (q: ChainSide | null, kind: 'CE' | 'PE', strike: number) => {
    if (!q) return <td colSpan={3} className="text-center text-muted">—</td>;
    const itm = spot != null && (kind === 'CE' ? strike < spot : strike > spot);
    const oi = <td className={`relative px-2 text-right ${itm ? 'bg-[#fbf8ee]' : ''}`}><i className={`absolute top-1.5 bottom-1.5 ${kind === 'CE' ? 'right-0' : 'left-0'} rounded-full opacity-30 ${kind === 'CE' ? 'bg-down' : 'bg-up'}`} style={{ width: `${(q.oi / maxOi) * 100}%` }} /><span className="relative">{(q.oi / 1e5).toFixed(1)}L</span></td>;
    const iv = <td className={`px-2 text-right text-muted ${itm ? 'bg-[#fbf8ee]' : ''}`}>{q.iv == null ? '—' : (q.iv * 100).toFixed(1)}</td>;
    const ltp = (
      <td className={`group relative px-2 text-right font-semibold ${itm ? 'bg-[#fbf8ee]' : ''} ${q.traded ? '' : 'text-muted'}`} title={q.traded ? undefined : 'No trades that day: NSE carried the previous close forward'}>
        {fmt(q.closePaise / 100)}{q.traded ? '' : '*'}
        <span className="absolute inset-0.5 hidden gap-0.5 group-hover:flex">
          <button type="button" onClick={() => addLeg(kind, 'BUY', strike)} className="flex-1 rounded-md bg-blue text-[11px] font-bold text-white">B</button>
          <button type="button" onClick={() => addLeg(kind, 'SELL', strike)} className="flex-1 rounded-md bg-down text-[11px] font-bold text-white">S</button>
        </span>
      </td>
    );
    return kind === 'CE' ? <>{oi}{iv}{ltp}</> : <>{ltp}{iv}{oi}</>;
  };

  return (
    <main className="grid min-h-0 grid-cols-[minmax(520px,1fr)_minmax(560px,1.15fr)] gap-2">
      {/* chain */}
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div className="flex rounded-full bg-raised p-[3px]">
            {(['NIFTY', 'BANKNIFTY'] as const).map((u) => (
              <button key={u} type="button" onClick={() => { if (u !== underlying) { setUnderlying(u); setExpiry(undefined); setLegs([]); } }}
                className={`rounded-full px-3 py-1 text-[12.5px] font-bold ${u === underlying ? 'bg-ink text-white' : 'text-ink-2'}`}>{u}</button>
            ))}
          </div>
          {chain && (
            <select className="h-8 rounded-full bg-raised px-3 text-[12.5px] font-semibold" value={chain.expiry} aria-label="Expiry"
              onChange={(e) => { setExpiry(e.target.value); if (legs.length) setNotice('Expiry changed: existing legs keep their own expiry.'); }}>
              {chain.expiries.map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}
            </select>
          )}
          {chain && (
            <span className="ml-auto text-[11.5px] text-muted">
              NSE official close · {fmtDate(chain.date)} · not live
            </span>
          )}
        </div>
        {chain && (
          <div className="grid grid-cols-4 gap-1.5 px-3 py-2 text-[11px]">
            {([['Spot', chain.spotPaise], ['Forward (implied)', chain.forwardPaise], ['ATM', chain.atmStrikePaise]] as const).map(([k, v]) => (
              <div key={k} className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-muted">{k}</p><p className="num text-[13px] font-semibold">{v == null ? '—' : fmt(v / 100)}</p></div>
            ))}
            <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-muted">Lot size</p><p className="num text-[13px] font-semibold">{chain.lotSize ?? '—'}</p></div>
          </div>
        )}
        {error && <p className="m-4 rounded-[10px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}
        <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
          <table className="num w-full text-[12px]">
            <thead className="sticky top-0 bg-panel text-[10.5px] font-bold tracking-[0.05em] text-muted">
              <tr><th className="px-2 py-1.5 text-right">CALL OI</th><th className="px-2 text-right">IV</th><th className="px-2 text-right">CE</th><th className="px-2 text-center">STRIKE</th><th className="px-2 text-right">PE</th><th className="px-2 text-right">IV</th><th className="px-2 text-right">PUT OI</th></tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const atm = r.strikePaise === chain?.atmStrikePaise;
                return (
                  <tr key={r.strikePaise} className={`h-8 border-t border-line ${atm ? 'outline-2 -outline-offset-2 outline-accent' : ''}`}>
                    {cell(r.CE, 'CE', r.strikePaise)}
                    <td className={`px-2 text-center font-semibold ${atm ? 'bg-accent text-accent-ink' : 'bg-raised'}`}>{fmtStrike(r.strikePaise)}</td>
                    {cell(r.PE, 'PE', r.strikePaise)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="border-t border-line px-3 py-1.5 text-[10.5px] text-muted">Hover a price and press B / S to add a leg. * = no trades that day. IV and Greeks are Black-76 estimates from traded premiums.</p>
      </section>

      {/* builder */}
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <h2 className="text-[14px] font-extrabold tracking-[-0.02em]">Strategy builder</h2>
          <select className="ml-auto h-8 rounded-full bg-raised px-3 text-[12.5px] font-semibold" value="" onChange={(e) => applyTemplate(e.target.value)} aria-label="Strategy template">
            <option value="">Add a template…</option>
            {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {legs.length > 0 && <button type="button" onClick={() => setLegs([])} className="rounded-full px-3 py-1 text-[12px] font-semibold text-muted hover:bg-down-soft hover:text-down">Clear</button>}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {!legs.length && <p className="py-10 text-center text-[13px] text-muted">Add legs from the option chain, or pick a template.</p>}
          {legs.length > 0 && (
            <table className="num w-full text-[12.5px]">
              <thead className="text-[10.5px] font-bold tracking-[0.05em] text-muted"><tr><th className="py-1 text-left">SIDE</th><th className="text-left">CONTRACT</th><th className="text-right">LOTS</th><th className="text-right">PRICE</th><th className="text-right">QTY</th><th /></tr></thead>
              <tbody>
                {legs.map((l) => (
                  <tr key={l.id} className="border-t border-line">
                    <td className="py-1.5">
                      <button type="button" onClick={() => setLegs(legs.map((x) => (x.id === l.id ? { ...x, side: x.side === 'BUY' ? 'SELL' : 'BUY' } : x)))}
                        className={`rounded-md px-2 py-0.5 font-sans text-[11px] font-bold text-white ${l.side === 'BUY' ? 'bg-blue' : 'bg-down'}`}>{l.side === 'BUY' ? 'B' : 'S'}</button>
                    </td>
                    <td className="font-sans font-semibold">{underlying} {fmtDate(l.expiry).slice(0, 6)} {fmtStrike(l.strikePaise)} {l.kind}</td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <button type="button" aria-label="Fewer lots" onClick={() => setLegs(legs.map((x) => (x.id === l.id ? { ...x, lots: Math.max(1, x.lots - 1) } : x)))} className="rounded p-0.5 hover:bg-raised"><Minus size={12} /></button>
                        {l.lots}
                        <button type="button" aria-label="More lots" onClick={() => setLegs(legs.map((x) => (x.id === l.id ? { ...x, lots: x.lots + 1 } : x)))} className="rounded p-0.5 hover:bg-raised"><Plus size={12} /></button>
                      </span>
                    </td>
                    <td className="text-right">
                      <input className="num h-7 w-20 rounded-md border border-line px-1.5 text-right" defaultValue={(l.pricePaise / 100).toFixed(2)} aria-label="Price"
                        onBlur={(e) => { try { const p = toPaise(e.target.value); if (p > 0) setLegs(legs.map((x) => (x.id === l.id ? { ...x, pricePaise: p } : x))); } catch { e.target.value = (l.pricePaise / 100).toFixed(2); } }} />
                    </td>
                    <td className="text-right text-muted">{lot ? l.lots * lot : '—'}</td>
                    <td className="text-right"><button type="button" aria-label="Remove leg" onClick={() => setLegs(legs.filter((x) => x.id !== l.id))} className="rounded p-1 text-muted hover:text-down"><Trash2 size={13} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {summary && chain?.spotPaise && (
            <>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  [summary.netPremiumPaise >= 0 ? 'Net credit' : 'Net debit', formatRupees(Math.abs(summary.netPremiumPaise)), ''],
                  ['Max profit', summary.maxProfitPaise == null ? 'Unlimited' : formatRupees(summary.maxProfitPaise), 'text-up'],
                  ['Max loss', summary.maxLossPaise == null ? 'Unlimited' : formatRupees(summary.maxLossPaise), 'text-down'],
                  ['Entry charges', formatRupees(entryCharges), ''],
                ] as const).map(([k, v, c]) => (
                  <div key={k} className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">{k}</p><p className={`num text-[14px] font-semibold ${c}`}>{v}</p></div>
                ))}
              </div>
              <p className="text-[12px] text-ink-2">
                <b>Breakevens:</b>{' '}
                <span className="num">{summary.breakevens.length ? summary.breakevens.map((b) => `${fmt(b / 100)} (${(((b - chain.spotPaise!) / chain.spotPaise!) * 100).toFixed(2)}%)`).join('  ·  ') : 'none'}</span>
              </p>
              <PayoffChart legs={engineLegs} ivs={legs.map((l) => l.iv)} spotPaise={chain.spotPaise} forwardPaise={chain.forwardPaise} yearsLeft={T} rate={RATE} breakevens={summary.breakevens} />
              {greeks && (
                <div className="grid grid-cols-3 gap-1.5 text-[12px]">
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Delta (units)</p><p className="num font-semibold">{greeks.delta.toFixed(1)}</p></div>
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Theta (₹/day)</p><p className={`num font-semibold ${greeks.theta >= 0 ? 'text-up' : 'text-down'}`}>{fmt(greeks.theta)}</p></div>
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Vega (₹ per 1% IV)</p><p className="num font-semibold">{fmt(greeks.vega)}</p></div>
                </div>
              )}
              {greeks?.missing && <p className="text-[11px] text-down">Some legs have no IV (untraded), so Greeks exclude them.</p>}
              <p className="text-[11px] leading-snug text-muted">
                Expiry payoff, max profit/loss and breakevens are exact for these prices. &ldquo;Today&rdquo; curve, IV and Greeks are Black-76 model estimates.
                Margin needs a broker connection (SPAN). Prices are NSE&rsquo;s official close of {fmtDate(chain.date)}, not live quotes.
              </p>
            </>
          )}
        </div>
      </section>
      {notice && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)]">{notice}</div>}
    </main>
  );
}
