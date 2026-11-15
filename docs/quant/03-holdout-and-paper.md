# Phase 12: the holdout, read once (2026-11-11), and the paper trade

Registry entry E-20261111-011. Period 2024-01-01 → 2026-11-09, never used for any choice before this run. Books and controls were fixed in `02-results-phase5-11.md` and in the script header before `HOLDOUT_UNLOCK=1` was set. One NIFTY lot at today's size, ₹1 slippage per option per fill, itemised dated charges, daily closes.

One fact of the period changes how the weekly book reads: **NSE moved NIFTY's weekly expiry from Thursday to Tuesday from September 2025.** The development rule "Monday close → Wednesday close" cannot exist for a Tuesday expiry, so the holdout was run three ways, all fixed in advance:

- **W**: Monday close → close 1 day before expiry (Thursday era: Mon→Wed; Tuesday era: no trade, counted as skips).
- **Wx**: Monday close → expiry settlement (Thursday era: 3 nights; Tuesday era: 1 night).
- **Wl**: the development rule literally as the lab wrote it (calendar 4 days before, 1 day left), which in the Tuesday era becomes Friday close → Monday close, the weekend-only hold that lost in development.

## Verdict

**Both premium books survived the holdout. Returns are in line with development. The target is still not met.** The one-night tail showed up exactly where the stress model said it would: 4 June 2024.

| Book, 1 lot | Trades | Won | Total | Per year | Worst trade | Worst open loss | CAGR on ₹10 lakh | Max DD | By year |
|---|---|---|---|---|---|---|---|---|---|
| W Mon→1 day left, 0.16, high IV | 67 | 82% | ₹94,600 | ₹33,100 | −₹14,500 | −₹41,000 | 3.2% | 4.1% | 2024 +₹38k, 2025 +₹39k, 2026 +₹18k |
| Wx Mon→expiry, 0.16, high IV | 90 | 86% | ₹1,41,600 | ₹49,600 | −₹21,100 | −₹41,000 | 4.8% | 6.4% | +₹57k, +₹57k, +₹27k |
| Wl literal rule | 88 | 76% | ₹81,100 | ₹28,400 | −₹15,700 | −₹41,000 | 2.8% | 4.1% | +₹38k, +₹39k, +₹4k |
| M 0.25 strangle 45→21, high IV | 19 | 79% | ₹1,78,700 | ₹62,600 | −₹11,600 | −₹27,000 | 5.9% | 2.6% | +₹60k, +₹36k, +₹83k |

Weekly books by expiry weekday: Wx earned ₹94,100 on 57 Thursday-expiry trades (49 won) and ₹28,500 on 29 Tuesday-expiry trades (24 won, worst open loss −₹15,900). The 1-night Monday→Tuesday version works, at about 60% of the per-trade rate of the 3-night version.

Controls:
- Friday close → 2 days left (weekend hold), every week: ₹45,900, profit factor 1.3, Thursday era +₹58,700, Tuesday era −₹1,900. Weaker than the Monday books, but it did **not** lose in the Thursday era as it did in development. The claim "weekend holds lose" is softened to "Monday entries earn two to three times what Friday entries earn".
- Thursday close → expiry, every week: ₹57,900, profit factor 1.13. Weak, as in development.
- Monthly straddle 60→7 high (the walk-forward's bad pick): +₹1.91 lakh, but one trade lost ₹1.42 lakh (the April 2025 tariff gap), worst month −13%. The tail is real.
- Monthly 0.25 strangle, every month: ₹1.85 lakh, 34 trades, worst trade −₹43,800. Monthly 0.16 high IV: ₹1.32 lakh, 89% won, worst open loss −₹17,100.

Sized books on ₹10 lakh (closes only):

| Book | CAGR | Max DD | Sharpe | Worst month | Worst day | By year |
|---|---|---|---|---|---|---|
| W ×3 | 9.1% | 12.2% | 0.27 | −3.9% | **−12.1%** | 11.4%, 10.5%, 4.3% |
| Wx ×3 | 13.2% | 18.0% | 0.51 | −6.0% | −11.9% | 17.2%, 14.6%, 6.1% |
| W ×2 + M ×1 | 11.6% | 8.3% | 0.55 | −2.8% | −7.3% | 13.6%, 10.0%, 9.5% |
| Wx ×2 + M ×1 | 14.2% | 11.8% | 0.72 | −3.4% | −7.2% | 17.5%, 12.7%, 10.3% |
| M ×1 | 5.9% | 2.6% | −0.09 | −1.7% | −1.7% | 6.0%, 3.4%, 7.5% |

Development had predicted for W×2+M×1 about 12% a year with a 7.4% drawdown; the holdout gave 11.6% and 8.3%. The −12% day at 3 weekly lots is Tuesday 4 June 2024: a Monday-close position met the election-result gap. The stress model had put a −5% gap at −14% of capital for 3 lots; the real close-to-close loss was −12%.

## What this means

- The premium books are what they looked like: about 10 to 14% a year on ₹10 lakh at 2 to 3 lots, drawdowns of 8 to 18% at closes, and a one-night loss of 7 to 12% of capital roughly once in three years. A 35% target with a 10% drawdown cap is not available from them at any size.
- The Tuesday-expiry era is young (14 months, 29 trades). The 1-night Monday book is positive there, but 29 trades is not evidence of a stable edge; it is consistent with the longer record.
- 2026 is the weakest year for every weekly book (bear year, 161 bear days, high vol) while the monthly book had its best year. The two books still diversify each other.
- Nothing in the holdout changes the equity conclusions (B9, B10 were not run on the holdout: they failed before it).

## The paper trade (built 2026-11-11)

A new rule in the Trade lab, off by default, named "Weekly NIFTY premium (research lead)":

- Every **Monday at 15:25** IST (the closest a market order can get to the 15:30 close the backtests used), if NIFTY's ATM IV is above its one-year median (the last end-of-day reading, the studies' own test), it sells **one lot each of the call and put nearest 0.16 delta on the next weekly expiry**, overnight, and holds to expiry; the Trade lab settles at intrinsic value. In the current Tuesday-expiry regime this is the 1-night Wx book.
- It fills on the live bid like every Trade lab order and records, for each leg, the bid and ask at decision time, the fill, and later NSE's official close of that contract on the same day. **Fill minus close is the slippage the backtests assumed at ₹1 an option.** The panel shows the average, median and worst across legs, plus each week's settled P&L after charges.
- Every decision is logged with its reason: skipped for IV, no quotes, Kite not connected, placed.
- Settings (day, time, delta, lots, high-IV only or every week) can be changed on the panel. Nothing here is real money; paper fills are kinder than real ones.

To start it: after market close, restart the app (`npm run platform`, which rebuilds), open Trade lab, switch the rule on, and keep Kite connected on Monday afternoons. The first possible entry is Monday 17 November 2026 at 15:25. Eight weeks of fills is the minimum before the slippage number means anything; weeks skipped for IV count as weeks observed.

Files: `apps/feed/src/tradelab/premium.ts` (+ tests), routes `/api/tradelab/premium`, panel `apps/platform/src/components/tradelab/premium-panel.tsx`.
