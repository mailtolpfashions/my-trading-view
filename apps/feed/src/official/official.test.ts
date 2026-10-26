import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { bhavcopyUrl, indexCloseUrl, parseBhavcopy, parseIndexClose, recentWeekdays, splitCsvLine, unzipFirstCsv } from './nse-files';
import { applyOfficial, isCorporateActionRatio, type DayRecord } from './store';

// Header layouts as published by NSE (index close file and the UDiFF cash-market bhavcopy).
const INDEX_CSV = [
  'Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield',
  'Nifty 50,26-10-2026,22610.15,22760.40,22387.35,22753.20,153.20,0.68,350000000,32000.5,21.5,3.6,1.2',
  'Nifty Bank,26-10-2026,54300.00,54500.10,54100.25,54366.70,79.35,0.15,-,-,-,-,-',
  'India VIX,26-10-2026,16.90,17.40,16.50,17.16,0.30,1.78,-,-,-,-,-',
].join('\n');
const BHAV_CSV = [
  'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4',
  '2026-10-26,2026-10-26,CM,NSE,STK,2885,INE002A01018,RELIANCE,EQ,,,,,"RELIANCE INDUSTRIES LTD",1192.00,1205.40,1188.10,1201.80,1201.60,1190.00,,1201.80,,,9876543,1186000000.00,250000,F1,1,,,,,',
  '2026-10-26,2026-10-26,CM,NSE,STK,9999,INE000000000,SOMEBOND,N1,,,,,"SOME BOND",100,101,99,100,100,100,,100,,,10,1000,1,F1,1,,,,,',
].join('\n');

describe('NSE file parsers', () => {
  it('builds archive URLs for a trade date', () => {
    expect(indexCloseUrl('2026-10-26')).toBe('https://nsearchives.nseindia.com/content/indices/ind_close_all_26102026.csv');
    expect(bhavcopyUrl('2026-10-26')).toBe('https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20261026_F_0000.csv.zip');
  });
  it('splits quoted CSV fields', () => {
    expect(splitCsvLine('a,"b, c","say ""hi""",d')).toEqual(['a', 'b, c', 'say "hi"', 'd']);
  });
  it('parses index closes by official name', () => {
    const m = parseIndexClose(INDEX_CSV);
    expect(m.get('NIFTY 50')).toEqual({ open: 22610.15, high: 22760.4, low: 22387.35, close: 22753.2 });
    expect(m.get('INDIA VIX')?.close).toBe(17.16);
  });
  it('parses the bhavcopy for EQ/BE series only, using the official close and total traded volume', () => {
    const m = parseBhavcopy(BHAV_CSV);
    expect(m.get('RELIANCE')).toEqual({ open: 1192, high: 1205.4, low: 1188.1, close: 1201.8, volume: 9876543 });
    expect(m.has('SOMEBOND')).toBe(false);
  });
  it('reads the CSV out of the bhavcopy zip', () => {
    const zip = zipSync({ 'BhavCopy_NSE_CM_0_0_0_20261026_F_0000.csv': strToU8(BHAV_CSV) });
    expect(parseBhavcopy(unzipFirstCsv(zip)).size).toBe(1);
  });
  it('fails loudly if NSE changes the format', () => {
    expect(() => parseBhavcopy('Symbol,Open,High\nRELIANCE,1,2')).toThrow(/format changed/);
  });
});

describe('recentWeekdays', () => {
  const at = (d: number, h: number) => Date.UTC(2026, 9, d, h, 0) / 1000 - 5.5 * 3600; // IST
  it('skips weekends and optionally today', () => {
    expect(recentWeekdays(at(26, 19), 3, true)).toEqual(['2026-10-26', '2026-10-23', '2026-10-22']); // Mon
    expect(recentWeekdays(at(26, 10), 2, false)).toEqual(['2026-10-23', '2026-10-22']);
  });
});

describe('applyOfficial', () => {
  const t = (d: number) => Date.UTC(2026, 9, d, 9, 15) / 1000 - 5.5 * 3600; // daily bars are stamped 09:15 IST
  const rec = (date: string, bars: DayRecord['bars']): DayRecord => ({ date, fetchedAt: '', bars });
  const store: Record<string, DayRecord> = {
    '2026-10-23': rec('2026-10-23', { RELIANCE: { open: 1180, high: 1192, low: 1175, close: 1190, volume: 5000 } }),
    '2026-10-26': rec('2026-10-26', { RELIANCE: { open: 1192, high: 1205.4, low: 1188.1, close: 1201.8, volume: 9000 } }),
  };
  const lookup = (d: string) => store[d];

  it('keeps matching bars, replaces differing ones with official values and lists what changed', () => {
    const ours = [
      { time: t(22), open: 1170, high: 1182, low: 1168, close: 1180, volume: 4000 }, // no official record
      { time: t(23), open: 1180, high: 1192, low: 1175, close: 1190, volume: 5000 }, // matches
      { time: t(26), open: 1192, high: 1205.4, low: 1188.1, close: 1201.6, volume: 8800 }, // close and volume differ
    ];
    const r = applyOfficial('RELIANCE', ours, lookup, ['2026-10-23', '2026-10-26']);
    expect(r.candles[0]).toBe(ours[0]);
    expect(r.candles[1]).toBe(ours[1]);
    expect(r.candles[2]).toEqual({ time: t(26), open: 1192, high: 1205.4, low: 1188.1, close: 1201.8, volume: 9000 });
    expect(r.official).toEqual({ verified: 2, corrected: [{ time: t(26), fields: ['close', 'volume'] }], adjusted: [], latest: '2026-10-26' });
  });
  it('adds official bars for dates the free source is missing, in time order', () => {
    const today = { time: t(27), open: 1200, high: 1210, low: 1195, close: 1205, volume: 100 };
    const r = applyOfficial('RELIANCE', [today], lookup, ['2026-10-23', '2026-10-26']);
    expect(r.candles.map((c) => c.time)).toEqual([t(23), t(26), t(27)]);
    expect(r.candles[0]).toMatchObject({ open: 1180, close: 1190, volume: 5000 });
    expect(r.official.corrected).toEqual([{ time: t(23), fields: ['added'] }, { time: t(26), fields: ['added'] }]);
    expect(r.official.verified).toBe(2);
  });
  it('does not add anything for a symbol NSE has no record of', () => {
    expect(applyOfficial('UNKNOWN', [], lookup, ['2026-10-23']).candles).toEqual([]);
  });
  it('keeps split/bonus-adjusted bars instead of overwriting them with the unadjusted NSE record', () => {
    // NSE record before a 1:1 bonus: 2380/2410/2360/2400; the free source now shows it halved
    const pre = { '2026-10-23': rec('2026-10-23', { XYZ: { open: 2380, high: 2410, low: 2360, close: 2400, volume: 1000 } }) };
    const ours = [{ time: t(23), open: 1190, high: 1205, low: 1180, close: 1200, volume: 2000 }];
    const r = applyOfficial('XYZ', ours, (d) => pre[d as keyof typeof pre], ['2026-10-23']);
    expect(r.candles[0]).toBe(ours[0]);
    expect(r.official).toMatchObject({ corrected: [], adjusted: [t(23)] });
  });
  it('still corrects a genuine error that is not a uniform ratio', () => {
    expect(isCorporateActionRatio({ open: 1180, high: 1192, low: 1175, close: 1150 }, { open: 1180, high: 1192, low: 1175, close: 1190 })).toBe(false);
    expect(isCorporateActionRatio({ open: 1180.5, high: 1192, low: 1175, close: 1190 }, { open: 1180, high: 1192, low: 1175, close: 1190 })).toBe(false);
  });
  it('ignores float noise below a paisa', () => {
    const r = applyOfficial('RELIANCE', [{ time: t(23), open: 1180.0000001, high: 1192, low: 1175, close: 1190, volume: 5000 }], lookup, ['2026-10-23']);
    expect(r.official.corrected).toEqual([]);
  });
});
