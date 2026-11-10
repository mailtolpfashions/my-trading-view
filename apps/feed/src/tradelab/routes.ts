// Trade lab's HTTP routes (owner only) and its timer. Money crosses the wire as rupees and is converted to paise
// exactly (toPaise rejects more than two decimals).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { toPaise, type OrderType, type Product, type Side } from '@mtv/paper';
import { live } from '../intraday/instance';
import { AutoError, autoTick, baskets, deleteBasket, deleteRule, events, executeBasket, ruleResults, rules, saveBasket, saveRule, type AutoRule, type Basket } from './auto';
import { TradeLab } from './engine';
import { kiteMarket, liveMargin, nseCloses, prismaRepo } from './live';
import { DEFAULT_SETTINGS, LabError } from './types';

export const tradeLab = new TradeLab(prismaRepo, kiteMarket, nseCloses, liveMargin, () => DEFAULT_SETTINGS);

const money = (v: unknown) => (v == null || v === '' ? undefined : toPaise(v as number | string));

export function tradeLabRoutes(app: FastifyInstance) {
  const owner = <B>(fn: (body: B, req: FastifyRequest) => Promise<unknown>) => async (req: FastifyRequest<{ Body: B }>, reply: FastifyReply) => {
    if (!req.user?.admin) return reply.code(403).send({ error: 'forbidden', message: 'Trade lab is for the owner' });
    try {
      return await fn((req.body ?? {}) as B, req);
    } catch (e) {
      if (e instanceof LabError || e instanceof AutoError || (e instanceof Error && /paise|decimal|number/i.test(e.message))) return reply.code(400).send({ error: 'rejected', message: e.message });
      req.log.error(e);
      return reply.code(500).send({ error: 'failed', message: 'Trade lab could not do that' });
    }
  };

  app.get('/api/tradelab', owner(async () => tradeLab.snapshot()));

  type OrderBody = { symbol: string; side: Side; product: Product; type: OrderType; qty: number; price?: number | string; trigger?: number | string; stop?: number | string; target?: number | string; reason?: string };
  app.post('/api/tradelab/order', owner(async (b: OrderBody) => tradeLab.place({
    symbol: String(b.symbol ?? '').toUpperCase(), side: b.side, product: b.product, type: b.type, qty: Number(b.qty),
    pricePaise: money(b.price), triggerPaise: money(b.trigger), stopPaise: money(b.stop), targetPaise: money(b.target), source: 'MANUAL', reason: b.reason?.slice(0, 200),
  })));
  app.post('/api/tradelab/cancel', owner(async (b: { id: string }) => ({ ok: await tradeLab.cancel(String(b.id)) })));
  app.post('/api/tradelab/exit', owner(async (b: { symbol: string; product: Product }) => tradeLab.exit(String(b.symbol), b.product)));
  app.post('/api/tradelab/reset', owner(async (b: { cash: number | string }) => { await tradeLab.reset(toPaise(b.cash)); return { ok: true }; }));

  /** F&O contracts of an underlying for the order ticket: its futures, and option strikes around the price, one expiry. */
  app.get('/api/tradelab/contracts', owner(async (_b: unknown, req) => {
    const q = req.query as { underlying?: string; expiry?: string; width?: string };
    const k = live.kite();
    if (!k) throw new LabError('Connect Kite to see live contracts');
    const u = String(q.underlying ?? '').toUpperCase();
    const all = k.nfoContracts(u);
    if (!all.length) throw new LabError(`${u} has no F&O contracts`);
    const today = new Date(Date.now() + 19800_000).toISOString().slice(0, 10);
    const expiries = [...new Set(all.filter((c) => c.kind !== 'FUT' && c.expiry >= today).map((c) => c.expiry))].sort();
    const expiry = q.expiry && expiries.includes(q.expiry) ? q.expiry : expiries[0];
    const spot = kiteMarket.underlyingPrice(u);
    const strikes = [...new Set(all.filter((c) => c.expiry === expiry && c.kind !== 'FUT').map((c) => c.strike))].sort((a, b) => a - b);
    const width = Math.min(40, Math.max(3, Number(q.width) || 10));
    const atm = spot == null ? Math.floor(strikes.length / 2) : strikes.reduce((b, s, i) => (Math.abs(s * 100 - spot) < Math.abs(strikes[b] * 100 - spot) ? i : b), 0);
    const near = new Set(strikes.slice(Math.max(0, atm - width), atm + width + 1));
    const futures = all.filter((c) => c.kind === 'FUT' && c.expiry >= today).sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, 3);
    const options = all.filter((c) => c.expiry === expiry && c.kind !== 'FUT' && near.has(c.strike));
    const insts = [...futures, ...options].map((c) => kiteMarket.instrument(c.tradingsymbol)!).filter(Boolean);
    kiteMarket.watch(insts);
    const row = (sym: string) => { const i = kiteMarket.instrument(sym)!; const qt = kiteMarket.quote(i); return { symbol: sym, label: i.label, lot: i.lot, ltpPaise: qt?.ltpPaise ?? null, bidPaise: qt?.bidPaise ?? null, askPaise: qt?.askPaise ?? null }; };
    return {
      underlying: u, spotPaise: spot, expiry, expiries,
      futures: futures.map((c) => ({ ...row(c.tradingsymbol), expiry: c.expiry })),
      strikes: [...near].sort((a, b) => a - b).map((s) => ({
        strike: s,
        CE: options.find((c) => c.strike === s && c.kind === 'CE') ? row(options.find((c) => c.strike === s && c.kind === 'CE')!.tradingsymbol) : null,
        PE: options.find((c) => c.strike === s && c.kind === 'PE') ? row(options.find((c) => c.strike === s && c.kind === 'PE')!.tradingsymbol) : null,
      })),
    };
  }));

  /** Live quote of one instrument (stock or F&O contract) for the order ticket. */
  app.get('/api/tradelab/quote', owner(async (_b: unknown, req) => {
    const sym = String((req.query as { symbol?: string }).symbol ?? '').toUpperCase();
    const i = kiteMarket.instrument(sym);
    if (!i) throw new LabError(live.kite() ? `${sym} is not something Trade lab can trade` : 'Connect Kite for live prices');
    kiteMarket.watch([i]);
    const q = kiteMarket.quote(i);
    return { ...i, ltpPaise: q?.ltpPaise ?? null, bidPaise: q?.bidPaise ?? null, askPaise: q?.askPaise ?? null };
  }));

  // Automatic rules: the rules with each one's record, saving / deleting, and the decision log.
  app.get('/api/tradelab/rules', owner(async () => ({ rules: await rules(), results: await ruleResults() })));
  app.post('/api/tradelab/rules', owner(async (b: Partial<AutoRule>) => saveRule(b)));
  app.post('/api/tradelab/rules/delete', owner(async (b: { id: string }) => { await deleteRule(String(b.id)); return { ok: true }; }));
  app.get('/api/tradelab/log', owner(async () => ({ events: await events(400) })));
  setInterval(() => { autoTick(tradeLab).catch((e) => app.log.warn({ err: e }, 'trade lab rules failed')); }, 15_000);

  // Baskets: orders kept together and placed in one go; and margin for one order or a whole basket, together.
  app.get('/api/tradelab/baskets', owner(async () => ({ baskets: await baskets() })));
  app.post('/api/tradelab/baskets', owner(async (b: Partial<Basket>) => saveBasket(b)));
  app.post('/api/tradelab/baskets/delete', owner(async (b: { id: string }) => { await deleteBasket(String(b.id)); return { ok: true }; }));
  app.post('/api/tradelab/baskets/execute', owner(async (b: { id: string }) => executeBasket(tradeLab, String(b.id))));
  type MarginItem = { symbol: string; side: Side; product: Product; qty: number; price?: number | string };
  app.post('/api/tradelab/margin', owner(async (b: { orders: MarginItem[] }) => tradeLab.previewMargin((b.orders ?? []).slice(0, 40).map((o) => ({
    symbol: String(o.symbol).toUpperCase(), side: o.side, product: o.product, qty: Number(o.qty), pricePaise: money(o.price),
  })))));

  // The engine's clock: fills, square-off, expiry of day orders and F&O settlement.
  setInterval(() => { tradeLab.step().catch((e) => app.log.warn({ err: e }, 'trade lab step failed')); }, 2000);
}
