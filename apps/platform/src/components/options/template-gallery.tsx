'use client';

import { useId, useMemo, useState } from 'react';
import { black76, payoff, type Leg } from '@mtv/options';
import { TEMPLATES, TEMPLATE_GROUPS, fmtDate, type Chain, type TemplateGroup } from '@/lib/options';
import { InfoTip } from '@/components/info-tip';

const RATE = 0.065; // the feed's model rate; affects only the calendar estimate
const W = 220, H = 92;

type Card = { id: string; name: string; group: TemplateGroup; points: { x: number; y: number }[] | null; netPaise: number | null; estimated: boolean; missing: string | null };

/** ATM IV of the chain (mean of call and put), for the calendar estimate; null if neither traded. */
function atmIv(c: Chain): number | null {
  const r = c.rows.find((x) => x.strikePaise === c.atmStrikePaise);
  const v = [r?.CE?.iv, r?.PE?.iv].filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
const years = (from: string, to: string) => Math.max(0, (Date.parse(`${to}T10:00:00Z`) - Date.parse(`${from}T10:00:00Z`)) / (365 * 86400_000));

/**
 * Each template's P&L across a range of prices: at expiry from the chain's closing prices, or for calendar templates
 * at the near expiry, with the later leg valued by Black-76 at today's ATM IV (an estimate, and labelled so).
 */
function buildCards(c: Chain): Card[] {
  const step = c.strikeStepPaise ?? 0, atm = c.atmStrikePaise, spot = c.spotPaise ?? atm;
  const lot = c.lotSize ?? 1;
  return TEMPLATES.map((t) => {
    const base = { id: t.id, name: t.name, group: t.group };
    if (!step || atm == null || spot == null) return { ...base, points: null, netPaise: null, estimated: false, missing: 'No strike interval' };
    const reach = Math.max(4, ...t.legs.map((l) => Math.abs(l.offset))) * step * 2;
    const xs = Array.from({ length: 81 }, (_, i) => spot - reach + (i * 2 * reach) / 80);
    const near = t.legs.filter((l) => !l.expiryOffset), far = t.legs.filter((l) => l.expiryOffset);
    const legs: Leg[] = [];
    for (const l of near) {
      const k = atm + l.offset * step;
      const q = c.rows.find((r) => r.strikePaise === k)?.[l.kind];
      if (!q) return { ...base, points: null, netPaise: null, estimated: false, missing: `${k / 100} ${l.kind} not listed` };
      legs.push({ kind: l.kind, side: l.side, strikePaise: k, pricePaise: q.closePaise, qty: (l.lots ?? 1) * lot });
    }
    const nearPnl = (S: number) => payoff(legs, S);
    if (!far.length) {
      const net = legs.reduce((a, l) => a + (l.side === 'SELL' ? 1 : -1) * l.pricePaise * l.qty, 0);
      return { ...base, points: xs.map((x) => ({ x, y: nearPnl(x) })), netPaise: net, estimated: false, missing: null };
    }
    // Calendar / diagonal: the later leg is still open at the near expiry.
    const at = c.expiries.indexOf(c.expiry), next = c.expiries[at + 1], iv = atmIv(c);
    if (!next || iv == null) return { ...base, points: null, netPaise: null, estimated: true, missing: next ? 'No ATM IV' : 'No later expiry' };
    const tNow = years(c.date, next), tLeft = years(c.expiry, next);
    const farPnl = (S: number) => far.reduce((a, l) => {
      const k = (atm + l.offset * step) / 100, sign = l.side === 'BUY' ? 1 : -1;
      const entry = black76(l.kind, spot / 100, k, tNow, RATE, iv).price;
      const later = black76(l.kind, S / 100, k, tLeft, RATE, iv).price;
      return a + sign * (later - entry) * 100 * (l.lots ?? 1) * lot;
    }, 0);
    return { ...base, points: xs.map((x) => ({ x, y: nearPnl(x) + farPnl(x) })), netPaise: null, estimated: true, missing: null };
  });
}

/** Payoff sketch: green above zero, red below, with the spot marked. */
function Sketch({ points, spot }: { points: { x: number; y: number }[]; spot: number }) {
  const id = useId().replace(/:/g, '');
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const lo = Math.min(0, ...ys), hi = Math.max(0, ...ys), pad = (hi - lo || 1) * 0.12;
  const X = (x: number) => ((x - x0) / (x1 - x0)) * W;
  const Y = (y: number) => 6 + (1 - (y - (lo - pad)) / (hi + pad - (lo - pad))) * (H - 12);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${line}L${W},${Y(0)}L0,${Y(0)}Z`;
  const zero = Y(0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[92px] w-full" aria-hidden="true">
      <defs>
        <clipPath id={`up${id}`}><rect x={0} y={0} width={W} height={zero} /></clipPath>
        <clipPath id={`dn${id}`}><rect x={0} y={zero} width={W} height={H - zero} /></clipPath>
      </defs>
      <path d={area} fill="var(--color-up)" opacity={0.14} clipPath={`url(#up${id})`} />
      <path d={area} fill="var(--color-down)" opacity={0.12} clipPath={`url(#dn${id})`} />
      <line x1={0} x2={W} y1={zero} y2={zero} stroke="var(--color-zero)" strokeWidth={1} />
      <line x1={X(spot)} x2={X(spot)} y1={0} y2={H} stroke="var(--color-muted)" strokeDasharray="3 3" strokeWidth={1} />
      <path d={line} fill="none" stroke="var(--color-up)" strokeWidth={2.2} clipPath={`url(#up${id})`} />
      <path d={line} fill="none" stroke="var(--color-down)" strokeWidth={2.2} clipPath={`url(#dn${id})`} />
    </svg>
  );
}

const inr = (paise: number) => `₹${Math.round(Math.abs(paise) / 100).toLocaleString('en-IN')}`;

/** Ready-made strategies as cards with their payoff on today's chain; clicking one fills the builder. */
export function TemplateGallery({ chain, onPick }: { chain: Chain; onPick: (id: string) => void }) {
  const [group, setGroup] = useState<TemplateGroup>('Neutral');
  const cards = useMemo(() => buildCards(chain), [chain]);
  const spot = chain.spotPaise ?? chain.atmStrikePaise ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto flex items-center gap-1.5 text-[13.5px] font-bold">Ready-made strategies
          <InfoTip label="About these sketches">
            <p>Sketches use the {fmtDate(chain.expiry)} closing prices around the ATM strike, one lot each ({chain.lotSize ?? '—'} units). The dashed line is the spot.</p>
            <p>Calendar and diagonal sketches are estimates: the later leg is valued with Black-76 at today&rsquo;s ATM IV.</p>
            <p>Click a card to add its legs and see exact margin, charges and breakevens.</p>
          </InfoTip>
        </h3>
        <div className="flex rounded-full bg-raised p-[3px]" role="tablist" aria-label="Strategy view">
          {TEMPLATE_GROUPS.map((g) => (
            <button key={g} type="button" role="tab" aria-selected={g === group} onClick={() => setGroup(g)}
              className={`rounded-full px-3 py-1 text-[12px] font-bold ${g === group ? 'bg-inverse text-on-inverse' : 'text-ink-2 hover:text-ink'}`}>{g}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 2xl:grid-cols-4">
        {cards.filter((c) => c.group === group).map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c.id)} disabled={!c.points}
            className="group flex flex-col rounded-[14px] border border-line bg-panel p-2.5 text-left transition hover:border-accent hover:shadow-[var(--shadow-panel)] disabled:cursor-not-allowed disabled:opacity-50"
            title={c.missing ?? `Add ${c.name} at the ${fmtDate(chain.expiry)} ATM strike`}>
            {c.points ? <Sketch points={c.points} spot={spot} /> : <div className="grid h-[92px] place-items-center text-[11px] text-muted">{c.missing}</div>}
            <span className="mt-1.5 text-[12.5px] font-bold group-hover:text-accent-deep">{c.name}</span>
            <span className="num text-[11px] text-muted">
              {c.estimated ? 'At the first expiry · estimate' : c.netPaise == null ? '—' : `${c.netPaise >= 0 ? 'Credit' : 'Debit'} ${inr(c.netPaise)}`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
