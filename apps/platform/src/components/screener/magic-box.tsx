'use client';

// Magic filters: type a phrase ("5-minute volume > 2 x 5-minute SMA(volume, 10)", "stocks at 52 week high"), press
// Generate, and it becomes conditions: added to the ones there (Append) or in their place (Replace).

import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { MAGIC_EXAMPLES, readMagic } from '@/lib/magic';
import { InfoTip } from '../info-tip';
import { Segmented, inputCls } from '../ui';

export function MagicBox({ onApply }: { onApply: (conditions: string[], replace: boolean) => void }) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'append' | 'replace'>('append');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = (t = text) => {
    const r = readMagic(t);
    if (!r.ok) { setMsg({ ok: false, text: r.error }); return; }
    onApply(r.conditions, mode === 'replace');
    setMsg({ ok: true, text: `${mode === 'replace' ? 'Now' : 'Added'}: ${r.read}` });
    setText('');
  };
  return (
    <div className="grid gap-2 rounded-[14px] border border-accent/40 bg-accent-soft/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-accent-deep"><Sparkles size={16} /> Magic filters</span>
        <InfoTip label="About magic filters">
          <p>Type what you want in everyday words or as a comparison; it becomes conditions you can see and change below.</p>
          <p>It understands timeframes (1 / 5 / 15 / 30 minute, hourly, daily, weekly, monthly), prices and volume, SMA / EMA / RSI / VWAP / Supertrend / MACD, words like greater than, crossed above, &ldquo;2 x&rdquo;, and phrases like 52 week high, N red candles, close between A and B, candle patterns, gap up 2%. It works offline and says so when it doesn&apos;t understand.</p>
        </InfoTip>
        <Segmented label="Append or replace" value={mode} onChange={setMode} options={[{ value: 'append', label: 'Append' }, { value: 'replace', label: 'Replace' }]} />
      </div>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <input value={text} onChange={(e) => { setText(e.target.value); setMsg(null); }} placeholder="e.g. 5-minute volume > 2 x 5-minute SMA(volume, 10)"
          aria-label="Describe the stocks to find" className={`${inputCls} h-10 min-w-0 flex-1`} spellCheck={false} />
        <button type="submit" disabled={!text.trim()} className="inline-flex h-10 items-center gap-1.5 rounded-[12px] bg-accent px-4 text-[14px] font-bold text-accent-ink disabled:opacity-50"><Sparkles size={15} /> Generate</button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {MAGIC_EXAMPLES.map((x) => (
          <button key={x} type="button" onClick={() => setText(x)} title="Use this example"
            className="rounded-full border border-line-strong bg-panel px-2.5 py-0.5 text-[12px] text-ink-2 hover:border-accent hover:text-ink">{x}</button>
        ))}
      </div>
      {msg && <p role="status" className={`text-[12.5px] ${msg.ok ? 'text-up' : 'text-down'}`}><span className="font-mono">{msg.text}</span></p>}
    </div>
  );
}
