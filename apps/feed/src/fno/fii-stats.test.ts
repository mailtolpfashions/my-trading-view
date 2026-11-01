import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readXlsFirstSheet } from '../official/xls';
import { fiiStatsUrl, parseFiiStats } from './fii-stats';

// Real NSE files (content/fo), as downloaded: old-format Excel workbooks.
const grid = (name: string) => readXlsFirstSheet(new Uint8Array(readFileSync(path.join(import.meta.dirname, 'fixtures', name))));

describe('NSE FII derivatives statistics', () => {
  it('builds the archive URL', () => {
    expect(fiiStatsUrl('2026-10-23')).toBe('https://nsearchives.nseindia.com/content/fo/fii_stats_23-Oct-2026.xls');
    expect(fiiStatsUrl('2018-02-01')).toBe('https://nsearchives.nseindia.com/content/fo/fii_stats_01-Feb-2018.xls');
  });
  it('reads the 2026 file: totals and per-index rows, amounts kept as published', () => {
    const rows = parseFiiStats(grid('fii_stats_23-Oct-2026.xls'), '2026-10-23');
    expect(rows.find((r) => r.segment === 'INDEX FUTURES')).toEqual({ segment: 'INDEX FUTURES', buyContracts: 83398, buyCr: '12797.11', sellContracts: 83281, sellCr: '12833.46', oiContracts: 354155, oiCr: '53450.26' });
    expect(rows.find((r) => r.segment === 'NIFTY OPTIONS')).toMatchObject({ buyContracts: 9966999, oiContracts: 3438362 });
    expect(rows.map((r) => r.segment)).toContain('BANKNIFTY FUTURES');
    expect(rows).toHaveLength(16);
  });
  it('reads the 2018 file (four totals only, amounts with 4 decimals)', () => {
    const rows = parseFiiStats(grid('fii_stats_01-Feb-2018.xls'), '2018-02-01');
    expect(rows.map((r) => r.segment)).toEqual(['INDEX FUTURES', 'INDEX OPTIONS', 'STOCK FUTURES', 'STOCK OPTIONS']);
    expect(rows[0]).toMatchObject({ buyContracts: 53515, buyCr: '4789.1235', oiContracts: 208608, oiCr: '17628.8046' });
  });
  it('refuses a file for another date', () => {
    expect(() => parseFiiStats(grid('fii_stats_01-Feb-2018.xls'), '2018-02-02')).toThrow(/file is for 2018-02-01/);
  });
});
