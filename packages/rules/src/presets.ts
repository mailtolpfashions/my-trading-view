// Ready-made screens and the condition library. Every entry is plain formula text on the same engine as a user's own
// condition, so a preset can be opened, read, edited and saved like anything else. Tests parse every entry.

import type { Tf } from './ast';

export type Category = 'technical' | 'fundamental' | 'fno' | 'custom';

export type Preset = {
  id: string;
  name: string;
  category: Category;
  tf: Tf;
  formula: string;
  /** What the screen looks for, in a sentence. */
  about: string;
};

export const PRESETS: Preset[] = [
  { id: '52w-high-breakout', name: '52-week high breakout', category: 'technical', tf: 'D', formula: 'CLOSE > HIGHEST(HIGH, 252)[1]', about: 'Closed above the highest high of the previous 252 sessions.' },
  { id: 'near-52w-high', name: 'Within 2% of the 52-week high', category: 'technical', tf: 'D', formula: 'CLOSE >= HIGHEST(HIGH, 252) * 0.98', about: 'Close no more than 2% below the 52-week high.' },
  { id: '20d-breakout-volume', name: '20-day breakout on volume', category: 'technical', tf: 'D', formula: 'CLOSE > HIGHEST(HIGH, 20)[1] AND RVOL(20) > 1.5', about: 'Closed above the previous 20-day high on at least 1.5× the average volume.' },
  { id: 'prev-day-high-breakout', name: 'Previous day high breakout', category: 'technical', tf: 'D', formula: 'CLOSE > HIGH[1] AND CLOSE > OPEN', about: 'Closed above yesterday\'s high with a green candle.' },
  { id: 'prev-week-high-breakout', name: 'Previous week high breakout', category: 'technical', tf: 'D', formula: 'CLOSE > [W] HIGH[1]', about: 'Closed above last week\'s high.' },
  { id: 'golden-cross', name: 'Golden cross', category: 'technical', tf: 'D', formula: 'CROSSOVER(SMA(CLOSE, 50), SMA(CLOSE, 200))', about: 'The 50-day SMA crossed above the 200-day SMA today.' },
  { id: 'death-cross', name: 'Death cross', category: 'technical', tf: 'D', formula: 'CROSSUNDER(SMA(CLOSE, 50), SMA(CLOSE, 200))', about: 'The 50-day SMA crossed below the 200-day SMA today.' },
  { id: 'ema-9-21-cross', name: 'EMA 9 / 21 bullish crossover', category: 'technical', tf: 'D', formula: 'CROSSOVER(EMA(CLOSE, 9), EMA(CLOSE, 21))', about: 'The 9 EMA crossed above the 21 EMA today.' },
  { id: 'ema-alignment', name: 'Bullish EMA alignment', category: 'technical', tf: 'D', formula: 'CLOSE > EMA(CLOSE, 20) AND EMA(CLOSE, 20) > EMA(CLOSE, 50) AND EMA(CLOSE, 50) > EMA(CLOSE, 200)', about: 'Price above the 20 EMA, and the 20 > 50 > 200 EMAs stacked in order.' },
  { id: 'above-all-mas', name: 'Above the 20, 50 and 200 SMA', category: 'technical', tf: 'D', formula: 'CLOSE > SMA(CLOSE, 20) AND CLOSE > SMA(CLOSE, 50) AND CLOSE > SMA(CLOSE, 200)', about: 'Close above all three moving averages.' },
  { id: 'rsi-oversold-exit', name: 'RSI leaves oversold', category: 'technical', tf: 'D', formula: 'CROSSOVER(RSI(CLOSE, 14), 30)', about: 'RSI(14) crossed back above 30 today.' },
  { id: 'rsi-momentum', name: 'RSI momentum above 60', category: 'technical', tf: 'D', formula: 'RSI(CLOSE, 14) > 60 AND RISING(RSI(CLOSE, 14), 3)', about: 'RSI(14) above 60 and higher on each of the last 3 sessions.' },
  { id: 'macd-cross', name: 'MACD bullish crossover', category: 'technical', tf: 'D', formula: 'CROSSOVER(MACD_LINE(CLOSE, 12, 26, 9), MACD_SIGNAL(CLOSE, 12, 26, 9))', about: 'The MACD line crossed above its signal line today.' },
  { id: 'macd-zero-cross', name: 'MACD crosses above zero', category: 'technical', tf: 'D', formula: 'CROSSOVER(MACD_LINE(CLOSE, 12, 26, 9), 0)', about: 'The MACD line crossed above the zero line today.' },
  { id: 'supertrend-flip', name: 'Supertrend turns bullish', category: 'technical', tf: 'D', formula: 'SUPERTREND_DIR(10, 3) = 1 AND SUPERTREND_DIR(10, 3)[1] = -1', about: 'Supertrend (10, 3) flipped from bearish to bullish today.' },
  { id: 'strong-trend', name: 'Established uptrend', category: 'technical', tf: 'D', formula: 'SUPERTREND_DIR(10, 3) = 1 AND ADX(14, 14) > 25 AND CLOSE > EMA(CLOSE, 50)', about: 'Supertrend bullish, ADX above 25 (a strong trend) and price above the 50 EMA.' },
  { id: 'volume-spike', name: 'Volume spike, green candle', category: 'technical', tf: 'D', formula: 'RVOL(20) > 2 AND CLOSE > OPEN', about: 'Volume at least twice the 20-day average, closing above the open.' },
  { id: 'bb-squeeze', name: 'Bollinger squeeze', category: 'technical', tf: 'D', formula: 'BB_WIDTH(CLOSE, 20, 2) <= LOWEST(BB_WIDTH(CLOSE, 20, 2), 120)', about: 'Bollinger BandWidth at its narrowest of the last 120 sessions: volatility compressed.' },
  { id: 'bb-upper-break', name: 'Close above the upper Bollinger Band', category: 'technical', tf: 'D', formula: 'CROSSOVER(CLOSE, BB_UPPER(CLOSE, 20, 2))', about: 'Closed above the upper band (20, 2) today after closing inside it.' },
  { id: 'nr7-inside', name: 'NR7 inside bar', category: 'technical', tf: 'D', formula: 'NR(7) AND INSIDE_BAR', about: 'The narrowest range of 7 sessions, inside yesterday\'s range: a coiled setup.' },
  { id: 'gap-up-hold', name: 'Gap up that held', category: 'technical', tf: 'D', formula: 'GAP_PCT > 2 AND CLOSE > OPEN', about: 'Opened at least 2% above yesterday\'s close and closed above the open.' },
  { id: 'engulfing-downtrend', name: 'Bullish engulfing after a decline', category: 'technical', tf: 'D', formula: 'BULLISH_ENGULFING AND CLOSE[1] < SMA(CLOSE, 50)[1]', about: 'A bullish engulfing candle where the previous close was below its 50-day SMA.' },
  { id: 'hammer-at-low', name: 'Hammer at a 20-day low', category: 'technical', tf: 'D', formula: 'HAMMER AND LOW <= LOWEST(LOW, 20)', about: 'A hammer that made the lowest low of 20 sessions.' },
  { id: 'rsi-bull-div', name: 'RSI bullish divergence', category: 'technical', tf: 'D', formula: 'BULL_DIV(RSI(CLOSE, 14), 5, 5, 5, 60)', about: 'Price made a lower low while RSI(14) made a higher low (confirmed 5 sessions after the low).' },
  { id: 'weekly-trend-daily-dip', name: 'Weekly uptrend, daily pullback', category: 'technical', tf: 'D', formula: '[W] (CLOSE > EMA(CLOSE, 20)) AND RSI(CLOSE, 14) < 40', about: 'Above the 20-week EMA on the weekly chart while daily RSI(14) has dipped below 40.' },
  { id: 'higher-highs-lows', name: 'Higher highs and higher lows', category: 'technical', tf: 'D', formula: 'RISING(HIGH, 3) AND RISING(LOW, 3)', about: 'Each of the last 3 sessions made a higher high and a higher low.' },
];

export type ConditionTemplate = { label: string; formula: string };
export type ConditionGroup = { group: string; items: ConditionTemplate[] };

/** Building blocks for the builder's "add condition" menu, grouped as in the screener spec. */
export const CONDITION_LIBRARY: ConditionGroup[] = [
  { group: 'Price', items: [
    { label: 'Close above ₹ value', formula: 'CLOSE > 500' },
    { label: 'Close above previous high', formula: 'CLOSE > HIGH[1]' },
    { label: 'Up 2% or more on the day', formula: 'CHANGE_PCT(CLOSE, 1) >= 2' },
    { label: 'Opened above previous high', formula: 'OPEN > HIGH[1]' },
    { label: 'Within 2% of 52-week high', formula: 'CLOSE >= HIGHEST(HIGH, 252) * 0.98' },
    { label: 'At least 20% above 52-week low', formula: 'CLOSE >= LOWEST(LOW, 252) * 1.2' },
  ] },
  { group: 'Moving averages', items: [
    { label: 'Close above SMA 50', formula: 'CLOSE > SMA(CLOSE, 50)' },
    { label: 'Close below SMA 200', formula: 'CLOSE < SMA(CLOSE, 200)' },
    { label: 'Golden cross (SMA 50 / 200)', formula: 'CROSSOVER(SMA(CLOSE, 50), SMA(CLOSE, 200))' },
    { label: 'Death cross (SMA 50 / 200)', formula: 'CROSSUNDER(SMA(CLOSE, 50), SMA(CLOSE, 200))' },
    { label: 'EMA 9 crosses below EMA 21', formula: 'CROSSUNDER(EMA(CLOSE, 9), EMA(CLOSE, 21))' },
    { label: 'EMA 9 > 21 > 50 alignment', formula: 'EMA(CLOSE, 9) > EMA(CLOSE, 21) AND EMA(CLOSE, 21) > EMA(CLOSE, 50)' },
    { label: 'Close 3% above EMA 20', formula: 'CLOSE >= EMA(CLOSE, 20) * 1.03' },
    { label: 'SMA 50 rising (vs 5 bars ago)', formula: 'SMA(CLOSE, 50) > SMA(CLOSE, 50)[5]' },
    { label: 'EMA 20 falling (vs 3 bars ago)', formula: 'EMA(CLOSE, 20) < EMA(CLOSE, 20)[3]' },
    { label: 'MAs converging (20 within 1% of 50)', formula: 'ABS(EMA(CLOSE, 20) - EMA(CLOSE, 50)) / CLOSE * 100 < 1' },
  ] },
  { group: 'RSI', items: [
    { label: 'Overbought (above 70)', formula: 'RSI(CLOSE, 14) > 70' },
    { label: 'Oversold (below 30)', formula: 'RSI(CLOSE, 14) < 30' },
    { label: 'Crosses above 50', formula: 'CROSSOVER(RSI(CLOSE, 14), 50)' },
    { label: 'Enters overbought', formula: 'CROSSOVER(RSI(CLOSE, 14), 70)' },
    { label: 'Enters oversold', formula: 'CROSSUNDER(RSI(CLOSE, 14), 30)' },
    { label: 'Rising for 3 bars', formula: 'RISING(RSI(CLOSE, 14), 3)' },
    { label: 'Bullish divergence', formula: 'BULL_DIV(RSI(CLOSE, 14), 5, 5, 5, 60)' },
    { label: 'Bearish divergence', formula: 'BEAR_DIV(RSI(CLOSE, 14), 5, 5, 5, 60)' },
  ] },
  { group: 'MACD', items: [
    { label: 'MACD above signal', formula: 'MACD_LINE(CLOSE, 12, 26, 9) > MACD_SIGNAL(CLOSE, 12, 26, 9)' },
    { label: 'Bullish signal crossover', formula: 'CROSSOVER(MACD_LINE(CLOSE, 12, 26, 9), MACD_SIGNAL(CLOSE, 12, 26, 9))' },
    { label: 'Bearish signal crossover', formula: 'CROSSUNDER(MACD_LINE(CLOSE, 12, 26, 9), MACD_SIGNAL(CLOSE, 12, 26, 9))' },
    { label: 'Histogram turns positive', formula: 'CROSSOVER(MACD_HIST(CLOSE, 12, 26, 9), 0)' },
    { label: 'Histogram rising', formula: 'RISING(MACD_HIST(CLOSE, 12, 26, 9), 1)' },
    { label: 'Histogram turns from rising to falling', formula: 'FALLING(MACD_HIST(CLOSE, 12, 26, 9), 1) AND RISING(MACD_HIST(CLOSE, 12, 26, 9)[1], 1)' },
    { label: 'Above zero line', formula: 'MACD_LINE(CLOSE, 12, 26, 9) > 0' },
    { label: 'MACD bullish divergence', formula: 'BULL_DIV(MACD_HIST(CLOSE, 12, 26, 9), 5, 5, 5, 60)' },
  ] },
  { group: 'Trend', items: [
    { label: 'Supertrend bullish', formula: 'SUPERTREND_DIR(10, 3) = 1' },
    { label: 'ADX above 25', formula: 'ADX(14, 14) > 25' },
    { label: '+DI above −DI', formula: 'PLUS_DI(14) > MINUS_DI(14)' },
    { label: 'Aroon Up crosses above Down', formula: 'CROSSOVER(AROON_UP(14), AROON_DOWN(14))' },
    { label: 'Price above Parabolic SAR', formula: 'CLOSE > PSAR(0.02, 0.02, 0.2)' },
    { label: 'Above the Ichimoku cloud', formula: 'CLOSE > MAX(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))' },
    { label: 'Below the Ichimoku cloud', formula: 'CLOSE < MIN(ICHIMOKU_SPAN_A(9, 26, 26), ICHIMOKU_SPAN_B(52, 26))' },
    { label: 'Ichimoku TK cross', formula: 'CROSSOVER(ICHIMOKU_CONVERSION(9), ICHIMOKU_BASE(26))' },
    { label: 'Trending (Choppiness below 38.2)', formula: 'CHOP(14) < 38.2' },
    { label: 'Choppy (Choppiness above 61.8)', formula: 'CHOP(14) > 61.8' },
  ] },
  { group: 'Volume', items: [
    { label: 'Volume above 2× 20-day average', formula: 'VOLUME > 2 * AVG_VOLUME(20)[1]' },
    { label: 'Relative volume above 1.5', formula: 'RVOL(20) > 1.5' },
    { label: 'Volume up 3 sessions in a row', formula: 'RISING(VOLUME, 3)' },
    { label: 'Average turnover above ₹10 crore', formula: 'AVG_TURNOVER(20) > 100000000' },
  ] },
  { group: 'Bollinger Bands', items: [
    { label: 'Close above upper band', formula: 'CLOSE > BB_UPPER(CLOSE, 20, 2)' },
    { label: 'Close below lower band', formula: 'CLOSE < BB_LOWER(CLOSE, 20, 2)' },
    { label: 'Crosses the middle band up', formula: 'CROSSOVER(CLOSE, BB_MIDDLE(CLOSE, 20, 2))' },
    { label: 'Near upper band (%B above 0.9)', formula: 'BB_PCTB(CLOSE, 20, 2) > 0.9' },
    { label: 'Bandwidth expanding', formula: 'RISING(BB_WIDTH(CLOSE, 20, 2), 3)' },
    { label: 'Squeeze (narrowest in 120 bars)', formula: 'BB_WIDTH(CLOSE, 20, 2) <= LOWEST(BB_WIDTH(CLOSE, 20, 2), 120)' },
  ] },
  { group: 'Volatility', items: [
    { label: 'ATR above 2% of price', formula: 'ATR_PCT(14) > 2' },
    { label: 'ATR above its 50-bar average', formula: 'ATR(14) > SMA(ATR(14), 50)' },
    { label: 'Historical volatility (20) above 30%', formula: 'HV(20) > 30' },
    { label: 'Range above 2× average range', formula: 'RANGE > 2 * SMA(RANGE, 20)[1]' },
  ] },
  { group: 'Oscillators', items: [
    { label: 'Stochastic %K crosses above %D', formula: 'CROSSOVER(STOCH_K(14, 1), STOCH_D(14, 1, 3))' },
    { label: 'Stochastic oversold (below 20)', formula: 'STOCH_K(14, 1) < 20' },
    { label: 'Stoch RSI crosses up from oversold', formula: 'CROSSOVER(STOCHRSI_K(CLOSE, 14, 14, 3), 20)' },
    { label: 'Williams %R oversold (below −80)', formula: 'WILLR(14) < -80' },
    { label: 'CCI above 100', formula: 'CCI(HLC3, 20) > 100' },
    { label: 'MFI below 20', formula: 'MFI(14) < 20' },
    { label: 'ROC(9) above 5%', formula: 'ROC(CLOSE, 9) > 5' },
    { label: 'TSI crosses above zero', formula: 'CROSSOVER(TSI(CLOSE, 25, 13), 0)' },
  ] },
  { group: 'Breakouts and ranges', items: [
    { label: 'Previous day high breakout (close)', formula: 'CLOSE > HIGH[1]' },
    { label: 'Previous day high touched (intrabar)', formula: 'HIGH >= HIGH[1]' },
    { label: 'Previous week high breakout', formula: 'CLOSE > [W] HIGH[1]' },
    { label: 'Previous month high breakout', formula: 'CLOSE > [M] HIGH[1]' },
    { label: '20-day high breakout', formula: 'CLOSE > HIGHEST(HIGH, 20)[1]' },
    { label: '50-day high breakout', formula: 'CLOSE > HIGHEST(HIGH, 50)[1]' },
    { label: '52-week high breakout', formula: 'CLOSE > HIGHEST(HIGH, 252)[1]' },
    { label: 'Previous day low breakdown', formula: 'CLOSE < LOW[1]' },
    { label: '20-day low breakdown', formula: 'CLOSE < LOWEST(LOW, 20)[1]' },
    { label: '52-week low breakdown', formula: 'CLOSE < LOWEST(LOW, 252)[1]' },
    { label: 'Resistance breakout (last swing high)', formula: 'CROSSOVER(CLOSE, RESISTANCE(5, 5))' },
    { label: 'Support breakdown (last swing low)', formula: 'CROSSUNDER(CLOSE, SUPPORT(5, 5))' },
    { label: 'Inside bar', formula: 'INSIDE_BAR' },
    { label: 'NR4', formula: 'NR(4)' },
    { label: 'NR7', formula: 'NR(7)' },
    { label: '20-day range within 10%', formula: 'HIGHEST(HIGH, 20) <= LOWEST(LOW, 20) * 1.1' },
    { label: 'Higher high and higher low', formula: 'HIGH > HIGH[1] AND LOW > LOW[1]' },
    { label: 'Lower high and lower low', formula: 'HIGH < HIGH[1] AND LOW < LOW[1]' },
  ] },
  { group: 'Gaps', items: [
    { label: 'Gap up above 1%', formula: 'GAP_PCT > 1' },
    { label: 'Gap down below −1%', formula: 'GAP_PCT < -1' },
    { label: 'Gap up filled', formula: 'GAP_PCT > 0 AND LOW <= CLOSE[1]' },
    { label: 'Gap and go', formula: 'GAP_PCT > 1 AND CLOSE > OPEN AND LOW > CLOSE[1]' },
    { label: 'Gap-up reversal', formula: 'GAP_PCT > 1 AND CLOSE < CLOSE[1]' },
  ] },
  { group: 'Candlestick patterns', items: [
    'BULLISH_ENGULFING', 'BEARISH_ENGULFING', 'HAMMER', 'SHOOTING_STAR', 'MORNING_STAR', 'EVENING_STAR', 'PIERCING_LINE',
    'DARK_CLOUD_COVER', 'THREE_WHITE_SOLDIERS', 'THREE_BLACK_CROWS', 'BULLISH_HARAMI', 'BEARISH_HARAMI', 'INVERTED_HAMMER',
    'HANGING_MAN', 'DOJI', 'DRAGONFLY_DOJI', 'GRAVESTONE_DOJI', 'BULLISH_MARUBOZU', 'BEARISH_MARUBOZU', 'SPINNING_TOP',
    'TWEEZER_BOTTOM', 'TWEEZER_TOP', 'THREE_INSIDE_UP', 'THREE_INSIDE_DOWN',
  ].map((p) => ({ label: p.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '), formula: p })) },
  { group: 'Support, resistance and Fibonacci', items: [
    { label: 'Within 1% of last swing high', formula: 'ABS(CLOSE - RESISTANCE(5, 5)) / CLOSE * 100 <= 1' },
    { label: 'Within 1% of last swing low', formula: 'ABS(CLOSE - SUPPORT(5, 5)) / CLOSE * 100 <= 1' },
    { label: 'Above today\'s classic pivot', formula: 'CLOSE > PIVOT(CLASSIC, P, D)' },
    { label: 'Above this week\'s R1', formula: 'CLOSE > PIVOT(CLASSIC, R1, W)' },
    { label: 'Near Camarilla S3 (within 0.5%)', formula: 'ABS(CLOSE - PIVOT(CAMARILLA, S3, D)) / CLOSE * 100 <= 0.5' },
    { label: 'Near 61.8% retracement (50 bars)', formula: 'ABS(CLOSE - FIB(61.8, 50)) / CLOSE * 100 <= 1' },
    { label: 'Near 38.2% retracement (50 bars)', formula: 'ABS(CLOSE - FIB(38.2, 50)) / CLOSE * 100 <= 1' },
    { label: 'Above the 161.8% extension', formula: 'CLOSE > FIB_EXT(161.8, 50)' },
  ] },
];
