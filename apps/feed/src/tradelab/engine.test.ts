import { describe, expect, it } from 'vitest';
import { computeCharges, computeOptionCharges } from '@mtv/paper';
import { TradeLab, type MarginFn } from './engine';
import { DEFAULT_SETTINGS, LabError, type Closes, type Instrument, type LabOrder, type LabTrade, type Market, type Quote, type Repo } from './types';

/** IST wall time on 2026-11-11 (a Wednesday) as UTC seconds. */
const at = (hhmm: string, date = '2026-11-11') => Math.floor(Date.parse(`${date}T${hhmm}:00+05:30`) / 1000);

const INST: Record<string, Instrument> = {
  RELIANCE: { symbol: 'RELIANCE', exchange: 'NSE', kind: 'EQ', underlying: 'RELIANCE', expiry: null, strikePaise: 0, lot: 1, token: 1, label: 'RELIANCE' },
  NIFTY26N1724500CE: { symbol: 'NIFTY26N1724500CE', exchange: 'NFO', kind: 'CE', underlying: 'NIFTY', expiry: '2026-11-17', strikePaise: 24500_00, lot: 75, token: 2, label: 'NIFTY 17 Nov 24500 CE' },
};

function setup(opts: { cash?: number; margin?: MarginFn; closes?: Partial<Closes> } = {}) {
  let clock = at('10:00');
  const quotes = new Map<string, Quote>([
    ['RELIANCE', { ltpPaise: 1400_00, bidPaise: 1399_90, askPaise: 1400_10, at: clock }],
    ['NIFTY26N1724500CE', { ltpPaise: 120_00, bidPaise: 119_50, askPaise: 120_50, at: clock }],
  ]);
  let open = true;
  const market: Market = {
    instrument: (s) => INST[s] ?? null,
    quote: (i) => quotes.get(i.symbol) ?? null,
    watch: () => {},
    underlyingPrice: () => 24600_00,
    isOpen: () => open,
  };
  let account = { startingCashPaise: opts.cash ?? 10_00_000_00, resetAt: 0 };
  let orders: LabOrder[] = [];
  let trades: LabTrade[] = [];
  let n = 0;
  const repo: Repo = {
    account: async () => account,
    reset: async (c) => { account = { startingCashPaise: c, resetAt: clock }; orders = []; trades = []; },
    orders: async (o) => (o ? orders.filter((x) => x.status === 'OPEN' || x.status === 'TRIGGER_PENDING') : orders).map((x) => ({ ...x })),
    trades: async () => trades.map((t) => ({ ...t })),
    createOrder: async (o, now) => { const x = { ...o, id: `o${++n}`, createdAt: now }; orders.push(x); return { ...x }; },
    updateOrder: async (id, from, patch) => { const o = orders.find((x) => x.id === id); if (!o || !from.includes(o.status)) return false; Object.assign(o, patch); return true; },
    fill: async (id, from, t, reason) => {
      const o = orders.find((x) => x.id === id);
      if (!o || !from.includes(o.status)) return false;
      Object.assign(o, { status: 'COMPLETE', avgFillPaise: t.pricePaise, reason });
      trades.push({ ...t, id: `t${trades.length + 1}` });
      return true;
    },
  };
  const closes: Closes = { close: async () => null, settlement: async () => null, ...opts.closes };
  const margin: MarginFn = opts.margin ?? (async (list) => ({ paise: Math.round(list.reduce((s, x) => s + Math.abs(x.qty) * x.pricePaise, 0)), method: 'test' }));
  const lab = new TradeLab(repo, market, closes, margin, () => DEFAULT_SETTINGS, () => clock);
  return {
    lab, quotes,
    setTime: (t: number) => { clock = t; },
    setOpen: (v: boolean) => { open = v; },
    orders: () => orders, trades: () => trades,
  };
}

describe('Trade lab: placing and filling', () => {
  it('a market buy pays the ask, with the right charges, and the position shows', async () => {
    const t = setup();
    const o = await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 10 });
    expect(o.status).toBe('COMPLETE');
    expect(t.trades()[0].pricePaise).toBe(1400_10);
    expect(t.trades()[0].chargesPaise).toBe(computeCharges({ side: 'BUY', product: 'MIS', qty: 10, pricePaise: 1400_10, date: '2026-11-11' }).total);
    const snap = await t.lab.snapshot();
    expect(snap.positions[0]).toMatchObject({ symbol: 'RELIANCE', qty: 10, avgPaise: 1400_10, ltpPaise: 1400_00 });
    expect(snap.positions[0].unrealisedPaise).toBe(10 * (1400_00 - 1400_10));
  });

  it('options trade in whole lots, buys at the ask and charges option rates', async () => {
    const t = setup();
    await expect(t.lab.place({ symbol: 'NIFTY26N1724500CE', side: 'BUY', product: 'NRML', type: 'MARKET', qty: 50 })).rejects.toThrow(/lots of 75/);
    await t.lab.place({ symbol: 'NIFTY26N1724500CE', side: 'BUY', product: 'NRML', type: 'MARKET', qty: 150 });
    expect(t.trades()[0]).toMatchObject({ pricePaise: 120_50, qty: 150 });
    expect(t.trades()[0].chargesPaise).toBe(computeOptionCharges({ side: 'BUY', qty: 150, premiumPaise: 120_50, date: '2026-11-11' }).total);
  });

  it('keeps the trading window: no entries before 09:30, no new intraday from 15:00, exits allowed', async () => {
    const t = setup();
    t.setTime(at('09:20'));
    await expect(t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 1 })).rejects.toThrow(/before 09:30/);
    t.setTime(at('10:00'));
    await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 1 });
    t.setTime(at('15:01'));
    await expect(t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 1 })).rejects.toThrow(/from 15:00/);
  });

  it('refuses when the market is closed or funds are short', async () => {
    const t = setup({ cash: 10_000_00 });
    await expect(t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 100 })).rejects.toThrow(/Not enough funds/);
    t.setOpen(false);
    await expect(t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 1 })).rejects.toThrow(LabError);
  });

  it('a resting limit waits, then fills at its own price when the book reaches it', async () => {
    const t = setup();
    const o = await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'LIMIT', qty: 5, pricePaise: 1395_00 });
    expect(o.status).toBe('OPEN');
    t.quotes.set('RELIANCE', { ltpPaise: 1394_50, bidPaise: 1394_40, askPaise: 1394_80, at: at('10:05') });
    await t.lab.step();
    expect(t.trades()[0]).toMatchObject({ pricePaise: 1395_00, qty: 5 });
  });
});

describe('Trade lab: brackets, square-off, expiry', () => {
  it('a bracket entry places a stop and a target; when one fills the other is cancelled', async () => {
    const t = setup();
    await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 10, stopPaise: 1390_00, targetPaise: 1420_00 });
    const exits = t.orders().filter((o) => o.parentId);
    expect(exits.map((o) => [o.type, o.status])).toEqual([['SLM', 'TRIGGER_PENDING'], ['LIMIT', 'OPEN']]);
    t.quotes.set('RELIANCE', { ltpPaise: 1421_00, bidPaise: 1420_90, askPaise: 1421_10, at: at('11:00') });
    await t.lab.step();
    expect(t.orders().find((o) => o.tag === 'BRACKET_TARGET')!.status).toBe('COMPLETE');
    expect(t.orders().find((o) => o.tag === 'BRACKET_STOP')!.status).toBe('CANCELLED');
    expect((await t.lab.snapshot()).positions[0].qty).toBe(0);
  });

  it('rejects a bracket stop on the wrong side of the entry', async () => {
    const t = setup();
    await expect(t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 1, stopPaise: 1410_00 })).rejects.toThrow(/stop must be below/);
  });

  it('closes intraday positions at 15:00 at the bid, and expires day orders at 15:30', async () => {
    const t = setup();
    await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 10 });
    await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'LIMIT', qty: 1, pricePaise: 1300_00 });
    t.setTime(at('15:00'));
    await t.lab.step();
    const sq = t.orders().find((o) => o.tag === 'AUTO_SQUAREOFF')!;
    expect(sq).toMatchObject({ status: 'COMPLETE', side: 'SELL', qty: 10 });
    expect(t.trades().at(-1)!.pricePaise).toBe(1399_90);
    expect(t.orders().find((o) => o.product === 'CNC')!.status).toBe('OPEN');
    t.setTime(at('15:31'));
    await t.lab.step();
    expect(t.orders().find((o) => o.product === 'CNC')!.status).toBe('CANCELLED');
  });

  it('closes an intraday position left from a day the app was off, at that day\'s NSE close', async () => {
    const t = setup({ closes: { close: async (_i, d) => (d === '2026-11-11' ? 1402_00 : null) } });
    await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 4 });
    t.setOpen(false);
    t.setTime(at('10:00', '2026-11-12'));
    await t.lab.step();
    const last = t.trades().at(-1)!;
    expect(last).toMatchObject({ side: 'SELL', qty: 4, pricePaise: 1402_00, tradeDate: '2026-11-11' });
    expect(t.orders().find((o) => o.tag === 'AUTO_SQUAREOFF')!.reason).toMatch(/not running at 15:00/);
  });

  it('settles an option at expiry at its intrinsic value, worthless at ₹0', async () => {
    const t = setup({ closes: { settlement: async () => 0 } });
    await t.lab.place({ symbol: 'NIFTY26N1724500CE', side: 'BUY', product: 'NRML', type: 'MARKET', qty: 75 });
    t.setTime(at('15:35', '2026-11-17'));
    await t.lab.step();
    const s = t.trades().at(-1)!;
    expect(s).toMatchObject({ side: 'SELL', qty: 75, pricePaise: 0, chargesPaise: 0 });
    const snap = await t.lab.snapshot();
    expect(snap.funds.realisedPaise).toBe(-75 * 120_50);
  });
});

describe('Trade lab: margin preview for an order or a basket', () => {
  it('adds up the new orders together with what is already open', async () => {
    const t = setup();
    await t.lab.place({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 10 });
    const one = await t.lab.previewMargin([{ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', qty: 5 }]);
    // Adding to a held position: the whole position is valued at the market (last) price; the 10 held are already in use.
    expect(one.neededPaise).toBe(5 * 1400_00);
    const basket = await t.lab.previewMargin([
      { symbol: 'RELIANCE', side: 'BUY', product: 'CNC', qty: 5 },
      { symbol: 'NIFTY26N1724500CE', side: 'BUY', product: 'NRML', qty: 75 },
    ]);
    // A new instrument is valued at the price the order would pay (the ask for a market buy).
    expect(basket.neededPaise).toBe(5 * 1400_00 + 75 * 120_50);
    await expect(t.lab.previewMargin([{ symbol: 'NOPE', side: 'BUY', product: 'CNC', qty: 1 }])).rejects.toThrow(/Unknown symbol/);
  });
});
