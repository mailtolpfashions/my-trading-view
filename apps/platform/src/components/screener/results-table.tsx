'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Download, LineChart, ListPlus, Plus, Search, X } from 'lucide-react';
import { parseFormula } from '@mtv/rules';
import { columnLabel, toCsv, type ScreenResult, type ScreenRow } from '@/lib/screener';
import { userApi, type Watchlist } from '@/lib/user';
import { promptDialog } from '../dialog';
import { InfoTip } from '../info-tip';
import { Button, inputCls } from '../ui';
import { useShell } from '../app/shell-context';

type SortKey = 'symbol' | 'close' | 'changePct' | 'volume' | 'avgValueCr' | `col:${number}`;

const fmt = (v: number | null | undefined, d = 2) => (v == null ? '–' : v.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }));
const compact = (v: number) => (v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v.toLocaleString('en-IN'));
const dateText = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');

export function ResultsTable({ result, columns, onColumns, watchlists, onWatchlists }: {
  result: ScreenResult; columns: string[]; onColumns: (c: string[]) => void; watchlists: Watchlist[]; onWatchlists: () => void;
}) {
  const { openTicket } = useShell();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'avgValueCr', dir: -1 });
  const [open, setOpen] = useState<string | null>(null);

  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    const val = (r: ScreenRow): number | string | null => (sort.key === 'symbol' ? r.symbol : sort.key.startsWith('col:') ? r.columns[Number(sort.key.slice(4))] : r[sort.key as 'close']);
    return result.rows
      .filter((r) => !needle || r.symbol.includes(needle) || r.name.toUpperCase().includes(needle) || (r.industry ?? '').toUpperCase().includes(needle))
      .sort((a, b) => {
        const x = val(a), y = val(b);
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
      });
  }, [result.rows, q, sort]);

  const download = () => {
    const blob = new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `screen-${result.asOf ?? 'latest'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const th = (key: SortKey, label: React.ReactNode, right = true) => (
    <th key={key} scope="col" aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      className={`whitespace-nowrap px-3 py-2.5 text-[12px] font-semibold text-muted ${right ? 'text-right' : 'text-left'}`}>
      <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === 'symbol' ? 1 : -1 }))} className="hover:text-ink">
        {label}{sort.key === key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
  const width = 7 + result.columns.length; // every column, the chevron included

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-ink-2">
        <p><span className="num text-[20px] font-bold text-ink">{result.matches.toLocaleString('en-IN')}</span> of <span className="num">{result.scanned.toLocaleString('en-IN')}</span> stocks match</p>
        <p>NSE close of <span className="font-semibold text-ink">{dateText(result.asOf)}</span></p>
        <p>{result.tf === 'D' ? 'Daily' : result.tf === 'W' ? 'Weekly' : 'Monthly'} bars, {result.candle === 'closed' ? 'closed candle' : 'live candle'}</p>
        <p className="text-muted">{(result.ms / 1000).toFixed(1)} s</p>
        {!result.complete && (
          <p className="flex items-center gap-1.5 text-accent-deep"><AlertTriangle size={14} /> Older NSE history is still downloading
            <InfoTip label="About incomplete history">Indicators that need a long history (for example a 200-day average or a 52-week high) can be missing for some stocks until the download finishes. Those stocks then don&apos;t match, rather than matching on partial data.</InfoTip>
          </p>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label className="flex h-10 items-center gap-2 rounded-[12px] border border-line-strong bg-panel px-3">
            <Search size={15} className="text-muted" aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search results" aria-label="Search results" className="w-40 bg-transparent text-[14px] focus:outline-none" />
          </label>
          <AddToWatchlist symbols={rows.map((r) => r.symbol)} label={`Add ${rows.length.toLocaleString('en-IN')} to a watchlist`} watchlists={watchlists} onChanged={onWatchlists} />
          <Button onClick={download} disabled={!result.rows.length}><Download size={15} /> CSV</Button>
        </div>
      </div>

      <ColumnEditor columns={columns} onChange={onColumns} />

      <div className="max-h-[70vh] overflow-auto rounded-[14px] border border-line">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr>
              <th className="w-8" />
              {th('symbol', 'Stock', false)}
              {th('close', 'Close')}
              {th('changePct', 'Change')}
              {th('volume', 'Volume')}
              {th('avgValueCr', <>Traded ₹ cr/day</>)}
              {result.columns.map((c, i) => th(`col:${i}`, columnLabel(c)))}
              <th scope="col" className="px-3 py-2.5 text-left text-[12px] font-semibold text-muted">Industry</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = open === r.symbol;
              return (
                <Fragment key={r.symbol}>
                  <tr onClick={() => setOpen(isOpen ? null : r.symbol)} className={`cursor-pointer border-t border-line hover:bg-raised ${isOpen ? 'bg-raised' : ''}`}>
                    <td className="pl-3 text-muted">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-ink">{r.symbol}</span>
                        {r.lowLiquidity && <span title="Traded under ₹1 crore a day on average" className="rounded-full bg-raised px-1.5 text-[10.5px] font-semibold text-muted">Low liquidity</span>}
                        {r.dataBreak && <span title={`Data break on ${dateText(r.dataBreak)}: indicator values across it may be off`} className="text-accent-deep"><AlertTriangle size={13} /></span>}
                      </div>
                      <div className="max-w-[240px] truncate text-[12px] text-muted">{r.name}</div>
                    </td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right">{fmt(r.close)}</td>
                    <td className={`num whitespace-nowrap px-3 py-2 text-right font-semibold ${r.changePct == null ? '' : r.changePct >= 0 ? 'text-up' : 'text-down'}`}>{r.changePct == null ? '–' : `${r.changePct >= 0 ? '+' : ''}${r.changePct.toFixed(2)}%`}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right">{compact(r.volume)}</td>
                    <td className="num whitespace-nowrap px-3 py-2 text-right">{fmt(r.avgValueCr, 1)}</td>
                    {r.columns.map((v, i) => <td key={i} className="num whitespace-nowrap px-3 py-2 text-right">{fmt(v)}</td>)}
                    <td className="max-w-[180px] truncate px-3 py-2 text-ink-2">{r.industry ?? '–'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-raised">
                      <td />
                      <td colSpan={width - 1} className="px-3 pb-4 pt-1">
                        <div className="sticky left-0 flex max-w-[calc(100vw-120px)] flex-wrap items-start gap-6">
                          <Link href={`/chart/${encodeURIComponent(r.symbol)}?tf=${result.tf}`} className="inline-flex shrink-0 h-9 items-center gap-1.5 rounded-[10px] bg-panel px-3 text-[13px] font-semibold text-ink shadow-[var(--shadow-panel)] hover:text-accent-deep">
                            <LineChart size={15} /> Open chart
                          </Link>
                          <button type="button" onClick={() => openTicket({ symbol: r.symbol })} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] bg-accent-soft px-3 text-[13px] font-bold text-accent-deep hover:bg-accent hover:text-accent-ink">Trade (paper)</button>
                          <AddToWatchlist symbols={[r.symbol]} label={`Add ${r.symbol} to a watchlist`} watchlists={watchlists} onChanged={onWatchlists} compact />
                          <CopySymbol symbol={r.symbol} />
                          <div className="grid gap-1">
                            <p className="eyebrow">Conditions on {dateText(r.barDate)}</p>
                            {r.conditions.map((c, k) => (
                              <p key={k} className="flex items-center gap-2 font-mono text-[12.5px]">
                                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${c.value === 1 ? 'bg-up-soft text-up' : c.value === 0 ? 'bg-down-soft text-down' : 'bg-panel text-muted'}`}>{c.value === 1 ? '✓' : c.value === 0 ? '✗' : '?'}</span>
                                {c.formula}
                              </p>
                            ))}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={width} className="px-3 py-10 text-center text-ink-2">{result.rows.length ? 'No result matches this search.' : 'No stock matches these conditions on this day.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {result.rows.length < result.matches && <p className="text-[12.5px] text-muted">Showing the {result.rows.length.toLocaleString('en-IN')} most traded of {result.matches.toLocaleString('en-IN')} matches.</p>}
    </div>
  );
}

/** Result columns as formulas: remove any, or add one (any value the formula language can compute). */
function ColumnEditor({ columns, onChange }: { columns: string[]; onChange: (c: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const p = draft.trim() ? parseFormula(draft) : null;
  const okValue = p?.ok && p.type === 'num';
  const add = () => { if (okValue && p.ok) { onChange([...columns, p.formula]); setDraft(''); } };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="eyebrow">Columns</span>
      {columns.map((c) => (
        <span key={c} className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-panel pl-3 pr-1 text-[12.5px]">
          {columnLabel(c)}
          <button type="button" onClick={() => onChange(columns.filter((x) => x !== c))} aria-label={`Remove ${c}`} className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-raised hover:text-ink"><X size={13} /></button>
        </span>
      ))}
      <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add a column, e.g. ATR_PCT(14)" spellCheck={false}
        aria-invalid={!!p && !okValue} className={`${inputCls} h-8 w-[220px] font-mono text-[12.5px] ${p && !okValue ? 'border-down' : ''}`} title={p && !p.ok ? p.error : p?.ok && p.type !== 'num' ? 'A column must be a value, not a condition' : undefined} />
      <button type="button" onClick={add} disabled={!okValue} className="grid h-8 w-8 place-items-center rounded-full text-accent-deep hover:bg-accent-soft disabled:opacity-40" aria-label="Add column"><Plus size={16} /></button>
      <span className="text-[12px] text-muted">Changes apply on the next run.</span>
    </div>
  );
}

/** Adds stocks to an existing watchlist, or to a new one named on the spot. */
function AddToWatchlist({ symbols, label, watchlists, onChanged, compact }: { symbols: string[]; label: string; watchlists: Watchlist[]; onChanged: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const done = (m: string) => { setMsg(m); setOpen(false); onChanged(); setTimeout(() => setMsg(null), 2500); };
  const pick = async (v: string) => {
    if (!v) return;
    try {
      if (v === '__new') {
        const name = await promptDialog({ title: 'New watchlist', message: `With the ${symbols.length} stock${symbols.length === 1 ? '' : 's'} from these results.`, label: 'Name', confirmLabel: 'Create' });
        if (!name) return;
        const w = await userApi.saveWatchlist({ name, symbols });
        done(`Added to ${w.name}`);
      } else {
        const w = await userApi.addToWatchlist(v, symbols);
        done(`Added to ${w.name}`);
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  if (msg) return <span className="inline-flex h-9 items-center gap-1.5 text-[13px] font-semibold text-up" role="status"><Check size={15} /> {msg}</span>;
  if (open) return (
    <select autoFocus defaultValue="" onChange={(e) => pick(e.target.value)} onBlur={() => setOpen(false)} aria-label={label} className={`${inputCls} h-9 min-w-[200px] pr-7 text-[13px]`}>
      <option value="">Choose a watchlist…</option>
      {watchlists.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.symbols.length})</option>)}
      <option value="__new">New watchlist…</option>
    </select>
  );
  return (
    <button type="button" onClick={() => setOpen(true)} disabled={!symbols.length} title={label}
      className={compact ? 'inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-panel px-3 text-[13px] font-semibold text-ink shadow-[var(--shadow-panel)] hover:text-accent-deep'
        : 'inline-flex h-10 items-center gap-2 rounded-[12px] border border-line-strong bg-panel px-4 text-[14px] font-semibold text-ink hover:border-muted disabled:opacity-50'}>
      <ListPlus size={15} /> {compact ? 'Watchlist' : 'Watchlist'}
    </button>
  );
}

function CopySymbol({ symbol }: { symbol: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" onClick={() => navigator.clipboard.writeText(symbol).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}
      className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-panel px-3 text-[13px] font-semibold text-ink shadow-[var(--shadow-panel)] hover:text-accent-deep">
      {ok ? <Check size={15} /> : <Copy size={15} />} {ok ? 'Copied' : 'Copy symbol'}
    </button>
  );
}
