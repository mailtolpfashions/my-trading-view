'use client';

import { useMemo, useState } from 'react';
import { Segmented, inputCls } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';
import { Money, Table, inr } from './selling-charts';

// Every combination from the strategy search (apps/feed/scripts/selling-search.ts), slimmed by selling-conclusion.ts:
// [family, params, frame, exit, iv, stop, margin, trainN, trainWon, trainYear, trainPf, trainWorstMtm, trainH1, trainH2,
//  testN, testWon, testYear, testTotal, testWorst, passed]
type RowT = [string, number[], string, string, string, number | null, number | null, number, number, number, number, number, number, number, number, number, number, number, number, number];
type Data = { shapes: number; stops: number[]; rows: RowT[] };
const FRAME: Record<string, string> = { '2m': '2nd month', '3m': '3rd month', yearly: 'Jan → Dec' };
const o = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`;
// The legs of each family, from its parameters (strike offsets from NIFTY at entry).
const LEGS: Record<string, (p: number[]) => string> = {
  'Bull put spread': ([a, b]) => `Sell PE ${o(a)}, buy PE ${o(b)}`,
  'Bull call spread': ([a, b]) => `Buy CE ${o(a)}, sell CE ${o(b)}`,
  Seagull: ([a, b, c]) => `Buy CE ${o(a)}, sell CE ${o(b)}, sell PE ${o(c)}`,
  'Seagull + put': ([a, b, c, d]) => `Buy CE ${o(a)}, sell CE ${o(b)}, sell PE ${o(c)}, buy PE ${o(d)}`,
  'Call ratio + put': ([a, b, c]) => `Buy CE ${o(a)}, sell 2× CE ${o(b)}, sell PE ${o(c)}`,
  'Call ratio + put spread': ([a, b, c, d]) => `Buy CE ${o(a)}, sell 2× CE ${o(b)}, sell PE ${o(c)}, buy PE ${o(d)}`,
  'Risk reversal': ([c, a]) => `Sell PE ${o(c)}, buy CE ${o(a)}`,
  'Jade lizard': ([c, a, b]) => `Sell PE ${o(c)}, sell CE ${o(a)}, buy CE ${o(b)}`,
  'Bullish condor': ([c, d, a, b]) => `Sell PE ${o(c)}, buy PE ${o(d)}, sell CE ${o(a)}, buy CE ${o(b)}`,
  'Broken-wing call fly': ([a, b, c]) => `Buy CE ${o(a)}, sell 2× CE ${o(b)}, buy CE ${o(c)}`,
  'Short strangle': ([c, a]) => `Sell PE ${o(c)}, sell CE ${o(a)}`,
  'Short strangle + crash put': ([c, a, d]) => `Sell PE ${o(c)}, sell CE ${o(a)}, buy PE ${o(d)}`,
};
const selectCls = `${inputCls} h-8 !rounded-[9px] px-2 text-[13px]`;

export function SellingSearch() {
  const { data, error } = useFeed<Data>('selling-research/search-ui');
  const [family, setFamily] = useState('all');
  const [frame, setFrame] = useState<'all' | '2m' | '3m' | 'yearly'>('all');
  const [exit, setExit] = useState<'all' | 'expiry' | '21'>('all');
  const [iv, setIv] = useState<'all' | 'every' | 'high'>('all');
  const [stop, setStop] = useState('all');
  const [passed, setPassed] = useState<'passed' | 'all'>('passed');
  const [sort, setSort] = useState<'test' | 'train'>('test');
  const families = useMemo(() => [...new Set((data?.rows ?? []).map((r) => r[0]))].sort(), [data]);
  const list = useMemo(() => (data?.rows ?? []).filter((r) => (family === 'all' || r[0] === family) && (frame === 'all' || r[2] === frame) && (exit === 'all' || r[3] === exit) && (iv === 'all' || (iv === 'every' ? r[4] === 'all' : r[4] === 'high')) && (stop === 'all' || String(r[5] ?? 'none') === stop) && (passed === 'all' || r[19] === 1))
    .sort((a, b) => (sort === 'test' ? b[16] - a[16] : b[9] - a[9])), [data, family, frame, exit, iv, stop, passed, sort]);
  if (!data) return <Card><p className="p-4 text-[13px] text-muted">{error ?? 'Loading…'}</p></Card>;
  const shown = list.slice(0, 300), profitable = list.filter((r) => r[17] > 0).length;
  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-1.5">Strategy search<InfoTip label="About the search">{data.shapes} shapes of bought and sold options, strikes from 30% below to 30% above NIFTY at entry. Expiries: 2nd month (~60 days), 3rd month (~90 days), and last Monday of January → December. Exit at expiry or with 21 days left; every month or high-IV months; portfolio stop of none, 10%, 15% or 20% of ₹5 lakh, checked at daily closes. Chosen on 2011–2020 only: at least 70% won, wins at least 1.5× losses, profit in 2011–15 and 2016–20, worst loss within ₹1 lakh, margin within ₹3 lakh, and most neighbouring shapes also profitable. 2021–26 is the check on unseen years. NIFTY, 1 lot per leg at today&apos;s index level, after charges and ₹1 slippage. Margin leaves out the cost of bought options.</InfoTip></span>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Show" value={passed} onChange={setPassed} options={[{ value: 'passed', label: 'Passed on 2011–20' }, { value: 'all', label: 'All combinations' }]} />
          <Segmented label="Expiry" value={frame} onChange={setFrame} options={[{ value: 'all', label: 'All expiries' }, { value: '2m', label: '2nd month' }, { value: '3m', label: '3rd month' }, { value: 'yearly', label: 'Jan → Dec' }]} />
          <Segmented label="Exit" value={exit} onChange={setExit} options={[{ value: 'all', label: 'Any exit' }, { value: '21', label: '21 days left' }, { value: 'expiry', label: 'At expiry' }]} />
          <Segmented label="IV" value={iv} onChange={setIv} options={[{ value: 'all', label: 'Any' }, { value: 'every', label: 'Every month' }, { value: 'high', label: 'High IV' }]} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line p-3 text-[13px] text-ink-2">
          <label className="flex items-center gap-1.5">Shape <select aria-label="Shape" className={selectCls} value={family} onChange={(e) => setFamily(e.target.value)}><option value="all">All shapes</option>{families.map((f) => <option key={f}>{f}</option>)}</select></label>
          <label className="flex items-center gap-1.5">Stop <select aria-label="Portfolio stop" className={selectCls} value={stop} onChange={(e) => setStop(e.target.value)}><option value="all">Any</option><option value="none">None</option>{data.stops.map((s) => <option key={s} value={String(s)}>{s * 100}% of ₹5 lakh</option>)}</select></label>
          <Segmented label="Sort" value={sort} onChange={setSort} options={[{ value: 'test', label: 'Best 2021–26' }, { value: 'train', label: 'Best 2011–20' }]} />
        </div>
      </Card>
      <div className="panel p-4 text-[14px] font-semibold">{list.length.toLocaleString('en-IN')} combinations match; {profitable.toLocaleString('en-IN')} made money in 2021–26.{list.length > shown.length ? ` Showing the first ${shown.length}.` : ''}</div>
      <Card title="Results" right={<span>2011–20 chose them; 2021–26 is the check</span>}>
        <Table tall head={['Shape', 'Legs', 'Expiry', 'Exit', 'IV', 'Stop', 'Margin', '2011–20 trades', 'Won', 'A year', 'Wins ÷ losses', 'Worst MTM', '2021–26 trades', 'Won', 'A year', 'Total', 'Worst trade']} rows={shown.map((r) => [
          <b key="f">{r[0]}</b>, <span key="l" className="whitespace-normal text-[12px]">{LEGS[r[0]]?.(r[1]) ?? r[1].join(', ')}</span>, FRAME[r[2]], r[3] === '21' ? '21 days' : 'Expiry', r[4] === 'high' ? 'High' : 'Every', r[5] ? `${r[5] * 100}%` : 'None', inr(r[6]),
          r[7], `${r[8]}%`, <Money key="a" v={r[9]} />, `${r[10]}×`, <Money key="b" v={r[11]} />, r[14], `${r[15]}%`, <Money key="c" v={r[16]} />, <Money key="d" v={r[17]} />, <Money key="e" v={r[18]} />,
        ])} />
      </Card>
    </div>
  );
}
