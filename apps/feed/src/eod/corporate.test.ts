import { describe, expect, it } from 'vitest';
import { findBcFile, parseBc, parsePurpose, prBundleUrl } from './corporate';

// Lines exactly as published in NSE's Bc281024.csv (28 Oct 2024).
const BC = [
  'SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE',
  'BE,RELIANCE,RELIANCE IND - DEPO SETT.,28/10/2024, , ,28/10/2024, , ,BONUS 1:1                ',
  'EQ,RELIANCE,Reliance Industries Ltd,28/10/2024, , ,28/10/2024, , ,BONUS 1:1                ',
  'EQ,XYZ,Xyz Ltd, , , , , , ,ANNUAL GENERAL MEETING',
].join('\n');

describe('NSE corporate action file', () => {
  it('reads ex-dates and purposes, skipping rows without an ex-date', () => {
    expect(parseBc(BC)).toEqual([
      { symbol: 'RELIANCE', series: 'BE', exDate: '2024-10-28', recordDate: '2024-10-28', purpose: 'BONUS 1:1' },
      { symbol: 'RELIANCE', series: 'EQ', exDate: '2024-10-28', recordDate: '2024-10-28', purpose: 'BONUS 1:1' },
    ]);
  });
  it('fails loudly on a format change', () => expect(() => parseBc('SYMBOL,PURPOSE\nX,BONUS 1:1')).toThrow(/format changed/));
  it('reads the ISO dates NSE has used since Oct 2025 (bc26102026.csv)', () => {
    const csv = 'SERIES,SYMBOL,SECURITY,RECORD_DT,BC_STRT_DT,BC_END_DT,EX_DT,ND_STRT_DT,ND_END_DT,PURPOSE\nEQ,ABC,ABC Ltd,2026-10-27,,,2026-10-27,,,BONUS 1:1';
    expect(parseBc(csv)).toEqual([{ symbol: 'ABC', series: 'EQ', exDate: '2026-10-27', recordDate: '2026-10-27', purpose: 'BONUS 1:1' }]);
  });
  it('throws on an ex-date it cannot read instead of skipping the row', () => {
    expect(() => parseBc('SERIES,SYMBOL,RECORD_DT,EX_DT,PURPOSE\nEQ,ABC,,27-Oct-2026,BONUS 1:1')).toThrow(/ex-date "27-Oct-2026"/);
  });
  it('an empty file (a day with no actions, e.g. Bc100122.csv) means no actions', () => {
    expect(parseBc('')).toEqual([]);
    expect(parseBc('\r\n')).toEqual([]);
  });
  it('uses the PR bundle for the date', () => expect(prBundleUrl('2024-10-28')).toBe('https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR281024.zip'));
  it('finds the corporate action file under both of NSE\'s file names', () => {
    expect(findBcFile(['An281024.txt', 'Bc281024.csv', 'bh281024.csv'])).toBe('Bc281024.csv');
    expect(findBcFile(['an23102026.txt', 'bc23102026.csv', 'bh23102026.csv'])).toBe('bc23102026.csv');
    expect(findBcFile(['bh23102026.csv', 'bm23102026.txt'])).toBeUndefined();
  });
});

describe('corporate action purposes (wording as NSE publishes it)', () => {
  const adj = (p: string) => parsePurpose(p).filter((x) => x.kind === 'adjust');
  it('bonus a:b gives b/(a+b)', () => {
    expect(parsePurpose('BONUS 1:1')).toEqual([{ kind: 'adjust', type: 'bonus', factor: 0.5 }]);
    expect(adj('BONUS 3:2')[0]).toMatchObject({ factor: 2 / 5 });
  });
  it('face-value splits in their various spellings', () => {
    expect(parsePurpose('FV SPLT FRM RS 5 TO RE 1')).toEqual([{ kind: 'adjust', type: 'split', factor: 0.2, fromFv: 5, toFv: 1 }]);
    expect(parsePurpose('FVSPLT FRM RS 10 TO RS 2')).toEqual([{ kind: 'adjust', type: 'split', factor: 0.2, fromFv: 10, toFv: 2 }]);
    expect(adj('FACE VALUE SPLIT (SUB-DIVISION) - FROM RS 10/- PER SHARE TO RS 2/- PER SHARE')[0]).toMatchObject({ type: 'split', factor: 0.2 });
  });
  it('consolidation raises the factor above 1', () => {
    expect(adj('CONSOLIDATION OF SHARES FROM RE 1 TO RS 10')[0]).toMatchObject({ type: 'consolidation', factor: 10 });
  });
  it('dividends, interest, meetings and distributions do not adjust prices', () => {
    for (const p of ['INTDIV - RE 0.50 PER SH', 'DIV//DISTRIBU-RS 5.15', 'DIV/STP', 'ANNUAL GENERAL MEETING', 'EGM', 'MERGER', 'DIV/DISTRIB - RS 3.75', 'INT PAYMENT/REDEMPTION']) {
      expect(parsePurpose(p).every((x) => x.kind === 'ignore'), p).toBe(true);
    }
  });
  it('a bonus together with a dividend still adjusts once', () => {
    expect(adj('BONUS 1:1/INTERIM DIVIDEND - RS 5 PER SHARE')).toEqual([{ kind: 'adjust', type: 'bonus', factor: 0.5 }]);
  });
  it("rights terms are read in NSE's spellings; calls on partly-paid shares are ignored", () => {
    expect(parsePurpose('RIGHTS 3:25@PRM RS 1799')).toEqual([{ kind: 'rights', newShares: 3, held: 25, premium: 1799 }]);
    expect(parsePurpose('RIGHTS 12:25 @PRMRS 0.60')).toEqual([{ kind: 'rights', newShares: 12, held: 25, premium: 0.6 }]);
    expect(parsePurpose('RIGHTS1:1 @PRM RS 1.30/-')).toEqual([{ kind: 'rights', newShares: 1, held: 1, premium: 1.3 }]);
    expect(parsePurpose('RIGHTS 7:50 @PRM RS125/-')).toEqual([{ kind: 'rights', newShares: 7, held: 50, premium: 125 }]);
    expect(parsePurpose('RIGHTS 1:1 @ PRM RE 1/-')).toEqual([{ kind: 'rights', newShares: 1, held: 1, premium: 1 }]);
    expect(parsePurpose('RIGHTS 1:5 @ PREMIUM RS 90')).toEqual([{ kind: 'rights', newShares: 1, held: 5, premium: 90 }]);
    for (const p of ['FIRST CL RS 450 PR SH', 'FST&FNL CALL - RS 0.80', 'SCND&FNL CALL - RS 5']) expect(parsePurpose(p), p).toEqual([{ kind: 'ignore' }]);
  });
  it('rights without a price, demergers and unknown wording are flagged, never guessed', () => {
    for (const p of ['RIGHTS 1:1', 'RIGHTS 10:63', 'DEMERGER', 'CAPITAL REDUCTION', 'SOMETHING NEW', 'BONUS', 'FV SPLIT']) {
      expect(parsePurpose(p).some((x) => x.kind === 'unhandled'), p).toBe(true);
    }
  });
});
