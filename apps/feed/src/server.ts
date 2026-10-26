import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { WebSocket } from 'ws';
import { toPaise, type PlaceOrderInput } from '@mtv/paper';
import { NEEDS_BROKER, TIMEFRAMES, marketSession, type ClientMessage, type Quote, type ServerMessage, type Timeframe } from '@mtv/shared';
import { PaperEngine } from './paper/engine';
import { PrismaPaperRepo } from './paper/repo';
import { FreeProvider } from './providers/free';
import { NotFoundError, type MarketDataProvider } from './providers/types';
import { officialAttempts, startOfficialJob } from './official/job';
import { applyOfficial, loadOfficialStore, storedDays } from './official/store';
import { auditCandles } from './quality';
import { findInstrument, loadEquities, searchInstruments } from './symbols';

const PORT = Number(process.env.FEED_PORT ?? 4001);
const WEB_ORIGIN = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
const MAX_SUBSCRIPTIONS = 100;

if ((process.env.DATA_PROVIDER ?? 'free') !== 'free') {
  console.warn(`DATA_PROVIDER=${process.env.DATA_PROVIDER} is not available yet; using free delayed data.`);
}
const provider: MarketDataProvider = new FreeProvider();

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors, { origin: [WEB_ORIGIN] });
await app.register(websocket);

const now = () => Math.floor(Date.now() / 1000);

app.get('/health', async () => ({ ok: true, status: provider.status, session: marketSession(now()) }));

app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => searchInstruments(req.query.q ?? ''));

app.get<{ Querystring: { symbol?: string; tf?: string } }>('/api/candles', async (req, reply) => {
  const symbol = (req.query.symbol ?? '').toUpperCase();
  const tf = (req.query.tf ?? '5') as Timeframe;
  if (!TIMEFRAMES.includes(tf)) return reply.code(400).send({ error: 'bad_timeframe' });
  const instrument = findInstrument(symbol);
  if (!instrument) return reply.code(404).send({ error: 'unknown_symbol' });
  try {
    let raw = await provider.candles(symbol, tf);
    let official;
    if (tf === 'D') ({ candles: raw, official } = applyOfficial(symbol, raw)); // NSE's official record wins
    const { candles, quality } = auditCandles(raw, tf);
    if (official) quality.official = official;
    if (!quality.ok) req.log.warn({ symbol, tf, missing: quality.missing.length, invalid: quality.invalid.length, misaligned: quality.misaligned.length }, 'candle data quality issues');
    return { instrument, tf, status: provider.status, quality, candles };
  } catch (e) {
    if (e instanceof NotFoundError) return reply.code(404).send({ error: 'no_data' });
    req.log.error(e);
    return reply.code(502).send({ error: 'upstream_failed' });
  }
});

app.get<{ Querystring: { symbols?: string } }>('/api/quotes', async (req, reply) => {
  const symbols = (req.query.symbols ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => findInstrument(s));
  try {
    return await provider.quotes(symbols.slice(0, MAX_SUBSCRIPTIONS));
  } catch (e) {
    req.log.error(e);
    return reply.code(502).send({ error: 'upstream_failed' });
  }
});

app.get('/api/official/status', async () => ({ days: storedDays(), attempts: officialAttempts() }));

// Option chain and futures need a broker feed; free sources do not provide them.
app.get('/api/option-chain', async (_req, reply) => reply.code(501).send({ error: NEEDS_BROKER }));

// ---- paper trading ----
const lastQuotes = new Map<string, Quote>();
const ltpPaise = (q?: Quote) => (q ? toPaise(q.ltp.toFixed(2)) : undefined);
const IST = 5.5 * 3600;
const paper = new PaperEngine({
  repo: new PrismaPaperRepo(),
  ltp: (s) => ltpPaise(lastQuotes.get(s)),
  freshLtp: async (s) => {
    const [q] = await provider.quotes([s]);
    if (q) lastQuotes.set(s, q);
    return ltpPaise(q);
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
  onChange: () => void broadcastPaper(),
  log: (m) => app.log.info(m),
});

async function broadcastPaper() {
  if (!clients.size) return;
  try {
    const snapshot = await paper.snapshot();
    for (const ws of clients.keys()) send(ws, { type: 'paper', snapshot });
  } catch (e) {
    app.log.warn(`Paper snapshot failed: ${(e as Error).message}`);
  }
}

const paperError = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, e: unknown) => {
  app.log.error(e);
  return reply.code(503).send({ error: 'paper_unavailable', message: 'Paper trading is unavailable. Is the database running (npm run db:start)?' });
};

app.get('/api/paper', async (_req, reply) => {
  try { return await paper.snapshot(); } catch (e) { return paperError(reply, e); }
});
app.post<{ Body: PlaceOrderInput }>('/api/paper/orders', async (req, reply) => {
  try { return await paper.placeOrder(req.body); } catch (e) { return paperError(reply, e); }
});
app.delete<{ Params: { id: string } }>('/api/paper/orders/:id', async (req, reply) => {
  try {
    return (await paper.cancelOrder(req.params.id)) ? { ok: true } : reply.code(409).send({ error: 'not_open', message: 'Order is no longer open' });
  } catch (e) { return paperError(reply, e); }
});
app.post<{ Body: { startingCash: string | number } }>('/api/paper/reset', async (req, reply) => {
  try {
    await paper.reset(req.body.startingCash);
    return { ok: true };
  } catch (e) {
    if (e instanceof Error && /Starting funds/.test(e.message)) return reply.code(400).send({ error: 'bad_amount', message: e.message });
    return paperError(reply, e);
  }
});

// ---- live quotes over WebSocket ----
const clients = new Map<WebSocket, Set<string>>();
const send = (ws: WebSocket, msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

app.get('/ws', { websocket: true }, (socket) => {
  clients.set(socket, new Set());
  send(socket, { type: 'status', status: provider.status, session: marketSession(now()) });
  paper.snapshot().then((snapshot) => send(socket, { type: 'paper', snapshot }), () => {});
  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const subs = clients.get(socket)!;
    const symbols = (Array.isArray(msg.symbols) ? msg.symbols : []).map((s) => String(s).toUpperCase()).filter((s) => findInstrument(s));
    if (msg.type === 'subscribe') {
      symbols.forEach((s) => subs.size < MAX_SUBSCRIPTIONS && subs.add(s));
      void pushQuotes([socket]);
    } else if (msg.type === 'unsubscribe') symbols.forEach((s) => subs.delete(s));
  });
  socket.on('close', () => clients.delete(socket));
});

async function pushQuotes(targets = [...clients.keys()], extra: string[] = []) {
  const wanted = new Set([...targets.flatMap((ws) => [...(clients.get(ws) ?? [])]), ...extra]);
  if (!wanted.size) return;
  try {
    const quotes = await provider.quotes([...wanted]);
    for (const q of quotes) lastQuotes.set(q.symbol, q);
    for (const ws of targets) {
      const subs = clients.get(ws);
      if (subs) send(ws, { type: 'quotes', quotes: quotes.filter((q) => subs.has(q.symbol)) });
    }
  } catch (e) {
    app.log.warn(`Quote poll failed: ${(e as Error).message}`);
  }
}

// Poll fast while the market is open, slowly otherwise, and keep clients' session status current.
let lastSession = marketSession(now());
async function loop() {
  const session = marketSession(now());
  if (session !== lastSession) {
    lastSession = session;
    for (const ws of clients.keys()) send(ws, { type: 'status', status: provider.status, session });
  }
  // The paper engine needs prices for its open orders and positions even when no browser is watching them.
  const engineSymbols = await paper.symbols().catch(() => [] as string[]);
  await pushQuotes([...clients.keys()], engineSymbols);
  await paper.tick().catch((e) => app.log.warn(`Paper tick failed: ${(e as Error).message}`));
  await broadcastPaper(); // refresh live P&L
  setTimeout(loop, session === 'closed' ? 60_000 : 5_000);
}

await loadEquities((m) => app.log.info(m));
app.log.info(`Loaded ${await loadOfficialStore()} days of NSE official data`);
startOfficialJob((m) => app.log.info(m));
await app.listen({ port: PORT, host: '127.0.0.1' });
void loop();
