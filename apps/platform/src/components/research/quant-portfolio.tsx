'use client';

// The ₹5 lakh portfolio: the four option rules that worked, every mix of them on ₹5 lakh with 1 NIFTY lot each, which
// mixes fit the money (margin + open loss), money over time against NIFTY, a bar per year, what did not work and what
// to keep in mind. Numbers come from the feed's /api/quant/portfolio (a saved run; nothing is re-run here).

import { useState } from 'react';
import { InfoTip } from '@/components/info-tip';
import { Segmented } from '@/components/ui';
import { useFeed } from '@/lib/feed';
import type { Portfolio, PortfolioRow } from '@/lib/quant';
import { Card } from '../tools/tool-shell';
import { Lines, Table, inr, tone } from '../tools/options/selling-charts';
import { YearBars } from './quant-simple';

const BOOK: Record<string, { name: string; what: string }> = {
  S: { name: '45-day straddle (VIX filter)', what: 'Sell the ATM call and put 45 days before the monthly expiry when India VIX is above its 25th percentile of the past year. Take profit at 50% of the credit, stop at a loss equal to the credit, else exit with 21 days left.' },
  F: { name: 'Weekend (Friday → Tuesday)', what: 'Sell the 0.30-delta call and put at Friday’s close and buy the 0.05-delta call and put as wings. Hold to Tuesday expiry. Only exists since Tuesday expiry began (Sep 2025).' },
  P: { name: 'Monthly put', what: 'Sell the 0.30-delta put 45 days before the monthly expiry, every month. Exit with 21 days left.' },
  W: { name: 'Weekly Monday → expiry', what: 'Sell the 0.16-delta call and put at Monday’s close in high-IV weeks. Hold to the weekly expiry.' },
};
const RECOMMENDED = 'S+F';
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(d)}%`);
const lakh = (v: number) => `₹${(v / 100_000).toFixed(1)} lakh`;
const mixName = (names: string) => names.split('+').map((k) => BOOK[k]?.name ?? k).join(' + ');

const DIDNT = [
  'Predicting direction: 120 daily/weekly indicators and 595 intraday ones; none held up on unseen years.',
  'Momentum, 52-week breakouts, weekly lower-Bollinger buys, trend switches: luck, or falls of 40% and more.',
  'Stock options, the results-day straddle, long far-expiry straddles.',
  'Straddle add-ons: gap exits, rebalancing, loss caps. All made it worse.',
  'Selling at Friday’s close and buying back Monday morning (the weekend alone).',
];
const CONSIDER = [
  'Gap risk is the real cost. Every rule here holds short options overnight. One bad gap (Covid, election day) can take months of profit.',
  'Size by the worst case, not the average. The table’s “money needed” is margin plus the deepest open loss.',
  'The 45-day straddle and the monthly put are the same bet in the same months. Together they lost ₹1.94 lakh on 23 Mar 2020.',
  'Costs matter. ₹1 more slippage per option takes 25–50% of a weekly rule’s profit. The Trade lab paper tests measure real fills.',
  'The Tuesday-expiry era is short (since Sep 2025, about 45 weeks). Treat recent numbers as an early sign.',
  'The weekly rule has weakened lately: since Sep 2025 the high-IV version is down ₹10.7k (24 of 30 weeks won, but two big losses).',
  'High-volatility years carry the profit. Quiet years make little.',
  'Keep unused cash in LIQUIDBEES or a deposit. It earns about 6–7% on top (an estimate, not tested here).',
];

export function QuantPortfolio() {
  const { data, error } = useFeed<Portfolio>('quant/portfolio');
  const [period, setPeriod] = useState<'long' | 'recent'>('long');
  if (error) return <p className="text-[13px] text-down">{error}</p>;
  if (!data) return <p className="text-[13px] text-muted">Loading…</p>;
  const from = period === 'long' ? data.from : data.recent;
  const rows = data.rows.filter((r) => r.from === from).sort((a, b) => b.perYear - a.perYear);
  const long = data.rows.filter((r) => r.from === data.from);
  const rec = long.find((r) => r.names === RECOMMENDED), all = long.find((r) => r.names === 'W+S+P+F');
  const recRecent = data.rows.find((r) => r.from === data.recent && r.names === RECOMMENDED);
  const series = [rec, all].filter((r): r is PortfolioRow => !!r);
  const years = Object.keys(rec?.byYear ?? {}).sort();

  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-1.5">Best mix for ₹5 lakh <InfoTip label="How this was tested">
        <p>Four option rules that worked on their own, run together on ₹5 lakh with 1 NIFTY lot each, from Jan 2016 to {data.to}. Money is at today’s index level and lot size (65). Charges and ₹1 slippage per option per fill are included. Closes only: what happens inside a day is not seen.</p>
        <p>“Money needed” on a day = margin for the open trades (today’s SPAN + exposure, an estimate) plus the fall from the best balance so far. A mix fits when that never passed ₹5 lakh.</p>
        <p>Not a fresh test: each rule was chosen on this same data; only the mix is new. Expect a little less live. Script: apps/feed/scripts/research/theta/portfolio.ts.</p>
      </InfoTip></span>}>
        <div className="grid gap-2 p-4 text-[13.5px] leading-relaxed">
          <p><b>Verdict:</b> on ₹5 lakh, run the <b>{mixName(RECOMMENDED)}</b>. About <b>{inr(rec?.perYear)} a year ({pct(rec?.cagrPct)})</b> since 2016. Biggest fall {pct(rec?.maxDdPct)}, worst day {inr(rec?.worstDay)} on {rec?.worstDayOn}. Money needed at most {rec ? lakh(rec.need) : '–'}.</p>
          <p>All four together made more ({inr(all?.perYear)} a year, {pct(all?.cagrPct)}), but needed {all ? lakh(all.need) : '–'} and fell {pct(all?.maxDdPct)}: too much for ₹5 lakh.</p>
          <p>For comparison, simply holding NIFTY made {pct(data.nifty.cagrPct)} a year (price only, before dividends), more than this mix, but it fell {pct(data.nifty.maxDdPct)} at its worst. The option mix earns less but falls less, and its margin can sit in LIQUIDBEES earning interest.</p>
          <p className="text-ink-2">Since Tuesday expiry began (Sep 2025) the recommended mix made {pct(recRecent?.cagrPct)} a year with a {pct(recRecent?.maxDdPct)} fall. That is only about 14 months, so don’t count on it. 30% a year is not supported by any mix.</p>
        </div>
      </Card>

      <Card title="Every mix, 1 lot each, on ₹5 lakh" right={<Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'long', label: 'Since 2016' }, { value: 'recent', label: 'Since Sep 2025' }]} />}>
        <Table head={['Mix', 'Per year', 'A year', 'Biggest fall', 'Worst day', 'Money needed', 'Fits ₹5 lakh']} rows={rows.map((r) => [
          <span key="n" className={r.names === RECOMMENDED ? 'font-semibold' : ''}>{mixName(r.names)}{r.names === RECOMMENDED ? ' (recommended)' : ''}</span>,
          <span key="y" className={tone(r.perYear)}>{inr(r.perYear)}</span>, pct(r.cagrPct), pct(r.maxDdPct),
          <span key="d" className="text-down">{inr(r.worstDay)} <span className="text-muted">{r.worstDayOn}</span></span>,
          lakh(r.need), r.fits ? <span key="f" className="text-up">Yes</span> : <span key="f" className="text-down">No</span>,
        ])} />
        {period === 'long' && <p className="px-4 pb-3 pt-1 text-[12px] text-muted">The weekend rule only has trades since Sep 2025, so before that a mix with it is the same as the mix without it.</p>}
      </Card>

      {series.length > 0 && (
        <Card title="₹5 lakh over time">
          <Lines series={[...series.map((r, i) => ({ name: mixName(r.names), pts: r.curve, color: COLORS[i] })), { name: 'NIFTY (bought and held)', pts: data.nifty.curve, color: COLORS[2] }]} />
        </Card>
      )}
      {years.length > 0 && (
        <Card title="Each year">
          <YearBars years={years} holdoutFrom="9999" series={[...series.map((r, i) => ({ name: mixName(r.names), color: COLORS[i], byYear: r.byYear })), { name: 'NIFTY', color: COLORS[2], byYear: data.nifty.byYear }]} />
        </Card>
      )}

      <Card title="The four rules">
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {Object.entries(BOOK).map(([k, b]) => {
            const s = data.books[k];
            return (
              <div key={k} className="rounded-[10px] border border-line p-3 text-[13px] leading-relaxed">
                <p className="font-semibold">{b.name}</p>
                <p className="text-ink-2">{b.what}</p>
                {s && <p className="num mt-1 text-[12.5px] text-muted">{s.trades} trades since {s.from} · {s.wonPct}% won · total <span className={tone(s.total)}>{inr(s.total)}</span> · worst trade <span className="text-down">{inr(s.worstTrade)}</span> · margin about {inr(s.margin)}</p>}
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="What didn’t work">
          <ul className="grid list-disc gap-1.5 p-4 pl-8 text-[13px] leading-relaxed">{DIDNT.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
        <Card title="Things to keep in mind">
          <ul className="grid list-disc gap-1.5 p-4 pl-8 text-[13px] leading-relaxed">{CONSIDER.map((x) => <li key={x}>{x}</li>)}</ul>
        </Card>
      </div>
    </div>
  );
}
