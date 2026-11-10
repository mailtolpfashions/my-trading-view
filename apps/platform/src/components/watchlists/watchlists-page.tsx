'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Filter, LineChart, Pencil, Plus, Trash2, X } from 'lucide-react';
import { FeedError, feed, showKept } from '@/lib/feed';
import { userApi, type Watchlist } from '@/lib/user';
import { confirmDialog, promptDialog } from '../dialog';
import { Button, Card, inputCls } from '../ui';

type Quote = { symbol: string; ltp: number; prevClose: number; change: number; changePct: number; time: number };

/** The owner's watchlists: each stock with its last NSE close, and a way to screen the whole list. */
export function WatchlistsPage() {
  const [lists, setLists] = useState<Watchlist[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => userApi.watchlists().then((l) => { setLists(l); setActiveId((id) => (id && l.some((w) => w.id === id) ? id : l[0]?.id ?? null)); }, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    showKept(['user/watchlists', (l: Watchlist[]) => { setLists(l); setActiveId(l[0]?.id ?? null); }]);
    reload();
  }, [reload]);
  const active = lists?.find((w) => w.id === activeId) ?? null;

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await reload(); } catch (e) { setError(e instanceof FeedError ? e.message : 'That change could not be saved'); }
  };
  const create = async () => {
    const name = await promptDialog({ title: 'New watchlist', label: 'Name', placeholder: 'e.g. Breakout candidates', confirmLabel: 'Create' });
    if (name) act(async () => setActiveId((await userApi.saveWatchlist({ name, symbols: [] })).id));
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <Card title="Watchlists" actions={<Button variant="ghost" className="h-8 px-2" onClick={create} aria-label="New watchlist"><Plus size={16} /> New</Button>} className="h-fit">
        <ul className="grid gap-1">
          {!lists && <li className="text-[13px] text-muted">Loading…</li>}
          {lists?.length === 0 && <li className="text-[13px] text-muted">No watchlists yet. Create one, or add stocks from scan results.</li>}
          {lists?.map((w) => (
            <li key={w.id}>
              <button type="button" onClick={() => setActiveId(w.id)} aria-current={w.id === activeId}
                className={`flex w-full items-center justify-between rounded-[10px] px-3 py-2 text-left text-[14px] ${w.id === activeId ? 'bg-accent-soft font-semibold text-ink' : 'text-ink-2 hover:bg-raised hover:text-ink'}`}>
                <span className="truncate">{w.name}</span><span className="num text-[12px] text-muted">{w.symbols.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <div className="grid min-w-0 gap-4">
        {error && <p role="alert" className="rounded-[12px] bg-down-soft px-3 py-2 text-[13.5px] text-down">{error}</p>}
        {active ? <ListView key={active.id} w={active} act={act} /> : lists?.length ? null : (
          <Card><p className="text-[14px] text-ink-2">Create a watchlist to keep stocks you are tracking, then scan just those stocks with the Scanner.</p></Card>
        )}
      </div>
    </div>
  );
}

function ListView({ w, act }: { w: Watchlist; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [quotes, setQuotes] = useState<Map<string, Quote>>(new Map());
  const [add, setAdd] = useState('');
  useEffect(() => {
    let live = true;
    // The quote route answers at most 100 symbols at a time.
    const chunks = Array.from({ length: Math.ceil(w.symbols.length / 100) }, (_, i) => w.symbols.slice(i * 100, i * 100 + 100));
    Promise.all(chunks.map((c) => feed<Quote[]>(`quotes?symbols=${encodeURIComponent(c.join(','))}`))).then((parts) => {
      if (live) setQuotes(new Map(parts.flat().map((q) => [q.symbol, q])));
    }, () => {});
    return () => { live = false; };
  }, [w.symbols]);
  const addSymbols = () => {
    const symbols = add.split(/[\s,]+/).filter(Boolean);
    if (symbols.length) act(() => userApi.addToWatchlist(w.id, symbols)).then(() => setAdd(''));
  };
  const last = [...quotes.values()][0];

  return (
    <Card title={w.name} actions={
      <>
        <Link href={`/scanner?watchlist=${w.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-[12px] bg-inverse px-3 text-[13.5px] font-semibold text-on-inverse hover:bg-inverse-hover"><Filter size={15} /> Scan this list</Link>
        <Button variant="ghost" className="h-9 px-2.5" aria-label="Rename" title="Rename" onClick={async () => { const name = await promptDialog({ title: 'Rename watchlist', label: 'Name', initial: w.name, confirmLabel: 'Rename' }); if (name) act(() => userApi.saveWatchlist({ id: w.id, name, symbols: w.symbols })); }}><Pencil size={15} /></Button>
        <Button variant="ghost" className="h-9 px-2.5" aria-label="Delete watchlist" title="Delete" onClick={async () => { if (await confirmDialog({ title: `Delete the watchlist "${w.name}"?`, message: 'The stocks in it are not affected.', confirmLabel: 'Delete', danger: true })) act(() => userApi.deleteWatchlist(w.id)); }}><Trash2 size={15} /></Button>
      </>
    }>
      <form className="mb-4 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); addSymbols(); }}>
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add NSE symbols, e.g. TCS, INFY" aria-label="Add symbols" spellCheck={false} className={`${inputCls} w-[320px] uppercase`} />
        <Button type="submit" disabled={!add.trim()}><Plus size={15} /> Add</Button>
        {last && <span className="text-[12.5px] text-muted">Last NSE close of {new Date((last.time + 19800) * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}</span>}
      </form>
      <div className="overflow-auto rounded-[14px] border border-line">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-[12px] text-muted">
              <th scope="col" className="px-3 py-2.5 text-left font-semibold">Stock</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Close</th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">Change</th>
              <th scope="col" className="w-24" />
            </tr>
          </thead>
          <tbody>
            {w.symbols.map((s) => {
              const q = quotes.get(s);
              return (
                <tr key={s} className="border-t border-line hover:bg-raised">
                  <td className="px-3 py-2 font-semibold">{s}{!q && quotes.size > 0 && <span className="ml-2 text-[11.5px] font-normal text-muted">no NSE data</span>}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right">{q ? q.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '–'}</td>
                  <td className={`num whitespace-nowrap px-3 py-2 text-right font-semibold ${q ? (q.changePct >= 0 ? 'text-up' : 'text-down') : ''}`}>{q ? `${q.changePct >= 0 ? '+' : ''}${q.changePct.toFixed(2)}%` : '–'}</td>
                  <td className="px-2 py-1 text-right">
                    <Link href={`/chart/${encodeURIComponent(s)}`} aria-label={`Chart of ${s}`} title="Open chart" className="inline-grid h-8 w-8 place-items-center rounded-[8px] text-muted hover:bg-panel hover:text-ink"><LineChart size={15} /></Link>
                    <button type="button" aria-label={`Remove ${s}`} title="Remove" onClick={() => act(() => userApi.saveWatchlist({ id: w.id, name: w.name, symbols: w.symbols.filter((x) => x !== s) }))}
                      className="inline-grid h-8 w-8 place-items-center rounded-[8px] text-muted hover:bg-panel hover:text-down"><X size={15} /></button>
                  </td>
                </tr>
              );
            })}
            {!w.symbols.length && <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-2">This list is empty. Add symbols above, or from scan results.</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
