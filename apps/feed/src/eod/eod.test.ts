import { describe, expect, it } from 'vitest';
import { adjustedCandles, findAdjustments, findBreaks, rightsFactor, type RawBar } from './adjust';
import { cmBhavcopyUrl, parseOldCm, parseUdiffCm } from './bhavcopy';

// Header and RELIANCE rows exactly as published by NSE (25 Oct 2024 UDiFF; 5 Jul 2024 old layout).
const UDIFF = [
  'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4',
  '2024-10-25,2024-10-25,CM,NSE,STK,2885,INE002A01018,RELIANCE,EQ,,,,,RELIANCE INDUSTRIES LTD,2687.00,2688.70,2644.00,2655.70,2656.30,2679.60,,2655.70,,,9298748,24732826126.10,388238,F1,1,,,,,',
  '2024-10-25,2024-10-25,CM,NSE,STK,1,INE000X01011,SMEX,SM,,,,,SOME SME LTD,10.00,11.00,9.00,10.50,10.50,10.00,,10.50,,,100,1050,3,F1,1,,,,,',
  '2024-10-25,2024-10-25,CM,NSE,STK,2,INE000Y01011,BADROW,EQ,,,,,BAD LTD,100.00,99.00,98.00,99.50,99.50,100.00,,99.50,,,100,9950,3,F1,1,,,,,',
].join('\n');
const OLD = [
  'SYMBOL,SERIES,OPEN,HIGH,LOW,CLOSE,LAST,PREVCLOSE,TOTTRDQTY,TOTTRDVAL,TIMESTAMP,TOTALTRADES,ISIN,',
  'RELIANCE,EQ,3107.65,3197,3096,3177.25,3189.9,3108.05,6134855,19323716027.9,05-JUL-2024,261494,INE002A01018,',
].join('\n');

describe('NSE cash-market bhavcopy', () => {
  it('reads the UDiFF layout, keeps main-board series, and reports bad rows instead of storing them', () => {
    const day = parseUdiffCm(UDIFF, '2024-10-25');
    expect(day.rows).toEqual([{ symbol: 'RELIANCE', isin: 'INE002A01018', series: 'EQ', open: 2687, high: 2688.7, low: 2644, close: 2655.7, prevClose: 2679.6, volume: 9298748, trades: 388238 }]);
    expect(day.rejected).toEqual([{ symbol: 'BADROW', reason: expect.stringMatching(/high\/low inconsistent/) }]);
  });
  it('reads the old layout', () => {
    expect(parseOldCm(OLD, '2024-07-05').rows[0]).toEqual({ symbol: 'RELIANCE', isin: 'INE002A01018', series: 'EQ', open: 3107.65, high: 3197, low: 3096, close: 3177.25, prevClose: 3108.05, volume: 6134855, trades: 261494 });
  });
  it('fails loudly when NSE changes the format', () => {
    expect(() => parseOldCm('SYMBOL,SERIES,OPEN\nX,EQ,1', '2024-07-05')).toThrow(/format changed/);
  });
  it('picks the right archive file for each layout', () => {
    expect(cmBhavcopyUrl('2024-10-25')).toBe('https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20241025_F_0000.csv.zip');
    expect(cmBhavcopyUrl('2024-07-05')).toBe('https://nsearchives.nseindia.com/content/historical/EQUITIES/2024/JUL/cm05JUL2024bhav.csv.zip');
  });
});

const bar = (date: string, open: number, close: number, volume = 1000, symbol = 'RELIANCE'): RawBar => ({ date, symbol, openPaise: open, highPaise: Math.max(open, close), lowPaise: Math.min(open, close), closePaise: close, prevClosePaise: 0, volume });

describe('corporate-action adjustment from NSE corporate action file', () => {
  // RELIANCE, real closes: 2,655.70 on 25 Oct 2024; bonus 1:1 ex 28 Oct (open 1,337.00, close 1,334.35).
  const bars = [bar('2024-10-24', 268000, 270000), bar('2024-10-25', 268700, 265570), bar('2024-10-28', 133700, 133435, 4000)];
  const bonus = { symbol: 'RELIANCE', exDate: '2024-10-28', purpose: 'BONUS 1:1' };
  it('applies the bonus from its ex-date, and checks it against the actual gap', () => {
    const { adjustments, unhandled } = findAdjustments(bars, [bonus, { ...bonus }]); // listed twice (EQ and BE rows)
    expect(unhandled).toEqual([]);
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]).toMatchObject({ date: '2024-10-28', factor: 0.5, check: false });
    expect(adjustments[0].impliedRatio).toBeCloseTo(133700 / 265570, 10);
  });
  it('scales earlier prices and volumes so the series is continuous; the ex-date and later stay as traded', () => {
    const c = adjustedCandles(bars, findAdjustments(bars, [bonus]).adjustments);
    expect(c.map((x) => x.close)).toEqual([1350, 1327.85, 1334.35]);
    expect(c.map((x) => x.volume)).toEqual([2000, 2000, 4000]);
  });
  it('compounds several actions', () => {
    const b = [bar('2024-01-01', 100000, 100000), bar('2024-01-02', 50000, 50000), bar('2024-01-03', 25000, 25000)];
    const acts = [{ symbol: 'RELIANCE', exDate: '2024-01-02', purpose: 'BONUS 1:1' }, { symbol: 'RELIANCE', exDate: '2024-01-03', purpose: 'FV SPLT FRM RS 2 TO RE 1' }];
    expect(adjustedCandles(b, findAdjustments(b, acts).adjustments).map((x) => x.close)).toEqual([250, 250, 250]);
  });
  it('applies an action whose ex-date fell on a day the stock did not trade to its next session', () => {
    const b = [bar('2024-01-01', 100000, 100000), bar('2024-01-05', 50000, 50000)];
    expect(findAdjustments(b, [{ symbol: 'RELIANCE', exDate: '2024-01-03', purpose: 'BONUS 1:1' }]).adjustments[0].date).toBe('2024-01-05');
  });
  it('applies an action NSE lists twice with different ex-dates only once, on the day the price gap confirms (HAL, Sep 2023)', () => {
    // HAL 1:2 split: listed with ex-date 28 Sep and again 29 Sep 2023; the price halved on 28 Sep.
    const b = [bar('2023-09-27', 400000, 400000, 1000, 'HAL'), bar('2023-09-28', 200500, 201000, 2000, 'HAL'), bar('2023-09-29', 201000, 202000, 2000, 'HAL')];
    const acts = [{ symbol: 'HAL', exDate: '2023-09-28', purpose: 'FV SPLT FRM RS 10 TO RS 5' }, { symbol: 'HAL', exDate: '2023-09-29', purpose: 'FV SPLT FRM RS 10 TO RS 5' }];
    const { adjustments } = findAdjustments(b, acts);
    expect(adjustments.map((a) => a.date)).toEqual(['2023-09-28']);
    expect(adjustedCandles(b, adjustments).map((c) => c.close)).toEqual([2000, 2010, 2020]);
  });
  it('flags a factor the actual price gap does not support', () => {
    const b = [bar('2024-01-01', 100000, 100000), bar('2024-01-02', 99000, 99000)];
    expect(findAdjustments(b, [{ symbol: 'RELIANCE', exDate: '2024-01-02', purpose: 'BONUS 1:1' }]).adjustments[0].check).toBe(true);
  });
  it('rights issue, NSE method: Adani Enterprises 3:25 @ premium ₹1,799 (face value ₹1), ex 17 Nov 2025', () => {
    // NSE closes: 2,516.80 on 14 Nov (last cum-rights day); ex-day open 2,460.00. S = 1 + 1,799 = 1,800.
    // E = (2,516.80 − 1,800) × 3/28 = 76.80 → theoretical ex-rights price 2,440.00 → factor 2,440 / 2,516.80.
    expect(rightsFactor(2516.8, 1800, 3, 25)).toBeCloseTo(2440 / 2516.8, 12);
    const b = [bar('2025-11-13', 250200, 248820, 1000, 'ADANIENT'), bar('2025-11-14', 250000, 251680, 1000, 'ADANIENT'), bar('2025-11-17', 246000, 246200, 1000, 'ADANIENT')];
    const acts = [{ symbol: 'ADANIENT', exDate: '2025-11-17', purpose: 'RIGHTS 3:25@PRM RS 1799' }, { symbol: 'ADANIENT', exDate: '2025-12-23', purpose: 'FIRST CL RS 450 PR SH' }];
    const r = findAdjustments(b, acts, 1);
    expect(r.unhandled).toEqual([]); // the call is on the partly-paid shares
    expect(r.adjustments).toHaveLength(1);
    expect(r.adjustments[0].factor).toBeCloseTo(2440 / 2516.8, 12);
    expect(adjustedCandles(b, r.adjustments).map((c) => c.close)).toEqual([2412.27, 2440, 2462]);
  });
  it('rights: no adjustment when the issue price is at or above the cum price; face value taken from a later split', () => {
    expect(rightsFactor(100, 120, 1, 4)).toBe(1);
    const b = [bar('2024-01-01', 10000, 10000), bar('2024-01-02', 9500, 9500), bar('2024-06-03', 2000, 2000)];
    const acts = [{ symbol: 'RELIANCE', exDate: '2024-01-02', purpose: 'RIGHTS 1:4 @ PRM RS 40/-' }, { symbol: 'RELIANCE', exDate: '2024-06-03', purpose: 'FV SPLT FRM RS 10 TO RS 2' }];
    // Face value on the rights date is ₹10 (today's ₹2 came with the later split): S = 50; E = (100 − 50)/5 = 10 → 0.9.
    const rights = findAdjustments(b, acts, 2).adjustments.find((a) => a.date === '2024-01-02')!;
    expect(rights.factor).toBeCloseTo(0.9, 12);
  });
  it('rights without a price, or without a known face value, stay flagged', () => {
    const plain = [bar('2024-01-01', 10000, 10000), bar('2024-01-02', 10100, 10100)];
    expect(findAdjustments(plain, [{ symbol: 'RELIANCE', exDate: '2024-01-02', purpose: 'RIGHTS 1:1' }], 10).unhandled[0].reason).toMatch(/without a price/);
    expect(findAdjustments(plain, [{ symbol: 'RELIANCE', exDate: '2024-01-02', purpose: 'RIGHTS 1:5 @ PRM RS 90' }]).unhandled[0].reason).toMatch(/face value unknown/);
  });
  it('ignores dividends, reports rights issues, and leaves actions outside the history alone', () => {
    const plain = [bar('2024-01-01', 10000, 10000), bar('2024-01-02', 10100, 10100)];
    const r = findAdjustments(plain, [
      { symbol: 'RELIANCE', exDate: '2024-01-02', purpose: 'INTDIV - RS 5 PER SH' },
      { symbol: 'RELIANCE', exDate: '2024-01-02', purpose: 'RIGHTS 1:5 @ PREMIUM RS 90' },
      { symbol: 'RELIANCE', exDate: '2023-06-01', purpose: 'BONUS 1:1' },
      { symbol: 'OTHER', exDate: '2024-01-02', purpose: 'BONUS 1:1' },
    ]);
    expect(r.adjustments).toEqual([]);
    expect(r.unhandled.map((u) => u.purpose)).toEqual(['RIGHTS 1:5 @ PREMIUM RS 90']);
    expect(adjustedCandles(plain, r.adjustments).map((x) => x.close)).toEqual([100, 101]);
  });
});

describe('data breaks (series not continuous across a day)', () => {
  const b = (date: string, close: number, isin = 'INE721A01013') => ({ ...bar(date, close, close, 1000, 'SHRIRAMFIN'), isin });
  it('an ISIN change with no recorded split is a break (SHRIRAMFIN, Jan 2025: split missing from NSE\'s file)', () => {
    const bars = [b('2025-01-09', 280985), b('2025-01-10', 56600, 'INE721A01047')];
    const br = findBreaks(bars, adjustedCandles(bars, []), [], []);
    expect(br).toHaveLength(1);
    expect(br[0].date).toBe('2025-01-10');
    expect(br[0].reason).toMatch(/ISIN changed INE721A01013 → INE721A01047 with no recorded split/);
    expect(br[0].reason).toMatch(/opening gap −?-?79\.9%/);
  });
  it('a recorded split on the ISIN-change day is adjusted, so no break', () => {
    const bars = [b('2025-01-09', 280985), b('2025-01-10', 56600, 'INE721A01047')];
    const { adjustments } = findAdjustments(bars, [{ symbol: 'SHRIRAMFIN', exDate: '2025-01-10', purpose: 'FV SPLT FRM RS 10 TO RS 2' }]);
    expect(findBreaks(bars, adjustedCandles(bars, adjustments), adjustments, [])).toEqual([]);
  });
  it('an action we cannot adjust is a break on its ex-date', () => {
    const bars = [b('2024-11-21', 10000), b('2024-11-22', 9800)];
    const br = findBreaks(bars, adjustedCandles(bars, []), [], [{ symbol: 'SHRIRAMFIN', exDate: '2024-11-22', purpose: 'CAPITAL REDUCTION', reason: 'x' }]);
    expect(br).toEqual([{ date: '2024-11-22', reason: 'not adjusted: CAPITAL REDUCTION' }]);
  });
});
