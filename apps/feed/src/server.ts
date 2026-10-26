import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest } from 'fastify';
import type { WebSocket } from 'ws';
import { BacktestError, OptionsBacktestError, runBacktest, runOptionsBacktest, type OptionsStrategy, type Strategy } from '@mtv/backtest';
import { prisma } from '@mtv/db';
import { toPaise, type PlaceOrderInput } from '@mtv/paper';
import { NEEDS_BROKER, TIMEFRAMES, marketSession, type Candle, type ClientMessage, type DataStatus, type Quote, type ServerMessage, type Timeframe } from '@mtv/shared';
import { verifyFeedToken, type FeedClaims, type Plan } from '@mtv/shared/feed-token';
import { DelayBuffer, LiveUsageRecorder, delayCandles } from './access';
import { PaperEngine } from './paper/engine';
import { PrismaPaperRepo } from './paper/repo';
import { FreeProvider } from './providers/free';
import { KiteProvider } from './providers/kite/provider';
import { activeSession, clearSession, createSession, kiteConfigured, loadSession, loginUrl } from './providers/kite/session';
import { SwitchProvider } from './providers/switch';
import { NotFoundError, type MarketDataProvider } from './providers/types';
import { officialAttempts, startOfficialJob } from './official/job';
import { applyOfficial, loadOfficialStore, storedDays } from './official/store';
import { FNO_UNDERLYINGS, type FnoUnderlying } from './fno/bhavcopy';
import { getChain, latestFnoDate } from './fno/chain';
import { prismaOptionsData } from './fno/data';
import { fnoStatus, startFnoSync } from './fno/store';
import { auditCandles } from './quality';
import { findInstrument, loadEquities, searchInstruments } from './symbols';

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
await app.register(cors, { origin: [WEB_ORIGIN] });
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

/** The quote a user may see: live for the Live plan; 15 minutes old for Free when the source is live. */
const quoteFor = (q: Quote, plan: Plan | undefined): Quote | null => (!liveSource() || isLive(plan) ? q : delayBuffer.delayed(q.symbol, now()));
/** Bars a user may see: Free users on a live source get only bars that closed 15+ minutes ago. */
const candlesFor = (candles: Candle[], tf: Timeframe, plan: Plan | undefined) => (liveSource() && !isLive(plan) ? delayCandles(candles, tf, now()) : candles);
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
app.addHook('onRequest', async (req, reply) => {
  const path = req.url.split('?')[0];
  if (!path.startsWith('/api/') || PUBLIC.has(path)) return;
  const claims = verifyFeedToken(tokenFrom(req), TOKEN_SECRET);
  if (!claims) return reply.code(401).send({ error: 'unauthorised', message: 'Please sign in again' });
  req.user = claims;
  plans.set(claims.uid, claims.plan);
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
  return { candles: candlesFor(audited.candles, tf, plan), quality: audited.quality };
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
app.get('/api/official/status', async () => ({ days: storedDays(), attempts: officialAttempts() }));
// Live option chain and futures need a broker or vendor feed.
app.get('/api/option-chain', async (_req, reply) => reply.code(501).send({ error: NEEDS_BROKER }));

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

// ---- live quotes over WebSocket ----
type Client = { subs: Set<string>; claims: FeedClaims };
const clients = new Map<WebSocket, Client>();
const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

app.get('/ws', { websocket: true }, (socket, req) => {
  const claims = verifyFeedToken((req.query as { token?: string }).token, TOKEN_SECRET);
  if (!claims) { socket.close(4401, 'unauthorised'); return; }
  plans.set(claims.uid, claims.plan);
  clients.set(socket, { subs: new Set(), claims });
  // Close when the token expires: the browser reconnects with a fresh token, so plan changes take effect.
  const expiry = setTimeout(() => socket.close(4001, 'token expired'), Math.max(1, claims.exp - now()) * 1000);
  send(socket, { type: 'status', status: statusFor(claims.plan), session: marketSession(now()) });
  paper.snapshot(claims.uid).then((snapshot) => send(socket, { type: 'paper', snapshot }), () => {});
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
  const users = uid ? [uid] : [...new Set([...clients.values()].map((c) => c.claims.uid))];
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
  await pushQuotes([...clients.keys()], engineSymbols);
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
await app.listen({ port: PORT, host: '127.0.0.1' });
void loop();
