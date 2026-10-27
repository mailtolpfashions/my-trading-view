// Runs the published signal strategies over every NSE stock each evening, after NSE's official files are saved:
// records that evening's new signals (append-only, timestamped) and recomputes each strategy's record.
//
// Honesty rules:
// - Backtests use every stock in the history, including ones since delisted, with a liquidity filter measured on
//   each day's own data, so there is no survivorship or look-ahead in which stocks qualify.
// - The live record counts only signals that were stored before the session they act on opened. A signal issued
//   late (e.g. the server was down that evening) is shown but kept out of the live record.

import { createHash } from 'node:crypto';
import { prisma } from '@mtv/db';
import { BacktestError, runBacktest } from '@mtv/backtest';
import { allEodSymbols, dailyHistory, eodLatestDate, lastRawBar } from '../eod/store';
import { SIGNAL_DEFINITIONS, type SignalDefinition } from './definitions';
import { istDate, signalStats, toSignalTrades, type SignalStats, type SignalTrade } from './stats';

const MIN_BARS = 260; // a year of history before a stock is scanned

/** Key order is fixed so the hash only changes when the rules do. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const rulesHash = (rules: unknown) => createHash('sha256').update(stableJson(rules)).digest('hex');

type StrategyState = {
  def: SignalDefinition;
  id: string;
  publishedAt: Date | null;
  /** Set when the strategy cannot run (e.g. its rules changed without a new version). */
  problem: string | null;
  trades: SignalTrade[];
  backtest: SignalStats | null;
  live: SignalStats | null;
  computedFor: string | null;
};

const state = new Map<string, StrategyState>();
let computing = false;

/** Publishes new strategy versions and checks that already-published rules are unchanged. */
export async function publishStrategies(log: (m: string) => void) {
  for (const def of SIGNAL_DEFINITIONS) {
    const id = `${def.slug}@${def.version}`;
    const hash = rulesHash(def.rules);
    let row = await prisma.signalStrategy.findUnique({ where: { id } });
    if (!row) {
      row = await prisma.signalStrategy.create({ data: { id, slug: def.slug, version: def.version, name: def.name, description: def.description, rules: JSON.parse(JSON.stringify(def.rules)), rulesHash: hash } });
      log(`Signals: published ${id}`);
    }
    const problem = row.rulesHash !== hash ? `Rules for ${id} differ from what was published on ${row.publishedAt.toISOString().slice(0, 10)}. Publish the change as version ${def.version + 1}.` : null;
    if (problem) log(`Signals: ${problem}`);
    state.set(id, { def, id, publishedAt: row.publishedAt, problem, trades: [], backtest: null, live: null, computedFor: null });
  }
}

/** Runs every strategy over every stock, issues the latest session's signals, and refreshes the records. */
export async function runSignals(log: (m: string) => void) {
  const date = eodLatestDate();
  if (computing || !date) return;
  computing = true;
  const started = Date.now();
  try {
    const active = [...state.values()].filter((s) => !s.problem);
    const fresh = new Map<string, { trades: SignalTrade[]; issues: { symbol: string; action: 'ENTER' | 'EXIT'; closePaise: number }[] }>(active.map((s) => [s.id, { trades: [], issues: [] }]));
    const issuedEntries = await loadIssuedEntries();
    const symbols = allEodSymbols();
    for (let n = 0; n < symbols.length; n++) {
      if (n % 100 === 0) await new Promise((r) => setImmediate(r)); // keep the price feed responsive
      const symbol = symbols[n];
      const h = dailyHistory(symbol);
      if (!h || h.candles.length < MIN_BARS) continue;
      const tradedToday = h.to === date;
      for (const s of active) {
        let r;
        try { r = runBacktest(h.candles, 'D', s.def.rules); } catch (e) { if (e instanceof BacktestError) continue; throw e; }
        const publishedDay = istDate(s.publishedAt!.getTime() / 1000); // IST trading date, not UTC
        const isLive = (signalDate: string, entryTime: number) => {
          const at = issuedEntries.get(`${s.id}|${signalDate}|${symbol}`);
          return signalDate >= publishedDay && !!at && at.getTime() < entryTime * 1000;
        };
        const out = fresh.get(s.id)!;
        out.trades.push(...toSignalTrades(symbol, h.candles, r.trades, isLive));
        if (tradedToday && r.nextAction) out.issues.push({ symbol, action: r.nextAction === 'enter' ? 'ENTER' : 'EXIT', closePaise: lastRawBar(symbol)!.closePaise });
      }
    }
    for (const s of active) {
      const { trades, issues } = fresh.get(s.id)!;
      if (issues.length) {
        const res = await prisma.signalIssue.createMany({ data: issues.map((i) => ({ strategyId: s.id, date, ...i })), skipDuplicates: true });
        if (res.count) log(`Signals ${s.id}: ${res.count} new for ${date}`);
      }
      s.trades = trades;
      s.backtest = signalStats(trades.filter((t) => !t.live));
      s.live = signalStats(trades.filter((t) => t.live));
      s.computedFor = date;
    }
    log(`Signals computed for ${date} over ${symbols.length} stocks in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  } finally {
    computing = false;
  }
}

async function loadIssuedEntries() {
  const rows = await prisma.signalIssue.findMany({ where: { action: 'ENTER' }, select: { strategyId: true, date: true, symbol: true, issuedAt: true } });
  return new Map(rows.map((r) => [`${r.strategyId}|${r.date}|${r.symbol}`, r.issuedAt]));
}

// ---- reading ----

export function signalsOverview() {
  return [...state.values()].map((s) => ({
    id: s.id, slug: s.def.slug, version: s.def.version, name: s.def.name, description: s.def.description,
    publishedAt: s.publishedAt, publishedDay: s.publishedAt ? istDate(s.publishedAt.getTime() / 1000) : null, problem: s.problem, computedFor: s.computedFor, backtest: s.backtest, live: s.live,
    openPositions: s.trades.filter((t) => t.exitReason === 'open').length,
  }));
}

export async function signalDetail(id: string) {
  const s = state.get(id);
  if (!s) return null;
  const issues = await prisma.signalIssue.findMany({ where: { strategyId: id }, orderBy: [{ date: 'desc' }, { symbol: 'asc' }], take: 200 });
  const recent = [...s.trades].sort((a, b) => (a.signalDate < b.signalDate ? 1 : -1)).slice(0, 200);
  return {
    ...signalsOverview().find((o) => o.id === id)!,
    rules: s.def.rules,
    rulesHash: rulesHash(s.def.rules),
    open: s.trades.filter((t) => t.exitReason === 'open').sort((a, b) => (a.signalDate < b.signalDate ? 1 : -1)),
    recent,
    issues: issues.map((i) => ({ date: i.date, symbol: i.symbol, action: i.action, close: i.closePaise / 100, issuedAt: i.issuedAt })),
  };
}

/** Signals issued for the latest session, across strategies (what a user sees "today"). */
export async function latestSignals() {
  const date = eodLatestDate();
  if (!date) return { date: null, signals: [] };
  const rows = await prisma.signalIssue.findMany({ where: { date }, orderBy: [{ strategyId: 'asc' }, { symbol: 'asc' }], include: { strategy: { select: { name: true } } } });
  return { date, signals: rows.map((r) => ({ strategyId: r.strategyId, strategy: r.strategy.name, symbol: r.symbol, action: r.action, close: r.closePaise / 100, issuedAt: r.issuedAt })) };
}
