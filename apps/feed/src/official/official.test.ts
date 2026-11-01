import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { bhavcopyUrl, indexCloseUrl, parseBhavcopy, parseIndexClose, recentWeekdays, splitCsvLine, unzipFirstCsv, canonicalIndexName, parsePdIndices } from './nse-files';

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

describe('older NSE index files (2011–2016)', () => {
  it('maps old index names to today\'s, so one series never splits in two', () => {
    expect(canonicalIndexName('S&P CNX Nifty')).toBe('NIFTY 50');
    expect(canonicalIndexName('CNX Nifty')).toBe('NIFTY 50');
    expect(canonicalIndexName('Nifty 50')).toBe('NIFTY 50');
    expect(canonicalIndexName('BANK Nifty')).toBe('NIFTY BANK');
    expect(canonicalIndexName('CNX Bank')).toBe('NIFTY BANK');
    expect(canonicalIndexName('CNX Nifty Junior')).toBe('NIFTY NEXT 50');
    expect(canonicalIndexName('CNX Midcap')).toBe('NIFTY MIDCAP 100');
    expect(canonicalIndexName('CNX IT')).toBe('NIFTY IT');
    expect(canonicalIndexName('S&P CNX 500')).toBe('NIFTY 500');
    expect(canonicalIndexName('INDIA VIX')).toBe('INDIA VIX');
  });
  it('reads index OHLC from the PR bundle Pd file (Pd030111.csv)', () => {
    const pd = [
      'MKT,SERIES,SYMBOL,SECURITY,PREV_CL_PR,OPEN_PRICE,HIGH_PRICE,LOW_PRICE,CLOSE_PRICE,NET_TRDVAL,NET_TRDQTY,IND_SEC,CORP_IND,TRADES,HI_52_WK,LO_52_WK',
      'Y, , ,S&P CNX Nifty,      6134.50,      6177.45,      6178.55,      6147.20,      6157.60,107387732141.67,615343104,Y, ,5402800,      6338.50,      4675.40',
      'Y, , ,BANK Nifty,     11791.45,     11882.10,     11912.15,     11826.95,     11855.75,0,0,Y, ,0,     13303.60,      8150.45',
      ' , , ,S&P CNX NIFTY Sec, , , , , , , ,Y, , , , ',
      'N,EQ,JUNIORBEES,NIFTY JR BENCHMARK ETF,       122.10,       123.00,       123.80,       121.40,       121.84,6660483.91,54385,N, ,296,148.00,96.01',
    ].join('\n');
    const m = parsePdIndices(pd);
    expect([...m.keys()]).toEqual(['NIFTY 50', 'NIFTY BANK']);
    expect(m.get('NIFTY 50')).toEqual({ open: 6177.45, high: 6178.55, low: 6147.2, close: 6157.6 });
  });
});
