'use client';

import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';
import { Money, Table, inr, tone } from './selling-charts';

// Where the option-selling research stands, from apps/feed/scripts/selling-conclusion.ts (figures computed from the saved
// studies, not typed in).
type S = { trades: number; won: number; total: number; perYear: number; avgWin: number; avgLoss: number; wonOverLost: number | null; worst: number; worstMtm: number; losingYears: number; yearCount: number; since2023: number };
type Data = {
  from: string; to: string; lot: number; spot: number;
  best: { id: string; name: string; margin: number | null; full: S; to2020: S; from2021: S; everyMonth: S; everyMonthFrom2016: S; highFrom2016: S }[];
  crashPut: { name: string; trades: number; noPutMonths: number; without: { total: number; worstMtm: number }; with: { total: number; worstMtm: number } }[];
  vix: { correlation: number; days: number; avgVix: number; avgAtm: number; coverage: Record<string, number>; rules: { name: string; agree: number; trades: number; atm: S; vix: S }[] };
  search: { shapes: number; combinations: number; passed: number; top: { family: string; params: number[]; frame: string; exit: string; iv: string; stop: number | null; margin: number | null; train: { n: number; won: number; perYear: number }; test: { n: number; won: number; perYear: number; total: number } }[] };
  calendars: ({ n: number; trades: number } & Partial<S> & { off?: number; exit?: string; soldDays?: number; boughtDays?: number })[];
  ideas: { combo: { total: number; losingYears: number; yearCount: number; doubleWin: number; doubleLoss: number }; weekly: { total: number; since2023: number; losingYears: number; yearCount: number }; yearly: { years: number; total: number } };
};
const CAPITAL = 500000;
const pct = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
const FRAME: Record<string, string> = { '2m': '2nd month', '3m': '3rd month', yearly: 'Jan → Dec' };

export function SellingConclusion() {
  const { data, error } = useFeed<Data>('selling-research/conclusion');
  if (!data) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const top = data.best[0], about = <InfoTip label="How these figures are made">NIFTY, 1 lot of {data.lot} at today&apos;s index level ({data.spot.toLocaleString('en-IN')}), after charges and ₹1 slippage per leg, {data.from} to {data.to}. Daily closes only: a move during the day or a gap can go deeper than any worst MTM shown. Profit a year is total profit divided by the years covered.</InfoTip>;
  return (
    <div className="flex flex-col gap-3">
      <div className="panel flex flex-col gap-2 p-4">
        <p className="flex items-center gap-1.5 text-[16px] font-extrabold">One edge held up: sell options when fear is high, about 45 days before the monthly expiry, out with 21 days left.{about}</p>
        <p className="text-[13px] text-ink-2">Nothing else we tested (video and workshop ideas, your own shapes, calendars, and a search of {data.search.combinations.toLocaleString('en-IN')} combinations) did better on years it had not seen. No strategy wins every time: the best still loses about 1 trade in 5.</p>
      </div>

      <Card title="What works: high IV, 45 → 21 days, no crash put">
        <Table head={['Rule', 'Trades', 'Won', 'Profit a year', '2011–20 a year', '2021–26 a year', 'Wins ÷ losses', 'Worst trade', 'Worst MTM', 'Losing years', 'Since 2023', 'Margin today']} rows={data.best.map((b) => [
          <b key="n">{b.name}</b>, b.full.trades, `${b.full.won}%`, <Money key="y" v={b.full.perYear} />, <Money key="a" v={b.to2020.perYear} />, <Money key="b" v={b.from2021.perYear} />, b.full.wonOverLost != null ? `${b.full.wonOverLost}×` : '–',
          <Money key="w" v={b.full.worst} />, <Money key="m" v={b.full.worstMtm} />, `${b.full.losingYears} of ${b.full.yearCount}`, <Money key="s" v={b.full.since2023} />, inr(b.margin),
        ])} />
        <p className="border-t border-line px-4 py-3 text-[13px] text-ink-2">Profit a year was about the same in 2011–20 and 2021–26: that is what a real edge looks like. The average loss is bigger than the average win ({top.name}: {inr(top.full.avgWin)} against {inr(top.full.avgLoss)}), but wins come about four times as often.</p>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title={<span className="flex items-center gap-1.5">The high-IV filter<InfoTip label="About the filter">IV above the median of the previous 250 trading days on the entry day. From 2016 on, trading every month made more in total, but each normal-IV month paid much less for similar risk.</InfoTip></span>}>
          <Table head={['Rule', 'Every month', 'High IV only', 'Every month, 2016 on', 'High IV, 2016 on']} rows={data.best.map((b) => [
            b.name, <span key="a"><Money v={b.everyMonth.perYear} /> ({b.everyMonth.trades})</span>, <span key="b"><Money v={b.full.perYear} /> ({b.full.trades})</span>,
            <span key="c"><Money v={b.everyMonthFrom2016.perYear} /> ({b.everyMonthFrom2016.trades})</span>, <span key="d"><Money v={b.highFrom2016.perYear} /> ({b.highFrom2016.trades})</span>,
          ])} />
        </Card>
        <Card title={<span className="flex items-center gap-1.5">The crash put, on the same entries<InfoTip label="About this comparison">The crash put version only trades when a put about 15% below traded that day, so both columns use exactly those entries.</InfoTip></span>}>
          <Table head={['Rule', 'Trades', 'Without put', 'With put', 'Worst MTM without', 'Worst MTM with']} rows={data.crashPut.map((c) => [c.name, c.trades, <Money key="a" v={c.without.total} />, <Money key="b" v={c.with.total} />, <Money key="c" v={c.without.worstMtm} />, <Money key="d" v={c.with.worstMtm} />])} />
          <p className="border-t border-line px-4 py-3 text-[13px] text-ink-2">The put roughly halved the profit and did not reduce the worst daily-close loss. It only protects against a sudden gap.</p>
        </Card>
      </div>

      <Card title={<span className="flex items-center gap-1.5">India VIX or our IV, 2016 on<InfoTip label="About VIX history">Our India VIX history is complete only from 2015 (2012: {data.vix.coverage['2012'] ?? 0} days, 2013: {data.vix.coverage['2013'] ?? 0}), so this starts in 2016.</InfoTip></span>} right={<span>They move together: correlation {data.vix.correlation}, average VIX {data.vix.avgVix} against our IV {data.vix.avgAtm}</span>}>
        <Table head={['Rule', 'Same answer', 'Our IV: a year', 'Our IV: won', 'VIX: a year', 'VIX: won']} rows={data.vix.rules.map((r) => [r.name, `${r.agree} of ${r.trades} months`, <Money key="a" v={r.atm.perYear} />, `${r.atm.won}%`, <Money key="b" v={r.vix.perYear} />, `${r.vix.won}%`])} />
        <p className="border-t border-line px-4 py-3 text-[13px] text-ink-2">Either works. VIX is easy to check on Kite; the difference is within chance.</p>
      </Card>

      <Card title={<span className="flex items-center gap-1.5">Strategy search: chosen on 2011–20, checked on 2021–26<InfoTip label="About the search">{data.search.shapes} shapes of bought and sold options on 2nd-month, 3rd-month and January → December expiries, with exits, IV filters and portfolio stops: {data.search.combinations.toLocaleString('en-IN')} combinations. {data.search.passed} passed every rule on 2011–20. See the Strategy search tab for all of them.</InfoTip></span>}>
        <Table head={['Shape', 'Expiry', '2011–20 a year', '2021–26 a year', '2021–26 trades', '2021–26 won', 'Margin']} rows={[
          ...data.search.top.map((r) => [`${r.family} [${r.params.join(', ')}]${r.iv === 'high' ? ', high IV' : ''}${r.stop ? `, stop ${r.stop * 100}%` : ''}`, `${FRAME[r.frame]}, exit ${r.exit === '21' ? '21 days' : 'expiry'}`, <Money key="a" v={r.train.perYear} />, <Money key="b" v={r.test.perYear} />, r.test.n, `${r.test.won}%`, inr(r.margin)]),
          [<b key="t">{top.name} (for comparison)</b>, 'Monthly, 45 → 21 days', <Money key="a" v={top.to2020.perYear} />, <Money key="b" v={top.from2021.perYear} />, top.from2021.trades, `${top.from2021.won}%`, inr(top.margin)],
        ]} />
        <p className="border-t border-line px-4 py-3 text-[13px] text-ink-2">Most winners lost half or more of their profit on the years they had not seen. Results from a handful of trades are not proof.</p>
      </Card>

      <div className="grid gap-3 md:grid-cols-2">
        <Card title={<span className="flex items-center gap-1.5">Put calendars, best version of each pair<InfoTip label="About calendars">Sell the n-th listed contract, buy the next one, same strike. Beyond the 3rd month only quarterly and half-yearly contracts exist and rarely trade. See the Calendars tab.</InfoTip></span>}>
          <Table head={['Sell / buy', 'Days to expiry', 'Trades', 'Profit a year', 'Won']} rows={data.calendars.map((c) => [`${c.n} / ${c.n + 1}`, c.soldDays ? `${c.soldDays} → ${c.boughtDays}` : '–', c.trades, c.trades ? <Money key="y" v={c.perYear} /> : 'not testable', c.trades ? `${c.won}%` : '–'])} />
        </Card>
        <Card title="Ideas from outside, as written">
          <Table head={['Idea', 'Result']} rows={[
            ['Volatile + range-bound (Bank Nifty, 1 month)', <span key="a"><Money v={data.ideas.combo.total} />, lost {data.ideas.combo.losingYears} of {data.ideas.combo.yearCount} years; {data.ideas.combo.doubleLoss} months both parts lost, {data.ideas.combo.doubleWin} both won</span>],
            ['Weekly future + put ("195% in 12 weeks")', <span key="b"><Money v={data.ideas.weekly.total} /> since 2019, <Money v={data.ideas.weekly.since2023} /> since 2023</span>],
            ['Yearly ITM call ratio (first screenshot)', <span key="c"><Money v={data.ideas.yearly.total} /> over {data.ideas.yearly.years} years on traded prices</span>],
          ]} />
        </Card>
      </div>

      <Card title="Risk and money">
        <div className="grid gap-4 p-4 text-[13px] md:grid-cols-3">
          <div><p className="text-[11px] font-semibold text-muted">{top.name}, 1 lot</p><p className={`text-[22px] font-bold ${tone(top.full.perYear)}`}>{inr(top.full.perYear)} a year</p><p className="text-ink-2">{pct((top.full.perYear / CAPITAL) * 100)} of ₹5 lakh, {pct((top.full.perYear / (top.margin ?? 1)) * 100)} of its margin</p></div>
          <div><p className="text-[11px] font-semibold text-muted">Worst open loss, daily closes</p><p className="text-[22px] font-bold text-down">{inr(top.full.worstMtm)}</p><p className="text-ink-2">{pct((-top.full.worstMtm / CAPITAL) * 100)} of ₹5 lakh. A gap can go deeper, so keep a portfolio stop.</p></div>
          <div><p className="text-[11px] font-semibold text-muted">Losing years</p><p className="text-[22px] font-bold">{top.full.losingYears} of {top.full.yearCount}</p><p className="text-ink-2">Estimate with pledged capital earning about 7–8%: roughly 15–17% a year in all, not 30%.</p></div>
        </div>
      </Card>

      <Card title="Next steps">
        <ol className="flex list-decimal flex-col gap-1.5 py-3 pl-9 pr-4 text-[13px]">
          <li>Paper trade from the next entry day: the 0.25 strangle with a 15–20% portfolio stop, next to the two current paper rules.</li>
          <li>Run at least three monthly cycles and compare each paper trade with the backtest.</li>
          <li>Only then consider one real lot, with orders approved by tap.</li>
        </ol>
      </Card>
    </div>
  );
}
