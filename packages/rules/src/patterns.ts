// Candlestick patterns: candle relationships only, each rule written out so a user can check it. A pattern is not a
// buy or sell signal; add trend context as a separate condition (e.g. CLOSE < SMA(CLOSE, 50)). The exception is a
// pair that has the same shape and differs only in what came before (Hammer / Hanging Man, Inverted Hammer / Shooting
// Star): there the prior move is part of the name, defined as the previous close against the close 5 bars before it.
// "Long" and "small" bodies compare with the average body, EMA(body, 14), as TradingView's pattern scripts do.

import { ema, type Series } from '@mtv/indicators';
import type { Candle } from '@mtv/shared';

type Ctx = {
  c: Candle[];
  body: number[]; avg: Series; range: number[]; upper: number[]; lower: number[];
};
type Rule = (x: Ctx, i: number) => boolean;

export type PatternDef = { name: string; bars: number; side: 'bullish' | 'bearish' | 'neutral'; rule: string; test: Rule };

const white = (x: Ctx, i: number) => x.c[i].close > x.c[i].open;
const black = (x: Ctx, i: number) => x.c[i].close < x.c[i].open;
const long = (x: Ctx, i: number) => x.avg[i] != null && x.body[i] > x.avg[i]!;
const small = (x: Ctx, i: number) => x.avg[i] != null && x.body[i] < x.avg[i]!;
const hiB = (x: Ctx, i: number) => Math.max(x.c[i].open, x.c[i].close);
const loB = (x: Ctx, i: number) => Math.min(x.c[i].open, x.c[i].close);
const mid = (x: Ctx, i: number) => (x.c[i].open + x.c[i].close) / 2;
const doji = (x: Ctx, i: number) => x.range[i] > 0 && x.body[i] <= 0.05 * x.range[i];
const fell = (x: Ctx, i: number) => i >= 6 && x.c[i - 1].close < x.c[i - 6].close;
const rose = (x: Ctx, i: number) => i >= 6 && x.c[i - 1].close > x.c[i - 6].close;
const hammerShape = (x: Ctx, i: number) => x.body[i] > 0 && small(x, i) && x.lower[i] >= 2 * x.body[i] && x.upper[i] <= 0.1 * x.range[i];
const invertedShape = (x: Ctx, i: number) => x.body[i] > 0 && small(x, i) && x.upper[i] >= 2 * x.body[i] && x.lower[i] <= 0.1 * x.range[i];
const engulfsUp = (x: Ctx, i: number) => black(x, i - 1) && white(x, i) && x.c[i].open <= x.c[i - 1].close && x.c[i].close >= x.c[i - 1].open && x.body[i] > x.body[i - 1];
const engulfsDown = (x: Ctx, i: number) => white(x, i - 1) && black(x, i) && x.c[i].open >= x.c[i - 1].close && x.c[i].close <= x.c[i - 1].open && x.body[i] > x.body[i - 1];
const haramiUp = (x: Ctx, i: number) => black(x, i - 1) && long(x, i - 1) && white(x, i) && small(x, i) && hiB(x, i) <= x.c[i - 1].open && loB(x, i) >= x.c[i - 1].close;
const haramiDown = (x: Ctx, i: number) => white(x, i - 1) && long(x, i - 1) && black(x, i) && small(x, i) && hiB(x, i) <= x.c[i - 1].close && loB(x, i) >= x.c[i - 1].open;
const soldier = (x: Ctx, i: number) => white(x, i) && long(x, i) && x.upper[i] < 0.25 * x.body[i];
const crow = (x: Ctx, i: number) => black(x, i) && long(x, i) && x.lower[i] < 0.25 * x.body[i];
const near = (a: number, b: number, ref: number) => Math.abs(a - b) <= 0.001 * ref;

export const PATTERNS: PatternDef[] = [
  { name: 'DOJI', bars: 1, side: 'neutral', rule: 'Body at most 5% of the high-low range.', test: doji },
  { name: 'DRAGONFLY_DOJI', bars: 1, side: 'bullish', rule: 'Doji with an upper shadow of at most 10% of the range (open and close near the high).', test: (x, i) => doji(x, i) && x.upper[i] <= 0.1 * x.range[i] },
  { name: 'GRAVESTONE_DOJI', bars: 1, side: 'bearish', rule: 'Doji with a lower shadow of at most 10% of the range (open and close near the low).', test: (x, i) => doji(x, i) && x.lower[i] <= 0.1 * x.range[i] },
  { name: 'SPINNING_TOP', bars: 1, side: 'neutral', rule: 'Small body (below the average body), not a doji, with both shadows at least as long as the body.', test: (x, i) => small(x, i) && !doji(x, i) && x.upper[i] >= x.body[i] && x.lower[i] >= x.body[i] },
  { name: 'BULLISH_MARUBOZU', bars: 1, side: 'bullish', rule: 'Long white body with each shadow at most 5% of the body.', test: (x, i) => white(x, i) && long(x, i) && x.upper[i] <= 0.05 * x.body[i] && x.lower[i] <= 0.05 * x.body[i] },
  { name: 'BEARISH_MARUBOZU', bars: 1, side: 'bearish', rule: 'Long black body with each shadow at most 5% of the body.', test: (x, i) => black(x, i) && long(x, i) && x.upper[i] <= 0.05 * x.body[i] && x.lower[i] <= 0.05 * x.body[i] },
  { name: 'HAMMER', bars: 1, side: 'bullish', rule: 'After a decline (previous close below the close 5 bars before it): small body, lower shadow at least 2× the body, upper shadow at most 10% of the range.', test: (x, i) => fell(x, i) && hammerShape(x, i) },
  { name: 'HANGING_MAN', bars: 1, side: 'bearish', rule: 'The hammer shape after a rise (previous close above the close 5 bars before it).', test: (x, i) => rose(x, i) && hammerShape(x, i) },
  { name: 'INVERTED_HAMMER', bars: 1, side: 'bullish', rule: 'After a decline: small body, upper shadow at least 2× the body, lower shadow at most 10% of the range.', test: (x, i) => fell(x, i) && invertedShape(x, i) },
  { name: 'SHOOTING_STAR', bars: 1, side: 'bearish', rule: 'The inverted-hammer shape after a rise.', test: (x, i) => rose(x, i) && invertedShape(x, i) },
  { name: 'BULLISH_ENGULFING', bars: 2, side: 'bullish', rule: 'A black candle, then a white candle whose body covers it: open at or below the previous close, close at or above the previous open, larger body.', test: (x, i) => i >= 1 && engulfsUp(x, i) },
  { name: 'BEARISH_ENGULFING', bars: 2, side: 'bearish', rule: 'A white candle, then a black candle whose body covers it.', test: (x, i) => i >= 1 && engulfsDown(x, i) },
  { name: 'BULLISH_HARAMI', bars: 2, side: 'bullish', rule: 'A long black candle, then a small white candle whose body sits inside the previous body.', test: (x, i) => i >= 1 && haramiUp(x, i) },
  { name: 'BEARISH_HARAMI', bars: 2, side: 'bearish', rule: 'A long white candle, then a small black candle whose body sits inside the previous body.', test: (x, i) => i >= 1 && haramiDown(x, i) },
  { name: 'PIERCING_LINE', bars: 2, side: 'bullish', rule: 'A long black candle, then a white candle that opens below its close and closes above its body midpoint but below its open.', test: (x, i) => i >= 1 && black(x, i - 1) && long(x, i - 1) && white(x, i) && x.c[i].open < x.c[i - 1].close && x.c[i].close > mid(x, i - 1) && x.c[i].close < x.c[i - 1].open },
  { name: 'DARK_CLOUD_COVER', bars: 2, side: 'bearish', rule: 'A long white candle, then a black candle that opens above its close and closes below its body midpoint but above its open.', test: (x, i) => i >= 1 && white(x, i - 1) && long(x, i - 1) && black(x, i) && x.c[i].open > x.c[i - 1].close && x.c[i].close < mid(x, i - 1) && x.c[i].close > x.c[i - 1].open },
  { name: 'TWEEZER_BOTTOM', bars: 2, side: 'bullish', rule: 'A black candle, then a white candle, with lows within 0.1% of each other.', test: (x, i) => i >= 1 && black(x, i - 1) && white(x, i) && near(x.c[i].low, x.c[i - 1].low, x.c[i].close) },
  { name: 'TWEEZER_TOP', bars: 2, side: 'bearish', rule: 'A white candle, then a black candle, with highs within 0.1% of each other.', test: (x, i) => i >= 1 && white(x, i - 1) && black(x, i) && near(x.c[i].high, x.c[i - 1].high, x.c[i].close) },
  { name: 'MORNING_STAR', bars: 3, side: 'bullish', rule: 'A long black candle; a small-bodied candle whose body is below its close; a white candle closing above the first body\'s midpoint.', test: (x, i) => i >= 2 && black(x, i - 2) && long(x, i - 2) && small(x, i - 1) && hiB(x, i - 1) < x.c[i - 2].close && white(x, i) && x.c[i].close > mid(x, i - 2) },
  { name: 'EVENING_STAR', bars: 3, side: 'bearish', rule: 'A long white candle; a small-bodied candle whose body is above its close; a black candle closing below the first body\'s midpoint.', test: (x, i) => i >= 2 && white(x, i - 2) && long(x, i - 2) && small(x, i - 1) && loB(x, i - 1) > x.c[i - 2].close && black(x, i) && x.c[i].close < mid(x, i - 2) },
  { name: 'THREE_WHITE_SOLDIERS', bars: 3, side: 'bullish', rule: 'Three long white candles, each closing higher, each opening inside the previous body, upper shadows under 25% of the body.', test: (x, i) => i >= 2 && [i - 2, i - 1, i].every((k) => soldier(x, k)) && [i - 1, i].every((k) => x.c[k].close > x.c[k - 1].close && x.c[k].open >= x.c[k - 1].open && x.c[k].open <= x.c[k - 1].close) },
  { name: 'THREE_BLACK_CROWS', bars: 3, side: 'bearish', rule: 'Three long black candles, each closing lower, each opening inside the previous body, lower shadows under 25% of the body.', test: (x, i) => i >= 2 && [i - 2, i - 1, i].every((k) => crow(x, k)) && [i - 1, i].every((k) => x.c[k].close < x.c[k - 1].close && x.c[k].open <= x.c[k - 1].open && x.c[k].open >= x.c[k - 1].close) },
  { name: 'THREE_INSIDE_UP', bars: 3, side: 'bullish', rule: 'A bullish harami, then a white candle closing above the first candle\'s open.', test: (x, i) => i >= 2 && haramiUp(x, i - 1) && white(x, i) && x.c[i].close > x.c[i - 2].open },
  { name: 'THREE_INSIDE_DOWN', bars: 3, side: 'bearish', rule: 'A bearish harami, then a black candle closing below the first candle\'s open.', test: (x, i) => i >= 2 && haramiDown(x, i - 1) && black(x, i) && x.c[i].close < x.c[i - 2].open },
];

/** 1 where the pattern completes on that bar, 0 where it does not, null before the average body exists. */
export function patternSeries(c: Candle[], test: Rule): Series {
  const body = c.map((b) => Math.abs(b.close - b.open));
  const x: Ctx = {
    c, body, avg: ema(body, 14),
    range: c.map((b) => b.high - b.low),
    upper: c.map((b) => b.high - Math.max(b.open, b.close)),
    lower: c.map((b) => Math.min(b.open, b.close) - b.low),
  };
  return c.map((_, i) => (x.avg[i] == null ? null : test(x, i) ? 1 : 0));
}
