// The brain: given a position, the market and a playbook, says what to do now and why, in plain words. Pure, so a past
// day and a live moment get the same answer. It decides; it never trades. Losses are checked before anything else.

import type { AdjustAction, Playbook, SellEntry } from './rules';
import { daysBetween } from './signals';
import { positionPnl, shorts, wingFor, type ChainQuote, type Kind, type LegRef, type MarketSnapshot, type SellLeg, type SellPosition } from './state';

export type OpenLeg = Omit<SellLeg, 'entryPaise'>;
export type ExitReason = 'target' | 'stop' | 'max-loss' | 'time';
export type Decision =
  | { type: 'none'; blocked?: string }
  | { type: 'exit'; reason: ExitReason; why: string }
  | { type: 'adjust'; action: AdjustAction; close: LegRef[]; open: OpenLeg[]; why: string };

export type DecideContext = {
  /** Cost of filling one leg (slippage plus charges), paise for the whole quantity. Rolls must earn more than this. */
  fillCost(side: 'BUY' | 'SELL', qty: number, pricePaise: number): number;
  /** Delta each short was sold at. */
  entryDelta: number;
  /** Distance of protection added to a naked side, % of the index. */
  wingPct: number;
};

const rupees = (p: number) => `₹${Math.round(p / 100).toLocaleString('en-IN')}`;
const strike = (p: number) => (p / 100).toString();
const legName = (l: LegRef) => `${strike(l.strikePaise)} ${l.kind}`;
const usable = (rows: ChainQuote[]) => rows.filter((r) => r.traded && r.pricePaise > 0);

function nearestStrike(rows: ChainQuote[], targetPaise: number): ChainQuote | null {
  return usable(rows).sort((a, b) => Math.abs(a.strikePaise - targetPaise) - Math.abs(b.strikePaise - targetPaise))[0] ?? null;
}

/** The traded strike whose delta is nearest `target` (unsigned); a tie goes to the strike further from the index. */
export function strikeForDelta(m: MarketSnapshot, expiry: string, kind: Kind, target: number): ChainQuote | null {
  let best: ChainQuote | null = null, gap = Infinity;
  for (const r of usable(m.chain(expiry, kind))) {
    const d = m.delta({ expiry, strikePaise: r.strikePaise, kind });
    if (d == null) continue;
    const g = Math.abs(Math.abs(d) - target);
    const further = best != null && (kind === 'CE' ? r.strikePaise > best.strikePaise : r.strikePaise < best.strikePaise);
    if (g < gap - 1e-12 || (Math.abs(g - gap) <= 1e-12 && further)) { best = r; gap = g; }
  }
  return best;
}

const inPlaceOf = (old: SellLeg, strikePaise: number, expiry = old.expiry): OpenLeg => ({ expiry, strikePaise, kind: old.kind, side: old.side, qty: old.qty, role: old.role });

/** A wing moved along with its short, at the same distance, so the most this side can lose stays the same. */
function movedWing(m: MarketSnapshot, oldShort: SellLeg, wing: SellLeg | undefined, newStrike: number, expiry: string): OpenLeg | null | undefined {
  if (!wing) return undefined;
  const q = nearestStrike(m.chain(expiry, wing.kind), newStrike + (wing.strikePaise - oldShort.strikePaise));
  return q ? inPlaceOf(wing, q.strikePaise, expiry) : null;
}

type Tested = { leg: SellLeg; delta: number | null; other: SellLeg | undefined };

/** The short leg under pressure, if the trigger has fired. */
function testedShort(p: SellPosition, m: MarketSnapshot, pb: Playbook, ctx: DecideContext): Tested | null {
  const trigger = pb.adjust?.trigger;
  if (!trigger) return null;
  const list = shorts(p);
  const scored = list.map((leg) => ({ leg, delta: m.delta(leg) }));
  const perUnit = list.length ? p.creditPaise / list[0].qty : 0;
  const fired = scored.filter(({ leg, delta }) => {
    if (trigger.on === 'delta') return delta != null && Math.abs(delta) >= ctx.entryDelta * trigger.multiple;
    const line = trigger.on === 'strike' ? leg.strikePaise : leg.kind === 'CE' ? leg.strikePaise + perUnit : leg.strikePaise - perUnit;
    return leg.kind === 'CE' ? m.spotPaise >= line : m.spotPaise <= line;
  });
  if (!fired.length) return null;
  const top = fired.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))[0];
  return { ...top, other: list.find((l) => l.kind !== top.leg.kind) };
}

const priceOf = (m: MarketSnapshot, l: SellLeg) => m.quote(l)?.pricePaise ?? l.entryPaise;

function netCredit(m: MarketSnapshot, close: SellLeg[], open: { leg: OpenLeg; pricePaise: number }[], ctx: DecideContext) {
  let net = 0, cost = 0;
  for (const c of close) {
    const px = priceOf(m, c), side = c.side === 'SELL' ? 'BUY' : 'SELL';
    net += (side === 'SELL' ? 1 : -1) * c.qty * px;
    cost += ctx.fillCost(side, c.qty, px);
  }
  for (const o of open) {
    net += (o.leg.side === 'SELL' ? 1 : -1) * o.leg.qty * o.pricePaise;
    cost += ctx.fillCost(o.leg.side, o.leg.qty, o.pricePaise);
  }
  return { net, cost };
}

function buildAdjust(p: SellPosition, m: MarketSnapshot, action: AdjustAction, t: Tested, ctx: DecideContext): Decision {
  const replace = (old: SellLeg, q: ChainQuote, expiry: string, words: string): Decision => {
    const wing = wingFor(p, old), newWing = movedWing(m, old, wing, q.strikePaise, expiry);
    if (newWing === null) return { type: 'none', blocked: 'no traded strike for the protection' };
    const close = wing ? [old, wing] : [old];
    const open: OpenLeg[] = [inPlaceOf(old, q.strikePaise, expiry), ...(newWing ? [newWing] : [])];
    if (open.some((o) => !m.quote(o)?.traded)) return { type: 'none', blocked: 'a new leg did not trade' };
    const { net, cost } = netCredit(m, close, open.map((leg) => ({ leg, pricePaise: m.quote(leg)!.pricePaise })), ctx);
    if (net <= cost) return { type: 'none', blocked: 'no net credit after costs' };
    return { type: 'adjust', action, close: close.map(({ expiry: e, strikePaise, kind }) => ({ expiry: e, strikePaise, kind })), open, why: `${words}, collecting ${rupees(net)}` };
  };

  if (action === 'add-hedge') {
    if (wingFor(p, t.leg)) return { type: 'none', blocked: 'this side already has protection' };
    const away = (m.spotPaise * ctx.wingPct) / 100;
    const q = nearestStrike(m.chain(t.leg.expiry, t.leg.kind), t.leg.strikePaise + (t.leg.kind === 'CE' ? away : -away));
    if (!q) return { type: 'none', blocked: 'no traded strike for the protection' };
    return { type: 'adjust', action, close: [], open: [{ expiry: t.leg.expiry, strikePaise: q.strikePaise, kind: t.leg.kind, side: 'BUY', qty: t.leg.qty, role: 'wing' }], why: `${legName(t.leg)} is under pressure. Buy ${strike(q.strikePaise)} ${t.leg.kind} as protection for ${rupees(q.pricePaise * t.leg.qty)}` };
  }

  if (action === 'roll-tested-out') {
    const monthly = m.isMonthly(t.leg.expiry);
    const next = m.expiries.find((e) => e > t.leg.expiry && (!monthly || m.isMonthly(e)));
    if (!next) return { type: 'none', blocked: 'no later expiry listed' };
    // The furthest strike that still pays for the roll: never past the delta it was first sold at, never nearer than the
    // leg being replaced. Going straight back to the first delta almost never collects a credit once a leg is tested.
    const away = (r: ChainQuote) => (t.leg.kind === 'CE' ? r.strikePaise : -r.strikePaise);
    const candidates = usable(m.chain(next, t.leg.kind))
      .filter((r) => away(r) >= away({ ...r, strikePaise: t.leg.strikePaise }) && Math.abs(m.delta({ expiry: next, strikePaise: r.strikePaise, kind: t.leg.kind }) ?? 0) >= ctx.entryDelta * 0.9)
      .sort((a, b) => away(b) - away(a));
    if (!candidates.length) return { type: 'none', blocked: 'no traded strike in the next expiry' };
    let last: Decision = { type: 'none', blocked: 'no net credit after costs' };
    for (const q of candidates) {
      last = replace(t.leg, q, next, `${legName(t.leg)} is under pressure. Exit it and sell ${strike(q.strikePaise)} ${t.leg.kind} of ${next}`);
      if (last.type === 'adjust') return last;
    }
    return last;
  }

  const u = t.other;
  if (!u) return { type: 'none', blocked: 'no safe side left to move' };
  if (action === 'roll-safe-in') {
    const target = Math.min(0.3, Math.abs(t.delta ?? ctx.entryDelta * 2) / 2);
    if (target <= Math.abs(m.delta(u) ?? 0) * 1.2) return { type: 'none', blocked: 'safe side is already close enough' };
    const q = strikeForDelta(m, u.expiry, u.kind, target);
    if (!q || q.strikePaise === u.strikePaise) return { type: 'none', blocked: 'no better strike on the safe side' };
    if (u.kind === 'CE' ? q.strikePaise <= m.spotPaise : q.strikePaise >= m.spotPaise) return { type: 'none', blocked: 'would cross the index' };
    return replace(u, q, u.expiry, `${legName(t.leg)} is under pressure. Exit ${legName(u)} and sell ${strike(q.strikePaise)} ${u.kind}`);
  }
  // go-straddle: the safe side moves to the strike nearest the index. Past the tested strike, that is an inverted strangle.
  const q = nearestStrike(m.chain(u.expiry, u.kind), m.spotPaise);
  if (!q || q.strikePaise === u.strikePaise) return { type: 'none', blocked: 'no better strike on the safe side' };
  return replace(u, q, u.expiry, `${legName(t.leg)} is under pressure. Exit ${legName(u)} and sell ${strike(q.strikePaise)} ${u.kind} next to the index`);
}

export function decide(p: SellPosition, m: MarketSnapshot, pb: Playbook, ctx: DecideContext): Decision {
  const pnl = positionPnl(p, (l) => priceOf(m, l));
  const credit = p.creditPaise;
  if (pb.maxLossMultiple != null && pnl <= -credit * pb.maxLossMultiple) return { type: 'exit', reason: 'max-loss', why: `Loss of ${rupees(-pnl)} reached the limit of ${pb.maxLossMultiple} × the credit. Exit everything` };
  if (pb.stopMultiple != null && pnl <= -credit * pb.stopMultiple) return { type: 'exit', reason: 'stop', why: `Loss of ${rupees(-pnl)} reached the stop of ${pb.stopMultiple} × the credit. Exit everything` };
  if (pb.profitTakePct != null && pnl >= (credit * pb.profitTakePct) / 100) return { type: 'exit', reason: 'target', why: `${rupees(pnl)} earned, ${pb.profitTakePct}% of the credit. Book it` };
  if (pb.exitDaysLeft != null) {
    const nearest = shorts(p).map((l) => l.expiry).sort()[0];
    if (nearest && daysBetween(m.date, nearest) <= pb.exitDaysLeft) return { type: 'exit', reason: 'time', why: `${daysBetween(m.date, nearest)} days left to expiry. Exit everything as the rule says` };
  }
  if (!pb.adjust || p.adjustments >= pb.adjust.maxAdjustments) return { type: 'none' };
  const tested = testedShort(p, m, pb, ctx);
  return tested ? buildAdjust(p, m, pb.adjust.action, tested, ctx) : { type: 'none' };
}

/** The legs to open a new position, or why not. Strikes come from today's traded chain only. */
export function entryLegs(m: MarketSnapshot, expiry: string, e: SellEntry, lotSize: number, stepPaise: number): { legs: OpenLeg[]; delta: number } | { skip: string } {
  const qty = e.lots * lotSize;
  const legs: OpenLeg[] = [];
  let delta = 0;
  for (const kind of ['CE', 'PE'] as const) {
    let q: ChainQuote | null;
    if ('delta' in e.short) {
      q = strikeForDelta(m, expiry, kind, e.short.delta);
    } else {
      const atm = Math.round(m.spotPaise / stepPaise) * stepPaise;
      const k = atm + (kind === 'CE' ? 1 : -1) * e.short.stepsOtm * stepPaise;
      q = usable(m.chain(expiry, kind)).find((r) => r.strikePaise === k) ?? null;
    }
    if (!q) return { skip: `No traded ${kind} for ${expiry}` };
    delta = Math.max(delta, Math.abs(m.delta({ expiry, strikePaise: q.strikePaise, kind }) ?? 0));
    legs.push({ expiry, strikePaise: q.strikePaise, kind, side: 'SELL', qty, role: 'short' });
    if (e.wingPct != null) {
      const away = (m.spotPaise * e.wingPct) / 100, target = q.strikePaise + (kind === 'CE' ? away : -away);
      const w = nearestStrike(m.chain(expiry, kind), target);
      if (!w || Math.abs(w.strikePaise - target) > m.spotPaise * 0.01) return { skip: `No traded protection near the ${kind} wing for ${expiry}` };
      if (kind === 'CE' ? w.strikePaise <= q.strikePaise : w.strikePaise >= q.strikePaise) return { skip: `Protection would not sit beyond the ${kind} short` };
      legs.push({ expiry, strikePaise: w.strikePaise, kind, side: 'BUY', qty, role: 'wing' });
    }
  }
  if (e.crashPutPct != null) {
    const target = m.spotPaise * (1 - e.crashPutPct / 100), w = nearestStrike(m.chain(expiry, 'PE'), target);
    const short = legs.find((l) => l.kind === 'PE' && l.role === 'short')!;
    if (!w || Math.abs(w.strikePaise - target) > m.spotPaise * 0.01) return { skip: `No traded crash put near ${strike(Math.round(target))} for ${expiry}` };
    if (w.strikePaise >= short.strikePaise) return { skip: 'The crash put would not sit beyond the short put' };
    legs.push({ expiry, strikePaise: w.strikePaise, kind: 'PE', side: 'BUY', qty, role: 'wing' });
  }
  return { legs, delta };
}
