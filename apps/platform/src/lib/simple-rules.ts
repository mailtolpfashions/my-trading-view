import { joinRowTf, splitRowTf } from './screener';
import type { Tf } from '@mtv/rules';
// Simple rules: pick an indicator, a condition and a value from lists; all rows must hold (AND), or any one (OR). Each choice is a
// formula template, so a rule written here is the same formula the engine runs, and a formula made here can be read
// back into rows. Formulas written by hand (or with the advanced builder) that don't match are left to that editor.

type Param = { key: 'a' | 'b' | 'c'; label: string; def: number };
type Cond = { id: string; label: string; formula: string; text: string; value?: { def: number; label: string; time?: boolean } };
export type Group = 'Trend' | 'Momentum' | 'Price action' | 'Volume' | 'Candles' | 'Time';
type Item = { id: string; label: string; group: Group; about: string; params: Param[]; conds: Cond[]; intraday?: boolean };
export const GROUPS: Group[] = ['Price action', 'Trend', 'Momentum', 'Volume', 'Candles', 'Time'];

/** {a} {b} {c}: the indicator's settings; {v}: the value; {t}: a time as HHMM. */
export const CATALOGUE: Item[] = [
  { id: 'supertrend', group: 'Trend', about: 'A trend line that flips under or over price: bullish while price stays above it.', label: 'Supertrend', params: [{ key: 'a', label: 'period', def: 10 }, { key: 'b', label: 'multiplier', def: 3 }], conds: [
    { id: 'bull', label: 'is bullish', formula: 'SUPERTREND_DIR({a}, {b}) = 1', text: 'Supertrend ({a}, {b}) is bullish' },
    { id: 'bear', label: 'is bearish', formula: 'SUPERTREND_DIR({a}, {b}) = -1', text: 'Supertrend ({a}, {b}) is bearish' },
    { id: 'turn-bull', label: 'turns bullish', formula: 'CROSSOVER(SUPERTREND_DIR({a}, {b}), 0)', text: 'Supertrend ({a}, {b}) turns bullish' },
    { id: 'turn-bear', label: 'turns bearish', formula: 'CROSSUNDER(SUPERTREND_DIR({a}, {b}), 0)', text: 'Supertrend ({a}, {b}) turns bearish' },
    { id: 'above', label: 'price closes above its line', formula: 'CLOSE > SUPERTREND({a}, {b})', text: 'the candle closes above the Supertrend ({a}, {b}) line' },
    { id: 'below', label: 'price closes below its line', formula: 'CLOSE < SUPERTREND({a}, {b})', text: 'the candle closes below the Supertrend ({a}, {b}) line' },
  ] },
  { id: 'rsi', group: 'Momentum', about: 'Strength of recent moves, 0 to 100: above 70 is strong, below 30 is weak.', label: 'RSI', params: [{ key: 'a', label: 'length', def: 14 }], conds: [
    { id: 'gt', label: 'is above', formula: 'RSI(CLOSE, {a}) > {v}', text: 'RSI ({a}) is above {v}', value: { def: 70, label: 'level' } },
    { id: 'lt', label: 'is below', formula: 'RSI(CLOSE, {a}) < {v}', text: 'RSI ({a}) is below {v}', value: { def: 30, label: 'level' } },
    { id: 'xup', label: 'crosses above', formula: 'CROSSOVER(RSI(CLOSE, {a}), {v})', text: 'RSI ({a}) crosses above {v}', value: { def: 70, label: 'level' } },
    { id: 'xdn', label: 'crosses below', formula: 'CROSSUNDER(RSI(CLOSE, {a}), {v})', text: 'RSI ({a}) crosses below {v}', value: { def: 30, label: 'level' } },
  ] },
  { id: 'ema', group: 'Trend', about: 'An average of recent closes that reacts quickly: price above it means an up-move.', label: 'EMA', params: [{ key: 'a', label: 'length', def: 20 }], conds: [
    { id: 'above', label: 'price closes above it', formula: 'CLOSE > EMA(CLOSE, {a})', text: 'the candle closes above EMA {a}' },
    { id: 'below', label: 'price closes below it', formula: 'CLOSE < EMA(CLOSE, {a})', text: 'the candle closes below EMA {a}' },
    { id: 'xup', label: 'price crosses above it', formula: 'CROSSOVER(CLOSE, EMA(CLOSE, {a}))', text: 'price crosses above EMA {a}' },
    { id: 'xdn', label: 'price crosses below it', formula: 'CROSSUNDER(CLOSE, EMA(CLOSE, {a}))', text: 'price crosses below EMA {a}' },
  ] },
  { id: 'ema-cross', group: 'Trend', about: 'A fast and a slow average: the fast one crossing above the slow one starts an up-move.', label: 'Two EMAs', params: [{ key: 'a', label: 'fast', def: 9 }, { key: 'b', label: 'slow', def: 21 }], conds: [
    { id: 'xup', label: 'fast crosses above slow', formula: 'CROSSOVER(EMA(CLOSE, {a}), EMA(CLOSE, {b}))', text: 'EMA {a} crosses above EMA {b}' },
    { id: 'xdn', label: 'fast crosses below slow', formula: 'CROSSUNDER(EMA(CLOSE, {a}), EMA(CLOSE, {b}))', text: 'EMA {a} crosses below EMA {b}' },
    { id: 'above', label: 'fast is above slow', formula: 'EMA(CLOSE, {a}) > EMA(CLOSE, {b})', text: 'EMA {a} is above EMA {b}' },
    { id: 'below', label: 'fast is below slow', formula: 'EMA(CLOSE, {a}) < EMA(CLOSE, {b})', text: 'EMA {a} is below EMA {b}' },
  ] },
  { id: 'macd', group: 'Momentum', about: 'The gap between two averages and its signal line: a cross shows momentum turning.', label: 'MACD', params: [{ key: 'a', label: 'fast', def: 12 }, { key: 'b', label: 'slow', def: 26 }, { key: 'c', label: 'signal', def: 9 }], conds: [
    { id: 'xup', label: 'crosses above its signal', formula: 'CROSSOVER(MACD_LINE(CLOSE, {a}, {b}, {c}), MACD_SIGNAL(CLOSE, {a}, {b}, {c}))', text: 'MACD ({a}, {b}, {c}) crosses above its signal line' },
    { id: 'xdn', label: 'crosses below its signal', formula: 'CROSSUNDER(MACD_LINE(CLOSE, {a}, {b}, {c}), MACD_SIGNAL(CLOSE, {a}, {b}, {c}))', text: 'MACD ({a}, {b}, {c}) crosses below its signal line' },
    { id: 'pos', label: 'is above zero', formula: 'MACD_LINE(CLOSE, {a}, {b}, {c}) > 0', text: 'MACD ({a}, {b}, {c}) is above zero' },
  ] },
  { id: 'adx', group: 'Trend', about: 'How strong the trend is, whatever its direction: above 25 is a real trend.', label: 'ADX (trend strength)', params: [{ key: 'a', label: 'length', def: 14 }, { key: 'b', label: 'smoothing', def: 14 }], conds: [
    { id: 'gt', label: 'is above', formula: 'ADX({a}, {b}) > {v}', text: 'ADX ({a}) is above {v}', value: { def: 25, label: 'level' } },
  ] },
  { id: 'bb', group: 'Price action', about: 'A band around the 20-candle average: closing outside it is a big move.', label: 'Bollinger Bands', params: [{ key: 'a', label: 'length', def: 20 }, { key: 'b', label: 'width', def: 2 }], conds: [
    { id: 'up', label: 'price closes above the upper band', formula: 'CLOSE > BB_UPPER(CLOSE, {a}, {b})', text: 'the candle closes above the upper Bollinger Band ({a}, {b})' },
    { id: 'dn', label: 'price closes below the lower band', formula: 'CLOSE < BB_LOWER(CLOSE, {a}, {b})', text: 'the candle closes below the lower Bollinger Band ({a}, {b})' },
    { id: 'back', label: 'price crosses back above the lower band', formula: 'CROSSOVER(CLOSE, BB_LOWER(CLOSE, {a}, {b}))', text: 'price crosses back above the lower Bollinger Band ({a}, {b})' },
  ] },
  { id: 'vwap', group: 'Price action', about: 'The day\'s average traded price: intraday buyers are in control above it.', label: 'VWAP', params: [], intraday: true, conds: [
    { id: 'above', label: 'price closes above it', formula: 'CLOSE > VWAP', text: 'the candle closes above VWAP' },
    { id: 'below', label: 'price closes below it', formula: 'CLOSE < VWAP', text: 'the candle closes below VWAP' },
    { id: 'xup', label: 'price crosses above it', formula: 'CROSSOVER(CLOSE, VWAP)', text: 'price crosses above VWAP' },
    { id: 'xdn', label: 'price crosses below it', formula: 'CROSSUNDER(CLOSE, VWAP)', text: 'price crosses below VWAP' },
  ] },
  { id: 'or', group: 'Price action', about: 'The high and low of the first minutes of the day: a break is a classic intraday entry.', label: 'Opening range', params: [{ key: 'a', label: 'minutes', def: 15 }], intraday: true, conds: [
    { id: 'up', label: 'price closes above its high', formula: 'CLOSE > OR_HIGH({a})', text: 'the candle closes above the first {a} minutes\' high' },
    { id: 'dn', label: 'price closes below its low', formula: 'CLOSE < OR_LOW({a})', text: 'the candle closes below the first {a} minutes\' low' },
  ] },
  { id: 'prev-day', group: 'Price action', about: 'Yesterday\'s high, low and close as levels for today.', label: 'Yesterday\'s range', params: [], conds: [
    { id: 'up', label: 'price closes above yesterday\'s high', formula: 'CLOSE > [D] HIGH[1]', text: 'the candle closes above yesterday\'s high' },
    { id: 'dn', label: 'price closes below yesterday\'s low', formula: 'CLOSE < [D] LOW[1]', text: 'the candle closes below yesterday\'s low' },
    { id: 'xup', label: 'price crosses above yesterday\'s high', formula: 'CROSSOVER(CLOSE, [D] HIGH[1])', text: 'price crosses above yesterday\'s high' },
    { id: 'xdn', label: 'price crosses below yesterday\'s low', formula: 'CROSSUNDER(CLOSE, [D] LOW[1])', text: 'price crosses below yesterday\'s low' },
    { id: 'cup', label: 'price is above yesterday\'s close', formula: 'CLOSE > [D] CLOSE[1]', text: 'price is above yesterday\'s close' },
    { id: 'cdn', label: 'price is below yesterday\'s close', formula: 'CLOSE < [D] CLOSE[1]', text: 'price is below yesterday\'s close' },
  ] },
  { id: 'volume', group: 'Volume', about: 'Whether more shares than usual are trading: moves on high volume are stronger.', label: 'Volume', params: [{ key: 'a', label: 'average of', def: 20 }], conds: [
    { id: 'sma', label: 'is more than N × its average', formula: 'VOLUME > {v} * SMA(VOLUME, {a})', text: 'volume is more than {v}× its {a}-candle average', value: { def: 2, label: '×' } },
    { id: 'avg', label: 'is more than N × the average before it', formula: 'RVOL({a}) > {v}', text: 'volume is over {v}× its {a}-candle average before this candle', value: { def: 1.5, label: '×' } },
    { id: 'tod', label: 'is higher than usual for this time of day', formula: 'RVOL_TOD({a}) > {v}', text: 'volume is over {v}× the usual for this time of day ({a} days)', value: { def: 1.5, label: '×' } },
  ] },
  { id: 'candle', group: 'Candles', about: 'The colour of the candle that just closed.', label: 'Candle', params: [], conds: [
    { id: 'green', label: 'is green (closes above its open)', formula: 'CLOSE > OPEN', text: 'the candle is green' },
    { id: 'red', label: 'is red (closes below its open)', formula: 'CLOSE < OPEN', text: 'the candle is red' },
  ] },
  { id: 'price', group: 'Price action', about: 'The price itself against a fixed level.', label: 'Price', params: [], conds: [
    { id: 'gt', label: 'closes above', formula: 'CLOSE > {v}', text: 'the candle closes above ₹{v}', value: { def: 100, label: '₹' } },
    { id: 'lt', label: 'closes below', formula: 'CLOSE < {v}', text: 'the candle closes below ₹{v}', value: { def: 100, label: '₹' } },
  ] },
  { id: 'time', group: 'Time', about: 'Only during part of the day.', label: 'Time', params: [], intraday: true, conds: [
    { id: 'from', label: 'is from', formula: 'TIME >= {t}', text: 'the candle closes at or after {t}', value: { def: 920, label: 'time', time: true } },
    { id: 'before', label: 'is before', formula: 'TIME < {t}', text: 'the candle closes before {t}', value: { def: 1500, label: 'time', time: true } },
  ] },
  { id: 'pivot-d', group: 'Price action', about: 'Today\'s classic pivot levels from yesterday\'s high, low and close: R1 and R2 above, S1 and S2 below.', label: 'Pivot levels (daily)', params: [], conds: [
    { id: 'r1-x', label: 'price crosses above R1', formula: 'CROSSOVER(CLOSE, PIVOT(CLASSIC, R1, D))', text: 'price crosses above the daily R1' },
    { id: 'r1', label: 'price closes above R1', formula: 'CLOSE > PIVOT(CLASSIC, R1, D)', text: 'the candle closes above the daily R1' },
    { id: 'r2', label: 'price closes above R2', formula: 'CLOSE > PIVOT(CLASSIC, R2, D)', text: 'the candle closes above the daily R2' },
    { id: 'p-up', label: 'price closes above the pivot (P)', formula: 'CLOSE > PIVOT(CLASSIC, P, D)', text: 'the candle closes above the daily pivot' },
    { id: 'p-dn', label: 'price closes below the pivot (P)', formula: 'CLOSE < PIVOT(CLASSIC, P, D)', text: 'the candle closes below the daily pivot' },
    { id: 's1-x', label: 'price crosses below S1', formula: 'CROSSUNDER(CLOSE, PIVOT(CLASSIC, S1, D))', text: 'price crosses below the daily S1' },
    { id: 's1', label: 'price closes below S1', formula: 'CLOSE < PIVOT(CLASSIC, S1, D)', text: 'the candle closes below the daily S1' },
    { id: 's2', label: 'price closes below S2', formula: 'CLOSE < PIVOT(CLASSIC, S2, D)', text: 'the candle closes below the daily S2' },
  ] },
  { id: 'pivot-w', group: 'Price action', about: 'This week\'s classic pivot levels from last week\'s high, low and close.', label: 'Pivot levels (weekly)', params: [], conds: [
    { id: 'r1-x', label: 'price crosses above R1', formula: 'CROSSOVER(CLOSE, PIVOT(CLASSIC, R1, W))', text: 'price crosses above the weekly R1' },
    { id: 'r1', label: 'price closes above R1', formula: 'CLOSE > PIVOT(CLASSIC, R1, W)', text: 'the candle closes above the weekly R1' },
    { id: 'r2', label: 'price closes above R2', formula: 'CLOSE > PIVOT(CLASSIC, R2, W)', text: 'the candle closes above the weekly R2' },
    { id: 'p-up', label: 'price closes above the pivot (P)', formula: 'CLOSE > PIVOT(CLASSIC, P, W)', text: 'the candle closes above the weekly pivot' },
    { id: 'p-dn', label: 'price closes below the pivot (P)', formula: 'CLOSE < PIVOT(CLASSIC, P, W)', text: 'the candle closes below the weekly pivot' },
    { id: 's1-x', label: 'price crosses below S1', formula: 'CROSSUNDER(CLOSE, PIVOT(CLASSIC, S1, W))', text: 'price crosses below the weekly S1' },
    { id: 's1', label: 'price closes below S1', formula: 'CLOSE < PIVOT(CLASSIC, S1, W)', text: 'the candle closes below the weekly S1' },
    { id: 's2', label: 'price closes below S2', formula: 'CLOSE < PIVOT(CLASSIC, S2, W)', text: 'the candle closes below the weekly S2' },
  ] },
  { id: 'gap', group: 'Price action', about: 'How far today opened from yesterday\'s close.', label: 'Opening gap', params: [], conds: [
    { id: 'up', label: 'opened higher by more than', formula: '[D] GAP_PCT > {v}', text: 'today opened more than {v}% above yesterday\'s close', value: { def: 1, label: '%' } },
    { id: 'dn', label: 'opened lower by more than', formula: '[D] GAP_PCT < -{v}', text: 'today opened more than {v}% below yesterday\'s close', value: { def: 1, label: '%' } },
    { id: 'small', label: 'opened within', formula: '[D] ABS(GAP_PCT) < {v}', text: 'today opened within {v}% of yesterday\'s close (no big gap)', value: { def: 1, label: '%' } },
  ] },
  { id: 'change', group: 'Price action', about: 'How much the price has moved today against yesterday\'s close.', label: 'Change today', params: [], conds: [
    { id: 'up', label: 'is up more than', formula: '[D] CHANGE_PCT(CLOSE, 1) > {v}', text: 'the stock is up more than {v}% today', value: { def: 1, label: '%' } },
    { id: 'dn', label: 'is down more than', formula: '[D] CHANGE_PCT(CLOSE, 1) < -{v}', text: 'the stock is down more than {v}% today', value: { def: 1, label: '%' } },
  ] },
  { id: 'range', group: 'Price action', about: 'The highest high or lowest low of the last N candles: a break of it is a breakout.', label: 'Highest / lowest of recent candles', params: [{ key: 'a', label: 'candles', def: 20 }], conds: [
    { id: 'up', label: 'price closes above the highest high', formula: 'CLOSE > HIGHEST(HIGH, {a})[1]', text: 'the candle closes above the highest high of the previous {a} candles' },
    { id: 'dn', label: 'price closes below the lowest low', formula: 'CLOSE < LOWEST(LOW, {a})[1]', text: 'the candle closes below the lowest low of the previous {a} candles' },
  ] },
  { id: 'high52', group: 'Price action', about: 'The highest and lowest prices of the last year (252 trading days).', label: '52-week high / low', params: [], conds: [
    { id: 'up', label: 'price closes above the 52-week high', formula: 'CLOSE > [D] HIGHEST(HIGH, 252)[1]', text: 'the candle closes above the 52-week high' },
    { id: 'near', label: 'price is within % of the 52-week high', formula: 'CLOSE >= [D] HIGHEST(HIGH, 252) * (1 - {v} / 100)', text: 'price is within {v}% of its 52-week high', value: { def: 3, label: '%' } },
    { id: 'dn', label: 'price closes below the 52-week low', formula: 'CLOSE < [D] LOWEST(LOW, 252)[1]', text: 'the candle closes below the 52-week low' },
  ] },
  { id: 'sma', group: 'Trend', about: 'A slow average of closes: price above the 200-day SMA is the classic long-term uptrend filter.', label: 'SMA (trend filter)', params: [{ key: 'a', label: 'length', def: 200 }], conds: [
    { id: 'above', label: 'price is above it', formula: 'CLOSE > SMA(CLOSE, {a})', text: 'price is above SMA {a}' },
    { id: 'below', label: 'price is below it', formula: 'CLOSE < SMA(CLOSE, {a})', text: 'price is below SMA {a}' },
    { id: 'dabove', label: 'daily price is above it', formula: '[D] CLOSE > [D] SMA(CLOSE, {a})', text: 'the daily close is above the daily SMA {a}' },
  ] },
  { id: 'stoch', group: 'Momentum', about: 'Where the close sits in the recent high-low range, 0 to 100: below 20 is oversold, above 80 overbought.', label: 'Stochastic', params: [{ key: 'a', label: 'length', def: 14 }], conds: [
    { id: 'xup', label: 'crosses above', formula: 'CROSSOVER(STOCH_K({a}, 3), {v})', text: 'Stochastic ({a}) crosses above {v}', value: { def: 20, label: 'level' } },
    { id: 'xdn', label: 'crosses below', formula: 'CROSSUNDER(STOCH_K({a}, 3), {v})', text: 'Stochastic ({a}) crosses below {v}', value: { def: 80, label: 'level' } },
    { id: 'lt', label: 'is below', formula: 'STOCH_K({a}, 3) < {v}', text: 'Stochastic ({a}) is below {v}', value: { def: 20, label: 'level' } },
    { id: 'gt', label: 'is above', formula: 'STOCH_K({a}, 3) > {v}', text: 'Stochastic ({a}) is above {v}', value: { def: 80, label: 'level' } },
  ] },
  { id: 'pattern', group: 'Candles', about: 'A candlestick pattern completes on the candle that just closed (Charts → Patterns shows how each tested).', label: 'Candlestick pattern', params: [], conds: [
    { id: 'hammer', label: 'Hammer', formula: 'HAMMER', text: 'a hammer candle forms' },
    { id: 'bullish_engulfing', label: 'Bullish engulfing', formula: 'BULLISH_ENGULFING', text: 'a bullish engulfing candle forms' },
    { id: 'morning_star', label: 'Morning star', formula: 'MORNING_STAR', text: 'a morning star candle forms' },
    { id: 'dragonfly_doji', label: 'Dragonfly doji', formula: 'DRAGONFLY_DOJI', text: 'a dragonfly doji candle forms' },
    { id: 'piercing_line', label: 'Piercing line', formula: 'PIERCING_LINE', text: 'a piercing line candle forms' },
    { id: 'bullish_harami', label: 'Bullish harami', formula: 'BULLISH_HARAMI', text: 'a bullish harami candle forms' },
    { id: 'tweezer_bottom', label: 'Tweezer bottom', formula: 'TWEEZER_BOTTOM', text: 'a tweezer bottom candle forms' },
    { id: 'three_white_soldiers', label: 'Three white soldiers', formula: 'THREE_WHITE_SOLDIERS', text: 'a three white soldiers candle forms' },
    { id: 'bullish_marubozu', label: 'Bullish marubozu', formula: 'BULLISH_MARUBOZU', text: 'a bullish marubozu candle forms' },
    { id: 'inverted_hammer', label: 'Inverted hammer', formula: 'INVERTED_HAMMER', text: 'a inverted hammer candle forms' },
    { id: 'three_inside_up', label: 'Three inside up', formula: 'THREE_INSIDE_UP', text: 'a three inside up candle forms' },
    { id: 'shooting_star', label: 'Shooting star', formula: 'SHOOTING_STAR', text: 'a shooting star candle forms' },
    { id: 'bearish_engulfing', label: 'Bearish engulfing', formula: 'BEARISH_ENGULFING', text: 'a bearish engulfing candle forms' },
    { id: 'evening_star', label: 'Evening star', formula: 'EVENING_STAR', text: 'a evening star candle forms' },
    { id: 'gravestone_doji', label: 'Gravestone doji', formula: 'GRAVESTONE_DOJI', text: 'a gravestone doji candle forms' },
    { id: 'dark_cloud_cover', label: 'Dark cloud cover', formula: 'DARK_CLOUD_COVER', text: 'a dark cloud cover candle forms' },
    { id: 'bearish_harami', label: 'Bearish harami', formula: 'BEARISH_HARAMI', text: 'a bearish harami candle forms' },
    { id: 'tweezer_top', label: 'Tweezer top', formula: 'TWEEZER_TOP', text: 'a tweezer top candle forms' },
    { id: 'three_black_crows', label: 'Three black crows', formula: 'THREE_BLACK_CROWS', text: 'a three black crows candle forms' },
    { id: 'bearish_marubozu', label: 'Bearish marubozu', formula: 'BEARISH_MARUBOZU', text: 'a bearish marubozu candle forms' },
    { id: 'hanging_man', label: 'Hanging man', formula: 'HANGING_MAN', text: 'a hanging man candle forms' },
    { id: 'three_inside_down', label: 'Three inside down', formula: 'THREE_INSIDE_DOWN', text: 'a three inside down candle forms' },
    { id: 'doji', label: 'Doji', formula: 'DOJI', text: 'a doji candle forms' },
  ] },
];

/** One-click starting rules for a new strategy (each is ordinary rows: change anything after). */
export const STARTERS: { label: string; about: string; mode: Mode; rows: Row[]; intraday?: boolean }[] = [
  { label: 'Break of yesterday\'s high', about: 'Price crosses above yesterday\'s high on above-usual volume.', mode: 'all', rows: [{ item: 'prev-day', cond: 'xup', p: {} }, { item: 'volume', cond: 'avg', p: {}, v: 1.5 }] },
  { label: 'R1 breakout with RSI', about: 'Price crosses above today\'s R1 while RSI (14) is above 60.', mode: 'all', rows: [{ item: 'pivot-d', cond: 'r1-x', p: {} }, { item: 'rsi', cond: 'gt', p: { a: 14 }, v: 60 }] },
  { label: 'Opening-range breakout', about: 'A candle closes above the first 15 minutes\' high, above VWAP.', mode: 'all', intraday: true, rows: [{ item: 'or', cond: 'up', p: { a: 15 } }, { item: 'vwap', cond: 'above', p: {} }] },
  { label: 'Supertrend turns up', about: 'Supertrend (10, 3) turns bullish while price is above the 200-day SMA.', mode: 'all', rows: [{ item: 'supertrend', cond: 'turn-bull', p: { a: 10, b: 3 } }, { item: 'sma', cond: 'dabove', p: { a: 200 } }] },
  { label: 'EMA crossover', about: 'EMA 9 crosses above EMA 21.', mode: 'all', rows: [{ item: 'ema-cross', cond: 'xup', p: { a: 9, b: 21 } }] },
  { label: 'Bounce from oversold', about: 'RSI (14) crosses back above 30.', mode: 'all', rows: [{ item: 'rsi', cond: 'xup', p: { a: 14 }, v: 30 }] },
];

/** One condition; `tf` reads it on another timeframe than the strategy's candles (e.g. a daily trend filter). */
export type Row = { item: string; cond: string; p: Partial<Record<'a' | 'b' | 'c', number>>; v?: number; tf?: string };

/** Conditions that read fixed timeframes or the session themselves (pivots, yesterday, gap, time, VWAP…): no own timeframe. */
export const hasOwnTf = (itemId: string) => {
  const it = CATALOGUE.find((i) => i.id === itemId);
  return !!it && !it.conds.some((c) => /\[D\]|\[W\]|PIVOT\(|TIME|VWAP|OR_HIGH|OR_LOW|RVOL_TOD/.test(c.formula));
};
export const ROW_TFS: [string, string][] = [['1m', '1 min'], ['5m', '5 min'], ['15m', '15 min'], ['1h', '1 hour'], ['D', 'daily'], ['W', 'weekly']];
const TF_WORD = Object.fromEntries(ROW_TFS);
/** All conditions must hold (AND), or any one is enough (OR). */
export type Mode = 'all' | 'any';

export const toHHMM = (n: number) => `${String(Math.floor(n / 100)).padStart(2, '0')}:${String(n % 100).padStart(2, '0')}`;
export const fromHHMM = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 100 + (m || 0); };
const fill = (tpl: string, r: Row, item: Item, cond: Cond) => tpl.replace(/\{([abcvt])\}/g, (_, k: string) => {
  if (k === 'v') return String(r.v ?? cond.value?.def ?? 0);
  if (k === 't') return cond.value?.time && tpl === cond.text ? toHHMM(r.v ?? cond.value.def) : String(r.v ?? cond.value?.def ?? 0);
  return String(r.p[k as 'a'] ?? item.params.find((x) => x.key === k)?.def ?? 0);
});
export const find = (r: Row) => { const item = CATALOGUE.find((i) => i.id === r.item)!; return { item, cond: item.conds.find((c) => c.id === r.cond) ?? item.conds[0] }; };

export const rowFormula = (r: Row) => { const { item, cond } = find(r); const f = fill(cond.formula, r, item, cond); return r.tf ? joinRowTf(r.tf as Tf, f) : f; };
export const rowText = (r: Row) => { const { item, cond } = find(r); const t = fill(cond.text, r, item, cond); return r.tf ? `on ${TF_WORD[r.tf] ?? r.tf} candles ${t}` : t; };
export const rowsFormula = (rows: Row[], mode: Mode = 'all') => rows.map(rowFormula).join(mode === 'any' ? ' OR ' : ' AND ');
/** "A, B and C" (or "A, B or C") */
export const rowsText = (rows: Row[], mode: Mode = 'all') => { const t = rows.map(rowText); return t.length < 2 ? t.join('') : `${t.slice(0, -1).join(', ')} ${mode === 'any' ? 'or' : 'and'} ${t.at(-1)}`; };

/** Reads a formula back into rows and whether they are joined by AND or OR; null when it needs the advanced editor. */
export function parseRules(formula: string): { rows: Row[]; mode: Mode } | null {
  const ors = splitTop(formula.trim(), ' OR ');
  if (ors.length > 1) {
    if (ors.some((x) => splitTop(x, ' AND ').length > 1)) return null; // AND and OR mixed: the advanced editor
    const rows = parseRows(ors.join(' AND '));
    return rows ? { rows, mode: 'any' } : null;
  }
  const rows = parseRows(formula);
  return rows ? { rows, mode: 'all' } : null;
}

/** Reads a formula made by this editor back into rows; null when any part isn't one of the catalogue's conditions. */
export function parseRows(formula: string): Row[] | null {
  const f = formula.trim();
  if (!f) return [];
  const parts = splitAnd(f);
  const rows: Row[] = [];
  for (const whole of parts) {
    // As written first (some conditions start with their own [D] themselves); then as "[tf] (condition)": a
    // condition the owner put on its own timeframe.
    let hit = matchRow(whole);
    if (!hit && whole.trim().startsWith('[')) {
      const own = splitRowTf(whole);
      if (own.tf && own.tf !== 'mixed') { const r = matchRow(own.text); if (r && hasOwnTf(r.item)) hit = { ...r, tf: own.tf }; }
    }
    if (!hit) return null;
    rows.push(hit);
  }
  return rows;
}

/** One condition of the catalogue, read from its formula; null when it is not one of them. */
function matchRow(part: string): Row | null {
  for (const item of CATALOGUE) for (const cond of item.conds) {
    const keys: string[] = [];
    const re = new RegExp(`^${cond.formula.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{([abcvt])\}/g, (_, k: string) => { keys.push(k); return '(-?\\d+(?:\\.\\d+)?)'; })}$`);
    const m = re.exec(part.replace(/\s+/g, ' ').trim());
    if (!m) continue;
    const r: Row = { item: item.id, cond: cond.id, p: {} };
    keys.forEach((k, i) => { const n = Number(m[i + 1]); if (k === 'v' || k === 't') r.v = n; else r.p[k as 'a'] = n; });
    return r;
  }
  return null;
}

/** Splits on AND outside brackets. */
const splitAnd = (f: string) => splitTop(f, ' AND ');
/** Splits on a joining word outside brackets. */
function splitTop(f: string, word: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < f.length; i++) {
    const ch = f[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && f.startsWith(word, i)) { out.push(f.slice(start, i)); start = i + word.length; i += word.length - 1; }
  }
  out.push(f.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

