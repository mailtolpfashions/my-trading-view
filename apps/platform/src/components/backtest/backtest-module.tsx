'use client';

import Link from 'next/link';
import { BacktestView } from './backtest-view';
import { OptionsBacktest } from './options-backtest';

/** Backtest pages: option strategies here (/backtest/options); stocks and indices are tested in Strategies (/strategies). */
export function BacktestModule({ mode }: { mode: 'stocks' | 'options' }) {
  return (
    <div className="grid min-h-0 grid-rows-[auto_1fr] gap-2">
      <nav aria-label="Backtest type" className="flex justify-self-start rounded-full bg-panel p-1 shadow-[var(--shadow-panel)]">
        {([['stocks', '/strategies', 'Stocks & indices'], ['options', '/backtest/options', 'Options']] as const).map(([k, href, label]) => (
          <Link key={k} href={href} aria-current={mode === k ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold ${mode === k ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:bg-raised'}`}>{label}</Link>
        ))}
      </nav>
      {mode === 'stocks' ? <BacktestView /> : <OptionsBacktest />}
    </div>
  );
}
