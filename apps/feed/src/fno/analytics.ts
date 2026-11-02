// Read-side analytics over the stored NSE F&O end-of-day data: the series and tables behind the options, futures
// and volatility tools. All inputs are NSE's official files; IV-based fields are model estimates.

import { prisma } from '@mtv/db';
import { dailyHistory } from '../eod/store';
import { classifyBuildUp, type BuildUp } from './futures';
import { RISK_FREE, getChain, latestFnoDate } from './chain';
import { closeOf } from './derive';
import { constantMaturityIv, gammaExposure, historicalVol, ivRankPercentile } from './metrics';
import { yearsToExpiry } from '@mtv/options';

const IST = 5.5 * 3600;
const LOOKBACK = 252; // sessions for IV rank / percentile

// ---- underlyings ----
let known: { at: number; set: Set<string> } = { at: 0, set: new Set() };
/** Whether we hold F&O data for this symbol (refreshed every 10 minutes). */
export async function isFnoUnderlying(u: string): Promise<boolean> {
  if (Date.now() - known.at > 600_000 || (!known.set.has(u) && Date.now() - known.at > 30_000)) {
    const rows = await prisma.fnoDayMeta.findMany({ distinct: ['underlying'], select: { underlying: true } });
    known = { at: Date.now(), set: new Set(rows.map((r) => r.underlying)) };
  }
  return known.set.has(u);
}

export async function latestFnoDay(): Promise<string | null> {
  return (await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY' }, orderBy: { date: 'desc' }, select: { date: true } }))?.date ?? null;
}

export type UnderlyingInfo = { symbol: string; isIndex: boolean; lotSize: number | null; spotPaise: number | null };
/** Every underlying in the latest day's F&O file: indices first, then stocks A–Z. */
export async function fnoUnderlyings(): Promise<{ date: string | null; underlyings: UnderlyingInfo[] }> {
  const date = await latestFnoDay();
  if (!date) return { date: null, underlyings: [] };
  const metas = await prisma.fnoDayMeta.findMany({ where: { date }, select: { underlying: true, isIndex: true, lotSize: true, spotPaise: true } });
  const order = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50'];
  const rank = (s: string) => (order.includes(s) ? order.indexOf(s) : order.length);
  const underlyings = metas.map((m) => ({ symbol: m.underlying, isIndex: m.isIndex, lotSize: m.lotSize, spotPaise: m.spotPaise }))
    .sort((a, b) => Number(b.isIndex) - Number(a.isIndex) || rank(a.symbol) - rank(b.symbol) || a.symbol.localeCompare(b.symbol));
  return { date, underlyings };
}

// ---- historical volatility from adjusted closes ----
/** Date → 20-session historical volatility, from the corporate-action adjusted daily closes (null if not held). */
function hvByDate(u: string, n = 20): Map<string, number> {
  const h = dailyHistory(u);
  const out = new Map<string, number>();
  if (!h) return out;
  const closes = h.candles.map((c) => c.close);
  const dates = h.candles.map((c) => new Date((c.time + IST) * 1000).toISOString().slice(0, 10));
  const breaks = new Set(h.breaks.map((b) => b.date));
  let lastBreak = -1;
  for (let i = 0; i < dates.length; i++) {
    if (breaks.has(dates[i])) lastBreak = i;
    // A data break inside the window would show as a fake jump: leave HV empty there.
    if (i < n || lastBreak > i - n) continue;
    const v = historicalVol(closes.slice(i - n, i + 1), n);
    if (v != null) out.set(dates[i], v);
  }
  return out;
}

// ---- per-day series ----
export type DerivedPoint = {
  date: string; expiry: string; daysToExpiry: number;
  spotPaise: number | null; forwardPaise: number | null; atmStrikePaise: number | null; strikeStepPaise: number | null;
  atmIv: number | null; iv30: number | null; iv30Exact: boolean; hv20: number | null; ivRank: number | null; ivPercentile: number | null;
  straddlePaise: number | null; straddleTraded: boolean; maxPainPaise: number | null;
  ceOi: number; peOi: number; ceVolume: number; peVolume: number; oiPcr: number | null; volumePcr: number | null;
  gexNet: number | null; callWallPaise: number | null; putWallPaise: number | null; gammaFlipPaise: number | null; gexIvFilled: number;
};

type DerivedRow = Awaited<ReturnType<typeof prisma.fnoDerivedDay.findMany>>[number];

/** 30-day IV per date from each date's expiries. */
function iv30ByDate(rows: DerivedRow[]): Map<string, { iv: number; exact: boolean }> {
  const byDate = new Map<string, { days: number; iv: number | null }[]>();
  for (const r of rows) {
    const list = byDate.get(r.date) ?? [];
    list.push({ days: r.daysToExpiry, iv: r.atmIv });
    byDate.set(r.date, list);
  }
  const out = new Map<string, { iv: number; exact: boolean }>();
  for (const [d, pts] of byDate) {
    const v = constantMaturityIv(pts);
    if (v) out.set(d, v);
  }
  return out;
}

/**
 * Daily statistics for one underlying between two dates. With `expiry`, that expiry's rows; otherwise each day's
 * nearest expiry on or after the date (the "current" contract, which rolls on expiry day + 1).
 */
export async function derivedSeries(underlying: string, from: string, to: string, expiry?: string): Promise<DerivedPoint[]> {
  // Extra sessions before `from` seed IV rank / percentile.
  const seed = await prisma.fnoDayMeta.findMany({ where: { underlying, date: { lt: from } }, orderBy: { date: 'desc' }, take: LOOKBACK, select: { date: true } });
  const start = seed.length ? seed[seed.length - 1].date : from;
  const rows = await prisma.fnoDerivedDay.findMany({ where: { underlying, date: { gte: start, lte: to } }, orderBy: [{ date: 'asc' }, { expiry: 'asc' }] });
  const iv30 = iv30ByDate(rows);
  const hv = hvByDate(underlying);
  const ivDates = [...iv30.keys()].sort();
  const out: DerivedPoint[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.date < from) continue;
    if (expiry ? r.expiry !== expiry : seen.has(r.date)) continue;
    seen.add(r.date);
    const iv = iv30.get(r.date);
    const idx = ivDates.indexOf(r.date);
    const past = idx > 0 ? ivDates.slice(Math.max(0, idx - LOOKBACK), idx).map((d) => iv30.get(d)!.iv) : [];
    const rp = iv ? ivRankPercentile(iv.iv, past) : { rank: null, percentile: null };
    const ceOi = Number(r.ceOi), peOi = Number(r.peOi), ceVolume = Number(r.ceVolume), peVolume = Number(r.peVolume);
    out.push({
      date: r.date, expiry: r.expiry, daysToExpiry: r.daysToExpiry,
      spotPaise: r.spotPaise, forwardPaise: r.forwardPaise, atmStrikePaise: r.atmStrikePaise, strikeStepPaise: r.strikeStepPaise,
      atmIv: r.atmIv, iv30: iv?.iv ?? null, iv30Exact: iv?.exact ?? false, hv20: hv.get(r.date) ?? null, ivRank: rp.rank, ivPercentile: rp.percentile,
      straddlePaise: r.straddlePaise, straddleTraded: r.straddleTraded, maxPainPaise: r.maxPainPaise,
      ceOi, peOi, ceVolume, peVolume, oiPcr: ceOi > 0 ? peOi / ceOi : null, volumePcr: ceVolume > 0 ? peVolume / ceVolume : null,
      gexNet: r.gexNet, callWallPaise: r.callWallPaise, putWallPaise: r.putWallPaise, gammaFlipPaise: r.gammaFlipPaise, gexIvFilled: r.gexIvFilled,
    });
  }
  return out;
}

/** Each expiry's statistics on one day (term structure, max pain per expiry). */
export async function derivedOn(underlying: string, date: string) {
  const rows = await prisma.fnoDerivedDay.findMany({ where: { underlying, date }, orderBy: { expiry: 'asc' } });
  return rows.map((r) => ({ ...r, ceOi: Number(r.ceOi), peOi: Number(r.peOi), ceVolume: Number(r.ceVolume), peVolume: Number(r.peVolume) }));
}

// ---- strike history ----
export type StrikeQuote = { date: string; kind: 'CE' | 'PE'; strikePaise: number; closePaise: number; oi: number; volume: number; traded: boolean };
export const MAX_STRIKE_ROWS = 60_000;

/** Daily quotes for chosen strikes (or all strikes) of one expiry, with the underlying price per day. */
export async function strikeHistory(underlying: string, expiry: string, strikesPaise: number[], kind?: 'CE' | 'PE', from?: string, to?: string) {
  const rows = await prisma.fnoEod.findMany({
    where: {
      underlying, expiry, kind: kind ? kind : { in: ['CE', 'PE'] },
      ...(strikesPaise.length ? { strikePaise: { in: strikesPaise } } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: [{ date: 'asc' }, { strikePaise: 'asc' }],
    take: MAX_STRIKE_ROWS + 1,
    select: { date: true, kind: true, strikePaise: true, closePaise: true, oi: true, volume: true, traded: true },
  });
  const truncated = rows.length > MAX_STRIKE_ROWS;
  const quotes: StrikeQuote[] = rows.slice(0, MAX_STRIKE_ROWS).map((r) => ({ ...r, kind: r.kind as 'CE' | 'PE', oi: Number(r.oi), volume: Number(r.volume) }));
  const dates = [...new Set(quotes.map((q) => q.date))];
  const metas = dates.length ? await prisma.fnoDayMeta.findMany({ where: { underlying, date: { in: dates } }, select: { date: true, spotPaise: true, lotSize: true } }) : [];
  const futs = dates.length ? await prisma.fnoEod.findMany({ where: { underlying, kind: 'FUT', date: { in: dates } }, select: { date: true, expiry: true, closePaise: true, oi: true } }) : [];
  const nearFut = new Map<string, { expiry: string; closePaise: number; oi: number }>();
  for (const f of futs) {
    if (f.expiry < f.date) continue;
    const cur = nearFut.get(f.date);
    if (!cur || f.expiry < cur.expiry) nearFut.set(f.date, { expiry: f.expiry, closePaise: f.closePaise, oi: Number(f.oi) });
  }
  return {
    quotes, truncated,
    days: dates.map((d) => {
      const m = metas.find((x) => x.date === d);
      return { date: d, spotPaise: m?.spotPaise ?? null, lotSize: m?.lotSize ?? null, future: nearFut.get(d) ?? null };
    }),
  };
}

/** Expiries listed for an underlying between two dates (for pickers on history pages). */
export async function expiriesBetween(underlying: string, from: string, to: string): Promise<string[]> {
  const rows = await prisma.fnoDerivedDay.findMany({ where: { underlying, date: { gte: from, lte: to } }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } });
  return rows.map((r) => r.expiry);
}

// ---- futures movers ----
export type Mover = {
  symbol: string; isIndex: boolean; lotSize: number | null; expiry: string;
  closePaise: number; changePct: number | null; spotPaise: number | null; spotChangePct: number | null;
  oi: number; oiChange: number | null; oiChangePct: number | null; volume: number;
  /** Approximate traded value in rupees: contracts × lot size × close (NSE's exact turnover is not stored); null without a lot size. */
  valueApprox: number | null; buildUp: BuildUp; oiPcr: number | null;
};

const prevFnoDate = async (date: string) => (await prisma.fnoDayMeta.findFirst({ where: { underlying: 'NIFTY', date: { lt: date } }, orderBy: { date: 'desc' }, select: { date: true } }))?.date ?? null;

/** Every underlying's near-month future on `date` against the same contract the previous trading day. */
export async function futuresMovers(date: string): Promise<{ date: string; prevDate: string | null; rows: Mover[] }> {
  const prevDate = await prevFnoDate(date);
  const [futs, prevFuts, metas, prevMetas, derived] = await Promise.all([
    prisma.fnoEod.findMany({ where: { date, kind: 'FUT', expiry: { gte: date } }, select: { underlying: true, expiry: true, closePaise: true, oi: true, volume: true, traded: true } }),
    prevDate ? prisma.fnoEod.findMany({ where: { date: prevDate, kind: 'FUT' }, select: { underlying: true, expiry: true, closePaise: true, oi: true } }) : [],
    prisma.fnoDayMeta.findMany({ where: { date } }),
    prevDate ? prisma.fnoDayMeta.findMany({ where: { date: prevDate }, select: { underlying: true, spotPaise: true } }) : [],
    prisma.fnoDerivedDay.findMany({ where: { date }, select: { underlying: true, expiry: true, ceOi: true, peOi: true }, orderBy: { expiry: 'asc' } }),
  ]);
  const near = new Map<string, (typeof futs)[number]>();
  for (const f of futs) if (!near.has(f.underlying) || f.expiry < near.get(f.underlying)!.expiry) near.set(f.underlying, f);
  const prev = new Map(prevFuts.map((f) => [`${f.underlying}|${f.expiry}`, f]));
  const prevSpot = new Map(prevMetas.map((m) => [m.underlying, m.spotPaise]));
  const pcr = new Map<string, number | null>();
  for (const d of derived) if (!pcr.has(d.underlying)) pcr.set(d.underlying, Number(d.ceOi) > 0 ? Number(d.peOi) / Number(d.ceOi) : null);
  const rows: Mover[] = [];
  for (const m of metas) {
    const f = near.get(m.underlying);
    if (!f) continue;
    const p = prev.get(`${m.underlying}|${f.expiry}`);
    const oi = Number(f.oi);
    const changePaise = p ? f.closePaise - p.closePaise : null;
    const oiChange = p ? oi - Number(p.oi) : null;
    const ps = prevSpot.get(m.underlying);
    rows.push({
      symbol: m.underlying, isIndex: m.isIndex, lotSize: m.lotSize, expiry: f.expiry,
      closePaise: f.closePaise, changePct: p && p.closePaise ? (changePaise! / p.closePaise) * 100 : null,
      spotPaise: m.spotPaise, spotChangePct: m.spotPaise != null && ps ? ((m.spotPaise - ps) / ps) * 100 : null,
      oi, oiChange, oiChangePct: p && Number(p.oi) > 0 ? (oiChange! / Number(p.oi)) * 100 : null, volume: Number(f.volume),
      valueApprox: m.lotSize ? (Number(f.volume) * m.lotSize * f.closePaise) / 100 : null, buildUp: classifyBuildUp(changePaise, oiChange), oiPcr: pcr.get(m.underlying) ?? null,
    });
  }
  return { date, prevDate, rows };
}

/**
 * Near-month futures build-up per underlying for the last `sessions` trading days (oldest first). A day is null when
 * the contract is missing that day or the day before (not downloaded, or not listed), so gaps are not read as neutral.
 */
export async function buildUpCycle(sessions = 50): Promise<{ dates: string[]; rows: { symbol: string; isIndex: boolean; phases: (BuildUp | null)[] }[] }> {
  const metas = await prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY' }, orderBy: { date: 'desc' }, take: sessions + 1, select: { date: true } });
  const dates = metas.map((m) => m.date).reverse();
  if (dates.length < 2) return { dates: [], rows: [] };
  const futs = await prisma.fnoEod.findMany({ where: { kind: 'FUT', date: { gte: dates[0] } }, select: { date: true, underlying: true, expiry: true, closePaise: true, oi: true } });
  const idx = await prisma.fnoDayMeta.findMany({ where: { date: dates[dates.length - 1] }, select: { underlying: true, isIndex: true } });
  const by = new Map<string, Map<string, Map<string, { closePaise: number; oi: number }>>>(); // u -> date -> expiry
  for (const f of futs) {
    const u = by.get(f.underlying) ?? new Map();
    by.set(f.underlying, u);
    const d = u.get(f.date) ?? new Map();
    u.set(f.date, d);
    d.set(f.expiry, { closePaise: f.closePaise, oi: Number(f.oi) });
  }
  const rows = idx.map(({ underlying, isIndex }) => {
    const u = by.get(underlying);
    const phases: (BuildUp | null)[] = dates.slice(1).map((date, i) => {
      const today = u?.get(date), before = u?.get(dates[i]);
      if (!today || !before) return null;
      const nearExp = [...today.keys()].filter((e) => e >= date).sort()[0];
      const t = nearExp ? today.get(nearExp) : undefined, b = nearExp ? before.get(nearExp) : undefined;
      return t && b ? classifyBuildUp(t.closePaise - b.closePaise, t.oi - b.oi) : null;
    });
    return { symbol: underlying, isIndex, phases };
  }).sort((a, b) => Number(b.isIndex) - Number(a.isIndex) || a.symbol.localeCompare(b.symbol));
  return { dates: dates.slice(1), rows };
}

// ---- IV grid ----
export type IvGridRow = { symbol: string; isIndex: boolean; spotPaise: number | null; iv30: number | null; iv30Change: number | null; hv20: number | null; ivRank: number | null; ivPercentile: number | null; ivMinusHv: number | null };
const ivGridCache = new Map<string, { at: number; rows: IvGridRow[] }>();

/** 30-day IV, its day change, 20-day HV, IV rank and IV percentile (252 sessions) for every underlying on `date`. */
export async function ivGrid(date: string): Promise<IvGridRow[]> {
  const hit = ivGridCache.get(date);
  if (hit && Date.now() - hit.at < 3600_000) return hit.rows;
  const seed = await prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY', date: { lte: date } }, orderBy: { date: 'desc' }, take: LOOKBACK + 1, select: { date: true } });
  const start = seed.length ? seed[seed.length - 1].date : date;
  const [rows, metas] = await Promise.all([
    prisma.fnoDerivedDay.findMany({ where: { date: { gte: start, lte: date } }, select: { date: true, underlying: true, daysToExpiry: true, atmIv: true } }),
    prisma.fnoDayMeta.findMany({ where: { date }, select: { underlying: true, isIndex: true, spotPaise: true } }),
  ]);
  const byU = new Map<string, typeof rows>();
  for (const r of rows) { const l = byU.get(r.underlying) ?? []; l.push(r); byU.set(r.underlying, l); }
  const out: IvGridRow[] = metas.map((m) => {
    const iv30 = iv30ByDate((byU.get(m.underlying) ?? []) as DerivedRow[]);
    const dates = [...iv30.keys()].sort();
    const today = iv30.get(date)?.iv ?? null;
    const prior = dates.filter((d) => d < date);
    const yesterday = prior.length ? iv30.get(prior[prior.length - 1])!.iv : null;
    const rp = today != null ? ivRankPercentile(today, prior.slice(-LOOKBACK).map((d) => iv30.get(d)!.iv)) : { rank: null, percentile: null };
    const hv20 = hvByDate(m.underlying).get(date) ?? null;
    return {
      symbol: m.underlying, isIndex: m.isIndex, spotPaise: m.spotPaise, iv30: today,
      iv30Change: today != null && yesterday != null ? today - yesterday : null, hv20, ivRank: rp.rank, ivPercentile: rp.percentile,
      ivMinusHv: today != null && hv20 != null ? today - hv20 : null,
    };
  }).sort((a, b) => Number(b.isIndex) - Number(a.isIndex) || a.symbol.localeCompare(b.symbol));
  ivGridCache.set(date, { at: Date.now(), rows: out });
  return out;
}

// ---- lot sizes ----
let lotCache: { at: number; body: unknown } | null = null;
/** Current lot size of every underlying and each date its lot size changed (days with an unknown lot are skipped). */
export async function lotSizes() {
  if (lotCache && Date.now() - lotCache.at < 3600_000) return lotCache.body;
  const date = await latestFnoDay();
  const metas = await prisma.fnoDayMeta.findMany({ where: { lotSize: { not: null } }, orderBy: [{ underlying: 'asc' }, { date: 'asc' }], select: { underlying: true, date: true, lotSize: true, isIndex: true } });
  const by = new Map<string, { symbol: string; isIndex: boolean; lotSize: number | null; current: boolean; changes: { from: string; lotSize: number }[] }>();
  for (const m of metas) {
    const e = by.get(m.underlying) ?? { symbol: m.underlying, isIndex: m.isIndex, lotSize: null, current: false, changes: [] };
    by.set(m.underlying, e);
    if (e.lotSize !== m.lotSize) e.changes.push({ from: m.date, lotSize: m.lotSize! });
    e.lotSize = m.lotSize;
    e.isIndex = m.isIndex;
    if (m.date === date) e.current = true;
  }
  const body = { date, rows: [...by.values()].sort((a, b) => Number(b.isIndex) - Number(a.isIndex) || a.symbol.localeCompare(b.symbol)) };
  lotCache = { at: Date.now(), body };
  return body;
}

// ---- gamma exposure by strike ----
/** Gamma exposure per strike on one day for one expiry (IV of untraded legs interpolated; see metrics.ts). */
export async function gexOn(underlying: string, date: string, expiry?: string) {
  const chain = await getChain(underlying, date, expiry);
  if (!chain) return null;
  const T = yearsToExpiry(closeOf(chain.date), chain.expiry);
  const g = chain.forwardPaise != null ? gammaExposure(chain.rows, chain.forwardPaise, T, RISK_FREE) : null;
  return { underlying, date: chain.date, expiry: chain.expiry, expiries: chain.expiries, spotPaise: chain.spotPaise, forwardPaise: chain.forwardPaise, lotSize: chain.lotSize, gex: g };
}

// ---- max pain against the expiry close ----
/**
 * For each expiry from `from`: the max-pain strike `sessionsBefore` trading sessions before expiry, and the
 * underlying's close on expiry day. Expiries without both are skipped.
 */
export async function maxPainHistory(underlying: string, from: string, sessionsBefore: number) {
  const rows = await prisma.fnoDerivedDay.findMany({
    where: { underlying, expiry: { gte: from } },
    select: { date: true, expiry: true, maxPainPaise: true, spotPaise: true },
    orderBy: [{ expiry: 'asc' }, { date: 'asc' }],
  });
  const latest = await latestFnoDate(underlying);
  const byExpiry = new Map<string, typeof rows>();
  for (const r of rows) { const l = byExpiry.get(r.expiry) ?? []; l.push(r); byExpiry.set(r.expiry, l); }
  const out: { expiry: string; date: string; maxPainPaise: number; spotThenPaise: number | null; expiryClosePaise: number }[] = [];
  for (const [expiry, list] of byExpiry) {
    if (!latest || expiry > latest) continue;
    const onExpiry = list.find((r) => r.date === expiry);
    const before = list.filter((r) => r.date < expiry);
    const pick = before[before.length - sessionsBefore];
    if (!onExpiry?.spotPaise || !pick?.maxPainPaise) continue;
    out.push({ expiry, date: pick.date, maxPainPaise: pick.maxPainPaise, spotThenPaise: pick.spotPaise, expiryClosePaise: onExpiry.spotPaise });
  }
  return out;
}

// ---- trading days and expiry days (date pickers) ----
const calendarCache = new Map<string, { key: string; dates: string[]; expiries: string[] }>();
/**
 * Trading days held for an underlying and every expiry date it has had, oldest first. Expiries are read with a
 * loose index scan (one index lookup per distinct expiry), so this stays fast on millions of contract rows.
 */
export async function fnoCalendar(underlying: string): Promise<{ dates: string[]; expiries: string[] }> {
  const latest = await latestFnoDate(underlying);
  const hit = calendarCache.get(underlying);
  if (hit && hit.key === latest) return hit;
  const [metas, exp] = await Promise.all([
    prisma.fnoDayMeta.findMany({ where: { underlying }, select: { date: true }, orderBy: { date: 'asc' } }),
    prisma.$queryRaw<{ x: string }[]>`
      WITH RECURSIVE e AS (
        SELECT min(expiry) AS x FROM "FnoEod" WHERE underlying = ${underlying}
        UNION ALL
        SELECT (SELECT min(expiry) FROM "FnoEod" WHERE underlying = ${underlying} AND expiry > e.x) FROM e WHERE e.x IS NOT NULL
      )
      SELECT x FROM e WHERE x IS NOT NULL`,
  ]);
  const body = { key: latest ?? '', dates: metas.map((m) => m.date), expiries: exp.map((r) => r.x) };
  calendarCache.set(underlying, body);
  return body;
}
