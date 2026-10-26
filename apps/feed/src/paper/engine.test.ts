import { beforeEach, describe, expect, it } from 'vitest';
import { buildLedger, computeCharges, toPaise, type Paise } from '@mtv/paper';
import { marketSession } from '@mtv/shared';
import { PaperEngine } from './engine';
import { MemoryPaperRepo } from './repo';

const ist = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h, m) / 1000 - 5.5 * 3600;

function setup() {
  const repo = new MemoryPaperRepo();
  const prices: Record<string, Paise> = { RELIANCE: toPaise(1200), TCS: toPaise(2500) };
  const clock = { now: ist(27, 10, 0) }; // Tue 27 Oct 2026, 10:00 IST
  repo.clock = () => clock.now;
  const squareOffPrices: Record<string, Paise> = {};
  const engine = new PaperEngine({
    repo,
    ltp: (s) => prices[s],
    freshLtp: async (s) => prices[s],
    squareOffPrice: async (s) => squareOffPrices[s],
    isTradable: (s) => s in prices,
    session: () => marketSession(clock.now),
    now: () => clock.now,
    onChange: () => {},
    log: () => {},
  });
  const ledger = async () => buildLedger(await repo.trades(), (await repo.account()).startingCashPaise);
  return { repo, prices, clock, engine, ledger, squareOffPrices };
}

let t: ReturnType<typeof setup>;
beforeEach(() => { t = setup(); });

describe('placing orders', () => {
  it('a market delivery buy fills at the LTP and cash falls by value plus exact charges', async () => {
    const o = await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 10 });
    expect(o.status).toBe('COMPLETE');
    expect(o.avgFillPaise).toBe(toPaise(1200));
    const charges = computeCharges({ side: 'BUY', product: 'CNC', qty: 10, pricePaise: toPaise(1200) }).total;
    expect((await t.ledger()).cashPaise).toBe(toPaise(1000000) - toPaise(12000) - charges);
  });

  it('rejects, and records, orders that break the rules', async () => {
    const r = (o: Parameters<typeof t.engine.placeOrder>[0]) => t.engine.placeOrder(o).then((x) => [x.status, x.rejectReason]);
    expect(await r({ symbol: 'NIFTY', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 1 })).toEqual(['REJECTED', expect.stringMatching(/only NSE equities/)]);
    expect(await r({ symbol: 'RELIANCE', side: 'SELL', product: 'CNC', type: 'MARKET', qty: 1 })).toEqual(['REJECTED', expect.stringMatching(/hold 0/)]);
    expect(await r({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 1000 })).toEqual(['REJECTED', expect.stringMatching(/Insufficient funds/)]);
    expect(await r({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'LIMIT', qty: 1, price: '1199.999' })).toEqual(['REJECTED', expect.stringMatching(/two decimals/)]);
    t.clock.now = ist(27, 16, 0);
    expect(await r({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 1 })).toEqual(['REJECTED', expect.stringMatching(/Market is closed/)]);
    t.clock.now = ist(27, 15, 21);
    expect(await r({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 1 })).toEqual(['REJECTED', expect.stringMatching(/after 15:20/)]);
    expect((await t.repo.trades()).length).toBe(0);
  });

  it('serialises concurrent orders so two cannot spend the same funds', async () => {
    // each needs ~₹6,00,000 of ₹10,00,000
    const [a, b] = await Promise.all([
      t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 500 }),
      t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 500 }),
    ]);
    expect([a.status, b.status]).toEqual(['COMPLETE', 'REJECTED']);
  });

  it('lets you sell delivery shares you hold, but no more', async () => {
    await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 10 });
    expect((await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'SELL', product: 'CNC', type: 'MARKET', qty: 11 })).status).toBe('REJECTED');
    expect((await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'SELL', product: 'CNC', type: 'MARKET', qty: 10 })).status).toBe('COMPLETE');
  });
});

describe('resting orders', () => {
  it('a limit buy rests, then fills at its own limit price when the market reaches it', async () => {
    const o = await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'LIMIT', qty: 5, price: '1190' });
    expect(o.status).toBe('OPEN');
    t.prices.RELIANCE = toPaise(1195);
    await t.engine.tick();
    expect((await t.repo.orders('', {}))[0].status).toBe('OPEN');
    t.prices.RELIANCE = toPaise(1188.5);
    await t.engine.tick();
    const filled = (await t.repo.orders('', {}))[0];
    expect([filled.status, filled.avgFillPaise]).toEqual(['COMPLETE', toPaise(1190)]);
  });

  it('a stop-loss sell triggers at the trigger and fills within its limit', async () => {
    await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 5 });
    await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'SELL', product: 'MIS', type: 'SL', qty: 5, triggerPrice: '1180', price: '1175' });
    t.prices.RELIANCE = toPaise(1179);
    await t.engine.tick();
    const sl = (await t.repo.orders('', {}))[1];
    expect([sl.status, sl.triggered, sl.avgFillPaise]).toEqual(['COMPLETE', true, toPaise(1179)]);
    expect((await t.ledger()).positions[0]).toMatchObject({ qty: 0, realisedPaise: -5 * toPaise(21) });
  });

  it('a cancelled order can never fill afterwards', async () => {
    const o = await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'LIMIT', qty: 5, price: '1190' });
    expect(await t.engine.cancelOrder(o.id)).toBe(true);
    t.prices.RELIANCE = toPaise(1100);
    await t.engine.tick();
    expect((await t.repo.trades()).length).toBe(0);
    expect(await t.engine.cancelOrder(o.id)).toBe(false);
  });

  it('expires unfilled orders at the close', async () => {
    await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'LIMIT', qty: 5, price: '1100' });
    t.clock.now = ist(27, 15, 31);
    await t.engine.tick();
    expect((await t.repo.orders('', {}))[0]).toMatchObject({ status: 'CANCELLED', rejectReason: 'Expired at market close' });
  });
});

describe('intraday square-off', () => {
  it('closes MIS positions at 15:20 IST at the live price, tagged AUTO_SQUAREOFF', async () => {
    await t.engine.placeOrder({ symbol: 'TCS', side: 'SELL', product: 'MIS', type: 'MARKET', qty: 4 }); // short 4 @ 2500
    t.clock.now = ist(27, 15, 19);
    await t.engine.tick();
    expect((await t.ledger()).positions[0].qty).toBe(-4);
    t.clock.now = ist(27, 15, 20);
    t.prices.TCS = toPaise(2490);
    await t.engine.tick();
    const l = await t.ledger();
    expect(l.positions[0]).toMatchObject({ qty: 0, realisedPaise: 4 * toPaise(10) });
    expect((await t.repo.orders('', {})).at(-1)).toMatchObject({ side: 'BUY', qty: 4, tag: 'AUTO_SQUAREOFF', status: 'COMPLETE' });
  });

  it('a square-off missed while the server was down uses that day\'s 15:20 bar, stamped 15:20', async () => {
    await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 2 });
    t.squareOffPrices.RELIANCE = toPaise(1210);
    t.clock.now = ist(28, 9, 30); // next morning
    await t.engine.tick();
    const trades = await t.repo.trades();
    expect(trades.at(-1)).toMatchObject({ side: 'SELL', pricePaise: toPaise(1210), time: ist(27, 15, 20), tradeDate: '2026-10-27' });
    expect((await t.ledger()).positions[0]).toMatchObject({ qty: 0, realisedPaise: 2 * toPaise(10) });
  });

  it('never squares off delivery (CNC) positions', async () => {
    await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'CNC', type: 'MARKET', qty: 2 });
    t.clock.now = ist(27, 15, 25);
    await t.engine.tick();
    expect((await t.ledger()).positions[0].qty).toBe(2);
  });
});

describe('snapshot', () => {
  it('reports funds and P&L from the ledger', async () => {
    await t.engine.placeOrder({ symbol: 'RELIANCE', side: 'BUY', product: 'MIS', type: 'MARKET', qty: 10 });
    t.prices.RELIANCE = toPaise(1205);
    const s = await t.engine.snapshot();
    const charges = computeCharges({ side: 'BUY', product: 'MIS', qty: 10, pricePaise: toPaise(1200) }).total;
    expect(s.positions[0]).toMatchObject({ symbol: 'RELIANCE', qty: 10, avgPricePaise: toPaise(1200), ltpPaise: toPaise(1205), unrealisedPaise: toPaise(50) });
    expect(s.account.chargesPaise).toBe(charges);
    expect(s.account.equityPaise).toBe(toPaise(1000000) - charges + toPaise(50));
    expect(s.account.availablePaise).toBe(s.account.equityPaise - toPaise(12050));
  });
});
