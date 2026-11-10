'use client';

// Baskets: orders kept together and placed in one go, with the margin the whole basket needs (hedges counted).

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useShell } from '@/components/app/shell-context';
import { basketApi, inr, type Basket, type MarginPreview } from '@/lib/tradelab';
import { confirmDialog } from '../dialog';
import { InfoTip } from '../info-tip';
import { Button, Card, inputCls } from '../ui';

export function BasketsPanel() {
  const { openTicket, notify } = useShell();
  const [list, setList] = useState<Basket[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [margin, setMargin] = useState<MarginPreview | null>(null);
  const [results, setResults] = useState<{ basket: string; results: { id: string; label: string; ok: boolean; text: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => basketApi.list().then((b) => setList(b.baskets.sort((x, y) => x.name.localeCompare(y.name))), () => setList([])), []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 4000); return () => clearInterval(t); }, [load]);
  const basket = list?.find((b) => b.id === sel) ?? list?.[0] ?? null;

  // The margin of the whole basket together (with the open positions), when its orders change.
  const key = JSON.stringify(basket?.items.map((x) => [x.symbol, x.side, x.product, x.qty, x.pricePaise]) ?? []);
  useEffect(() => {
    if (!basket?.items.length) { setMargin(null); return; }
    basketApi.margin(basket.items.map((x) => ({ symbol: x.symbol, side: x.side, product: x.product, qty: x.qty, price: x.pricePaise ? (x.pricePaise / 100).toFixed(2) : undefined }))).then(setMargin, () => setMargin(null));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = () => basketApi.save({ name: `Basket ${(list?.length ?? 0) + 1}`, items: [] }).then((b) => { setSel(b.id); void load(); }, (e: Error) => notify(e.message));
  const update = (b: Basket) => basketApi.save(b).then(() => void load(), (e: Error) => notify(e.message));
  const remove = (b: Basket) => void confirmDialog({ title: `Delete "${b.name}"?`, message: 'Its orders are removed from the basket. Trades already placed stay.', confirmLabel: 'Delete', danger: true })
    .then((ok) => { if (ok) basketApi.remove(b.id).then(() => { setSel(null); void load(); }, (e: Error) => notify(e.message)); });
  const execute = (b: Basket) => void confirmDialog({ title: `Place all ${b.items.length} orders of "${b.name}"?`, message: `In Trade lab (paper), in this order. Market orders fill at the live bid / ask now. Margin needed about ${margin ? inr(margin.neededPaise, 0) : '—'}.`, confirmLabel: 'Execute basket' })
    .then(async (ok) => {
      if (!ok) return;
      setBusy(true);
      try { const r = await basketApi.execute(b.id); setResults(r); notify(`${r.basket}: ${r.results.filter((x) => x.ok).length} of ${r.results.length} placed`); }
      catch (e) { notify((e as Error).message); }
      finally { setBusy(false); }
    });

  return (
    <Card title={<span className="flex items-center gap-1.5">Baskets <InfoTip label="About baskets">Keep several orders together (a spread, a hedge, a set of stocks) and place them in one go. The margin shown is for the whole basket together, so hedges lower it. Paper only.</InfoTip></span>}
      actions={<Button className="h-9" onClick={() => void create()}><Plus size={15} /> New basket</Button>}>
      {!list ? <p className="text-[13px] text-muted">Loading…</p> : !list.length ? (
        <p className="py-3 text-center text-[13.5px] text-muted">No baskets. Make one, then add orders to it here or with <b>Add to basket</b> in any order window.</p>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-1.5">
            {list.map((b) => (
              <button key={b.id} type="button" onClick={() => { setSel(b.id); setResults(null); }} aria-pressed={basket?.id === b.id}
                className={`h-8 rounded-full px-3 text-[12.5px] font-semibold ${basket?.id === b.id ? 'bg-inverse text-on-inverse' : 'border border-line-strong text-ink-2 hover:text-ink'}`}>{b.name} · {b.items.length}</button>
            ))}
          </div>
          {basket && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <input defaultValue={basket.name} key={basket.id} onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== basket.name) void update({ ...basket, name }); }}
                  aria-label="Basket name" className={`${inputCls} h-9 w-[220px] font-semibold`} />
                <Button variant="ghost" className="h-9" onClick={() => openTicket({ basketId: basket.id })}><Plus size={15} /> Add order</Button>
                <button type="button" onClick={() => remove(basket)} aria-label={`Delete ${basket.name}`} className="grid h-9 w-9 place-items-center rounded-[10px] text-ink-2 hover:bg-raised hover:text-down"><Trash2 size={15} /></button>
                <span className="ml-auto text-[12.5px] text-muted" title={margin?.method}>Margin for the basket <b className="num text-[14px] text-ink">{margin ? inr(margin.neededPaise, 0) : '—'}</b>{margin && <> · free <span className="num">{inr(margin.availablePaise, 0)}</span></>}</span>
                <Button variant="primary" className="h-9" disabled={busy || !basket.items.length} onClick={() => execute(basket)}>{busy ? 'Placing…' : 'Execute'}</Button>
              </div>
              {!basket.items.length ? <p className="py-3 text-center text-[13px] text-muted">Empty. Press <b>Add order</b>.</p> : (
                <table className="num w-full text-[13px]">
                  <thead className="text-[11px] font-bold tracking-[0.04em] text-muted"><tr><th className="py-1 text-left">#</th><th className="text-left">INSTRUMENT</th><th className="text-right">QTY</th><th className="text-left">PRODUCT</th><th className="text-left">TYPE</th><th className="text-right">PRICE / TRIGGER</th><th /></tr></thead>
                  <tbody>
                    {basket.items.map((x, k) => {
                      const res = results?.results.find((r) => r.id === x.id);
                      return (
                        <tr key={x.id} className="border-t border-line align-top">
                          <td className="py-1.5 text-muted">{k + 1}</td>
                          <td className="font-sans"><span className={`mr-1 font-bold ${x.side === 'BUY' ? 'text-blue' : 'text-down'}`}>{x.side === 'BUY' ? 'B' : 'S'}</span><b className="font-semibold">{x.label}</b>
                            {res && <span className={`block text-[11.5px] ${res.ok ? 'text-up' : 'text-down'}`}>{res.text}</span>}</td>
                          <td className="text-right">{x.qty}</td>
                          <td className="font-sans text-[12px]">{x.product}</td>
                          <td className="font-sans text-[12px]">{x.type === 'SLM' ? 'SL-M' : x.type}</td>
                          <td className="text-right">{x.type === 'MARKET' ? 'market' : [x.pricePaise, x.triggerPaise].filter((v) => v != null).map((v) => inr(v)).join(' / ')}</td>
                          <td className="text-right"><button type="button" onClick={() => void update({ ...basket, items: basket.items.filter((y) => y.id !== x.id) })} aria-label="Remove from basket" className="rounded p-1 text-muted hover:text-down"><X size={14} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
