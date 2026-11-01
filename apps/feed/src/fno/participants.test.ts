import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseParticipants, participantUrl } from './participants';

// Real NSE files (content/nsccl), as downloaded.
const fixture = (name: string) => readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('NSE participant-wise OI and volume files', () => {
  it('builds the archive URL', () => {
    expect(participantUrl('oi', '2026-10-23')).toBe('https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_23102026.csv');
    expect(participantUrl('vol', '2012-01-02')).toBe('https://nsearchives.nseindia.com/content/nsccl/fao_participant_vol_02012012.csv');
  });
  it('reads the 2012 layout (CLIENT_TYPE header, "FII " with a trailing space)', () => {
    const rows = parseParticipants(fixture('fao_participant_oi_02012012.csv')).rows;
    expect(rows.map((r) => r.participant)).toEqual(['Client', 'DII', 'FII', 'Pro']);
    expect(rows.find((r) => r.participant === 'FII')).toMatchObject({ futIdxLong: 55396, futIdxShort: 1387, totalLong: 232886, totalShort: 30187 });
  });
  it('reads 2018 and 2026 files, OI and volume, with column names that carry stray spaces', () => {
    expect(parseParticipants(fixture('fao_participant_oi_01022018.csv')).rows.find((r) => r.participant === 'FII')).toMatchObject({ futIdxLong: 147711, futIdxShort: 60897 });
    const oi = parseParticipants(fixture('fao_participant_oi_23102026.csv')).rows;
    expect(oi.find((r) => r.participant === 'Client')).toMatchObject({ futIdxLong: 277991, futIdxShort: 62683, optIdxCallLong: 4389644 });
    expect(parseParticipants(fixture('fao_participant_vol_23102026.csv')).rows.find((r) => r.participant === 'Client')).toMatchObject({ optIdxPutLong: 37404279 });
  });
  it("keeps NSE's own one-contract long/short mismatch (1 Feb 2018) as published, with a note", () => {
    expect(parseParticipants(fixture('fao_participant_oi_01022018.csv')).notes).toEqual([
      'NSE TOTAL OPTION INDEX CALL LONG vs OPTION INDEX CALL SHORT: 958717 ≠ 958716',
      'NSE TOTAL TOTAL LONG CONTRACTS vs TOTAL SHORT CONTRACTS: 4693800 ≠ 4693799',
    ]);
    expect(parseParticipants(fixture('fao_participant_oi_23102026.csv')).notes).toContain('OPTION INDEX CALL LONG participants sum vs NSE TOTAL: 6820618 ≠ 6820617');
  });
  it('fails loudly when totals do not add up or a column is renamed', () => {
    const csv = fixture('fao_participant_oi_01022018.csv');
    expect(() => parseParticipants(csv.replace('Client,200121', 'Client,200221'))).toThrow(/inconsistent totals/);
    expect(() => parseParticipants(csv.replace('Future Index Long', 'Index Futures Long'))).toThrow(/format changed/);
    expect(() => parseParticipants(csv.replace(/^DII,.*$/m, ''))).toThrow(/no DII row|inconsistent totals/);
  });
});
