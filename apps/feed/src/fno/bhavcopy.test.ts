import { describe, expect, it } from 'vitest';
import { deriveLotSize, fnoBhavcopyUrl, parseOldFo, parseUdiffFo } from './bhavcopy';

// Headers, the NIFTY 20150 CE / NOV FUT rows (23 Oct 2026, UDiFF) and the NIFTY rows of 23 Jun 2023 (old layout) are
// copied from NSE's real files. The NIFTY 22600 PE and the stock rows are constructed to test traded contracts and
// filtering.
const UDIFF = [
  'TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol,TtlTrfVal,TtlNbOfTxsExctd,SsnId,NewBrdLotQty,Rmks,Rsvd1,Rsvd2,Rsvd3,Rsvd4',
  '2026-10-23,2026-10-23,FO,NSE,IDO,51216,,NIFTY,,2026-10-27,2026-10-27,20150.00,CE,NIFTY26OCT20150CE,0.00,0.00,0.00,2553.25,2553.25,2553.25,22600.00,2462.69,0,0,0,0.00,0,F1,65,,,,,',
  '2026-10-23,2026-10-23,FO,NSE,IDO,51300,,NIFTY,,2026-10-27,2026-10-27,22600.00,PE,NIFTY26OCT22600PE,140.00,190.50,98.10,121.35,121.00,150.20,22600.00,121.35,5210430,812000,98765432,7.5E9,250000,F1,65,,,,,',
  '2026-10-23,2026-10-23,FO,NSE,IDF,61471,,NIFTY,,2026-11-23,2026-11-23,,,NIFTY26NOVFUT,22815.00,22922.60,22525.00,22661.30,22679.90,22801.50,22600.00,22661.30,8552310,2638740,64606,95173456306.50,39207,F1,65,,,,,',
  '2026-10-23,2026-10-23,FO,NSE,STO,70000,,RELIANCE,,2026-10-27,2026-10-27,1200.00,CE,RELIANCE26OCT1200CE,10,12,9,11,11,10,1190,11,100,0,10,1000,5,F1,500,,,,,',
].join('\n');
const OLD = [
  'INSTRUMENT,SYMBOL,EXPIRY_DT,STRIKE_PR,OPTION_TYP,OPEN,HIGH,LOW,CLOSE,SETTLE_PR,CONTRACTS,VAL_INLAKH,OPEN_INT,CHG_IN_OI,TIMESTAMP,',
  'OPTIDX,NIFTY,29-Jun-2023,8500,CE,0,0,0,1775,10175.35,0,0,15975,0,23-JUN-2023,',
  'FUTIDX,NIFTY,29-Jun-2023,0,XX,18789,18808.25,18690,18705.9,18705.9,129582,1213469.94,8531800,-1171800,23-JUN-2023,',
  'OPTSTK,RELIANCE,29-Jun-2023,2500,CE,10,12,9,11,11,5,10,100,0,23-JUN-2023,',
].join('\n');

describe('F&O bhavcopy', () => {
  it('builds the right archive URL for each layout', () => {
    expect(fnoBhavcopyUrl('2026-10-23')).toBe('https://nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_20261023_F_0000.csv.zip');
    expect(fnoBhavcopyUrl('2023-06-23')).toBe('https://nsearchives.nseindia.com/content/historical/DERIVATIVES/2023/JUN/fo23JUN2023bhav.csv.zip');
  });

  it('parses UDiFF index options and futures, with lot size and underlying price, ignoring stock F&O', () => {
    const d = parseUdiffFo(UDIFF, '2026-10-23');
    expect(d.rows).toHaveLength(3);
    expect(d.lotSize).toEqual({ NIFTY: 65 });
    expect(d.spot).toEqual({ NIFTY: 22600 });
    expect(d.rows[1]).toEqual({ underlying: 'NIFTY', kind: 'PE', expiry: '2026-10-27', strike: 22600, open: 140, high: 190.5, low: 98.1, close: 121.35, settle: 121.35, oi: 5210430, volume: 98765432, traded: true });
    expect(d.rows[2]).toMatchObject({ kind: 'FUT', strike: null, close: 22661.3, traded: true });
  });

  it('marks contracts with no trades as untraded, even though they carry a close', () => {
    const untraded = parseUdiffFo(UDIFF, '2026-10-23').rows[0];
    expect(untraded).toMatchObject({ strike: 20150, close: 2553.25, traded: false });
  });

  it('parses the old layout and derives the lot size from futures turnover', () => {
    const d = parseOldFo(OLD, '2023-06-23');
    expect(d.rows).toHaveLength(2);
    expect(d.rows[0]).toMatchObject({ kind: 'CE', expiry: '2023-06-29', strike: 8500, traded: false });
    // ₹12,13,469.94 lakh / (1,29,582 contracts × 18,705.9) = 50.06 -> lot 50 (NIFTY's lot size in June 2023)
    expect(d.lotSize.NIFTY).toBe(50);
    expect(d.spot.NIFTY).toBeNull();
  });

  it('derives a lot size only when exactly one known size fits', () => {
    expect(deriveLotSize(50.06 * 100 * 18705.9, 100, 18705.9)).toBe(50);
    expect(deriveLotSize(44 * 100 * 1000, 100, 1000)).toBeNull(); // between 40 and 50: ambiguous -> flagged
    expect(deriveLotSize(0, 0, 1000)).toBeNull();
  });

  it('fails loudly on a format change', () => {
    expect(() => parseUdiffFo('A,B,C\n1,2,3', '2026-10-23')).toThrow(/format changed/);
  });
});
