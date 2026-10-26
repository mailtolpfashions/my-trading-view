'use client';

import { useEffect, useState } from 'react';
import { BacktestView } from './backtest-view';
import { OptionsBacktest } from './options-backtest';

/** Backtest module: indicator strategies on stocks/indices, or StockMock-style option strategies. */
export function BacktestModule() {
  const [mode, setMode] = useState<'stocks' | 'options'>('stocks');
  useEffect(() => {
    try { const m = localStorage.getItem('mtv.bt.mode'); if (m === 'options' || m === 'stocks') setMode(m); } catch { /* storage unavailable */ }
  }, []);
  const pick = (m: 'stocks' | 'options') => {
    setMode(m);
    try { localStorage.setItem('mtv.bt.mode', m); } catch { /* storage unavailable */ }
  };
  return (
    <div className="grid min-h-0 grid-rows-[auto_1fr] gap-2">
      <div className="flex items-center gap-2">
        <div className="flex rounded-full bg-panel p-1 shadow-[var(--shadow-panel)]" role="tablist" aria-label="Backtest type">
          {([['stocks', 'Stocks & indices · indicators'], ['options', 'Options strategies · StockMock-style']] as const).map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => pick(k)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${mode === k ? 'bg-ink text-white' : 'text-ink-2 hover:bg-raised'}`}>{label}</button>
          ))}
        </div>
      </div>
      {mode === 'stocks' ? <BacktestView /> : <OptionsBacktest />}
    </div>
  );
}
