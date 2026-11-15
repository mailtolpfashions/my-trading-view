// One set of performance numbers for every strategy in the research programme, computed from a daily equity curve
// (rupees, one point per trading day) and a trade list. Used by the research scripts so that an option study, a stock
// portfolio and a combined book are measured the same way. Pure functions, no data access.

export type CurvePoint = { date: string; equity: number };
export type TradeLike = { entry: string; exit: string; net: number };

const DAY = 86_400_000;
const yearsBetween = (a: string, b: string) => Math.max((Date.parse(b) - Date.parse(a)) / (365.25 * DAY), 1 / 365.25);
const r2 = (x: number) => Math.round(x * 100) / 100;
const pct = (x: number) => Math.round(x * 10000) / 100;

export type Drawdown = {
  /** Deepest fall from a running peak, ₹ and % of that peak. */
  maxDd: number; maxDdPct: number;
  peakDate: string | null; troughDate: string | null;
  /** First date back at the old peak, or null if not recovered by the end. */
  recoveredDate: string | null;
  /** Trading days from peak to trough, and the longest spell under a previous peak (trading days). */
  deepestDays: number; longestUnderwaterDays: number;
};

export function drawdownOf(points: CurvePoint[]): Drawdown {
  let peak = points[0]?.equity ?? 0, peakAt = 0, maxDd = 0, maxDdPct = 0, from = 0, to = 0;
  let longest = 0, spell = 0;
  points.forEach((p, i) => {
    if (p.equity >= peak) { peak = p.equity; peakAt = i; spell = 0; } else { spell++; longest = Math.max(longest, spell); }
    const dd = peak - p.equity;
    if (dd > maxDd) { maxDd = dd; from = peakAt; to = i; }
    if (peak > 0) maxDdPct = Math.max(maxDdPct, (dd / peak) * 100);
  });
  let recovered: string | null = null;
  if (maxDd > 0) { const top = points[from].equity; for (let i = to + 1; i < points.length; i++) if (points[i].equity >= top) { recovered = points[i].date; break; } }
  return { maxDd: r2(maxDd), maxDdPct: r2(maxDdPct), peakDate: maxDd > 0 ? points[from].date : null, troughDate: maxDd > 0 ? points[to].date : null, recoveredDate: recovered, deepestDays: to - from, longestUnderwaterDays: longest };
}

export type CurveMetrics = {
  from: string; to: string; years: number; days: number;
  startEquity: number; endEquity: number; net: number;
  returnPct: number; cagrPct: number;
  sharpe: number | null; sortino: number | null; calmar: number | null;
  drawdown: Drawdown;
  recoveryFactor: number | null;
  /** Daily returns: worst day, 5th percentile, and the mean of the worst 1% (tail loss), all % of equity. */
  worstDayPct: number; worstDayDate: string | null; p5DayPct: number; tailLoss1Pct: number;
  worstMonthPct: number; worstMonth: string | null; bestMonthPct: number;
  positiveMonthsPct: number; positiveYearsPct: number;
  annual: { year: string; returnPct: number; net: number }[];
  monthly: { month: string; returnPct: number; net: number }[];
};

/** Metrics from a daily equity curve. `riskFreePct` is the annual rate used for Sharpe and Sortino (default 6.5, roughly the 91-day T-bill). */
export function curveMetrics(points: CurvePoint[], riskFreePct = 6.5): CurveMetrics {
  if (points.length < 2) throw new Error('curveMetrics needs at least two points');
  const start = points[0].equity, end = points[points.length - 1].equity;
  const years = yearsBetween(points[0].date, points[points.length - 1].date);
  const rets: number[] = [], retDates: string[] = [];
  for (let i = 1; i < points.length; i++) { const p = points[i - 1].equity; rets.push(p > 0 ? points[i].equity / p - 1 : 0); retDates.push(points[i].date); }
  const rf = Math.pow(1 + riskFreePct / 100, 1 / 252) - 1;
  const ex = rets.map((r) => r - rf);
  const mean = ex.reduce((a, b) => a + b, 0) / ex.length;
  const sd = Math.sqrt(ex.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, ex.length - 1));
  const dsd = Math.sqrt(ex.reduce((a, b) => a + Math.min(0, b) ** 2, 0) / ex.length);
  const enough = rets.length >= 60;
  const sharpe = enough && sd > 0 ? r2((mean / sd) * Math.sqrt(252)) : null;
  const sortino = enough && dsd > 0 ? r2((mean / dsd) * Math.sqrt(252)) : null;
  const cagr = start > 0 && end > 0 ? (Math.pow(end / start, 1 / years) - 1) * 100 : -100;
  const dd = drawdownOf(points);
  const sorted = [...rets].sort((a, b) => a - b);
  const worstI = rets.indexOf(sorted[0]);
  const tailN = Math.max(1, Math.floor(sorted.length * 0.01));
  const tail = sorted.slice(0, tailN).reduce((a, b) => a + b, 0) / tailN;
  const p5 = sorted[Math.floor(sorted.length * 0.05)] ?? sorted[0];

  const periodRows = (key: (d: string) => string) => {
    const last = new Map<string, number>();
    for (const p of points) last.set(key(p.date), p.equity);
    const out: { period: string; returnPct: number; net: number }[] = [];
    let prev = start;
    for (const [period, v] of last) { out.push({ period, returnPct: pct(prev > 0 ? v / prev - 1 : 0), net: r2(v - prev) }); prev = v; }
    return out;
  };
  const monthly = periodRows((d) => d.slice(0, 7)).map((m) => ({ month: m.period, returnPct: m.returnPct, net: m.net }));
  const annual = periodRows((d) => d.slice(0, 4)).map((y) => ({ year: y.period, returnPct: y.returnPct, net: y.net }));
  const worstM = monthly.reduce((a, m) => (m.returnPct < a.returnPct ? m : a), monthly[0]);
  const bestM = monthly.reduce((a, m) => (m.returnPct > a.returnPct ? m : a), monthly[0]);

  return {
    from: points[0].date, to: points[points.length - 1].date, years: Math.round(years * 100) / 100, days: points.length,
    startEquity: r2(start), endEquity: r2(end), net: r2(end - start),
    returnPct: pct(start > 0 ? end / start - 1 : 0), cagrPct: r2(cagr),
    sharpe, sortino, calmar: dd.maxDdPct > 0 ? r2(cagr / dd.maxDdPct) : null,
    drawdown: dd, recoveryFactor: dd.maxDd > 0 ? r2((end - start) / dd.maxDd) : null,
    worstDayPct: pct(sorted[0] ?? 0), worstDayDate: worstI >= 0 ? retDates[worstI] : null, p5DayPct: pct(p5), tailLoss1Pct: pct(tail),
    worstMonthPct: worstM?.returnPct ?? 0, worstMonth: worstM?.month ?? null, bestMonthPct: bestM?.returnPct ?? 0,
    positiveMonthsPct: pct(monthly.filter((m) => m.net > 0).length / Math.max(1, monthly.length)),
    positiveYearsPct: pct(annual.filter((y) => y.net > 0).length / Math.max(1, annual.length)),
    annual, monthly,
  };
}

export type TradeMetrics = {
  trades: number; wins: number; losses: number; winRatePct: number | null;
  total: number; avgWin: number | null; avgLoss: number | null; profitFactor: number | null; expectancy: number | null;
  /** Average win ÷ average loss (absolute). */
  payoff: number | null;
  largestWin: number | null; largestLoss: number | null;
  maxConsecutiveWins: number; maxConsecutiveLosses: number;
  avgHoldingDays: number | null;
  /** Total without the best trade, and without the best two: a strategy that lives on one trade shows here. */
  totalWithoutBest: number; totalWithoutBest2: number; bestTradeSharePct: number | null;
  perYear: { year: string; trades: number; wins: number; net: number; worst: number }[];
};

export function tradeMetrics(trades: TradeLike[]): TradeMetrics {
  const nets = trades.map((t) => t.net), w = nets.filter((x) => x > 0), l = nets.filter((x) => x <= 0);
  const total = nets.reduce((a, b) => a + b, 0), winSum = w.reduce((a, b) => a + b, 0), lossSum = l.reduce((a, b) => a + b, 0);
  let cw = 0, cl = 0, maxW = 0, maxL = 0;
  for (const n of nets) { if (n > 0) { cw++; cl = 0; } else { cl++; cw = 0; } maxW = Math.max(maxW, cw); maxL = Math.max(maxL, cl); }
  const desc = [...nets].sort((a, b) => b - a);
  const by = new Map<string, { year: string; trades: number; wins: number; net: number; worst: number }>();
  for (const t of trades) {
    const y = t.exit.slice(0, 4), r = by.get(y) ?? { year: y, trades: 0, wins: 0, net: 0, worst: 0 };
    r.trades++; if (t.net > 0) r.wins++; r.net = r2(r.net + t.net); r.worst = Math.min(r.worst, t.net); by.set(y, r);
  }
  const hold = trades.map((t) => (Date.parse(t.exit) - Date.parse(t.entry)) / DAY);
  return {
    trades: trades.length, wins: w.length, losses: l.length, winRatePct: trades.length ? pct(w.length / trades.length) : null,
    total: r2(total), avgWin: w.length ? r2(winSum / w.length) : null, avgLoss: l.length ? r2(lossSum / l.length) : null,
    profitFactor: lossSum < 0 ? r2(winSum / -lossSum) : null, expectancy: trades.length ? r2(total / trades.length) : null,
    payoff: w.length && l.length && lossSum < 0 ? r2((winSum / w.length) / (-lossSum / l.length)) : null,
    largestWin: w.length ? Math.max(...w) : null, largestLoss: l.length ? Math.min(...l) : null,
    maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL,
    avgHoldingDays: hold.length ? r2(hold.reduce((a, b) => a + b, 0) / hold.length) : null,
    totalWithoutBest: r2(total - (desc[0] ?? 0)), totalWithoutBest2: r2(total - (desc[0] ?? 0) - (desc[1] ?? 0)),
    bestTradeSharePct: total > 0 && desc[0] > 0 ? pct(desc[0] / total) : null,
    perYear: [...by.values()].sort((a, b) => a.year.localeCompare(b.year)),
  };
}

export type RegimeRow = { regime: string; days: number; net: number; /** Mean daily P&L × 252, ₹. */ annualised: number; worstDay: number; positiveDaysPct: number; sharpeLike: number | null };

/** Daily P&L split by a label per date (trend, volatility, crisis…). Days whose label is null are left out. */
export function regimeMetrics(points: CurvePoint[], labelOf: (date: string) => string | null): RegimeRow[] {
  const by = new Map<string, number[]>();
  for (let i = 1; i < points.length; i++) {
    const lab = labelOf(points[i].date);
    if (lab == null) continue;
    const l = by.get(lab) ?? []; l.push(points[i].equity - points[i - 1].equity); by.set(lab, l);
  }
  return [...by].map(([regime, pnl]) => {
    const n = pnl.length, mean = pnl.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(pnl.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1));
    return { regime, days: n, net: r2(pnl.reduce((a, b) => a + b, 0)), annualised: r2(mean * 252), worstDay: r2(Math.min(...pnl)), positiveDaysPct: pct(pnl.filter((x) => x > 0).length / n), sharpeLike: n >= 60 && sd > 0 ? r2((mean / sd) * Math.sqrt(252)) : null };
  }).sort((a, b) => a.regime.localeCompare(b.regime));
}

/** Equity curve of a fixed-capital book: capital plus the running sum of closed trades, with open trades at their daily mark. */
export function equityFromTrades(dates: string[], capital: number, trades: { entry: string; exit: string; net: number; daily?: { date: string; mtm: number }[] }[]): CurvePoint[] {
  const closedBy = new Map<string, number>();
  const openMark = new Map<string, number>();
  for (const t of trades) {
    closedBy.set(t.exit, (closedBy.get(t.exit) ?? 0) + t.net);
    for (const p of t.daily ?? []) if (p.date < t.exit) openMark.set(p.date, (openMark.get(p.date) ?? 0) + p.mtm);
  }
  let cum = 0;
  return dates.map((date) => { cum += closedBy.get(date) ?? 0; return { date, equity: r2(capital + cum + (openMark.get(date) ?? 0)) }; });
}

/** Adds several books' daily P&L on a common calendar (each book's own capital is kept apart). */
export function combineCurves(curves: CurvePoint[][], capital: number): CurvePoint[] {
  const dates = [...new Set(curves.flat().map((p) => p.date))].sort();
  const pnl = new Map<string, number>();
  for (const c of curves) for (let i = 1; i < c.length; i++) pnl.set(c[i].date, (pnl.get(c[i].date) ?? 0) + c[i].equity - c[i - 1].equity);
  let cum = 0;
  return dates.map((date) => { cum += pnl.get(date) ?? 0; return { date, equity: r2(capital + cum) }; });
}

/** Pearson correlation of two books' daily P&L on the dates both have. */
export function pnlCorrelation(a: CurvePoint[], b: CurvePoint[]): { r: number | null; days: number } {
  const diff = (c: CurvePoint[]) => { const m = new Map<string, number>(); for (let i = 1; i < c.length; i++) m.set(c[i].date, c[i].equity - c[i - 1].equity); return m; };
  const da = diff(a), db = diff(b), xs: number[] = [], ys: number[] = [];
  for (const [d, x] of da) { const y = db.get(d); if (y != null) { xs.push(x); ys.push(y); } }
  const n = xs.length;
  if (n < 30) return { r: null, days: n };
  const mx = xs.reduce((p, q) => p + q, 0) / n, my = ys.reduce((p, q) => p + q, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  return { r: sxx > 0 && syy > 0 ? Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000 : null, days: n };
}
