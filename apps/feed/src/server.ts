import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { BacktestError, OptionsBacktestError, runBacktest, runOptionsBacktest, validateStrategy, type OptionsStrategy, type RuleSet, type Strategy } from '@mtv/backtest';
import { prisma } from '@mtv/db';
import { toPaise, type PlaceOrderInput } from '@mtv/paper';
import { NEEDS_BROKER, TIMEFRAMES, marketSession, type Candle, type ClientMessage, type DataStatus, type Quote, type ServerMessage, type Timeframe } from '@mtv/shared';
import { verifyFeedToken, type FeedClaims, type Plan } from '@mtv/shared/feed-token';
import { DelayBuffer, LiveUsageRecorder, delayCandles, delayCandlesWithPartial, delayedQuoteFromBars } from './access';
import { PaperEngine } from './paper/engine';
import { PrismaPaperRepo } from './paper/repo';
import { FreeProvider } from './providers/free';
import { KiteProvider, LIVE_CHAIN_UNDERLYINGS, type LiveChainUnderlying } from './providers/kite/provider';
import { activeSession, clearSession, createSession, kiteConfigured, loadSession, loginUrl } from './providers/kite/session';
import { SwitchProvider } from './providers/switch';
import { NotFoundError, type MarketDataProvider } from './providers/types';
import { officialAttempts, startOfficialJob } from './official/job';
import { applyOfficial, loadOfficialStore, storedDays } from './official/store';
import { FNO_UNDERLYINGS, type FnoUnderlying } from './fno/bhavcopy';
import { getChain, latestFnoDate } from './fno/chain';
import { prismaOptionsData } from './fno/data';
import { fnoStatus, startFnoSync } from './fno/store';
import { classifyBuildUp, futuresHistory, previousOi } from './fno/futures';
import { ALERT_LIMITS, AlertEngine, planOf } from './alerts/engine';
import { ALERT_TIMEFRAMES, type PriceParams, type RulesParams } from './alerts/logic';
import { auditCandles } from './quality';
import { dailyHistory, eodStatus, onEodReady, startEodSync } from './eod/store';
import { publishStrategies, latestSignals, runSignals, signalDetail, signalsOverview } from './signals/runner';
import { ScanError, runScan } from './signals/scanner';
import { INDICES, allEquitySymbols, findInstrument, loadEquities, searchInstruments } from './symbols';

const PORT = Number(process.env.FEED_PORT ?? 4001);
const WEB_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const TOKEN_SECRET = process.env.FEED_TOKEN_SECRET ?? '';
const MAX_SUBSCRIPTIONS = 100;
if (TOKEN_SECRET.length < 32) throw new Error('FEED_TOKEN_SECRET (32+ characters, shared with the web app) must be set in .env');

const app = Fastify({ logger: { level: 'info' } });

declare module 'fastify' {
  interface FastifyRequest { user?: FeedClaims }
}

// Kite when DATA_PROVIDER=kite and logged in today; the free delayed source otherwise.
const wantKite = process.env.DATA_PROVIDER === 'kite';
const dirty = new Set<string>(); // symbols with new live ticks, flushed to browsers every 500 ms
const kite = new KiteProvider((m) => app.log.info(m), (symbols) => symbols.forEach((s) => dirty.add(s)));
const provider: MarketDataProvider = new SwitchProvider(new FreeProvider(), kite, wantKite);
if (wantKite && !kiteConfigured()) app.log.warn('DATA_PROVIDER=kite but KITE_API_KEY / KITE_API_SECRET are not set; using free delayed data.');

// A failed background job (database restarting, NSE unreachable) must never take the price feed down: log it loudly.
process.on('unhandledRejection', (e) => app.log.error({ err: e }, 'Unhandled background error'));
// The website calls PATCH and DELETE too (pause/delete alerts, cancel paper orders): the default only allows GET/HEAD/POST.
await app.register(cors, { origin: [WEB_ORIGIN], methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'] });
// An empty body sent as JSON (e.g. a DELETE from a client that always sets the header) means "no body", not an error.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
  const text = String(body ?? '');
  if (!text.trim()) return done(null, undefined);
  try { done(null, JSON.parse(text)); } catch { const e = new Error('Invalid JSON body') as Error & { statusCode: number }; e.statusCode = 400; done(e, undefined); }
});
await app.register(websocket);

const now = () => Math.floor(Date.now() / 1000);

// ---- access control and entitlements ----
const tokenFrom = (req: FastifyRequest) => {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return (req.query as { token?: string } | undefined)?.token;
};
const plans = new Map<string, Plan>(); // last known plan per user (from their tokens); unknown = FREE
const liveSource = () => !provider.status.delayed;
const isLive = (plan: Plan | undefined) => plan === 'LIVE';
const statusFor = (plan: Plan | undefined): DataStatus => ({ ...provider.status, delayed: provider.status.delayed || !isLive(plan) });
const delayBuffer = new DelayBuffer();
const liveUsage = new LiveUsageRecorder(
  (userId, month) => prisma.liveUsage.upsert({ where: { userId_month: { userId, month } }, create: { userId, month }, update: {} }).then(() => undefined),
  (m) => app.log.warn(m),
);

// 1-minute bars per symbol, refreshed at most once a minute, for Free users' delayed prices on a live source
// (the tick buffer only has data once the feed has been live for 15 minutes).
const oneMinute = new Map<string, { bars: Candle[]; at: number; loading: boolean }>();
function oneMinuteBars(symbol: string): Candle[] {
  const e = oneMinute.get(symbol);
  if (!e || (!e.loading && Date.now() - e.at > 60_000)) {
    const entry = e ?? { bars: [], at: 0, loading: false };
    entry.loading = true;
    oneMinute.set(symbol, entry);
    provider.candles(symbol, '1').then(
      (bars) => { entry.bars = bars; entry.at = Date.now(); },
      (err) => app.log.warn(`1-minute bars for ${symbol} failed: ${(err as Error).message}`),
    ).finally(() => { entry.loading = false; });
  }
  return e?.bars ?? [];
}
async function oneMinuteBarsNow(symbol: string): Promise<Candle[]> {
  const e = oneMinute.get(symbol);
  if (e && Date.now() - e.at <= 60_000) return e.bars;
  const bars = await provider.candles(symbol, '1');
  oneMinute.set(symbol, { bars, at: Date.now(), loading: false });
  return bars;
}

/** The quote a user may see: live for the Live plan; 15 minutes old for Free when the source is live. */
const quoteFor = (q: Quote, plan: Plan | undefined): Quote | null => {
  if (!liveSource() || isLive(plan)) return q;
  return delayBuffer.delayed(q.symbol, now()) ?? delayedQuoteFromBars(q, oneMinuteBars(q.symbol), now());
};
/** Bars a user may see: Free users on a live source get data 15+ minutes old, including the bar in progress then. */
async function candlesFor(symbol: string, candles: Candle[], tf: Timeframe, plan: Plan | undefined): Promise<Candle[]> {
  if (!liveSource() || isLive(plan)) return candles;
  try {
    const [minutes, daily] = await Promise.all([oneMinuteBarsNow(symbol), tf === 'W' ? provider.candles(symbol, 'D') : Promise.resolve([])]);
    return delayCandlesWithPartial(candles, tf, now(), minutes, daily);
  } catch (e) {
    app.log.warn(`Delayed partial bar for ${symbol} unavailable: ${(e as Error).message}`);
    return delayCandles(candles, tf, now()); // still never newer than the cutoff
  }
}
/** Every live quote from the provider passes through here so the delay buffer stays complete. */
const remember = (quotes: Quote[]) => {
  for (const q of quotes) {
    lastQuotes.set(q.symbol, q);
    if (liveSource()) delayBuffer.push(q);
  }
};

// Public: health, and the Kite login redirects (a browser navigation cannot carry the token; Zerodha only accepts the
// app owner's own Kite account). Everything else under /api needs a valid feed token.
const PUBLIC = new Set(['/api/kite/status', '/api/kite/login', '/api/kite/callback']);
/** What a visitor without an account (public chart page) may read: delayed chart data, nothing else. */
const VISITOR = new Set(['/api/search', '/api/candles', '/api/quotes']);
app.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (!path.startsWith('/api/') || PUBLIC.has(path)) return;
  const claims = verifyFeedToken(tokenFrom(req), TOKEN_SECRET);
  if (!claims) return reply.code(401).send({ error: 'unauthorised', message: 'Please sign in again' });
  if (claims.anon && !VISITOR.has(path)) return reply.code(403).send({ error: 'sign_up_required', message: 'Create a free account to use this feature' });
  req.user = claims;
  if (!claims.anon) plans.set(claims.uid, claims.plan); // visitors are always Free (the default); don't accumulate their ids
});

app.get('/health', async () => ({ ok: true, status: provider.status, session: marketSession(now()) }));

app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => searchInstruments(req.query.q ?? ''));

/** Daily and intraday history with the data audit, NSE official corrections (daily) and the user's entitlement applied. */
async function history(symbol: string, tf: Timeframe, deep: boolean, plan: Plan | undefined) {
  let raw = await provider.candles(symbol, tf, deep);
  let official;
  if (tf === 'D') ({ candles: raw, official } = applyOfficial(symbol, raw)); // NSE's official record wins
  const audited = auditCandles(raw, tf);
  if (official) audited.quality.official = official;
  return { candles: await candlesFor(symbol, audited.candles, tf, plan), quality: audited.quality };
}

app.get<{ Querystring: { symbol?: string; tf?: string } }>('/api/candles', async (req, reply) => {
  const symbol = (req.query.symbol ?? '').toUpperCase();
  const tf = (req.query.tf ?? '5') as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return reply.code(400).send({ error: 'bad_timeframe' });
  const instrument = findInstrument(symbol);
  if (!instrument) return reply.code(404).send({ error: 'unknown_symbol' });
  try {
    const { candles, quality } = await history(symbol, tf, false, req.user!.plan);
    if (!quality.ok) req.log.warn({ symbol, tf, missing: quality.missing.length, invalid: quality.invalid.length, misaligned: quality.misaligned.length }, 'candle data quality issues');
    return { instrument, tf, status: statusFor(req.user!.plan), quality, candles };
  } catch (e) {
    if (e instanceof NotFoundError) return reply.code(404).send({ error: 'no_data' });
    req.log.error(e);
    return reply.code(502).send({ error: 'upstream_failed' });
  }
});

app.get<{ Querystring: { symbols?: string } }>('/api/quotes', async (req, reply) => {
  const symbols = (req.query.symbols ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => findInstrument(s));
  try {
    const quotes = await provider.quotes(symbols.slice(0, MAX_SUBSCRIPTIONS));
    remember(quotes);
    return quotes.map((q) => quoteFor(q, req.user!.plan)).filter((q): q is Quote => !!q);
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: 'upstream_failed' });
  }
});

// ---- backtesting ----
app.post<{ Body: { symbol?: string; tf?: string; strategy?: Strategy } }>('/api/backtest', async (req, reply) => {
  const symbol = String(req.body?.symbol ?? '').toUpperCase();
  const tf = (req.body?.tf ?? 'D') as Timeframe;
  const instrument = findInstrument(symbol);
  if (!instrument) return reply.code(404).send({ error: 'unknown_symbol', message: `Unknown symbol ${symbol}` });
  if (!TIMEFRAMES.includes(tf)) return reply.code(400).send({ error: 'bad_timeframe', message: 'Unknown timeframe' });
  if (!req.body?.strategy) return reply.code(400).send({ error: 'bad_strategy', message: 'Missing strategy' });
  try {
    const { candles, quality } = await history(symbol, tf, true, req.user!.plan);
    const started = performance.now();
    const result = runBacktest(candles, tf, req.body.strategy);
    req.log.info({ symbol, tf, bars: candles.length, trades: result.trades.length, ms: Math.round(performance.now() - started) }, 'backtest');
    return { instrument, tf, status: statusFor(req.user!.plan), quality, result, candles };
  } catch (e) {
    if (e instanceof BacktestError) return reply.code(400).send({ error: 'bad_strategy', message: e.message });
    if (e instanceof NotFoundError) return reply.code(404).send({ error: 'no_data', message: `No data for ${symbol}` });
    req.log.error(e);
    return reply.code(502).send({ error: 'upstream_failed', message: 'Market data is unavailable right now' });
  }
});

app.post<{ Body: { strategy?: OptionsStrategy } }>('/api/options-backtest', async (req, reply) => {
  const s = req.body?.strategy;
  if (!s || !(FNO_UNDERLYINGS as readonly string[]).includes(s.underlying)) return reply.code(400).send({ error: 'bad_strategy', message: 'Options backtests cover NIFTY and BANKNIFTY' });
  try {
    const usesSignals = s.entry.when === 'signal' || !!s.exit.signal;
    const daily = usesSignals ? (await history(s.underlying, 'D', true, req.user!.plan)).candles : [];
    const started = performance.now();
    const result = await runOptionsBacktest(s, prismaOptionsData, daily);
    req.log.info({ name: s.name, trades: result.trades.length, skipped: result.skipped.length, ms: Math.round(performance.now() - started) }, 'options backtest');
    return { status: statusFor(req.user!.plan), fno: await fnoStatus(), result };
  } catch (e) {
    if (e instanceof OptionsBacktestError) return reply.code(400).send({ error: 'bad_strategy', message: e.message });
    req.log.error(e);
    return reply.code(502).send({ error: 'failed', message: 'Options backtest failed' });
  }
});

// ---- Kite Connect login (owner's personal app, local development only; Zerodha expires the session at 6 AM IST) ----
const kiteStatus = () => {
  const s = activeSession();
  return { selected: wantKite, configured: kiteConfigured(), loggedIn: !!s, userName: s?.userName ?? null, expiresAt: s?.expiresAt ?? null, live: kite.ticker.connected, ready: kite.ready };
};
app.get('/api/kite/status', async () => kiteStatus());
app.get('/api/kite/login', async (_req, reply) => {
  if (!kiteConfigured()) return reply.code(400).send({ error: 'not_configured', message: 'Add KITE_API_KEY and KITE_API_SECRET to .env' });
  return reply.redirect(loginUrl());
});
app.get<{ Querystring: { request_token?: string; status?: string } }>('/api/kite/callback', async (req, reply) => {
  const back = (result: string) => reply.redirect(`${WEB_ORIGIN}/terminal?kite=${result}`);
  if (!req.query.request_token || req.query.status === 'cancelled') return back('cancelled');
  try {
    const s = await createSession(req.query.request_token);
    await startKite();
    app.log.info(`Kite connected for ${s.userId}`);
    return back('connected');
  } catch (e) {
    app.log.error(e, 'Kite login failed');
    return back('failed');
  }
});
app.post('/api/kite/logout', async (req, reply) => {
  if (!req.user?.admin) return reply.code(403).send({ error: 'forbidden', message: 'Only the site owner can disconnect Kite' });
  kite.ticker.stop();
  await clearSession();
  broadcastStatus();
  return { ok: true };
});

async function startKite() {
  await kite.loadInstruments();
  kite.ticker.start();
  // Record the whole market, not just what someone is watching, so Free users' delayed replay is complete.
  kite.streamAlways([...INDICES.map((i) => i.symbol), ...allEquitySymbols()]);
  broadcastStatus();
}

// ---- F&O end-of-day data ----
app.get('/api/fno/status', async () => fnoStatus());
app.get<{ Querystring: { underlying?: string; date?: string; expiry?: string } }>('/api/fno/chain', async (req, reply) => {
  const u = String(req.query.underlying ?? 'NIFTY').toUpperCase();
  if (!(FNO_UNDERLYINGS as readonly string[]).includes(u)) return reply.code(400).send({ error: 'bad_underlying', message: 'Options data covers NIFTY and BANKNIFTY' });
  const date = await latestFnoDate(u as FnoUnderlying, req.query.date);
  if (!date) return reply.code(404).send({ error: 'no_data', message: 'No F&O data downloaded yet' });
  const chain = await getChain(u as FnoUnderlying, date, req.query.expiry);
  return chain ?? reply.code(404).send({ error: 'no_data', message: `No options for ${u} on ${date}` });
});
// ---- index futures: history from NSE's files for every signed-in user; live (Kite) for admin / Live plan ----
app.get<{ Querystring: { underlying?: string; days?: string } }>('/api/futures/history', async (req, reply) => {
  const u = String(req.query.underlying ?? 'NIFTY').toUpperCase();
  if (!(FNO_UNDERLYINGS as readonly string[]).includes(u)) return reply.code(400).send({ error: 'bad_underlying', message: 'Futures cover NIFTY and BANKNIFTY' });
  const days = Math.min(750, Math.max(5, Number(req.query.days) || 250));
  return { underlying: u, days: await futuresHistory(u as FnoUnderlying, days) };
});
app.get<{ Querystring: { underlying?: string } }>('/api/futures/live', async (req, reply) => {
  const u = String(req.query.underlying ?? 'NIFTY').toUpperCase() as LiveChainUnderlying;
  if (!(LIVE_CHAIN_UNDERLYINGS as readonly string[]).includes(u)) return reply.code(400).send({ error: 'bad_underlying', message: 'Futures cover NIFTY and BANKNIFTY' });
  if (!liveSource() || !kite.ready) return reply.code(503).send({ error: NEEDS_BROKER, message: 'Live futures need a live data connection' });
  if (!isLive(req.user!.plan) && !req.user!.admin) return reply.code(403).send({ error: 'live_plan_required', message: 'Live futures are on the Live plan. End-of-day futures data is shown below.' });
  try {
    const today = new Date((now() + 5.5 * 3600) * 1000).toISOString().slice(0, 10);
    const [live, prev] = await Promise.all([kite.liveFutures(u), previousOi(u, today)]);
    const total = live.contracts.reduce((s, c) => s + c.oi, 0);
    const contracts = live.contracts.map((c) => {
      const prevOi = prev?.oi.get(c.expiry);
      const change = c.prevClosePaise > 0 && c.ltpPaise > 0 ? c.ltpPaise - c.prevClosePaise : null;
      const oiChange = prevOi != null ? c.oi - prevOi : null;
      const basis = live.spotPaise != null && c.ltpPaise > 0 ? c.ltpPaise - live.spotPaise : null;
      const dte = Math.max(0, Math.round((Date.parse(`${c.expiry}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400_000));
      return {
        ...c, changePaise: change, oiChange, oiBaseDate: prev?.date ?? null, buildUp: classifyBuildUp(change, oiChange), basisPaise: basis, daysToExpiry: dte,
        premiumPct: basis != null && live.spotPaise ? (basis / live.spotPaise) * 100 : null,
        carryPct: basis != null && live.spotPaise && dte > 0 ? (basis / live.spotPaise) * (365 / dte) * 100 : null,
      };
    });
    return { underlying: u, asOf: now(), spotPaise: live.spotPaise, lot: live.lot, totalOi: total, rolloverPct: total > 0 && contracts.length > 1 ? ((total - contracts[0].oi) / total) * 100 : null, contracts };
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: 'upstream_failed', message: 'Live futures are unavailable right now' });
  }
});

app.get('/api/official/status', async () => ({ days: storedDays(), attempts: officialAttempts() }));

// ---- NSE end-of-day history, scanner and signals (all from NSE's official files) ----
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
app.get('/api/signals', async () => ({ strategies: signalsOverview(), ...(await latestSignals()) }));
app.get<{ Params: { id: string } }>('/api/signals/:id', async (req, reply) => (await signalDetail(req.params.id)) ?? reply.code(404).send({ error: 'not_found' }));
// Live option chain from the live source. With the owner's personal Kite connection it is for the owner (admin) and
// Live-plan testing only: Kite's data is licensed for personal use. Subscribers get it from the licensed vendor.
app.get<{ Querystring: { underlying?: string; expiry?: string } }>('/api/option-chain', async (req, reply) => {
  const u = String(req.query.underlying ?? 'NIFTY').toUpperCase() as LiveChainUnderlying;
  if (!(LIVE_CHAIN_UNDERLYINGS as readonly string[]).includes(u)) return reply.code(400).send({ error: 'bad_underlying', message: 'Live option chain covers NIFTY and BANKNIFTY' });
  if (!liveSource() || !kite.ready) return reply.code(503).send({ error: NEEDS_BROKER, message: 'The live option chain needs a live data connection' });
  if (!isLive(req.user!.plan) && !req.user!.admin) return reply.code(403).send({ error: 'live_plan_required', message: 'The live option chain is on the Live plan. The end-of-day chain is in the Option chain module.' });
  try {
    const chain = await kite.liveChain(u, req.query.expiry);
    return chain ? { ...chain, live: true, asOf: now() } : reply.code(404).send({ error: 'no_data', message: `No ${u} options found` });
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: 'upstream_failed', message: 'Live option chain is unavailable right now' });
  }
});

// ---- paper trading (one account per user) ----
const lastQuotes = new Map<string, Quote>();
const ltpPaise = (q?: Quote | null) => (q ? toPaise(q.ltp.toFixed(2)) : undefined);
const IST = 5.5 * 3600;
const paper = new PaperEngine({
  repo: new PrismaPaperRepo(),
  ltp: (s, uid) => { const q = lastQuotes.get(s); return q ? ltpPaise(quoteFor(q, plans.get(uid))) : undefined; },
  freshLtp: async (s, uid) => {
    const quotes = await provider.quotes([s]);
    remember(quotes);
    return quotes[0] ? ltpPaise(quoteFor(quotes[0], plans.get(uid))) : undefined;
  },
  // Close of the 15:15–15:20 bar (the price at 15:20 IST) on `date`, or the last bar before it.
  squareOffPrice: async (s, date) => {
    const cutoff = Date.parse(`${date}T15:15:00Z`) / 1000 - IST;
    const day = Date.parse(`${date}T00:00:00Z`) / 1000 - IST;
    const bar = (await provider.candles(s, '5')).filter((c) => c.time >= day && c.time <= cutoff).at(-1);
    return bar ? toPaise(bar.close.toFixed(2)) : undefined;
  },
  isTradable: (s) => findInstrument(s)?.kind === 'EQUITY',
  session: () => marketSession(now()),
  now,
  onChange: (uid) => void broadcastPaper(uid),
  log: (m) => app.log.info(m),
});

const paperError = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) => {
  app.log.error(e);
  return reply.code(503).send({ error: 'paper_unavailable', message: 'Paper trading is unavailable. Is the database running (npm run db:start)?' });
};

app.get('/api/paper', async (req, reply) => {
  try { return await paper.snapshot(req.user!.uid); } catch (e) { return paperError(reply, e); }
});
app.post<{ Body: PlaceOrderInput }>('/api/paper/orders', async (req, reply) => {
  try { return await paper.placeOrder(req.user!.uid, req.body); } catch (e) { return paperError(reply, e); }
});
app.delete<{ Params: { id: string } }>('/api/paper/orders/:id', async (req, reply) => {
  try {
    return (await paper.cancelOrder(req.user!.uid, req.params.id)) ? { ok: true } : reply.code(409).send({ error: 'not_open', message: 'Order is no longer open' });
  } catch (e) { return paperError(reply, e); }
});
app.post<{ Body: { startingCash: string | number } }>('/api/paper/reset', async (req, reply) => {
  try {
    await paper.reset(req.user!.uid, req.body.startingCash);
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && /Starting funds/.test(e.message)) return reply.code(400).send({ error: 'bad_amount', message: e.message });
    return paperError(reply, e);
  }
});

// ---- alerts ----
const alerts = new AlertEngine({
  priceFor: (symbol, plan) => {
    const live = lastQuotes.get(symbol);
    const q = live ? quoteFor(live, plan) : liveSource() && !isLive(plan) ? delayBuffer.delayed(symbol, now()) : null;
    return q ? { price: q.ltp, time: q.time } : null;
  },
  candles: (symbol, tf) => provider.candles(symbol, tf),
  liveSource,
  notify: (userId, event) => { for (const [ws, c] of clients) if (c.claims.uid === userId) send(ws, { type: 'alert', event }); },
  now,
  log: (m) => app.log.info(m),
});

type AlertBody = { symbol?: string; kind?: string; params?: { op?: string; value?: number; tf?: string; rules?: RuleSet }; note?: string; repeat?: string };

/** Checks a new alert; returns the row to store, or an error message. */
function validateAlert(b: AlertBody): { symbol: string; kind: 'PRICE' | 'RULES'; params: PriceParams | RulesParams; note: string | null; repeat: 'once' | 'every' } | string {
  const symbol = String(b.symbol ?? '').toUpperCase();
  if (!findInstrument(symbol)) return 'Unknown symbol';
  const repeat = b.repeat === 'every' ? 'every' : 'once';
  const note = b.note ? String(b.note).slice(0, 200) : null;
  if (b.kind === 'PRICE') {
    const op = b.params?.op, value = Number(b.params?.value);
    if (op !== 'crossesAbove' && op !== 'crossesBelow') return 'Choose "crosses above" or "crosses below"';
    if (!(value > 0) || !Number.isFinite(value)) return 'Enter a price above zero';
    return { symbol, kind: 'PRICE', params: { op, valuePaise: Math.round(value * 100) }, note, repeat };
  }
  if (b.kind === 'RULES') {
    const tf = b.params?.tf as Timeframe, rules = b.params?.rules;
    if (!ALERT_TIMEFRAMES.includes(tf)) return 'Choose a timeframe: 5 min, 15 min, 1 hour or daily';
    if (!rules?.conditions?.length || rules.conditions.length > 5) return 'Use between 1 and 5 conditions';
    const invalid = validateStrategy({ name: 'alert', direction: 'LONG', product: 'CNC', entry: rules, sizing: { mode: 'qty', qty: 1 }, initialCapitalPaise: 1 }, false);
    if (invalid) return invalid;
    return { symbol, kind: 'RULES', params: { tf, rules: { match: rules.match === 'any' ? 'any' : 'all', conditions: rules.conditions } }, note, repeat };
  }
  return 'Choose a price alert or an indicator alert';
}

app.get('/api/alerts', async (req) => {
  const uid = req.user!.uid;
  const [list, events, plan] = await Promise.all([
    prisma.alert.findMany({ where: { userId: uid }, orderBy: { createdAt: 'desc' } }),
    prisma.alertEvent.findMany({ where: { userId: uid }, orderBy: { triggeredAt: 'desc' }, take: 50, include: { alert: { select: { symbol: true } } } }),
    planOf(uid),
  ]);
  return {
    alerts: list, limit: ALERT_LIMITS[plan], used: list.filter((a) => a.status !== 'TRIGGERED').length, emailEnabled: !!(process.env.RESEND_API_KEY && process.env.ALERT_EMAIL_FROM),
    events: events.map((e) => ({ id: e.id, alertId: e.alertId, symbol: e.alert.symbol, message: e.message, price: e.pricePaise / 100, marketTime: e.marketTime, triggeredAt: e.triggeredAt, emailStatus: e.emailStatus, seen: !!e.seenAt })),
  };
});
app.post<{ Body: AlertBody }>('/api/alerts', async (req, reply) => {
  const v = validateAlert(req.body ?? {});
  if (typeof v === 'string') return reply.code(400).send({ error: 'bad_alert', message: v });
  const uid = req.user!.uid, plan = await planOf(uid);
  const used = await prisma.alert.count({ where: { userId: uid, status: { in: ['ACTIVE', 'PAUSED'] } } });
  if (used >= ALERT_LIMITS[plan]) return reply.code(409).send({ error: 'limit', message: `Your plan allows ${ALERT_LIMITS[plan]} alerts. Delete one, or upgrade to Live for ${ALERT_LIMITS.LIVE}.` });
  const row = await prisma.alert.create({ data: { userId: uid, symbol: v.symbol, kind: v.kind, params: v.params as object, note: v.note, repeat: v.repeat, status: 'ACTIVE' } });
  await alerts.reload();
  return row;
});
app.patch<{ Params: { id: string }; Body: { status?: string } }>('/api/alerts/:id', async (req, reply) => {
  const status = req.body?.status;
  if (status !== 'ACTIVE' && status !== 'PAUSED') return reply.code(400).send({ error: 'bad_status', message: 'Status must be ACTIVE or PAUSED' });
  const res = await prisma.alert.updateMany({ where: { id: req.params.id, userId: req.user!.uid }, data: { status } });
  if (!res.count) return reply.code(404).send({ error: 'not_found', message: 'Alert not found' });
  await alerts.reload();
  return { ok: true };
});
app.delete<{ Params: { id: string } }>('/api/alerts/:id', async (req, reply) => {
  const res = await prisma.alert.deleteMany({ where: { id: req.params.id, userId: req.user!.uid } });
  if (!res.count) return reply.code(404).send({ error: 'not_found', message: 'Alert not found' });
  await alerts.reload();
  return { ok: true };
});
app.post('/api/alerts/seen', async (req) => {
  await prisma.alertEvent.updateMany({ where: { userId: req.user!.uid, seenAt: null }, data: { seenAt: new Date() } });
  return { ok: true };
});

// ---- live quotes over WebSocket ----
/** `sent`: last delayed price sent per symbol (Free users on a live source), so the replay only sends changes. */
type Client = { subs: Set<string>; claims: FeedClaims; sent: Map<string, string> };
const clients = new Map<WebSocket, Client>();
const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

app.get('/ws', { websocket: true }, (socket, req) => {
  const claims = verifyFeedToken((req.query as { token?: string }).token, TOKEN_SECRET);
  if (!claims) { socket.close(4401, 'unauthorised'); return; }
  if (!claims.anon) plans.set(claims.uid, claims.plan);
  clients.set(socket, { subs: new Set(), claims, sent: new Map() });
  // Close when the token expires: the browser reconnects with a fresh token, so plan changes take effect.
  const expiry = setTimeout(() => socket.close(4001, 'token expired'), Math.max(1, claims.exp - now()) * 1000);
  send(socket, { type: 'status', status: statusFor(claims.plan), session: marketSession(now()) });
  if (!claims.anon) paper.snapshot(claims.uid).then((snapshot) => send(socket, { type: 'paper', snapshot }), () => {});
  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const c = clients.get(socket);
    if (!c) return;
    const symbols = (Array.isArray(msg.symbols) ? msg.symbols : []).map((s) => String(s).toUpperCase()).filter((s) => findInstrument(s));
    if (msg.type === 'subscribe') {
      symbols.forEach((s) => c.subs.size < MAX_SUBSCRIPTIONS && c.subs.add(s));
      void pushQuotes([socket]);
    } else if (msg.type === 'unsubscribe') symbols.forEach((s) => c.subs.delete(s));
  });
  socket.on('close', () => { clearTimeout(expiry); clients.delete(socket); });
});

/** Sends each socket the quotes it watches, as its plan allows; counts Live users who received live data. */
function deliver(quotes: Quote[], targets: WebSocket[]) {
  for (const ws of targets) {
    const c = clients.get(ws);
    if (!c) continue;
    if (liveSource() && !isLive(c.claims.plan)) continue; // Free users on a live source get the replay below
    const mine = quotes.filter((q) => c.subs.has(q.symbol)).map((q) => quoteFor(q, c.claims.plan)).filter((q): q is Quote => !!q);
    if (!mine.length) continue;
    send(ws, { type: 'quotes', quotes: mine });
    if (liveSource() && isLive(c.claims.plan)) liveUsage.record(c.claims.uid, now());
  }
}

async function pushQuotes(targets = [...clients.keys()], extra: string[] = []) {
  const wanted = new Set([...targets.flatMap((ws) => [...(clients.get(ws)?.subs ?? [])]), ...extra]);
  if (!wanted.size) return;
  try {
    const quotes = await provider.quotes([...wanted]);
    remember(quotes);
    deliver(quotes, targets);
  } catch (e) {
    app.log.warn(`Quote poll failed: ${(e as Error).message}`);
  }
}

function broadcastStatus() {
  for (const [ws, c] of clients) send(ws, { type: 'status', status: statusFor(c.claims.plan), session: marketSession(now()) });
}

/** Sends a user's paper snapshot to their open sockets (all connected users when `uid` is omitted). */
async function broadcastPaper(uid?: string) {
  const users = uid ? [uid] : [...new Set([...clients.values()].filter((c) => !c.claims.anon).map((c) => c.claims.uid))];
  for (const u of users) {
    const sockets = [...clients].filter(([, c]) => c.claims.uid === u).map(([ws]) => ws);
    if (!sockets.length) continue;
    try {
      const snapshot = await paper.snapshot(u);
      for (const ws of sockets) send(ws, { type: 'paper', snapshot });
    } catch (e) {
      app.log.warn(`Paper snapshot failed: ${(e as Error).message}`);
    }
  }
}

// Live ticks: push changed symbols to the browsers that watch them, at most every 500 ms.
setInterval(async () => {
  if (!dirty.size) return;
  const symbols = [...dirty];
  dirty.clear();
  try {
    const quotes = await provider.quotes(symbols);
    remember(quotes);
    deliver(quotes, [...clients.keys()]);
  } catch (e) {
    app.log.warn(`Live tick push failed: ${(e as Error).message}`);
  }
}, 500);

// Delayed broadcast for Free users on a live source: every second, the market exactly as it stood 15 minutes ago.
setInterval(() => {
  if (!liveSource()) return;
  for (const [ws, c] of clients) {
    if (isLive(c.claims.plan) || !c.subs.size) continue;
    const changed: Quote[] = [];
    for (const symbol of c.subs) {
      const live = lastQuotes.get(symbol);
      const q = live ? quoteFor(live, c.claims.plan) : delayBuffer.delayed(symbol, now());
      if (!q) continue;
      const key = `${q.ltp}|${q.time}`;
      if (c.sent.get(symbol) === key) continue;
      c.sent.set(symbol, key);
      changed.push(q);
    }
    if (changed.length) send(ws, { type: 'quotes', quotes: changed });
  }
}, 1000);

// Poll fast while the market is open, slowly otherwise, and keep clients' session and data-source status current.
let lastSession = marketSession(now());
let lastProvider = provider.status.provider;
async function loop() {
  const session = marketSession(now());
  if (session !== lastSession || provider.status.provider !== lastProvider) {
    lastSession = session;
    lastProvider = provider.status.provider;
    broadcastStatus();
  }
  // The paper engine needs prices for its open orders and positions even when no browser is watching them.
  const engineSymbols = await paper.symbols().catch(() => [] as string[]);
  await pushQuotes([...clients.keys()], [...engineSymbols, ...alerts.symbols()]); // alerts need prices even when nobody watches
  await paper.tick().catch((e) => app.log.warn(`Paper tick failed: ${(e as Error).message}`));
  await broadcastPaper(); // refresh live P&L
  setTimeout(loop, session === 'closed' ? 60_000 : 5_000);
}

await loadEquities((m) => app.log.info(m));
if (wantKite && (await loadSession())) {
  await startKite().catch((e) => app.log.warn(`Kite start failed (log in again): ${(e as Error).message}`));
}
app.log.info(`Loaded ${await loadOfficialStore()} days of NSE official data`);
startOfficialJob((m) => app.log.info(m));
// Three years of NSE F&O end-of-day history for index options, downloaded politely in the background.
startFnoSync(process.env.FNO_BACKFILL_FROM ?? '2023-11-01', (m) => app.log.info(m));
// Every NSE stock's official daily history (for the scanner and signals), then that evening's signals.
await publishStrategies((m) => app.log.info(m)).catch((e) => app.log.error(e, 'Publishing signal strategies failed'));
onEodReady(() => runSignals((m) => app.log.info(m)));
startEodSync(process.env.EOD_BACKFILL_FROM ?? '2022-01-03', (m) => app.log.info(m));
await app.listen({ port: PORT, host: '127.0.0.1' });
void loop();
// Alerts: load active ones (retrying while the database starts), then check every second.
void (async function startAlerts() {
  try {
    await alerts.reload();
    setInterval(() => void alerts.tick(), 1000);
    app.log.info(`Alerts: ${alerts.symbols().length} symbols watched`);
  } catch (e) {
    app.log.warn(`Alerts not started yet (${(e as Error).message.split('\n').at(-1)}); retrying in 10 s`);
    setTimeout(startAlerts, 10_000);
  }
})();
