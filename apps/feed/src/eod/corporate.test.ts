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
    expect(parsePurpose('FV SPLT FRM RS 5 TO RE 1')).toEqual([{ kind: 'adjust', type: 'split', factor: 0.2 }]);
    expect(parsePurpose('FVSPLT FRM RS 10 TO RS 2')).toEqual([{ kind: 'adjust', type: 'split', factor: 0.2 }]);
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
  it('rights, demergers and unknown wording are flagged, never guessed', () => {
    for (const p of ['RIGHTS 1:5 @ PREMIUM RS 90', 'DEMERGER', 'CAPITAL REDUCTION', 'SOMETHING NEW', 'BONUS', 'FV SPLIT']) {
      expect(parsePurpose(p).some((x) => x.kind === 'unhandled'), p).toBe(true);
    }
  });
});
