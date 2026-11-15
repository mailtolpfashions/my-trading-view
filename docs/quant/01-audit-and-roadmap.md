# Quant research programme: audit and roadmap

Date: 2026-11-11. Branch `new-platform`. Written after reading the repo, the memory notes from the earlier studies, and a fresh read-only count of what Postgres and the minute store hold (`apps/feed/scripts/research/data-audit.ts`).

Nothing in this document is a recommendation to trade. No live trading, no orders, no capital.

## 1. Where we stand before any new work

The target is 35% a year, 80 to 90% wins, drawdown under 10%, on NSE. This repo already holds about 60 studies run between 2026-11-04 and 2026-11-10. Read together they say:

- **Best robust thing found so far:** NIFTY monthly 0.25-delta strangle, sold 45 days out, only when ATM IV is above its past-year median, closed at 21 days left, no adjustments. 94 trades 2011–2026, 80% won, about ₹45,000 a year per lot at today's size, worst trade −₹66,000, worst open loss −₹85,000, margin about ₹1.73 lakh. Chosen on 2011–2020, it held on 2021–2026 (₹45.8k → ₹43.6k a year).
- **What that means for the target:** per lot it is about 26% a year on margin, but a single bad trade has already cost 49% of that margin. Sized so the worst known loss stays under 10% of capital, the same rule earns about 5 to 6% a year on that capital. At 2 lots on ₹5 lakh it is about 18% a year with a worst open loss near −34%. The 35%-with-under-10%-drawdown combination is not supported by anything found so far.
- **Directional signals:** 120 daily and weekly indicators and patterns on NIFTY (2011–2026), and 595 intraday 5m/15m signals (251 sessions), none beat a coin flip out of sample. The ten directional checks in the user's intraday seller spec also failed. A trend switch that looked like ₹83k a year was matched by a coin-flip placebo.
- **Hedged, adjusted, calendar, ratio and “video” shapes:** mostly lost after wing costs and slippage. 339 multi-leg shapes × 16,224 settings: 32 passed in-sample, and out of sample most fell 50 to 75%; none beat the plain strangle.
- **Stocks:** 52-week-high breakout and near-52-week-high signals show about +1% excess over the crowd per 20 sessions, positive in 12 to 14 of 15 years (t above 11). This is a raw signal, not a costed portfolio test yet. It is the one equity lead worth a proper test.
- **Intraday equity:** ORB and VWAP-breakout templates lose after charges on NIFTY 50 stocks over the one year of minutes held.

So the honest starting point is: one option-selling family with real but modest edge, one equity momentum lead, and no directional timing edge. Everything below is organised to either find something better under strict controls or to say clearly that it is not there.

## 2. Data audit (measured 2026-11-11)

| Dataset | Coverage | Granularity | Fields | Gaps and caveats |
|---|---|---|---|---|
| NSE equity EOD (`EquityEod`) | 2011-06-22 → 2026-11-09; 1,766 to 3,099 symbols a year, delisted included | daily | OHLC, prev close, volume, trades | Adjusted for splits, bonus, rights (TERP), dividends not adjusted; demergers adjusted from 2026-11-11 by NSE ex-day price; capital reductions and schemes of arrangement still unhandled. Data breaks flagged, never filled. |
| NSE indices (`IndexEod`) | 40 indices; NIFTY 50, BANK, 500, sectors from 2011-06-22 | daily | OHLC, no volume | INDIA VIX complete only from 2015 (2012: 35 days, 2013: 1 day). |
| Index F&O EOD (`FnoEod`) | NIFTY and BANKNIFTY 2011-01-03 → 2026-11-09 (3,928 days, 7.8M NIFTY option rows); FINNIFTY from 2021-01; MIDCPNIFTY from 2022-01; NIFTYNXT50 from 2024-04 | daily | open, high, low, close, settle, OI, volume, traded flag | Only 10 to 16% of listed NIFTY option rows traded before 2020 (30 to 59% since 2021). Untraded rows carry NSE settlement prices that can be junk; `boundedMark` caps them. Stale closes on crash days set aside by `staleFlags`. NIFTY weeklies from Feb 2019; BANKNIFTY weeklies 2016 → Nov 2024 (SEBI one-weekly rule). Expiry labels moved by holidays are fixed by `expiryCalendar`. |
| Stock F&O EOD | 2024-07-08 → today, 227 to 258 stocks | daily | same as above | **2.3 years only.** The 2011–2020 "stock" rows are foreign and sector index contracts (FTSE100, S&P500, CNXIT…), not stocks. Stock futures and options cannot be tested over cycles. |
| Derived option metrics (`FnoDerivedDay`) | per expiry per day from 2011 | daily | ATM IV (Black-76, own calculation), forward, straddle, max pain, OI walls, GEX | IV is ours, from closes; not NSE's. No per-strike IV surface stored (computable from closes). |
| SPAN margin | NSE Clearing files 2011 → today (`spanOn(date)`), matched Kite within ₹1 | daily | risk arrays, spreads, SOM | Exposure margin uses today's 2% for old dates (flagged). |
| Participant OI | 2012-01 → today | daily | FII/DII/Pro/Client long and short by product | |
| FII derivative stats | 2014-12 → today | daily | buy/sell value and OI by segment | |
| FPI flows (NSDL) | 2026-10-30 → today only | daily | | Archive back-fill not done (user decision pending). |
| Equity and index minutes (`.data/1m`) | 2025-11 → today, 502 instruments (NIFTY 500, F&O stocks, main indices), 1.1 GB | 1 minute | OHLCV | **One year only.** Kite has no minutes after 15:14 from 2026-08-03 to 2026-10-30 (64 days). Kite minutes are dividend-adjusted; re-based daily by the 09:15 open. Minute volume 0.6 to 2.6% under NSE day volume. |
| Option minutes (`.data/opt1m`) | 2026-11-04 → today, 4 sessions, NIFTY and BANKNIFTY ATM ±10, two expiries | 1 minute | LTP, OI, bid, ask | Recorder did not follow spot on 5 Nov; coverage patchy. Effectively **no intraday option history**. |
| Bid/ask, order book | none historically | | | Spreads must be assumed (₹1 an option on index options so far, labelled). |
| Corporate actions | 2011 → today (NSE file) | | | Known misses (e.g. SHRIRAMFIN split Jan 2025). |
| Index constituents | current lists only (cached daily) | | | **No point-in-time membership.** Any "NIFTY 50 stocks" universe test is survivorship-biased; "all NSE stocks with a turnover filter" is not. |
| Event calendar, global cues, intraday FII/DII | none | | | |

Database size: F&O 7.9 GB, equity 1.6 GB. The feed holds EOD history in memory from a 250 MB snapshot.

### What this allows, honestly

Can be tested across full cycles (2011–2026, includes 2013 taper, 2015–16, 2018, Covid, 2022, 2024 election day):
- Equity delivery and swing strategies on all NSE stocks (daily and weekly), long only, with itemised dated charges.
- Index futures stand-in: the index itself with futures charges. Basis, rollover and lot rounding are not modelled; this is an estimate and is labelled so. Short side possible as a futures stand-in (needs engine work, see 4).
- NIFTY and BANKNIFTY options at daily closes: strangles, straddles, condors, flies, ratios, calendars, diagonals, hedged shorts, long options, theta and IV studies, delta-based strikes, adjustments seen at closes.
- Expiry-day and weekly-expiry behaviour at daily granularity, including each option's day open, high, low and close (open prints on thin strikes are unreliable; results from them get a lower confidence label).
- Regimes from VIX (2015 on), realized vol and trend (2011 on).

Can be tested only over about one year (low confidence, directional claims need ≥ 250 sessions and a placebo):
- Intraday equity and index strategies on 1m to 1h bars (ORB, VWAP, mean reversion, momentum, overnight gaps measured intraday).

Cannot be tested with what we hold (would be fabricated if attempted):
- Intraday option strategies (9:20 straddles, expiry-day scalps, intraday delta hedging, gamma scalping). Only the recorder from Nov 2026 onward; that needs 6 to 12 months before it says anything.
- Stock futures and stock options over cycles (2.3 years held; a year of that was a strong bull run).
- Anything needing bid/ask depth, order-book or tick data.
- Point-in-time index membership strategies.

## 3. Engine audit

All tests pass (`packages/backtest`: 123 tests; the whole repo was about 296 on 2026-11-01).

| Component | What it does | Limits that matter here |
|---|---|---|
| `packages/backtest/src/portfolio.ts` `runPortfolio` | Multi-stock portfolio backtest, D/W/M and 1m–1h; signal at close, fill next open; limit/stop orders; stop-first inside a bar; gap fills; trailing at close; risk and percent sizing; ranking into `maxOpen` slots; cooldown; pyramiding; itemised dated charges (MIS/CNC/FUT); slippage; MAE/MFE; Sharpe, Sortino, drawdown, months, years, weekday, exit reasons; NIFTY benchmark | **Long only.** Index "futures" are the index with futures charges, no basis or rollover, no lot rounding. No portfolio-level daily loss stop. No walk-forward wrapper. |
| `packages/rules` | Condition AST, formula parser, 90+ functions, 24 patterns, multi-timeframe "as of" (no look-ahead, tested) | |
| `packages/indicators` | 33 indicators, all matched to an independent Pine re-implementation on 3,812 bars; golden tests vs TradingView | |
| `packages/backtest/src/lab.ts` `runLab` | Option strategy lab on EOD chains: schedules (N days before monthly/weekly, after-expiry, weekly, yearly), legs CE/PE/FUT, strikes by ATM/forward/delta/%/points/premium, expiry 0/1/2, IV filter, exits (hold, days-left, book %, stop ₹ or × credit), one-shot adjustments, missing-strike policy, slippage, money today/actual; matches the study scripts to ₹3 | One position at a time. Reports worst MTM per trade but **no daily equity curve**, so no Sharpe, drawdown duration or Monte Carlo from it yet. No margin per trade over time (today's SPAN only). |
| `packages/backtest/src/selling.ts` `runSelling` + `packages/options/src/selling/decide.ts` | Rule engine (playbooks, triggers, adjustments) shared by backtest, advisor and paper; daily equity series; crisis tags; pass-mark check; gap stress at entry | Playbook vocabulary is fixed; strangle-centred. |
| `packages/backtest/src/simulate.ts`, `options.ts`, `engine.ts`, `study.ts` | Day-by-day option position simulator; StockMock-style leg backtest; single-instrument backtester with invariants; condition study (day/month/year tables) | |
| `packages/options` | Black-76 pricing, Greeks, IV, payoff, SPAN + exposure margin (`positionMargin`), `boundedMark`, `staleFlags`, intraday seller engine | |
| `packages/paper` | Dated statutory charges (STT schedules to Apr 2026, exchange txn, SEBI, IPFT, stamp, GST), 5 broker profiles, bid/ask book fills | Before Oct 2024 the first schedule is reused (older STT rates not entered). |
| Feed `scripts/research/*` (50 scripts) and `scripts/selling-*.ts` | The studies listed in section 1; outputs in `apps/feed/.data/research/*.json` | **No experiment registry**: results are files named by hand, with no ID, dataset version or assumptions block. |
| Trade lab (paper), option recorder, alerts, Kite live | Forward-testing path once something passes | Paper fills are kinder than real. |

## 4. Missing capabilities (build before Phase 4, smallest first)

None of these changes an existing working component; each is an addition.

1. **Experiment registry.** `apps/feed/.data/research/experiments.jsonl`, one line per run: `id` (E-YYYYMMDD-NNN), strategy, params, data version (last EOD date, F&O last date, minute store last day, git commit), period, costs and slippage assumed, metrics, validation block (train/validation/holdout, placebo, neighbours), notes. A small helper `scripts/research/registry.ts` that every new script calls. Back-register the section 1 results from their JSON files so they count.
2. **One metrics module** over a daily equity curve: CAGR, annual and monthly returns, win and loss rates, average win and loss, max consecutive losses, profit factor, expectancy, Sharpe, Sortino, Calmar, max drawdown and its duration, recovery factor, trades, holding period, capital use, return on deployed and on total capital, tail loss (worst 1% of days), worst day and month, and per-regime splits. Today Sharpe and drawdown exist only in `portfolio.ts`.
3. **Daily equity curve from the option lab** (additive output on `LabResult`): the daily valuation already runs inside `runLab` for worst MTM; expose it. Then margin per trade from `spanOn(entry date)` so return on deployed capital is real, not today's SPAN.
4. **Regime labels** (shared module): trend (price vs 200-day, 50/200), realized vol tercile, VIX tercile (2015 on), crisis tags (already in `selling.ts`), expiry week, Budget and election windows. Used by every report.
5. **Validation harness:** chronological train/validation/holdout runner; walk-forward (re-fit on a rolling window, trade the next window); parameter-neighbourhood plateau check; placebo (random entries with the same frequency and holding time, 1,000 draws); block-bootstrap Monte Carlo on trade or daily P&L (drawdown and ruin distribution); stress (gap shocks at entry already exist for selling; add −8/−13% and +8/+13% overnight shocks, IV +50%, and "every trade filled a day late").
6. **Short side in `runPortfolio`** for index futures stand-ins only (not cash stocks). Needed for two-sided trend following. With a basis estimate labelled.
7. **Portfolio combiner:** align daily P&L of several strategies, correlation matrix, capital and margin budget, simple allocation (equal risk, then capped), portfolio drawdown stops.

Not built, by design: no intraday option backtester (no data), no stock F&O cycle tests (no data), no order placement.

## 5. Validation protocol (fixed now, before any strategy is run)

- **Periods:** train 2011-01 → 2018-12; validation 2019-01 → 2023-12; **holdout 2024-01 → 2026-11, untouched** until Phase 12. The holdout contains a bull year, the June 2024 election gap, the Oct 2024 to Mar 2025 fall and the 2026 data; it is a fair final exam.
- **Contamination note, stated plainly:** the option-selling families in section 1 were already studied on the whole history (2021–26 served as their test set). For those, the holdout is not clean. They are kept as the benchmark to beat, with walk-forward re-estimation as their validation, not the holdout.
- **Costs:** itemised dated charges on every fill (Zerodha profile by default), plus slippage: ₹1 an option on NIFTY, ₹2 on BANKNIFTY, 0.03% a side on liquid stocks (turnover ≥ ₹10 crore a day), 0.10% on thinner ones, 1 point on NIFTY futures stand-in. Gross and net both reported. Spreads are an assumption and are labelled on every table.
- **Multiple testing:** every sweep records how many settings were tried. A winner must beat the 95th percentile of the placebo and the best of as many random rules as were tried, and must sit on a plateau (neighbours ±1 step keep ≥ 70% of its result).
- **Minimums:** ≥ 60 trades in train, ≥ 30 in validation; profit in ≥ 70% of years; no single trade > 25% of total profit; result survives "a day late" fills.
- **Reporting:** per year, per month, per regime; first and last trade checked against the data range; skipped entries counted; estimates (margin on old dates, scaling to today's size, slippage) labelled.
- **Look-ahead guards already in place:** signals at close, fills next bar; multi-timeframe "as of"; strikes from traded closes only; settlement only where a strike did not trade, counted as model-priced.
- **Survivorship:** equity universes are "all NSE stocks with a point-in-time turnover filter", never today's index list.

## 6. Hypotheses to test (Phase 3), with feasibility

Grouped by what the data can support. Each becomes one or more registered experiments. Priority 1 first.

**A. Index option premium (daily, 2011–2026) — benchmark family exists**
1. P1. Walk-forward of the 0.25Δ strangle and forward straddle (re-choose delta, days-in and days-out each year on the prior 5 years). Does the rule survive when it is not allowed to see the future?
2. P1. Position sizing on the same rule: fixed lots vs margin-fraction vs vol-scaled; portfolio stop at −5%/−8% of capital; what drawdown each buys.
3. P1. Weekly vs monthly premium harvesting, NIFTY 2019–2026 (weeklies), at daily closes, including the Nov 2024 regime change.
4. P2. IV-rank conditional entries beyond the median filter (terciles, VIX term, post-spike entries), skew-aware strikes (put-side richer), put-heavy shapes (prior lead: put 0.30 45→21 but fragile ±5 days).
5. P2. Defined-risk versions (condor, broken-wing fly, bull put spread) sized to the same worst loss, so return-per-unit-drawdown is compared fairly rather than per lot.
6. P2. Diagonals: sell near, buy far at the same strike (calendar) or a higher delta (diagonal); prior calendars lost, diagonals untested.
7. P3. Long options only when IV is in its bottom decile and realized vol is rising (volatility expansion), straddles into events (Budget, RBI, election) bought N days before, sold the day after. Prior finding: most event-skipping cost money for sellers, so buyers may have something; small sample.
8. P3. Expiry-day behaviour at daily granularity: open-to-close premium decay by moneyness and weekday, Tuesday-expiry regime separately.

**B. Equity cross-sectional (daily/weekly, 2011–2026)**
9. P1. Momentum: rank all liquid NSE stocks by 6- and 12-month return (skip last month), hold top decile, rebalance monthly, turnover-filtered, costs and DP charges in. Compare with the 52-week-high lead already seen (+1% / 20 sessions excess).
10. P1. 52-week-high breakout as a portfolio with slots, ATR stop, time exit, and the ranking rule; this is the costed version of the existing signal.
11. P2. Short-term mean reversion: 3 to 5 day oversold in a long-term uptrend, liquid names, 2 to 5 day hold. Prior pattern tests found no edge for Hammer and Bullish engulfing; the quantitative version is untested.
12. P2. Low-volatility and quality tilts as a hedge sleeve (low realized vol decile, monthly).
13. P3. Sector rotation on NSE sector indices (relative strength, monthly) as an index-futures stand-in.

**C. Index trend and timing (daily, 2011–2026) — prior evidence negative for single indicators**
14. P2. Time-series momentum on NIFTY and BANKNIFTY futures stand-ins, 3 to 12 month lookbacks, both sides, vol-targeted, as a crisis hedge for the premium sleeve rather than a return engine. Judge it by what it does to portfolio drawdown.
15. P3. Overnight vs intraday return decomposition (2011–2026 from daily open/close): is the overnight premium stable and tradable via futures stand-in?

**D. Intraday (1m–1h, one year only) — low confidence by construction**
16. P3. Opening-range and VWAP families re-run under the 09:30–15:00 window with costs; the one-year result is a screen, not evidence. Anything positive waits for the second year of minutes.
17. P3. Index intraday mean reversion around VWAP with the NIFTY future (minutes being back-filled).

**E. Flow and positioning (2012–2026)**
18. P3. FII index-future net position and participant OI extremes as a conditioning variable for A and C (never as a stand-alone signal).

**F. Untestable now, parked with the reason**
19. Intraday option selling (9:20 straddles, expiry-day scalps), gamma scalping, dynamic delta hedging: no option minutes before Nov 2026. Revisit after 6 to 12 months of recorder data.
20. Stock futures and stock options strategies: 2.3 years of data, one regime.
21. Statistical arbitrage and pairs on stock futures: same data limit; pairs on cash equities are long-only and need short futures, so not realistic.

## 7. Roadmap

| Phase | Work | Output | Stop for review? |
|---|---|---|---|
| 1 Data validation | Done in this document, plus: build the data-version stamp; count untraded and stale option rows per year; equity data-break counts; minute coverage per instrument | `data-audit` report, registry entry D-001 | No |
| 2 Regimes | Regime module (section 4.4); NIFTY, BANKNIFTY and VIX regime tables year by year | Regime tables | No |
| 3 Hypotheses | Section 6, frozen as registered experiment plans before running | Experiment plan IDs | **Yes** (you pick priorities) |
| 4 Infrastructure | Section 4 items 1 to 5 (registry, metrics, lab equity curve, validation harness) | Tested modules | No |
| 5 Backtests | Run P1 experiments on train and validation only | Registered results | No |
| 6 Sensitivity | Parameter plateaus and neighbours for anything that passed | Plateau maps | No |
| 7 Walk-forward | Rolling re-fit for survivors | Walk-forward curves | No |
| 8 Out-of-sample | Validation-period results compared with train; drop failures | Survivors list | **Yes** |
| 9 Monte Carlo | Block bootstrap on survivors: drawdown and ruin distributions | Distributions | No |
| 10 Stress | Gap shocks, IV shocks, late fills, missing strikes, 2x slippage | Stress tables | No |
| 11 Portfolio | Combine survivors (section 4.7): correlations, margin budget, allocation, portfolio stop | Portfolio curve | **Yes** |
| 12 Final | Open the holdout once; final report with the 20-item format from the brief | Report | **Yes** |

P2 and P3 experiments follow the same path after P1, in later passes. Heavy runs happen outside market hours (the live feed and recorder share the machine). Nothing in the app UI changes in this programme unless you ask; results stay in files and the report.

## 8. Decisions needed from you

1. Capital base for sizing and drawdown maths: the earlier notes say ₹3 to ₹10 lakh. I will use ₹10 lakh unless you say otherwise; every table also shows per-lot and per-₹1-lakh-margin figures.
2. Agree the holdout: 2024-01 → 2026-11, untouched until Phase 12.
3. Agree the slippage and cost assumptions in section 5 (or give the ones you want).
4. Priority order in section 6: I propose A1–A3 and B9–B10 first.
5. Data purchases are not assumed. If you want intraday option strategies or stock F&O tested over cycles, that needs bought history (NSE historical option minutes or a vendor); say so and I will scope it separately.
6. The read-only audit script `apps/feed/scripts/research/data-audit.ts` was added; nothing else in the repo was changed. The registry and metrics modules in section 4 are additions I will build once you approve Phase 4.
