# 05 — Intraday option selling on real NSE prices

Date: 2026-11-24. Script: `apps/feed/scripts/research/scalp/intraday-sell.ts`. Registry: E-20261124-020 … 024.

## Verdict
- **Selling every day:** the at-the-money NIFTY weekly straddle, sold at the open and bought back at the close, earns about as much as it costs to trade. At ₹1 slippage per fill it makes about ₹1.1 lakh a year per lot; at ₹3 it makes about nothing.
- **Expiry day (0 DTE) only:** this is the one case that holds up. It is positive in 8 of 8 years at ₹1 slippage and in 7 of 8 at ₹3. It is a **lead, not a rule yet**: the entry is the 9:15 open, outside the 9:30–15:00 window, and the real cost of filling at the open is unknown.

## Method
- **Data:** real prices from NSE's daily option file (FnoEod) for NIFTY weekly options, 2019-02-11 → 2026-11-23. That is 1,928 days, 407 of them expiry days.
- **Trade:** sell at the day's **open** (the first trade, 9:15); buy back at the **close**.
- **Stops:** a leg stop counts as hit when the leg's day **high** reaches it. The open is the first trade, so that high came after entry. The time of the stop is not known.
- **Strikes:** at the money = the strike nearest the NIFTY open; the strangle is ±100 pts.
- **Costs:** Zerodha charges (dated), plus ₹1 slippage per fill (₹3 stress run; stop fills +₹2).
- **Money:** ₹ per lot of 65 at today's index level.
- **Margin:** about ₹2.5 lakh per lot for the straddle (NSE SPAN + exposure, 2026-11-23), more on expiry day.

## Every day (₹ a year per lot)
| | ₹1 slippage | ₹3 slippage | Worst day | Max drawdown (₹1) |
|---|---|---|---|---|
| Straddle, no stop | 1,13,940 | −15,994 | −99,262 (2020-03-13) | 3,00,686 |
| Straddle, 50% stop per leg | 1,41,965 | 12,030 | −67,287 | 2,07,731 |
| Strangle ±100, no stop | 1,24,298 | −5,516 | −82,133 | 2,41,173 |
| Strangle ±100, 30% stop | 1,06,289 | −23,525 | −30,547 | 55,525 |

- Tight stops (20–30%) hurt: they are hit on ordinary noise.
- The profit comes from 0–1 DTE. Days with 3 or more days to expiry lose money on average.

## Expiry day only (0 DTE), ATM straddle
| | Avg ₹/day | Win | ₹ by year (2019 … 2026) | Worst day | Max drawdown |
|---|---|---|---|---|---|
| No stop, ₹1 | 1,334 | 65% | 54k 129k 48k 94k 13k 84k 67k 55k | −53,082 (2020-03-12) | 53,082 |
| No stop, ₹3 | 815 | 63% | 30k 101k 21k 67k −14k 57k 39k 30k | −53,602 | 64,129 |
| 50% leg stop, ₹3 | 906 | 62% | 34k 143k 61k 36k −37k 70k −7k 69k | −27,118 | 44,877 |

- About 52 expiry days a year: **₹40–70 thousand a year per lot**, on roughly ₹2.5–3 lakh of margin.
- Tail risk is real. The latest expiry day (2026-11-23, NIFTY −580 pts) lost ₹26,150 on one lot.

## Not known yet
- The fill at the 9:15 open. Spreads are widest then; the recorded mid-day spread is 0.46 pt.
- Whether a 9:30 entry and 15:00 exit keep the edge. Daily data can't show it; it needs recorded option minutes.
- The existing "9:20 straddle" paper rule uses 20% stops, which this study finds harmful.
