'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { legValue, pnlAt, summarise, summariseCurve, summariseNet, yearsToExpiry, type Leg, type ModelLeg } from '@mtv/options';
import { BROKERS, brokerById, computeOptionCharges, expirySettlementCharges, formatRupees, toPaise, type Charges } from '@mtv/paper';
import { fmt } from '@/lib/format';
import { TEMPLATES, fetchChain, fetchMargin, fmtDate, fmtStrike, legGreeks, type BuilderLeg, type Chain, type ChainSide, type MarginResponse } from '@/lib/options';
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
  const chainCache = useRef(new Map<string, Chain>());
  const [brokerId, setBrokerId] = useState('zerodha');
  useEffect(() => { try { setBrokerId(localStorage.getItem('mtv.broker') ?? 'zerodha'); } catch { /* storage unavailable */ } }, []);
  const pickBroker = (id: string) => { setBrokerId(id); try { localStorage.setItem('mtv.broker', id); } catch { /* storage unavailable */ } };
  const broker = brokerById(brokerId);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchChain(underlying, expiry).then((c) => { chainCache.current.set(`${c.underlying}|${c.expiry}`, c); if (live) setChain(c); }, (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [underlying, expiry]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(t); }, [notice]);

  const lot = chain?.lotSize ?? null;
  const side = (strike: number, kind: 'CE' | 'PE'): ChainSide | null => chain?.rows.find((r) => r.strikePaise === strike)?.[kind] ?? null;

  function addLeg(kind: 'CE' | 'PE', s: 'BUY' | 'SELL', strike: number) {
    if (!chain) return;
    const q = side(strike, kind);
    if (!q) return;
    const same = legs.find((l) => l.kind === kind && l.side === s && l.strikePaise === strike && l.expiry === chain.expiry);
    if (same) setLegs(legs.map((l) => (l.id === same.id ? { ...l, lots: l.lots + 1 } : l)));
    else setLegs([...legs, { id: `l${++seq}`, kind, side: s, strikePaise: strike, expiry: chain.expiry, lots: 1, pricePaise: q.closePaise, iv: q.iv, greeks: legGreeks(q) }]);
    if (!q.traded) setNotice(`${fmtStrike(strike)} ${kind} did not trade that day: its price is NSE's carried-forward close.`);
  }

  /** Undo from the chain: one lot less on the most recently added leg of this contract; the leg goes at zero lots. */
  function removeLot(kind: 'CE' | 'PE', strike: number) {
    const leg = [...legs].reverse().find((l) => l.kind === kind && l.strikePaise === strike && l.expiry === chain?.expiry);
    if (!leg) return;
    setLegs(leg.lots > 1 ? legs.map((l) => (l.id === leg.id ? { ...l, lots: l.lots - 1 } : l)) : legs.filter((l) => l.id !== leg.id));
  }

  /** Moves a leg one strike step up or down within its own expiry, repricing it from that expiry's chain. */
  async function shiftStrike(id: string, dir: 1 | -1) {
    const l = legs.find((x) => x.id === id);
    if (!l) return;
    const key = `${underlying}|${l.expiry}`;
    let c = chainCache.current.get(key);
    if (!c) {
      try { c = await fetchChain(underlying, l.expiry); chainCache.current.set(key, c); } catch { return setNotice(`Could not load the ${fmtDate(l.expiry)} chain.`); }
    }
    const strike = l.strikePaise + dir * STEP[underlying];
    const q = c.rows.find((r) => r.strikePaise === strike)?.[l.kind];
    if (!q) return setNotice(`${fmtStrike(strike)} ${l.kind} is not listed for ${fmtDate(l.expiry)}.`);
    setLegs((list) => list.map((x) => (x.id === id ? { ...x, strikePaise: strike, pricePaise: q.closePaise, iv: q.iv, greeks: legGreeks(q) } : x)));
    if (!q.traded) setNotice(`${fmtStrike(strike)} ${l.kind} did not trade that day: its price is NSE's carried-forward close.`);
  }

  async function applyTemplate(id: string) {
    const t = TEMPLATES.find((x) => x.id === id);
    if (!t || !chain?.atmStrikePaise) return;
    const at = chain.expiries.indexOf(chain.expiry);
    const chains = new Map<number, Chain>([[0, chain]]);
    const out: BuilderLeg[] = [];
    for (const l of t.legs) {
      const off = l.expiryOffset ?? 0;
      if (!chains.has(off)) {
        const exp = chain.expiries[at + off];
        if (!exp) return setNotice('No later expiry is listed for this template.');
        try { chains.set(off, await fetchChain(underlying, exp)); } catch { return setNotice(`Could not load the ${fmtDate(exp)} chain.`); }
      }
      const c = chains.get(off)!;
      const strike = chain.atmStrikePaise + l.offset * STEP[underlying];
      const q = c.rows.find((r) => r.strikePaise === strike)?.[l.kind];
      if (!q) return setNotice(`${fmtStrike(strike)} ${l.kind} is not listed for ${fmtDate(c.expiry)}.`);
      out.push({ id: `l${++seq}`, kind: l.kind, side: l.side, strikePaise: strike, expiry: c.expiry, lots: 1, pricePaise: q.closePaise, iv: q.iv, greeks: legGreeks(q) });
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
      if (!l.greeks) { missing = true; continue; }
      const sign = (l.side === 'BUY' ? 1 : -1) * l.lots * lot;
      delta += sign * l.greeks.delta; theta += sign * l.greeks.theta; vega += sign * l.greeks.vega;
    }
    return { delta, theta, vega, missing };
  }, [legs, lot, chain]);
  // Charges at today's rates for the chosen broker. Exit = squaring off every leg at these same prices.
  const charges = useMemo(() => {
    const zero: Charges = { brokerage: 0, stt: 0, exchangeTxn: 0, ipft: 0, sebiFee: 0, stampDuty: 0, gst: 0, dpCharge: 0, total: 0 };
    const add = (a: Charges, b: Charges): Charges => ({ brokerage: a.brokerage + b.brokerage, stt: a.stt + b.stt, exchangeTxn: a.exchangeTxn + b.exchangeTxn, ipft: (a.ipft ?? 0) + (b.ipft ?? 0), sebiFee: a.sebiFee + b.sebiFee, stampDuty: a.stampDuty + b.stampDuty, gst: a.gst + b.gst, dpCharge: 0, total: a.total + b.total });
    let entry = zero, exit = zero;
    if (lot) for (const l of legs) {
      entry = add(entry, computeOptionCharges({ side: l.side, qty: l.lots * lot, premiumPaise: l.pricePaise, broker }));
      exit = add(exit, computeOptionCharges({ side: l.side === 'BUY' ? 'SELL' : 'BUY', qty: l.lots * lot, premiumPaise: l.pricePaise, broker }));
    }
    return { entry, exit };
  }, [legs, lot, broker]);
  const entryCharges = charges.entry.total;
  // Held to expiry: entry charges, then exercise STT on long ITM options and any exercise/assignment brokerage.
  const net = useMemo(() => (engineLegs.length
    ? summariseNet(engineLegs, entryCharges, (l, S) => (l.kind === 'FUT' ? 0 : expirySettlementCharges({ side: l.side, qty: l.qty, intrinsicPaise: Math.max(0, l.kind === 'CE' ? S - l.strikePaise : l.strikePaise - S), broker })))
    : null), [engineLegs, entryCharges, broker]);

  // Calendars and diagonals: legs in more than one expiry. "At expiry" becomes the P&L when the first expiry settles,
  // with later legs valued by Black-76 on their own IV: a model estimate, over spot ±25%.
  const expiries = useMemo(() => [...new Set(legs.map((l) => l.expiry))].sort(), [legs]);
  const multi = expiries.length > 1;
  const carry = chain?.forwardPaise && chain.spotPaise && T > 0 ? Math.log(chain.forwardPaise / chain.spotPaise) / T : RATE;
  const tFirst = chain && expiries.length ? yearsToExpiry(asOf, expiries[0]) : 0;
  const modelLegs: ModelLeg[] = useMemo(() => (lot && chain
    ? legs.map((l) => ({ kind: l.kind, side: l.side, strikePaise: l.strikePaise, pricePaise: l.pricePaise, qty: l.lots * lot, iv: l.iv, years: yearsToExpiry(asOf, l.expiry) }))
    : []), [legs, lot, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const multiOutcome = useMemo(() => {
    if (!multi || !chain?.spotPaise) return null;
    const S0 = chain.spotPaise;
    if (pnlAt(modelLegs, S0, tFirst, RATE, carry) == null) return { missingIv: true as const };
    const gross = (S: number) => pnlAt(modelLegs, S, tFirst, RATE, carry)!;
    // Charges: entry, settlement of the first-expiry legs, then squaring off later legs at their model value.
    const later = (S: number) => modelLegs.reduce((sum, l, i) => sum + (legs[i].expiry === expiries[0]
      ? expirySettlementCharges({ side: l.side, qty: l.qty, intrinsicPaise: Math.max(0, l.kind === 'CE' ? S - l.strikePaise : l.strikePaise - S), broker })
      : computeOptionCharges({ side: l.side === 'BUY' ? 'SELL' : 'BUY', qty: l.qty, premiumPaise: Math.round(legValue(l, S, tFirst, RATE, carry)!), broker }).total), 0);
    const lo = Math.round(S0 * 0.75), hi = Math.round(S0 * 1.25);
    return { missingIv: false as const, gross: summariseCurve(gross, lo, hi, 100), net: summariseCurve((S) => gross(S) - entryCharges - later(S), lo, hi, 100) };
  }, [multi, chain, modelLegs, tFirst, carry, legs, expiries, entryCharges, broker]);

  // Margin: SPAN from NSE's start-of-day file + exposure margin, computed by the feed.
  const [margin, setMargin] = useState<{ data: MarginResponse | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  useEffect(() => {
    if (!lot || !legs.length || !chain?.spotPaise) { setMargin({ data: null, error: null, loading: false }); return; }
    const ctl = new AbortController();
    setMargin((m) => ({ ...m, loading: true }));
    const t = setTimeout(() => {
      fetchMargin(underlying, chain.spotPaise!, legs.map((l) => ({ kind: l.kind, expiry: l.expiry, strikePaise: l.strikePaise, qty: (l.side === 'BUY' ? 1 : -1) * l.lots * lot, pricePaise: l.pricePaise })), ctl.signal)
        .then((data) => setMargin({ data, error: null, loading: false }), (e: Error) => { if (e.name !== 'AbortError') setMargin({ data: null, error: e.message, loading: false }); });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [legs, lot, underlying, chain?.spotPaise]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = margin.data;

  const visible = chain?.atmStrikePaise != null
    ? chain.rows.filter((r) => Math.abs(r.strikePaise - chain.atmStrikePaise!) <= VISIBLE_STEPS * STEP[underlying])
    : chain?.rows ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current, row = el?.querySelector<HTMLElement>('[data-spot-row]');
    if (el && row) el.scrollTop = row.offsetTop - el.clientHeight / 2;
  }, [chain]);
  const maxOi = Math.max(1, ...visible.flatMap((r) => [r.CE?.oi ?? 0, r.PE?.oi ?? 0]));
  const spot = chain?.spotPaise ?? null;

  const cell = (q: ChainSide | null, kind: 'CE' | 'PE', strike: number) => {
    if (!q) return <td colSpan={3} className="text-center text-muted">—</td>;
    const itm = spot != null && (kind === 'CE' ? strike < spot : strike > spot);
    const oi = <td className={`relative px-2 text-right ${itm ? 'bg-[#fbf8ee]' : ''}`}><i className={`absolute top-1.5 bottom-1.5 ${kind === 'CE' ? 'right-0' : 'left-0'} rounded-full opacity-30 ${kind === 'CE' ? 'bg-down' : 'bg-up'}`} style={{ width: `${(q.oi / maxOi) * 100}%` }} /><span className="relative">{(q.oi / 1e5).toFixed(1)}L</span></td>;
    const iv = <td className={`px-2 text-right text-muted ${itm ? 'bg-[#fbf8ee]' : ''}`}>{q.iv == null ? '—' : (q.iv * 100).toFixed(1)}</td>;
    // Legs already in the strategy at this strike: net lots, + bought, − sold.
    const held = legs.filter((l) => l.kind === kind && l.strikePaise === strike && l.expiry === chain?.expiry);
    const net = held.reduce((s, l) => s + (l.side === 'BUY' ? l.lots : -l.lots), 0);
    const tint = !held.length ? (itm ? 'bg-[#fbf8ee]' : '') : net > 0 ? 'bg-blue/10 ring-2 ring-inset ring-blue' : net < 0 ? 'bg-down/10 ring-2 ring-inset ring-down' : 'bg-raised ring-2 ring-inset ring-muted';
    const ltp = (
      <td className={`group relative px-2 text-right font-semibold ${tint} ${q.traded ? '' : 'text-muted'}`} title={q.traded ? undefined : 'No trades that day: NSE carried the previous close forward'}>
        {held.length > 0 && (
          <span className={`absolute top-1/2 left-1 -translate-y-1/2 rounded px-1 text-[10px] leading-4 font-bold text-white ${net > 0 ? 'bg-blue' : net < 0 ? 'bg-down' : 'bg-muted'}`}
            title={held.map((l) => `${l.side === 'BUY' ? 'Bought' : 'Sold'} ${l.lots} lot${l.lots > 1 ? 's' : ''} @ ${fmt(l.pricePaise / 100)}`).join(', ')}>
            {net > 0 ? `BUY ${net}` : net < 0 ? `SELL ${-net}` : 'BUY+SELL'}
          </span>
        )}
        {fmt(q.closePaise / 100)}{q.traded ? '' : '*'}
        <span className="absolute inset-0.5 hidden gap-0.5 group-hover:flex">
          <button type="button" onClick={() => addLeg(kind, 'BUY', strike)} className="flex-1 rounded-md bg-blue text-[11px] font-bold text-white">B</button>
          <button type="button" onClick={() => addLeg(kind, 'SELL', strike)} className="flex-1 rounded-md bg-down text-[11px] font-bold text-white">S</button>
          {held.length > 0 && (
            <button type="button" onClick={() => removeLot(kind, strike)} aria-label={`Remove one lot of ${fmtStrike(strike)} ${kind}`}
              title={`Remove one lot (${held.at(-1)!.side === 'BUY' ? 'buy' : 'sell'} leg)`} className="flex-1 rounded-md bg-ink text-[13px] leading-none font-bold text-white">−</button>
          )}
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
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
          <table className="num w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-panel shadow-[0_1px_0_var(--color-line)] text-[10.5px] font-bold tracking-[0.05em] text-muted">
              <tr><th className="px-2 py-1.5 text-right">CALL OI</th><th className="px-2 text-right">IV</th><th className="px-2 text-right">CE</th><th className="px-2 text-center">STRIKE</th><th className="px-2 text-right">PE</th><th className="px-2 text-right">IV</th><th className="px-2 text-right">PUT OI</th></tr>
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const atm = r.strikePaise === chain?.atmStrikePaise;
                const spotHere = spot != null && r.strikePaise > spot && (i === 0 || visible[i - 1].strikePaise <= spot);
                return (
                  <Fragment key={r.strikePaise}>
                  {spotHere && (
                    <tr aria-label={`Spot ${fmt(spot / 100)}`} data-spot-row>
                      <td colSpan={7} className="relative h-[20px] p-0">
                        <span className="absolute inset-x-0 top-1/2 z-[1] h-0.5 -translate-y-1/2 bg-accent" />
                        <span className="absolute top-1/2 left-1/2 z-[2] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent px-2.5 py-0.5 text-[10.5px] font-bold text-accent-ink">Spot {fmt(spot / 100)}</span>
                      </td>
                    </tr>
                  )}
                  <tr className="h-8 border-t border-line">
                    {cell(r.CE, 'CE', r.strikePaise)}
                    <td className={`px-2 text-center font-semibold ${atm ? 'bg-accent-soft font-extrabold text-ink' : 'bg-raised'}`} title={atm ? 'At the money: the strike nearest the forward price' : undefined}>
                      {legs.some((l) => l.strikePaise === r.strikePaise && l.expiry === chain?.expiry) && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-ink align-[2px]" aria-label="In strategy" />}
                      {fmtStrike(r.strikePaise)}
                    </td>
                    {cell(r.PE, 'PE', r.strikePaise)}
                  </tr>
                  </Fragment>
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
          <select className="ml-auto h-8 rounded-full bg-raised px-3 text-[12.5px] font-semibold" value={broker.id} onChange={(e) => pickBroker(e.target.value)} aria-label="Broker for charges" title="Brokerage schedule used for charges">
            {BROKERS.map((b) => <option key={b.id} value={b.id}>{b.name} charges</option>)}
          </select>
          <select className="h-8 w-44 rounded-full bg-raised px-3 text-[12.5px] font-semibold" value="" onChange={(e) => void applyTemplate(e.target.value)} aria-label="Strategy template">
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
                    <td className="font-sans font-semibold">
                      <span className="inline-flex items-center gap-1">
                        {underlying} {fmtDate(l.expiry).slice(0, 6)}
                        <span className="inline-flex items-center rounded-md border border-line">
                          <button type="button" aria-label="Lower strike" title={`Strike − ${fmtStrike(STEP[underlying])}`} onClick={() => void shiftStrike(l.id, -1)} className="rounded-l-md px-1 py-0.5 hover:bg-raised"><Minus size={11} /></button>
                          <span className="num min-w-[46px] px-0.5 text-center">{fmtStrike(l.strikePaise)}</span>
                          <button type="button" aria-label="Higher strike" title={`Strike + ${fmtStrike(STEP[underlying])}`} onClick={() => void shiftStrike(l.id, 1)} className="rounded-r-md px-1 py-0.5 hover:bg-raised"><Plus size={11} /></button>
                        </span>
                        {l.kind}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1">
                        <button type="button" aria-label="Fewer lots" onClick={() => setLegs(legs.map((x) => (x.id === l.id ? { ...x, lots: Math.max(1, x.lots - 1) } : x)))} className="rounded p-0.5 hover:bg-raised"><Minus size={12} /></button>
                        {l.lots}
                        <button type="button" aria-label="More lots" onClick={() => setLegs(legs.map((x) => (x.id === l.id ? { ...x, lots: x.lots + 1 } : x)))} className="rounded p-0.5 hover:bg-raised"><Plus size={12} /></button>
                      </span>
                    </td>
                    <td className="text-right">
                      <input key={`${l.strikePaise}|${l.pricePaise}`} className="num h-7 w-20 rounded-md border border-line px-1.5 text-right" defaultValue={(l.pricePaise / 100).toFixed(2)} aria-label="Price"
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
                  ...(multi
                    ? [
                        ['Max profit (est.)', multiOutcome && !multiOutcome.missingIv ? formatRupees(multiOutcome.net.maxProfitPaise) : '—', 'text-up', multiOutcome && !multiOutcome.missingIv ? `${formatRupees(multiOutcome.gross.maxProfitPaise)} before charges` : 'needs IV for every leg'],
                        ['Max loss (est.)', multiOutcome && !multiOutcome.missingIv ? formatRupees(multiOutcome.net.maxLossPaise) : '—', 'text-down', 'at first expiry, spot ±25%'],
                      ] as const
                    : [
                        ['Max profit', net?.maxProfitPaise == null ? 'Unlimited' : formatRupees(net.maxProfitPaise), 'text-up', summary.maxProfitPaise == null ? '' : `${formatRupees(summary.maxProfitPaise)} before charges`],
                        ['Max loss', net?.maxLossPaise == null ? 'Unlimited' : formatRupees(net.maxLossPaise), 'text-down', summary.maxLossPaise == null ? '' : `${formatRupees(summary.maxLossPaise)} before charges`],
                      ] as const),
                  ['Charges, round trip', formatRupees(charges.entry.total + charges.exit.total), '', `entry ${formatRupees(charges.entry.total)} + exit ${formatRupees(charges.exit.total)}`],
                ] as const).map(([k, v, c, sub]) => (
                  <div key={k} className="rounded-[10px] bg-raised px-2.5 py-1.5">
                    <p className="text-[11px] text-muted">{k}</p><p className={`num text-[14px] font-semibold ${c}`}>{v}</p>
                    {sub && <p className="num text-[10.5px] text-muted">{sub}</p>}
                  </div>
                ))}
              </div>
              {(() => {
                if (!m && !margin.loading && !margin.error) return null;
                return (
                  <div className="grid grid-cols-3 gap-1.5">
                    {margin.error && <p className="col-span-3 rounded-[10px] bg-down-soft px-2.5 py-1.5 text-[12px] font-semibold text-down">Margin: {margin.error}</p>}
                    {!margin.error && ([
                      ['Margin needed', m ? formatRupees(m.marginPaise) : '…', m ? `SPAN ${formatRupees(m.spanPaise)} + exposure ${formatRupees(m.exposurePaise)}` : 'calculating'],
                      ['Funds needed', m ? formatRupees(m.fundsPaise) : '…', m ? (m.premiumPaise >= 0 ? `margin + premium paid ${formatRupees(m.premiumPaise)}` : `margin − premium received ${formatRupees(-m.premiumPaise)}`) : ''],
                      ['Hedge benefit', m ? formatRupees(m.hedgeBenefitPaise) : '…', m ? `legs alone need ${formatRupees(m.withoutHedgePaise)}` : ''],
                    ] as const).map(([k, v, sub]) => (
                      <div key={k} className={`rounded-[10px] px-2.5 py-1.5 ${k === 'Hedge benefit' && m && m.hedgeBenefitPaise > 0 ? 'bg-up-soft' : 'bg-raised'}`}>
                        <p className="text-[11px] text-muted">{k}</p><p className={`num text-[14px] font-semibold ${k === 'Hedge benefit' && m && m.hedgeBenefitPaise > 0 ? 'text-up' : ''}`}>{v}</p>
                        <p className="num text-[10.5px] text-muted">{sub}</p>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {m && m.missing.length > 0 && <p className="text-[11px] text-down">{m.missing.length} contract(s) are not in today&rsquo;s NSE margin file (expired or not listed), so the margin leaves them out.</p>}
              {multi ? (
                <p className="text-[12px] text-ink-2">
                  <b>Breakevens at first expiry ({fmtDate(expiries[0])}), est.:</b>{' '}
                  <span className="num">{multiOutcome && !multiOutcome.missingIv ? (multiOutcome.net.breakevens.length ? multiOutcome.net.breakevens.map((b) => `${fmt(b / 100)} (${(((b - chain.spotPaise!) / chain.spotPaise!) * 100).toFixed(2)}%)`).join('  ·  ') : 'none in spot ±25%') : 'needs IV for every leg'}</span>
                </p>
              ) : (
              <p className="text-[12px] text-ink-2">
                <b>Breakevens after charges:</b>{' '}
                <span className="num">{net?.breakevens.length ? net.breakevens.map((b) => `${fmt(b / 100)} (${(((b - chain.spotPaise!) / chain.spotPaise!) * 100).toFixed(2)}%)`).join('  ·  ') : 'none'}</span>
                <span className="num text-muted">{'  '}· before charges {summary.breakevens.length ? summary.breakevens.map((b) => fmt(b / 100)).join(', ') : 'none'}</span>
              </p>
              )}
              {!multi && net?.chargesGrow && (
                <p className="text-[11.5px] text-ink-2">
                  Held to expiry {[net.chargesGrow.above && `above ${fmtStrike(net.chargesGrow.above.strikePaise)}`, net.chargesGrow.below && `below ${fmtStrike(net.chargesGrow.below.strikePaise)}`].filter(Boolean).join(' or ')},
                  {' '}exercise STT on the long leg adds about {formatRupees(Math.round((net.chargesGrow.above ?? net.chargesGrow.below)!.chargeSlope * 100 * 100))} per 100 points the index moves further; max loss above is at the outer strike. Squaring off before expiry avoids it.
                </p>
              )}
              <details className="rounded-[10px] border border-line px-2.5 py-1.5 text-[12px]">
                <summary className="cursor-pointer font-semibold">Charges breakdown · {broker.name} · rates in force today</summary>
                <table className="num mt-1.5 w-full">
                  <thead className="text-[10.5px] font-bold tracking-[0.05em] text-muted"><tr><th className="text-left">CHARGE</th><th className="text-right">ENTRY</th><th className="text-right">EXIT</th><th className="text-right">TOTAL</th></tr></thead>
                  <tbody>
                    {([['Brokerage', 'brokerage'], ['STT', 'stt'], ['Exchange transaction', 'exchangeTxn'], ['NSE IPFT', 'ipft'], ['SEBI fee', 'sebiFee'], ['Stamp duty', 'stampDuty'], ['GST (18%)', 'gst'], ['Total', 'total']] as const).map(([label, k]) => (
                      <tr key={k} className={`border-t border-line ${k === 'total' ? 'font-bold' : ''}`}>
                        <td className="py-1 font-sans">{label}</td>
                        <td className="text-right">{formatRupees(charges.entry[k] ?? 0)}</td>
                        <td className="text-right">{formatRupees(charges.exit[k] ?? 0)}</td>
                        <td className="text-right">{formatRupees((charges.entry[k] ?? 0) + (charges.exit[k] ?? 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1.5 text-[11px] leading-snug text-muted">
                  Exit assumes every leg is squared off at the prices above. Held to expiry instead, long in-the-money options pay STT of 0.15% of intrinsic value
                  {broker.exerciseBrokerage ? ` and ${broker.name} charges ₹20 + GST brokerage on each exercised or assigned leg` : ''}; max profit, max loss and breakevens above include this.
                  {' '}Brokerage per <a className="underline" href={broker.source} target="_blank" rel="noreferrer">{broker.name}&rsquo;s published schedule</a>.
                </p>
              </details>
              <PayoffChart legs={modelLegs} spotPaise={chain.spotPaise} rate={RATE} carry={carry} atYears={tFirst} exact={!multi} atLabel={fmtDate(expiries[0] ?? chain.expiry)}
                breakevens={multi ? (multiOutcome && !multiOutcome.missingIv ? multiOutcome.gross.breakevens : []) : summary.breakevens} />
              {greeks && (
                <div className="grid grid-cols-3 gap-1.5 text-[12px]">
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Delta (units)</p><p className="num font-semibold">{greeks.delta.toFixed(1)}</p></div>
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Theta (₹/day)</p><p className={`num font-semibold ${greeks.theta >= 0 ? 'text-up' : 'text-down'}`}>{fmt(greeks.theta)}</p></div>
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Vega (₹ per 1% IV)</p><p className="num font-semibold">{fmt(greeks.vega)}</p></div>
                </div>
              )}
              {greeks?.missing && <p className="text-[11px] text-down">Some legs have no IV (untraded), so Greeks exclude them.</p>}
              <p className="text-[11px] leading-snug text-muted">
                {multi
                  ? <>Legs span more than one expiry: max profit/loss and breakevens are estimates at the first expiry, with later legs valued by Black-76 on their own IV, after charges (later legs squared off).</>
                  : <>Max profit/loss and breakevens are for holding to expiry, after charges, and are exact for these prices.</>}
                {' '}&ldquo;Today&rdquo; curve, IV and Greeks are Black-76 model estimates. Prices are NSE&rsquo;s official close of {fmtDate(chain.date)}, not live quotes.
                {m && <> Margin: SPAN computed with NSE Clearing&rsquo;s method from its official start-of-day risk parameter file ({m.file}), plus NSE&rsquo;s exposure margin of 2% of notional on short options and futures (4% on a short option&rsquo;s expiry day). This is the exchange minimum; a broker may block more.</>}
                {' '}Templates illustrate option structures; they are not recommendations. A calculator for your own analysis, not investment advice.
              </p>
            </>
          )}
        </div>
      </section>
      {notice && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-white shadow-[var(--shadow-pop)]">{notice}</div>}
    </main>
  );
}
