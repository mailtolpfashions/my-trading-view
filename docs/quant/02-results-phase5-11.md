# Results, Phases 2 to 11 (development window only)

Date: 2026-11-11. Data: NSE EOD to 2026-11-09, F&O 2011-01-03 to 2026-11-09, commit 7163c8e plus this programme's additions. Every number below comes from the development window, 2011-01 to 2023-12. **The holdout, 2024-01 to 2026-11, has not been read.** Registry: `docs/quant/experiments.md` (E-20261111-001 to 010), detail files in `apps/feed/.data/research/quant/`.

Money is one NIFTY lot (65) at today's index level unless a lot count is given; capital base ₹10 lakh; Zerodha itemised dated charges; slippage ₹1 per option per fill on NIFTY, ₹2 on Bank Nifty, 0.03% a side on stocks. Slippage and margin on old dates are assumptions and are marked as such in the registry.

## 1. Verdict

**Nothing tested reaches 35% a year with a drawdown under 10%, and nothing comes close once the gap risk that daily closes cannot show is counted.** The honest picture after 228 option settings, 64 weekly settings on two indices, 54 breakout and 24 momentum portfolio settings:

| Candidate | Where it was chosen | Return a year | Max drawdown (closes) | What breaks it |
|---|---|---|---|---|
| NIFTY weekly strangle, Monday close → Wednesday close, 0.16 delta, high IV, 3 lots | A3b, chosen on 2019–21, read on 2022–23 | 15.1% fit, **5.9% test**, 11.2% over 2019–23 | 5.5% at closes | A −5% overnight gap costs about 14% of capital in one night (model); 2020 alone is most of the profit (46% in 2020, −1.7% in 2021, −0.3% in 2023) |
| NIFTY monthly strangle 0.25 delta, 45→21 days, high IV, 1 lot | Nov 2026 studies (hindsight) | 2.5% train, 4.7% validation | 12.3% | Walk-forward cannot find it: choosing on past years alone loses money; its neighbours in train keep 0 to 1% of its result |
| Cross-sectional momentum, all NSE shares, top 10 to 20 monthly | B9, chosen on train | 22% train, 12% validation (family 15–36% in validation) | 38% train, **56% validation** | Drawdowns of 35 to 65% in every setting; return engine, not a low-risk one |
| 52-week-high breakout portfolio | B10 | 4.8% train, 16% validation | 27 to 68% | Signal's "+1% excess" is a mean carried by a few winners; the median excess is 0.06% and it beats the crowd only 45% of the time |

Realistic range for a careful operator from what is here: **about 8 to 12% a year on ₹10 lakh at a drawdown near 5 to 8% at closes, with a known one-night tail of 10 to 15%**, from the weekly premium book at 2 to 3 lots. That is below the target by a factor of three, and the tail is the reason it cannot be scaled up.

## 2. What each phase found

### Phase 2, regimes (E-001)
Per-day labels for NIFTY and Bank Nifty 2011–2026: trend by 200-day average and 126-day change, 20-day realized-vol tercile, VIX tercile (from 2015), crisis windows, expiry week. 2011–2023 has 2,468 bull days, 768 bear, 377 sideways. For context only: 2026 so far is 161 bear days with 115 high-vol days, the harshest regime since 2011, and it lies in the holdout.

### A1, monthly short premium, 228 settings (E-002)
Strangles 0.10–0.30 delta and the forward straddle, 30/38/45/52/60 days in, 7/14/21/28 days out, any or high IV, one position at a time, 2011–2023.

- Family: 142 of 228 settings made money in train (median ₹46,000 a year), 129 of 228 in validation (median ₹40,800); 82 of 228 in both. High-IV only: 85 of 114 and 78 of 114. The premium is real but the spread is enormous (validation worst −₹5.8 lakh, best +₹5.3 lakh a year).
- Walk-forward (pick the best of the previous 5 years, trade the next, 2016–2023): −₹48,800 in total on the "most profit" rule and −₹3.5 lakh on the "profit over worst loss" rule. The picker keeps choosing the aggressive 60→7 straddle that then loses −₹1.3 lakh in 2018 and −₹3.2 lakh in 2020. The fixed benchmark earned ₹3.96 lakh over the same years, the median setting ₹57,800, the best in hindsight ₹6.0 lakh. **Past performance does not pick the next year's setting.**
- Plateau of the benchmark (0.25, 45→21, high): in validation its neighbours keep 0.81 (38 days in), 0.29 (52 days in), 0.86 (14 out), 0.42 (28 out). In train: 0.01, 0.00, −0.74, 0.81. A sharp peak, which is the signature of a setting found by searching.
- Benchmark curve, 1 lot on ₹10 lakh: train CAGR 2.5%, drawdown 12.3% (577 trading days under water); validation 4.7%, 7.9%. Sharpe below zero against a 6.5% risk-free rate in both. 74 trades, 81% won, profit factor 2.3.
- Bootstrap of its trade P&L (2,000 draws): drawdown median ₹95,000, 95th percentile ₹1.71 lakh; 40% of draws see a ₹1 lakh drawdown at 1 lot.

### A2, sizing, loss limits, stress (E-004; E-003 superseded)
Five rules × 1–4 lots × per-trade loss limit (none, 3%, 5% of capital at a close).

- No combination meets 35% with ≤10% drawdown in both periods. Highest return with drawdown ≤10% in both periods: the paper straddle rule at 1 lot, 3.7% a year.
- Loss limits seen at daily closes make things worse, not better: on the benchmark at 2 lots a 3% limit cuts validation CAGR from 7.6% to 0.6% and leaves the drawdown at 13%. Weekly-close stops on monthly options cut winners that recover and still miss the gap.
- Slippage: ₹2 instead of ₹1 removes 10 to 19% of the benchmark's profit, ₹3 removes 21 to 38%. A one-day-late entry changes it by −3% to +8% (not fragile to timing).
- Gap stress at entry (model, Black-76 from each leg's own entry price): −5% gap median loss ₹50,800 per lot, −8% ₹1.02 lakh, −13% ₹1.71 lakh; +8% ₹55,000. NIFTY gapped ≥3% overnight 17 times in 2011–2023 and ≥5% three times (worst −9.1% on 2020-03-23). So 1 lot per ₹10 lakh carries a 5% one-night tail about once a year, and 10% a few times a decade.

### A3 and A3b, weekly versus monthly and the entry window (E-006, E-007)
Weekly NIFTY 2019-02 → 2023-12 (the only years before the holdout with weeklies) and Bank Nifty 2016-06 → 2023-12 as an independent sample. Nine entry/exit windows × 4 shapes × 2 IV filters.

- Weekly beats monthly per year on both indices at a smaller worst loss. The "weekly 4→1" setting of A3 is the Monday-close → Wednesday-close window.
- The window matters more than the strike. Per-year median across the 8 shape/IV settings, NIFTY: Fri→Tue −₹3,300 (2 of 8 positive), Fri→exp ₹16,800, Fri→Wed ₹47,700, Mon→exp ₹38,400, Mon→Wed ₹60,000, Tue→exp ₹42,300 (all 8 of 8 positive). Label correction (found 2026-11-11 while preparing the holdout): for a Thursday expiry the lab's "3 days before" is also a Monday entry, so the rows first labelled Tue→Wed and Tue→exp were Monday entries (near-duplicates of Mon→Wed and Mon→exp), and the rows labelled Wed→exp were Tuesday entries. No true Tuesday-close → Wednesday window was tested. Bank Nifty, 8 years: Fri→Tue −₹12,250 (0 of 8), Mon→exp ₹1.32 lakh, Mon→Wed ₹76,900, Tue→exp (labelled Wed→exp) ₹92,000 (8 of 8). **Holding only over the weekend loses on both indices in most years; holding Monday or Tuesday to Wednesday or expiry earns.** The weekday gap counts agree: 15 of NIFTY's 49 gaps ≥2% were Monday opens.
- By year it is not even. NIFTY Mon→Wed s16 high: 2019 +₹15k, 2020 +₹162k, 2021 −₹9k, 2022 +₹62k, 2023 −₹2k. Bank Nifty Mon→exp s16 high: 8 of 8 years positive, but 2020 is ₹2.89 lakh of ₹8.0 lakh. The premium pays in high-volatility years and is near zero in quiet ones.
- Chosen on the first 60% of years by profit over worst loss: NIFTY Mon→Wed s16 high (test 2022–23: +₹60,400, 1 lot), Bank Nifty Mon→exp straddle any (test 2021–23: +₹4.86 lakh). Walk-forward with a 2-year fit was positive on both (NIFTY +₹32,500 / +₹52,300; Bank Nifty +₹7.4 lakh / +₹5.9 lakh).
- Plateau: adjacent windows keep 0.64 to 0.81; the Wednesday-entry neighbour keeps 0.12 (one day is too short to earn the premium); the shape neighbours keep 0.73 to 1.3.
- Slippage: +₹1 per option takes 25 to 50% of the weekly profit (four fills a week on small premiums). This family is far more cost-sensitive than the monthly one.
- Bank Nifty weeklies were discontinued by SEBI in November 2024, so only the NIFTY book is tradable today. The 2024 regime change itself sits in the holdout.
- Gap stress, NIFTY 2-day 0.16 strangle, per lot: −3% median ₹20,200, −5% ₹46,600, −8% ₹93,000, +5% ₹46,100. A 2-day weekly position has almost no premium to absorb a gap.
- Bootstrap of trade P&L (NIFTY, 1 lot): drawdown median ₹22,600, 95th percentile ₹39,000, 99th ₹50,300. Smooth at closes; the gap risk is outside this distribution because the data never marks inside a day.

### B10, 52-week-high breakout (E-005, E-009)
54 settings on 2,981 NSE shares including delisted ones, point-in-time liquidity. Train (2011–2018): best CAGR 4.8% with 27% drawdown against NIFTY 11.1% / 22.5%. Validation: 16% with 32% drawdown against NIFTY 14.8% / 38%. Win rate 39%, profit factor 1.15 to 1.4. The signal check explains it: on 26,130 liquid breakouts the 20-session excess over the crowd is +0.54% in the mean but +0.06% at the median, and only 45% of breakouts beat the crowd. **The earlier "+1% excess" was a few large winners, not a repeatable edge.** Rejected.

### B9, cross-sectional momentum (E-008)
24 settings. The family beats NIFTY on return in most settings (validation 15 to 37% a year against 14.8%), with Sharpe 0.3 to 1.2, but drawdowns are 35 to 65% in every setting (NIFTY: 22% / 38%). Chosen on train (3-month lookback, 10 slots, 15% stop): train 22% / 38% DD, validation 12% / 56% DD, worst month −35%. Costs ₹8 to 11 lakh over 13 years on ₹10 lakh starting capital. **A return engine, not a capital-preservation one.** Not pursued further here; a market-wide trend filter (exit when NIFTY is below its 200-day average) is the obvious next test and needs a cross-symbol rule the engine does not yet have.

### Phase 11, sizing and combination (E-010)
Daily P&L correlation 2019–2023: weekly Mon→Wed against monthly 0.12; weekly Mon→Wed against weekly Mon→exp 0.49. Books on ₹10 lakh (closes only):

| Book | Margin | CAGR 2019–23 | Max DD | Calmar | Fit 2019–21 | Test 2022–23 | −5% gap, model |
|---|---|---|---|---|---|---|---|
| W Mon→Wed 0.16 high ×3 | 53% | 11.2% | 5.5% | 2.0 | 15.1% / 5.5% | 5.9% / 2.6% | −14% of capital |
| W ×2 + M ×1 | 53% | 12.2% | 7.4% | 1.6 | 17.9% / 7.4% | 4.4% / 3.8% | −9% (W) − ₹51k (M) |
| W ×2 + W2 ×1 | 53% | 10.6% | 6.4% | 1.7 | 14.0% / 6.4% | 5.8% / 3.1% | −14% |
| W ×4 | 71% | 14.2% | 6.6% | 2.2 | 19.3% / 6.6% | 7.0% / 3.1% | −19% |

Year by year for W ×3: 2019 +4.6%, 2020 +46.4%, 2021 −1.7%, 2022 +12.4%, 2023 −0.3%. Bootstrap of the combined W×2+M×1 daily P&L: 21% of draws see a 10% drawdown even at closes.

## 3. Why the target is out of reach with this data and these instruments

1. **The premium is paid for carrying gap risk.** Every short-premium book here earns 4 to 6% a year per lot per ₹10 lakh at closes, and every lot adds a 5% one-night loss at a −5% gap. Three lots give 11 to 15% with a 14% tail; the target needs 35% with a 10% cap. The ratio does not work at any size.
2. **Selection has no skill in the monthly family.** Walk-forward loses. The good-looking monthly rule is a hindsight pick with a sharp plateau.
3. **The weekly window effect is real across two indices and most years but is paid mostly in high-volatility years** (2020 and 2022), and it is cost-fragile (₹1 of extra slippage removes a quarter to a half of it). Live fills on NIFTY weeklies at the close are usually inside ₹1, but this must be measured, not assumed.
4. **Equity long-only factors beat NIFTY on return but not on drawdown.** Nothing in cash equities gets under 20% drawdown without a short side or an index hedge, and overnight shorting needs futures data over cycles, which we do not have for stocks.
5. **What cannot be tested** stays untested: intraday option selling, expiry-day scalps, gamma scalping, stock futures and options over cycles. These are where most retail "35%" claims live, and the data to check them does not exist here yet.

## 4. Strategy classification (section 10 of the brief), from what passed any check

- **High-consistency:** NIFTY weekly 0.16-delta strangle, Monday close → Wednesday close (or to expiry), high-IV weeks only, 1 lot per ₹3.3 lakh (3 lots on ₹10 lakh). 74% won, profit factor 2.8, worst trade −₹12,300 per lot at closes, 3 losing trades in a row at most, 2 of 5 years near zero. Tail: 14% of capital on a −5% gap at 3 lots. Status: lead, needs the holdout and then live fill measurement.
- **Balanced:** the same at 2 lots plus 1 lot of the monthly 0.25-delta high-IV strangle (correlation 0.12). 12% a year, 7.4% drawdown at closes, 2020-dependent.
- **High-return:** cross-sectional momentum, 10 to 20 liquid NSE stocks by 3 to 12-month return, monthly rotation, 15 to 36% a year in validation with 40 to 56% drawdowns. Needs a market-level trend filter before it can be called a strategy.
- **Rejected:** 52-week-high breakout portfolios; monthly premium with close-based loss limits; walk-forward-selected monthly settings; weekend-only weekly positions (Fri→Tue).

## 5. Capital, margin and costs (for the lead)

- Margin: today's NSE SPAN plus exposure for the 0.16 weekly strangle about ₹1.77 lakh per lot (same order as the monthly, because SPAN is driven by the index move, not the days left). 3 lots = 53% of ₹10 lakh; keep the rest as cash for the gap.
- Costs per lot per week at today's prices: 4 fills × (₹20 brokerage + 0.15% STT on the sell side + exchange 0.0355% + GST + stamp) ≈ ₹250 to ₹400, plus ₹1 × 65 × 4 = ₹260 slippage. Against an average weekly credit of a few thousand rupees per lot that is 10 to 20%, which is why the +₹1 slippage line matters.
- Capital at risk per night (model): 4.7% of ₹10 lakh per lot at a −5% gap, 9.3% at −8%.

## 6. What I recommend next, in order

1. **Decide on the holdout.** Opening 2024-01 → 2026-11 is a one-time act. It contains the June 2024 election gap (−8.5% intraday on 4 June), the Oct 2024–Mar 2025 fall, the April 2025 tariff gap, the Nov 2024 one-weekly rule and the 2026 bear year. If you agree, I run only the three books in section 4 plus the rejected ones as controls, with no changes allowed afterwards.
2. **Record live weekly fills** on the Monday-close entry for at least 8 weeks in the Trade lab (paper), one lot, to replace the ₹1 slippage assumption with a measured number before any real lot.
3. **Build a cross-symbol rule** (NIFTY trend filter inside a stock strategy) and re-run B9 with it; also a vol-targeted version. That is the only path to a 20%+ engine with a drawdown under 25% visible from here.
4. **Option recorder:** keep it running. In 6 to 12 months it allows the first honest intraday tests of the same weekly book (entry 15:15 instead of the close, intraday stop) and of expiry-day behaviour.
5. **Do not** trade the Bank Nifty results (contracts gone), the monthly benchmark as a stand-alone (hindsight), or anything in section 4 at more than 3 lots per ₹10 lakh.
