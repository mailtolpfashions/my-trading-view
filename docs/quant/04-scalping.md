# 04 — Scalping: the "Long and the Short" series, tested

Date: 2026-11-24. Data: NIFTY 50 spot 1-minute candles 2023-01-02 → 2026-11-23 (958 sessions), as 3-minute candles.
Registry: E-20261124-001 … 013 (`experiments.md`). Scripts: `apps/feed/scripts/research/scalp/`.

## Verdict
**None of the series' setups makes money once they are fixed rules.** That holds for the option buyer and the
option seller, after costs, in 2023–2025 and again in 2026. Most lose even before costs. The market-structure
statistics in the videos are correct (we reproduce them), but they describe the day; they do not predict it.

## 1. Data (step 1)
- NIFTY spot minutes were backfilled from Kite back to 2023-01 (`nifty-backfill.ts`), with no missing days.
- Days left out: special sessions (Muhurat trading, Saturday DR drills).
- 2023 minute high/low is slightly inside Kite's daily candle on 60 days (1–8 pts; worst 2023-05-11, 32 pts). From 2024 on they match.

## 2. The videos' numbers, rebuilt (step 2, `structure.ts`)
| Measure | Video | Ours |
|---|---|---|
| Median day range, % of open | 0.824% | 0.828% |
| Share of the day's range in S1 / S2 / S3 | 70–76 / 11–13 / 12–17% | 71–76 / 11–13 / 13–16% |
| 9:15–9:30 range, median 2023 → 2026 | 54 → 99 pts | 54 → 94 pts |
| Run after the breakout, by 11:30 | ~0.6× range | 0.57–0.64× |
| Trend days in 2023 (up/down) | 28 / 18 | 27 / 17 |
| Afternoon window breakout, per trade | +2.6 / +3.2 pts | +1.2 / +2.2 pts |

What the videos left out:
- After an opening-range breakout, the move **against** you before 11:30 (median 31–45 pts) is as big as the move **for** you (24–43 pts).
- By 11:30 the price is back near the entry on average.
- 1 breakout in 4 goes a full range-size against you.
- Trend days fell from 17–18% of days (2023–24) to 11% (2025–26).

## 3. Setups as fixed rules (step 4, `setups.ts`) and on the option (step 5, `options-estimate.ts`)
Rules for every setup:
- Entry on a 3-minute close, on candles starting 9:30–14:45; out by 15:00.
- Stops checked inside each candle.
- Option side: 1-in-the-money weekly option, priced as an estimate (Black-76 at the day's IV).
- Costs: 0.5 pt slippage per fill (the real recorded spread is 0.46) plus Zerodha charges.

Points per trade:
| Setup | Trades | Spot pts (before costs) | Buyer, net | Seller, net | 2026, buyer / seller |
|---|---|---|---|---|---|
| A1 opening-range breakout, Supertrend(5,2) exit | 943 | −2.4 | −2.9 | −4.7 | −3.5 / −5.0 |
| A2 same, EMA-band exit | 943 | −3.6 | −3.7 | −5.2 | −4.2 / −5.3 |
| A3 same, exit when trend state weakens | 943 | −1.6 | −2.8 | −3.6 | −5.0 / −5.3 |
| A4 breakout + a second attempt | 967 | −2.3 | −2.9 | −4.7 | −3.5 / −5.0 |
| B1 first pullback, target the prior high/low | 319 | 0.0 | −2.1 | −2.2 | −2.0 / −2.1 |
| B2 first pullback, Supertrend trail | 319 | −2.2 | −3.3 | −3.5 | −3.8 / −4.5 |
| C1 quiet morning (< 60% of avg range), afternoon range break | 110 | +1.1 | −0.9 | −2.3 | −4.2 / −4.8 |
| C2 quiet morning (< 60%), move away from TWAP | 118 | +3.1 | +0.4 | −0.8 | −3.1 / −2.7 |
| C3 stretched morning, back to TWAP | 178 | −2.6 | −3.4 | −4.2 | −0.2 / −1.5 |

- C2 is the only rule above zero over the whole period: +0.4 pts per trade for the buyer.
  - That came from 2023–25 (+1.4). In 2026, the holdout year, it lost 3.1 per trade.
  - The 50% and 70% variants of the quiet-morning cut-off also fail in 2026.
- The filter "skip if the day's range is already > 120% of the 5-day average" helps A a little, but never turns it positive.
- Selling the 1-ITM option against the signal is worse than buying. Exits are on reversals, so the seller is short
  gamma into the very moves that stop the trade, and intraday time decay (~1 pt an hour) is too small to pay for it.

## 4. Option model check (`model-check.ts`)
On the two fully recorded days (2026-11-04/05):
- The model's 1-ITM premium is off by about 14 pts on average, but its 30-minute change is within ~1 pt on average (±6 on a single trade).
- The real bid-ask spread is 0.46 pt on average.
- Even with zero slippage (about +1 pt per trade), no setup survives 2026.

## 5. What this means
- The framework pieces are built and tested, and can be reused for the next idea. Next steps would need new information that a price chart alone doesn't give: real order flow / OI, breadth, or a different instrument.
  - NIFTY minutes from 2023
  - the indicators: TWAP, EMA band state, session range table (`packages/indicators/src/intraday.ts`)
  - a setup simulator and an option estimate with costs
- Step 7 (a Trade lab paper rule) is **not** started, because nothing passed.
## 6. Breadth (part 4), tested 2026-11-24 (`breadth.ts`, E-20261124-014 … 019)
Period: 2025-11-03 → 2026-11-23 (261 days; stock minutes start there). Build: 2025-11 → 2026-05; check: 2026-06 → 2026-11.

Method:
- **Weights:** least squares of NIFTY's 1-minute returns on the 50 stocks' returns over the last 40 sessions (R² 0.91).
  - Top weights: HDFC Bank 10.3, ICICI 9.3, Reliance 7.6.
  - Tiers: heavy 14 stocks / 63%, mid 19 / 24%, light 17 / 13% (video: 13 / 62%, 14 / 20%, 23 / 18%).
- **Limits:** today's members and weights are used for the whole year.
- **Breadth line:** weight × (1-min candle up +1 / down −1), summed through the day; "up" = the line is above its running mean.

Results:
- **Next 21 minutes of NIFTY.** Heavy-tier up vs down differs by 1.4 pts. NIFTY's own price vs its TWAP gives 1.2 pts. The mid and light tiers give nothing (−0.1, −0.2).
  - When price and heavy breadth disagree, following breadth is worth 0.9 pt.
  - So heavy breadth carries a little information, about as much as price itself, and roughly 1 spot pt per trade, below the cost of an option round trip.
- **Trades on state changes, per trade after costs (buyer / seller):**
  - heavy: −0.3 / −1.6
  - heavy + mid: −0.1 / −1.5
  - NIFTY price vs its own TWAP (no breadth): +0.4 / −0.8, with an 18% win rate.
  - Breadth does not beat plain price.
- **Opening-range breakout filtered by breadth:** with heavy + mid agreeing, −2.3 spot pts per trade, the same as unfiltered (−2.3). Breadth confirmation does not rescue the breakout.

Verdict: **breadth adds no tradable edge.** The series' last untested idea fails as well.
