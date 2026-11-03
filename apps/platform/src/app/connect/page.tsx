'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plug, Unplug } from 'lucide-react';
import { InfoTip } from '@/components/info-tip';
import { Button, Card } from '@/components/ui';
import { liveApi, type LiveStatus } from '@/lib/live';

const time = (t: number | null) => (t == null ? '–' : new Date(t * 1000).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }));

function Connect() {
  const params = useSearchParams();
  const [s, setS] = useState<LiveStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => liveApi.status().then((x) => { if (alive) { setS(x); setErr(null); } }, (e: Error) => alive && setErr(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const result = params.get('kite');
  const live = s?.state === 'live';

  return (
    <div className="mx-auto grid max-w-[880px] gap-5">
      {result === 'connected' && <p className="rounded-[12px] bg-up-soft px-4 py-3 text-[14px] font-semibold text-up">Kite connected. Live data is starting.</p>}
      {result === 'failed' && <p className="rounded-[12px] bg-down-soft px-4 py-3 text-[14px] text-down">The Kite login did not complete. Try again; the data service log has the reason.</p>}
      {result === 'cancelled' && <p className="rounded-[12px] bg-raised px-4 py-3 text-[14px] text-ink-2">The Kite login was cancelled.</p>}
      {err && <p className="rounded-[12px] bg-down-soft px-4 py-3 text-[14px] text-down">{err}</p>}

      <Card title="Live data from Kite" actions={live
        ? <Button onClick={() => liveApi.logout().then(() => liveApi.status().then(setS))}><Unplug size={15} /> Disconnect</Button>
        : <a href={liveApi.loginHref} className="inline-flex h-10 items-center gap-2 rounded-[12px] bg-inverse px-4 text-[14px] font-semibold text-on-inverse hover:bg-inverse-hover"><Plug size={16} /> Connect Kite</a>}>
        <div className="grid gap-3 text-[14px]">
          <p className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${live ? 'live-dot bg-up' : s?.state === 'error' ? 'bg-down' : 'bg-muted'}`} />
            {!s ? 'Checking…' : live ? `Streaming ${s.stocks.toLocaleString('en-IN')} instruments${s.userName ? ` for ${s.userName}` : ''}` : s.state === 'starting' ? 'Connecting…' : s.state === 'error' ? `Could not start: ${s.message}` : s.configured ? 'Not connected. Zerodha ends each session at 6 AM, so connect once a day.' : 'Add KITE_API_KEY and KITE_API_SECRET to .env first.'}
          </p>
          {s && live && (
            <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
              <dt className="text-muted">Session ends</dt><dd>{time(s.expiresAt)}</dd>
              <dt className="text-muted">Last tick</dt><dd>{time(s.lastTickAt)}</dd>
              <dt className="text-muted">Today&apos;s minutes</dt><dd>{s.today.running ? `Downloading ${s.today.done} of ${s.today.total}…` : s.today.total ? `Loaded for ${s.today.done} instruments` : 'Waiting for the session'}</dd>
              <dt className="text-muted">Past minutes</dt>
              <dd>{s.history.running ? `Downloading: ${s.history.done} of ${s.history.total} stocks (${s.history.days.toLocaleString('en-IN')} stock-days so far)` : s.history.finishedAt ? `Up to date (${time(s.history.finishedAt)})${s.history.failed ? `, ${s.history.failed} failed (see the log)` : ''}` : 'Not started'}</dd>
              <dt className="text-muted">Option recording</dt><dd>{s.options?.contracts ? `${s.options.contracts} NIFTY and BANKNIFTY contracts, ${s.options.minutesToday.toLocaleString('en-IN')} minutes saved today` : s.options ? 'Starting…' : 'Starts after the data service restarts'}</dd>
              <dt className="text-muted">After-close correction</dt><dd>{s.correctedOn ? `Done for ${s.correctedOn}` : 'At 15:50 IST'}</dd>
            </dl>
          )}
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2">How it works <InfoTip label="About live data">Your own Kite Connect account supplies the data for your own use; it is never shown to anyone else.</InfoTip></span>}>
        <ul className="grid list-disc gap-1.5 pl-5 text-[13.5px] text-ink-2">
          <li>Streams NIFTY 500 and F&amp;O stocks plus NIFTY, BANKNIFTY, FINNIFTY and MIDCPNIFTY, and builds one-minute candles.</li>
          <li>On connecting, today&apos;s minutes so far are downloaded first, then a year of past minutes (about 25 minutes the first time, only new days after that).</li>
          <li>At 15:50 the day&apos;s live candles are replaced with Kite&apos;s official minutes.</li>
          <li>Intraday prices are adjusted for splits and bonuses like the daily history.</li>
          <li>NIFTY and BANKNIFTY options (current and next expiry, 10 strikes each side of the index) are recorded minute by minute with open interest and the bid / ask, building an intraday option history that Kite cannot supply for expired contracts.</li>
          <li>In your Kite developer app, the redirect URL must be <code>http://127.0.0.1:4001/api/kite/callback</code>.</li>
        </ul>
      </Card>
    </div>
  );
}

export default function Page() {
  return <Suspense><Connect /></Suspense>;
}
