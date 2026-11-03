'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Bell, Pause, Play, Send, Trash2 } from 'lucide-react';
import { confirmDialog } from '@/components/dialog';
import { InfoTip } from '@/components/info-tip';
import { Button, Card, Segmented, inputCls } from '@/components/ui';
import { CHANNEL_LABEL, alertsApi, type Alert, type AlertChannel, type AlertEvent, type ChannelInfo } from '@/lib/alerts';
import { FeedError, showKept } from '@/lib/feed';
import { strategyApi, type SavedStrategy } from '@/lib/strategy';
import { ago, userApi, type SavedScreen } from '@/lib/user';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Alerts() {
  const params = useSearchParams();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [screens, setScreens] = useState<SavedScreen[]>([]);
  const [strategies, setStrategies] = useState<SavedStrategy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = useCallback(() => {
    alertsApi.list().then(setAlerts, (e: Error) => setError(e.message));
    alertsApi.events().then(setEvents, () => {});
  }, []);
  useEffect(() => {
    showKept(['user/alerts', setAlerts], ['user/alert-events', setEvents], ['alerts/channels', setChannels], ['user/screens', setScreens], ['user/strategies', setStrategies]);
    reload();
    alertsApi.channels().then(setChannels, () => {});
    userApi.screens().then(setScreens, () => {});
    strategyApi.list().then(setStrategies, () => {});
    const t = setInterval(() => alertsApi.events().then(setEvents, () => {}), 15_000);
    return () => clearInterval(t);
  }, [reload]);
  // Opening the page marks what is shown as read.
  useEffect(() => { if (events.some((e) => !e.read)) void alertsApi.read(events.filter((e) => !e.read).map((e) => e.id)); }, [events]);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError(null);
    try { await fn(); reload(); if (done) { setNotice(done); setTimeout(() => setNotice(null), 2500); } } catch (e) { setError(e instanceof FeedError ? e.message : 'That did not work'); }
  };
  const sourceName = (a: Alert) => (a.source.kind === 'screen' ? screens.find((s) => s.id === a.source.id)?.name : strategies.find((s) => s.id === a.source.id)?.name) ?? 'deleted';

  return (
    <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <div className="grid h-fit content-start gap-5">
        <NewAlert screens={screens} strategies={strategies} channels={channels} initial={params.get('screen') ? { kind: 'screen', id: params.get('screen')! } : params.get('strategy') ? { kind: 'strategy', id: params.get('strategy')! } : null}
          onSave={(a) => act(() => alertsApi.save(a), 'Alert created. Its first check records what already matches.')} />
        <Card title={<span className="flex items-center gap-1.5">Ways to be told <InfoTip label="Setting up channels">Telegram, email and WhatsApp switch on when their keys are in .env (then restart the data service). In the app always works.</InfoTip></span>}>
          <ul className="grid gap-2 text-[13.5px]">
            {channels.map((c) => (
              <li key={c.channel} className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${c.ready ? 'bg-up' : 'bg-muted'}`} />
                <span className="flex-1">{CHANNEL_LABEL[c.channel]}{!c.ready && <span className="block text-[12px] text-muted">Needs {c.needs.join(', ')} in .env</span>}</span>
                {c.channel !== 'inApp' && c.ready && <Button variant="ghost" className="h-8 px-2.5 text-[12.5px]" onClick={() => act(() => alertsApi.test(c.channel), `Test sent to ${CHANNEL_LABEL[c.channel]}`)}><Send size={14} /> Send test</Button>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid min-w-0 content-start gap-5">
        {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
        {notice && <p role="status" className="rounded-[12px] bg-up-soft px-3 py-2 text-[13.5px] font-semibold text-up">{notice}</p>}
        <Card title="My alerts">
          {!alerts && <p className="text-[13px] text-muted">Loading…</p>}
          {alerts?.length === 0 && <p className="text-[13.5px] text-ink-2">No alerts yet. Save a screen (or a strategy), then create an alert for it here.</p>}
          <ul className="grid gap-2">
            {alerts?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line px-3 py-2.5">
                <span className={`h-2.5 w-2.5 rounded-full ${!a.enabled ? 'bg-muted' : a.lastError ? 'bg-down' : 'bg-up'}`} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-[12.5px] text-muted">
                    {a.source.kind === 'screen' ? 'Screen' : 'Strategy entry'}: {sourceName(a)} · {a.trigger === 'first' ? 'new matches' : 'every check'} · {a.channels.map((c) => CHANNEL_LABEL[c].split(' (')[0]).join(', ')}{a.until ? ` · until ${a.until}` : ''}
                  </p>
                  <p className="text-[12.5px] text-muted">{!a.enabled ? 'Paused' : a.lastCheckAt ? `Checked ${ago(a.lastCheckAt)}${a.matching ? `, ${a.matching.length.toLocaleString('en-IN')} matching` : ''}` : 'Waiting for its first check'}</p>
                  {a.lastError && <p className="text-[12.5px] text-down">{a.lastError}</p>}
                </div>
                <Button variant="ghost" className="h-8 px-2.5" onClick={() => act(() => alertsApi.enable(a.id, !a.enabled))} title={a.enabled ? 'Pause' : 'Resume'}>{a.enabled ? <Pause size={15} /> : <Play size={15} />}</Button>
                <Button variant="ghost" className="h-8 px-2.5" onClick={async () => { if (await confirmDialog({ title: `Delete the alert "${a.name}"?`, message: 'It stops checking. Messages it already sent stay in the list.', confirmLabel: 'Delete', danger: true })) act(() => alertsApi.remove(a.id)); }} title="Delete"><Trash2 size={15} /></Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="History">
          {!events.length && <p className="text-[13.5px] text-ink-2">Alerts that fire appear here.</p>}
          <ul className="grid gap-3">
            {events.slice(0, 200).map((e) => (
              <li key={e.id} className="grid gap-1 border-b border-line pb-3 last:border-0">
                <p className="flex items-center gap-2 text-[13.5px]"><Bell size={14} className="text-accent-deep" /><span className="font-semibold">{e.alertName}</span><span className="text-muted">{when(e.at)}</span></p>
                {e.note && <p className="text-[13px] text-ink-2">{e.note}</p>}
                {e.hits.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {e.hits.map((h) => (
                      <Link key={h.symbol} href={`/chart/${encodeURIComponent(h.symbol)}`} className="rounded-full border border-line-strong px-2.5 py-0.5 text-[12.5px] hover:border-accent hover:text-accent-deep">
                        <span className="font-semibold">{h.symbol}</span> <span className="num text-muted">₹{h.price.toLocaleString('en-IN')}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {Object.entries(e.delivered).some(([, v]) => v !== 'sent') && <p className="text-[12px] text-down">{Object.entries(e.delivered).filter(([, v]) => v !== 'sent').map(([k, v]) => `${CHANNEL_LABEL[k as AlertChannel]}: ${v}`).join('; ')}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function NewAlert({ screens, strategies, channels, initial, onSave }: {
  screens: SavedScreen[]; strategies: SavedStrategy[]; channels: ChannelInfo[]; initial: Alert['source'] | null;
  onSave: (a: Pick<Alert, 'name' | 'source' | 'trigger' | 'session' | 'channels' | 'until'>) => void;
}) {
  const [source, setSource] = useState<string>(initial ? `${initial.kind}:${initial.id}` : '');
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<Alert['trigger']>('first');
  const [chosen, setChosen] = useState<AlertChannel[]>(['inApp']);
  const [until, setUntil] = useState('');
  useEffect(() => { if (initial) setSource(`${initial.kind}:${initial.id}`); }, [initial?.kind, initial?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [kind, id] = source.split(':') as ['screen' | 'strategy', string];
  const label = kind === 'screen' ? screens.find((s) => s.id === id)?.name : strategies.find((s) => s.id === id)?.name;
  return (
    <Card title="New alert">
      <div className="grid gap-3">
        <label className="grid gap-1"><span className="eyebrow">Watch</span>
          <select value={source} onChange={(e) => setSource(e.target.value)} className={`${inputCls} pr-8`}>
            <option value="">Pick a saved screen or strategy…</option>
            {screens.length > 0 && <optgroup label="Saved screens">{screens.map((s) => <option key={s.id} value={`screen:${s.id}`}>{s.name}</option>)}</optgroup>}
            {strategies.length > 0 && <optgroup label="Strategy entry signals">{strategies.map((s) => <option key={s.id} value={`strategy:${s.id}`}>{s.name}</option>)}</optgroup>}
          </select>
        </label>
        <label className="grid gap-1"><span className="eyebrow">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={label ? `${label} alert` : 'Alert name'} className={inputCls} />
        </label>
        <div className="grid gap-1"><span className="eyebrow flex items-center gap-1">Tell me <InfoTip label="When to tell">New matches: a stock is reported when it starts matching, and again only after it has stopped matching. Every check: all matching stocks each time the screen is checked.</InfoTip></span>
          <Segmented label="Trigger" value={trigger} onChange={setTrigger} options={[{ value: 'first', label: 'About new matches' }, { value: 'every', label: 'On every check' }]} />
        </div>
        <div className="grid gap-1.5"><span className="eyebrow">How</span>
          {channels.map((c) => (
            <label key={c.channel} className={`flex items-center gap-2 text-[13.5px] ${c.ready ? '' : 'text-muted'}`}>
              <input type="checkbox" disabled={!c.ready} checked={chosen.includes(c.channel)} onChange={(e) => setChosen((x) => (e.target.checked ? [...x, c.channel] : x.filter((y) => y !== c.channel)))} className="accent-[var(--color-accent)]" />
              {CHANNEL_LABEL[c.channel]}{!c.ready && ' (not set up)'}
            </label>
          ))}
        </div>
        <label className="grid gap-1"><span className="eyebrow">Stop after (optional)</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={`${inputCls} num w-[180px]`} />
        </label>
        <p className="text-[12.5px] text-muted">Intraday screens are checked as each bar closes while Kite is live; daily screens when NSE&apos;s evening file arrives (and every 5 minutes in the session if they use the live candle).</p>
        <Button variant="primary" disabled={!source || !chosen.length} onClick={() => { onSave({ name: name.trim() || `${label ?? 'Screen'} alert`, source: { kind, id }, trigger, session: 'market', channels: chosen, until: until || null }); setName(''); }}>
          <Bell size={15} /> Create alert
        </Button>
      </div>
    </Card>
  );
}

export default function Page() {
  return <Suspense><Alerts /></Suspense>;
}
