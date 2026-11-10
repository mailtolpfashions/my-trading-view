// Trade lab's connections to the real world: live Kite prices (Market), NSE's official closes and final settlement
// (Closes), margin (index F&O: NSE SPAN with exposure; everything else: plain rules, labelled), and Postgres (Repo).
import { prisma } from '@mtv/db';
import { positionMargin, type MarginLeg } from '@mtv/options';
import type { Charges } from '@mtv/paper';
import { rawDays } from '../eod/store';
import { SPAN_UNDERLYINGS, spanToday } from '../fno/span';
import { live } from '../intraday/instance';
import { KITE_INDEX_SYMBOLS } from '../providers/kite/provider';
import type { MarginFn } from './engine';
import type { Closes, Instrument, LabOrder, LabTrade, Market, Quote, Repo } from './types';

const IST = 19800;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
const paise = (rupees: number) => Math.round(rupees * 100);

// ---------------------------------------------------------------- live prices

/** When each instrument last ticked (UTC seconds), and when any tick last arrived. */
const seen = new Map<number, number>();
let lastTickAt = 0;
let hooked: object | null = null;
const watched = new Set<number>();
/** The live connection, with Trade lab listening to its ticks (a reconnect makes a new connection: listen again). */
function kite() {
  const k = live.kite();
  if (k && hooked !== k) {
    hooked = k;
    watched.clear();
    k.tickListeners.push((ticks) => { const now = Math.floor(Date.now() / 1000); lastTickAt = now; for (const t of ticks) seen.set(t.token, now); });
  }
  return k;
}

export const kiteMarket: Market = {
  instrument(symbol) {
    const k = kite();
    if (!k) return null;
    const c = k.nfoContract(symbol);
    if (c) {
      const strike = paise(c.strike);
      return {
        symbol, exchange: 'NFO', kind: c.kind, underlying: c.underlying, expiry: c.expiry, strikePaise: c.kind === 'FUT' ? 0 : strike, lot: c.lot, token: c.token,
        label: `${c.underlying} ${day(c.expiry)} ${c.kind === 'FUT' ? 'FUT' : `${c.strike} ${c.kind}`}`,
      };
    }
    if (symbol in KITE_INDEX_SYMBOLS || symbol === 'NIFTY-FUT') return null; // an index itself can't be bought
    const token = k.tokenFor(symbol);
    return token == null ? null : { symbol, exchange: 'NSE', kind: 'EQ', underlying: symbol, expiry: null, strikePaise: 0, lot: 1, token, label: symbol };
  },
  quote(i) {
    const k = kite();
    if (!k || i.token == null) return null;
    const t = k.tickByToken(i.token);
    return t ? ({ ltpPaise: t.ltpPaise, bidPaise: t.bidPaise ?? 0, askPaise: t.askPaise ?? 0, at: seen.get(i.token) ?? 0 } satisfies Quote) : null;
  },
  watch(list) {
    const k = kite();
    if (!k) return;
    const fresh = list.map((i) => i.token).filter((t): t is number => t != null && !watched.has(t));
    fresh.forEach((t) => watched.add(t));
    k.watchTokens(fresh);
  },
  underlyingPrice(u) {
    const k = kite();
    return k?.lastTick(u)?.ltpPaise ?? null;
  },
  isOpen(now) {
    if (!kite()) return false;
    const d = new Date((now + IST) * 1000), min = d.getUTCHours() * 60 + d.getUTCMinutes();
    const weekday = d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
    // Ticks this session mean the exchange is open (a holiday streams nothing).
    return weekday && min >= 555 && min < 930 && now - lastTickAt < 180;
  },
};

// ---------------------------------------------------------------- official closes

export const nseCloses: Closes = {
  async close(i, date) {
    if (i.kind === 'EQ') { const r = rawDays(i.symbol).get(date); return r ? paise(r.close) : null; }
    const row = await prisma.fnoEod.findFirst({ where: { date, underlying: i.underlying, expiry: i.expiry!, kind: i.kind, strikePaise: i.strikePaise }, select: { closePaise: true } });
    return row?.closePaise ?? null;
  },
  async settlement(i, date) {
    if (i.kind === 'FUT') {
      const row = await prisma.fnoEod.findFirst({ where: { date, underlying: i.underlying, expiry: date, kind: 'FUT' }, select: { settlePaise: true } });
      return row?.settlePaise ?? null;
    }
    // Options settle at intrinsic value against the underlying's official close on expiry day.
    const meta = await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date, underlying: i.underlying } }, select: { spotPaise: true } });
    if (meta?.spotPaise == null) return null;
    return Math.max(0, i.kind === 'CE' ? meta.spotPaise - i.strikePaise : i.strikePaise - meta.spotPaise);
  },
};

// ---------------------------------------------------------------- margin

/**
 * Margin of the open positions:
 * - stocks: the value held (delivery), or the engine's 20% share for intraday (5× leverage);
 * - bought options: the premium value;
 * - index futures and sold index options (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY): NSE SPAN + exposure from today's
 *   NSE file, hedges counted;
 * - stock futures and sold stock options: an estimate of 20% of the contract value, labelled as such.
 */
export const liveMargin: MarginFn = async (list) => {
  let total = 0;
  const methods = new Set<string>();
  const fno = new Map<string, typeof list>();
  for (const x of list) {
    if (x.instrument.kind === 'EQ') { total += Math.round(Math.abs(x.qty) * x.pricePaise); continue; }
    if (x.instrument.kind !== 'FUT' && x.qty > 0) { total += x.qty * x.pricePaise; continue; } // bought option: premium
    (fno.get(x.instrument.underlying) ?? fno.set(x.instrument.underlying, []).get(x.instrument.underlying)!).push(x);
  }
  const span = fno.size ? await spanToday().catch(() => null) : null;
  for (const [u, legs] of fno) {
    const d = (SPAN_UNDERLYINGS as readonly string[]).includes(u) ? span?.data[u] : undefined;
    const spot = kiteMarket.underlyingPrice(u);
    if (d) {
      // SPAN needs the whole F&O book of this underlying (bought options too) to see hedges.
      const all: MarginLeg[] = list.filter((x) => x.instrument.underlying === u && x.instrument.kind !== 'EQ').map((x) => ({ kind: x.instrument.kind as MarginLeg['kind'], expiry: x.instrument.expiry!, strike: x.instrument.strikePaise / 100, qty: x.qty, pricePaise: x.pricePaise }));
      const m = positionMargin(d, all, spot ?? Math.round(d.spot * 100), span!.tradeDate);
      total += m.marginPaise;
      methods.add('NSE SPAN');
    } else {
      for (const x of legs) total += Math.round(0.2 * Math.abs(x.qty) * (x.instrument.kind === 'FUT' ? x.pricePaise : spot ?? x.pricePaise));
      methods.add('estimate: 20% of contract value');
    }
  }
  return { paise: total, method: methods.size ? [...methods].join(' + ') : 'value held' };
};

// ---------------------------------------------------------------- storage

const ACCOUNT_NAME = 'Trade lab';
const n = (v: bigint | null) => (v == null ? null : Number(v));
type OrderRow = Awaited<ReturnType<typeof prisma.paperOrder.findMany>>[number];
const toOrder = (r: OrderRow): LabOrder => ({
  id: r.id, symbol: r.symbol, exchange: r.exchange as LabOrder['exchange'], side: r.side as LabOrder['side'], product: r.product as LabOrder['product'],
  type: r.type as LabOrder['type'], qty: r.qty, lotSize: r.lotSize, pricePaise: n(r.pricePaise), triggerPaise: n(r.triggerPaise), stopPaise: n(r.stopPaise),
  targetPaise: n(r.targetPaise), parentId: r.parentId, status: r.status as LabOrder['status'], triggered: r.triggered, avgFillPaise: n(r.avgFillPaise),
  rejectReason: r.rejectReason, tag: r.tag, source: r.source, reason: r.reason, tradeDate: r.tradeDate, createdAt: Math.floor(r.createdAt.getTime() / 1000),
});

let accountId: Promise<string> | null = null;
/** Trade lab's own paper account (no user: single owner), created with ₹10 lakh on first use. */
function account(): Promise<string> {
  accountId ??= (async () => {
    const a = await prisma.paperAccount.findFirst({ where: { userId: null, name: ACCOUNT_NAME } })
      ?? await prisma.paperAccount.create({ data: { name: ACCOUNT_NAME, startingCashPaise: BigInt(10_00_000_00) } });
    return a.id;
  })().catch((e) => { accountId = null; throw e; });
  return accountId;
}

export const prismaRepo: Repo = {
  async account() {
    const a = await prisma.paperAccount.findUniqueOrThrow({ where: { id: await account() } });
    return { startingCashPaise: Number(a.startingCashPaise), resetAt: Math.floor(a.resetAt.getTime() / 1000) };
  },
  async reset(startingCashPaise) {
    const id = await account();
    await prisma.$transaction([
      prisma.paperTrade.deleteMany({ where: { accountId: id } }),
      prisma.paperOrder.deleteMany({ where: { accountId: id } }),
      prisma.paperAccount.update({ where: { id }, data: { startingCashPaise: BigInt(startingCashPaise), resetAt: new Date() } }),
    ]);
  },
  async orders(open) {
    const rows = await prisma.paperOrder.findMany({ where: { accountId: await account(), ...(open ? { status: { in: ['OPEN', 'TRIGGER_PENDING'] } } : {}) }, orderBy: { createdAt: 'asc' } });
    return rows.map(toOrder);
  },
  async trades() {
    const rows = await prisma.paperTrade.findMany({ where: { accountId: await account() }, orderBy: { time: 'asc' } });
    return rows.map((r): LabTrade => ({
      id: r.id, orderId: r.orderId, symbol: r.symbol, exchange: r.exchange as LabTrade['exchange'], side: r.side as LabTrade['side'], product: r.product as LabTrade['product'],
      qty: r.qty, pricePaise: Number(r.pricePaise), chargesPaise: Number(r.chargesPaise), charges: r.charges as unknown as Charges, time: Math.floor(r.time.getTime() / 1000), tradeDate: r.tradeDate,
    }));
  },
  async createOrder(o, nowSec) {
    const big = (v: number | null) => (v == null ? null : BigInt(v));
    const r = await prisma.paperOrder.create({ data: {
      accountId: await account(), symbol: o.symbol, exchange: o.exchange, side: o.side, product: o.product, type: o.type, qty: o.qty, lotSize: o.lotSize,
      pricePaise: big(o.pricePaise), triggerPaise: big(o.triggerPaise), stopPaise: big(o.stopPaise), targetPaise: big(o.targetPaise), parentId: o.parentId,
      status: o.status, triggered: o.triggered, rejectReason: o.rejectReason, tag: o.tag, source: o.source, reason: o.reason, tradeDate: o.tradeDate, createdAt: new Date(nowSec * 1000),
    } });
    return toOrder(r);
  },
  async updateOrder(id, from, patch) {
    const r = await prisma.paperOrder.updateMany({ where: { id, accountId: await account(), status: { in: from } }, data: patch });
    return r.count === 1;
  },
  async fill(id, from, t, reason) {
    const acc = await account();
    return prisma.$transaction(async (tx) => {
      const r = await tx.paperOrder.updateMany({ where: { id, accountId: acc, status: { in: from } }, data: { status: 'COMPLETE', avgFillPaise: BigInt(t.pricePaise), reason } });
      if (r.count !== 1) return false;
      await tx.paperTrade.create({ data: {
        orderId: id, accountId: acc, symbol: t.symbol, exchange: t.exchange, side: t.side, product: t.product, qty: t.qty, pricePaise: BigInt(t.pricePaise),
        chargesPaise: BigInt(t.chargesPaise), charges: t.charges as object, time: new Date(t.time * 1000), tradeDate: t.tradeDate,
      } });
      return true;
    });
  },
};

export type { Instrument };
