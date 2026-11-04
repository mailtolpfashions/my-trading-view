// Nandibull data service: NSE end-of-day data for research, backtesting and strategy building. The product
// publishes no live or delayed prices: charts, quotes and backtests read only NSE's official daily files, stored as
// published (apps/feed/src/eod). Zerodha Kite is the owner's personal connection for internal research scripts only.

import cors from '@fastify/cors';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { BacktestError, OptionsBacktestError, STUDY_HORIZONS, SimError, StudyTally, breakIndices, findEvents, runBacktest, runOptionsBacktest, simulatePosition, type OptionsStrategy, type SimInput, type RuleSet, type Strategy, type StudyEvent } from '@mtv/backtest';
import { prisma } from '@mtv/db';
import { positionMargin } from '@mtv/options';
import { EOD_TIMEFRAMES, type DataStatus, type EodTimeframe, type Quote } from '@mtv/shared';
import { verifyFeedToken, type FeedClaims } from '@mtv/shared/feed-token';
import { activeSession, clearSession, createSession, kiteConfigured, loadSession, loginUrl } from './providers/kite/session';
import { live, setLiveLog } from './intraday/instance';
import { INTRADAY_TFS, type Tf } from '@mtv/rules';
import { buildUpCycle, fnoCalendar, gexOn, maxPainHistory, derivedOn, derivedSeries, expiriesBetween, fnoUnderlyings, futuresMovers, isFnoUnderlying, ivGrid, latestFnoDay, lotSizes, strikeHistory } from './fno/analytics';
import { getChain, latestFnoDate } from './fno/chain';
import { prismaOptionsData } from './fno/data';
import { futuresHistory } from './fno/futures';
import { startParticipantSync } from './fno/participants';
import { startFiiStatsSync } from './fno/fii-stats';
import { startNsdlDaily } from './fno/fpi-flows';
import { SPAN_UNDERLYINGS, spanOn, spanToday } from './fno/span';
import { brokerById } from '@mtv/paper';
import { fnoStatus, startFnoSync } from './fno/store';
import { allEquityShareSymbols, dailyHistory, eodLoaded, eodStatus, loadEod, startEodSync } from './eod/store';
import { eodCandles, eodSeries, lastCloseQuote } from './eod/timeframes';
import { auditCandles } from './quality';
import { MARKET_EVENTS, niftyDays } from './research/nifty-days';
import { OVERVIEW_INDICES, breadth, indexCard, indexMembers, moveOn, movers, type IndexList, type StockMove } from './research/overview';
import { BREADTH_INDICES, RRG_BENCHMARKS, RRG_SECTORS, allBreadth, indexBreadth, rotation, warmMarketViews } from './market/service';
import { ScanError, runScan } from './signals/scanner';
import { ScreenError, cachedHistory, runScreen, type ScreenRequest } from './screener/screener';
import { UNIVERSE_INDICES, industries, resolveUniverse, type UniverseFilters, type UniverseSpec } from './screener/universe';
import { CONDITION_LIBRARY, FIELDS, FUNCTIONS, PRESETS } from '@mtv/rules';
import { UserStoreError, userStore } from './user/store';
import { AlertEngine } from './alerts/engine';
import { todayBrief } from './today/brief';
import { channelInfo, send } from './alerts/channels';
import { StrategyError, runStrategyBacktest, type BacktestRequest } from './strategy/backtest';
import { planAndPaper, startPaperTrade } from './selling/plan';
import { decayStudy, sellingReport, studyDetail, studyOverview } from './selling/study';
import { StudyError, catalog as studyCatalog, computeStudy, encodeNonFinite } from './studies/library';
import { findInstrument, loadEquities, searchInstruments } from './symbols';
import { COUNTED_ROUTES, VisitorQuota } from './visitor-quota';

const PORT = Number(process.env.FEED_PORT ?? 4001);
const WEB_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
// Testing from another device on the same network: FEED_HOST=0.0.0.0 and EXTRA_WEB_ORIGINS=http://<PC address>:3000.
const HOST = process.env.FEED_HOST ?? '127.0.0.1';
const EXTRA_ORIGINS = (process.env.EXTRA_WEB_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
const TOKEN_SECRET = process.env.FEED_TOKEN_SECRET ?? '';
const MAX_SYMBOLS = 100;
/** The options backtester and simulator cover these underlyings (their presets use these strike steps). */
const BACKTEST_UNDERLYINGS = ['NIFTY', 'BANKNIFTY'] as const;
/** Free runs a day for a visitor who hasn't signed in (per visitor id), and from one IP address. */
const VISITOR_DAILY_RUNS = Number(process.env.VISITOR_DAILY_RUNS ?? 5);
const VISITOR_DAILY_RUNS_PER_IP = Number(process.env.VISITOR_DAILY_RUNS_PER_IP ?? VISITOR_DAILY_RUNS * 4);
if (TOKEN_SECRET.length < 32) throw new Error('FEED_TOKEN_SECRET (32+ characters, shared with the web app) must be set in .env');

// Behind a reverse proxy (production), set TRUST_PROXY=1 so req.ip is the visitor's address, not the proxy's.
const app = Fastify({ logger: { level: 'info' }, trustProxy: process.env.TRUST_PROXY === '1' });

declare module 'fastify' {
  interface FastifyRequest { user?: FeedClaims }
}

// A failed background job (database restarting, NSE unreachable) must never take the service down: log it loudly.
process.on('unhandledRejection', (e) => app.log.error({ err: e }, 'Unhandled background error'));
await app.register(cors, { origin: [WEB_ORIGIN, ...EXTRA_ORIGINS], methods: ['GET', 'HEAD', 'POST'], exposedHeaders: ['X-Visitor-Remaining'] });
// An empty body sent as JSON means "no body", not an error.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = String(body ?? '');
  if (!text.trim()) return done(null, undefined);
  try { done(null, JSON.parse(text)); } catch { const e = new Error('Invalid JSON body') as Error & { statusCode: number }; e.statusCode = 400; done(e, undefined); }
});

/** NSE end-of-day status: the last trading day held. */
const status = (): DataStatus => {
  const nifty = dailyHistory('NIFTY');
  return { provider: 'nse-eod', delayed: false, asOf: nifty?.to };
};

// ---- access control ----
const tokenFrom = (req: FastifyRequest) => {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return (req.query as { token?: string } | undefined)?.token;
};
// Public: the owner's Kite login redirects (a browser navigation cannot carry the token). Everything else under /api
// needs a valid feed token.
const PUBLIC = new Set(['/api/kite/login', '/api/kite/callback']);
/** Routes that read the in-memory NSE history. */
const NEEDS_HISTORY = new Set(['/api/market/rrg', '/api/market/breadth', '/api/market/breadth-all', '/api/dashboard', '/api/research/study', '/api/research/fii', '/api/candles', '/api/quotes', '/api/backtest', '/api/options-backtest', '/api/studies/compute', '/api/research/nifty-days', '/api/eod/history', '/api/scan', '/api/screener/run', '/api/screener/count', '/api/strategy/backtest', '/api/today']);
// Visitors without an account may use everything (owner routes check `admin` themselves), with a daily allowance
// of runs (COUNTED_ROUTES). A run is counted only when it succeeds, so a rejected rule doesn't use one up.
const quota = new VisitorQuota(VISITOR_DAILY_RUNS, VISITOR_DAILY_RUNS_PER_IP);
const counted = (req: FastifyRequest) => !!req.user?.anon && COUNTED_ROUTES.has(req.url.split('?')[0]);
app.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (!path.startsWith('/api/') || PUBLIC.has(path)) return;
  const claims = verifyFeedToken(tokenFrom(req), TOKEN_SECRET);
  if (!claims) return reply.code(401).send({ error: 'unauthorised', message: 'Please sign in again' });
  req.user = claims;
  if (counted(req) && quota.remaining(claims.uid, req.ip) <= 0) {
    reply.header('X-Visitor-Remaining', '0');
    return reply.code(429).send({ error: 'visitor_limit', message: `You've used today's ${VISITOR_DAILY_RUNS} free runs. Sign in with Google (free) for unlimited use.` });
  }
  // Never answer from a half-loaded history (the feed loads years of NSE data into memory at start).
  if (!eodLoaded() && NEEDS_HISTORY.has(path)) return reply.code(503).send({ error: 'loading', message: 'NSE history is loading. Please try again in a moment.' });
});

app.addHook('onSend', async (req, reply, payload) => {
  if (counted(req) && reply.statusCode < 400) reply.header('X-Visitor-Remaining', String(quota.take(req.user!.uid, req.ip) ?? 0));
  return payload;
});

app.get('/health', async () => ({ ok: true, status: status() }));
// Search ranks NIFTY 500 members first within a match rank; the list is refreshed at most daily by indexMembers.
let popular: { set: Set<string>; at: number } = { set: new Set(), at: 0 };
app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => {
  if (Date.now() - popular.at > 6 * 3600_000) {
    popular.at = Date.now();
    await indexMembers('NIFTY 500').then((m) => { popular = { set: new Set(m.symbols), at: Date.now() }; }, () => {});
  }
  return searchInstruments(req.query.q ?? '', 20, undefined, popular.set);
});

const isEodTf = (tf: string): tf is EodTimeframe => (EOD_TIMEFRAMES as string[]).includes(tf);

/** NSE end-of-day candles (corporate-action adjusted) with the data audit; null when we hold no history. */
function history(symbol: string, tf: EodTimeframe) {
  const raw = eodCandles(symbol, tf);
  return raw ? auditCandles(raw, tf) : null;
}

app.get<{ Querystring: { symbol?: string; tf?: string } }>('/api/candles', async (req, reply) => {
  const symbol = (req.query.symbol ?? '').toUpperCase();
  const tf = req.query.tf ?? 'D';
  if (!isEodTf(tf)) return reply.code(400).send({ error: 'bad_timeframe', message: 'End-of-day data: D, W or M' });
  const instrument = findInstrument(symbol);
  if (!instrument) return reply.code(404).send({ error: 'unknown_symbol' });
  const h = history(symbol, tf);
  if (!h) return reply.code(404).send({ error: 'no_data', message: `No NSE history for ${symbol} yet` });
  return { instrument, tf, status: status(), quality: h.quality, candles: h.candles };
});

/** Last NSE close per symbol, dated (`time` = that trading day). */
app.get<{ Querystring: { symbols?: string } }>('/api/quotes', async (req) => {
  const symbols = (req.query.symbols ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => findInstrument(s)).slice(0, MAX_SYMBOLS);
  return symbols.map(lastCloseQuote).filter((q): q is Quote => !!q);
});

// ---- backtesting ----
app.post<{ Body: { symbol?: string; tf?: string; strategy?: Strategy } }>('/api/backtest', async (req, reply) => {
  const symbol = String(req.body?.symbol ?? '').toUpperCase();
  const tf = String(req.body?.tf ?? 'D');
  const instrument = findInstrument(symbol);
  if (!instrument) return reply.code(404).send({ error: 'unknown_symbol', message: `Unknown symbol ${symbol}` });
  if (!isEodTf(tf)) return reply.code(400).send({ error: 'bad_timeframe', message: 'Backtests run on end-of-day data: D, W or M' });
  if (!req.body?.strategy) return reply.code(400).send({ error: 'bad_strategy', message: 'Missing strategy' });
  const h = history(symbol, tf);
  if (!h) return reply.code(404).send({ error: 'no_data', message: `No NSE history for ${symbol} yet` });
  try {
    const started = performance.now();
    const result = runBacktest(h.candles, tf, req.body.strategy);
    req.log.info({ symbol, tf, bars: h.candles.length, trades: result.trades.length, ms: Math.round(performance.now() - started) }, 'backtest');
    return { instrument, tf, status: status(), quality: h.quality, result, candles: h.candles };
  } catch (e) {
    if (e instanceof BacktestError) return reply.code(400).send({ error: 'bad_strategy', message: e.message });
    req.log.error(e);
    return reply.code(500).send({ error: 'failed', message: 'Backtest failed' });
  }
});

app.get('/api/selling-report', async (_req, reply) => (await sellingReport()) ?? reply.code(404).send({ error: 'not_run', message: 'The report has not been built yet' }));
app.get('/api/selling-decay', async (_req, reply) => (await decayStudy()) ?? reply.code(404).send({ error: 'not_run', message: 'The premium decay study has not been run yet' }));
app.get('/api/selling-study', async (_req, reply) => (await studyOverview()) ?? reply.code(404).send({ error: 'not_run', message: 'The option-selling study has not been run yet' }));
app.get<{ Params: { id: string } }>('/api/selling-study/:id', async (req, reply) => (await studyDetail(req.params.id)) ?? reply.code(404).send({ error: 'not_found', message: 'No such rule set' }));

app.post<{ Body: { strategy?: OptionsStrategy } }>('/api/options-backtest', async (req, reply) => {
  const s = req.body?.strategy;
  if (!s || !(BACKTEST_UNDERLYINGS as readonly string[]).includes(s.underlying)) return reply.code(400).send({ error: 'bad_strategy', message: 'Options backtests cover NIFTY and BANKNIFTY' });
  try {
    const usesSignals = s.entry.when === 'signal' || !!s.exit.signal;
    const daily = usesSignals ? (history(s.underlying, 'D')?.candles ?? []) : [];
    const started = performance.now();
    const result = await runOptionsBacktest(s, prismaOptionsData, daily);
    req.log.info({ name: s.name, trades: result.trades.length, skipped: result.skipped.length, ms: Math.round(performance.now() - started) }, 'options backtest');
    return { status: status(), fno: await fnoStatus(), result };
  } catch (e) {
    if (e instanceof OptionsBacktestError) return reply.code(400).send({ error: 'bad_strategy', message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: 'failed', message: 'Options backtest failed' });
  }
});

// Margin for an F&O position: SPAN from NSE Clearing's start-of-day file + exposure margin (packages/options/margin.ts).
// `date` (a past trading day, for the options simulator) uses that day's file from NSE's archive instead.
type MarginBody = { underlying?: string; spotPaise?: number; date?: string; legs?: { kind: 'FUT' | 'CE' | 'PE'; expiry: string; strikePaise: number; qty: number; pricePaise?: number }[] };
app.post<{ Body: MarginBody }>('/api/margin', async (req, reply) => {
  const { underlying, legs, spotPaise, date } = req.body ?? {};
  if (date != null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.code(400).send({ error: 'bad_date', message: 'Date must be YYYY-MM-DD' });
  if (!underlying || !(SPAN_UNDERLYINGS as readonly string[]).includes(underlying)) return reply.code(400).send({ error: 'bad_underlying', message: `not calculated for ${underlying} yet. NSE SPAN margin is worked out for ${SPAN_UNDERLYINGS.join(', ')} so far` });
  const valid = Array.isArray(legs) && legs.length > 0 && legs.length <= 20 && legs.every((l) =>
    ['FUT', 'CE', 'PE'].includes(l.kind) && /^\d{4}-\d{2}-\d{2}$/.test(l.expiry) && Number.isSafeInteger(l.qty) && l.qty !== 0 && Number.isSafeInteger(l.strikePaise) && (l.pricePaise == null || Number.isSafeInteger(l.pricePaise)));
  if (!valid) return reply.code(400).send({ error: 'bad_legs', message: 'Send 1–20 legs with kind, expiry, strike, signed quantity' });
  try {
    const today = await spanToday();
    const past = date != null && date !== today?.tradeDate;
    const span = past ? await spanOn(date, underlying) : today;
    const d = span?.data[underlying];
    if (!span || !d) return reply.code(503).send({ error: 'no_span', message: past ? `NSE's margin file for ${date} is not available` : 'NSE margin file is not available right now' });
    const marginLegs = legs!.map((l) => ({ kind: l.kind, expiry: l.expiry, strike: l.strikePaise / 100, qty: l.qty, pricePaise: l.pricePaise }));
    const spot = Number.isSafeInteger(spotPaise) && spotPaise! > 0 ? spotPaise! : Math.round(d.spot * 100);
    return { ...positionMargin(d, marginLegs, spot, span.tradeDate), file: d.file, created: d.created, tradeDate: span.tradeDate, historical: past };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: 'failed', message: 'Margin calculation failed' });
  }
});

// Options simulator: a position built on a past day, followed on NSE's closes to expiry (packages/backtest/simulate.ts).
type SimBody = Omit<SimInput, 'broker'> & { broker?: string };
app.post<{ Body: SimBody }>('/api/options-sim', async (req, reply) => {
  const b = req.body;
  if (!b || !(BACKTEST_UNDERLYINGS as readonly string[]).includes(b.underlying)) return reply.code(400).send({ error: 'bad_position', message: 'The simulator covers NIFTY and BANKNIFTY' });
  try {
    const started = performance.now();
    const result = await simulatePosition({ underlying: b.underlying, entryDate: b.entryDate, legs: b.legs, broker: brokerById(b.broker) }, prismaOptionsData);
    req.log.info({ entry: b.entryDate, legs: b.legs?.length, days: result.days.length, ms: Math.round(performance.now() - started) }, 'options simulation');
    return result;
  } catch (e) {
    if (e instanceof SimError) return reply.code(400).send({ error: 'bad_position', message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: 'failed', message: 'Simulation failed' });
  }
});

// Dashboard: the last NSE session at a glance (research/overview.ts). Cached per session; it reads ~500 histories.
let overviewCache: { key: string; at: number; body: unknown } | null = null;
app.get('/api/dashboard', async (req, reply) => {
  const indices = OVERVIEW_INDICES.map((s) => indexCard(s, dailyHistory(s)?.candles)).filter((c) => c != null);
  const asOf = indices.find((c) => c.symbol === 'NIFTY')?.date;
  if (!asOf) return reply.code(503).send({ error: 'loading', message: 'NSE history is loading. Please try again in a moment.' });
  if (overviewCache?.key === asOf && Date.now() - overviewCache.at < 15 * 60_000) return overviewCache.body;
  const lists = await Promise.allSettled([indexMembers('NIFTY 50'), indexMembers('NIFTY 500')]);
  const n50 = lists[0].status === 'fulfilled' ? lists[0].value : null, n500 = lists[1].status === 'fulfilled' ? lists[1].value : null;
  const moves = new Map<string, StockMove | null>();
  for (const sym of new Set([...(n50?.symbols ?? []), ...(n500?.symbols ?? [])])) moves.set(sym, moveOn(sym, dailyHistory(sym)?.candles, asOf));
  const [fii, fpi] = await Promise.all([
    prisma.participantOi.findMany({ where: { kind: 'oi', participant: 'FII' }, orderBy: { date: 'desc' }, take: 2 }),
    prisma.fpiFlow.findFirst({ where: { category: 'Equity', route: 'Sub-total' }, orderBy: { reportDate: 'desc' } }),
  ]);
  const pos = (r: (typeof fii)[number]) => ({ date: r.date, futLong: Number(r.futIdxLong), futShort: Number(r.futIdxShort), callLong: Number(r.optIdxCallLong), callShort: Number(r.optIdxCallShort), putLong: Number(r.optIdxPutLong), putShort: Number(r.optIdxPutShort) });
  const body = {
    asOf,
    indices,
    nifty50: n50 && { listFetched: n50.fetched, breadth: breadth(n50.symbols, moves), ...movers(n50.symbols.map((x) => moves.get(x)).filter((m): m is StockMove => !!m)) },
    nifty500: n500 && { listFetched: n500.fetched, breadth: breadth(n500.symbols, moves) },
    fii: fii.length ? { latest: pos(fii[0]), previous: fii[1] ? pos(fii[1]) : null } : null,
    fpi: fpi && { reportDate: fpi.reportDate, netCr: Number(fpi.netCr) },
    sources: {
      prices: 'NSE end-of-day files (bhavcopy and index closes), corporate-action adjusted',
      members: 'NSE index constituent lists (nsearchives content/indices), current membership',
      fii: 'NSE participant-wise open interest, index futures and options, contracts',
      fpi: 'NSDL Daily Trends in FPI Investments, equity (covers the previous trading day)',
    },
  };
  if (n50 && n500) overviewCache = { key: asOf, at: Date.now(), body };
  return body;
});

// ---- F&O end-of-day data ----
app.get('/api/fno/status', async () => fnoStatus());
const isDate = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
/** The underlying from the query, upper-cased, if we hold F&O data for it; otherwise sends 400 and returns null. */
async function fnoUnderlying(raw: unknown, reply: FastifyReply): Promise<string | null> {
  const u = String(raw ?? 'NIFTY').toUpperCase();
  if (/^[A-Z0-9&-]{1,20}$/.test(u) && (await isFnoUnderlying(u))) return u;
  reply.code(400).send({ error: 'bad_underlying', message: `No NSE F&O data for ${u}` });
  return null;
}
app.get<{ Querystring: { underlying?: string; date?: string; expiry?: string } }>('/api/fno/chain', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  const date = await latestFnoDate(u, req.query.date);
  if (!date) return reply.code(404).send({ error: 'no_data', message: `No F&O data for ${u} on or before that date` });
  const chain = await getChain(u, date, req.query.expiry);
  return chain ?? reply.code(404).send({ error: 'no_data', message: `No options for ${u} on ${date}` });
});
app.get<{ Querystring: { underlying?: string; days?: string } }>('/api/futures/history', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  const days = Math.min(750, Math.max(5, Number(req.query.days) || 250));
  return { underlying: u, days: await futuresHistory(u, days) };
});
app.get('/api/fno/underlyings', async () => fnoUnderlyings());
/** Trading days held for an underlying and its expiry dates (for date pickers: holidays off, expiries marked). */
app.get<{ Querystring: { underlying?: string } }>('/api/fno/dates', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  const { dates, expiries } = await fnoCalendar(u);
  return { underlying: u, dates, expiries };
});
app.get('/api/fno/lot-sizes', async () => lotSizes());
/** Daily chain statistics (PCR, max pain, straddle, IV, HV, gamma exposure). Default: the last year, current expiry. */
app.get<{ Querystring: { underlying?: string; from?: string; to?: string; expiry?: string } }>('/api/fno/derived', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  const to = isDate(req.query.to) ? req.query.to : (await latestFnoDate(u)) ?? '';
  const from = isDate(req.query.from) ? req.query.from : new Date(Date.parse(`${to}T00:00:00Z`) - 365 * 86400_000).toISOString().slice(0, 10);
  if (!to || from > to) return reply.code(400).send({ error: 'bad_range', message: 'Pick a start date before the end date' });
  if (Date.parse(to) - Date.parse(from) > 6 * 366 * 86400_000) return reply.code(400).send({ error: 'bad_range', message: 'Pick at most 6 years' });
  const expiry = isDate(req.query.expiry) ? req.query.expiry : undefined;
  const [points, expiries] = await Promise.all([derivedSeries(u, from, to, expiry), expiriesBetween(u, from, to)]);
  return { underlying: u, from, to, expiry: expiry ?? null, expiries, points };
});
/** Every expiry's statistics on one day (term structure and max pain by expiry). */
app.get<{ Querystring: { underlying?: string; date?: string } }>('/api/fno/expiries', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  const date = await latestFnoDate(u, isDate(req.query.date) ? req.query.date : undefined);
  if (!date) return reply.code(404).send({ error: 'no_data', message: `No F&O data for ${u}` });
  return { underlying: u, date, expiries: await derivedOn(u, date) };
});
/** Daily quotes of chosen strikes (comma-separated rupees; empty = all) of one expiry, with spot and near future. */
app.get<{ Querystring: { underlying?: string; expiry?: string; strikes?: string; kind?: string; from?: string; to?: string } }>('/api/fno/strike-history', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  if (!isDate(req.query.expiry)) return reply.code(400).send({ error: 'bad_expiry', message: 'Pick an expiry' });
  const strikes = (req.query.strikes ?? '').split(',').map((x) => x.trim()).filter(Boolean).map(Number);
  if (strikes.length > 60 || strikes.some((k) => !Number.isFinite(k) || k <= 0)) return reply.code(400).send({ error: 'bad_strikes', message: 'Pick up to 60 strikes' });
  const kind = req.query.kind === 'CE' || req.query.kind === 'PE' ? req.query.kind : undefined;
  const r = await strikeHistory(u, req.query.expiry, strikes.map((k) => Math.round(k * 100)), kind, isDate(req.query.from) ? req.query.from : undefined, isDate(req.query.to) ? req.query.to : undefined);
  return { underlying: u, expiry: req.query.expiry, ...r };
});
/** Near-month futures of every underlying on a day: price and OI change, build-up, PCR. */
app.get<{ Querystring: { date?: string } }>('/api/fno/movers', async (req, reply) => {
  const latest = await latestFnoDay();
  if (!latest) return reply.code(404).send({ error: 'no_data', message: 'No F&O data downloaded yet' });
  const date = (await latestFnoDate('NIFTY', isDate(req.query.date) ? req.query.date : latest)) ?? latest;
  return futuresMovers(date);
});
/** Gamma exposure by strike for one day and expiry (latest day if none). */
app.get<{ Querystring: { underlying?: string; date?: string; expiry?: string } }>('/api/fno/gex', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  const date = await latestFnoDate(u, isDate(req.query.date) ? req.query.date : undefined);
  if (!date) return reply.code(404).send({ error: 'no_data', message: `No F&O data for ${u}` });
  const r = await gexOn(u, date, isDate(req.query.expiry) ? req.query.expiry : undefined);
  return r ?? reply.code(404).send({ error: 'no_data', message: `No options for ${u} on ${date}` });
});
/** Max pain some sessions before each expiry against the close on expiry day. */
app.get<{ Querystring: { underlying?: string; from?: string; before?: string } }>('/api/fno/max-pain-history', async (req, reply) => {
  const u = await fnoUnderlying(req.query.underlying, reply);
  if (!u) return reply;
  const from = isDate(req.query.from) ? req.query.from : new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);
  const before = Math.min(10, Math.max(1, Number(req.query.before) || 1));
  return { underlying: u, from, before, expiries: await maxPainHistory(u, from, before) };
});
app.get<{ Querystring: { sessions?: string } }>('/api/fno/buildup-cycle', async (req) => buildUpCycle(Math.min(120, Math.max(5, Number(req.query.sessions) || 50))));
app.get<{ Querystring: { date?: string } }>('/api/fno/iv-grid', async (req, reply) => {
  const latest = await latestFnoDay();
  if (!latest) return reply.code(404).send({ error: 'no_data', message: 'No F&O data downloaded yet' });
  const date = (await latestFnoDate('NIFTY', isDate(req.query.date) ? req.query.date : latest)) ?? latest;
  return { date, rows: await ivGrid(date) };
});

// ---- market: sector rotation and breadth (market/service.ts) ----
app.get<{ Querystring: { tf?: string; bench?: string } }>('/api/market/rrg', async (req) => {
  const tf = req.query.tf === 'W' ? 'W' : 'D';
  const bench = (RRG_BENCHMARKS as readonly string[]).includes(req.query.bench ?? '') ? req.query.bench! : 'NIFTY 50';
  return rotation(tf, bench);
});
app.get('/api/market/indices', async () => ({ breadth: BREADTH_INDICES, rrg: { sectors: RRG_SECTORS, benchmarks: RRG_BENCHMARKS } }));
app.get<{ Querystring: { index?: string; days?: string } }>('/api/market/breadth', async (req, reply) => {
  const index = (req.query.index ?? 'NIFTY 50').toUpperCase();
  if (!(BREADTH_INDICES as string[]).includes(index)) return reply.code(400).send({ error: 'bad_index', message: `No constituent list for ${index}` });
  const days = Math.min(750, Math.max(20, Number(req.query.days) || 250));
  try { return await indexBreadth(index as IndexList, days); } catch { return reply.code(503).send({ error: 'list_unavailable', message: `NSE's constituent list for ${index} could not be read right now` }); }
});
app.get('/api/market/breadth-all', async () => allBreadth());

// ---- research: NIFTY day by day (rows only; tables are built from them in the browser) ----
let expiryCache: { at: number; expiries: Set<string>; fnoDates: Set<string> } | null = null;
app.get('/api/research/nifty-days', async (_req, reply) => {
  const nifty = dailyHistory('NIFTY'), vix = dailyHistory('INDIAVIX');
  if (!nifty) return reply.code(503).send({ error: 'no_data', message: 'NIFTY history is not loaded yet' });
  if (!expiryCache || Date.now() - expiryCache.at > 3600_000) {
    const [ex, days] = await Promise.all([
      prisma.$queryRawUnsafe<{ expiry: string }[]>(`select distinct expiry from "FnoEod" where underlying = 'NIFTY' and kind = 'CE'`),
      prisma.fnoDayMeta.findMany({ where: { underlying: 'NIFTY' }, select: { date: true } }),
    ]);
    expiryCache = { at: Date.now(), expiries: new Set(ex.map((e) => e.expiry)), fnoDates: new Set(days.map((d) => d.date)) };
  }
  const rows = niftyDays(nifty.candles, vix?.candles ?? [], expiryCache.expiries, expiryCache.fnoDates);
  return { source: 'NSE official index closes (ind_close_all; PR bundle Pd before 2013)', from: rows[0]?.date ?? null, to: rows.at(-1)?.date ?? null, events: MARKET_EVENTS, rows };
});

// ---- research engine: every bar where a condition holds, and what happened next (packages/backtest/study.ts) ----
type StudyBody = { symbol?: string; tf?: string; rules?: RuleSet; horizons?: number[]; fromYear?: string; toYear?: string; excludeEvents?: string[] };
app.post<{ Body: StudyBody }>('/api/research/study', async (req, reply) => {
  const b = req.body ?? {};
  const tf = String(b.tf ?? 'D');
  if (!isEodTf(tf)) return reply.code(400).send({ error: 'bad_timeframe', message: 'End-of-day data: D, W or M' });
  const rules = b.rules;
  if (!rules?.conditions?.length || !['all', 'any'].includes(rules.match)) return reply.code(400).send({ error: 'bad_rules', message: 'Add at least one condition' });
  const horizons = (Array.isArray(b.horizons) && b.horizons.length ? b.horizons : STUDY_HORIZONS).filter((h) => Number.isInteger(h) && h >= 1 && h <= 250).slice(0, 6);
  const all = String(b.symbol ?? '').toUpperCase() === 'ALL';
  // "All" = every ordinary equity share with history, delisted ones included (no ETFs, rights entitlements, partly paid).
  const symbols = all ? allEquityShareSymbols() : [String(b.symbol ?? '').toUpperCase()];
  if (!all && !findInstrument(symbols[0])) return reply.code(404).send({ error: 'unknown_symbol', message: `Unknown symbol ${symbols[0]}` });
  // Excluded events by id or group prefix ('covid', 'election', 'budget' leave out every event of that kind).
  const excluded = MARKET_EVENTS.filter((e) => (b.excludeEvents ?? []).some((x) => e.id === x || e.id.startsWith(`${x}-`)));
  const keep = (d: string) => (!b.fromYear || d.slice(0, 4) >= b.fromYear) && (!b.toYear || d.slice(0, 4) <= b.toYear) && !excluded.some((e) => d >= e.from && d <= e.to);
  const years = new StudyTally(horizons, (d) => d.slice(0, 4), keep), months = new StudyTally(horizons, (d) => d.slice(0, 7), keep);
  const latest: StudyEvent[] = [];
  const breaksHit: { symbol: string; date: string; reason: string }[] = [];
  let total = 0, scanned = 0, breakCount = 0;
  const started = performance.now();
  try {
    for (const s of symbols) {
      const series = eodSeries(s, tf);
      if (!series || series.candles.length < 2) continue;
      scanned++;
      const c = series.candles;
      const brk = breakIndices(c, series.breaks.map((x) => x.date));
      for (const x of series.breaks) { if (!keep(x.date)) continue; breakCount++; breaksHit.push({ symbol: s, ...x }); }
      years.addBaseline(c, brk); months.addBaseline(c, brk);
      for (const e of findEvents(s, c, rules, horizons, brk)) {
        if (!keep(e.date)) continue;
        total++;
        years.addEvent(e); months.addEvent(e);
        latest.push(e);
      }
      if (latest.length > 4000) { latest.sort((x, y) => (x.date < y.date ? 1 : -1)); latest.length = 2000; }
    }
  } catch (e) {
    req.log.error(e);
    return reply.code(400).send({ error: 'bad_rules', message: 'These conditions could not be evaluated' });
  }
  latest.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : x.symbol < y.symbol ? -1 : 1));
  req.log.info({ symbols: scanned, tf, events: total, ms: Math.round(performance.now() - started) }, 'research study');
  breaksHit.sort((x, y) => (x.date < y.date ? 1 : -1));
  return { tf, horizons, symbols: scanned, totalEvents: total, years: years.rows(), months: months.rows(), events: latest.slice(0, 2000), excluded: excluded.map((e) => e.name), dataBreaks: { count: breakCount, latest: breaksHit.slice(0, 200) } };
});

// ---- research: FII footprints, day by day (NSE participant OI, NSE FII derivatives statistics, NSDL FPI flows) ----
app.get('/api/research/fii', async () => {
  const [oi, stats, flows] = await Promise.all([
    prisma.participantOi.findMany({ where: { kind: 'oi' }, orderBy: { date: 'asc' } }),
    prisma.fiiDerivStat.findMany({ where: { segment: { in: ['INDEX FUTURES', 'INDEX OPTIONS', 'NIFTY FUTURES', 'NIFTY OPTIONS', 'BANKNIFTY FUTURES', 'STOCK FUTURES'] } }, orderBy: { date: 'asc' } }),
    prisma.fpiFlow.findMany({ where: { OR: [{ category: 'Equity', route: 'Sub-total' }, { category: 'Total' }] }, orderBy: { reportDate: 'asc' } }),
  ]);
  const n = (v: bigint) => Number(v);
  type Positions = { futLong: number; futShort: number; callLong: number; callShort: number; putLong: number; putShort: number };
  const days = new Map<string, { date: string; positions: Partial<Record<string, Positions>>; stats: Record<string, { buyContracts: number; buyCr: number; sellContracts: number; sellCr: number; oiContracts: number; oiCr: number }>; fpiEquityNetCr: number | null; fpiTotalNetCr: number | null }>();
  const day = (date: string) => days.get(date) ?? days.set(date, { date, positions: {}, stats: {}, fpiEquityNetCr: null, fpiTotalNetCr: null }).get(date)!;
  for (const r of oi) day(r.date).positions[r.participant] = { futLong: n(r.futIdxLong), futShort: n(r.futIdxShort), callLong: n(r.optIdxCallLong), callShort: n(r.optIdxCallShort), putLong: n(r.optIdxPutLong), putShort: n(r.optIdxPutShort) };
  for (const s of stats) day(s.date).stats[s.segment] = { buyContracts: n(s.buyContracts), buyCr: Number(s.buyCr), sellContracts: n(s.sellContracts), sellCr: Number(s.sellCr), oiContracts: n(s.oiContracts), oiCr: Number(s.oiCr) };
  for (const f of flows) { const d = day(f.reportDate); if (f.category === 'Equity') d.fpiEquityNetCr = Number(f.netCr); else d.fpiTotalNetCr = Number(f.netCr); }
  // NIFTY's official close and change on each date, for context.
  const nifty = new Map((dailyHistory('NIFTY')?.candles ?? []).map((c, i, all) => [new Date((c.time + 5.5 * 3600) * 1000).toISOString().slice(0, 10), { close: c.close, changePct: i ? ((c.close - all[i - 1].close) / all[i - 1].close) * 100 : null }]));
  const rows = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map((d) => ({ ...d, nifty: nifty.get(d.date) ?? null }));
  return {
    sources: {
      positions: 'NSE participant-wise open interest (content/nsccl/fao_participant_oi_*), index futures and index options, contracts',
      stats: 'NSE FII derivatives statistics (content/fo/fii_stats_*.xls)',
      flows: 'NSDL Daily Trends in FPI Investments (reporting date; covers FPI trades of the previous trading day)',
    },
    rows,
  };
});

// ---- indicator library: calculated here, drawn in the browser ----
app.get('/api/studies/catalog', async (_req, reply) => {
  reply.header('Cache-Control', 'private, max-age=3600');
  return { indicators: await studyCatalog() };
});
app.post<{ Body: { symbol?: string; tf?: string; id?: string; inputs?: Record<string, unknown> } }>('/api/studies/compute', async (req, reply) => {
  const symbol = String(req.body?.symbol ?? '').toUpperCase();
  const tf = String(req.body?.tf ?? '');
  if (!findInstrument(symbol)) return reply.code(404).send({ error: 'unknown_symbol', message: `Unknown symbol ${symbol}` });
  if (!isEodTf(tf)) return reply.code(400).send({ error: 'bad_timeframe', message: 'End-of-day data: D, W or M' });
  const h = history(symbol, tf); // the same candles the chart shows
  if (!h) return reply.code(404).send({ error: 'no_data', message: `No data for ${symbol}` });
  try {
    const result = await computeStudy(String(req.body?.id ?? ''), h.candles, req.body?.inputs ?? {});
    reply.header('Content-Type', 'application/json');
    return JSON.stringify({ result }, encodeNonFinite);
  } catch (e) {
    if (e instanceof StudyError) return reply.code(400).send({ error: 'bad_study', message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: 'failed', message: 'Indicator could not be calculated' });
  }
});

// ---- NSE end-of-day history and scanner ----
app.get('/api/eod/status', async () => eodStatus());
app.get<{ Querystring: { symbol?: string } }>('/api/eod/history', async (req, reply) => {
  const h = dailyHistory(String(req.query.symbol ?? '').toUpperCase());
  return h ?? reply.code(404).send({ error: 'no_data', message: 'No NSE history for this symbol yet' });
});
app.post<{ Body: { rules?: RuleSet } }>('/api/scan', async (req, reply) => {
  try {
    return await runScan(req.body?.rules as RuleSet);
  } catch (e) {
    if (e instanceof ScanError) return reply.code(400).send({ error: 'bad_rules', message: e.message });
    req.log.error(e);
    return reply.code(500).send({ error: 'scan_failed', message: 'Scan failed' });
  }
});

// ---- Stock screener (packages/rules on NSE end-of-day history) ----
// Everything the builder and the formula editor need to describe the language: fields, functions, presets, universes.
app.get('/api/screener/meta', async () => ({
  timeframes: ['D', 'W', 'M'],
  fields: FIELDS.map(({ name, summary }) => ({ name, summary })),
  functions: FUNCTIONS.map(({ name, group, returns, params, summary }) => ({ name, group, returns, params, summary })),
  presets: PRESETS,
  library: CONDITION_LIBRARY,
  indices: UNIVERSE_INDICES,
  industries: await industries(),
}));
/** How many stocks a universe and its filters leave, before running a screen. */
app.post<{ Body: { universe?: UniverseSpec; filters?: UniverseFilters } }>('/api/screener/count', async (req, reply) => {
  try {
    const u = await resolveUniverse(req.body?.universe ?? { kind: 'all' }, req.body?.filters ?? {}, cachedHistory);
    return { eligible: u.symbols.length, excluded: u.excluded };
  } catch (e) {
    req.log.error(e);
    return reply.code(400).send({ error: 'bad_universe', message: (e as Error).message });
  }
});
app.post<{ Body: ScreenRequest }>('/api/screener/run', async (req, reply) => {
  try {
    const body = req.body ?? ({} as ScreenRequest);
    const r = await runScreen(body);
    req.log.info({ tf: r.tf, eligible: r.eligible, matches: r.matches, ms: r.ms }, 'screen');
    // History is a convenience: a failed write must not fail the screen.
    await userStore.recordRun({ at: new Date().toISOString(), asOf: r.asOf, matches: r.matches, scanned: r.scanned, ms: r.ms, screenId: body.screenId ?? null, name: body.name?.slice(0, 120) || 'Untitled screen', formula: r.formula, tf: r.tf })
      .catch((e) => req.log.error(e, 'could not record the run'));
    return r;
  } catch (e) {
    if (e instanceof ScreenError) return reply.code(400).send({ error: 'bad_screen', message: e.message });
    req.log.error(e);
    return reply.code(500).send({ error: 'screen_failed', message: 'The screen failed to run' });
  }
});

// ---- The owner's saved screens, watchlists and recent runs ----
const userRoute = <B>(fn: (body: B) => Promise<unknown>) => async (req: FastifyRequest<{ Body: B }>, reply: FastifyReply) => {
  try {
    return await fn((req.body ?? {}) as B);
  } catch (e) {
    if (e instanceof UserStoreError) return reply.code(400).send({ error: 'bad_request', message: e.message });
    req.log.error(e);
    return reply.code(500).send({ error: 'store_failed', message: 'Your change could not be saved' });
  }
};
app.get('/api/selling-plan', userRoute(() => planAndPaper()));
app.post('/api/selling-paper/start', userRoute(() => startPaperTrade()));
app.get('/api/user/screens', userRoute(() => userStore.screens()));
app.post('/api/user/screens', userRoute((b: Parameters<typeof userStore.saveScreen>[0]) => userStore.saveScreen(b)));
app.post('/api/user/screens/delete', userRoute((b: { id: string }) => userStore.deleteScreen(b.id).then(() => ({ ok: true }))));
app.post('/api/user/screens/favourite', userRoute((b: { id: string; favourite: boolean }) => userStore.setFavourite(b.id, !!b.favourite)));
app.get('/api/user/recent', userRoute(() => userStore.recent()));
app.get('/api/user/watchlists', userRoute(() => userStore.watchlists()));
app.post('/api/user/watchlists', userRoute((b: { id?: string; name: string; symbols: string[] }) => userStore.saveWatchlist(b)));
app.post('/api/user/watchlists/add', userRoute((b: { id: string; symbols: string[] }) => userStore.addToWatchlist(b.id, b.symbols)));
app.post('/api/user/watchlists/delete', userRoute((b: { id: string }) => userStore.deleteWatchlist(b.id).then(() => ({ ok: true }))));

app.get('/api/user/strategies', userRoute(() => userStore.strategies()));
app.post('/api/user/strategies', userRoute((b: Parameters<typeof userStore.saveStrategy>[0]) => userStore.saveStrategy(b)));
app.post('/api/user/strategies/delete', userRoute((b: { id: string }) => userStore.deleteStrategy(b.id).then(() => ({ ok: true }))));

// ---- The Today page: the day's mode and limits, and the brief ----
app.get('/api/user/settings', userRoute(() => userStore.settings()));
app.post('/api/user/settings', userRoute((b: Parameters<typeof userStore.saveSettings>[0]) => userStore.saveSettings(b)));
app.get('/api/today', async () => todayBrief());

// ---- Alerts on saved screens and strategy entry rules (src/alerts) ----
app.get('/api/user/alerts', userRoute(() => userStore.alerts()));
app.post('/api/user/alerts', userRoute((b: Parameters<typeof userStore.saveAlert>[0]) => userStore.saveAlert(b)));
app.post('/api/user/alerts/delete', userRoute((b: { id: string }) => userStore.deleteAlert(b.id).then(() => ({ ok: true }))));
app.post('/api/user/alerts/enabled', userRoute((b: { id: string; enabled: boolean }) => userStore.setAlertEnabled(b.id, !!b.enabled)));
app.get('/api/user/alert-events', userRoute(() => userStore.alertEvents()));
app.post('/api/user/alert-events/read', userRoute((b: { ids?: string[] }) => userStore.markAlertEventsRead(b.ids).then(() => ({ ok: true }))));
app.get('/api/alerts/channels', async () => channelInfo());
app.post<{ Body: { channel?: string } }>('/api/alerts/test', async (req, reply) => {
  const ch = channelInfo().find((c) => c.channel === req.body?.channel);
  if (!ch) return reply.code(400).send({ error: 'bad_channel', message: 'Unknown channel' });
  if (!ch.ready) return reply.code(400).send({ error: 'not_configured', message: `Add ${ch.needs.join(', ')} to .env, then restart the data service` });
  try {
    await send(ch.channel, { title: 'Test alert from Nandibull', lines: ['If you can read this, alerts will reach you here.'], link: null });
    return { ok: true };
  } catch (e) {
    return reply.code(502).send({ error: 'send_failed', message: (e as Error).message });
  }
});

// ---- Equity strategy backtest (packages/backtest portfolio engine) ----
app.post<{ Body: BacktestRequest }>('/api/strategy/backtest', async (req, reply) => {
  try {
    const r = await runStrategyBacktest(req.body);
    req.log.info({ stocks: r.stocks, trades: r.metrics.trades, ms: r.ms }, 'strategy backtest');
    if (req.body.strategyId) {
      const m = r.metrics, s = req.body.strategy;
      await userStore.recordBacktest(req.body.strategyId, { at: new Date().toISOString(), from: s.from, to: s.to, trades: m.trades, returnPct: m.returnPct, cagrPct: m.cagrPct, maxDrawdownPct: m.maxDrawdownPct, winRatePct: m.winRatePct })
        .catch((e) => req.log.error(e, 'could not record the backtest'));
    }
    return r;
  } catch (e) {
    if (e instanceof StrategyError) return reply.code(400).send({ error: 'bad_strategy', message: e.message });
    req.log.error(e);
    return reply.code(500).send({ error: 'backtest_failed', message: 'The backtest failed to run' });
  }
});

// ---- Kite Connect login: the owner's personal app, for internal research scripts only (never shown to users).
// Zerodha expires the session at 6 AM IST. ----
// Live and intraday data come from the owner's own Kite Connect account (personal use). Zerodha ends the session at
// 6 AM; the platform's Connect page starts the daily login. ?back=platform returns there afterwards.
const PLATFORM_URL = process.env.PLATFORM_URL ?? 'http://127.0.0.1:3100';
app.get('/api/kite/status', async (req, reply) => {
  if (!req.user?.admin) return reply.code(403).send({ error: 'forbidden' });
  return { configured: kiteConfigured(), ...live.status };
});
app.get<{ Querystring: { back?: string } }>('/api/kite/login', async (req, reply) => {
  if (!kiteConfigured()) return reply.code(400).send({ error: 'not_configured', message: 'Add KITE_API_KEY and KITE_API_SECRET to .env' });
  const back = req.query.back === 'platform' ? `&redirect_params=${encodeURIComponent('back=platform')}` : '';
  return reply.redirect(loginUrl() + back);
});
app.get<{ Querystring: { request_token?: string; status?: string; back?: string } }>('/api/kite/callback', async (req, reply) => {
  const back = (result: string) => reply.redirect(req.query.back === 'platform' ? `${PLATFORM_URL}/connect?kite=${result}` : `${WEB_ORIGIN}/admin?kite=${result}`);
  if (!req.query.request_token || req.query.status === 'cancelled') return back('cancelled');
  try {
    const s = await createSession(req.query.request_token);
    app.log.info(`Kite connected for ${s.userId}`);
    live.stop();
    void live.start();
    return back('connected');
  } catch (e) {
    app.log.error(e, 'Kite login failed');
    return back('failed');
  }
});
app.post('/api/kite/logout', async (req, reply) => {
  if (!req.user?.admin) return reply.code(403).send({ error: 'forbidden', message: 'Only the owner can disconnect Kite' });
  live.stop();
  await clearSession();
  live.status.state = 'login-required';
  return { ok: true };
});
/** Intraday bars (adjusted like the daily history), the forming bar included. */
app.get<{ Querystring: { symbol?: string; tf?: string } }>('/api/intraday/candles', async (req, reply) => {
  const symbol = String(req.query.symbol ?? '').toUpperCase(), tf = req.query.tf as Tf;
  if (!INTRADAY_TFS.includes(tf)) return reply.code(400).send({ error: 'bad_timeframe', message: `Intraday timeframes: ${INTRADAY_TFS.join(', ')}` });
  if (!live.has(symbol)) return reply.code(404).send({ error: 'no_intraday', message: live.status.state === 'live' ? `${symbol} is not in the live list (NIFTY 500, F&O stocks and the main indices)` : 'Connect Kite for intraday data' });
  const candles = await live.bars(symbol, tf, true);
  return { symbol, tf, candles, live: live.status.state === 'live' };
});

await loadEquities((m) => app.log.info(m));
// NSE end-of-day history (stocks, indices, corporate actions), F&O, and participant positions, downloaded politely.
// FEED_NO_SYNC=1 (a second instance for testing beside the main one): load the stored history, download nothing.
if (process.env.FEED_NO_SYNC === '1') void loadEod((m) => app.log.info(m));
else {
  startEodSync(process.env.EOD_BACKFILL_FROM ?? '2022-01-03', (m) => app.log.info(m));
  startFnoSync(process.env.FNO_BACKFILL_FROM ?? '2023-11-01', (m) => app.log.info(m));
  // FII / DII / Pro / Client positions in F&O: NSE's archive starts in January 2012.
  startParticipantSync(process.env.PARTICIPANT_BACKFILL_FROM ?? '2012-01-02', (m) => app.log.info(m));
  // FII buy / sell / open interest in derivatives: NSE's archive starts around December 2014.
  startFiiStatsSync(process.env.FII_STATS_BACKFILL_FROM ?? '2014-10-01', (m) => app.log.info(m));
  // FPI cash-market flows: NSDL's Daily Trends page, read once a day (it shows only the latest day).
  startNsdlDaily((m) => app.log.info(m));
}
warmMarketViews((m) => app.log.info(m));
setLiveLog((m) => app.log.info(m));
const alerts = new AlertEngine((m) => app.log.info(m));
if (process.env.FEED_NO_ALERTS !== '1') alerts.start();
if (process.env.FEED_NO_LIVE !== '1' && (await loadSession())) void live.start();
else live.status.state = 'login-required';
await app.listen({ port: PORT, host: HOST });
