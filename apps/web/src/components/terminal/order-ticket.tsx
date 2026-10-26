'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { computeCharges, formatRupees, toPaise, type OrderType, type PaperSnapshot, type Product, type Side } from '@mtv/paper';
import { placePaperOrder } from '@/lib/feed';

export type TicketRequest = { symbol: string; side: Side; product?: Product; qty?: number; ltp?: number };

const TYPES: [OrderType, string][] = [['MARKET', 'Market'], ['LIMIT', 'Limit'], ['SL', 'SL'], ['SLM', 'SL-M']];

/** Safe parse for display maths only; the server re-validates everything. */
const paiseOrNull = (v: string) => { try { return v.trim() ? toPaise(v) : null; } catch { return null; } };

export function OrderTicket({ req, snapshot, delayed, onClose, onDone }: {
  req: TicketRequest | null;
  snapshot: PaperSnapshot | null;
  delayed: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [side, setSide] = useState<Side>('BUY');
  const [product, setProduct] = useState<Product>('MIS');
  const [type, setType] = useState<OrderType>('MARKET');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [trigger, setTrigger] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCharges, setShowCharges] = useState(false);

  useEffect(() => {
    const d = dialog.current!;
    if (req) {
      setSide(req.side);
      setProduct(req.product ?? 'MIS');
      setType('MARKET');
      setQty(String(req.qty ?? 1));
      setPrice(req.ltp ? req.ltp.toFixed(2) : '');
      setTrigger('');
      setError(null);
      if (!d.open) d.showModal();
    } else if (d.open) d.close();
  }, [req]);

  const ltpPaise = req?.ltp ? toPaise(req.ltp.toFixed(2)) : null;
  const qtyN = /^\d+$/.test(qty) ? Number(qty) : 0;
  const refPaise = type === 'LIMIT' || type === 'SL' ? paiseOrNull(price) : type === 'SLM' ? paiseOrNull(trigger) : ltpPaise;
  const charges = useMemo(() => (qtyN > 0 && refPaise ? computeCharges({ side, product, qty: qtyN, pricePaise: refPaise }) : null), [side, product, qtyN, refPaise]);
  const value = qtyN > 0 && refPaise ? qtyN * refPaise : null;

  async function submit() {
    if (!req) return;
    setBusy(true);
    setError(null);
    try {
      const o = await placePaperOrder({
        symbol: req.symbol, side, product, type, qty: qtyN,
        price: type === 'LIMIT' || type === 'SL' ? price : undefined,
        triggerPrice: type === 'SL' || type === 'SLM' ? trigger : undefined,
      });
      if (o.status === 'REJECTED') setError(o.rejectReason ?? 'Order rejected');
      else {
        onDone(o.status === 'COMPLETE'
          ? `${side === 'BUY' ? 'Bought' : 'Sold'} ${o.qty} ${o.symbol} @ ${formatRupees(o.avgFillPaise!)} (paper)`
          : `${type === 'SL' || type === 'SLM' ? 'Stop order' : 'Limit order'} placed: ${side} ${o.qty} ${o.symbol} (paper)`);
        onClose();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const buy = side === 'BUY';
  const accent = buy ? 'bg-blue' : 'bg-down';
  const field = 'num h-10 w-full rounded-[10px] border border-line bg-panel px-3 text-[14px] outline-none focus:border-ink disabled:bg-raised disabled:text-muted';

  return (
    <dialog ref={dialog} onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}
      className="m-auto w-[min(440px,94vw)] rounded-[18px] bg-panel p-0 shadow-[var(--shadow-pop)] backdrop:bg-ink/30" aria-label="Order ticket">
      {req && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <div className={`flex items-center justify-between rounded-t-[18px] px-5 py-3.5 text-white ${accent}`}>
            <div>
              <p className="text-[16px] font-extrabold tracking-[-0.02em]">{buy ? 'Buy' : 'Sell'} {req.symbol} <span className="text-[12px] font-semibold opacity-80">NSE</span></p>
              <p className="num text-[12px] opacity-90">LTP {req.ltp ? formatRupees(toPaise(req.ltp.toFixed(2))) : '—'}{delayed ? ' · delayed' : ''}</p>
            </div>
            <div className="flex items-center gap-1">
              <div className="flex rounded-full bg-white/20 p-0.5">
                {(['BUY', 'SELL'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSide(s)} className={`rounded-full px-3 py-1 text-[12px] font-bold ${side === s ? 'bg-white text-ink' : 'text-white'}`}>{s === 'BUY' ? 'Buy' : 'Sell'}</button>
                ))}
              </div>
              <button type="button" onClick={onClose} className="rounded-full p-1.5 hover:bg-white/20" aria-label="Close"><X size={18} /></button>
            </div>
          </div>

          <div className="space-y-3.5 px-5 py-4">
            <Seg label="Product" value={product} onChange={(v) => setProduct(v as Product)} options={[['MIS', 'Intraday (MIS)'], ['CNC', 'Delivery (CNC)']]} />
            <Seg label="Order type" value={type} onChange={(v) => setType(v as OrderType)} options={TYPES} />
            <div className="grid grid-cols-3 gap-2.5">
              <label className="text-[12px] font-semibold text-ink-2">Qty
                <input className={field} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} aria-label="Quantity" autoFocus />
              </label>
              <label className="text-[12px] font-semibold text-ink-2">Price
                <input className={field} inputMode="decimal" value={type === 'MARKET' || type === 'SLM' ? '' : price} placeholder={type === 'MARKET' || type === 'SLM' ? 'Market' : ''}
                  disabled={type === 'MARKET' || type === 'SLM'} onChange={(e) => setPrice(e.target.value)} aria-label="Limit price" />
              </label>
              <label className="text-[12px] font-semibold text-ink-2">Trigger
                <input className={field} inputMode="decimal" value={trigger} disabled={type !== 'SL' && type !== 'SLM'} onChange={(e) => setTrigger(e.target.value)} aria-label="Trigger price" />
              </label>
            </div>

            <div className="rounded-[12px] bg-raised px-3.5 py-2.5 text-[12.5px]">
              <div className="flex justify-between"><span className="text-muted">Order value</span><b className="num font-medium">{value != null ? formatRupees(value) : '—'}</b></div>
              <div className="mt-1 flex justify-between">
                <button type="button" onClick={() => setShowCharges(!showCharges)} className="text-muted underline decoration-dotted underline-offset-2">Est. charges</button>
                <b className="num font-medium">{charges ? formatRupees(charges.total) : '—'}</b>
              </div>
              {showCharges && charges && (
                <dl className="num mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-line pt-1.5 text-[11.5px] text-ink-2">
                  {([['Brokerage', charges.brokerage], ['STT', charges.stt], ['Exchange txn', charges.exchangeTxn], ['SEBI fee', charges.sebiFee], ['Stamp duty', charges.stampDuty], ['GST', charges.gst]] as const).map(([k, v]) => (
                    <div key={k} className="contents"><dt>{k}</dt><dd className="text-right">{formatRupees(v)}</dd></div>
                  ))}
                  <p className="col-span-2 mt-1 font-sans text-[10.5px] text-muted">Rates effective {snapshot?.chargeRatesEffectiveFrom ?? '—'}. DP charge applies to delivery sells. Verify with your broker.</p>
                </dl>
              )}
              <div className="mt-1 flex justify-between"><span className="text-muted">Available funds</span><b className="num font-medium">{snapshot ? formatRupees(snapshot.account.availablePaise) : '—'}</b></div>
            </div>

            {error && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[12.5px] font-semibold text-down">{error}</p>}

            <button type="submit" disabled={busy || qtyN <= 0} className={`h-11 w-full rounded-full text-[14px] font-bold text-white disabled:opacity-50 ${accent}`}>
              {busy ? 'Placing…' : `${buy ? 'Buy' : 'Sell'} ${qtyN || ''} · paper`}
            </button>
            <p className="text-center text-[11px] leading-snug text-muted">
              Paper trading with virtual money. Fills use the last traded price{delayed ? ' from delayed data' : ''}; real fills can differ by the bid/ask spread.
            </p>
          </div>
        </form>
      )}
    </dialog>
  );
}

function Seg({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: readonly (readonly [string, string])[] }) {
  return (
    <div>
      <p className="mb-1 text-[12px] font-semibold text-ink-2">{label}</p>
      <div className="flex gap-1 rounded-full bg-raised p-[3px]" role="radiogroup" aria-label={label}>
        {options.map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={value === k} onClick={() => onChange(k)}
            className={`flex-1 rounded-full py-1.5 text-[12.5px] font-semibold ${value === k ? 'bg-ink text-white' : 'text-ink-2 hover:text-ink'}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}
