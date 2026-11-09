'use client';

import { useMemo, useState } from 'react';
import { Segmented } from '@/components/ui';
import { InfoTip } from '@/components/info-tip';
import { useFeed } from '@/lib/feed';
import { Card } from '../tool-shell';
import { Lines, Money, Table, inr } from './selling-charts';

// Put calendars on every month pair, from apps/feed/scripts/selling-calendar.ts (pairs 1/2, 1/3, 2/3 with three strikes)
// and selling-calendar-far.ts (the n-th listed contract against the next, up to 12 months out).
type Trade = { entry: string; exit: string; sold: string; bought: string; soldDays?: number; boughtDays?: number; strike: number; spotIn: number; spotOut: number; move: number; hi: boolean | null; rank: number | null; debit: number; net: number; worstMtm: number; worstOn: string };
type Near = { tests: { a: number; b: number; off: number; exit: string; skipped: Record<string, number>; trades: Trade[] }[] };
type Far = { tests: { n: number; off: number; exit: string; skipped: Record<string, number>; trades: Trade[] }[] };
type Test = { pair: string; sold: number; off: number; exit: string; skipped: Record<string, number>; trades: Trade[] };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function SellingCalendars() {
  const near = useFeed<Near>('selling-research/calendar'), far = useFeed<Far>('selling-research/calendar-far');
  const [off, setOff] = useState<'0' | '2' | '4'>('0');
  const [exit, setExit] = useState<'expiry' | '21'>('21');
  const [iv, setIv] = useState<'all' | 'high' | 'low'>('all');
  const [pick, setPick] = useState('2/3');
  const [result, setResult] = useState<'all' | 'won' | 'lost'>('all');
  const tests = useMemo<Test[]>(() => {
    if (!near.data || !far.data) return [];
    return [
      ...near.data.tests.map((t) => ({ pair: `${t.a}/${t.b}`, sold: t.a, off: t.off, exit: t.exit, skipped: t.skipped, trades: t.trades })),
      ...far.data.tests.filter((t) => t.n >= 3).map((t) => ({ pair: `${t.n}/${t.n + 1}`, sold: t.n, off: t.off, exit: t.exit, skipped: t.skipped, trades: t.trades })),
    ];
  }, [near.data, far.data]);
  if (!near.data || !far.data) return <Card><p className="p-4 text-[13px] text-muted">{near.error ?? far.error ?? 'Loading…'}</p></Card>;
  const keep = (t: Trade) => (iv === 'all' ? true : iv === 'high' ? t.hi === true : t.hi === false);
  const pairs = [...new Set(tests.map((t) => t.pair))].sort();
  const rows = pairs.map((p) => {
    const t = tests.find((x) => x.pair === p && String(x.off) === off && x.exit === exit);
    if (!t) return { p, t: null, s: null };
    const tr = t.trades.filter(keep), n = tr.map((x) => x.net), years = tr.length ? Math.max(0.25, (Date.parse(tr.at(-1)!.exit) - Date.parse(tr[0].entry)) / (365.25 * 86400_000)) : 1;
    return { p, t, s: tr.length ? { n: tr.length, won: Math.round((n.filter((x) => x > 0).length / n.length) * 100), total: sum(n), perYear: sum(n) / years, worst: Math.min(...n), worstMtm: Math.min(...tr.map((x) => x.worstMtm)), days: Math.round(sum(tr.map((x) => (Date.parse(x.sold) - Date.parse(x.entry)) / 86400_000)) / tr.length), bdays: Math.round(sum(tr.map((x) => (Date.parse(x.bought) - Date.parse(x.entry)) / 86400_000)) / tr.length) } : null };
  });
  const sel = rows.find((r) => r.p === pick && r.t) ?? rows.find((r) => r.t);
  const list = (sel?.t?.trades ?? []).filter(keep).filter((t) => (result === 'all' ? true : result === 'won' ? t.net > 0 : t.net <= 0));
  let eq = 0; const curve: [string, number][] = (sel?.t?.trades ?? []).filter(keep).map((t) => [t.exit, (eq += t.net)]);
  return (
    <div className="flex flex-col gap-3">
      <Card title={<span className="flex items-center gap-1.5">Put calendars<InfoTip label="About this test">Sell a put on one expiry and buy a put on a later one, same strike. Month 1 is the first monthly expiry after entry. After the 3rd month NSE lists only quarterly and half-yearly contracts, so pairs from 3/4 on use the next listed contract and trade rarely. Entry at the close of the first trading day after a monthly expiry, one position at a time; both legs must have traded that day. NIFTY, 1 lot at today&apos;s index level, after charges and ₹1 slippage per leg; far contracts usually cost more to trade than that.</InfoTip></span>}>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <Segmented label="Strike" value={off} onChange={setOff} options={[{ value: '0', label: 'At the money' }, { value: '2', label: '2% below', title: 'Only for pairs 1/2, 1/3 and 2/3' }, { value: '4', label: '4% below' }]} />
          <Segmented label="Exit" value={exit} onChange={setExit} options={[{ value: '21', label: '21 days left' }, { value: 'expiry', label: 'At the sold expiry' }]} />
          <Segmented label="IV" value={iv} onChange={setIv} options={[{ value: 'all', label: 'Every month' }, { value: 'high', label: 'High IV' }, { value: 'low', label: 'Low IV' }]} />
        </div>
      </Card>
      <Card title="Every pair" right={<span>Tap a row to see its trades</span>}>
        <Table head={['Sell / buy', 'Days to expiry', 'Trades', 'Won', 'Total', 'Profit a year', 'Worst trade', 'Worst MTM']} rows={rows.map((r) => [
          <button key="p" type="button" onClick={() => setPick(r.p)} className={`font-semibold ${sel?.p === r.p ? 'text-accent-deep' : ''}`}>{r.p}</button>,
          r.s ? `${r.s.days} → ${r.s.bdays}` : '–', r.s?.n ?? (r.t ? 0 : 'not tested'), r.s ? `${r.s.won}%` : '–', r.s ? <Money key="t" v={r.s.total} /> : '–', r.s ? <Money key="y" v={r.s.perYear} /> : '–', r.s ? <Money key="w" v={r.s.worst} /> : '–', r.s ? <Money key="m" v={r.s.worstMtm} /> : '–',
        ])} />
      </Card>
      {sel?.t && <>
        {curve.length > 1 && <Card title={`Running total: sell ${sel.p.split('/')[0]}, buy ${sel.p.split('/')[1]}`}><Lines series={[{ name: `Sell ${sel.p}`, pts: curve }]} /></Card>}
        <Card title={`${list.length} trades: sell ${sel.p.split('/')[0]}, buy ${sel.p.split('/')[1]}`} right={<Segmented label="Result" value={result} onChange={setResult} options={[{ value: 'all', label: 'All' }, { value: 'won', label: 'Won' }, { value: 'lost', label: 'Lost' }]} />}>
          <Table tall head={['Entry', 'Exit', 'Sold expiry', 'Bought expiry', 'Strike', 'NIFTY in', 'NIFTY out', 'Move', 'IV', 'Debit', 'Profit', 'Worst MTM']} rows={[...list].reverse().map((t) => [t.entry, t.exit, t.sold, t.bought, t.strike.toLocaleString('en-IN'), t.spotIn.toLocaleString('en-IN'), t.spotOut.toLocaleString('en-IN'), `${t.move}%`, t.hi == null ? '–' : t.hi ? 'High' : 'Low', inr(t.debit), <Money key="n" v={t.net} />, <Money key="m" v={t.worstMtm} />])} />
        </Card>
        {Object.keys(sel.t.skipped).length > 0 && <Card title="Months that could not be tested"><Table head={['Why', 'Count']} rows={Object.entries(sel.t.skipped).map(([w, c]) => [w, c])} /></Card>}
      </>}
    </div>
  );
}
