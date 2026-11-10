'use client';

// The index strip on the Today page: one compact tile per index with its 3-month sparkline. Clicking a tile picks the
// index the Market and Options cards show.

import { useEffect, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { PULSE_NAMES } from '@/components/app/shell-context';
import { fetchCandles, keepAnswer, lastAnswer } from '@/lib/feed';
import { fmt } from '@/lib/format';
import type { IndexCard } from '@/lib/today';

/**
 * What a tile needs. Indices come with the full last session from the dashboard; a stock you add comes from the
 * last-close quote, which has no day high and low.
 */
export type TileCard = Pick<IndexCard, 'symbol' | 'close' | 'change' | 'changePct'> & { date?: string; high?: number; low?: number };

export const tone = (v: number | null | undefined) => (v == null || v === 0 ? 'text-ink-2' : v > 0 ? 'text-up' : 'text-down');
export const signed = (v: number, digits = 2) => `${v > 0 ? '+' : ''}${fmt(Number(v.toFixed(digits)))}`;

const SPARK_DAYS = 63; // about three months of sessions
type Spark = { date: string; close: number }[];

/** The last ~3 months of daily closes as a small area chart: green if the index is up over the period, red if down. */
function Sparkline({ symbol }: { symbol: string }) {
  const key = `spark/${symbol}`;
  const [closes, setCloses] = useState<Spark | null>(null);
  useEffect(() => {
    setCloses(lastAnswer<Spark>(key)?.data ?? null); // the last one this browser saw, at once
    const ctrl = new AbortController();
    fetchCandles(symbol, 'D', ctrl.signal).then(
      (r) => {
        const s = r.candles.slice(-SPARK_DAYS).map((k) => ({ date: new Date((k.time + 5.5 * 3600) * 1000).toISOString().slice(0, 10), close: k.close }));
        keepAnswer(key, s);
        setCloses(s);
      },
      () => { if (!ctrl.signal.aborted) setCloses((c) => c ?? []); },
    );
    return () => ctrl.abort();
  }, [symbol, key]);
  if (!closes) return <div className="h-9 w-full animate-pulse rounded-[8px] bg-raised" aria-hidden="true" />;
  if (closes.length < 2) return <div className="h-9" aria-hidden="true" />;
  const W = 160, H = 36, v = closes.map((x) => x.close);
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1)) * W, 3 + (1 - (y - lo) / r) * (H - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  const change = ((v[v.length - 1] - v[0]) / v[0]) * 100;
  const color = change >= 0 ? 'var(--color-up)' : 'var(--color-down)';
  const id = `sp-${symbol}`;
  return (
    <div className="relative">
      <span className={`num absolute -top-3.5 right-0 text-[10px] font-semibold ${change >= 0 ? 'text-up' : 'text-down'}`}>3M {change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(1)}%</span>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-9 w-full" role="img"
        aria-label={`${closes[0].date} to ${closes[closes.length - 1].date}: ${change >= 0 ? 'up' : 'down'} ${Math.abs(change).toFixed(1)}%`}>
        <title>{`3 months (${closes[0].date} → ${closes[closes.length - 1].date}): ${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(2)}%`}</title>
        <defs>
          <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line}L${W},${H}L0,${H}Z`} fill={`url(#${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Live numbers from the brief, when the session is on; the tile then shows them in place of the last close. */
export type LiveQuote = { ltp: number; changePct: number; high: number; low: number };

/** The tile's numbers: live during the session, otherwise the last close. */
export function tileNumbers(c: TileCard, live?: LiveQuote | null) {
  return {
    close: live?.ltp ?? c.close, high: live?.high ?? c.high, low: live?.low ?? c.low,
    changePct: live?.changePct ?? c.changePct,
    change: live ? (c.close * live.changePct) / 100 : c.change, // c is the last session, so its close is the previous close
  };
}

export function IndexTile({ c, live, selected, editing, onSelect }: { c: TileCard; live?: LiveQuote | null; selected: boolean; editing?: boolean; onSelect: () => void }) {
  const { close, high, low, change, changePct } = tileNumbers(c, live);
  const Trend = (change ?? 0) < 0 ? TrendingDown : TrendingUp;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} title={editing ? 'Click to change this tile' : `${high != null && low != null ? `Day range ${fmt(low)} – ${fmt(high)}. ` : ''}Click to see it below.`}
      className={`@container panel block h-full w-full min-w-0 p-3.5 text-left transition-[box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)] motion-reduce:transform-none ${editing ? 'outline-2 outline-dashed outline-offset-2 outline-accent' : selected ? 'ring-2 ring-accent' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="truncate text-[13px] font-semibold">{PULSE_NAMES[c.symbol] ?? c.symbol}</span>
        {live && <span className="live-dot ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-up" title="Live" />}
      </div>
      <div className="mt-1.5 flex items-end gap-3">
        <div className="shrink-0">
          <p className="num text-[18px] font-bold leading-tight tracking-[-0.02em]">{fmt(close)}</p>
          <p className={`num mt-0.5 flex items-center gap-1 text-[11.5px] font-semibold ${tone(change)}`}>
            {change != null && <Trend size={13} aria-hidden="true" />}
            {change == null || changePct == null ? '—' : `${signed(change)} (${signed(changePct)}%)`}
          </p>
        </div>
        <div className="hidden min-w-[56px] flex-1 @[200px]:block"><Sparkline symbol={c.symbol} /></div>
      </div>
    </button>
  );
}
