'use client';

import { useEffect, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import type { Strategy } from '@mtv/backtest';
import type { Timeframe } from '@mtv/shared';
import { PRESETS, runBacktestApi, type BacktestResponse } from '@/lib/backtest';
import { SymbolSearch } from '@/components/terminal/symbol-search';
import { BacktestResults } from './results';
import { StrategyBuilder } from './strategy-builder';

/** Per-viewer draft in this browser only; the page works without it. */
function load<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function save(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable */ }
}

export function BacktestView() {
  const [strategy, setStrategy] = useState<Strategy>(() => structuredClone(PRESETS[0].strategy));
  const [tf, setTf] = useState<Timeframe>(PRESETS[0].tf);
  const [symbol, setSymbol] = useState('RELIANCE');
  const [data, setData] = useState<BacktestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    setStrategy(load('mtv.bt.strategy', structuredClone(PRESETS[0].strategy)));
    setTf(load('mtv.bt.tf', PRESETS[0].tf));
    setSymbol(load('mtv.bt.symbol', 'RELIANCE'));
  }, []);
  useEffect(() => save('mtv.bt.strategy', strategy), [strategy]);
  useEffect(() => save('mtv.bt.tf', tf), [tf]);
  useEffect(() => save('mtv.bt.symbol', symbol), [symbol]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setData(await runBacktestApi(symbol, tf, strategy));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-0 grid-cols-[400px_1fr] gap-2">
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <FlaskConical size={16} aria-hidden="true" />
          <h2 className="text-[14px] font-extrabold tracking-[-0.02em]">Strategy</h2>
        </div>
        <StrategyBuilder strategy={strategy} tf={tf} symbol={symbol} busy={busy} onChange={setStrategy} onTf={setTf} onPickSymbol={() => setPicking(true)} onRun={run} />
      </section>
      <section className="panel flex min-h-0 flex-col overflow-hidden">
        {error && <p role="alert" className="m-3 rounded-[10px] bg-down-soft px-3 py-2 text-[13px] font-semibold text-down">{error}</p>}
        {data ? <BacktestResults data={data} /> : !error && (
          <div className="m-auto max-w-[360px] px-4 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-[12px] bg-ink text-accent"><FlaskConical size={20} aria-hidden="true" /></span>
            <h3 className="mt-3 text-[15px] font-extrabold tracking-[-0.02em]">Test a strategy on real history</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">Pick a preset or build your own rules, then run. Daily history goes back years; intraday history up to 60 days (5m–30m) or 2 years (1h).</p>
          </div>
        )}
      </section>
      <SymbolSearch open={picking} title="Backtest symbol" onClose={() => setPicking(false)} onPick={(i) => setSymbol(i.symbol)} />
    </main>
  );
}
