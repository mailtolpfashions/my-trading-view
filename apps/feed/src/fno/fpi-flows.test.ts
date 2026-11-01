import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNsdlDailyTrends } from './fpi-flows';

// NSDL's Daily Trends page as published for 30 Oct 2026.
const html = readFileSync(path.join(import.meta.dirname, 'fixtures', 'nsdl_fpi_latest_30-Oct-2026.html'), 'utf8');

describe('NSDL FPI daily trends', () => {
  const day = parseNsdlDailyTrends(html);
  it('reads the reporting date and the USD/INR rate', () => {
    expect(day.reportDate).toBe('2026-10-30');
    expect(day.usdInr).toBe('95.3688');
  });
  it('reads equity flows, with bracketed amounts as negative', () => {
    expect(day.rows.find((r) => r.category === 'Equity' && r.route === 'Stock Exchange')).toEqual({ category: 'Equity', route: 'Stock Exchange', purchaseCr: '13626.03', salesCr: '14438.76', netCr: '-812.73', netUsdMn: '-85.22' });
    expect(day.rows.find((r) => r.category === 'Equity' && r.route === 'Sub-total')!.netCr).toBe('-802.91');
    expect(day.rows.find((r) => r.category === 'Mutual Funds' && r.route === 'Equity schemes')!.netCr).toBe('8.83');
    expect(day.rows.find((r) => r.category === 'Total')).toMatchObject({ purchaseCr: '14817.34', salesCr: '14940.67', netCr: '-123.33' });
  });
  it('carries each category across its rows and fails loudly on a layout change', () => {
    expect(new Set(day.rows.map((r) => r.category))).toEqual(new Set(['Equity', 'Debt-General Limit', 'Debt-VRR', 'Debt-FAR', 'Hybrid', 'Mutual Funds', 'AIFs', 'Total']));
    expect(day.rows).toHaveLength(25);
    expect(() => parseNsdlDailyTrends(html.replace('Daily Trends in FPI Investments on', 'FPI Trends for'))).toThrow(/format changed/);
  });
});
