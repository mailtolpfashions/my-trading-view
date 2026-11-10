'use client';

// Trade lab: the paper account at a glance — funds, live positions with P&L, orders (with why each ended as it did),
// today's trades and the day-by-day record. Refreshes every 2 seconds.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, RotateCcw } from 'lucide-react';
import { chartHref, useShell } from '@/components/app/shell-context';
import { FeedError } from '@/lib/feed';
import { inr, labApi, signedInr, type LabOrder, type LabSnapshot } from '@/lib/tradelab';
import { confirmDialog } from '../dialog';
import { InfoTip } from '../info-tip';
import { Button, Card } from '../ui';
import { BasketsPanel } from './baskets-panel';
import { RulesPanel } from './rules-panel';

const tone = (v: number) => (v > 0 ? 'text-up' : v < 0 ? 'text-down' : 'text-ink-2');
const time = (sec: number) => new Date((sec + 19800) * 1000).toISOString().slice(11, 19);
const STATUS: Record<LabOrder['status'], string> = { OPEN: 'Open', TRIGGER_PENDING: 'Waiting for trigger', COMPLETE: 'Filled', CANCELLED: 'Cancelled', REJECTED: 'Rejected' };
const TAGS: Record<string, string> = { AUTO_SQUAREOFF: '3 pm close', EXPIRY: 'Expiry', BRACKET_STOP: 'Stop', BRACKET_TARGET: 'Target', EXIT: 'Exit' };

export function TradeLabPage() {
  const { openTicket, notify } = useShell();
  const [snap, setSnap] = useState<LabSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => labApi.snapshot().then((s) => { setSnap(s); setError(null); }, (e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); const t = setInterval(() => void load(), 2000); return () => clearInterval(t); }, [load]);

  const act = (p: Promise<unknown>, ok: string) => p.then(() => { notify(ok); void load(); }, (e: Error) => notify(e instanceof FeedError ? e.message : e.message));
  const reset = () => {
    void confirmDialog({ title: 'Start Trade lab again?', message: 'Every paper order and trade is deleted and the account starts again with ₹10,00,000. This cannot be undone.', confirmLabel: 'Reset to ₹10 lakh', danger: true })
      .then((yes) => { if (yes) void act(labApi.reset('1000000'), 'Trade lab reset to ₹10,00,000'); });
  };

  const f = snap?.funds;
  const open = (snap?.positions ?? []).filter((p) => p.qty !== 0);
  const closed = (snap?.positions ?? []).filter((p) => p.qty === 0);
  const dayNet = snap?.days[0] && snap.days[0].date === new Date((snap.asOf + 19800) * 1000).toISOString().slice(0, 10) ? snap.days[0].netPaise : 0;

  return (
    <div className="grid content-start gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-extrabold tracking-[-0.02em]">Trade lab</h1>
        <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11.5px] font-bold text-accent-deep">PAPER</span>
        {snap && <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${snap.live ? 'bg-up-soft text-up' : 'bg-raised text-muted'}`}>
          <i className={`h-1.5 w-1.5 rounded-full ${snap.live ? 'bg-up' : 'bg-muted'}`} aria-hidden="true" />{snap.live ? 'Market open, live prices' : 'Market closed or Kite not connected'}
        </span>}
        <InfoTip label="About Trade lab">
          <p>Paper trading on live Kite prices: nothing is sent to a broker.</p>
          <p>A market order buys at the ask and sells at the bid from the live order book; limits fill at their price when the market reaches it. Your window: no new trades before {snap?.settings.firstEntry ?? '09:30'}; intraday positions close at {snap?.settings.squareOff ?? '15:00'}. F&amp;O settles at expiry at NSE&rsquo;s official values. Charges are {snap?.settings.broker ?? 'Zerodha'}&rsquo;s.</p>
          <p>Paper fills are kinder than real ones: no queue, and size never moves the price.</p>
        </InfoTip>
        <span className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={reset}><RotateCcw size={15} /> Reset</Button>
          <Button variant="primary" onClick={() => openTicket()}><Plus size={16} /> New order</Button>
        </span>
      </div>
      {error && <p className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}

      {/* funds */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {([
          ['Account value', f ? inr(f.equityPaise, 0) : '…', f ? `started ${inr(f.startingCashPaise, 0)}` : '', ''],
          ['Today', f ? signedInr(dayNet) : '…', 'closed trades, after charges', f ? tone(dayNet) : ''],
          ['Open P&L', f ? signedInr(f.unrealisedPaise) : '…', `${open.length} open position${open.length === 1 ? '' : 's'}`, f ? tone(f.unrealisedPaise) : ''],
          ['Booked P&L', f ? signedInr(f.realisedPaise) : '…', 'since the start, before charges', f ? tone(f.realisedPaise) : ''],
          ['Charges', f ? inr(f.chargesPaise, 0) : '…', 'brokerage, STT and taxes', ''],
          ['Free to trade', f ? inr(f.availablePaise, 0) : '…', f ? `margin in use ${inr(f.usedPaise, 0)} (${f.marginMethod})` : '', ''],
        ] as const).map(([k, v, sub, c]) => (
          <div key={k} className="panel grid gap-0.5 p-3.5">
            <p className="text-[12px] text-muted">{k}</p>
            <p className={`num text-[19px] font-bold ${c}`}>{v}</p>
            <p className="truncate text-[11.5px] text-muted" title={sub}>{sub}</p>
          </div>
        ))}
      </div>

      {/* positions */}
      <Card title={`Positions${open.length ? ` · ${open.length} open` : ''}`}>
        {!open.length && !closed.length ? <p className="py-4 text-center text-[13.5px] text-muted">No positions. Press <b>New order</b>, or use the Trade buttons on charts, scanner results and the watchlist.</p> : (
          <div className="overflow-x-auto">
            <table className="num w-full text-[13px]">
              <thead className="text-[11px] font-bold tracking-[0.04em] text-muted"><tr>
                <th className="py-1.5 text-left">INSTRUMENT</th><th className="text-left">PRODUCT</th><th className="text-right">QTY</th><th className="text-right">AVG</th>
                <th className="text-right">LTP</th><th className="text-right">BID / ASK</th><th className="text-right">P&amp;L</th><th className="text-right">CHARGES</th><th />
              </tr></thead>
              <tbody>
                {[...open, ...closed].map((p) => {
                  const pnl = p.unrealisedPaise + p.realisedPaise;
                  return (
                    <tr key={`${p.symbol}|${p.product}`} className={`border-t border-line ${p.qty === 0 ? 'text-muted' : ''}`}>
                      <td className="py-2 font-sans font-semibold"><Link href={chartHref(p.kind === 'EQ' ? p.symbol : p.symbol)} className="hover:text-accent-deep">{p.label}</Link></td>
                      <td className="font-sans text-[12px]">{p.product === 'MIS' ? 'Intraday' : p.product === 'CNC' ? 'Delivery' : 'Overnight'}</td>
                      <td className={`text-right font-semibold ${p.qty > 0 ? 'text-blue' : p.qty < 0 ? 'text-down' : ''}`}>{p.qty}{p.lot > 1 && p.qty ? <span className="block text-[10.5px] font-normal text-muted">{Math.abs(p.qty) / p.lot} lot{Math.abs(p.qty) / p.lot === 1 ? '' : 's'}</span> : null}</td>
                      <td className="text-right">{inr(p.avgPaise)}</td>
                      <td className="text-right">{inr(p.ltpPaise)}</td>
                      <td className="text-right text-[12px] text-muted">{p.qty ? `${inr(p.bidPaise)} / ${inr(p.askPaise)}` : ''}</td>
                      <td className={`text-right font-semibold ${tone(pnl)}`}>{signedInr(pnl)}</td>
                      <td className="text-right text-muted">{inr(p.chargesPaise)}</td>
                      <td className="text-right font-sans">
                        {p.qty !== 0 && (
                          <span className="inline-flex gap-1">
                            <button type="button" onClick={() => openTicket({ symbol: p.symbol, side: p.qty > 0 ? 'BUY' : 'SELL' })} className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] font-semibold hover:border-accent">Add</button>
                            <button type="button" onClick={() => void act(labApi.exit(p.symbol, p.product), `${p.label} exited at market`)} className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12px] font-semibold hover:border-down hover:text-down">Exit</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* baskets: orders placed together */}
      <BasketsPanel />

      {/* automatic rules and their decision log */}
      <RulesPanel />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* orders */}
        <Card title="Orders today">
          {!snap?.orders.length ? <p className="py-4 text-center text-[13.5px] text-muted">No orders today.</p> : (
            <div className="max-h-[420px] overflow-auto">
              <table className="num w-full text-[12.5px]">
                <thead className="sticky top-0 bg-panel text-[11px] font-bold tracking-[0.04em] text-muted"><tr>
                  <th className="py-1.5 text-left">TIME</th><th className="text-left">ORDER</th><th className="text-right">QTY</th><th className="text-right">PRICE</th><th className="text-left">STATUS</th><th />
                </tr></thead>
                <tbody>
                  {snap.orders.map((o) => {
                    const openNow = o.status === 'OPEN' || o.status === 'TRIGGER_PENDING';
                    return (
                      <tr key={o.id} className="border-t border-line align-top">
                        <td className="py-1.5 text-muted">{time(o.createdAt)}</td>
                        <td className="font-sans">
                          <span className={`mr-1 font-bold ${o.side === 'BUY' ? 'text-blue' : 'text-down'}`}>{o.side === 'BUY' ? 'B' : 'S'}</span>
                          <b className="font-semibold">{o.symbol}</b> <span className="text-muted">{o.type === 'SLM' ? 'SL-M' : o.type} · {o.product}</span>
                          {o.tag && TAGS[o.tag] && <span className="ml-1 rounded-full bg-raised px-1.5 text-[10.5px] font-semibold text-ink-2">{TAGS[o.tag]}</span>}
                          {o.source !== 'MANUAL' && o.source !== 'SYSTEM' && <span className="ml-1 rounded-full bg-accent-soft px-1.5 text-[10.5px] font-semibold text-accent-deep">auto</span>}
                          {o.reason && <span className="block text-[11.5px] text-muted">{o.reason}</span>}
                        </td>
                        <td className="text-right">{o.qty}</td>
                        <td className="text-right">{o.avgFillPaise != null ? inr(o.avgFillPaise) : o.type === 'MARKET' ? 'market' : inr(o.pricePaise ?? o.triggerPaise)}</td>
                        <td className={`font-sans ${o.status === 'COMPLETE' ? 'text-up' : o.status === 'REJECTED' ? 'text-down' : openNow ? 'text-accent-deep' : 'text-muted'}`}>{STATUS[o.status]}</td>
                        <td className="text-right font-sans">{openNow && <button type="button" onClick={() => void act(labApi.cancel(o.id), 'Order cancelled')} className="rounded-full px-2 py-0.5 text-[12px] font-semibold text-down hover:bg-down-soft">Cancel</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* day by day */}
        <Card title="Day by day">
          {!snap?.days.length ? <p className="py-4 text-center text-[13.5px] text-muted">Each trading day&rsquo;s result shows here.</p> : (
            <div className="max-h-[420px] overflow-auto">
              <table className="num w-full text-[12.5px]">
                <thead className="sticky top-0 bg-panel text-[11px] font-bold tracking-[0.04em] text-muted"><tr><th className="py-1.5 text-left">DAY</th><th className="text-right">TRADES</th><th className="text-right">BOOKED</th><th className="text-right">CHARGES</th><th className="text-right">NET</th></tr></thead>
                <tbody>
                  {snap.days.map((d) => (
                    <tr key={d.date} className="border-t border-line">
                      <td className="py-1.5">{d.date}</td><td className="text-right">{d.trades}</td>
                      <td className={`text-right ${tone(d.realisedPaise)}`}>{signedInr(d.realisedPaise)}</td>
                      <td className="text-right text-muted">{inr(d.chargesPaise)}</td>
                      <td className={`text-right font-semibold ${tone(d.netPaise)}`}>{signedInr(d.netPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
