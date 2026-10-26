// Paper-trading engine: validates and places orders, fills them against live (delayed) quotes, squares off intraday
// positions at 15:20 IST and expires unfilled orders at the close. All state changes run one at a time.

import {
  CHARGE_RATES,
  avgPricePaise,
  buildLedger,
  computeCharges,
  evaluate,
  funds,
  toPaise,
  unrealisedPaise,
  validateOrder,
  type Charges,
  type Ledger,
  type Paise,
  type PaperOrder,
  type PaperSnapshot,
  type PlaceOrderInput,
  type Product,
  type Side,
  type Trade,
} from '@mtv/paper';
import type { MarketSession } from '@mtv/shared';

export type StoredTrade = Trade & { charges: Charges };

/** Storage the engine needs. Fill and status changes are conditional on the current status, so nothing happens twice. */
export interface PaperRepo {
  account(): Promise<{ id: string; startingCashPaise: Paise; resetAt: string }>;
  trades(accountId: string): Promise<StoredTrade[]>;
  orders(accountId: string, filter: { open?: boolean; sinceTradeDate?: string }): Promise<PaperOrder[]>;
  createOrder(accountId: string, o: Omit<PaperOrder, 'id' | 'createdAt'>): Promise<PaperOrder>;
  /** Updates only if the order is currently in one of `from`. Returns false if it was not. */
  updateOrder(id: string, from: PaperOrder['status'][], patch: Partial<Pick<PaperOrder, 'status' | 'triggered' | 'rejectReason'>>): Promise<boolean>;
  /** Marks the order COMPLETE and records its trade atomically, only if it is still open. */
  fillOrder(accountId: string, orderId: string, from: PaperOrder['status'][], trade: Omit<StoredTrade, 'id'>): Promise<boolean>;
  reset(accountId: string, startingCashPaise: Paise): Promise<void>;
}

export type EngineDeps = {
  repo: PaperRepo;
  /** Latest LTP in paise from the cached quote stream, if any. */
  ltp(symbol: string): Paise | undefined;
  /** Fetches a fresh quote (used at order placement). */
  freshLtp(symbol: string): Promise<Paise | undefined>;
  /** Close of the last 5-minute bar at or before 15:20 IST on `date`, for an intraday position whose square-off was missed. */
  squareOffPrice(symbol: string, date: string): Promise<Paise | undefined>;
  isTradable(symbol: string): boolean;
  session(): MarketSession;
  now(): number; // UTC epoch seconds
  onChange(): void;
  log(msg: string): void;
};

const OPEN_STATES: PaperOrder['status'][] = ['OPEN', 'TRIGGER_PENDING'];
const IST = 5.5 * 3600;
const istDate = (t: number) => new Date((t + IST) * 1000).toISOString().slice(0, 10);
const istMinutes = (t: number) => Math.floor(((t + IST) % 86400) / 60);
const SQUARE_OFF = 15 * 60 + 20;
const CLOSE = 15 * 60 + 30;

export class PaperEngine {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private d: EngineDeps) {}

  /** Runs state changes strictly one after another, so two orders can never spend the same funds. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private async state() {
    const acc = await this.d.repo.account();
    const trades = await this.d.repo.trades(acc.id);
    const open = await this.d.repo.orders(acc.id, { open: true });
    return { acc, trades, open, ledger: buildLedger(trades, acc.startingCashPaise) };
  }

  /** Quantity of an order that opens or adds to exposure (the rest closes an existing position). */
  private openingQty(ledger: Ledger, symbol: string, product: Product, side: Side, qty: number) {
    const pos = ledger.positions.find((p) => p.symbol === symbol && p.product === product)?.qty ?? 0;
    const closable = side === 'BUY' ? Math.max(0, -pos) : Math.max(0, pos);
    return Math.max(0, qty - closable);
  }

  /** Funds an order ties up: full value of its opening quantity plus estimated charges (no leverage). */
  private required(ledger: Ledger, o: { symbol: string; product: Product; side: Side; qty: number; type: string; pricePaise: Paise | null; triggerPaise: Paise | null }, ltp: Paise) {
    if (o.product === 'CNC' && o.side === 'SELL') return 0; // selling held shares needs no funds
    const ref = o.type === 'LIMIT' || o.type === 'SL' ? o.pricePaise! : o.type === 'SLM' ? o.triggerPaise! : ltp;
    const opening = this.openingQty(ledger, o.symbol, o.product, o.side, o.qty);
    if (!opening) return 0;
    return opening * ref + computeCharges({ side: o.side, product: o.product, qty: o.qty, pricePaise: ref }).total;
  }

  private blocked(ledger: Ledger, open: PaperOrder[]) {
    return open.reduce((sum, o) => sum + this.required(ledger, o, this.d.ltp(o.symbol) ?? o.pricePaise ?? o.triggerPaise ?? 0), 0);
  }

  placeOrder(input: PlaceOrderInput): Promise<PaperOrder> {
    return this.serial(async () => {
      const { acc, ledger, open } = await this.state();
      const now = this.d.now();
      const tradeDate = istDate(now);
      const symbol = input.symbol.toUpperCase();
      let pricePaise: Paise | null = null, triggerPaise: Paise | null = null;
      const base = { symbol, side: input.side, product: input.product, type: input.type, qty: input.qty, triggered: false, avgFillPaise: null, tag: null, tradeDate };

      const reject = async (reason: string) => {
        const o = await this.d.repo.createOrder(acc.id, { ...base, pricePaise, triggerPaise, status: 'REJECTED', rejectReason: reason });
        this.d.onChange();
        return o;
      };

      try {
        if (input.price != null && input.price !== '') pricePaise = toPaise(input.price);
        if (input.triggerPrice != null && input.triggerPrice !== '') triggerPaise = toPaise(input.triggerPrice);
      } catch (e) {
        return reject((e as Error).message);
      }
      if (!['BUY', 'SELL'].includes(input.side) || !['CNC', 'MIS'].includes(input.product) || !['MARKET', 'LIMIT', 'SL', 'SLM'].includes(input.type)) return reject('Invalid order');
      if (this.d.session() !== 'open') return reject('Market is closed. Orders can be placed 09:15–15:30 IST on trading days.');
      if (!this.d.isTradable(symbol)) return reject(`${symbol} cannot be traded here: only NSE equities (indices and F&O need a broker connection)`);
      if (input.product === 'MIS' && istMinutes(now) >= SQUARE_OFF) return reject('Intraday (MIS) orders are not accepted after 15:20 IST');
      const ltp = await this.d.freshLtp(symbol);
      if (!ltp) return reject(`No price available for ${symbol}`);
      const invalid = validateOrder({ side: input.side, type: input.type, qty: input.qty, pricePaise: pricePaise ?? undefined, triggerPaise: triggerPaise ?? undefined }, ltp);
      if (invalid) return reject(invalid);

      if (input.product === 'CNC' && input.side === 'SELL') {
        const held = ledger.positions.find((p) => p.symbol === symbol && p.product === 'CNC')?.qty ?? 0;
        const pending = open.filter((o) => o.symbol === symbol && o.product === 'CNC' && o.side === 'SELL').reduce((s, o) => s + o.qty, 0);
        if (input.qty > held - pending) return reject(`You hold ${Math.max(0, held - pending)} ${symbol} shares available to sell. Delivery (CNC) can only sell shares you hold.`);
      }

      const need = this.required(ledger, { symbol, product: input.product, side: input.side, qty: input.qty, type: input.type, pricePaise, triggerPaise }, ltp);
      const f = funds(ledger, (s) => (s === symbol ? ltp : this.d.ltp(s)), this.blocked(ledger, open));
      if (need > f.availablePaise) return reject(`Insufficient funds: this order needs ₹${(need / 100).toFixed(2)}, available ₹${(f.availablePaise / 100).toFixed(2)}`);

      const status = input.type === 'SL' || input.type === 'SLM' ? 'TRIGGER_PENDING' : 'OPEN';
      const order = await this.d.repo.createOrder(acc.id, { ...base, pricePaise, triggerPaise, status, rejectReason: null });
      await this.tryFill(acc.id, order, ltp, true);
      this.d.onChange();
      return (await this.d.repo.orders(acc.id, { sinceTradeDate: tradeDate })).find((o) => o.id === order.id) ?? order;
    });
  }

  cancelOrder(id: string): Promise<boolean> {
    return this.serial(async () => {
      const ok = await this.d.repo.updateOrder(id, OPEN_STATES, { status: 'CANCELLED', rejectReason: 'Cancelled by you' });
      if (ok) this.d.onChange();
      return ok;
    });
  }

  reset(startingCash: number | string): Promise<void> {
    return this.serial(async () => {
      const p = toPaise(startingCash);
      if (p < 10_000_00 || p > 10_00_00_000_00) throw new Error('Starting funds must be between ₹10,000 and ₹10 crore');
      const acc = await this.d.repo.account();
      await this.d.repo.reset(acc.id, p);
      this.d.onChange();
    });
  }

  /** Evaluates one order at `ltp`; fills or triggers it as the matching rules say. Returns true if anything changed. */
  private async tryFill(accountId: string, order: PaperOrder, ltp: Paise, isNew: boolean): Promise<boolean> {
    let r = evaluate({ side: order.side, type: order.type, pricePaise: order.pricePaise ?? undefined, triggerPaise: order.triggerPaise ?? undefined, triggered: order.triggered }, ltp, isNew);
    let changed = false;
    if (r.action === 'trigger') {
      if (!(await this.d.repo.updateOrder(order.id, ['TRIGGER_PENDING'], { status: 'OPEN', triggered: true }))) return false;
      changed = true;
      order = { ...order, status: 'OPEN', triggered: true };
      r = evaluate({ side: order.side, type: order.type, pricePaise: order.pricePaise ?? undefined, triggerPaise: order.triggerPaise ?? undefined, triggered: true }, ltp, true);
    }
    if (r.action !== 'fill') return changed;
    return (await this.fill(accountId, order, r.pricePaise, this.d.now())) || changed;
  }

  private async fill(accountId: string, order: PaperOrder, pricePaise: Paise, time: number): Promise<boolean> {
    const tradeDate = istDate(time);
    const trades = await this.d.repo.trades(accountId);
    const firstDeliverySellToday = order.product === 'CNC' && order.side === 'SELL' && !trades.some((t) => t.symbol === order.symbol && t.product === 'CNC' && t.side === 'SELL' && t.tradeDate === tradeDate);
    const charges = computeCharges({ side: order.side, product: order.product, qty: order.qty, pricePaise, firstDeliverySellToday });
    const ok = await this.d.repo.fillOrder(accountId, order.id, OPEN_STATES, {
      orderId: order.id, symbol: order.symbol, product: order.product, side: order.side, qty: order.qty, pricePaise, chargesPaise: charges.total, charges, time, tradeDate,
    });
    if (ok) this.d.log(`Paper fill: ${order.side} ${order.qty} ${order.symbol} ${order.product} @ ₹${(pricePaise / 100).toFixed(2)}${order.tag ? ` (${order.tag})` : ''}`);
    return ok;
  }

  /** Called on every quote poll: works resting orders, then end-of-day housekeeping. */
  tick(): Promise<void> {
    return this.serial(async () => {
      const { acc, open } = await this.state();
      const now = this.d.now();
      let changed = false;
      if (this.d.session() === 'open') {
        for (const o of open) {
          const ltp = this.d.ltp(o.symbol);
          if (!ltp || o.tradeDate !== istDate(now)) continue;
          changed = (await this.tryFill(acc.id, o, ltp, false)) || changed;
        }
      }
      changed = (await this.housekeeping(acc.id)) || changed;
      if (changed) this.d.onChange();
    });
  }

  /** Expires unfilled orders after the close (or from earlier days) and squares off intraday positions from 15:20 IST. */
  private async housekeeping(accountId: string): Promise<boolean> {
    const now = this.d.now();
    const today = istDate(now);
    const mins = istMinutes(now);
    let changed = false;

    for (const o of await this.d.repo.orders(accountId, { open: true })) {
      const stale = o.tradeDate < today || (mins >= CLOSE && o.tradeDate === today);
      const misCutoff = o.product === 'MIS' && o.tradeDate === today && mins >= SQUARE_OFF;
      if (stale || misCutoff) {
        changed = (await this.d.repo.updateOrder(o.id, OPEN_STATES, { status: 'CANCELLED', rejectReason: stale ? 'Expired at market close' : 'Cancelled at intraday square-off (15:20 IST)' })) || changed;
      }
    }

    const ledger = buildLedger(await this.d.repo.trades(accountId), (await this.d.repo.account()).startingCashPaise);
    for (const p of ledger.positions.filter((p) => p.product === 'MIS' && p.qty !== 0)) {
      const sameDay = p.lastTradeDate === today;
      if (sameDay && mins < SQUARE_OFF) continue;
      // During today's session after 15:20: square off at the current price. If the 15:20 square-off was missed
      // (server down), use the 15:20 bar close of that day, stamped 15:20 IST.
      const live = sameDay && this.d.session() === 'open';
      const price = live ? this.d.ltp(p.symbol) : await this.d.squareOffPrice(p.symbol, p.lastTradeDate);
      if (!price) { this.d.log(`Square-off for ${p.symbol} waiting for a price`); continue; }
      const time = live ? now : Date.parse(`${p.lastTradeDate}T15:20:00Z`) / 1000 - IST;
      const side: Side = p.qty > 0 ? 'SELL' : 'BUY';
      const order = await this.d.repo.createOrder(accountId, {
        symbol: p.symbol, side, product: 'MIS', type: 'MARKET', qty: Math.abs(p.qty), pricePaise: null, triggerPaise: null, status: 'OPEN', triggered: false, avgFillPaise: null, rejectReason: null, tag: 'AUTO_SQUAREOFF', tradeDate: istDate(time),
      });
      changed = (await this.fill(accountId, order, price, time)) || changed;
    }
    return changed;
  }

  /** Symbols the engine needs quotes for: open orders and open positions. */
  async symbols(): Promise<string[]> {
    const { open, ledger } = await this.state();
    return [...new Set([...open.map((o) => o.symbol), ...ledger.positions.filter((p) => p.qty !== 0).map((p) => p.symbol)])];
  }

  async snapshot(): Promise<PaperSnapshot> {
    const { acc, trades, open, ledger } = await this.state();
    const today = istDate(this.d.now());
    const f = funds(ledger, (s) => this.d.ltp(s), this.blocked(ledger, open));
    const orders = await this.d.repo.orders(acc.id, { sinceTradeDate: today });
    const all = [...new Map([...open, ...orders].map((o) => [o.id, o])).values()].sort((a, b) => b.createdAt - a.createdAt);
    return {
      account: {
        startingCashPaise: acc.startingCashPaise, cashPaise: ledger.cashPaise, equityPaise: f.equityPaise, availablePaise: f.availablePaise, usedPaise: f.usedPaise,
        blockedPaise: f.blockedPaise, realisedPaise: ledger.realisedPaise, unrealisedPaise: f.unrealisedPaise, chargesPaise: ledger.chargesPaise, resetAt: acc.resetAt,
      },
      positions: ledger.positions
        .filter((p) => p.qty !== 0 || p.lastTradeDate === today)
        .map((p) => {
          const ltp = this.d.ltp(p.symbol) ?? null;
          return { symbol: p.symbol, product: p.product, qty: p.qty, avgPricePaise: avgPricePaise(p), ltpPaise: ltp, unrealisedPaise: ltp ? unrealisedPaise(p, ltp) : 0, realisedPaise: p.realisedPaise, chargesPaise: p.chargesPaise };
        }),
      orders: all,
      trades: trades.filter((t) => t.tradeDate === today).sort((a, b) => b.time - a.time).map((t) => ({ id: t.id, orderId: t.orderId, symbol: t.symbol, side: t.side, product: t.product, qty: t.qty, pricePaise: t.pricePaise, charges: t.charges, time: t.time })),
      chargeRatesEffectiveFrom: CHARGE_RATES.effectiveFrom,
    };
  }
}
