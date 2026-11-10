// Option strategy lab: the owner builds the option tests we ran as one-off studies (apps/feed/scripts/selling-*.ts) and
// runs them on NSE's official end-of-day F&O data. It follows the studies' rules exactly, so a template reproduces a
// study's figures:
// - One position at a time. A trade starts at a day's close and is checked at every later close.
// - Strikes come from traded closes only, after impossible ("stale") closes are set aside by the data layer. With
//   `missing: 'settlement'` a leg whose strike did not trade uses NSE's settlement price, capped (boundedMark), and the
//   trade is counted as model-priced.
// - While held, an option is valued at its close, or at its capped settlement price on a day it did not trade.
// - Slippage: a stated amount per option against us on every fill (never below 5 paise). Every charge is paid.
// - Expiry settles options at intrinsic value against the index's official close (and futures at that close).
// - Booking, stops and adjustments are seen at a close and filled at that same close: daily data cannot show what
//   happened inside a day, so a trade can close well past its stop.
// - Money is in rupees, either as it was or at today's index level and lot size (`money: 'today'`, the studies' way),
//   so 2012 and 2026 trades weigh the same.
// All prices inside are integer paise.

import { computeFuturesCharges, computeOptionCharges, expirySettlementCharges } from '@mtv/paper';
import { boundedMark, deltaOf, ivAboveMedian, ivRank, parityForward, yearsBetween, type IvPoint } from '@mtv/options';

// ---------------------------------------------------------------- the strategy

/** How a leg's strike is chosen on the entry day. `pct` and `points` count from the ATM strike (+ above, − below). */
export type LabStrike =
  | { by: 'atm' }
  | { by: 'forward' }
  | { by: 'delta'; delta: number }
  | { by: 'pct'; pct: number }
  | { by: 'points'; points: number }
  | { by: 'premium'; rupees: number };

/** `expiry`: 0 = the trade's expiry, 1 = the next monthly after it, 2 = the one after that. Futures use monthly contracts. */
export type LabLeg = { side: 'BUY' | 'SELL'; kind: 'CE' | 'PE' | 'FUT'; lots: number; strike: LabStrike; expiry: 0 | 1 | 2 };

/** When trades start, and which expiry each one is built around. */
export type LabSchedule =
  /** Each expiry: start this many calendar days before it (the first trading day on or after that date). */
  | { every: 'expiry'; cycle: 'monthly' | 'weekly'; daysBefore: number }
  /** The first trading day after a monthly expiry, on the monthly expiry this many months later. */
  | { every: 'after-expiry'; months: number }
  /** Every week on this weekday (or the next trading day that week), on the next weekly or monthly expiry. */
  | { every: 'week'; weekday: 1 | 2 | 3 | 4 | 5; expiry: 'weekly' | 'monthly' }
  /** Once a year: in `month`, on its last Monday or first trading day, on the monthly expiry of `expiryMonth`. */
  | { every: 'year'; month: number; day: 'last-monday' | 'first-day'; expiryMonth: number };

export type LabAction = { close: number; lots: number } | { add: LabLeg };
/**
 * An adjustment, done once per trade, at the first close that reaches its level:
 * `when.leg` = that leg's strike; `when.pct` = this % from the entry's reference (see distanceFrom). `dir` = at or above (up) / at or below.
 * `after` = only once adjustment number `after` has been done. Leg numbers count the starting legs, then added ones.
 */
export type LabAdjust = { when: { leg: number } | { pct: number }; dir: 'up' | 'down'; after?: number; actions: LabAction[] };

export type LabStrategy = {
  name: string;
  underlying: 'NIFTY' | 'BANKNIFTY';
  schedule: LabSchedule;
  legs: LabLeg[];
  /** Trade only when the ATM IV (25 to 60 days out) is: above its past-year median, in its top third, or at/below the median. */
  iv: 'any' | 'high' | 'top-third' | 'low';
  /** No `daysLeft`: hold to the trade's expiry. `bookPct`: % of the entry credit earned. `stopCredit`: a loss of this × credit. */
  exit: { daysLeft?: number; bookPct?: number; stopRupees?: number; stopCredit?: number };
  adjust?: LabAdjust[];
  /** What % and point distances (and adjustment levels) count from: the index at entry, or the entry's ATM strike. */
  distanceFrom?: 'index' | 'atm';
  /** A strike that did not trade on the entry day: skip the trade, or use NSE's (capped) settlement price. */
  missing: 'skip' | 'settlement';
  /** ₹ per option, against us on every fill. */
  slippage: number;
  money: 'today' | 'actual';
  from?: string;
  to?: string;
};

// ---------------------------------------------------------------- data

export type LabQuote = { kind: 'CE' | 'PE'; strikePaise: number; closePaise: number; settlePaise: number; traded: boolean };
export type LabDay = { date: string; spotPaise: number | null; lotSize: number | null };

/** What the lab reads. The feed implements it over Postgres; tests over memory. */
export interface LabData {
  /** Every trading day with F&O data, oldest first. */
  days: LabDay[];
  /** Real monthly expiries, past and still listed, sorted. */
  monthly: string[];
  /** Every real expiry (weekly too), past and still listed, sorted. */
  expiries: string[];
  /** One expiry's options from `from` to `to`, by date. Impossible closes already carry traded = false. */
  chains(expiry: string, from: string, to: string): Promise<Map<string, LabQuote[]>>;
  /** The monthly future's closes from `from` to `to`, by date. */
  futures(expiry: string, from: string, to: string): Promise<Map<string, number>>;
  /** ATM IV history (one reading a day), for the IV filter. */
  iv: IvPoint[];
}

// ---------------------------------------------------------------- results

export type LabTradeLeg = { side: 'BUY' | 'SELL'; kind: 'CE' | 'PE' | 'FUT'; strike: number; expiry: string; lots: number; entry: number; exit: number; model: boolean; added?: string; closed?: string };
export type LabExit = 'expiry' | 'days-left' | 'booked' | 'stop';
export type LabTrade = {
  entry: string; exit: string; expiry: string; reason: LabExit;
  spotIn: number; spotOut: number; ivHigh: boolean | null; ivRank: number | null;
  legs: LabTradeLeg[]; events: { date: string; text: string }[];
  /** ₹: the entry credit (negative = a debit), money after charges, charges, and the worst close while open. */
  credit: number; net: number; charges: number; worstMtm: number; worstMtmOn: string;
  /** Legs priced from NSE's settlement price at entry or in an adjustment. */
  model: number;
};
export type LabYear = { year: string; trades: number; won: number; net: number; worst: number };
export type LabSummary = {
  trades: number; won: number; winRatePct: number | null; total: number; perYear: number; years: number;
  avgWin: number | null; avgLoss: number | null; best: number | null; worst: number | null; worstMtm: number | null;
  losingYears: number; byYear: LabYear[]; modelPriced: number;
};
export type LabResult = {
  trades: LabTrade[];
  skipped: { date: string; reason: string }[];
  summary: LabSummary;
  from: string; to: string;
  /** For `money: 'today'`: the index close and lot size the money is scaled to. */
  today: { date: string; spot: number; lot: number };
};

export class LabError extends Error {}

const DAY = 86_400_000;
const MIN_FILL = 5;
const R = Math.round;
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY;
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();

export function validateLab(s: LabStrategy): string | null {
  if (!s.legs.length) return 'Add at least one leg';
  if (s.legs.length > 6) return 'At most 6 legs';
  for (const l of s.legs) {
    if (!Number.isSafeInteger(l.lots) || l.lots < 1 || l.lots > 50) return 'Lots must be a whole number from 1 to 50';
    if (l.kind === 'FUT' && l.strike.by !== 'atm') return 'A future has no strike: leave it at ATM';
    if (l.strike.by === 'delta' && !(l.strike.delta > 0 && l.strike.delta < 1)) return 'Delta must be between 0 and 1 (0.16 = 16%)';
    if (l.strike.by === 'premium' && !(l.strike.rupees > 0)) return 'Premium must be above zero';
    if (l.strike.by === 'pct' && !(Math.abs(l.strike.pct) <= 40)) return 'Distance must be within 40% of the index';
  }
  const sc = s.schedule;
  if (sc.every === 'expiry' && !(Number.isSafeInteger(sc.daysBefore) && sc.daysBefore >= 1 && sc.daysBefore <= 400)) return 'Days before expiry must be from 1 to 400';
  if (sc.every === 'after-expiry' && !(Number.isSafeInteger(sc.months) && sc.months >= 1 && sc.months <= 12)) return 'Months must be from 1 to 12';
  if (sc.every === 'year' && !(sc.month >= 1 && sc.month <= 12 && sc.expiryMonth >= 1 && sc.expiryMonth <= 12)) return 'Pick the months';
  const e = s.exit;
  if (e.daysLeft != null && !(Number.isSafeInteger(e.daysLeft) && e.daysLeft >= 1)) return 'Days left must be a whole number of 1 or more';
  for (const v of [e.bookPct, e.stopRupees, e.stopCredit]) if (v != null && !(v > 0)) return 'Exit values must be above zero';
  if (!(s.slippage >= 0 && s.slippage <= 50)) return 'Slippage must be from ₹0 to ₹50';
  for (const a of s.adjust ?? []) {
    if (!a.actions.length) return 'An adjustment needs at least one action';
    if ('leg' in a.when && !(a.when.leg >= 0 && a.when.leg < s.legs.length + 6)) return 'An adjustment points at a leg that does not exist';
  }
  return null;
}

// ---------------------------------------------------------------- the run

type Open = {
  spec: LabLeg; kind: 'CE' | 'PE' | 'FUT'; expiry: string; strike: number; q: number; // q: signed lots held now
  entryPx: number; mark: number; model: boolean; added?: string; closed?: string; lastExit?: number;
};

export async function runLab(s: LabStrategy, data: LabData): Promise<LabResult> {
  const invalid = validateLab(s);
  if (invalid) throw new LabError(invalid);
  const all = data.days;
  if (all.length < 2) throw new LabError('Not enough F&O history');
  const dates = all.map((d) => d.date), idx = new Map(dates.map((d, i) => [d, i])), day = new Map(all.map((d) => [d.date, d]));
  const first = (d: string) => { let lo = 0, hi = dates.length; while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m] < d) lo = m + 1; else hi = m; } return dates[lo] ?? null; };
  const lastDay = dates[dates.length - 1];
  const todayRow = [...all].reverse().find((d) => d.spotPaise && d.lotSize)!;
  const todayN = todayRow.spotPaise! * todayRow.lotSize!;
  const from = s.from ?? dates[0], to = s.to && s.to < lastDay ? s.to : lastDay;
  const slip = Math.round(s.slippage * 100);

  // ---- planned trades: [entry day, the trade's expiry]
  const plans: { entry: string; expiry: string }[] = [];
  const sc = s.schedule;
  if (sc.every === 'expiry') {
    for (const e of sc.cycle === 'monthly' ? data.monthly : data.expiries) {
      const want = addDays(e, -sc.daysBefore), d = first(want);
      if (want < dates[0] || !d || d >= e || daysBetween(d, e) > sc.daysBefore + 5) continue;
      plans.push({ entry: d, expiry: e });
    }
  } else if (sc.every === 'after-expiry') {
    // The study's way: one position at a time, stepping by the frame after a trade and by one month after a skip.
    // Here every candidate is listed; the run below skips those inside an open trade.
    const m = data.monthly;
    for (let k = sc.months; k < m.length; k++) {
      const i = idx.get(m[k - sc.months]);
      if (i == null || i + 1 >= dates.length) continue;
      plans.push({ entry: dates[i + 1], expiry: m[k] });
    }
  } else if (sc.every === 'week') {
    const list = sc.expiry === 'weekly' ? data.expiries : data.monthly;
    const mondayOf = (d: string) => addDays(d, -((weekday(d) + 6) % 7));
    let week = '';
    for (const d of dates) {
      const w = mondayOf(d);
      if (w === week || weekday(d) < sc.weekday) continue;
      week = w;
      const e = list.find((x) => x > d);
      if (e) plans.push({ entry: d, expiry: e });
    }
  } else {
    const y0 = Number(dates[0].slice(0, 4)), y1 = Number(lastDay.slice(0, 4)) + 1;
    for (let y = y0; y <= y1; y++) {
      const mm = String(sc.month).padStart(2, '0');
      let start = `${y}-${mm}-01`;
      if (sc.day === 'last-monday') {
        const last = new Date(Date.UTC(y, sc.month, 0)).getUTCDate();
        for (let dd = last; dd >= last - 6; dd--) { const t = `${y}-${mm}-${String(dd).padStart(2, '0')}`; if (weekday(t) === 1) { start = t; break; } }
      }
      const d = first(start);
      const ey = sc.expiryMonth >= sc.month ? y : y + 1;
      const e = data.monthly.find((x) => x.startsWith(`${ey}-${String(sc.expiryMonth).padStart(2, '0')}`));
      if (d && e && d < e && d.slice(0, 4) === String(y)) plans.push({ entry: d, expiry: e });
    }
  }

  const trades: LabTrade[] = [], skipped: LabResult['skipped'] = [];
  let busyUntil = '';

  for (const plan of plans) {
    const d = plan.entry, e = plan.expiry;
    if (d < from || d > to) continue;
    if (d < busyUntil) { if (sc.every !== 'after-expiry') skipped.push({ date: d, reason: 'Still in the previous trade' }); continue; }
    const exitPlanned = s.exit.daysLeft != null ? first(addDays(e, -s.exit.daysLeft)) : e;
    if (!exitPlanned || exitPlanned <= d) { skipped.push({ date: d, reason: 'Too close to expiry for the exit rule' }); continue; }
    if (exitPlanned > lastDay || !idx.has(exitPlanned)) { skipped.push({ date: d, reason: 'Not finished yet' }); continue; }
    if (exitPlanned > to) continue;
    const hi = ivAboveMedian(data.iv, d), rank = ivRank(data.iv, d);
    if (s.iv === 'high' && hi !== true) continue;
    if (s.iv === 'low' && hi !== false) continue;
    if (s.iv === 'top-third' && !((rank ?? 0) >= 0.67)) continue;
    const meta = day.get(d)!;
    if (!meta.spotPaise || !meta.lotSize) { skipped.push({ date: d, reason: 'No index close that day' }); continue; }
    const r = await play(plan.entry, plan.expiry, exitPlanned, meta.spotPaise, meta.lotSize, hi, rank);
    if (typeof r === 'string') { skipped.push({ date: d, reason: r }); continue; }
    trades.push(r);
    busyUntil = r.exit;
  }

  return { trades, skipped, summary: summarizeLab(trades, from, to), from, to, today: { date: todayRow.date, spot: todayRow.spotPaise! / 100, lot: todayRow.lotSize! } };

  async function play(d: string, e: string, x0: string, spot: number, lot: number, hi: boolean | null, rank: number | null): Promise<LabTrade | string> {
    const scale = s.money === 'today' ? todayN / (spot * lot) : 1;
    const money = (p: number) => (p * scale) / 100;
    const end = x0 > e ? e : x0;
    const kit = await entryKit(s, data, d, e, end, spot);
    if (typeof kit === 'string') return kit;
    const { open, chainOn, futOn, pick, legExpiry, ref0 } = kit;
    let cash = 0, cashRaw = 0, charges = 0;
    const fill = (l: Open, lots: number, raw: number, t: string) => { // lots > 0 buys
      const px = lots > 0 ? raw + slip : Math.max(MIN_FILL, raw - slip);
      const qty = Math.abs(lots) * lot;
      cash -= lots * lot * px; cashRaw -= lots * lot * raw;
      charges += l.kind === 'FUT'
        ? computeFuturesCharges({ side: lots > 0 ? 'BUY' : 'SELL', qty, pricePaise: px, date: t }).total
        : computeOptionCharges({ side: lots > 0 ? 'BUY' : 'SELL', qty, premiumPaise: px, date: t }).total;
      return px;
    };
    for (const l of open) fill(l, l.q, l.entryPx, d);
    const credit = open.reduce((a, l) => a + (l.kind === 'FUT' ? 0 : -l.q * lot * l.entryPx), 0);
    const events: LabTrade['events'] = [];
    let model = open.filter((l) => l.model).length, worst = 0, worstOn = d, exit = end, reason: LabExit = end === e && !s.exit.daysLeft ? 'expiry' : 'days-left';
    const done = new Set<number>();
    const value = () => open.reduce((a, l) => a + l.q * lot * l.mark, 0);

    // ---- every close while open
    for (let j = idx.get(d)! + 1; j <= idx.get(end)!; j++) {
      const t = dates[j], sp = day.get(t)?.spotPaise;
      for (const l of open) {
        if (l.q === 0 || t > l.expiry) continue;
        const v = l.kind === 'FUT' ? await futOn(l.expiry, t) : boundedMark(await chainOn(l.expiry, t), l.kind, l.strike, sp ?? 0);
        if (v != null) l.mark = v;
      }
      const last = t === end;
      if (!last && sp) {
        for (let a = 0; a < (s.adjust ?? []).length; a++) {
          const adj = s.adjust![a];
          if (done.has(a) || (adj.after != null && !done.has(adj.after))) continue;
          let level: number | null;
          if ('leg' in adj.when) { const l = open[adj.when.leg]; level = l && l.q !== 0 && l.kind !== 'FUT' ? l.strike : null; } else level = ref0 * (1 + adj.when.pct / 100);
          if (level == null || !(adj.dir === 'up' ? sp >= level : sp <= level)) continue;
          done.add(a);
          for (const act of adj.actions) {
            if ('close' in act) {
              const l = open[act.close];
              if (!l || l.q === 0) continue;
              const n = Math.min(act.lots, Math.abs(l.q)) * Math.sign(l.q);
              const px = fill(l, -n, l.mark, t);
              l.q -= n; l.lastExit = px;
              if (l.q === 0) l.closed = t;
              events.push({ date: t, text: `${n > 0 ? 'Sold' : 'Bought back'} ${Math.abs(n)} lot${Math.abs(n) > 1 ? 's' : ''} of ${legName(l)} at ₹${(px / 100).toFixed(2)}` });
            } else {
              const spec = act.add, exp = legExpiry(spec);
              const p = exp ? await pick(spec, t, sp, exp) : 'The later expiry is not listed';
              if (typeof p === 'string') { events.push({ date: t, text: `Could not add a leg: ${p}` }); continue; }
              const l: Open = { spec, kind: spec.kind, expiry: exp!, strike: p.strike, q: 0, entryPx: p.px, mark: p.px, model: p.model, added: t };
              if (p.model) model++;
              const lots = (spec.side === 'BUY' ? 1 : -1) * spec.lots, px = fill(l, lots, p.px, t);
              l.q = lots; l.entryPx = p.px;
              open.push(l);
              events.push({ date: t, text: `${lots > 0 ? 'Bought' : 'Sold'} ${spec.lots} lot${spec.lots > 1 ? 's' : ''} of ${legName(l)} at ₹${(px / 100).toFixed(2)}` });
            }
          }
        }
      }
      const mtm = money(cash - charges + value());
      if (mtm < worst) { worst = mtm; worstOn = t; }
      if (last) break;
      const pnlRaw = cashRaw + value(); // the studies' booking sum: closes, no slippage, no charges
      if (s.exit.bookPct && credit > 0 && pnlRaw >= (credit * s.exit.bookPct) / 100) { exit = t; reason = 'booked'; break; }
      if ((s.exit.stopCredit && credit > 0 && pnlRaw <= -credit * s.exit.stopCredit) || (s.exit.stopRupees && mtm <= -s.exit.stopRupees)) { exit = t; reason = 'stop'; break; }
    }

    // ---- exit
    const spotOut = day.get(exit)?.spotPaise ?? null;
    const settles = reason === 'expiry' && spotOut != null;
    for (const l of open) {
      if (l.q === 0) continue;
      if (settles && l.expiry === exit) {
        const iv = l.kind === 'FUT' ? spotOut! : Math.max(0, l.kind === 'CE' ? spotOut! - l.strike : l.strike - spotOut!);
        cash += l.q * lot * iv;
        charges += l.kind === 'FUT'
          ? computeFuturesCharges({ side: l.q > 0 ? 'SELL' : 'BUY', qty: Math.abs(l.q) * lot, pricePaise: iv, date: exit }).total
          : expirySettlementCharges({ side: l.q > 0 ? 'BUY' : 'SELL', qty: Math.abs(l.q) * lot, intrinsicPaise: iv, date: exit });
        l.lastExit = iv;
      } else {
        l.lastExit = fill(l, -l.q, l.mark, exit);
      }
    }
    const net = money(cash - charges);
    return {
      entry: d, exit, expiry: e, reason, spotIn: spot / 100, spotOut: (spotOut ?? spot) / 100, ivHigh: hi, ivRank: rank,
      legs: open.map((l) => ({ side: l.spec.side, kind: l.kind, strike: l.strike / 100, expiry: l.expiry, lots: l.spec.lots, entry: l.entryPx / 100, exit: (l.lastExit ?? l.mark) / 100, model: l.model, ...(l.added ? { added: l.added } : {}), ...(l.closed ? { closed: l.closed } : {}) })),
      events, credit: R(money(credit)), net: R(net), charges: R(money(charges)), worstMtm: R(Math.min(worst, net)), worstMtmOn: worst < net ? worstOn : exit, model,
    };
  }
}

/** Everything needed to open a trade on day d around expiry e (and to add legs while it runs), or why it cannot open. */
async function entryKit(s: LabStrategy, data: LabData, d: string, e: string, end: string, spot: number) {
  // Chains and futures over the trade's life, per expiry, loaded once.
  const chainCache = new Map<string, Map<string, LabQuote[]>>(), futCache = new Map<string, Map<string, number>>();
  const chainOn = async (exp: string, t: string) => {
    let c = chainCache.get(exp);
    if (!c) { c = await data.chains(exp, d, exp < end ? exp : end); chainCache.set(exp, c); }
    return c.get(t) ?? [];
  };
  const futOn = async (exp: string, t: string) => {
    let c = futCache.get(exp);
    if (!c) { c = await data.futures(exp, d, end); futCache.set(exp, c); }
    return c.get(t) ?? null;
  };
  const monthlyAfter = (x: string, n: number) => { const i = data.monthly.findIndex((m) => m >= x); return i < 0 ? null : data.monthly[i + n] ?? null; };
  const legExpiry = (spec: LabLeg) => (spec.kind === 'FUT' ? monthlyAfter(e, spec.expiry) : spec.expiry === 0 ? e : monthlyAfter(e, spec.expiry));

  // ATM reference: the traded call strike nearest the index (the studies' "ATM").
  const main = await chainOn(e, d);
  const tradedOf = (rows: LabQuote[], k: 'CE' | 'PE') => rows.filter((x) => x.kind === k && x.traded && x.closePaise > 0);
  const nearest = (rows: LabQuote[], target: number) => rows.reduce<LabQuote | null>((b, x) => (!b || Math.abs(x.strikePaise - target) < Math.abs(b.strikePaise - target) ? x : b), null);
  // Like an ATM leg: a traded call near the index (1%, or 2.5% beyond 100 days, where strikes are wider apart), else
  // (with settlement prices allowed) a settled one.
  const atmTol = spot * (daysBetween(d, e) <= 100 ? 0.01 : 0.025);
  const near1 = (rows: LabQuote[]) => nearest(rows.filter((x) => Math.abs(x.strikePaise - spot) <= atmTol), spot);
  const atmRow = near1(tradedOf(main, 'CE')) ?? (s.missing === 'settlement' ? near1(main.filter((x) => x.kind === 'CE' && x.settlePaise > 0)) : null);
  const atmK = atmRow?.strikePaise ?? spot;
  const ref0 = s.distanceFrom === 'atm' ? atmK : spot;

  async function pick(spec: LabLeg, t: string, spotT: number, exp: string): Promise<{ strike: number; px: number; model: boolean } | string> {
    if (spec.kind === 'FUT') {
      const f = await futOn(exp, t);
      return f ? { strike: 0, px: f, model: false } : `No ${exp} future close`;
    }
    const rows = await chainOn(exp, t), k = spec.kind, usable = tradedOf(rows, k);
    const T = yearsBetween(t, exp);
    const tol = spotT * (daysBetween(t, exp) <= 100 ? 0.01 : 0.025);
    const asQuote = (x: LabQuote) => ({ strikePaise: x.strikePaise, pricePaise: x.traded ? x.closePaise : x.settlePaise, traded: x.traded });
    const fwd = () => parityForward(rows.filter((x) => x.kind === 'CE').map(asQuote), rows.filter((x) => x.kind === 'PE').map(asQuote), spotT, T) ?? spotT;
    const st = spec.strike;
    if (st.by === 'delta') {
      const F = fwd(), sgn = k === 'CE' ? 1 : -1;
      let best: LabQuote | null = null, gap = Infinity;
      for (const x of usable) {
        if (sgn * (x.strikePaise - F) <= 0) continue;
        const v = deltaOf(k, x.closePaise, F, x.strikePaise, T);
        if (v == null) continue;
        const g = Math.abs(Math.abs(v) - st.delta);
        if (g < gap) { gap = g; best = x; }
      }
      return best ? { strike: best.strikePaise, px: best.closePaise, model: false } : `No traded ${k} for the delta`;
    }
    if (st.by === 'forward') {
      const F = fwd(), other = new Set(tradedOf(rows, k === 'CE' ? 'PE' : 'CE').map((x) => x.strikePaise));
      const p = usable.filter((x) => other.has(x.strikePaise)).sort((a, b) => Math.abs(a.strikePaise - F) - Math.abs(b.strikePaise - F))[0];
      return p && Math.abs(p.strikePaise - F) <= spotT * 0.02 ? { strike: p.strikePaise, px: p.closePaise, model: false } : 'No traded strike at the forward';
    }
    if (st.by === 'premium') {
      const target = Math.round(st.rupees * 100);
      const p = [...usable].sort((a, b) => Math.abs(a.closePaise - target) - Math.abs(b.closePaise - target) || (k === 'CE' ? b.strikePaise - a.strikePaise : a.strikePaise - b.strikePaise))[0];
      return p ? { strike: p.strikePaise, px: p.closePaise, model: false } : `No traded ${k}`;
    }
    // Distances count from the entry's reference (the index, or its ATM strike), also for legs added later.
    const target = st.by === 'atm' ? spotT : st.by === 'pct' ? ref0 * (1 + st.pct / 100) : ref0 + st.points * 100;
    const p = nearest(usable.filter((x) => Math.abs(x.strikePaise - target) <= tol), target);
    if (p) return { strike: p.strikePaise, px: p.closePaise, model: false };
    if (s.missing === 'settlement') {
      const q = nearest(rows.filter((x) => x.kind === k && x.settlePaise > 0 && Math.abs(x.strikePaise - target) <= tol), target);
      const px = q && boundedMark(rows, k, q.strikePaise, spotT);
      if (q && px) return { strike: q.strikePaise, px, model: true };
    }
    return `${k} near ${Math.round(target / 100)} did not trade`;
  }

  const open: Open[] = [];
  for (const spec of s.legs) {
    const exp = legExpiry(spec);
    if (!exp) return 'The later expiry is not listed';
    const p = await pick(spec, d, spot, exp);
    if (typeof p === 'string') return p;
    open.push({ spec, kind: spec.kind, expiry: exp, strike: p.strike, q: (spec.side === 'BUY' ? 1 : -1) * spec.lots, entryPx: p.px, mark: p.px, model: p.model });
  }
  return { open, chainOn, futOn, pick, legExpiry, ref0, atmK };
}

const legName = (l: { kind: string; strike: number; expiry: string }) => (l.kind === 'FUT' ? `the ${l.expiry} future` : `${l.strike / 100} ${l.kind} (${l.expiry})`);

/** Totals, year by year. Profit a year = total ÷ the years tested (first to last trading day of the period). */
export function summarizeLab(trades: LabTrade[], from: string, to: string): LabSummary {
  const nets = trades.map((t) => t.net), w = nets.filter((x) => x > 0), l = nets.filter((x) => x <= 0);
  const total = nets.reduce((a, b) => a + b, 0), years = Math.max(daysBetween(from, to) / 365.25, 1 / 12);
  const by = new Map<string, LabYear>();
  for (const t of trades) {
    const y = t.exit.slice(0, 4), r = by.get(y) ?? { year: y, trades: 0, won: 0, net: 0, worst: 0 };
    r.trades++; if (t.net > 0) r.won++; r.net += t.net; r.worst = Math.min(r.worst, t.net);
    by.set(y, r);
  }
  const byYear = [...by.values()].sort((a, b) => a.year.localeCompare(b.year));
  return {
    trades: trades.length, won: w.length, winRatePct: trades.length ? (w.length / trades.length) * 100 : null, total, perYear: R(total / years), years: Math.round(years * 10) / 10,
    avgWin: w.length ? R(w.reduce((a, b) => a + b, 0) / w.length) : null, avgLoss: l.length ? R(l.reduce((a, b) => a + b, 0) / l.length) : null,
    best: nets.length ? Math.max(...nets) : null, worst: nets.length ? Math.min(...nets) : null, worstMtm: trades.length ? Math.min(...trades.map((t) => t.worstMtm)) : null,
    losingYears: byYear.filter((y) => y.net < 0).length, byYear, modelPriced: trades.filter((t) => t.model > 0).length,
  };
}

export type LabPreview = { date: string; expiry: string; spot: number; lot: number; legs: { side: 'BUY' | 'SELL'; kind: 'CE' | 'PE' | 'FUT'; strike: number; expiry: string; lots: number; price: number; model: boolean }[] };

/**
 * The position this strategy would open at the latest close, on the expiry its schedule would use now: for the margin
 * estimate and to show what a trade looks like today. A string says why it cannot be built.
 */
export async function previewLab(s: LabStrategy, data: LabData): Promise<LabPreview | string> {
  const invalid = validateLab(s);
  if (invalid) return invalid;
  const today = [...data.days].reverse().find((x) => x.spotPaise && x.lotSize);
  if (!today) return 'No index close';
  const d = today.date, sc = s.schedule;
  const ahead = (list: string[]) => list.filter((x) => x > d);
  let e: string | undefined;
  if (sc.every === 'expiry') e = ahead(sc.cycle === 'monthly' ? data.monthly : data.expiries).sort((a, b) => Math.abs(daysBetween(d, a) - sc.daysBefore) - Math.abs(daysBetween(d, b) - sc.daysBefore))[0];
  else if (sc.every === 'after-expiry') e = ahead(data.monthly)[sc.months - 1];
  else if (sc.every === 'week') e = ahead(sc.expiry === 'weekly' ? data.expiries : data.monthly)[0];
  else e = ahead(data.monthly).find((x) => Number(x.slice(5, 7)) === sc.expiryMonth);
  if (!e) return 'That expiry is not listed yet';
  const kit = await entryKit(s, data, d, e, d, today.spotPaise!);
  if (typeof kit === 'string') return kit;
  return {
    date: d, expiry: e, spot: today.spotPaise! / 100, lot: today.lotSize!,
    legs: kit.open.map((l) => ({ side: l.spec.side, kind: l.kind, strike: l.strike / 100, expiry: l.expiry, lots: l.spec.lots, price: l.entryPx / 100, model: l.model })),
  };
}
