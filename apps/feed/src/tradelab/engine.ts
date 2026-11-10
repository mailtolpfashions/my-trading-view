// Trade lab engine: places paper orders, fills them on the live order book, keeps brackets, closes intraday positions
// at the owner's square-off time, expires day orders and settles F&O at expiry. Positions, cash and P&L are always
// rebuilt from the trade ledger (packages/paper), never stored as running totals. Every change runs one at a time.
//
// Fill rules (packages/paper evaluateBook): a market order buys at the ask and sells at the bid (the last price only
// when that side of the book is empty, and the order says so); a limit order that is marketable fills at the book, a
// resting one at its own price; stops trigger on the last traded price.

import {
  brokerById, buildLedger, computeCharges, computeFuturesCharges, computeOptionCharges, evaluateBook, expirySettlementCharges,
  validateOrder, type Charges, type OrderStatus, type Position, type Product, type Side,
} from '@mtv/paper';
import { LabError, type Closes, type Instrument, type LabOrder, type LabSettings, type LabTrade, type Market, type PlaceInput, type Repo } from './types';

const OPEN: OrderStatus[] = ['OPEN', 'TRIGGER_PENDING'];
type Change = { i: Instrument; product: Product; delta: number; pricePaise: number };
const IST = 19800;
export const istDate = (sec: number) => new Date((sec + IST) * 1000).toISOString().slice(0, 10);
export const istMinute = (sec: number) => { const d = new Date((sec + IST) * 1000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const CLOSE = hm('15:30');
const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;

/** Margin a set of open positions needs, and how it was worked out (index F&O: NSE SPAN; else an estimate). */
export type MarginFn = (positions: { instrument: Instrument; qty: number; pricePaise: number }[]) => Promise<{ paise: number; method: string }>;

export class TradeLab {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private repo: Repo,
    private market: Market,
    private closes: Closes,
    private margin: MarginFn,
    private settings: () => LabSettings,
    private now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  /** Runs `fn` after every earlier change has finished (orders, fills and timers never interleave). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  private charges(i: Instrument, side: Side, product: Product, qty: number, pricePaise: number, date: string): Charges {
    const broker = brokerById(this.settings().broker);
    if (i.kind === 'EQ') return computeCharges({ side, product, qty, pricePaise, date, broker });
    if (i.kind === 'FUT') return computeFuturesCharges({ side, qty, pricePaise, date, broker });
    return computeOptionCharges({ side, qty, premiumPaise: pricePaise, date, broker });
  }

  private async ledger() {
    const { startingCashPaise } = await this.repo.account();
    const trades = await this.repo.trades();
    return { trades, ledger: buildLedger(trades.map((t) => ({ ...t, id: t.id })), startingCashPaise), startingCashPaise };
  }
  private netQty(positions: Position[], symbol: string, product: Product) { return positions.find((p) => p.symbol === symbol && p.product === product)?.qty ?? 0; }

  // ---------------------------------------------------------------- placing

  place(input: PlaceInput): Promise<LabOrder> { return this.serial(() => this.placeNow(input)); }

  private async placeNow(input: PlaceInput, system?: { tag: string; parentId?: string }): Promise<LabOrder> {
    const now = this.now(), date = istDate(now), min = istMinute(now), s = this.settings();
    const i = this.market.instrument(input.symbol);
    if (!i) throw new LabError(`Unknown symbol ${input.symbol}`);
    if (i.exchange === 'NSE' ? !['CNC', 'MIS'].includes(input.product) : !['NRML', 'MIS'].includes(input.product)) {
      throw new LabError(i.exchange === 'NSE' ? 'Stocks trade as delivery (CNC) or intraday (MIS)' : 'F&O trades as overnight (NRML) or intraday (MIS)');
    }
    if (i.lot > 1 && input.qty % i.lot !== 0) throw new LabError(`${i.label} trades in lots of ${i.lot}`);
    if (!this.market.isOpen(now)) throw new LabError('The market is closed, or live prices are not flowing (connect Kite)');
    this.market.watch([i]);
    const q = this.market.quote(i);
    if (!q) throw new LabError(`No live price for ${i.label} yet: try again in a moment`);
    const bad = validateOrder({ side: input.side, type: input.type, qty: input.qty, pricePaise: input.pricePaise, triggerPaise: input.triggerPaise }, q.ltpPaise);
    if (bad) throw new LabError(bad);

    const { ledger, trades } = await this.ledger();
    const net = this.netQty(ledger.positions, i.symbol, input.product);
    const dir = input.side === 'BUY' ? 1 : -1;
    const entry = net === 0 || Math.sign(net) === dir || Math.abs(input.qty) > Math.abs(net); // adds to (or flips) the position
    if (!system && entry) {
      if (min < hm(s.firstEntry)) throw new LabError(`No new trades before ${s.firstEntry} (your trading window)`);
      if (input.product === 'MIS' && min >= hm(s.squareOff)) throw new LabError(`No new intraday trades from ${s.squareOff}: intraday positions close then`);
      if (i.expiry && i.expiry < date) throw new LabError(`${i.label} has expired`);
    }
    if (input.product === 'CNC' && input.side === 'SELL' && input.qty > Math.max(0, net)) throw new LabError('Delivery shares can only be sold when held (no short delivery)');
    if ((input.stopPaise != null || input.targetPaise != null) && entry) {
      const ref = input.pricePaise ?? q.ltpPaise;
      if (input.stopPaise != null && (dir === 1 ? input.stopPaise >= ref : input.stopPaise <= ref)) throw new LabError(`The stop must be ${dir === 1 ? 'below' : 'above'} the entry price`);
      if (input.targetPaise != null && (dir === 1 ? input.targetPaise <= ref : input.targetPaise >= ref)) throw new LabError(`The target must be ${dir === 1 ? 'above' : 'below'} the entry price`);
    }
    // Funds: the margin the positions would need after this order, against equity less what is already in use.
    if (!system && entry) {
      const after = await this.marginNeeded(ledger.positions, { i, product: input.product, delta: dir * input.qty, pricePaise: input.pricePaise ?? (dir === 1 ? q.askPaise || q.ltpPaise : q.bidPaise || q.ltpPaise) });
      const f = await this.fundsOf(ledger, trades);
      const extra = after.paise - f.usedPaise;
      if (extra > f.availablePaise) throw new LabError(`Not enough funds: needs ${rupees(extra)} more margin (${after.method}), available ${rupees(f.availablePaise)}`);
    }

    const o = await this.repo.createOrder({
      symbol: i.symbol, exchange: i.exchange, side: input.side, product: input.product, type: input.type, qty: input.qty, lotSize: i.lot > 1 ? i.lot : null,
      pricePaise: input.pricePaise ?? null, triggerPaise: input.triggerPaise ?? null, stopPaise: input.stopPaise ?? null, targetPaise: input.targetPaise ?? null,
      parentId: system?.parentId ?? null, status: input.type === 'SL' || input.type === 'SLM' ? 'TRIGGER_PENDING' : 'OPEN', triggered: false,
      avgFillPaise: null, rejectReason: null, tag: system?.tag ?? null, source: input.source ?? 'MANUAL', reason: input.reason ?? null, tradeDate: date,
    }, now);
    await this.work(o, i, true);
    return (await this.repo.orders()).find((x) => x.id === o.id) ?? o;
  }

  /** Margin the open positions would need with some changes (index F&O: SPAN, hedges counted; else estimates). */
  private async marginNeeded(positions: Position[], change?: Change | Change[]) {
    const changes = change == null ? [] : Array.isArray(change) ? change : [change];
    const book = new Map<string, { i: Instrument; product: Product; qty: number; pricePaise: number }>();
    for (const p of positions) {
      if (!p.qty) continue;
      const inst = this.market.instrument(p.symbol);
      if (!inst) continue;
      book.set(`${p.symbol}|${p.product}`, { i: inst, product: p.product, qty: p.qty, pricePaise: this.market.quote(inst)?.ltpPaise ?? Math.round(Math.abs(p.openCostPaise / p.qty)) });
    }
    for (const c of changes) {
      const k = `${c.i.symbol}|${c.product}`;
      const x = book.get(k);
      if (x) x.qty += c.delta; else book.set(k, { i: c.i, product: c.product, qty: c.delta, pricePaise: c.pricePaise });
    }
    const list = [...book.values()].filter((x) => x.qty).map((x) => ({ instrument: x.i, qty: x.product === 'MIS' && x.i.kind === 'EQ' ? x.qty * 0.2 : x.qty, pricePaise: x.pricePaise }));
    return this.margin(list);
  }

  /** Margin a set of new orders would add, together (a basket's hedges count), and what is free. */
  previewMargin(orders: { symbol: string; side: Side; product: Product; qty: number; pricePaise?: number }[]) {
    return this.serial(async () => {
      const { ledger, trades } = await this.ledger();
      const changes: Change[] = [];
      for (const o of orders) {
        const i = this.market.instrument(o.symbol);
        if (!i) throw new LabError(`Unknown symbol ${o.symbol}`);
        const q = this.market.quote(i);
        const px = o.pricePaise ?? (o.side === 'BUY' ? q?.askPaise || q?.ltpPaise : q?.bidPaise || q?.ltpPaise);
        if (!px) throw new LabError(`No live price for ${i.label} yet`);
        changes.push({ i, product: o.product, delta: (o.side === 'BUY' ? 1 : -1) * o.qty, pricePaise: px });
      }
      const f = await this.fundsOf(ledger, trades);
      const after = await this.marginNeeded(ledger.positions, changes);
      return { neededPaise: Math.max(0, after.paise - f.usedPaise), totalAfterPaise: after.paise, availablePaise: f.availablePaise, method: after.method };
    });
  }

  // ---------------------------------------------------------------- matching

  /** Tries to fill (or trigger) one open order against its live book. */
  private async work(o: LabOrder, i: Instrument, isNew: boolean) {
    const q = this.market.quote(i);
    if (!q) return;
    const r = evaluateBook({ side: o.side, type: o.type, pricePaise: o.pricePaise ?? undefined, triggerPaise: o.triggerPaise ?? undefined, triggered: o.triggered }, q, isNew);
    if (r.action === 'trigger') {
      if (await this.repo.updateOrder(o.id, ['TRIGGER_PENDING'], { status: 'OPEN', triggered: true })) {
        const t = { ...o, status: 'OPEN' as const, triggered: true };
        await this.work(t, i, true);
      }
      return;
    }
    if (r.action !== 'fill') return;
    const how = r.fromBook ? `${o.side === 'BUY' ? 'ask' : 'bid'} ${rupees(r.pricePaise)}` : `last price ${rupees(r.pricePaise)} (no ${o.side === 'BUY' ? 'sellers' : 'buyers'} in the book)`;
    await this.fillAt(o, i, r.pricePaise, `Filled at the ${how}`);
  }

  private async fillAt(o: LabOrder, i: Instrument, pricePaise: number, reason: string, time = this.now()) {
    const date = istDate(time);
    const charges = o.tag === 'EXPIRY'
      ? this.expiryCharges(i, o.side, o.qty, pricePaise, date)
      : this.charges(i, o.side, o.product, o.qty, pricePaise, date);
    const ok = await this.repo.fill(o.id, OPEN, {
      orderId: o.id, symbol: o.symbol, exchange: o.exchange, side: o.side, product: o.product, qty: o.qty, pricePaise,
      chargesPaise: charges.total, charges, time, tradeDate: date,
    }, reason);
    if (!ok) return;
    // Bracket: a filled entry places its stop and target; a filled exit cancels the other one.
    if (o.parentId) {
      for (const x of await this.repo.orders(true)) if (x.parentId === o.parentId && x.id !== o.id) await this.repo.updateOrder(x.id, OPEN, { status: 'CANCELLED', reason: 'The other exit of this bracket filled' });
    } else if (o.stopPaise != null || o.targetPaise != null) {
      const exit: Side = o.side === 'BUY' ? 'SELL' : 'BUY';
      const base = { symbol: o.symbol, side: exit, product: o.product, qty: o.qty, source: o.source };
      if (o.stopPaise != null) await this.placeNow({ ...base, type: 'SLM', triggerPaise: o.stopPaise, reason: `Stop of the entry at ${rupees(pricePaise)}` }, { tag: 'BRACKET_STOP', parentId: o.id }).catch(() => undefined);
      if (o.targetPaise != null) await this.placeNow({ ...base, type: 'LIMIT', pricePaise: o.targetPaise, reason: `Target of the entry at ${rupees(pricePaise)}` }, { tag: 'BRACKET_TARGET', parentId: o.id }).catch(() => undefined);
    }
  }

  /** Expiry: long in-the-money options pay exercise STT (and any broker exercise brokerage); futures settle free. */
  private expiryCharges(i: Instrument, side: Side, qty: number, pricePaise: number, date: string): Charges {
    const zero: Charges = { brokerage: 0, stt: 0, exchangeTxn: 0, ipft: 0, sebiFee: 0, stampDuty: 0, gst: 0, dpCharge: 0, total: 0 };
    if (i.kind === 'FUT' || !pricePaise) return zero;
    // The closing trade's side is opposite the position: a SELL closes a long, which is the exercised side.
    const total = expirySettlementCharges({ side: side === 'SELL' ? 'BUY' : 'SELL', qty, intrinsicPaise: pricePaise, date, broker: brokerById(this.settings().broker) });
    return { ...zero, stt: total, total };
  }

  // ---------------------------------------------------------------- cancel and exit

  cancel(id: string): Promise<boolean> {
    return this.serial(async () => {
      const o = (await this.repo.orders(true)).find((x) => x.id === id);
      if (!o) throw new LabError('That order is no longer open');
      return this.repo.updateOrder(id, OPEN, { status: 'CANCELLED', reason: 'Cancelled' });
    });
  }

  /** Closes a position at market and cancels its open orders (bracket exits included). */
  exit(symbol: string, product: Product, source = 'MANUAL', reason = 'Exited'): Promise<LabOrder | null> {
    return this.serial(() => this.exitNow(symbol, product, source, reason, 'EXIT'));
  }
  private async exitNow(symbol: string, product: Product, source: string, reason: string, tag: string) {
    for (const x of await this.repo.orders(true)) if (x.symbol === symbol && x.product === product) await this.repo.updateOrder(x.id, OPEN, { status: 'CANCELLED', reason: `Cancelled: position ${tag === 'AUTO_SQUAREOFF' ? 'squared off' : 'exited'}` });
    const { ledger } = await this.ledger();
    const net = this.netQty(ledger.positions, symbol, product);
    if (!net) return null;
    return this.placeNow({ symbol, side: net > 0 ? 'SELL' : 'BUY', product, type: 'MARKET', qty: Math.abs(net), source, reason }, { tag });
  }

  reset(startingCashPaise: number): Promise<void> {
    return this.serial(async () => {
      if (!Number.isSafeInteger(startingCashPaise) || startingCashPaise < 1_000_00 || startingCashPaise > 100_00_00_000_00) throw new LabError('Starting cash must be between ₹1,000 and ₹100 crore');
      await this.repo.reset(startingCashPaise);
    });
  }

  // ---------------------------------------------------------------- the timer

  /** Called every few seconds (and on ticks): fills, intraday square-off, day-end expiry, F&O settlement. */
  step(): Promise<void> {
    return this.serial(async () => {
      const now = this.now(), date = istDate(now), min = istMinute(now), s = this.settings();
      const open = await this.repo.orders(true);
      const live = this.market.isOpen(now);
      const insts = new Map<string, Instrument>();
      for (const o of open) { const i = this.market.instrument(o.symbol); if (i) insts.set(o.symbol, i); }
      const { ledger } = await this.ledger();
      for (const p of ledger.positions) if (p.qty) { const i = this.market.instrument(p.symbol); if (i) insts.set(p.symbol, i); }
      this.market.watch([...insts.values()]);

      // 1. Fills, while prices flow.
      if (live) for (const o of open) { const i = insts.get(o.symbol); if (i && o.tradeDate === date) await this.work(o, i, false); }

      // 2. Day orders end at the close (and any left from an earlier day).
      for (const o of await this.repo.orders(true)) {
        if (o.tradeDate < date || (o.tradeDate === date && min >= CLOSE)) await this.repo.updateOrder(o.id, OPEN, { status: 'CANCELLED', reason: 'Expired at the close (day order)' });
      }

      // 3. Intraday positions close at the square-off time; one left from an earlier day closes at that day's NSE close.
      for (const p of (await this.ledger()).ledger.positions) {
        if (p.product !== 'MIS' || !p.qty) continue;
        if (p.lastTradeDate === date && min >= hm(s.squareOff) && live) {
          await this.exitNow(p.symbol, 'MIS', 'SYSTEM', `Intraday closed at ${s.squareOff} (your trading window)`, 'AUTO_SQUAREOFF').catch(() => undefined);
        } else if (p.lastTradeDate < date || (!live && min >= CLOSE && p.lastTradeDate === date)) {
          const i = this.market.instrument(p.symbol);
          const px = i ? await this.closes.close(i, p.lastTradeDate) : null;
          if (i && px != null) await this.systemClose(i, p, px, 'AUTO_SQUAREOFF', `Intraday position closed at NSE's close of ${p.lastTradeDate} ${rupees(px)} (the app was not running at ${s.squareOff})`, p.lastTradeDate);
        }
      }

      // 4. F&O settles on expiry: after the close on expiry day, at NSE's final settlement.
      for (const p of (await this.ledger()).ledger.positions) {
        if (!p.qty) continue;
        const i = this.market.instrument(p.symbol);
        if (!i?.expiry || !(i.expiry < date || (i.expiry === date && min >= CLOSE))) continue;
        const px = await this.closes.settlement(i, i.expiry);
        if (px != null) await this.systemClose(i, p, px, 'EXPIRY', `Settled at expiry (${i.expiry}) at ${rupees(px)}${i.kind === 'FUT' ? '' : ' (intrinsic value against the official close)'}`, i.expiry);
      }
    });
  }

  /** Closes a position outside the live book (late square-off, expiry) at a known price, as one system order. */
  private async systemClose(i: Instrument, p: Position, pricePaise: number, tag: string, reason: string, date: string) {
    const time = Math.floor(Date.parse(`${date}T${tag === 'EXPIRY' ? '15:30' : '15:29'}:00+05:30`) / 1000);
    const o = await this.repo.createOrder({
      symbol: i.symbol, exchange: i.exchange, side: p.qty > 0 ? 'SELL' : 'BUY', product: p.product, type: 'MARKET', qty: Math.abs(p.qty), lotSize: i.lot > 1 ? i.lot : null,
      pricePaise: null, triggerPaise: null, stopPaise: null, targetPaise: null, parentId: null, status: 'OPEN', triggered: false, avgFillPaise: null,
      rejectReason: null, tag, source: 'SYSTEM', reason, tradeDate: date,
    }, time);
    await this.fillAt(o, i, pricePaise, reason, time);
  }

  // ---------------------------------------------------------------- reading

  private async fundsOf(ledger: ReturnType<typeof buildLedger>, trades: LabTrade[]) {
    const { startingCashPaise } = await this.repo.account();
    let unrealised = 0;
    for (const p of ledger.positions) {
      if (!p.qty) continue;
      const i = this.market.instrument(p.symbol);
      const ltp = (i && this.market.quote(i)?.ltpPaise) ?? Math.round(p.openCostPaise / p.qty);
      unrealised += p.qty * ltp - p.openCostPaise;
    }
    const m = await this.marginNeeded(ledger.positions);
    const charges = trades.reduce((s, t) => s + t.chargesPaise, 0);
    const equity = startingCashPaise + ledger.realisedPaise + unrealised - charges;
    return { startingCashPaise, equityPaise: equity, realisedPaise: ledger.realisedPaise, unrealisedPaise: unrealised, chargesPaise: charges, usedPaise: m.paise, marginMethod: m.method, availablePaise: equity - m.paise };
  }

  /** Everything the Trade lab page shows. */
  snapshot() {
    return this.serial(async () => {
      const now = this.now(), date = istDate(now), s = this.settings();
      const { ledger, trades } = await this.ledger();
      const funds = await this.fundsOf(ledger, trades);
      const orders = await this.repo.orders();
      const positions = ledger.positions.filter((p) => p.qty || p.lastTradeDate === date).map((p) => {
        const i = this.market.instrument(p.symbol);
        const q = i ? this.market.quote(i) : null;
        const ltp = q?.ltpPaise ?? null;
        return {
          symbol: p.symbol, label: i?.label ?? p.symbol, kind: i?.kind ?? null, product: p.product, qty: p.qty, lot: i?.lot ?? 1,
          avgPaise: p.qty ? Math.round(p.openCostPaise / p.qty) : null, ltpPaise: ltp, bidPaise: q?.bidPaise ?? null, askPaise: q?.askPaise ?? null,
          unrealisedPaise: ltp != null && p.qty ? p.qty * ltp - p.openCostPaise : 0, realisedPaise: p.realisedPaise, chargesPaise: p.chargesPaise,
        };
      });
      // Day by day: realised P&L less that day's charges.
      const days = new Map<string, { realisedPaise: number; chargesPaise: number; trades: number }>();
      const sorted = [...trades].sort((a, b) => a.time - b.time);
      let prev = 0;
      for (const d of [...new Set(sorted.map((t) => t.tradeDate))].sort()) {
        const upto = sorted.filter((t) => t.tradeDate <= d);
        const r = buildLedger(upto, 0).realisedPaise;
        const today = sorted.filter((t) => t.tradeDate === d);
        days.set(d, { realisedPaise: r - prev, chargesPaise: today.reduce((x, t) => x + t.chargesPaise, 0), trades: today.length });
        prev = r;
      }
      return {
        asOf: now, live: this.market.isOpen(now), settings: s, funds, positions,
        orders: orders.filter((o) => o.tradeDate === date || OPEN.includes(o.status)).sort((a, b) => b.createdAt - a.createdAt),
        trades: trades.filter((t) => t.tradeDate === date).sort((a, b) => b.time - a.time),
        days: [...days].map(([d, v]) => ({ date: d, ...v, netPaise: v.realisedPaise - v.chargesPaise })).reverse(),
      };
    });
  }
}
