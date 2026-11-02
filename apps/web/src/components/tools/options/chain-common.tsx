'use client';

import { fetchChain, type Chain, type ChainRow } from '@/lib/options';
import { useLoad } from '@/lib/fno';
import type { BuildUp } from '@/lib/futures';
import { DateStepper, ExpirySelect, Segmented, UnderlyingPicker, useToolParams } from '../controls';

/** Underlying, trading day (null = latest) and expiry from the URL, and the chain they select. */
export function useChainTool() {
  const p = useToolParams();
  const date = p.get('date') ?? null;
  const expiry = p.get('expiry') ?? null;
  const chain = useLoad<Chain>(`${p.u}|${date ?? ''}|${expiry ?? ''}`, () => fetchChain(p.u, expiry ?? undefined, date ?? undefined));
  return { ...p, date, expiry, chain };
}

export function ChainControls({ t, range, setRange, extra }: { t: ReturnType<typeof useChainTool>; range?: number; setRange?: (n: number) => void; extra?: React.ReactNode }) {
  const c = t.chain.data;
  return (
    <>
      <UnderlyingPicker value={t.u} onChange={(u) => t.set({ u })} />
      <DateStepper underlying={t.u} value={t.date} onChange={(d) => t.set({ date: d })} />
      <ExpirySelect value={c?.expiry ?? t.expiry} expiries={c?.expiries ?? []} onChange={(e) => t.set({ expiry: e })} />
      {setRange && range != null && (
        <Segmented label="Strikes shown" value={range} onChange={setRange} options={[{ value: 10, label: '±10' }, { value: 20, label: '±20' }, { value: 0, label: 'All' }]} />
      )}
      {extra}
    </>
  );
}

/** The `n` strikes either side of ATM (all strikes when n is 0). */
export function strikeWindow(c: Chain, n: number): ChainRow[] {
  if (!n || c.atmStrikePaise == null) return c.rows;
  const i = c.rows.findIndex((r) => r.strikePaise === c.atmStrikePaise);
  if (i < 0) return c.rows;
  return c.rows.slice(Math.max(0, i - n), i + n + 1);
}

/** Price change against open-interest change, as for futures. Either change zero or unknown is neutral. */
export function classifyBuildUp(priceChange: number | null | undefined, oiChange: number | null | undefined): BuildUp {
  if (!priceChange || !oiChange) return 'neutral';
  if (priceChange > 0) return oiChange > 0 ? 'long-buildup' : 'short-covering';
  return oiChange > 0 ? 'short-buildup' : 'long-unwinding';
}

/** "Data as of" line under the controls, saying which day and the comparison day. */
export function AsOf({ c }: { c: Chain | null }) {
  if (!c) return null;
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return <span className="text-[12px] text-muted">Close of {f(c.date)}{c.prevDate ? ` · changes against ${f(c.prevDate)}` : ''}{c.lotSize ? ` · lot ${c.lotSize}` : ''}</span>;
}
