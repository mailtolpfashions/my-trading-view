import { prisma } from '@mtv/db';
import { contractId, type ContractKey, type ContractQuote, type OptionsData } from '@mtv/backtest';

const quote = (r: { strikePaise: number; closePaise: number; settlePaise: number; traded: boolean }): ContractQuote => ({ strikePaise: r.strikePaise, closePaise: r.closePaise, settlePaise: r.settlePaise, traded: r.traded });

/** NSE official F&O end-of-day data from Postgres, for the options backtester. */
export const prismaOptionsData: OptionsData = {
  async tradingDates(underlying, from, to) {
    const rows = await prisma.fnoDayMeta.findMany({ where: { underlying, date: { gte: from, lte: to } }, select: { date: true }, orderBy: { date: 'asc' } });
    return rows.map((r) => r.date);
  },
  async meta(underlying, date) {
    const m = await prisma.fnoDayMeta.findUnique({ where: { date_underlying: { date, underlying } } });
    return m ? { spotPaise: m.spotPaise, lotSize: m.lotSize } : null;
  },
  async expiries(underlying, date) {
    const rows = await prisma.fnoEod.findMany({ where: { underlying, date, kind: { in: ['CE', 'PE'] } }, distinct: ['expiry'], select: { expiry: true }, orderBy: { expiry: 'asc' } });
    return rows.map((r) => r.expiry);
  },
  async chain(underlying, date, expiry, kind) {
    const rows = await prisma.fnoEod.findMany({ where: { underlying, date, expiry, kind }, select: { strikePaise: true, closePaise: true, settlePaise: true, traded: true } });
    return rows.map(quote);
  },
  async quotes(underlying, date, contracts: ContractKey[]) {
    if (!contracts.length) return new Map();
    const rows = await prisma.fnoEod.findMany({
      where: { underlying, date, OR: contracts.map((c) => ({ expiry: c.expiry, strikePaise: c.strikePaise, kind: c.kind })) },
      select: { expiry: true, strikePaise: true, kind: true, closePaise: true, settlePaise: true, traded: true },
    });
    return new Map(rows.map((r) => [contractId({ expiry: r.expiry, strikePaise: r.strikePaise, kind: r.kind as 'CE' | 'PE' }), quote(r)]));
  },
};
