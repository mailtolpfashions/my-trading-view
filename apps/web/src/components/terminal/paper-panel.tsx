'use client';

import { useState } from 'react';
import { formatRupees, type PaperSnapshot } from '@mtv/paper';
import { cancelPaperOrder, resetPaper } from '@/lib/feed';
import type { TicketRequest } from './order-ticket';

type Tab = 'positions' | 'orders' | 'trades' | 'funds';

const istTime = (t: number) => new Date((t + 5.5 * 3600) * 1000).toISOString().slice(11, 19);
const pnlTone = (p: number) => (p > 0 ? 'text-up' : p < 0 ? 'text-down' : 'text-ink-2');
const signedRupees = (p: number) => (p > 0 ? '+' : '') + formatRupees(p);
const STATUS: Record<string, string> = { OPEN: 'Open', TRIGGER_PENDING: 'Trigger pending', COMPLETE: 'Complete', CANCELLED: 'Cancelled', REJECTED: 'Rejected' };

export function PaperPanel({ snapshot, unavailable, onTicket, onNotice }: {
  snapshot: PaperSnapshot | null;
  unavailable: boolean;
  onTicket: (r: TicketRequest) => void;
  onNotice: (m: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('positions');
  const [resetAmount, setResetAmount] = useState('1000000');
  const s = snapshot;
  const open = s?.positions.filter((p) => p.qty !== 0).length ?? 0;
  const pending = s?.orders.filter((o) => o.status === 'OPEN' || o.status === 'TRIGGER_PENDING').length ?? 0;
  const dayPnl = s ? s.positions.reduce((sum, p) => sum + p.realisedPaise + p.unrealisedPaise, 0) : 0;

  const th = 'px-3 py-1.5 text-right text-[10.5px] font-bold tracking-[0.05em] text-muted uppercase first:text-left';
  const td = 'num px-3 py-1.5 text-right first:text-left';

  return (
    <section className="panel flex min-h-0 flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-2.5 pt-2 pb-1">
        {([['positions', `Positions${open ? ` (${open})` : ''}`], ['orders', `Orders${pending ? ` (${pending})` : ''}`], ['trades', 'Trades'], ['funds', 'Funds']] as const).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${tab === k ? 'bg-ink text-white' : 'text-ink-2 hover:bg-raised'}`}>{label}</button>
        ))}
        {s && (
          <div className="ml-auto flex items-center gap-1.5 text-[12px]">
            <span className="rounded-full bg-raised px-3 py-1 font-semibold text-muted">Mode <b className="text-ink">Paper</b></span>
            <span className="rounded-full bg-raised px-3 py-1 font-semibold text-muted">Available <b className="num font-medium text-ink">{formatRupees(s.account.availablePaise)}</b></span>
            <span className="rounded-full bg-raised px-3 py-1 font-semibold text-muted">Today&rsquo;s P&amp;L <b className={`num font-medium ${pnlTone(dayPnl)}`}>{signedRupees(dayPnl)}</b></span>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1 text-[12.5px]">
        {unavailable && !s && <p className="m-6 text-center text-muted">Paper trading is unavailable. Start the database with <code className="num">npm run db:start</code>.</p>}

        {s && tab === 'positions' && (s.positions.length ? (
          <table className="w-full">
            <thead><tr><th className={th}>Instrument</th><th className={th}>Product</th><th className={th}>Qty</th><th className={th}>Avg</th><th className={th}>LTP</th><th className={th}>Unrealised</th><th className={th}>Realised</th><th className={th}>Charges</th><th className={th} /></tr></thead>
            <tbody>
              {s.positions.map((p) => (
                <tr key={`${p.symbol}|${p.product}`} className="border-t border-line">
                  <td className={`${td} font-sans font-bold`}>{p.symbol}</td>
                  <td className={`${td} font-sans`}>{p.product}</td>
                  <td className={`${td} ${p.qty > 0 ? 'text-blue' : p.qty < 0 ? 'text-down' : 'text-muted'}`}>{p.qty}</td>
                  <td className={td}>{p.qty ? formatRupees(Math.round(p.avgPricePaise)) : '—'}</td>
                  <td className={td}>{p.ltpPaise ? formatRupees(p.ltpPaise) : '—'}</td>
                  <td className={`${td} ${pnlTone(p.unrealisedPaise)}`}>{p.qty ? signedRupees(p.unrealisedPaise) : '—'}</td>
                  <td className={`${td} ${pnlTone(p.realisedPaise)}`}>{signedRupees(p.realisedPaise)}</td>
                  <td className={td}>{formatRupees(p.chargesPaise)}</td>
                  <td className={td}>
                    {p.qty !== 0 && (
                      <button type="button" onClick={() => onTicket({ symbol: p.symbol, side: p.qty > 0 ? 'SELL' : 'BUY', product: p.product, qty: Math.abs(p.qty), ltp: p.ltpPaise ? p.ltpPaise / 100 : undefined })}
                        className="rounded-full border border-line px-2.5 py-0.5 font-sans text-[11.5px] font-bold hover:border-ink">Exit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No positions today. Use BUY / SELL on the chart to place a paper order.</Empty>)}

        {s && tab === 'orders' && (s.orders.length ? (
          <table className="w-full">
            <thead><tr><th className={th}>Time</th><th className={th}>Instrument</th><th className={th}>Side</th><th className={th}>Type</th><th className={th}>Qty</th><th className={th}>Price</th><th className={th}>Trigger</th><th className={th}>Avg fill</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody>
              {s.orders.map((o) => (
                <tr key={o.id} className="border-t border-line align-top">
                  <td className={td}>{istTime(o.createdAt)}</td>
                  <td className={`${td} font-sans font-bold`}>{o.symbol} <span className="font-medium text-muted">{o.product}</span></td>
                  <td className={`${td} font-sans font-bold ${o.side === 'BUY' ? 'text-blue' : 'text-down'}`}>{o.side}</td>
                  <td className={`${td} font-sans`}>{o.type === 'SLM' ? 'SL-M' : o.type}{o.tag === 'AUTO_SQUAREOFF' ? ' · auto square-off' : ''}</td>
                  <td className={td}>{o.qty}</td>
                  <td className={td}>{o.pricePaise ? formatRupees(o.pricePaise) : '—'}</td>
                  <td className={td}>{o.triggerPaise ? formatRupees(o.triggerPaise) : '—'}</td>
                  <td className={td}>{o.avgFillPaise ? formatRupees(o.avgFillPaise) : '—'}</td>
                  <td className={`${td} font-sans`}>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${o.status === 'COMPLETE' ? 'bg-up-soft text-up' : o.status === 'REJECTED' ? 'bg-down-soft text-down' : o.status === 'CANCELLED' ? 'bg-raised text-muted' : 'bg-accent-soft text-accent-ink'}`}>{STATUS[o.status]}</span>
                    {o.rejectReason && <p className="mt-0.5 ml-auto max-w-[280px] text-right text-[11px] whitespace-normal text-muted">{o.rejectReason}</p>}
                  </td>
                  <td className={td}>
                    {(o.status === 'OPEN' || o.status === 'TRIGGER_PENDING') && (
                      <button type="button" onClick={() => cancelPaperOrder(o.id).then(() => onNotice('Order cancelled'), (e: Error) => onNotice(e.message))}
                        className="rounded-full border border-line px-2.5 py-0.5 font-sans text-[11.5px] font-bold hover:border-down hover:text-down">Cancel</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No orders today.</Empty>)}

        {s && tab === 'trades' && (s.trades.length ? (
          <table className="w-full">
            <thead><tr><th className={th}>Time</th><th className={th}>Instrument</th><th className={th}>Side</th><th className={th}>Qty</th><th className={th}>Price</th><th className={th}>Value</th><th className={th}>Charges</th></tr></thead>
            <tbody>
              {s.trades.map((t) => (
                <tr key={t.id} className="border-t border-line">
                  <td className={td}>{istTime(t.time)}</td>
                  <td className={`${td} font-sans font-bold`}>{t.symbol} <span className="font-medium text-muted">{t.product}</span></td>
                  <td className={`${td} font-sans font-bold ${t.side === 'BUY' ? 'text-blue' : 'text-down'}`}>{t.side}</td>
                  <td className={td}>{t.qty}</td>
                  <td className={td}>{formatRupees(t.pricePaise)}</td>
                  <td className={td}>{formatRupees(t.qty * t.pricePaise)}</td>
                  <td className={td} title={`Brokerage ${formatRupees(t.charges.brokerage)} · STT ${formatRupees(t.charges.stt)} · Exchange ${formatRupees(t.charges.exchangeTxn)} · SEBI ${formatRupees(t.charges.sebiFee)} · Stamp ${formatRupees(t.charges.stampDuty)} · GST ${formatRupees(t.charges.gst)} · DP ${formatRupees(t.charges.dpCharge)}`}>
                    {formatRupees(t.charges.total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>No trades today.</Empty>)}

        {s && tab === 'funds' && (
          <div className="grid grid-cols-[1fr_auto] gap-6 px-3 py-2">
            <dl className="grid grid-cols-3 content-start gap-x-8 gap-y-2.5 text-[12.5px]">
              {([
                ['Starting funds', formatRupees(s.account.startingCashPaise), ''],
                ['Account value', formatRupees(s.account.equityPaise), ''],
                ['Available', formatRupees(s.account.availablePaise), ''],
                ['Cash', formatRupees(s.account.cashPaise), ''],
                ['Used by positions', formatRupees(s.account.usedPaise), ''],
                ['Blocked by open orders', formatRupees(s.account.blockedPaise), ''],
                ['Realised P&L', signedRupees(s.account.realisedPaise), pnlTone(s.account.realisedPaise)],
                ['Unrealised P&L', signedRupees(s.account.unrealisedPaise), pnlTone(s.account.unrealisedPaise)],
                ['Charges paid', formatRupees(s.account.chargesPaise), ''],
              ] as const).map(([k, v, tone]) => (
                <div key={k}><dt className="text-[11px] text-muted">{k}</dt><dd className={`num font-medium ${tone}`}>{v}</dd></div>
              ))}
            </dl>
            <form className="flex w-[300px] flex-col gap-1.5 rounded-[12px] bg-raised p-3 text-[12px]" onSubmit={(e) => {
              e.preventDefault();
              if (!confirm('Reset paper account? All paper orders and trades will be deleted.')) return;
              resetPaper(resetAmount).then(() => onNotice('Paper account reset'), (err: Error) => onNotice(err.message));
            }}>
              <p className="font-bold">Reset paper account <span className="font-normal text-muted">· clears all paper orders and trades</span></p>
              <div className="flex gap-1.5">
                <input value={resetAmount} onChange={(e) => setResetAmount(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" aria-label="Starting funds in rupees" className="num h-8 min-w-0 flex-1 rounded-[10px] border border-line bg-panel px-2.5" />
                <button type="submit" className="h-8 rounded-full bg-ink px-4 font-bold text-white">Reset</button>
              </div>
              <p className="text-muted">1× margin (no leverage), so a position never risks more than its value.</p>
            </form>
          </div>
        )}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-6 text-center text-[13px] text-muted">{children}</p>;
}
