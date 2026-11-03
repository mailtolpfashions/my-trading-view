'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bell, ChevronDown, Pencil } from 'lucide-react';
import { InfoTip } from '@/components/info-tip';
import { Button, Card, Segmented, inputCls } from '@/components/ui';
import { FeedError } from '@/lib/feed';
import { todayApi, type Brief, type Dashboard, type DaySettings, type IndexLevels } from '@/lib/today';

const fmt = (v: number | null | undefined, d = 2) => (v == null ? '–' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const sign = (v: number | null | undefined, d = 2) => (v == null ? '–' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? 'text-up' : 'text-down');
const NAMES: Record<string, string> = { NIFTY: 'NIFTY 50', BANKNIFTY: 'BANK NIFTY', FINNIFTY: 'FIN NIFTY', MIDCPNIFTY: 'MIDCAP SELECT' };
const MODES: Record<DaySettings['mode'], { label: string; tfs: string }> = {
  intraday: { label: 'Intraday', tfs: '1, 5 and 15 minutes, 1 hour' },
  swing: { label: 'Swing', tfs: 'daily, hourly for timing' },
  positional: { label: 'Positional', tfs: 'daily and weekly' },
};

export default function TodayPage() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [settings, setSettings] = useState<DaySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    todayApi.brief().then((b) => { setBrief(b); setError(null); }, (e: Error) => setError(e.message));
    todayApi.dashboard().then(setDash, () => {});
  }, []);
  useEffect(() => {
    load();
    todayApi.settings().then(setSettings, () => {});
    const t = setInterval(load, 60_000); // the live part moves during the session
    return () => clearInterval(t);
  }, [load]);
  const saveSettings = async (p: Partial<DaySettings>) => {
    try { setSettings(await todayApi.saveSettings({ ...settings, ...p })); } catch (e) { setError(e instanceof FeedError ? e.message : 'Could not save'); }
  };

  const nifty = brief?.indices.find((i) => i.symbol === 'NIFTY'), bank = brief?.indices.find((i) => i.symbol === 'BANKNIFTY');
  const opt = brief?.options?.find((o) => o.underlying === 'NIFTY');
  const day = brief ? new Date(`${brief.today}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '';

  return (
    <div className="mx-auto grid max-w-[1400px] gap-6">
      {/* Greeting and the day */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">
            {brief ? `${brief.greeting}${brief.name ? `, ${brief.name.split(' ')[0]}` : ''}.` : 'Today'}
          </h1>
          <p className="mt-1 text-[15px] text-ink-2">{day}{brief ? ` · ${brief.market.text}` : ''}</p>
        </div>
        {settings && (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-2">Today I&apos;m trading</span>
            <Segmented label="Mode" value={settings.mode} onChange={(m) => saveSettings({ mode: m })}
              options={[{ value: 'intraday', label: 'Intraday' }, { value: 'swing', label: 'Swing' }, { value: 'positional', label: 'Positional' }]} />
          </div>
        )}
      </div>
      {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
      {!brief && !error && <Card><p className="text-[14px] text-muted">Getting today&apos;s market picture…</p></Card>}

      {brief && (
        <>
          {/* Key numbers */}
          <section aria-label="Key numbers" className="panel grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-line [&>*:not(:last-child)]:border-r">
            {nifty && <Stat label="NIFTY 50" value={fmt(nifty.live?.ltp ?? nifty.close)} sub={sign(nifty.live?.changePct ?? nifty.changePct)} subTone={tone(nifty.live?.changePct ?? nifty.changePct)} />}
            {bank && <Stat label="BANK NIFTY" value={fmt(bank.live?.ltp ?? bank.close)} sub={sign(bank.live?.changePct ?? bank.changePct)} subTone={tone(bank.live?.changePct ?? bank.changePct)} />}
            {brief.vix && <Stat label="India VIX (fear gauge)" value={fmt(brief.vix.close)} sub={brief.vix.percentile < 30 ? 'Calm compared with the past year' : brief.vix.percentile > 70 ? 'High compared with the past year' : 'Normal for the past year'} />}
            {opt?.pcr != null && <Stat label="NIFTY put-call ratio" value={opt.pcr.toFixed(2)} sub={opt.pcr > 1.2 ? 'More put than call open interest' : opt.pcr < 0.8 ? 'More call than put open interest' : 'Puts and calls about even'} />}
            {dash?.fii && <Stat label="FIIs in index futures" value={`${((dash.fii.latest.futLong / (dash.fii.latest.futLong + dash.fii.latest.futShort)) * 100).toFixed(0)}% long`} sub={dash.fii.latest.futLong > dash.fii.latest.futShort ? 'More long than short' : 'More short than long'} />}
            {dash?.nifty500 && <Stat label="NIFTY 500 stocks" value={`${dash.nifty500.breadth.advances} up`} sub={`${dash.nifty500.breadth.declines} down, last session`} />}
          </section>

          {/* Today, and what needs you */}
          <div className="grid gap-5 lg:grid-cols-5">
            <section className="grid content-start gap-3 rounded-[var(--radius-panel)] bg-deep p-5 text-white lg:col-span-3">
              <p className="flex items-center gap-2 text-[15px] font-bold">
                {brief.live && <span className="live-dot h-2 w-2 rounded-full bg-up" />}{brief.live && (nifty?.live || bank?.live) ? 'Live now' : 'The market today'}
              </p>
              {[nifty, bank].map((x) => x && <MarketLine key={x.symbol} x={x} />)}
              {!brief.live && <p className="text-[12.5px] text-white/60">Connect Kite (top right) during market hours to see the session live here.</p>}
            </section>
            <Card title="Needs you" className="lg:col-span-2">
              <div className="grid gap-3 text-[14px]">
                <p className="flex items-center gap-2"><Bell size={15} className="text-accent-deep" />
                  {brief.needsYou.alertsToday ? <>{brief.needsYou.alertsToday} alert{brief.needsYou.alertsToday === 1 ? '' : 's'} fired today. <Link href="/alerts" className="font-semibold text-accent-deep hover:underline">See them</Link></> : 'No alerts have fired today.'}
                </p>
                {brief.needsYou.latest.map((a) => <p key={a.at} className="pl-6 text-[13px] text-ink-2">{a.name}: {a.symbols.join(', ')}</p>)}
                {settings && <DayRules s={settings} onSave={saveSettings} />}
                <Link href="/screener" className="inline-flex h-11 items-center justify-center gap-2 rounded-[12px] bg-inverse px-4 text-[14px] font-semibold text-on-inverse hover:bg-inverse-hover">
                  Find {settings ? MODES[settings.mode].label.toLowerCase() : ''} trades <ArrowRight size={15} />
                </Link>
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title={<span className="flex items-center gap-1.5">Options today <InfoTip label="About these numbers">From NSE&apos;s F&amp;O close of {brief.options?.[0]?.date ?? '–'}, nearest expiry. Open interest is the number of contracts still open; the biggest piles of call and put open interest are often watched as resistance and support.</InfoTip></span>}>
              <div className="grid gap-4">
                {brief.options?.map((o) => (
                  <div key={o.underlying} className="grid gap-1 text-[13.5px]">
                    <p className="font-semibold">{NAMES[o.underlying]} <span className="font-normal text-muted">· expiry {new Date(`${o.expiry}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ({o.daysToExpiry === 0 ? 'today' : `${o.daysToExpiry} day${o.daysToExpiry === 1 ? '' : 's'}`})</span></p>
                    {o.callWall != null && o.putWall != null && <p>Most call open interest at <b className="num">{fmt(o.callWall, 0)}</b>, most put open interest at <b className="num">{fmt(o.putWall, 0)}</b></p>}
                    {o.maxPain != null && <p className="text-ink-2">Max pain {fmt(o.maxPain, 0)}{o.pcr != null && ` · put-call ratio ${o.pcr.toFixed(2)}`}</p>}
                    {o.impliedMovePct != null && <p className="text-ink-2">The at-the-money straddle (₹{fmt(o.straddle, 0)}) prices a move of about ±{o.impliedMovePct.toFixed(1)}% by expiry</p>}
                    {o.atmIv != null && <p className="text-ink-2">Implied volatility {o.atmIv.toFixed(1)}%{o.ivPercentile != null && `, lower than ${100 - o.ivPercentile}% of the past year`}</p>}
                  </div>
                ))}
                {!brief.options?.length && <p className="text-[13.5px] text-muted">No F&amp;O data yet.</p>}
              </div>
            </Card>

            <Card title={<span className="flex items-center gap-1.5">Sudden volume <InfoTip label="How this is found">NIFTY 500 stocks trading far more than usual. During the session: volume so far today against the same time on the previous 20 sessions. After it: the last session against its 20-day average.</InfoTip></span>}>
              {brief.volumeSpikes.length ? (
                <ul className="grid gap-1.5 text-[13.5px]">
                  {brief.volumeSpikes.map((v) => (
                    <li key={v.symbol}>
                      <Link href={`/chart/${encodeURIComponent(v.symbol)}`} className="flex items-center justify-between rounded-[8px] px-2 py-1 hover:bg-raised">
                        <span className="font-semibold">{v.symbol}</span>
                        <span className="num text-ink-2">{v.rvol.toFixed(1)}× usual volume · <span className={tone(v.changePct)}>{sign(v.changePct, 1)}</span></span>
                      </Link>
                    </li>
                  ))}
                  <li className="px-2 text-[12px] text-muted">{brief.volumeSpikes[0].basis === 'today so far' ? 'Today so far, live' : 'Last session'}</li>
                </ul>
              ) : <p className="text-[13.5px] text-muted">No stock is trading far above its usual volume.</p>}
            </Card>

            {dash?.nifty50 && (
              <Card title="Biggest movers in NIFTY 50" actions={<span className="text-[12px] text-muted">{dash.asOf}</span>}>
                <div className="grid grid-cols-2 gap-4 text-[13.5px]">
                  {([['Up most', dash.nifty50.gainers], ['Down most', dash.nifty50.losers]] as const).map(([t, list]) => (
                    <div key={t}><p className="eyebrow mb-1">{t}</p>
                      {list.map((m) => <Link key={m.symbol} href={`/chart/${m.symbol}`} className="flex justify-between rounded-[8px] px-1 py-0.5 hover:bg-raised"><span>{m.symbol}</span><span className={`num ${tone(m.changePct)}`}>{sign(m.changePct, 1)}</span></Link>)}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card title="Sectors">
              <div className="grid grid-cols-2 gap-4 text-[13.5px]">
                {([['Strongest today', brief.sectors.slice(0, 5)], ['Weakest today', brief.sectors.slice(-5).reverse()]] as const).map(([t, list]) => (
                  <div key={t}><p className="eyebrow mb-1">{t}</p>
                    {list.map((s) => <p key={s.name} className="flex justify-between py-0.5"><span>{s.name.replace('NIFTY ', '')}</span><span className={`num ${tone(s.d1)}`}>{sign(s.d1, 1)}</span></p>)}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Levels: one simple line each, details on request */}
          <Card title="Key levels for today">
            <div className="grid gap-4 md:grid-cols-2">{brief.indices.filter((i) => i.symbol === 'NIFTY' || i.symbol === 'BANKNIFTY').map((x) => <Levels key={x.symbol} x={x} />)}</div>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, subTone = 'text-muted' }: { label: string; value: string; sub?: string; subTone?: string }) {
  return (
    <div className="px-4 py-3.5">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="num mt-0.5 text-[22px] font-bold tracking-[-0.01em]">{value}</p>
      {sub && <p className={`text-[12.5px] ${subTone || 'text-muted'}`}>{sub}</p>}
    </div>
  );
}

/** One index in plain sentences: live facts in the session, otherwise where it closed against its levels. */
function MarketLine({ x }: { x: IndexLevels }) {
  const lv = x.live;
  const above = (v: number | null) => v != null && (lv?.ltp ?? x.close) >= v;
  const trend = [above(x.trend.ema20) ? 'above' : 'below', 'its 20-day average', ...(x.trend.ema200 != null ? [`and ${above(x.trend.ema200) ? 'above' : 'below'} its 200-day average`] : [])].join(' ');
  return (
    <div className="text-[14px]">
      <p className="font-semibold">{NAMES[x.symbol]} <span className="num font-normal text-white/70">{fmt(lv?.ltp ?? x.close)} <span className={(lv?.changePct ?? x.changePct ?? 0) >= 0 ? 'text-[#5fe0b8]' : 'text-[#ff9aa0]'}>{sign(lv?.changePct ?? x.changePct)}</span></span></p>
      <ul className="mt-0.5 grid gap-0.5 text-white/80">
        {lv ? lv.facts.map((f) => <li key={f}>{f}</li>) : <li>Closed {sign(x.changePct)} on {x.session}, between {fmt(x.low, 0)} and {fmt(x.high, 0)}</li>}
        <li>Trading {trend}</li>
      </ul>
    </div>
  );
}

function Levels({ x }: { x: IndexLevels }) {
  const [more, setMore] = useState(false);
  const rows: [string, number][] = more
    ? [['R3', x.pivots.R3], ['R2', x.pivots.R2], ['R1', x.pivots.R1], ['Yesterday high', x.high], ['CPR top', x.cpr.top], ['Pivot', x.pivots.P], ['CPR bottom', x.cpr.bottom], ['Yesterday low', x.low], ['S1', x.pivots.S1], ['S2', x.pivots.S2], ['S3', x.pivots.S3]]
    : [['Yesterday high', x.high], ['Pivot', x.pivots.P], ['Yesterday low', x.low]];
  const price = x.live?.ltp ?? x.close;
  return (
    <div className="text-[13.5px]">
      <p className="mb-1 font-semibold">{NAMES[x.symbol]} <span className="num font-normal text-muted">now {fmt(price)}</span></p>
      {rows.map(([l, v]) => <p key={l} className="flex justify-between border-t border-line py-1"><span className="text-ink-2">{l}</span><span className={`num ${price >= v ? 'text-up' : 'text-down'}`}>{fmt(v)}</span></p>)}
      <button type="button" onClick={() => setMore((m) => !m)} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-accent-deep">{more ? 'Fewer levels' : 'All levels (pivots, CPR)'}<ChevronDown size={13} className={more ? 'rotate-180' : ''} /></button>
    </div>
  );
}

function DayRules({ s, onSave }: { s: DaySettings; onSave: (p: Partial<DaySettings>) => void }) {
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState(s);
  useEffect(() => setD(s), [s]);
  return (
    <div className="rounded-[12px] bg-raised px-3 py-2.5 text-[13px]">
      <p className="flex items-center justify-between gap-2">
        <span>Risk ₹{((s.capitalRupees * s.riskPerTradePct) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })} a trade · stop after −₹{s.maxDailyLossRupees.toLocaleString('en-IN')} or {s.maxTradesPerDay} trades</span>
        <Button variant="ghost" className="h-7 px-2" onClick={() => setEdit((v) => !v)} aria-label="Edit day rules" title="Edit day rules"><Pencil size={13} /></Button>
      </p>
      {edit && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {([['Capital ₹', 'capitalRupees'], ['Risk a trade %', 'riskPerTradePct'], ['Max loss a day ₹', 'maxDailyLossRupees'], ['Max trades a day', 'maxTradesPerDay']] as const).map(([label, k]) => (
            <label key={k} className="grid gap-1"><span className="text-[11.5px] text-muted">{label}</span>
              <input type="number" min={0} step="any" value={d[k]} onChange={(e) => setD({ ...d, [k]: Number(e.target.value) })} className={`${inputCls} num h-9`} />
            </label>
          ))}
          <Button variant="primary" className="col-span-2 h-9" onClick={() => { onSave(d); setEdit(false); }}>Save</Button>
        </div>
      )}
    </div>
  );
}
