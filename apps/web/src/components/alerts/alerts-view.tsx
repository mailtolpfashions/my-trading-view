'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Pause, Play, Plus, Trash2 } from 'lucide-react';
import { fmt } from '@/lib/format';
import { describeCondition } from '@/lib/signals';
import { TF_LABEL, deleteAlert, fetchAlerts, setAlertStatus, type AlertRow, type AlertsResponse } from '@/lib/alerts';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const EMAIL: Record<string, string> = { sent: 'Emailed', not_configured: 'In-app only', failed: 'Email failed', pending: 'Sending…' };

export function describeAlert(a: AlertRow) {
  if ('op' in a.params) return `${a.params.op === 'crossesAbove' ? 'Crosses above' : 'Crosses below'} ₹${fmt(a.params.valuePaise / 100)}`;
  return `${a.params.rules.conditions.map(describeCondition).join(a.params.rules.match === 'all' ? ' and ' : ' or ')} · ${TF_LABEL[a.params.tf]} bars`;
}

/** Alerts module: every alert with its state, and the history of alerts that fired. */
export function AlertsView({ onNew, refreshKey }: { onNew: () => void; refreshKey: number }) {
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => fetchAlerts().then((r) => { setData(r); setError(null); }, (e: Error) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load, refreshKey]);

  const act = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { setError((e as Error).message); } void load(); };
  const groups: [string, AlertRow[]][] = data ? [
    ['Active', data.alerts.filter((a) => a.status === 'ACTIVE')],
    ['Paused', data.alerts.filter((a) => a.status === 'PAUSED')],
    ['Fired (once)', data.alerts.filter((a) => a.status === 'TRIGGERED')],
  ] : [];

  return (
    <main className="grid min-h-0 grid-cols-[1fr_440px] gap-2">
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div>
            <p className="text-[15px] font-extrabold tracking-[-0.02em]">Alerts</p>
            {data && <p className="text-[12px] text-muted">{data.used} of {data.limit} in use · {data.emailEnabled ? 'in-app and email' : 'in-app (email not set up yet)'}</p>}
          </div>
          <button type="button" onClick={onNew} className="ml-auto flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[12.5px] font-bold text-white hover:bg-black"><Plus size={14} /> New alert</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {error && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[12.5px] font-semibold text-down">{error}</p>}
          {data && !data.alerts.length && (
            <div className="m-auto max-w-[360px] py-10 text-center">
              <Bell size={22} className="mx-auto text-muted" />
              <p className="mt-2 text-[15px] font-bold">No alerts yet</p>
              <p className="mt-1 text-[13px] text-ink-2">Set a price level, or an indicator condition such as &ldquo;RSI 14 crosses below 30 on 15-minute bars&rdquo;. Use the bell on the chart toolbar, or New alert.</p>
            </div>
          )}
          {groups.filter(([, list]) => list.length).map(([title, list]) => (
            <div key={title}>
              <p className="eyebrow mb-1.5">{title} · {list.length}</p>
              <div className="divide-y divide-line rounded-[12px] border border-line">
                {list.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2.5">
                    <span className="w-24 shrink-0 text-[13px] font-bold">{a.symbol}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px]">{describeAlert(a)}</p>
                      <p className="truncate text-[11.5px] text-muted">{a.repeat === 'once' ? 'Once' : 'Repeats'}{a.lastTriggeredAt ? ` · last fired ${when(a.lastTriggeredAt)}` : ''}{a.note ? ` · ${a.note}` : ''}</p>
                    </div>
                    {a.status !== 'PAUSED'
                      ? <button type="button" onClick={() => act(() => setAlertStatus(a.id, 'PAUSED'))} disabled={a.status === 'TRIGGERED'} className="rounded-full p-1.5 text-muted hover:bg-raised disabled:opacity-30" aria-label="Pause" title="Pause"><Pause size={14} /></button>
                      : null}
                    {a.status !== 'ACTIVE' && <button type="button" onClick={() => act(() => setAlertStatus(a.id, 'ACTIVE'))} className="rounded-full p-1.5 text-muted hover:bg-raised" aria-label="Turn on again" title="Turn on again"><Play size={14} /></button>}
                    <button type="button" onClick={() => act(() => deleteAlert(a.id))} className="rounded-full p-1.5 text-muted hover:bg-down-soft hover:text-down" aria-label="Delete" title="Delete"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-line px-4 py-3"><p className="text-[13px] font-bold">History</p><p className="text-[11.5px] text-muted">Every alert that fired, newest first</p></div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {data && !data.events.length && <p className="p-4 text-[12.5px] text-muted">Nothing has fired yet.</p>}
          {data?.events.map((e) => (
            <div key={e.id} className="border-b border-line px-4 py-2.5">
              <p className="text-[13px]">{e.message}</p>
              <p className="text-[11.5px] text-muted">{when(e.triggeredAt)} · {EMAIL[e.emailStatus] ?? e.emailStatus}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
