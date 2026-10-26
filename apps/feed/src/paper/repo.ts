import { paise, prisma, type PaperOrder as DbOrder, type PaperTrade as DbTrade } from '@mtv/db';
import type { Charges, PaperOrder, Paise } from '@mtv/paper';
import type { PaperRepo, StoredTrade } from './engine';

const DEFAULT_STARTING_CASH: Paise = 10_00_000_00; // ₹10,00,000

const toOrder = (o: DbOrder): PaperOrder => ({
  id: o.id, symbol: o.symbol, side: o.side as PaperOrder['side'], product: o.product as PaperOrder['product'], type: o.type as PaperOrder['type'], qty: o.qty,
  pricePaise: o.pricePaise == null ? null : paise(o.pricePaise), triggerPaise: o.triggerPaise == null ? null : paise(o.triggerPaise),
  status: o.status as PaperOrder['status'], triggered: o.triggered, avgFillPaise: o.avgFillPaise == null ? null : paise(o.avgFillPaise),
  rejectReason: o.rejectReason, tag: o.tag, tradeDate: o.tradeDate, createdAt: Math.floor(o.createdAt.getTime() / 1000),
});
const toTrade = (t: DbTrade): StoredTrade => ({
  id: t.id, orderId: t.orderId, symbol: t.symbol, product: t.product as StoredTrade['product'], side: t.side as StoredTrade['side'], qty: t.qty,
  pricePaise: paise(t.pricePaise), chargesPaise: paise(t.chargesPaise), charges: t.charges as Charges, time: Math.floor(t.time.getTime() / 1000), tradeDate: t.tradeDate,
});

/** Single paper account for now; accounts become per-user when sign-in arrives. */
export class PrismaPaperRepo implements PaperRepo {
  async account() {
    const a = (await prisma.paperAccount.findFirst({ orderBy: { createdAt: 'asc' } })) ?? (await prisma.paperAccount.create({ data: { startingCashPaise: BigInt(DEFAULT_STARTING_CASH) } }));
    return { id: a.id, startingCashPaise: paise(a.startingCashPaise), resetAt: a.resetAt.toISOString() };
  }
  async trades(accountId: string) {
    return (await prisma.paperTrade.findMany({ where: { accountId }, orderBy: { time: 'asc' } })).map(toTrade);
  }
  async orders(accountId: string, f: { open?: boolean; sinceTradeDate?: string }) {
    const rows = await prisma.paperOrder.findMany({
      where: { accountId, ...(f.open ? { status: { in: ['OPEN', 'TRIGGER_PENDING'] } } : {}), ...(f.sinceTradeDate ? { tradeDate: { gte: f.sinceTradeDate } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toOrder);
  }
  async createOrder(accountId: string, o: Omit<PaperOrder, 'id' | 'createdAt'>) {
    const row = await prisma.paperOrder.create({
      data: {
        accountId, symbol: o.symbol, side: o.side, product: o.product, type: o.type, qty: o.qty,
        pricePaise: o.pricePaise == null ? null : BigInt(o.pricePaise), triggerPaise: o.triggerPaise == null ? null : BigInt(o.triggerPaise),
        status: o.status, triggered: o.triggered, rejectReason: o.rejectReason, tag: o.tag, tradeDate: o.tradeDate,
      },
    });
    return toOrder(row);
  }
  async updateOrder(id: string, from: PaperOrder['status'][], patch: Partial<Pick<PaperOrder, 'status' | 'triggered' | 'rejectReason'>>) {
    const r = await prisma.paperOrder.updateMany({ where: { id, status: { in: from } }, data: patch });
    return r.count === 1;
  }
  async fillOrder(accountId: string, orderId: string, from: PaperOrder['status'][], t: Omit<StoredTrade, 'id'>) {
    return prisma.$transaction(async (tx) => {
      const r = await tx.paperOrder.updateMany({ where: { id: orderId, status: { in: from } }, data: { status: 'COMPLETE', avgFillPaise: BigInt(t.pricePaise) } });
      if (r.count !== 1) return false;
      await tx.paperTrade.create({
        data: {
          accountId, orderId, symbol: t.symbol, side: t.side, product: t.product, qty: t.qty, pricePaise: BigInt(t.pricePaise), chargesPaise: BigInt(t.chargesPaise),
          charges: t.charges, time: new Date(t.time * 1000), tradeDate: t.tradeDate,
        },
      });
      return true;
    });
  }
  async reset(accountId: string, startingCashPaise: Paise) {
    await prisma.$transaction([
      prisma.paperTrade.deleteMany({ where: { accountId } }),
      prisma.paperOrder.deleteMany({ where: { accountId } }),
      prisma.paperAccount.update({ where: { id: accountId }, data: { startingCashPaise: BigInt(startingCashPaise), resetAt: new Date() } }),
    ]);
  }
}

/** In-memory repository with the same conditional-update semantics, for tests. */
export class MemoryPaperRepo implements PaperRepo {
  acc = { id: 'acc', startingCashPaise: DEFAULT_STARTING_CASH, resetAt: new Date(0).toISOString() };
  ordersList: PaperOrder[] = [];
  tradesList: StoredTrade[] = [];
  private seq = 0;
  clock = () => 0;

  async account() { return { ...this.acc }; }
  async trades() { return this.tradesList.map((t) => ({ ...t })); }
  async orders(_: string, f: { open?: boolean; sinceTradeDate?: string }) {
    return this.ordersList.filter((o) => (!f.open || o.status === 'OPEN' || o.status === 'TRIGGER_PENDING') && (!f.sinceTradeDate || o.tradeDate >= f.sinceTradeDate)).map((o) => ({ ...o }));
  }
  async createOrder(_: string, o: Omit<PaperOrder, 'id' | 'createdAt'>) {
    const order = { ...o, id: `o${++this.seq}`, createdAt: this.clock() };
    this.ordersList.push(order);
    return { ...order };
  }
  async updateOrder(id: string, from: PaperOrder['status'][], patch: Partial<PaperOrder>) {
    const o = this.ordersList.find((x) => x.id === id);
    if (!o || !from.includes(o.status)) return false;
    Object.assign(o, patch);
    return true;
  }
  async fillOrder(_: string, orderId: string, from: PaperOrder['status'][], t: Omit<StoredTrade, 'id'>) {
    const o = this.ordersList.find((x) => x.id === orderId);
    if (!o || !from.includes(o.status)) return false;
    o.status = 'COMPLETE';
    o.avgFillPaise = t.pricePaise;
    this.tradesList.push({ ...t, id: `t${++this.seq}` });
    return true;
  }
  async reset(_: string, startingCashPaise: Paise) {
    this.ordersList = [];
    this.tradesList = [];
    this.acc = { ...this.acc, startingCashPaise };
  }
}
