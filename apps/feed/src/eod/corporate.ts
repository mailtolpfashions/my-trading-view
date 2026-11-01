// NSE's official corporate-action file ("Bc", inside the daily PR bundle): record and ex-dates with a free-text
// purpose. Each day's file covers a window of recent and upcoming ex-dates, so reading it daily misses nothing.
//
// Price adjustment follows TradingView's default (splits and bonuses; not dividends):
// - BONUS a:b            → a new shares per b held → factor b / (a + b)
// - Face-value split     → "FROM RS x TO RS y"   → factor y / x
// - Consolidation        → "FROM RS x TO RS y"   → factor y / x (> 1)
// - RIGHTS a:b @ PRM RS x → NSE's own method for adjusting F&O contracts: issue price S = face value + premium,
//                            P = close on the last cum-rights day, benefit E = (P − S)·a/(a+b), factor (P − E)/P,
//                            i.e. the theoretical ex-rights price ÷ P. No benefit (S ≥ P) → no adjustment.
// Calls on partly-paid shares (FIRST CALL …) do not change the fully-paid share and are ignored.
// Rights without a price, demergers, capital reductions and anything not recognised are reported as unhandled,
// never guessed.

import { splitCsvLine } from '../official/nse-files';

export const prBundleUrl = (date: string) => {
  const [y, m, d] = date.split('-');
  return `https://nsearchives.nseindia.com/archives/equities/bhavcopy/pr/PR${d}${m}${y.slice(2)}.zip`;
};

/** The corporate-action file inside a PR bundle: Bc281024.csv (older bundles) or bc23102026.csv (newer). */
export const findBcFile = (names: string[]) => names.find((f) => /(^|\/)bc\d{6}(\d{2})?\.csv$/i.test(f));

export type CorporateActionRow = { symbol: string; series: string; exDate: string; recordDate: string | null; purpose: string };

/** NSE dates: DD/MM/YYYY (files until Oct 2025) or YYYY-MM-DD (since). */
const isoDate = (s: string): string | null => {
  const t = s.trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

/**
 * Parses NSE's Bc file. Rows without an ex-date (e.g. AGM notices) are skipped, but a file whose rows have ex-dates we
 * cannot read is a format change and throws: NSE switched date formats in Oct 2025 and a silent skip lost a year.
 */
export function parseBc(csv: string): CorporateActionRow[] {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return []; // NSE publishes an empty file on days with no actions
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toUpperCase());
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`NSE corporate action file format changed: column "${name}" not found`);
    return i;
  };
  const [sym, ser, rec, ex, pur] = ['SYMBOL', 'SERIES', 'RECORD_DT', 'EX_DT', 'PURPOSE'].map(col);
  const out: CorporateActionRow[] = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const rawEx = (c[ex] ?? '').trim();
    const exDate = isoDate(rawEx);
    const symbol = (c[sym] ?? '').trim();
    if (rawEx && !exDate) throw new Error(`NSE corporate action file format changed: ex-date "${rawEx}" not understood`);
    if (!exDate || !symbol) continue;
    out.push({ symbol, series: (c[ser] ?? '').trim(), exDate, recordDate: isoDate(c[rec] ?? ''), purpose: (c[pur] ?? '').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

export type ParsedAction =
  | { kind: 'adjust'; type: 'bonus'; factor: number }
  | { kind: 'adjust'; type: 'split' | 'consolidation'; factor: number; fromFv: number; toFv: number }
  /** a new shares for every b held, at face value + premium (rupees); the factor needs the cum price and face value. */
  | { kind: 'rights'; newShares: number; held: number; premium: number }
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
    return { kind: 'adjust', type: to < from ? 'split' : 'consolidation', factor: to / from, fromFv: from, toFv: to };
  }
  const rights = /RIGHTS?\s*(\d+)\s*:\s*(\d+)\s*@?\s*(?:PREMIUM|PRM)\s*(?:RS|RE)?\.?\s*([\d.]+)/.exec(p);
  if (rights) {
    const [a, b, prem] = [Number(rights[1]), Number(rights[2]), Number(rights[3])];
    return a > 0 && b > 0 && prem >= 0 ? { kind: 'rights', newShares: a, held: b, premium: prem } : { kind: 'unhandled', reason: `rights terms unreadable: ${p}` };
  }
  if (/RIGHT/.test(p)) return { kind: 'unhandled', reason: `rights issue without a price: ${p}` };
  if (/\bCALL\b|FIRST CL\b/.test(p)) return { kind: 'ignore' }; // call money on partly-paid shares (a separate security)
  if (/DEMERGER|DE-MERGER|CAPITAL REDUCTION|REDUCTION OF CAPITAL|ARRANGEMENT|SPIN/.test(p)) return { kind: 'unhandled', reason: `not adjusted (price impact depends on terms): ${p}` };
  if (IGNORE.test(p)) return { kind: 'ignore' };
  return { kind: 'unhandled', reason: `unrecognised purpose: ${p}` };
}
