'use client';

// The Market card on Today: the picked index in plain words, its day and year ranges, its trend, and a ladder of
// today's levels with the price placed among them.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { PULSE_NAMES, chartHref } from '@/components/app/shell-context';
import { InfoTip } from '@/components/info-tip';
import { fmt } from '@/lib/format';
import type { IndexLevels } from '@/lib/today';
import { signed, tileNumbers, tone, type LiveQuote, type TileCard } from './market-tiles';

export function MarketCard({ symbol, x, card, live, note, sessionLive }: {
  symbol: string; x: IndexLevels | undefined; card: TileCard | undefined; live: LiveQuote | null; note?: string; sessionLive: boolean;
}) {
  const t = card ? tileNumbers(card, live) : null;
  const price = x?.live?.ltp ?? t?.close ?? x?.close ?? null;
  const changePct = x?.live?.changePct ?? t?.changePct ?? x?.changePct ?? null;
  const dayHigh = x?.live?.high ?? t?.high ?? x?.high, dayLow = x?.live?.low ?? t?.low ?? x?.low;
  const above = (v: number | null) => (v == null || price == null ? null : price >= v);
  const chips: { text: string; up: boolean | null; title: string }[] = x ? [
    { text: `${above(x.trend.ema20) ? 'Above' : 'Below'} 20-day avg`, up: above(x.trend.ema20), title: `20-day average ${fmt(x.trend.ema20 ?? 0)}` },
    ...(x.trend.ema200 != null ? [{ text: `${above(x.trend.ema200) ? 'Above' : 'Below'} 200-day avg`, up: above(x.trend.ema200), title: `200-day average ${fmt(x.trend.ema200)}` }] : []),
    ...(x.trend.rsi14 != null ? [{ text: `RSI ${x.trend.rsi14.toFixed(0)}`, up: x.trend.rsi14 >= 60 ? true : x.trend.rsi14 <= 40 ? false : null, title: 'RSI(14): above 60 is strong, below 40 is weak' }] : []),
    { text: `Supertrend ${x.trend.supertrendUp ? 'up' : 'down'}`, up: x.trend.supertrendUp, title: 'Supertrend on daily bars' },
  ] : [];

  return (
    <section className="panel flex min-h-0 flex-col p-5">
      <div className="card-head !mb-3 !pb-3">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold tracking-[-0.01em]">
          {sessionLive && x?.live && <span className="live-dot h-2 w-2 rounded-full bg-up" />}{PULSE_NAMES[symbol] ?? symbol}
          <span className="text-[12px] font-normal text-muted">{x?.live ? 'live' : 'last close'}</span>
        </h2>
        <Link href={chartHref(symbol)} className="ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-semibold text-accent-deep hover:bg-accent-soft">Open chart <ArrowUpRight size={14} /></Link>
      </div>
      <div className="grid min-h-0 flex-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span className="num text-[32px] font-bold leading-none tracking-[-0.03em]">{price == null ? '—' : fmt(price)}</span>
            <span className={`num text-[15px] font-semibold ${tone(changePct)}`}>{changePct == null ? '' : `${signed(changePct)}%`}</span>
          </p>
          <ul className="grid gap-0.5 text-[13.5px] text-ink-2">
            {x?.live ? x.live.facts.map((f) => <li key={f}>{f}</li>)
              : x ? <li>Closed {changePct == null ? '' : `${signed(changePct)}%`} on {x.session}</li> : null}
            {note && <li>{note}</li>}
          </ul>
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => <span key={c.text} title={c.title} className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${c.up == null ? 'bg-raised text-ink-2' : c.up ? 'bg-up-soft text-up' : 'bg-down-soft text-down'}`}>{c.text}</span>)}
            </div>
          )}
          <div className="mt-auto grid gap-2.5">
            {dayLow != null && dayHigh != null && price != null && <RangeBar label="Today's range" low={dayLow} high={dayHigh} at={price} />}
            {x && price != null && <RangeBar label="52-week range" low={Math.min(x.ranges.year.low, price)} high={Math.max(x.ranges.year.high, price)} at={price} />}
          </div>
          {!sessionLive && x && <p className="text-[11.5px] text-muted">Connect Kite (top right) during market hours to see the session live.</p>}
        </div>
        {x && price != null ? <LevelLadder x={x} price={price} /> : (
          <div className="grid place-items-center rounded-[14px] bg-raised p-4 text-center text-[13px] text-muted">
            Levels are worked out for NIFTY 50, BANK NIFTY, FIN NIFTY and MIDCAP SELECT. Open the chart for this one.
          </div>
        )}
      </div>
    </section>
  );
}

function RangeBar({ label, low, high, at }: { label: string; low: number; high: number; at: number }) {
  const pos = high > low ? Math.min(100, Math.max(0, ((at - low) / (high - low)) * 100)) : 50;
  return (
    <div title={`${label}: ${fmt(low)} – ${fmt(high)}, now ${fmt(at)} (${pos.toFixed(0)}% of the way up)`}>
      <p className="mb-1 flex justify-between text-[11.5px] text-muted"><span>{label}</span><span className="num">{fmt(low)} – {fmt(high)}</span></p>
      <div className="relative h-1.5 rounded-full bg-gradient-to-r from-down-soft via-raised to-up-soft">
        <span className="absolute top-1/2 h-3.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-[left] duration-500" style={{ left: `${pos}%` }} />
      </div>
    </div>
  );
}

/** Today's levels as a ladder, highest first, with the price slotted in between; distance to each level beside it. */
function LevelLadder({ x, price }: { x: IndexLevels; price: number }) {
  const [all, setAll] = useState(false);
  const or = x.live?.openingRange;
  const base: [string, number][] = [['Yesterday high', x.high], ['Pivot', x.pivots.P], ['Yesterday low', x.low]];
  const levels: [string, number][] = all
    ? [['R3', x.pivots.R3], ['R2', x.pivots.R2], ['R1', x.pivots.R1], ['CPR top', x.cpr.top], ['CPR bottom', x.cpr.bottom], ['S1', x.pivots.S1], ['S2', x.pivots.S2], ['S3', x.pivots.S3], ...base]
    : base;
  if (or) levels.push(['Opening range high', or.high], ['Opening range low', or.low]);
  const sorted = [...levels].sort((a, b) => b[1] - a[1]);
  const firstBelow = sorted.findIndex(([, v]) => v <= price);
  const at = firstBelow === -1 ? sorted.length : firstBelow;
  const rows: ({ kind: 'level'; label: string; v: number } | { kind: 'price' })[] = [
    ...sorted.slice(0, at).map(([label, v]) => ({ kind: 'level' as const, label, v })),
    { kind: 'price' as const },
    ...sorted.slice(at).map(([label, v]) => ({ kind: 'level' as const, label, v })),
  ];
  return (
    <div className="flex min-h-0 flex-col">
      <p className="eyebrow mb-1.5 flex items-center gap-1.5">Levels for today <InfoTip label="About the levels">From yesterday's high, low and close: classic pivots (P, R1–R3, S1–S3) and the central pivot range (CPR). A red dot sits above the price and may act as resistance; a green dot sits below and may act as support. Beside each level: how far it is from the price.</InfoTip>
        <button type="button" onClick={() => setAll((a) => !a)} className="ml-auto inline-flex items-center gap-1 normal-case tracking-normal text-[12px] font-semibold text-accent-deep hover:underline">
          {all ? 'Fewer' : 'All levels'}<ChevronDown size={13} className={`transition-transform ${all ? 'rotate-180' : ''}`} />
        </button>
      </p>
      <ol className="min-h-0 flex-1 overflow-y-auto text-[13px]">
        {rows.map((r, i) => r.kind === 'price' ? (
          <li key="price" className="my-1 flex items-center justify-between rounded-[10px] bg-accent-soft px-2.5 py-1.5 font-semibold text-accent-deep">
            <span>Now</span><span className="num">{fmt(price)}</span>
          </li>
        ) : (
          <li key={r.label} className={`group flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 hover:bg-raised ${i === at - 1 || i === at + 1 ? 'font-semibold' : ''}`}>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.v > price ? 'bg-down' : 'bg-up'}`} aria-hidden="true" />
            <span className="flex-1 text-ink-2">{r.label}</span>
            <span className="num text-[11.5px] text-muted opacity-70 group-hover:opacity-100">{Math.abs(r.v - price) < 0.005 ? 'at the price' : `${r.v > price ? '+' : '−'}${fmt(Math.abs(r.v - price))} · ${(Math.abs(r.v - price) / price * 100).toFixed(2)}%`}</span>
            <span className="num w-[78px] text-right">{fmt(r.v)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
