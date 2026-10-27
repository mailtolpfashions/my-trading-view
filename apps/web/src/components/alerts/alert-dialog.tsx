'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import type { RuleSet } from '@mtv/backtest';
import type { Timeframe } from '@mtv/shared';
import { Rules } from '@/components/backtest/strategy-builder';
import { TF_LABEL, createAlert, type NewAlert } from '@/lib/alerts';

const field = 'h-9 w-full rounded-[10px] border border-line bg-panel px-2.5 text-[13px] outline-none focus:border-ink';
const DEFAULT_RULES: RuleSet = { match: 'all', conditions: [{ left: { kind: 'indicator', name: 'RSI', params: [14] }, op: 'crossesBelow', right: { kind: 'number', value: 30 } }] };

/** Create a price or indicator alert for a symbol. */
export function AlertDialog({ symbol, price, initialOp = 'crossesAbove', delayed, onClose, onCreated }: { symbol: string; price?: number; initialOp?: 'crossesAbove' | 'crossesBelow'; delayed: boolean; onClose: () => void; onCreated: (msg: string) => void }) {
  const [kind, setKind] = useState<'PRICE' | 'RULES'>('PRICE');
  const [op, setOp] = useState<'crossesAbove' | 'crossesBelow'>(initialOp);
  const [value, setValue] = useState(price ? price.toFixed(2) : '');
  const [tf, setTf] = useState<Timeframe>('15');
  const [rules, setRules] = useState<RuleSet>(DEFAULT_RULES);
  const [repeat, setRepeat] = useState<'once' | 'every'>('once');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const a: NewAlert = kind === 'PRICE'
      ? { symbol, kind, params: { op, value: Number(value) }, repeat, note: note || undefined }
      : { symbol, kind, params: { tf, rules }, repeat, note: note || undefined };
    try {
      await createAlert(a);
      onCreated(`Alert set for ${symbol}`);
      onClose();
      try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission(); } catch { /* not available */ }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink/30 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={`New alert for ${symbol}`}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="panel max-h-[90dvh] w-full max-w-[460px] space-y-3.5 overflow-y-auto p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-extrabold tracking-[-0.02em]">New alert · {symbol}</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-muted hover:bg-raised" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="flex gap-1 rounded-full bg-raised p-1" role="tablist">
          {([['PRICE', 'Price'], ['RULES', 'Indicator']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
              className={`flex-1 rounded-full py-1.5 text-[12.5px] font-semibold ${kind === k ? 'bg-panel shadow-[0_1px_3px_rgb(18_18_18/0.14)]' : 'text-ink-2'}`}>{l}</button>
          ))}
        </div>

        {kind === 'PRICE' ? (
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[12.5px] font-semibold text-ink-2">When {symbol}
              <select id="alert-op" className={`${field} mt-1`} value={op} onChange={(e) => setOp(e.target.value as typeof op)}>
                <option value="crossesAbove">crosses above</option>
                <option value="crossesBelow">crosses below</option>
              </select>
            </label>
            <label className="text-[12.5px] font-semibold text-ink-2">Price (₹)
              <input id="alert-value" className={`${field} num mt-1`} type="number" step="0.05" min="0.05" value={value} onChange={(e) => setValue(e.target.value)} required />
            </label>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-[12.5px] font-semibold text-ink-2">Checked when each bar closes on
              <select id="alert-tf" className={`${field} mt-1`} value={tf} onChange={(e) => setTf(e.target.value as Timeframe)}>
                {(['5', '15', '60', 'D'] as Timeframe[]).map((t) => <option key={t} value={t}>{TF_LABEL[t]}</option>)}
              </select>
            </label>
            <Rules title="Alert when" rules={rules} onChange={setRules} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[12.5px] font-semibold text-ink-2">Repeat
            <select id="alert-repeat" className={`${field} mt-1`} value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
              <option value="once">Once, then stop</option>
              <option value="every">{kind === 'PRICE' ? 'Every time it crosses' : 'Every bar it holds'}</option>
            </select>
          </label>
          <label className="text-[12.5px] font-semibold text-ink-2">Note (optional)
            <input id="alert-note" className={`${field} mt-1`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. check breakout volume" />
          </label>
        </div>

        {delayed && <p className="rounded-[10px] bg-accent-soft px-3 py-2 text-[12px] text-accent-ink">Your prices are 15 minutes delayed, so this alert fires 15 minutes after the move. Live plan alerts fire in real time.</p>}
        {error && <p role="alert" className="rounded-[10px] bg-down-soft px-3 py-2 text-[12.5px] font-semibold text-down">{error}</p>}
        <button type="submit" disabled={busy} className="h-10 w-full rounded-full bg-ink font-bold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Create alert'}</button>
      </form>
    </div>
  );
}
