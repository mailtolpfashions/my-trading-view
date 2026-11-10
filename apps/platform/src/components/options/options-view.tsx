'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { legValue, pnlAt, summarise, summariseCurve, summariseNet, yearsToExpiry, type Leg, type ModelLeg } from '@mtv/options';
import { BROKERS, brokerById, computeFuturesCharges, computeOptionCharges, expirySettlementCharges, formatRupees, toPaise, type Charges } from '@mtv/paper';
import { fmt } from '@/lib/format';
import { TEMPLATES, TEMPLATE_GROUPS, buildSmile, fetchChain, fetchFnoRange, fetchMargin, fmtDate, fmtStrike, legGreeks, type BuilderLeg, type Chain, type ChainSide, type MarginResponse } from '@/lib/options';
import { PayoffChart } from './payoff-chart';
import { WhatIf, type WhatIfState } from './what-if';
import { Simulator, type SimDayLink } from './simulator';
import { TemplateGallery } from './template-gallery';
import { SavedPositions, type SavedPosition } from './saved-positions';
import { InfoTip } from '@/components/info-tip';
import { SPOT_VOL_FIT } from '@mtv/options';
import { UnderlyingPicker } from '@/components/tools/controls';
import { useShell } from '@/components/app/shell-context';
import { confirmDialog } from '@/components/dialog';
import { labApi } from '@/lib/tradelab';
import { TradingDatePicker } from '@/components/tools/trading-date-picker';

const RATE = 0.065; // matches the feed's model rate; affects estimates only
/** Charges for one trade of a leg: futures rates for a future, option rates (on the premium) for an option. */
const legCharges = (l: { kind: BuilderLeg['kind']; side: 'BUY' | 'SELL' }, side: 'BUY' | 'SELL', qty: number, pricePaise: number, broker: ReturnType<typeof brokerById>) =>
  l.kind === 'FUT' ? computeFuturesCharges({ side, qty, pricePaise, broker }) : computeOptionCharges({ side, qty, premiumPaise: pricePaise, broker });
const VISIBLE_STEPS = 14;
let seq = 0;

export function OptionsView() {
  const [underlying, setUnderlying] = useState('NIFTY');
  // What the chain shows beside the premiums: open interest, its change, or the Greeks.
  const [oiView, setOiView] = useState<'oi' | 'change' | 'greeks'>('oi');
  const [allStrikes, setAllStrikes] = useState(false);
  const greeksView = oiView === 'greeks';
  const [expiry, setExpiry] = useState<string | undefined>();
  // "As of": a past trading day to build on (the simulator follows it from there); undefined = the latest day.
  const [asOfDate, setAsOfDate] = useState<string | undefined>();
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null });
  useEffect(() => { fetchFnoRange().then(setRange, () => undefined); }, []);
  const [chain, setChain] = useState<Chain | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [legs, setLegs] = useState<BuilderLeg[]>([]);
  // The template that produced the current legs; shown as selected until the legs change.
  const [template, setTemplate] = useState<{ id: string; legs: BuilderLeg[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { notify } = useShell();
  /** The right-hand panel: the strategy builder, or the simulator (a position built on a past day, followed to expiry). */
  const [panel, setPanel] = useState<'builder' | 'simulator'>('builder');
  const chainCache = useRef(new Map<string, Chain>());
  /** Restores a saved position: its underlying, its day (prices are per day) and its legs. */
  function loadSaved(p: SavedPosition) {
    chainCache.current.clear();
    setUnderlying(p.underlying);
    setAsOfDate(p.date);
    setExpiry(p.legs[0]?.expiry);
    setLegs(p.legs.map((l) => ({ ...l, id: `l${++seq}` })));
    setTemplate(null);
    setNotice(`Loaded ${p.name}`);
  }
  const [brokerId, setBrokerId] = useState('zerodha');
  useEffect(() => { try { setBrokerId(localStorage.getItem('mtv.broker') ?? 'zerodha'); } catch { /* storage unavailable */ } }, []);
  const pickBroker = (id: string) => { setBrokerId(id); try { localStorage.setItem('mtv.broker', id); } catch { /* storage unavailable */ } };
  const broker = brokerById(brokerId);

  useEffect(() => {
    let live = true;
    setError(null);
    fetchChain(underlying, expiry, asOfDate).then((c) => { chainCache.current.set(`${c.underlying}|${c.expiry}`, c); if (live) setChain(c); }, (e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [underlying, expiry, asOfDate]);

  /** Moves the whole builder to another day: legs priced on one day can't be mixed with another day's chain. */
  function pickDate(d: string | undefined) {
    if (d === asOfDate) return;
    chainCache.current.clear();
    setAsOfDate(d); setExpiry(undefined);
    if (legs.length) { setLegs([]); setNotice('Date changed: legs cleared, since prices are per day.'); }
  }
  const past = !!(chain && range.to && chain.date < range.to);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(t); }, [notice]);

  const lot = chain?.lotSize ?? null;
  /** Strike interval near the money, from the strikes NSE lists for this chain. */
  const step = chain?.strikeStepPaise ?? 0;
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

  /** Buys or sells one lot of a future (an expiry listed that day) at NSE's close; more lots go on the same leg. */
  function addFuture(s: 'BUY' | 'SELL', expiry: string) {
    const f = chain?.futures?.find((x) => x.expiry === expiry);
    if (!f) return;
    const same = legs.find((l) => l.kind === 'FUT' && l.side === s && l.expiry === expiry);
    if (same) setLegs(legs.map((l) => (l.id === same.id ? { ...l, lots: l.lots + 1 } : l)));
    else setLegs([...legs, { id: `l${++seq}`, kind: 'FUT', side: s, strikePaise: 0, expiry, lots: 1, pricePaise: f.closePaise, iv: null, greeks: { delta: 1, theta: 0, vega: 0 } }]);
    if (!f.traded) setNotice(`The ${fmtDate(expiry)} future did not trade that day: its price is NSE's carried-forward close.`);
  }

  /** Places every leg in Trade lab (paper) at market: live bid/ask, overnight (NRML), each leg's lots. */
  async function tradeInLab() {
    const ok = await confirmDialog({
      title: `Paper trade ${legs.length} leg${legs.length > 1 ? 's' : ''} in Trade lab?`,
      message: `${legs.map((l) => `${l.side === 'BUY' ? 'Buy' : 'Sell'} ${l.lots} lot${l.lots > 1 ? 's' : ''} ${underlying} ${fmtDate(l.expiry).slice(0, 6)} ${l.kind === 'FUT' ? 'FUT' : `${fmtStrike(l.strikePaise)} ${l.kind}`}`).join(' · ')}. Each leg is placed at market on live prices (bid / ask), not at the prices shown here. Paper only: nothing goes to a broker.`,
      confirmLabel: 'Place in Trade lab',
    });
    if (!ok) return;
    const done: string[] = [], failed: string[] = [];
    for (const l of legs) {
      const name = `${l.kind === 'FUT' ? 'FUT' : `${fmtStrike(l.strikePaise)} ${l.kind}`}`;
      try {
        const c = await labApi.contracts(underlying, l.kind === 'FUT' ? undefined : l.expiry, 40);
        const row = l.kind === 'FUT' ? c.futures.find((f) => f.expiry === l.expiry) : c.strikes.find((r) => r.strike * 100 === l.strikePaise)?.[l.kind];
        if (!row) { failed.push(`${name}: not in today's live contracts`); continue; }
        const o = await labApi.place({ symbol: row.symbol, side: l.side, product: 'NRML', type: 'MARKET', qty: l.lots * row.lot, reason: 'From the Options strategy builder' });
        done.push(`${name} ${o.avgFillPaise != null ? `@ ₹${(o.avgFillPaise / 100).toFixed(2)}` : o.status}`);
      } catch (e) { failed.push(`${name}: ${(e as Error).message}`); }
    }
    notify(failed.length ? `Trade lab: ${done.length} placed, ${failed.length} not (${failed[0]})` : `Trade lab: ${done.join(', ')}`);
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
    if (!l || l.kind === 'FUT') return;
    const key = `${underlying}|${l.expiry}`;
    let c = chainCache.current.get(key);
    if (!c) {
      try { c = await fetchChain(underlying, l.expiry, chain?.date); chainCache.current.set(key, c); } catch { return setNotice(`Could not load the ${fmtDate(l.expiry)} chain.`); }
    }
    if (!step) return;
    const strike = l.strikePaise + dir * step;
    const kind = l.kind;
    const q = c.rows.find((r) => r.strikePaise === strike)?.[kind];
    if (!q) return setNotice(`${fmtStrike(strike)} ${kind} is not listed for ${fmtDate(l.expiry)}.`);
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
        try { chains.set(off, await fetchChain(underlying, exp, chain.date)); } catch { return setNotice(`Could not load the ${fmtDate(exp)} chain.`); }
      }
      const c = chains.get(off)!;
      if (!step) return setNotice('Strike interval unknown for this chain.');
      const strike = chain.atmStrikePaise + l.offset * step;
      const q = c.rows.find((r) => r.strikePaise === strike)?.[l.kind];
      if (!q) return setNotice(`${fmtStrike(strike)} ${l.kind} is not listed for ${fmtDate(c.expiry)}.`);
      out.push({ id: `l${++seq}`, kind: l.kind, side: l.side, strikePaise: strike, expiry: c.expiry, lots: l.lots ?? 1, pricePaise: q.closePaise, iv: q.iv, greeks: legGreeks(q) });
    }
    setLegs(out);
    setTemplate({ id, legs: out });
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
      entry = add(entry, legCharges(l, l.side, l.lots * lot, l.pricePaise, broker));
      exit = add(exit, legCharges(l, l.side === 'BUY' ? 'SELL' : 'BUY', l.lots * lot, l.pricePaise, broker));
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
    ? legs.map((l) => {
        const c = chainCache.current.get(`${underlying}|${l.expiry}`);
        return { kind: l.kind, side: l.side, strikePaise: l.strikePaise, pricePaise: l.pricePaise, qty: l.lots * lot, iv: l.iv, years: yearsToExpiry(asOf, l.expiry), smile: c ? buildSmile(c) : undefined };
      })
    : []), [legs, lot, asOf, chain]); // eslint-disable-line react-hooks/exhaustive-deps

  // What-if scenario: NIFTY level, days ahead, IV model and shift. Starts at today's spot, next day.
  const [whatIf, setWhatIf] = useState<WhatIfState | null>(null);
  // The simulator's selected day: the what-if jumps to that day's close and the days passed since entry.
  const [simDay, setSimDay] = useState<SimDayLink | null>(null);
  const followSimDay = useCallback((d: SimDayLink | null) => {
    setSimDay(d);
    if (d) setWhatIf((w) => (w ? { ...w, spotPaise: d.spotPaise, days: d.daysSinceEntry } : w));
  }, []);
  const maxDays = Math.max(0, Math.round(tFirst * 365));
  useEffect(() => { if (chain?.spotPaise) setWhatIf((w) => (w && w.spotPaise && Math.abs(w.spotPaise / chain.spotPaise! - 1) < 0.2 ? w : { spotPaise: chain.spotPaise!, days: 1, model: 'spotvol', shiftPts: 0 })); }, [chain?.spotPaise]);
  const scenario = whatIf ? { ...whatIf, days: Math.min(whatIf.days, maxDays) } : null;
  const multiOutcome = useMemo(() => {
    if (!multi || !chain?.spotPaise) return null;
    const S0 = chain.spotPaise;
    if (pnlAt(modelLegs, S0, tFirst, RATE, carry) == null) return { missingIv: true as const };
    const gross = (S: number) => pnlAt(modelLegs, S, tFirst, RATE, carry)!;
    // Charges: entry, settlement of the first-expiry legs, then squaring off later legs at their model value.
    const later = (S: number) => modelLegs.reduce((sum, l, i) => sum + (legs[i].expiry === expiries[0]
      ? (l.kind === 'FUT' ? 0 : expirySettlementCharges({ side: l.side, qty: l.qty, intrinsicPaise: Math.max(0, l.kind === 'CE' ? S - l.strikePaise : l.strikePaise - S), broker }))
      : legCharges(l, l.side === 'BUY' ? 'SELL' : 'BUY', l.qty, Math.round(legValue(l, S, tFirst, RATE, carry)!), broker).total), 0);
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
      fetchMargin(underlying, chain.spotPaise!, legs.map((l) => ({ kind: l.kind, expiry: l.expiry, strikePaise: l.strikePaise, qty: (l.side === 'BUY' ? 1 : -1) * l.lots * lot, pricePaise: l.pricePaise })), ctl.signal, past ? chain.date : undefined)
        .then((data) => setMargin({ data, error: null, loading: false }), (e: Error) => { if (e.name !== 'AbortError') setMargin({ data: null, error: e.message, loading: false }); });
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [legs, lot, underlying, chain?.spotPaise, past]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = margin.data;

  const visible = !allStrikes && chain?.atmStrikePaise != null
    ? chain.rows.filter((r) => Math.abs(r.strikePaise - chain.atmStrikePaise!) <= VISIBLE_STEPS * (step || Infinity))
    : chain?.rows ?? [];
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current, row = el?.querySelector<HTMLElement>('[data-spot-row]');
    if (el && row) el.scrollTop = row.offsetTop - el.clientHeight / 2;
  }, [chain]);
  // The list can outgrow its box and scroll with the page, so this one finds whichever scroller holds it.
  useEffect(() => {
    if (allStrikes) scroller.current?.querySelector('[data-spot-row]')?.scrollIntoView({ block: 'center' });
  }, [allStrikes, chain]);
  const oiOf = (q: ChainSide) => (oiView === 'oi' ? q.oi : q.oiChange ?? 0);
  const maxOi = Math.max(1, ...visible.flatMap((r) => [Math.abs(r.CE ? oiOf(r.CE) : 0), Math.abs(r.PE ? oiOf(r.PE) : 0)]));
  const spot = chain?.spotPaise ?? null;

  const cell = (q: ChainSide | null, kind: 'CE' | 'PE', strike: number) => {
    if (!q) return <td colSpan={greeksView ? 5 : 3} className="text-center text-muted">—</td>;
    const itm = spot != null && (kind === 'CE' ? strike < spot : strike > spot);
    const v = oiOf(q);
    const oiText = oiView === 'oi' ? `${(q.oi / 1e5).toFixed(1)}L` : q.oiChange == null ? '—' : `${v >= 0 ? '+' : '−'}${(Math.abs(v) / 1e5).toFixed(1)}L`;
    const oi = (
      <td className={`relative px-2 text-right ${itm ? 'bg-itm' : ''} ${oiView === 'change' && v ? (v > 0 ? 'text-up' : 'text-down') : ''}`} title={`OI ${(q.oi / 1e5).toFixed(2)}L${q.oiChange != null ? ` · change ${q.oiChange >= 0 ? '+' : '−'}${(Math.abs(q.oiChange) / 1e5).toFixed(2)}L` : ''}`}>
        <i className={`absolute top-1.5 bottom-1.5 ${kind === 'CE' ? 'right-0' : 'left-0'} rounded-full opacity-30 ${kind === 'CE' ? 'bg-down' : 'bg-up'}`} style={{ width: `${(Math.abs(v) / maxOi) * 100}%` }} />
        <span className="relative">{oiText}</span>
      </td>
    );
    const iv = <td className={`px-2 text-right text-muted ${itm ? 'bg-itm' : ''}`}>{q.iv == null ? '—' : (q.iv * 100).toFixed(1)}</td>;
    // Legs already in the strategy at this strike: net lots, + bought, − sold.
    const held = legs.filter((l) => l.kind === kind && l.strikePaise === strike && l.expiry === chain?.expiry);
    const net = held.reduce((s, l) => s + (l.side === 'BUY' ? l.lots : -l.lots), 0);
    const tint = !held.length ? (itm ? 'bg-itm' : '') : net > 0 ? 'bg-blue/10 ring-2 ring-inset ring-blue' : net < 0 ? 'bg-down/10 ring-2 ring-inset ring-down' : 'bg-raised ring-2 ring-inset ring-muted';
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
              title={`Remove one lot (${held.at(-1)!.side === 'BUY' ? 'buy' : 'sell'} leg)`} className="flex-1 rounded-md bg-inverse text-[13px] leading-none font-bold text-on-inverse">−</button>
          )}
        </span>
      </td>
    );
    if (greeksView) {
      // Δ Γ Θ Vega per unit, mirrored so delta sits next to the premium on both sides. Untraded legs have none.
      const g = (v: number | null, d: number, title: string) => (
        <td className={`px-1.5 text-right ${itm ? 'bg-itm' : ''} ${v == null ? 'text-muted' : ''}`} title={title}>{v == null ? '—' : v.toFixed(d)}</td>
      );
      const delta = g(q.delta, 2, 'Delta: premium change for a 1-point move');
      const gamma = g(q.gamma, 4, 'Gamma: delta change for a 1-point move');
      const theta = <td className={`px-1.5 text-right ${itm ? 'bg-itm' : ''} ${q.theta == null ? 'text-muted' : 'text-down'}`} title="Theta: premium change for one calendar day">{q.theta == null ? '—' : q.theta.toFixed(2)}</td>;
      const vega = g(q.vega, 2, 'Vega: premium change for a 1-point change in IV');
      return kind === 'CE' ? <>{vega}{theta}{gamma}{delta}{ltp}</> : <>{ltp}{delta}{gamma}{theta}{vega}</>;
    }
    return kind === 'CE' ? <>{oi}{iv}{ltp}</> : <>{ltp}{iv}{oi}</>;
  };

  // One payoff chart: in the builder, or inside the simulator's chart tabs while a simulation is showing.
  const payoffChart = summary && chain?.spotPaise ? (
    <PayoffChart name={underlying} actual={past && simDay ? { spotPaise: simDay.spotPaise, pnlPaise: simDay.grossPaise, label: fmtDate(simDay.date) } : undefined} legs={modelLegs} spotPaise={chain.spotPaise} rate={RATE} carry={carry} atYears={tFirst} exact={!multi} atLabel={fmtDate(expiries[0] ?? chain.expiry)}
      breakevens={multi ? (multiOutcome && !multiOutcome.missingIv ? multiOutcome.gross.breakevens : []) : summary.breakevens}
      scenario={scenario ? { spotPaise: scenario.spotPaise, t: scenario.days / 365, sc: { model: scenario.model, spot0: chain.spotPaise, shift: scenario.shiftPts / 100, fit: SPOT_VOL_FIT.buckets }, label: scenario.days === 0 ? 'now' : `+${scenario.days}d` } : undefined}
      onScenarioSpot={(S) => setWhatIf((w) => (w ? { ...w, spotPaise: S } : w))} />
  ) : null;

  return (
    <div className="grid grid-cols-1 content-start gap-3 xl:h-[calc(100dvh-104px)] xl:min-h-[620px] xl:grid-cols-[minmax(420px,1fr)_minmax(560px,1.25fr)]">
      {/* chain */}
      <section className="panel flex h-[78dvh] min-h-[420px] flex-col overflow-hidden xl:h-auto xl:min-h-0">
        <div className="grid gap-2 border-b border-line px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <UnderlyingPicker value={underlying} onChange={(u) => { if (u !== underlying) { setUnderlying(u); setExpiry(undefined); if (legs.length) setNotice(`Legs cleared: switched to ${u}.`); setLegs([]); } }} />
            {chain && (
              <select className="h-8 rounded-full bg-raised px-3 text-[12.5px] font-semibold" value={chain.expiry} aria-label="Expiry"
                onChange={(e) => { setExpiry(e.target.value); if (legs.length) setNotice('Expiry changed: existing legs keep their own expiry.'); }}>
                {chain.expiries.map((x) => <option key={x} value={x}>{fmtDate(x)}</option>)}
              </select>
            )}
            {chain && (
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-muted" title="Build on a past day's NSE close, then simulate it day by day to expiry">
                As of
                <TradingDatePicker underlying={underlying} value={chain.date} onChange={(d) => pickDate(d ?? undefined)} min={range.from ?? undefined} max={range.to ?? undefined} className="h-8 bg-raised shadow-none" />
                {past && <button type="button" onClick={() => pickDate(undefined)} className="h-8 rounded-full px-2.5 text-[12px] font-semibold text-ink-2 hover:bg-raised">Latest</button>}
              </span>
            )}
            <span className="ml-auto"><InfoTip label="How to use the option chain">
            <p>Hover over a premium and click <b>B</b> to buy or <b>S</b> to sell; the leg goes into the strategy builder.</p>
            <p><b>Near the index</b> shows 14 strikes each side of the at-the-money strike. <b>All strikes</b> shows every strike NSE lists for this expiry.</p>
            <p>* means the contract had no trades that day: NSE carried the previous close forward. IV and Greeks are Black-76 estimates from traded premiums only.</p>
            <p><b>Greeks</b> are per unit of the underlying (multiply by lot size × lots for a position): delta is the premium change for a 1-point move, gamma the change in delta for a 1-point move, theta the premium change for one calendar day, and vega the premium change for a 1-point change in IV.</p>
            <p>Pick an earlier <b>As of</b> date to build a position on a past day and then simulate it day by day to expiry.</p>
          </InfoTip></span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-full bg-raised p-[3px]" role="tablist" aria-label="Open interest column">
            {([['oi', 'OI'], ['change', 'OI chg'], ['greeks', 'Greeks']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={oiView === k} onClick={() => setOiView(k)}
                className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${oiView === k ? 'bg-inverse text-on-inverse' : 'text-ink-2'}`}>{label}</button>
            ))}
          </div>
            <div className="flex rounded-full bg-raised p-[3px]" role="radiogroup" aria-label="Strikes shown">
            {([[false, 'Near the index'], [true, 'All strikes']] as const).map(([k, label]) => (
              <button key={label} type="button" role="radio" aria-checked={allStrikes === k} onClick={() => setAllStrikes(k)}
                className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${allStrikes === k ? 'bg-inverse text-on-inverse' : 'text-ink-2'}`}>{label}</button>
            ))}
          </div>
          </div>
        </div>
        {chain && (
          <div className="grid grid-cols-2 gap-1.5 px-3 py-2 text-[11px] sm:grid-cols-4">
            {([['Spot', chain.spotPaise], ['Forward (implied)', chain.forwardPaise], ['ATM', chain.atmStrikePaise]] as const).map(([k, v]) => (
              <div key={k} className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-muted">{k}</p><p className="num text-[13px] font-semibold">{v == null ? '—' : fmt(v / 100)}</p></div>
            ))}
            <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-muted">Lot size</p><p className="num text-[13px] font-semibold">{chain.lotSize ?? '—'}</p></div>
          </div>
        )}
        {chain && asOfDate && chain.date !== asOfDate && <p className="mx-3 text-[11.5px] text-muted">No NSE F&amp;O data for {fmtDate(asOfDate)} (holiday or weekend): showing {fmtDate(chain.date)}.</p>}
        {error && <p className="m-4 rounded-[10px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
          <table className="num w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-panel shadow-[0_1px_0_var(--color-line)] text-[10.5px] font-bold tracking-[0.05em] text-muted">
              {greeksView ? (
                <tr><th className="px-1.5 py-1.5 text-right">VEGA</th><th className="px-1.5 text-right">THETA</th><th className="px-1.5 text-right">GAMMA</th><th className="px-1.5 text-right">DELTA</th><th className="px-2 text-right">CE</th><th className="px-2 text-center">STRIKE</th><th className="px-2 text-right">PE</th><th className="px-1.5 text-right">DELTA</th><th className="px-1.5 text-right">GAMMA</th><th className="px-1.5 text-right">THETA</th><th className="px-1.5 text-right">VEGA</th></tr>
              ) : (
                <tr><th className="px-2 py-1.5 text-right">{oiView === 'oi' ? 'CALL OI' : 'CALL OI CHG'}</th><th className="px-2 text-right">IV</th><th className="px-2 text-right">CE</th><th className="px-2 text-center">STRIKE</th><th className="px-2 text-right">PE</th><th className="px-2 text-right">IV</th><th className="px-2 text-right">{oiView === 'oi' ? 'PUT OI' : 'PUT OI CHG'}</th></tr>
              )}
            </thead>
            <tbody>
              {visible.map((r, i) => {
                const atm = r.strikePaise === chain?.atmStrikePaise;
                const spotHere = spot != null && r.strikePaise > spot && (i === 0 || visible[i - 1].strikePaise <= spot);
                return (
                  <Fragment key={r.strikePaise}>
                  {spotHere && (
                    <tr aria-label={`Spot ${fmt(spot / 100)}`} data-spot-row>
                      <td colSpan={greeksView ? 11 : 7} className="relative h-[20px] p-0">
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
      </section>

      {/* builder and simulator, one tab each */}
      <section className="panel flex flex-col overflow-hidden xl:min-h-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <div role="tablist" aria-label="Panel" className="flex rounded-full bg-raised p-[3px]">
            {([['builder', 'Strategy builder'], ['simulator', 'Simulator']] as const).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={panel === k} onClick={() => setPanel(k)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-bold ${panel === k ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:text-ink'}`}>{label}</button>
            ))}
          </div>
          <h2 className="sr-only">{panel === 'builder' ? 'Strategy builder' : 'Simulator'}</h2>
          <span className="flex items-center">
            <InfoTip label="About these numbers">
              {legs.length > 0 && multi
                ? <p>Legs span more than one expiry: max profit/loss and breakevens are estimates at the first expiry, with later legs valued by Black-76 on their own IV, after charges (later legs squared off).</p>
                : <p>Max profit/loss and breakevens are for holding to expiry, after charges, and are exact for these prices.</p>}
              <p>The &ldquo;Today&rdquo; curve, IV and Greeks are Black-76 model estimates. Prices are NSE&rsquo;s official close{chain ? ` of ${fmtDate(chain.date)}` : ''}, not live quotes.</p>
              {margin.data && <p>Margin: SPAN computed with NSE Clearing&rsquo;s method from its official start-of-day risk parameter file ({margin.data.file}), plus NSE&rsquo;s exposure margin of 2% of notional on short options and futures (4% on a short option&rsquo;s expiry day). This is the exchange minimum; a broker may block more.</p>}
              {margin.data?.historical && <p><b>Past day:</b> SPAN is from that day&rsquo;s NSE file; the exposure margin and expiry-day rules are today&rsquo;s, and have not yet been checked against the rates NSE applied then.</p>}
              <p>Templates illustrate option structures; they are not recommendations. A calculator for your own analysis, not investment advice.</p>
            </InfoTip>
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {/* Empty builder: the template cards below replace this menu. */}
            {legs.length > 0 && (
              <select className="h-8 w-full rounded-full bg-raised px-3 text-[12.5px] font-semibold sm:w-44" value={template && template.legs === legs ? template.id : ''} onChange={(e) => void applyTemplate(e.target.value)} aria-label="Strategy template">
                <option value="">Choose a template…</option>
                {TEMPLATE_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>{TEMPLATES.filter((t) => t.group === g).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
                ))}
              </select>
            )}
            <SavedPositions underlying={underlying} date={chain?.date ?? null} legs={legs} onLoad={loadSaved}
              suggestedName={`${underlying} ${(template && template.legs === legs ? TEMPLATES.find((t) => t.id === template.id)?.name : null) ?? `${legs.length}-leg position`} · ${chain ? fmtDate(chain.date) : ''}`} />
            {legs.length > 0 && !past && (
              <button type="button" onClick={() => void tradeInLab()} title="Place these legs in Trade lab (paper) at live prices"
                className="rounded-full bg-accent-soft px-3 py-1 text-[12px] font-bold text-accent-deep hover:bg-accent hover:text-accent-ink">Paper trade in Trade lab</button>
            )}
            {legs.length > 0 && <button type="button" onClick={() => setLegs([])} className="rounded-full px-3 py-1 text-[12px] font-semibold text-muted hover:bg-down-soft hover:text-down">Clear</button>}
          </div>
        </div>

        {panel === 'simulator' && (
          <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
            {!past ? (
              <div className="grid gap-3 rounded-[12px] bg-raised p-4 text-[13px] text-ink-2">
                <p><b className="text-ink">The simulator follows a position from a past day to its expiry</b>, on NSE&rsquo;s official closes, one trading day at a time. You can square off any leg on any day.</p>
                <p>1. Pick a past date in <b>As of</b> above the option chain (or a quick one below). 2. Build the position in the Strategy builder. 3. Come back here and run it.</p>
                <div className="flex flex-wrap gap-2">
                  {([['1 month ago', 30], ['3 months ago', 91], ['6 months ago', 182], ['1 year ago', 365]] as const).map(([label, days]) => (
                    <button key={label} type="button" onClick={() => { const d = new Date(Date.now() + 5.5 * 3600_000 - days * 86400_000).toISOString().slice(0, 10); pickDate(d); setPanel('builder'); }}
                      className="h-8 rounded-full border border-line-strong bg-panel px-3 text-[12.5px] font-semibold text-ink hover:border-accent">{label}</button>
                  ))}
                </div>
                <p className="text-[12px] text-muted">The simulator covers NIFTY and BANKNIFTY.</p>
              </div>
            ) : !legs.length ? (
              <p className="rounded-[12px] bg-raised p-4 text-[13px] text-ink-2">Build a position on {chain ? fmtDate(chain.date) : 'the chosen day'} in the <button type="button" onClick={() => setPanel('builder')} className="font-semibold text-accent-deep hover:underline">Strategy builder</button>, then run it here.</p>
            ) : chain && (
              <Simulator underlying={underlying} entryDate={chain.date} legs={legs} brokerId={broker.id} brokerName={broker.name} onDay={followSimDay} payoff={payoffChart} />
            )}
          </div>
        )}
        {panel === 'builder' && (
        <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
          {past && legs.length > 0 && (
            <button type="button" onClick={() => setPanel('simulator')} className="flex w-full items-center gap-2 rounded-[10px] bg-accent-soft px-3 py-2 text-left text-[12.5px] text-ink-2 hover:bg-accent hover:text-accent-ink">
              Built on {chain ? fmtDate(chain.date) : 'a past day'}: <b>open the Simulator</b> to follow it day by day to expiry.
            </button>
          )}
          {chain?.futures && chain.futures.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line px-2.5 py-1.5 text-[12.5px]">
              <span className="font-semibold">Futures</span>
              {chain.futures.slice(0, 3).map((f) => (
                <span key={f.expiry} className="inline-flex items-center gap-1 rounded-full bg-raised py-0.5 pr-0.5 pl-2.5">
                  <span className="num">{fmtDate(f.expiry).slice(0, 6)} · {fmt(f.closePaise / 100)}{f.traded ? '' : '*'}</span>
                  <button type="button" onClick={() => addFuture('BUY', f.expiry)} className="rounded-full bg-blue px-2 py-0.5 text-[11px] font-bold text-white" aria-label={`Buy the ${fmtDate(f.expiry)} future`}>B</button>
                  <button type="button" onClick={() => addFuture('SELL', f.expiry)} className="rounded-full bg-down px-2 py-0.5 text-[11px] font-bold text-white" aria-label={`Sell the ${fmtDate(f.expiry)} future`}>S</button>
                </span>
              ))}
              <InfoTip label="About futures">A future moves one for one with the index (delta 1 a unit). Price is NSE&rsquo;s close that day; on expiry it settles at the index&rsquo;s official close. Charges use futures rates.</InfoTip>
            </div>
          )}
          {!legs.length && (chain ? <TemplateGallery chain={chain} onPick={(id) => void applyTemplate(id)} /> : <p className="py-10 text-center text-[13px] text-muted">Add legs from the option chain, or choose a template.</p>)}
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
                        {l.kind === 'FUT' ? null : <span className="inline-flex items-center rounded-md border border-line">
                          <button type="button" aria-label="Lower strike" title={step ? `Strike − ${fmtStrike(step)}` : undefined} onClick={() => void shiftStrike(l.id, -1)} className="rounded-l-md px-1 py-0.5 hover:bg-raised"><Minus size={11} /></button>
                          <span className="num min-w-[46px] px-0.5 text-center">{fmtStrike(l.strikePaise)}</span>
                          <button type="button" aria-label="Higher strike" title={step ? `Strike + ${fmtStrike(step)}` : undefined} onClick={() => void shiftStrike(l.id, 1)} className="rounded-r-md px-1 py-0.5 hover:bg-raised"><Plus size={11} /></button>
                        </span>}
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
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
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
                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
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
                {!multi && net?.chargesGrow && (
                  <InfoTip label="Exercise STT if held to expiry" className="ml-1">
                    Held to expiry {[net.chargesGrow.above && `above ${fmtStrike(net.chargesGrow.above.strikePaise)}`, net.chargesGrow.below && `below ${fmtStrike(net.chargesGrow.below.strikePaise)}`].filter(Boolean).join(' or ')},
                    {' '}exercise STT on the long leg adds about {formatRupees(Math.round((net.chargesGrow.above ?? net.chargesGrow.below)!.chargeSlope * 100 * 100))} per 100 points the underlying moves further; max loss above is at the outer strike. Squaring off before expiry avoids it.
                  </InfoTip>
                )}
              </p>
              )}
              {!(past && simDay) && payoffChart}
              {scenario && lot && (
                <WhatIf name={underlying} state={scenario} onChange={setWhatIf} legs={legs} modelLegs={modelLegs} spotPaise={chain.spotPaise} carry={carry} maxDays={maxDays} chainDate={chain.date} broker={broker} lot={lot} />
              )}
              {greeks && (
                <div className="grid grid-cols-3 gap-1.5 text-[12px]">
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Delta (units)</p><p className="num font-semibold">{greeks.delta.toFixed(1)}</p></div>
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Theta (₹/day)</p><p className={`num font-semibold ${greeks.theta >= 0 ? 'text-up' : 'text-down'}`}>{fmt(greeks.theta)}</p></div>
                  <div className="rounded-[10px] bg-raised px-2.5 py-1.5"><p className="text-[11px] text-muted">Vega (₹ per 1% IV)</p><p className="num font-semibold">{fmt(greeks.vega)}</p></div>
                </div>
              )}
              {greeks?.missing && <p className="text-[11px] text-down">Some legs have no IV (untraded), so Greeks exclude them.</p>}
              <details className="rounded-[10px] border border-line px-2.5 py-1.5 text-[12px]">
                <summary className="cursor-pointer font-semibold">Charges breakdown · {broker.name} · rates in force today
                  <InfoTip label="About these charges" className="ml-1.5">
                    Exit assumes every leg is squared off at the prices above. Held to expiry instead, long in-the-money options pay STT of 0.15% of intrinsic value
                    {broker.exerciseBrokerage ? ` and ${broker.name} charges ₹20 + GST brokerage on each exercised or assigned leg` : ''}; max profit, max loss and breakevens above include this.
                    {' '}Brokerage per <a className="underline" href={broker.source} target="_blank" rel="noreferrer">{broker.name}&rsquo;s published schedule</a>.
                  </InfoTip>
                </summary>
                <label className="mt-1.5 flex items-center gap-2 text-[12px] font-semibold text-ink-2">Broker
                  <select className="h-8 rounded-full bg-raised px-3 text-[12.5px] font-semibold text-ink" value={broker.id} onChange={(e) => pickBroker(e.target.value)} aria-label="Broker for charges" title="Brokerage schedule used for all charges on this page">
                    {BROKERS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
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
              </details>
            </>
          )}
        </div>
        )}
      </section>
      {notice && <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-inverse px-5 py-2.5 text-[13px] font-semibold text-on-inverse shadow-[var(--shadow-pop)]">{notice}</div>}
    </div>
  );
}
