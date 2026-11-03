import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Candle } from '@mtv/shared';
import {
  CONDITION_LIBRARY, Evaluator, FUNCTIONS, PRESETS, checkTimeframes, lookback, parseFormula, print, type Node, type Tf,
} from './index';
import { resample } from './resample';

const ok = (f: string) => {
  const p = parseFormula(f);
  if (!p.ok) throw new Error(`${f}: ${p.error}`);
  return p;
};
const err = (f: string) => {
  const p = parseFormula(f);
  if (p.ok) throw new Error(`${f} should not parse`);
  return p;
};

describe('formula parsing', () => {
  it('parses the spec\'s formula example and prints it back with every argument', () => {
    const p = ok('(CLOSE > EMA(CLOSE, 50) AND RSI(CLOSE, 14) > 55) AND (MACD_LINE > MACD_SIGNAL OR SUPERTREND_DIRECTION = 1)');
    expect(p.type).toBe('bool');
    expect(p.formula).toBe('(CLOSE > EMA(CLOSE, 50) AND RSI(CLOSE, 14) > 55) AND (MACD_LINE(CLOSE, 12, 26, 9) > MACD_SIGNAL(CLOSE, 12, 26, 9) OR SUPERTREND_DIR(10, 3) = 1)');
  });

  it('accepts a call without its source and lower-case words', () => {
    expect(ok('rsi(14) > 55').formula).toBe('RSI(CLOSE, 14) > 55');
    expect(ok('close > ema(50)').formula).toBe('CLOSE > EMA(CLOSE, 50)');
    expect(ok('ltp crosses above sma(close, 20)').formula).toBe('CROSSOVER(CLOSE, SMA(CLOSE, 20))');
    expect(ok('EMA(9) CROSSED_BELOW EMA(21)').formula).toBe('CROSSUNDER(EMA(CLOSE, 9), EMA(CLOSE, 21))');
    expect(ok('AVG_TURNOVER(20) > 1e8').formula).toBe('AVG_TURNOVER(20) > 100000000');
  });

  it('reads timeframes TradingView-style and offsets', () => {
    expect(ok('[1h] RSI(14) > 55').formula).toBe('[1h] RSI(CLOSE, 14) > 55');
    expect(ok('[60m] CLOSE > [1M] HIGH[1]').formula).toBe('[1h] CLOSE > [M] HIGH[1]');
    expect(ok('[5m] CLOSE > [5m] VWAP').formula).toBe('[5m] CLOSE > [5m] VWAP');
    expect(ok('REF(CLOSE, 2) < CLOSE').formula).toBe('CLOSE[2] < CLOSE');
    expect(ok('([D] HIGH)[1] > 0').formula).toBe('([D] HIGH)[1] > 0');
  });

  it('keeps the grouping the user wrote, and only needed parentheses', () => {
    expect(ok('CLOSE > 1 AND (OPEN > 1 AND HIGH > 1)').formula).toBe('CLOSE > 1 AND (OPEN > 1 AND HIGH > 1)');
    expect(ok('(CLOSE - OPEN) / (HIGH - LOW) > 0.5').formula).toBe('(CLOSE - OPEN) / (HIGH - LOW) > 0.5');
    expect(ok('CLOSE - (OPEN - LOW) > 0').formula).toBe('CLOSE - (OPEN - LOW) > 0');
    expect(ok('NOT (CLOSE > OPEN OR VOLUME > 0)').formula).toBe('NOT (CLOSE > OPEN OR VOLUME > 0)');
  });

  it('round-trips: printing then parsing gives the same tree', () => {
    for (const f of ['CLOSE > HIGHEST(HIGH, 252)[1] AND RVOL(20) > 1.5', 'NOT INSIDE_BAR OR -CLOSE < -5', '[W] (CLOSE > EMA(CLOSE, 20)) AND RSI(CLOSE, 14) < 40', 'BETWEEN(RSI(CLOSE, 14), 40, 60)']) {
      const a = ok(f).formula;
      expect(ok(a).formula).toBe(a);
    }
  });

  it('explains mistakes and points at them', () => {
    expect(err('CLOSE > ').error).toMatch(/ends too early/);
    expect(err('RSI(CLOSE, 0) > 5').error).toMatch(/whole number from 1/);
    const tf = err('[1x] CLOSE > 1');
    expect(tf.error).toMatch(/not a timeframe/);
    expect(tf.span).toEqual([1, 3]);
    expect(err('CLOSE > 5 AND 3').error).toMatch(/joins conditions/);
    expect(err('FOO(1) > 2').error).toMatch(/Unknown function "FOO"/);
    expect(err('CLOSE > 1 < 2').error).toMatch(/BETWEEN/);
    expect(ok('RSI(CLOSE, 14)').type).toBe('num'); // a value is fine on its own (a results column)
    expect(err('PIVOT(CLASSIC, R9) > 0').error).toMatch(/level must be one of/);
    expect(err('CLOSE > OPEN XYZ').error).toMatch(/AND \/ OR missing/);
  });

  it('every preset and library condition parses as a condition', () => {
    for (const p of PRESETS) {
      const r = ok(p.formula);
      expect(r.type, p.id).toBe('bool');
      checkTimeframes(r.node);
    }
    for (const g of CONDITION_LIBRARY) for (const c of g.items) expect(ok(c.formula).type, c.label).toBe('bool');
    expect(PRESETS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
  });

  it('refuses a timeframe nested in another', () => {
    expect(() => checkTimeframes(ok('[W] (CLOSE > [D] HIGH)').node)).toThrow(/inside a \[W\] block/);
    expect(() => checkTimeframes(ok('[W] ([W] CLOSE > 1)').node)).not.toThrow();
  });
});

// ---- evaluation ----

const IST = 5.5 * 3600;
/** Trading days (Mon–Fri) from a start date, stamped 09:15 IST, with a deterministic random walk. */
function dailyBars(n: number, start = Date.UTC(2024, 0, 1), seed = 7): Candle[] {
  let x = seed, price = 100;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const out: Candle[] = [];
  for (let t = start / 1000; out.length < n; t += 86400) {
    const dow = new Date(t * 1000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const open = price * (1 + (rnd() - 0.5) * 0.02);
    const close = open * (1 + (rnd() - 0.5) * 0.04);
    const high = Math.max(open, close) * (1 + rnd() * 0.01), low = Math.min(open, close) * (1 - rnd() * 0.01);
    out.push({ time: t + 9 * 3600 + 15 * 60 - IST, open, high, low, close, volume: Math.round(1000 + rnd() * 9000) });
    price = close;
  }
  return out;
}
// Plain reference formulas over the whole series (TradingView's definitions), for checking rebuilt values.
const rsiLast = (c: number[], n: number) => {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); }
  g /= n; l /= n;
  for (let i = n + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return 100 - 100 / (1 + g / l);
};
const emaLast = (c: number[], n: number) => {
  let e = c.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < c.length; i++) e = c[i] * (2 / (n + 1)) + e * (1 - 2 / (n + 1));
  return e;
};
const source = (daily: Candle[]) => (tf: Tf) => (tf === 'D' ? daily : tf === 'W' || tf === 'M' ? resample(daily, tf) : null);
const run = (formula: string, daily: Candle[], tf: Tf = 'D') => new Evaluator(source(daily)).series(ok(formula).node, tf);

describe('evaluation basics', () => {
  const d = dailyBars(300);
  it('compares bar by bar', () => {
    expect(run('CLOSE > OPEN', d)).toEqual(d.map((b) => (b.close > b.open ? 1 : 0)));
  });
  it('a crossover is true only on the bar it happens', () => {
    const s = run('CROSSOVER(CLOSE, SMA(CLOSE, 10))', d), above = run('CLOSE > SMA(CLOSE, 10)', d);
    for (let i = 10; i < d.length; i++) expect(s[i]).toBe(above[i] === 1 && above[i - 1] === 0 ? 1 : 0);
  });
  it('unknown during warm-up; AND stays unknown, OR with a true side is true', () => {
    expect(run('SMA(CLOSE, 20) > 0', d)[5]).toBeNull();
    expect(run('SMA(CLOSE, 20) > 0 AND CLOSE > 0', d)[5]).toBeNull();
    expect(run('SMA(CLOSE, 20) > 0 OR CLOSE > 0', d)[5]).toBe(1);
    expect(run('NOT (SMA(CLOSE, 20) > 0)', d)[5]).toBeNull();
  });
  it('every function runs on its defaults', () => {
    for (const f of FUNCTIONS) {
      if (f.params.some((p) => p.def == null)) continue;
      const s = run(f.returns === 'bool' ? f.name : `${f.name} > -1e18`, d);
      expect(s.length, f.name).toBe(d.length);
    }
    expect(run('BULL_DIV(RSI(CLOSE, 14))', d).length).toBe(d.length);
  });
});

describe('timeframes', () => {
  const d = dailyBars(400);
  const weeks = resample(d, 'W');
  // A Wednesday in the middle of the data and the week it belongs to.
  const wed = d.findIndex((b, i) => i > 200 && new Date((b.time + IST) * 1000).getUTCDay() === 3);
  const wk = weeks.findIndex((w) => w.time > d[wed].time) - 1;
  const monday = d.findIndex((b) => b.time >= weeks[wk].time);

  it('[W] HIGH[1] is last week\'s high; [W] HIGH is this week\'s high so far, never the final one', () => {
    expect(run('[W] HIGH[1]', d)[wed]).toBe(weeks[wk - 1].high);
    expect(run('[W] HIGH', d)[wed]).toBe(Math.max(...d.slice(monday, wed + 1).map((b) => b.high)));
    expect(run('[W] CLOSE', d)[wed]).toBe(d[wed].close);
  });

  it('pivots for the week come from last week, known from Monday', () => {
    const p = weeks[wk - 1];
    const pp = (p.high + p.low + p.close) / 3;
    const s = run('PIVOT(CLASSIC, P, W)', d);
    expect(s[monday]).toBeCloseTo(pp, 10);
    expect(s[wed]).toBeCloseTo(pp, 10);
    expect(run('PIVOT(CLASSIC, R1, D)', d)[wed]).toBeCloseTo(2 * ((d[wed - 1].high + d[wed - 1].low + d[wed - 1].close) / 3) - d[wed - 1].low, 10);
  });

  // The strongest guarantee: a value on day k is the same whether or not later days exist.
  it('never looks ahead: values on a day do not change when later data is added', () => {
    const formulas = [
      '[W] (CLOSE > EMA(CLOSE, 10))', '[W] RSI(CLOSE, 14)', '[M] HIGH', '[W] HIGH[1]', 'CLOSE > [W] HIGH[1]',
      'CROSSOVER(CLOSE, [W] EMA(CLOSE, 5))', '[M] SMA(CLOSE, 3) < CLOSE', 'PIVOT(CLASSIC, R1, W)', 'BULL_DIV(RSI(CLOSE, 14))',
      'SUPERTREND_DIR(10, 3) = 1 AND [W] (SUPERTREND_DIR(10, 3) = 1)', 'RESISTANCE(5, 5)',
    ];
    for (const f of formulas) {
      const full = run(f, d);
      for (const k of [150, 151, 222, 223, 224, 300, 377]) {
        const cut = run(f, d.slice(0, k + 1));
        expect(cut[k], `${f} on day ${k}`).toEqual(full[k]);
      }
    }
  });

  it('a rebuilt weekly value equals one computed from the full history (to 1e-9)', () => {
    const long = dailyBars(3000, Date.UTC(2012, 0, 2), 11);
    for (const [f, ref] of [
      ['[W] RSI(CLOSE, 14)', (w: Candle[]) => rsiLast(w.map((b) => b.close), 14)],
      ['[W] EMA(CLOSE, 50)', (w: Candle[]) => emaLast(w.map((b) => b.close), 50)],
    ] as const) {
      const s = run(f, long);
      for (const i of [1500, 2222, 2998]) {
        const exact = ref(resample(long.slice(0, i + 1), 'W'));
        expect(Math.abs(s[i]! - exact) / Math.abs(exact), `${f} @${i}`).toBeLessThan(1e-9);
      }
    }
  });

  it('`from` leaves earlier rebuilt bars unknown, the rest exact', () => {
    const n = ok('[W] (CLOSE > EMA(CLOSE, 10))').node;
    const all = new Evaluator(source(d)).series(n, 'D');
    const tail = new Evaluator(source(d), d.length - 5).series(n, 'D');
    expect(tail.slice(-5)).toEqual(all.slice(-5));
  });

  it('lookback counts the bars a condition reaches back on its own timeframe', () => {
    const lb = (f: string) => lookback(ok(f).node as Node);
    expect(lb('CLOSE > [W] HIGH[1]')).toBe(0);
    expect(lb('CROSSOVER(CLOSE, [W] HIGH[1])')).toBe(1);
    expect(lb('EVERY([W] CLOSE > 1, 5)')).toBe(4);
    expect(lb('EMA([W] CLOSE, 5) > 1')).toBe(Infinity);
    expect(lb('CLOSE[3] > OPEN')).toBe(3);
  });
});

describe('intraday timeframes on real NIFTY 5-minute bars', () => {
  const five: Candle[] = JSON.parse(readFileSync(new URL('../../indicators/fixtures/nifty-5m-2026-10-26.json', import.meta.url), 'utf8')).candles;
  const src = (bars: Candle[]) => (tf: Tf) => (tf === '5m' ? bars : ['15m', '1h', 'D'].includes(tf) ? resample(bars, tf) : null);
  const at = (f: string, bars: Candle[], tf: Tf) => new Evaluator(src(bars)).series(ok(f).node, tf);

  it('15m bars line up at 09:15 IST, and a finer [5m] value is the last 5m bar inside', () => {
    const q = resample(five, '15m');
    expect(new Date((q[0].time + IST) * 1000).toISOString().slice(11, 16)).toMatch(/^(09:15|09:30|09:45|1\d:\d5|1\d:\d0)$/);
    expect(at('[5m] CLOSE', five, '15m')).toEqual(q.map((b) => b.close));
  });

  it('never looks ahead on intraday mixes either', () => {
    for (const f of ['[1h] RSI(CLOSE, 14) > 50', '[D] HIGH[1] < CLOSE', '[15m] (CLOSE > VWAP)', '[D] (CLOSE > SMA(CLOSE, 3))']) {
      const full = at(f, five, '5m');
      for (const k of [400, 401, 777, 1000, 1200]) expect(at(f, five.slice(0, k + 1), '5m')[k], `${f} @${k}`).toEqual(full[k]);
    }
  });

  it('prints the parsed tree identically to the formula', () => {
    expect(print(ok('[15m] (CLOSE > VWAP)').node)).toBe('[15m] (CLOSE > VWAP)');
  });
});

describe('time-of-day relative volume', () => {
  // 22 sessions of 15-minute bars; every session trades 1000 at 09:15 and 100 in later bars, except the last session's
  // 09:15 bar (3000) and its 10:00 bar (50).
  const IST2 = 5.5 * 3600;
  const bars: Candle[] = [];
  for (let d = 0; d < 22; d++) {
    const day0 = Date.UTC(2026, 8, 1 + d) / 1000 - IST2;
    for (let k = 0; k < 25; k++) {
      const t = day0 + 9 * 3600 + 15 * 60 + k * 900;
      const last = d === 21;
      const volume = k === 0 ? (last ? 3000 : 1000) : last && k === 3 ? 50 : 100;
      bars.push({ time: t, open: 100, high: 101, low: 99, close: 100, volume });
    }
  }
  const series = (f: string) => new Evaluator((tf) => (tf === '15m' ? bars : null)).series(ok(f).node, '15m');
  it('compares each bar with the same time of day in earlier sessions only', () => {
    const tod = series('RVOL_TOD(20)');
    const lastDay = bars.length - 25;
    expect(tod[lastDay]).toBe(3);        // 3000 vs the usual 1000 at 09:15
    expect(tod[lastDay + 3]).toBe(0.5);  // 50 vs the usual 100 at 10:00
    expect(tod[lastDay + 4]).toBe(1);
    expect(tod[20 * 25 - 1]).toBeNull(); // only 19 earlier sessions there
  });
  it('cumulative: volume so far today against the same point of earlier days', () => {
    const cum = series('RVOL_CUM(20)');
    const lastDay = bars.length - 25;
    expect(cum[lastDay]).toBe(3);
    expect(cum[lastDay + 3]).toBeCloseTo((3000 + 100 + 100 + 50) / 1300, 12);
  });
});
