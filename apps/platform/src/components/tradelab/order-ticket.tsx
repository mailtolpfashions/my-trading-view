'use client';

// Trade lab's order window, in the familiar broker layout: a coloured header (blue to buy, red to sell) with a
// buy/sell switch and the live price; product, quantity / price / trigger, order type; an optional stop and target;
// the margin it needs; and Buy / Sell, Add to basket, Cancel. The instrument is a stock, or a future / option picked
// from its underlying's live contracts.

import { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { FeedError } from '@/lib/feed';
import { basketApi, inr, labApi, type Basket, type Contracts, type LabQuote, type MarginPreview, type OrderType, type Product, type Side, type TicketStart } from '@/lib/tradelab';
import { InfoTip } from '../info-tip';
import { inputCls } from '../ui';

const INDEX_UNDERLYINGS = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
/** An F&O contract symbol (NIFTY26NOV24500CE, RELIANCE26NOVFUT). */
const isContract = (x: string) => /^[A-Z&-]+\d{2}[A-Z0-9]{3,}(FUT|CE|PE)$/.test(x);
const box = `${inputCls} num h-10 w-full text-[14px] disabled:cursor-not-allowed disabled:bg-raised disabled:text-muted`;

export function OrderTicket({ start, onClose, onPlaced }: { start: TicketStart & { basketId?: string }; onClose: () => void; onPlaced?: (msg: string) => void }) {
  const known = start.symbol && !INDEX_UNDERLYINGS.includes(start.symbol) ? start.symbol : null;
  const [symbol, setSymbol] = useState<string | null>(known);
  const [picking, setPicking] = useState(!known);
  const [side, setSide] = useState<Side>(start.side ?? 'BUY');
  const [product, setProduct] = useState<Product>('MIS');
  const [type, setType] = useState<OrderType>('MARKET');
  const [lots, setLots] = useState(1);
  const [price, setPrice] = useState('');
  const [trigger, setTrigger] = useState('');
  const [bracket, setBracket] = useState(false);
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [quote, setQuote] = useState<LabQuote | null>(null);
  const [margin, setMargin] = useState<MarginPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  // Live quote of the chosen instrument, every 2 seconds.
  useEffect(() => {
    if (!symbol) { setQuote(null); return; }
    let stopped = false;
    const load = () => labApi.quote(symbol).then((q) => { if (!stopped) { setQuote(q); setErr(null); } }, (e: Error) => { if (!stopped) { setQuote(null); setErr(e.message); } });
    load();
    const t = setInterval(load, 2000);
    return () => { stopped = true; clearInterval(t); };
  }, [symbol]);
  const fno = quote ? quote.exchange === 'NFO' : !!symbol && isContract(symbol);
  useEffect(() => { setProduct((p) => (fno ? (p === 'CNC' ? 'MIS' : p) : p === 'NRML' ? 'MIS' : p)); }, [fno]);

  const lot = quote?.lot ?? 1;
  const qty = fno ? lots * lot : lots;
  const usesPrice = type === 'LIMIT' || type === 'SL';
  const usesTrigger = type === 'SL' || type === 'SLM';

  // The margin this order needs (with the open positions: hedges count), a moment after the last change.
  useEffect(() => {
    if (!symbol || !quote) { setMargin(null); return; }
    const t = setTimeout(() => {
      basketApi.margin([{ symbol, side, product, qty, price: usesPrice && price ? price : undefined }]).then(setMargin, () => setMargin(null));
    }, 400);
    return () => clearTimeout(t);
  }, [symbol, quote?.symbol, side, product, qty, usesPrice, price]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = () => ({ symbol: symbol!, side, product, type, qty, price: usesPrice ? price || undefined : undefined, trigger: usesTrigger ? trigger || undefined : undefined });
  const place = async () => {
    if (!symbol) return;
    setBusy(true); setMsg(null);
    try {
      const o = await labApi.place({ ...order(), stop: bracket ? stop || undefined : undefined, target: bracket ? target || undefined : undefined });
      const name = `${side === 'BUY' ? 'Bought' : 'Sold'} ${fno ? `${lots} lot${lots > 1 ? 's' : ''}` : qty} ${quote?.label ?? symbol}`;
      const text = o.status === 'COMPLETE' ? `${name} at ${inr(o.avgFillPaise)}` : `${side === 'BUY' ? 'Buy' : 'Sell'} order placed: ${o.status === 'TRIGGER_PENDING' ? 'waiting for the trigger' : 'waiting for the price'}`;
      setMsg({ ok: true, text: o.reason && o.status === 'COMPLETE' ? `${text} · ${o.reason}` : text });
      onPlaced?.(text);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof FeedError ? e.message : (e as Error).message });
    } finally { setBusy(false); }
  };

  const buy = side === 'BUY';
  const head = buy ? 'bg-blue' : 'bg-down';
  const radio = (on: boolean) => `inline-flex cursor-pointer items-center gap-1.5 text-[13px] ${on ? 'font-semibold text-ink' : 'text-ink-2'}`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-scrim p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${buy ? 'Buy' : 'Sell'} order`}>
      <div className="flex max-h-[94dvh] w-full max-w-[540px] flex-col overflow-hidden rounded-[16px] bg-panel shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()}>
        {/* header: side colour, instrument, live price, buy / sell switch */}
        <div className={`${head} px-4 py-3 text-white`}>
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-bold">{buy ? 'Buy' : 'Sell'}</span>
            <span className="truncate text-[15px] font-semibold">{quote?.label ?? symbol ?? 'Pick an instrument'}</span>
            {quote && <span className="rounded bg-white/20 px-1.5 text-[11px] font-bold">{quote.exchange}</span>}
            <span className="rounded bg-white/20 px-1.5 text-[11px] font-bold">PAPER</span>
            <button type="button" role="switch" aria-checked={!buy} onClick={() => setSide(buy ? 'SELL' : 'BUY')} title="Switch between buy and sell"
              className="relative ml-auto h-6 w-11 shrink-0 rounded-full bg-white/30">
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${buy ? 'left-0.5' : 'left-[22px]'}`} />
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-1 hover:bg-white/20"><X size={16} /></button>
          </div>
          <p className="num mt-1 flex flex-wrap gap-x-3 text-[12.5px] text-white/90">
            {quote ? <>
              <span>LTP <b>{inr(quote.ltpPaise)}</b></span><span>Bid {inr(quote.bidPaise)}</span><span>Ask {inr(quote.askPaise)}</span>
              {quote.lot > 1 && <span>Lot {quote.lot}</span>}
            </> : <span>{err ?? 'Live price appears once the instrument is picked'}</span>}
            <button type="button" onClick={() => setPicking((p) => !p)} className="ml-auto inline-flex items-center gap-0.5 font-semibold underline-offset-2 hover:underline">
              {picking ? 'Done' : 'Change'} <ChevronDown size={13} className={picking ? 'rotate-180' : ''} />
            </button>
          </p>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {picking && <InstrumentPicker start={start} onPick={(s) => { setSymbol(s); setPicking(false); setMsg(null); }} current={symbol} />}

          {/* product */}
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {(fno ? [['MIS', 'Intraday', 'MIS'], ['NRML', 'Overnight', 'NRML']] : [['MIS', 'Intraday', 'MIS'], ['CNC', 'Longterm', 'CNC']] as const).map(([v, l, code]) => (
              <label key={v} className={radio(product === v)}>
                <input type="radio" name="product" checked={product === v} onChange={() => setProduct(v as Product)} className="accent-[var(--color-accent)]" />
                {l} <span className="text-[11.5px] text-muted">{code}</span>
              </label>
            ))}
          </div>

          {/* quantity, price, trigger */}
          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-1 text-[12px] text-ink-2">{fno ? `Lots (${qty} qty)` : 'Qty.'}
              <input type="number" min={1} step={1} value={lots} onChange={(e) => setLots(Math.max(1, Math.round(Number(e.target.value) || 1)))} className={box} />
            </label>
            <label className="grid gap-1 text-[12px] text-ink-2">Price
              <input inputMode="decimal" value={usesPrice ? price : ''} disabled={!usesPrice} onChange={(e) => setPrice(e.target.value)} placeholder={usesPrice ? (quote?.ltpPaise ? (quote.ltpPaise / 100).toFixed(2) : '') : 'Market'} className={box} />
            </label>
            <label className="grid gap-1 text-[12px] text-ink-2">Trigger price
              <input inputMode="decimal" value={usesTrigger ? trigger : ''} disabled={!usesTrigger} onChange={(e) => setTrigger(e.target.value)} className={box} />
            </label>
          </div>

          {/* order type */}
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            {([['MARKET', 'Market'], ['LIMIT', 'Limit'], ['SL', 'SL'], ['SLM', 'SL-M']] as const).map(([v, l]) => (
              <label key={v} className={radio(type === v)}>
                <input type="radio" name="type" checked={type === v} onChange={() => setType(v)} className="accent-[var(--color-accent)]" /> {l}
              </label>
            ))}
            <InfoTip label="Order types">
              <p><b>Market</b> buys at the ask and sells at the bid. <b>Limit</b> fills at your price or better. <b>SL</b> becomes a limit order at your price once the trigger trades; <b>SL-M</b> becomes a market order.</p>
            </InfoTip>
          </div>

          {/* stop and target */}
          <div className="rounded-[12px] border border-line px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold">
              <input type="checkbox" checked={bracket} onChange={(e) => setBracket(e.target.checked)} className="accent-[var(--color-accent)]" /> Stoploss and target
              <span className="text-[11.5px] font-normal text-muted">placed once this order fills; one cancels the other</span>
            </label>
            {bracket && (
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-[12px] text-ink-2">Stoploss price<input inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} className={box} /></label>
                <label className="grid gap-1 text-[12px] text-ink-2">Target price<input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className={box} /></label>
              </div>
            )}
          </div>

          {msg && <p role="status" className={`rounded-[10px] px-3 py-2 text-[12.5px] ${msg.ok ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>{msg.text}</p>}
        </div>

        {/* footer: margin, basket, buy / sell, cancel */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          <span className="text-[12px] text-muted" title={margin?.method}>
            Margin required <b className="num text-[13px] text-ink">{margin ? inr(margin.neededPaise, 0) : '—'}</b>
            {margin && <span className="block">Free <span className="num">{inr(margin.availablePaise, 0)}</span></span>}
          </span>
          <span className="ml-auto flex gap-2">
            <AddToBasket disabled={!symbol || !quote} start={start.basketId} item={() => ({ ...order(), label: quote?.label ?? symbol! })} onDone={(t) => setMsg({ ok: true, text: t })} />
            <button type="button" onClick={() => void place()} disabled={busy || !symbol || !quote}
              className={`h-10 min-w-[96px] rounded-[10px] px-5 text-[14px] font-bold text-white disabled:opacity-50 ${head}`}>{busy ? '…' : buy ? 'Buy' : 'Sell'}</button>
            <button type="button" onClick={onClose} className="h-10 rounded-[10px] border border-line-strong px-4 text-[14px] font-semibold text-ink-2 hover:text-ink">Cancel</button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Pick a stock, or a future / option from an underlying's live contracts. */
function InstrumentPicker({ start, current, onPick }: { start: TicketStart; current: string | null; onPick: (symbol: string) => void }) {
  const startsFno = !!start.underlying || (!!start.symbol && (INDEX_UNDERLYINGS.includes(start.symbol) || isContract(start.symbol)));
  const [mode, setMode] = useState<'stock' | 'fno'>(startsFno ? 'fno' : 'stock');
  const [stock, setStock] = useState(start.symbol && !startsFno ? start.symbol : '');
  const [underlying, setUnderlying] = useState(start.underlying ?? (start.symbol && INDEX_UNDERLYINGS.includes(start.symbol) ? start.symbol : 'NIFTY'));
  const [expiry, setExpiry] = useState<string | undefined>();
  const [contracts, setContracts] = useState<Contracts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== 'fno' || !underlying) return;
    let stopped = false;
    const load = () => labApi.contracts(underlying, expiry).then((c) => { if (!stopped) { setContracts(c); setErr(null); } }, (e: Error) => !stopped && setErr(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => { stopped = true; clearInterval(t); };
  }, [mode, underlying, expiry]);
  const atm = contracts?.spotPaise == null ? null : contracts.strikes.reduce((b, r) => (Math.abs(r.strike * 100 - contracts.spotPaise!) < Math.abs(b * 100 - contracts.spotPaise!) ? r.strike : b), contracts.strikes[0]?.strike ?? 0);
  const cell = (c: { symbol: string; ltpPaise: number | null; bidPaise: number | null; askPaise: number | null } | null) => !c ? <td className="text-center text-muted">—</td> : (
    <td className="p-0">
      <button type="button" onClick={() => onPick(c.symbol)} title={`Bid ${inr(c.bidPaise)} · Ask ${inr(c.askPaise)}`}
        className={`num w-full rounded-[8px] px-2 py-1 text-right text-[12px] ${current === c.symbol ? 'bg-accent-soft font-bold text-accent-deep ring-1 ring-accent' : 'hover:bg-raised'}`}>
        {c.ltpPaise == null ? '…' : (c.ltpPaise / 100).toFixed(2)}
      </button>
    </td>
  );
  return (
    <div className="grid gap-2 rounded-[12px] bg-raised p-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['stock', 'fno'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m}
            className={`h-8 rounded-full px-3 text-[12.5px] font-semibold ${mode === m ? 'bg-inverse text-on-inverse' : 'border border-line-strong bg-panel text-ink-2'}`}>{m === 'stock' ? 'Stock' : 'Futures & options'}</button>
        ))}
      </div>
      {mode === 'stock' ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (stock.trim()) onPick(stock.trim().toUpperCase()); }}>
          <input value={stock} onChange={(e) => setStock(e.target.value.toUpperCase())} placeholder="NSE symbol, e.g. RELIANCE" className={`${inputCls} h-9 flex-1 font-semibold uppercase`} spellCheck={false} autoFocus />
          <button type="submit" className="h-9 rounded-[10px] bg-inverse px-3 text-[13px] font-semibold text-on-inverse">Use</button>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input value={underlying} onChange={(e) => { setUnderlying(e.target.value.toUpperCase()); setExpiry(undefined); }} list="lab-underlyings" className={`${inputCls} h-9 w-[140px] font-semibold uppercase`} spellCheck={false} aria-label="Underlying" />
            <datalist id="lab-underlyings">{INDEX_UNDERLYINGS.map((u) => <option key={u} value={u} />)}</datalist>
            {contracts && (
              <select value={contracts.expiry} onChange={(e) => setExpiry(e.target.value)} aria-label="Option expiry" className={`${inputCls} h-9 pr-7 text-[13px]`}>
                {contracts.expiries.slice(0, 8).map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
            {contracts?.spotPaise != null && <span className="num text-[12px] text-muted">{underlying} {inr(contracts.spotPaise)}</span>}
          </div>
          {err && <p className="text-[12px] text-down">{err}</p>}
          {contracts && (
            <>
              <div className="flex flex-wrap gap-1.5">
                {contracts.futures.map((f) => (
                  <button key={f.symbol} type="button" onClick={() => onPick(f.symbol)}
                    className={`num rounded-full border px-3 py-1 text-[12px] font-semibold ${current === f.symbol ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line-strong bg-panel hover:border-accent'}`}>
                    {f.label} {f.ltpPaise == null ? '' : (f.ltpPaise / 100).toFixed(2)}
                  </button>
                ))}
              </div>
              <div className="max-h-[200px] overflow-y-auto rounded-[10px] border border-line bg-panel">
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-panel text-[10.5px] font-bold text-muted"><tr><th className="py-1 text-right">CALL</th><th className="text-center">STRIKE</th><th className="text-right">PUT</th></tr></thead>
                  <tbody>
                    {contracts.strikes.map((r) => (
                      <tr key={r.strike} className="border-t border-line">
                        {cell(r.CE)}
                        <td className={`num px-2 text-center font-semibold ${r.strike === atm ? 'bg-accent-soft' : 'bg-raised'}`}>{r.strike}</td>
                        {cell(r.PE)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Add this order to a basket (an existing one, or a new one). */
function AddToBasket({ disabled, start, item, onDone }: { disabled: boolean; start?: string; item: () => { symbol: string; label: string; side: Side; product: Product; type: OrderType; qty: number; price?: string; trigger?: string }; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Basket[]>([]);
  useEffect(() => { if (open) basketApi.list().then((b) => setList(b.baskets), () => setList([])); }, [open]);
  const add = async (b: Basket | null) => {
    const x = item();
    const toPaise = (v?: string) => (v ? Math.round(Number(v) * 100) : null);
    const entry = { id: '', symbol: x.symbol, label: x.label, side: x.side, product: x.product, type: x.type, qty: x.qty, pricePaise: toPaise(x.price), triggerPaise: toPaise(x.trigger) };
    const name = b?.name ?? `Basket ${list.length + 1}`;
    try {
      await basketApi.save({ id: b?.id, name, items: [...(b?.items ?? []), entry] });
      onDone(`Added to ${name}`);
      setOpen(false);
    } catch (e) { onDone((e as Error).message); }
  };
  // Opened from a basket: add straight to it.
  if (start) return (
    <button type="button" disabled={disabled} onClick={() => void basketApi.list().then((r) => add(r.baskets.find((b) => b.id === start) ?? null))}
      className="h-10 rounded-[10px] border border-line-strong px-3 text-[13px] font-semibold text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50">Add to basket</button>
  );
  return (
    <span className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="inline-flex h-10 items-center gap-1 rounded-[10px] border border-line-strong px-3 text-[13px] font-semibold text-ink-2 hover:border-accent hover:text-ink disabled:opacity-50">
        Add to basket <ChevronDown size={13} />
      </button>
      {open && (
        <span className="absolute bottom-11 right-0 z-10 grid w-56 gap-0.5 rounded-[12px] bg-panel p-1.5 shadow-[var(--shadow-pop)]">
          {list.map((b) => <button key={b.id} type="button" onClick={() => void add(b)} className="rounded-[8px] px-2.5 py-1.5 text-left text-[13px] hover:bg-raised">{b.name} <span className="text-muted">· {b.items.length}</span></button>)}
          <button type="button" onClick={() => void add(null)} className="rounded-[8px] px-2.5 py-1.5 text-left text-[13px] font-semibold text-accent-deep hover:bg-accent-soft">+ New basket</button>
        </span>
      )}
    </span>
  );
}
