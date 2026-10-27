// NSE's official corporate-action file ("Bc", inside the daily PR bundle): record and ex-dates with a free-text
// purpose. Each day's file covers a window of recent and upcoming ex-dates, so reading it daily misses nothing.
//
// Price adjustment follows TradingView's default (splits and bonuses; not dividends):
// - BONUS a:b            → a new shares per b held → factor b / (a + b)
// - Face-value split     → "FROM RS x TO RS y"   → factor y / x
// - Consolidation        → "FROM RS x TO RS y"   → factor y / x (> 1)
// Rights issues, demergers, capital reductions and anything not recognised are reported as unhandled, never guessed.

import { splitCsvLine } from '../official/nse-files';

export const prBundleUrl = (date: string) => {
  const [y, m, d] = date.split('-');
  return `https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR${d}${m}${y.slice(2)}.zip`;
};

/** The corporate-action file inside a PR bundle: Bc281024.csv (older bundles) or bc23102026.csv (newer). */
export const findBcFile = (names: string[]) => names.find((f) => /(^|\/)bc\d{6}(\d{2})?\.csv$/i.test(f));

export type CorporateActionRow = { symbol: string; series: string; exDate: string; recordDate: string | null; purpose: string };

const isoDate = (s: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Parses Bc{DDMMYY}.csv. Rows without an ex-date (e.g. AGM notices) are skipped. */
export function parseBc(csv: string): CorporateActionRow[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const header = splitCsvLine(lines[0] ?? '').map((h) => h.trim().toUpperCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`NSE corporate action file format changed: column "${name}" not found`);
    return i;
  };
  const [sym, ser, rec, ex, pur] = ['SYMBOL', 'SERIES', 'RECORD_DT', 'EX_DT', 'PURPOSE'].map(col);
  const out: CorporateActionRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const exDate = isoDate(c[ex] ?? '');
    const symbol = (c[sym] ?? '').trim();
    if (!exDate || !symbol) continue;
    out.push({ symbol, series: (c[ser] ?? '').trim(), exDate, recordDate: isoDate(c[rec] ?? ''), purpose: (c[pur] ?? '').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

export type ParsedAction =
  | { kind: 'adjust'; type: 'bonus' | 'split' | 'consolidation'; factor: number }
  | { kind: 'ignore' }
  | { kind: 'unhandled'; reason: string };

const IGNORE = /DIV|DISTRIB|INTEREST|\bINT PAYMENT|\bAGM\b|ANNUAL GENERAL|\bEGM\b|REDEMPTION|\bSTP\b|BUY ?BACK|MERGER|AMALGAMATION|ELECTION|BOOK CLOSURE/;
const FROM_TO = /(?:RS|RE)\.?\s*([\d.]+)\/?-?\s*(?:PER SHARE\s*)?(?:TO|-)\s*(?:RS|RE)\.?\s*([\d.]+)/;

/** Interprets one PURPOSE text. Several purposes can be joined with "/" (e.g. "BONUS 1:1/DIVIDEND"): each part counts. */
export function parsePurpose(purpose: string): ParsedAction[] {
  return purpose.toUpperCase().split(/\s*\/(?=\s*[A-Z])\s*|\s+AND\s+/).filter(Boolean).map(parsePart);
}

function parsePart(p: string): ParsedAction {
  const bonus = /BONUS\s*(\d+)\s*:\s*(\d+)/.exec(p);
  if (bonus) {
    const [a, b] = [Number(bonus[1]), Number(bonus[2])];
    return a > 0 && b > 0 ? { kind: 'adjust', type: 'bonus', factor: b / (a + b) } : { kind: 'unhandled', reason: `bonus ratio unreadable: ${p}` };
  }
  if (/BONUS/.test(p)) return { kind: 'unhandled', reason: `bonus ratio missing: ${p}` };
  const isSplit = /F\.?\s*V\.?\s*SP?LI?T|FVSPLT|SPLIT|SUB-?DIVISION/.test(p);
  const isConsolidation = /CONSOLIDAT/.test(p);
  if (isSplit || isConsolidation) {
    const m = FROM_TO.exec(p);
    const [from, to] = m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
    if (!(from > 0 && to > 0) || from === to) return { kind: 'unhandled', reason: `face values unreadable: ${p}` };
    if (isSplit && to > from) return { kind: 'unhandled', reason: `split that increases face value: ${p}` };
    return { kind: 'adjust', type: to < from ? 'split' : 'consolidation', factor: to / from };
  }
  if (/RIGHT|DEMERGER|DE-MERGER|CAPITAL REDUCTION|REDUCTION OF CAPITAL|ARRANGEMENT|SPIN/.test(p)) return { kind: 'unhandled', reason: `not adjusted (price impact depends on terms): ${p}` };
  if (IGNORE.test(p)) return { kind: 'ignore' };
  return { kind: 'unhandled', reason: `unrecognised purpose: ${p}` };
}
