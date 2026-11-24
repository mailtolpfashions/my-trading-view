# Experiment registry

Generated 2026-11-24 06:58 UTC from apps/feed/.data/research/experiments.jsonl (32 entries). Detail files: apps/feed/.data/research/quant/<id>-*.json.

| ID | Family | Name | Period (role) | Data to | Verdict | Result |
|---|---|---|---|---|---|---|
| E-20261111-001 | P2 | Regime table NIFTY/BANKNIFTY 2011-2026 | 2011-06-22 → 2026-11-09 (other) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | info |  |
| E-20261111-002 | A1 | A1 NIFTY monthly short-premium family: walk-forward, plateau, curve | 2011-01-03 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | fail | Benchmark validation total ₹322909; walk-forward (5y, total) ₹-48825 vs benchmark ₹395894 over 2016–2023. |
| E-20261111-003 | A2 | A2 sizing, loss limits, stress and Monte Carlo for NIFTY monthly premium rules | 2011-01-03 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | fail | No size meets 35% with ≤10% drawdown. Best with DD ≤ 10%: straddle 45→25 top-third book50 (paper) ×1 stop 0% → CAGR 3.72%. |
| E-20261111-004 | A2 | A2 sizing, loss limits, stress and Monte Carlo for NIFTY monthly premium rules | 2011-01-03 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | fail | Supersedes E-20261111-003, whose gap stress was per index unit, not per lot. No size meets 35% with ≤10% drawdown. Best with DD ≤ 10%: straddle 45→25 top-third book50 (paper) ×1 stop 0% → CAGR 3.72%. |
| E-20261111-005 | B10 | B10 52-week-high breakout portfolio, all NSE shares | 2011-09-01 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | fail | Chosen open20 trail4 hold120 none: validation CAGR 16.12% vs NIFTY 14.8%, DD 32.48% vs undefined%. |
| E-20261111-006 | A3 | A3 weekly vs monthly NIFTY premium, 2019–2023 | 2019-02-01 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | lead | Validation median per year: weekly ₹3772, monthly ₹-246. |
| E-20261111-007 | A3 | A3b weekly entry window: NIFTY 2019–23 and BANKNIFTY 2016–23, by year, walk-forward, stress | 2016-06-01 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | lead | Mon→Wed: NIFTY 8/8 settings positive (median ₹59990/yr), Bank Nifty 8/8 (median ₹76945/yr). Chosen NIFTY Tue→Wed s16 high test ₹60440; Bank Tue→exp straddle any test ₹486446. |
| E-20261111-008 | B9 | B9 cross-sectional momentum, monthly rotation, all NSE shares | 2011-09-01 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | fail | Chosen lb63 open10 stop15 skip0: validation CAGR 12.33% vs NIFTY 14.8%, DD 55.88% vs undefined%. |
| E-20261111-009 | B10 | B10 signal check: 52-week-high breakout, mean vs median, liquid stocks | 2011-09-01 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | info | H=20: mean excess 0.54%, median excess 0.06%, beats crowd 45.28% of the time (n=26130). |
| E-20261111-010 | P11 | P11 sizing and combination of the surviving leads on ₹10 lakh | 2019-02-01 → 2023-12-31 (train+validation) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | fail | Highest CAGR with DD ≤ 10% (closes) and margin ≤ 70%: W Tue→Wed s16 high ×3: CAGR 11.24%, DD 5.5%. |
| E-20261111-011 | P12 | P12 holdout 2024-01 → last day: weekly Monday books, monthly benchmark, controls (read once) | 2024-01-01 → 2026-11-09 (holdout) | EOD 2026-11-09, F&O 2026-11-09, git 7163c8e | lead | W (Mon→1 day left, high IV) ₹94576; Wx (Mon→expiry) ₹141602 (Thu-era ₹94085, Tue-era ₹28491); M ₹178685. W×3 holdout CAGR 9.14% DD 12.18%. |
| E-20261116-001 | B9 | B9b momentum with a NIFTY market filter | 2011-09-01 → 2023-12-31 (train+validation) | EOD 2026-11-13, F&O 2026-11-13, git a7fbded | fail | Chosen lb252 open10 stop0 skip0 roc126-keep: validation CAGR 15.96% vs NIFTY 14.8%, DD 44.25% vs 38.44%; 0/24 of its filter pass. |
| E-20261116-002 | B9-final | B9c momentum + NIFTY 100-day filter, one-time final check 2024→ | 2024-01-01 → 2026-11-13 (holdout) | EOD 2026-11-13, F&O 2026-11-13, git a7fbded | fail | Filter family median CAGR -4% / DD 41% vs NIFTY 5.2% / 15.77%; unfiltered median DD 42%. |
| E-20261124-001 | S-scalp | Scalp A1 ORB, ST(5,2) exit | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-002 | S-scalp | Scalp A2 ORB, EMA-band exit | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-003 | S-scalp | Scalp A3 ORB, exit when not strong | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-004 | S-scalp | Scalp A4 ORB + 2nd attempt | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-005 | S-scalp | Scalp B1 pullback, target prior extreme | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-006 | S-scalp | Scalp B2 pullback, ST trail | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-007 | S-scalp | Scalp C3 stretched → back to TWAP | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-008 | S-scalp | Scalp C2 narrow<0.7 TWAP expansion | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-009 | S-scalp | Scalp C1 narrow<0.5 range break | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-010 | S-scalp | Scalp C2 narrow<0.5 TWAP expansion | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-011 | S-scalp | Scalp C1 narrow<0.6 range break | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-012 | S-scalp | Scalp C2 narrow<0.6 TWAP expansion | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-013 | S-scalp | Scalp C1 narrow<0.7 range break | 2023-01-02 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-014 | S-scalp | Scalp breadth: H state change | 2025-11-03 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-015 | S-scalp | Scalp breadth: HM state change | 2025-11-03 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-016 | S-scalp | Scalp breadth: P state change | 2025-11-03 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-017 | S-scalp | Scalp breadth: A1 ORB (same year) | 2025-11-03 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-018 | S-scalp | Scalp breadth: A1 ORB, breadth disagrees | 2025-11-03 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |
| E-20261124-019 | S-scalp | Scalp breadth: A1 ORB, heavy+mid agree | 2025-11-03 → 2026-11-23 (train+validation) | EOD 2026-11-23, F&O 2026-11-23, git c37a281 | fail |  |

## E-20261111-001 — Regime table NIFTY/BANKNIFTY 2011-2026

- Hypothesis: Label every trading day so results can be split by market state (no look-ahead).
- Script: `scripts/research/quant/p2-regimes.ts`
- Ran: 2026-11-11 04:46 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: -; -; charges -
- Params: `{"trend":"close vs SMA200 and 126-day change","vol":"20-day realized vol tercile vs prior 3 years","vix":"INDIA VIX tercile vs prior 3 years","crisis":"CRISIS_TAGS","expiryWeek":"≤6 calendar days before a monthly expiry"}`
- Validation: `{}`
- Caveats: VIX complete only from 2015; vix tercile is null before it has 250 days. The table covers the holdout too; labels only, no results.
- Verdict: **info**. 

## E-20261111-002 — A1 NIFTY monthly short-premium family: walk-forward, plateau, curve

- Hypothesis: Selling monthly NIFTY premium (strangle/straddle, 30–60 days in, 7–28 days out) earns a volatility risk premium that survives when the setting is chosen on past years only.
- Script: `scripts/research/quant/a1-strangle-walkforward.ts`
- Ran: 2026-11-11 04:52 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; ₹1 per option per fill (assumed; no bid/ask history); charges itemised, dated
- Params: `{"grid":{"shape":["s10","s16","s20","s25","s30","straddle"],"daysBefore":[30,38,45,52,60],"daysLeft":[7,14,21,28],"iv":["any","high"]},"benchmark":{"shape":"s25","daysBefore":45,"daysLeft":21,"iv":"high"},"lots":1,"money":"today","missing":"skip","capital":1000000,"walkForwardFit":[5,3],"scores":["total","total / worst MTM"]}`
- Validation: `{"trainValidationSplit":{"train":{"from":"2011-01-01","to":"2018-12-31"},"validation":{"from":"2019-01-01","to":"2023-12-31"},"holdout":{"from":"2024-01-01","to":"2026-12-31"}},"holdoutTouched":false,"placebo":"family distribution (all settings) used as the multiple-testing reference; no random-entry placebo is possible with the lab's schedules","contaminationNote":"This family was studied on the full history in Nov 2026 before this programme; 2019–23 is not a clean test for the benchmark itself. Walk-forward is the honest read."}`
- Caveats: Money scaled to today's index level and lot (money: today). Margin not modelled per trade here (today's SPAN in A2). Strikes from traded closes; untraded settings skipped (counted). Daily closes only: stops or books inside a day cannot be seen. Bid/ask unknown: ₹1 slippage per option is an assumption.
- Verdict: **fail**. Benchmark validation total ₹322909; walk-forward (5y, total) ₹-48825 vs benchmark ₹395894 over 2016–2023.

## E-20261111-003 — A2 sizing, loss limits, stress and Monte Carlo for NIFTY monthly premium rules

- Hypothesis: Some lot size and loss limit gives the premium rules ~35% a year with a drawdown under 10% on ₹10 lakh.
- Script: `scripts/research/quant/a2-sizing-stress.ts`
- Ran: 2026-11-11 04:55 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; ₹1 per option per fill (assumed; no bid/ask history); charges itemised, dated
- Params: `{"rules":["s25 45→21 high (benchmark)","s16 45→21 high","s25 45→21 any","straddle 45→25 top-third book50 (paper)","straddle 60→7 high (A1 most picked)"],"lots":[1,2,3,4],"stopPctOfCapital":[0,3,5],"capital":1000000,"stress":"GAP_SHOCKS at entry, Black-76, IV from each leg's entry price","bootstrap":"2 lots, daily P&L, 20-day blocks, 2,000 draws"}`
- Validation: `{"holdoutTouched":false,"note":"Rules were fixed before this run (benchmark and paper rules from earlier studies, plus A1's most-picked setting); only size and the loss limit vary here."}`
- Caveats: Margin is today's SPAN per lot (estimate for old dates). Loss limits are seen at daily closes, so a real stop can fill well past the limit. Gap stress is a model (Black-76 from entry prices, index as forward, lot-size changes ignored). A one-day-late entry is approximated by entering one calendar day earlier in the schedule. ₹1 slippage assumed; ₹2 and ₹3 shown.
- Verdict: **fail**. No size meets 35% with ≤10% drawdown. Best with DD ≤ 10%: straddle 45→25 top-third book50 (paper) ×1 stop 0% → CAGR 3.72%.

## E-20261111-004 — A2 sizing, loss limits, stress and Monte Carlo for NIFTY monthly premium rules

- Hypothesis: Some lot size and loss limit gives the premium rules ~35% a year with a drawdown under 10% on ₹10 lakh.
- Script: `scripts/research/quant/a2-sizing-stress.ts`
- Ran: 2026-11-11 04:56 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; ₹1 per option per fill (assumed; no bid/ask history); charges itemised, dated
- Params: `{"rules":["s25 45→21 high (benchmark)","s16 45→21 high","s25 45→21 any","straddle 45→25 top-third book50 (paper)","straddle 60→7 high (A1 most picked)"],"lots":[1,2,3,4],"stopPctOfCapital":[0,3,5],"capital":1000000,"stress":"GAP_SHOCKS at entry, Black-76, IV from each leg's entry price","bootstrap":"2 lots, daily P&L, 20-day blocks, 2,000 draws"}`
- Validation: `{"holdoutTouched":false,"note":"Rules were fixed before this run (benchmark and paper rules from earlier studies, plus A1's most-picked setting); only size and the loss limit vary here."}`
- Caveats: Margin is today's SPAN per lot (estimate for old dates). Loss limits are seen at daily closes, so a real stop can fill well past the limit. Gap stress is a model (Black-76 from entry prices, index as forward, lot-size changes ignored). A one-day-late entry is approximated by entering one calendar day earlier in the schedule. ₹1 slippage assumed; ₹2 and ₹3 shown.
- Verdict: **fail**. Supersedes E-20261111-003, whose gap stress was per index unit, not per lot. No size meets 35% with ≤10% drawdown. Best with DD ≤ 10%: straddle 45→25 top-third book50 (paper) ×1 stop 0% → CAGR 3.72%.

## E-20261111-005 — B10 52-week-high breakout portfolio, all NSE shares

- Hypothesis: Buying 52-week-high breakouts in liquid stocks with an ATR trail and a time exit beats NIFTY after costs with a smaller drawdown.
- Script: `scripts/research/quant/b10-52w-breakout.ts`
- Ran: 2026-11-11 04:57 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; 0.03% a side (assumed) on stocks with ≥ ₹10 crore average turnover; charges itemised, dated
- Params: `{"entry":"CLOSE > HIGHEST(HIGH,252)[1] AND CLOSE > 20","rank":"ROC(CLOSE,126)","minAvgTurnoverCr":10,"sizing":"100/maxOpen % of equity","cooldownBars":20,"grid":{"maxOpen":[5,10,20],"trail":[2,3,4],"maxBars":[40,60,120],"exitRule":["none","sma50"]},"chosenOnTrainBy":"Calmar (≥100 train trades)","capital":1000000,"universe":"2700 NSE equity shares incl. delisted, ever ≥ ₹5 cr a day"}`
- Validation: `{"trainValidationSplit":{"train":{"from":"2011-01-01","to":"2018-12-31"},"validation":{"from":"2019-01-01","to":"2023-12-31"},"holdout":{"from":"2024-01-01","to":"2026-12-31"}},"holdoutTouched":false,"selection":"single choice on train (Calmar), validation read once","survivorship":"none: all shares incl. delisted; liquidity point-in-time","placebo":"family distribution across 54 settings; NIFTY buy-and-hold as the crowd"}`
- Caveats: Slippage 0.03% a side is an assumption. Signals at close, fills next open; a gap through the trail fills at the open. Percent-of-equity sizing compounds, so later years weigh more in rupee terms; CAGR per period is from the curve slice. 274 trades across settings span an unadjusted corporate action (flagged by the engine).
- Verdict: **fail**. Chosen open20 trail4 hold120 none: validation CAGR 16.12% vs NIFTY 14.8%, DD 32.48% vs undefined%.

## E-20261111-006 — A3 weekly vs monthly NIFTY premium, 2019–2023

- Hypothesis: Weekly expiries, traded every week, harvest more premium per year than monthly 45→21 at a comparable worst loss.
- Script: `scripts/research/quant/a3-weekly-vs-monthly.ts`
- Ran: 2026-11-11 04:57 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; ₹1 per option per fill (assumed; no bid/ask history); charges itemised, dated
- Params: `{"shapes":["s10","s16","s25","straddle"],"weekly":{"daysBefore":[7,4],"daysLeft":["expiry",1,2]},"monthly":[[45,21],[38,14],[30,7]],"iv":["any","high"],"lots":1,"money":"today","capital":1000000,"split":"2021-12-31"}`
- Validation: `{"split":{"train":"2019-02-01→2021-12-31","validation":"2022-01-01→2023-12-31"},"holdoutTouched":false,"note":"Short window (5 years); the Nov 2024 regime change (one weekly per exchange) is in the holdout."}`
- Caveats: Daily closes: a weekly trade is marked once a day; intraday blow-ups on expiry day are invisible. Weekly strikes 7 days out often have thin trading before 2021; skipped entries counted. Money at today's size. ₹1 slippage assumed.
- Verdict: **lead**. Validation median per year: weekly ₹3772, monthly ₹-246.

## E-20261111-007 — A3b weekly entry window: NIFTY 2019–23 and BANKNIFTY 2016–23, by year, walk-forward, stress

- Hypothesis: Short weekly strangles entered at Monday's close and closed Wednesday earn premium in most years on both indices; Thursday/Friday entries do not.
- Script: `scripts/research/quant/a3b-weekly-window.ts`
- Ran: 2026-11-11 05:01 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; ₹1 per option per fill (assumed; no bid/ask history); charges itemised, dated
- Params: `{"windows":["Fri→exp","Fri→Wed","Fri→Tue","Mon→exp","Mon→Wed","Mon→Tue","Tue→exp","Tue→Wed","Wed→exp"],"shapes":["s10","s16","s25","straddle"],"iv":["any","high"],"slippage":{"NIFTY":1,"BANKNIFTY":2},"lots":1,"money":"today","capital":1000000,"walkForwardFit":2}`
- Validation: `{"holdoutTouched":false,"independentSample":"BANKNIFTY 2016–2018 predates NIFTY weeklies","selection":"chosen on the first 60% of years, read on the rest; walk-forward 2-year fit; plateau across adjacent windows","note":"NIFTY has only 5 years of weeklies before the holdout."}`
- Caveats: Daily closes: the worst loss inside a day is not seen; a 2-day weekly position can lose far more than its close-to-close marks. Gap stress is a model; the gap counts are real. Thin trading on far strikes early in each series: skipped entries are counted per setting. Money at today's size; margin is today's SPAN.
- Verdict: **lead**. Mon→Wed: NIFTY 8/8 settings positive (median ₹59990/yr), Bank Nifty 8/8 (median ₹76945/yr). Chosen NIFTY Tue→Wed s16 high test ₹60440; Bank Tue→exp straddle any test ₹486446.

## E-20261111-008 — B9 cross-sectional momentum, monthly rotation, all NSE shares

- Hypothesis: The highest 3/6/12-month-momentum liquid stocks, rotated monthly, beat NIFTY after costs.
- Script: `scripts/research/quant/b9-momentum.ts`
- Ran: 2026-11-11 05:01 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; 0.03% a side (assumed) on stocks with ≥ ₹10 crore average turnover; charges itemised, dated
- Params: `{"entry":"momentum > 0 AND CLOSE > SMA200 AND CLOSE > 20","rank":"momentum","hold":"21 sessions","minAvgTurnoverCr":10,"grid":{"lookback":[63,126,252],"maxOpen":[10,20],"stopPct":[0,15],"skipMonth":[0,1]},"chosenOnTrainBy":"Calmar","capital":1000000,"universe":"2700 NSE equity shares incl. delisted"}`
- Validation: `{"trainValidationSplit":{"train":{"from":"2011-01-01","to":"2018-12-31"},"validation":{"from":"2019-01-01","to":"2023-12-31"},"holdout":{"from":"2024-01-01","to":"2026-12-31"}},"holdoutTouched":false,"selection":"single choice on train (Calmar)","survivorship":"none","placebo":"family distribution across 24 settings; NIFTY as the crowd"}`
- Caveats: Rotation is approximated: each holding exits after 21 sessions and re-enters only if it still ranks; not a true top-decile rebalance. Slippage 0.03% a side assumed. Percent-of-equity sizing compounds.
- Verdict: **fail**. Chosen lb63 open10 stop15 skip0: validation CAGR 12.33% vs NIFTY 14.8%, DD 55.88% vs undefined%.

## E-20261111-009 — B10 signal check: 52-week-high breakout, mean vs median, liquid stocks

- Hypothesis: The breakout signal's +1% average excess per 20 sessions holds at the median, not only in the mean.
- Script: `scripts/research/quant/b10-signal-check.ts`
- Ran: 2026-11-11 05:02 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: -; not applied; cost estimate shown; charges not applied
- Params: `{"signal":"CLOSE > HIGHEST(HIGH,252)[1]","liquidity":"AVG_TURNOVER(20) ≥ ₹10 cr, close > 20","horizons":[5,20,60],"crowd":"all liquid stock-days on the same date","roundTripCostEstimate":0.0035}`
- Validation: `{"holdoutTouched":false,"breaks":"events whose window crosses a data break are dropped"}`
- Caveats: Raw signal study, overlapping windows, no position limits. Crowd = every liquid stock-day, so the comparison already removes the market's drift.
- Verdict: **info**. H=20: mean excess 0.54%, median excess 0.06%, beats crowd 45.28% of the time (n=26130).

## E-20261111-010 — P11 sizing and combination of the surviving leads on ₹10 lakh

- Hypothesis: Combining the weekly window lead with the monthly premium rule gives a better return per unit of drawdown than either alone.
- Script: `scripts/research/quant/p11-portfolio.ts`
- Ran: 2026-11-11 05:03 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; ₹1 per option per fill (assumed; no bid/ask history); charges itemised, dated
- Params: `{"books":{"W Tue→Wed s16 high":{"trades":125,"marginPerLot":177466,"from":"2019-02-01"},"W2 Mon→exp s16 high":{"trades":125,"marginPerLot":177466,"from":"2019-02-01"},"W3 Tue→Wed s16 any":{"trades":253,"marginPerLot":177466,"from":"2019-02-01"},"M s25 45→21 high":{"trades":74,"marginPerLot":175608,"from":"2011-01-03"}},"lots":[1,2,3,4],"combos":["W×2 + M×1","W×3","W×2 + W2×1","W×1 + W2×1 + M×1"],"capital":1000000}`
- Validation: `{"holdoutTouched":false,"note":"W was chosen on 2019–21 in A3b; M is the hindsight benchmark; W2 is the Bank Nifty 8/8 window applied to NIFTY (not chosen on NIFTY data)."}`
- Caveats: Drawdowns are from daily closes; a weekly short strangle can lose several times its close-to-close mark inside a day or on a gap (see gap % of capital). Margin today's SPAN; Bank Nifty weeklies no longer exist (SEBI, Nov 2024), so only the NIFTY books are tradable. Money at today's size; ₹1 slippage.
- Verdict: **fail**. Highest CAGR with DD ≤ 10% (closes) and margin ≤ 70%: W Tue→Wed s16 high ×3: CAGR 11.24%, DD 5.5%.

## E-20261111-011 — P12 holdout 2024-01 → last day: weekly Monday books, monthly benchmark, controls (read once)

- Hypothesis: The Monday-close weekly premium window and the monthly benchmark hold up on years never used for any choice.
- Script: `scripts/research/quant/p12-holdout.ts`
- Ran: 2026-11-11 05:13 UTC; data: EOD to 2026-11-09, F&O 2011-01-03 → 2026-11-09, minutes to 2026-11, commit 7163c8e
- Costs: zerodha; ₹1 per option per fill (assumed; no bid/ask history); charges itemised, dated
- Params: `{"books":{"W Mon→1 day left s16 high":{"role":"book","schedule":{"every":"week","weekday":1,"expiry":"weekly"},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"high","exit":{"daysLeft":1}},"Wx Mon→expiry s16 high":{"role":"book","schedule":{"every":"week","weekday":1,"expiry":"weekly"},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"high","exit":{}},"Wl literal 4→1 s16 high":{"role":"book","schedule":{"every":"expiry","cycle":"weekly","daysBefore":4},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"high","exit":{"daysLeft":1}},"M s25 45→21 high":{"role":"book","schedule":{"every":"expiry","cycle":"monthly","daysBefore":45},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.25}","SELL PE {\"by\":\"delta\",\"delta\":0.25}"],"iv":"high","exit":{"daysLeft":21}},"W Mon→1 day left s16 any":{"role":"control","schedule":{"every":"week","weekday":1,"expiry":"weekly"},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"any","exit":{"daysLeft":1}},"Wx Mon→expiry s16 any":{"role":"control","schedule":{"every":"week","weekday":1,"expiry":"weekly"},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"any","exit":{}},"Wx Mon→expiry s25 high":{"role":"control","schedule":{"every":"week","weekday":1,"expiry":"weekly"},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.25}","SELL PE {\"by\":\"delta\",\"delta\":0.25}"],"iv":"high","exit":{}},"C Fri→2 days left s16 any":{"role":"control","schedule":{"every":"week","weekday":5,"expiry":"weekly"},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"any","exit":{"daysLeft":2}},"C Thu→expiry s16 any":{"role":"control","schedule":{"every":"week","weekday":4,"expiry":"weekly"},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"any","exit":{}},"C M straddle 60→7 high":{"role":"control","schedule":{"every":"expiry","cycle":"monthly","daysBefore":60},"legs":["SELL CE {\"by\":\"forward\"}","SELL PE {\"by\":\"forward\"}"],"iv":"high","exit":{"daysLeft":7}},"C M s25 45→21 any":{"role":"control","schedule":{"every":"expiry","cycle":"monthly","daysBefore":45},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.25}","SELL PE {\"by\":\"delta\",\"delta\":0.25}"],"iv":"any","exit":{"daysLeft":21}},"C M s16 45→21 high":{"role":"control","schedule":{"every":"expiry","cycle":"monthly","daysBefore":45},"legs":["SELL CE {\"by\":\"delta\",\"delta\":0.16}","SELL PE {\"by\":\"delta\",\"delta\":0.16}"],"iv":"high","exit":{"daysLeft":21}}},"sized":["W×3","Wx×3","W×2 + M×1","Wx×2 + M×1","M×1"],"capital":1000000,"firstTuesdayExpiryMonth":"2025-09"}`
- Validation: `{"holdoutTouched":true,"readOnce":true,"fixedBefore":"books and controls fixed in docs/quant/02-results-phase5-11.md and this script before HOLDOUT_UNLOCK was set","labelCorrection":"A3b labels: daysBefore 3 was a Monday entry for Thursday expiries (same as daysBefore 4); the lead is the Monday-close entry"}`
- Caveats: Daily closes only. NIFTY weekly expiry moved to Tuesday in 2025: the Mon→1-day-left book cannot trade a Tuesday expiry (entry day = exit day), so its Tuesday-era rows are skips; Wx (Monday → expiry) is the 1-night version there. Money at today's size; ₹1 slippage assumed; gap stress is a model.
- Verdict: **lead**. W (Mon→1 day left, high IV) ₹94576; Wx (Mon→expiry) ₹141602 (Thu-era ₹94085, Tue-era ₹28491); M ₹178685. W×3 holdout CAGR 9.14% DD 12.18%.

## E-20261116-001 — B9b momentum with a NIFTY market filter

- Hypothesis: A NIFTY trend filter (or volatility scaling) keeps most of B9's return while cutting its 35–65% drawdowns below 25%.
- Script: `scripts/research/quant/b9b-momentum-filter.ts`
- Ran: 2026-11-16 12:22 UTC; data: EOD to 2026-11-13, F&O 2011-01-03 → 2026-11-13, minutes to 2026-11, commit a7fbded
- Costs: zerodha; 0.03% a side (assumed) on stocks with ≥ ₹10 crore average turnover; charges itemised, dated
- Params: `{"base":"B9 (E-20261111-008) settings","filters":{"none":null,"sma200-keep":{"symbol":"NIFTY","rule":"CLOSE > SMA(CLOSE, 200)","whenOff":"keep"},"sma200-sell":{"symbol":"NIFTY","rule":"CLOSE > SMA(CLOSE, 200)","whenOff":"sell-all"},"sma100-keep":{"symbol":"NIFTY","rule":"CLOSE > SMA(CLOSE, 100)","whenOff":"keep"},"sma100-sell":{"symbol":"NIFTY","rule":"CLOSE > SMA(CLOSE, 100)","whenOff":"sell-all"},"roc126-keep":{"symbol":"NIFTY","rule":"ROC(CLOSE, 126) > 0","whenOff":"keep"},"roc126-sell":{"symbol":"NIFTY","rule":"ROC(CLOSE, 126) > 0","whenOff":"sell-all"},"vol":{"symbol":"NIFTY","sizeScale":"MIN(1, 15 / HV(20))","whenOff":"keep"},"sma200-keep-vol":{"symbol":"NIFTY","rule":"CLOSE > SMA(CLOSE, 200)","sizeScale":"MIN(1, 15 / HV(20))","whenOff":"keep"}},"grid":{"lookback":[63,126,252],"maxOpen":[10,20],"stopPct":[0,15],"skipMonth":[0,1],"filter":["none","sma200-keep","sma200-sell","sma100-keep","sma100-sell","roc126-keep","roc126-sell","vol","sma200-keep-vol"]},"chosenOnTrainBy":"Calmar","capital":1000000,"universe":"2705 NSE equity shares incl. delisted","passMark":"validation CAGR > NIFTY, max DD < 25%, and at least 12 of the chosen filter's 24 settings do the same"}`
- Validation: `{"trainValidationSplit":{"train":{"from":"2011-01-01","to":"2018-12-31"},"validation":{"from":"2019-01-01","to":"2023-12-31"},"holdout":{"from":"2024-01-01","to":"2026-12-31"}},"holdoutTouched":false,"selection":"single choice on train (Calmar) over all filters × settings","survivorship":"none","placebo":"each filter across the same 24 base settings; NIFTY as the crowd"}`
- Caveats: Rotation is approximated: each holding exits after 21 sessions and re-enters only if it still ranks. Slippage 0.03% a side assumed. Filter read at the same close as the stock signal; orders fill next open. Sell-all exits pay full charges and slippage at the next open.
- Verdict: **fail**. Chosen lb252 open10 stop0 skip0 roc126-keep: validation CAGR 15.96% vs NIFTY 14.8%, DD 44.25% vs 38.44%; 0/24 of its filter pass.

## E-20261116-002 — B9c momentum + NIFTY 100-day filter, one-time final check 2024→

- Hypothesis: The NIFTY-above-100-day filter that cut 2019–2023 drawdowns (B9b) also does so on unseen 2024–2026 data.
- Script: `scripts/research/quant/b9c-holdout.ts`
- Ran: 2026-11-16 12:43 UTC; data: EOD to 2026-11-13, F&O 2011-01-03 → 2026-11-13, minutes to 2026-11, commit a7fbded
- Costs: zerodha; 0.03% a side (assumed) on stocks with ≥ ₹10 crore average turnover; charges itemised, dated
- Params: `{"filters":{"none":null,"sma100-keep":{"symbol":"NIFTY","rule":"CLOSE > SMA(CLOSE, 100)","whenOff":"keep"},"sma100-sell":{"symbol":"NIFTY","rule":"CLOSE > SMA(CLOSE, 100)","whenOff":"sell-all"}},"grid":{"lookback":[63,126,252],"maxOpen":[10,20],"stopPct":[0,15],"skipMonth":[0,1],"filter":["none","sma100-keep","sma100-sell"]},"capital":1000000,"passMark":"filter family median CAGR > NIFTY, median DD < 25%, and below the unfiltered control"}`
- Validation: `{"holdoutTouched":true,"runs":"once, no tuning","pickedFrom":"E-20261116-001 (seen on 2019–2023, so this is the only fair test)"}`
- Caveats: Under 3 years of data; one market phase. Slippage 0.03% a side assumed.
- Verdict: **fail**. Filter family median CAGR -4% / DD 41% vs NIFTY 5.2% / 15.77%; unfiltered median DD 42%.

## E-20261124-001 — Scalp A1 ORB, ST(5,2) exit

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"A1 ORB, ST(5,2) exit","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":218,"spotAvg":-3.15,"buyerNetAvg":-3.47,"sellerNetAvg":-5.01,"buyerRsPerLot":-49148,"sellerRsPerLot":-71001,"buyerWin":0.3,"sellerWin":0.33},"dev":{"n":725,"spotAvg":-2.16,"buyerNetAvg":-2.76,"sellerNetAvg":-4.6,"buyerRsPerLot":-122586,"sellerRsPerLot":-200530,"buyerWin":0.34,"sellerWin":0.35}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-002 — Scalp A2 ORB, EMA-band exit

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"A2 ORB, EMA-band exit","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":218,"spotAvg":-4.18,"buyerNetAvg":-4.2,"sellerNetAvg":-5.32,"buyerRsPerLot":-59526,"sellerRsPerLot":-75323,"buyerWin":0.29,"sellerWin":0.31},"dev":{"n":725,"spotAvg":-3.36,"buyerNetAvg":-3.59,"sellerNetAvg":-5.21,"buyerRsPerLot":-156996,"sellerRsPerLot":-229226,"buyerWin":0.32,"sellerWin":0.34}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-003 — Scalp A3 ORB, exit when not strong

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"A3 ORB, exit when not strong","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":218,"spotAvg":-4.88,"buyerNetAvg":-5.03,"sellerNetAvg":-5.33,"buyerRsPerLot":-71233,"sellerRsPerLot":-75556,"buyerWin":0.26,"sellerWin":0.26},"dev":{"n":725,"spotAvg":-0.59,"buyerNetAvg":-2.19,"sellerNetAvg":-3.04,"buyerRsPerLot":-91008,"sellerRsPerLot":-129478,"buyerWin":0.31,"sellerWin":0.32}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-004 — Scalp A4 ORB + 2nd attempt

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"A4 ORB + 2nd attempt","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":218,"spotAvg":-3.15,"buyerNetAvg":-3.47,"sellerNetAvg":-5.01,"buyerRsPerLot":-49148,"sellerRsPerLot":-71001,"buyerWin":0.3,"sellerWin":0.33},"dev":{"n":749,"spotAvg":-2.07,"buyerNetAvg":-2.69,"sellerNetAvg":-4.6,"buyerRsPerLot":-117441,"sellerRsPerLot":-201637,"buyerWin":0.33,"sellerWin":0.35}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-005 — Scalp B1 pullback, target prior extreme

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"B1 pullback, target prior extreme","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":78,"spotAvg":0.36,"buyerNetAvg":-1.99,"sellerNetAvg":-2.1,"buyerRsPerLot":-10096,"sellerRsPerLot":-10646,"buyerWin":0.55,"sellerWin":0.55},"dev":{"n":241,"spotAvg":-0.15,"buyerNetAvg":-2.11,"sellerNetAvg":-2.17,"buyerRsPerLot":-31506,"sellerRsPerLot":-31740,"buyerWin":0.58,"sellerWin":0.59}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-006 — Scalp B2 pullback, ST trail

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"B2 pullback, ST trail","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":78,"spotAvg":-3.14,"buyerNetAvg":-3.83,"sellerNetAvg":-4.46,"buyerRsPerLot":-19423,"sellerRsPerLot":-22610,"buyerWin":0.19,"sellerWin":0.21},"dev":{"n":241,"spotAvg":-1.88,"buyerNetAvg":-3.08,"sellerNetAvg":-3.24,"buyerRsPerLot":-48762,"sellerRsPerLot":-50729,"buyerWin":0.26,"sellerWin":0.29}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-007 — Scalp C3 stretched → back to TWAP

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"C3 stretched → back to TWAP","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":51,"spotAvg":2.36,"buyerNetAvg":-0.17,"sellerNetAvg":-1.52,"buyerRsPerLot":-578,"sellerRsPerLot":-5025,"buyerWin":0.51,"sellerWin":0.55},"dev":{"n":127,"spotAvg":-4.54,"buyerNetAvg":-4.66,"sellerNetAvg":-5.22,"buyerRsPerLot":-27088,"sellerRsPerLot":-32997,"buyerWin":0.36,"sellerWin":0.4}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-008 — Scalp C2 narrow<0.7 TWAP expansion

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"C2 narrow<0.7 TWAP expansion","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":39,"spotAvg":-1.32,"buyerNetAvg":-2.92,"sellerNetAvg":-2.73,"buyerRsPerLot":-7403,"sellerRsPerLot":-6917,"buyerWin":0.38,"sellerWin":0.38},"dev":{"n":128,"spotAvg":2.79,"buyerNetAvg":0.15,"sellerNetAvg":-1.11,"buyerRsPerLot":-9413,"sellerRsPerLot":-17183,"buyerWin":0.34,"sellerWin":0.38}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-009 — Scalp C1 narrow<0.5 range break

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"C1 narrow<0.5 range break","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":22,"spotAvg":-16.85,"buyerNetAvg":-11.95,"sellerNetAvg":-12.17,"buyerRsPerLot":-17088,"sellerRsPerLot":-17408,"buyerWin":0.18,"sellerWin":0.23},"dev":{"n":44,"spotAvg":3.05,"buyerNetAvg":0.2,"sellerNetAvg":-0.37,"buyerRsPerLot":4025,"sellerRsPerLot":2218,"buyerWin":0.41,"sellerWin":0.41}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-010 — Scalp C2 narrow<0.5 TWAP expansion

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"C2 narrow<0.5 TWAP expansion","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":18,"spotAvg":-8.82,"buyerNetAvg":-7.15,"sellerNetAvg":-7.1,"buyerRsPerLot":-8371,"sellerRsPerLot":-8307,"buyerWin":0.33,"sellerWin":0.33},"dev":{"n":38,"spotAvg":7.39,"buyerNetAvg":2.93,"sellerNetAvg":2.51,"buyerRsPerLot":10990,"sellerRsPerLot":9786,"buyerWin":0.42,"sellerWin":0.42}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-011 — Scalp C1 narrow<0.6 range break

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"C1 narrow<0.6 range break","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":33,"spotAvg":-3.54,"buyerNetAvg":-4.17,"sellerNetAvg":-4.83,"buyerRsPerLot":-8935,"sellerRsPerLot":-10352,"buyerWin":0.3,"sellerWin":0.33},"dev":{"n":77,"spotAvg":3.02,"buyerNetAvg":0.55,"sellerNetAvg":-1.27,"buyerRsPerLot":-1841,"sellerRsPerLot":-7754,"buyerWin":0.4,"sellerWin":0.4}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-012 — Scalp C2 narrow<0.6 TWAP expansion

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"C2 narrow<0.6 TWAP expansion","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":27,"spotAvg":-1.58,"buyerNetAvg":-3.07,"sellerNetAvg":-2.65,"buyerRsPerLot":-5380,"sellerRsPerLot":-4652,"buyerWin":0.41,"sellerWin":0.41},"dev":{"n":91,"spotAvg":4.54,"buyerNetAvg":1.43,"sellerNetAvg":-0.28,"buyerRsPerLot":1919,"sellerRsPerLot":-5474,"buyerWin":0.37,"sellerWin":0.4}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-013 — Scalp C1 narrow<0.7 range break

- Hypothesis: A "Long and the Short" scalping-series setup (part 5), as fixed rules on NIFTY spot 3-min bars, makes money on the 1-ITM weekly option after costs, as buyer or seller.
- Script: `scripts/research/scalp/setups.ts + options-estimate.ts`
- Ran: 2026-11-24 06:51 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill (real recorded spread mean 0.46 pt); charges itemised, dated
- Params: `{"setup":"C1 narrow<0.7 range break","bars":"3m NIFTY spot","entryWindow":"9:30–14:45 bar open","exitBy":"15:00","strike":"1 ITM vs forward (round 100)","expiry":"nearest weekly; next on 0 DTE (both) / 1 DTE (buyer)"}`
- Validation: `{"rulesBuiltOn":"2023–2025","holdout2026":{"n":47,"spotAvg":3.14,"buyerNetAvg":-0.13,"sellerNetAvg":-1.07,"buyerRsPerLot":-405,"sellerRsPerLot":-3263,"buyerWin":0.38,"sellerWin":0.4},"dev":{"n":136,"spotAvg":-1.37,"buyerNetAvg":-2.4,"sellerNetAvg":-3.91,"buyerRsPerLot":-25799,"sellerRsPerLot":-38782,"buyerWin":0.35,"sellerWin":0.35}}`
- Caveats: Option prices are a Black-76 estimate (day IV held fixed); on 2 recorded days the 30-min change was within ~1 pt on average, ±6 pt per trade Spot index minutes (no futures before 2026-11) 2023 minute high/low slightly narrower than daily on 60 days
- Verdict: **fail**. 

## E-20261124-014 — Scalp breadth: H state change

- Hypothesis: Weighted advance–decline lines of NIFTY 50 tiers (series part 4) give NIFTY scalp signals or improve the opening-range breakout, after option costs.
- Script: `scripts/research/scalp/breadth.ts + options-estimate.ts`
- Ran: 2026-11-24 06:58 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill; charges itemised, dated
- Params: `{"setup":"H state change","weights":"least squares on 1-min returns since 2026-09-24, R² 0.908","tiers":"heavy ≥2%, mid 1–2%, light <1%","state":"line vs its running mean since 9:15"}`
- Validation: `{"build202511to202605":{"n":592,"spotAvg":4.31,"buyerNetAvg":1.08,"sellerNetAvg":-0.62,"buyerRsPerLot":38040,"sellerRsPerLot":-27091},"check202606to202611":{"n":373,"spotAvg":-0.88,"buyerNetAvg":-2.44,"sellerNetAvg":-3.19,"buyerRsPerLot":-59068,"sellerRsPerLot":-77333}}`
- Caveats: Only ~1 year of stock minutes Today's members and estimated weights used for the whole year Option prices are an estimate P state change = price vs its TWAP, the no-breadth baseline
- Verdict: **fail**. 

## E-20261124-015 — Scalp breadth: HM state change

- Hypothesis: Weighted advance–decline lines of NIFTY 50 tiers (series part 4) give NIFTY scalp signals or improve the opening-range breakout, after option costs.
- Script: `scripts/research/scalp/breadth.ts + options-estimate.ts`
- Ran: 2026-11-24 06:58 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill; charges itemised, dated
- Params: `{"setup":"HM state change","weights":"least squares on 1-min returns since 2026-09-24, R² 0.908","tiers":"heavy ≥2%, mid 1–2%, light <1%","state":"line vs its running mean since 9:15"}`
- Validation: `{"build202511to202605":{"n":651,"spotAvg":3.32,"buyerNetAvg":0.47,"sellerNetAvg":-0.86,"buyerRsPerLot":19749,"sellerRsPerLot":-36973},"check202606to202611":{"n":428,"spotAvg":0.81,"buyerNetAvg":-0.93,"sellerNetAvg":-2.5,"buyerRsPerLot":-25765,"sellerRsPerLot":-69685}}`
- Caveats: Only ~1 year of stock minutes Today's members and estimated weights used for the whole year Option prices are an estimate P state change = price vs its TWAP, the no-breadth baseline
- Verdict: **fail**. 

## E-20261124-016 — Scalp breadth: P state change

- Hypothesis: Weighted advance–decline lines of NIFTY 50 tiers (series part 4) give NIFTY scalp signals or improve the opening-range breakout, after option costs.
- Script: `scripts/research/scalp/breadth.ts + options-estimate.ts`
- Ran: 2026-11-24 06:58 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill; charges itemised, dated
- Params: `{"setup":"P state change","weights":"least squares on 1-min returns since 2026-09-24, R² 0.908","tiers":"heavy ≥2%, mid 1–2%, light <1%","state":"line vs its running mean since 9:15"}`
- Validation: `{"build202511to202605":{"n":550,"spotAvg":5.3,"buyerNetAvg":1.4,"sellerNetAvg":0.18,"buyerRsPerLot":50084,"sellerRsPerLot":6000},"check202606to202611":{"n":474,"spotAvg":1.26,"buyerNetAvg":-0.84,"sellerNetAvg":-2.04,"buyerRsPerLot":-25918,"sellerRsPerLot":-62888}}`
- Caveats: Only ~1 year of stock minutes Today's members and estimated weights used for the whole year Option prices are an estimate P state change = price vs its TWAP, the no-breadth baseline
- Verdict: **fail**. 

## E-20261124-017 — Scalp breadth: A1 ORB (same year)

- Hypothesis: Weighted advance–decline lines of NIFTY 50 tiers (series part 4) give NIFTY scalp signals or improve the opening-range breakout, after option costs.
- Script: `scripts/research/scalp/breadth.ts + options-estimate.ts`
- Ran: 2026-11-24 06:58 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill; charges itemised, dated
- Params: `{"setup":"A1 ORB (same year)","weights":"least squares on 1-min returns since 2026-09-24, R² 0.908","tiers":"heavy ≥2%, mid 1–2%, light <1%","state":"line vs its running mean since 9:15"}`
- Validation: `{"build202511to202605":{"n":140,"spotAvg":-2.43,"buyerNetAvg":-2.87,"sellerNetAvg":-4.61,"buyerRsPerLot":-26998,"sellerRsPerLot":-43213},"check202606to202611":{"n":119,"spotAvg":-2.15,"buyerNetAvg":-2.82,"sellerNetAvg":-4.39,"buyerRsPerLot":-21819,"sellerRsPerLot":-33978}}`
- Caveats: Only ~1 year of stock minutes Today's members and estimated weights used for the whole year Option prices are an estimate P state change = price vs its TWAP, the no-breadth baseline
- Verdict: **fail**. 

## E-20261124-018 — Scalp breadth: A1 ORB, breadth disagrees

- Hypothesis: Weighted advance–decline lines of NIFTY 50 tiers (series part 4) give NIFTY scalp signals or improve the opening-range breakout, after option costs.
- Script: `scripts/research/scalp/breadth.ts + options-estimate.ts`
- Ran: 2026-11-24 06:58 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill; charges itemised, dated
- Params: `{"setup":"A1 ORB, breadth disagrees","weights":"least squares on 1-min returns since 2026-09-24, R² 0.908","tiers":"heavy ≥2%, mid 1–2%, light <1%","state":"line vs its running mean since 9:15"}`
- Validation: `{"build202511to202605":{"n":14,"spotAvg":6.22,"buyerNetAvg":1.33,"sellerNetAvg":0.24,"buyerRsPerLot":317,"sellerRsPerLot":-744},"check202606to202611":{"n":28,"spotAvg":-6.74,"buyerNetAvg":-6.37,"sellerNetAvg":-6.31,"buyerRsPerLot":-11597,"sellerRsPerLot":-11491}}`
- Caveats: Only ~1 year of stock minutes Today's members and estimated weights used for the whole year Option prices are an estimate P state change = price vs its TWAP, the no-breadth baseline
- Verdict: **fail**. 

## E-20261124-019 — Scalp breadth: A1 ORB, heavy+mid agree

- Hypothesis: Weighted advance–decline lines of NIFTY 50 tiers (series part 4) give NIFTY scalp signals or improve the opening-range breakout, after option costs.
- Script: `scripts/research/scalp/breadth.ts + options-estimate.ts`
- Ran: 2026-11-24 06:58 UTC; data: EOD to 2026-11-23, F&O 2011-01-03 → 2026-11-23, minutes to 2026-11, commit c37a281
- Costs: zerodha; 0.5 pt per option fill; charges itemised, dated
- Params: `{"setup":"A1 ORB, heavy+mid agree","weights":"least squares on 1-min returns since 2026-09-24, R² 0.908","tiers":"heavy ≥2%, mid 1–2%, light <1%","state":"line vs its running mean since 9:15"}`
- Validation: `{"build202511to202605":{"n":126,"spotAvg":-3.4,"buyerNetAvg":-3.34,"sellerNetAvg":-5.15,"buyerRsPerLot":-27315,"sellerRsPerLot":-42468},"check202606to202611":{"n":91,"spotAvg":-0.73,"buyerNetAvg":-1.73,"sellerNetAvg":-3.8,"buyerRsPerLot":-10222,"sellerRsPerLot":-22487}}`
- Caveats: Only ~1 year of stock minutes Today's members and estimated weights used for the whole year Option prices are an estimate P state change = price vs its TWAP, the no-breadth baseline
- Verdict: **fail**. 
