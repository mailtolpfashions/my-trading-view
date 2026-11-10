import { atr, bollinger, ema, macd, pivotLevelValues, rsi, sma, smaOfSeries, supertrend, vwap, type PivotMethod, type Series } from '@mtv/indicators';
import type { Candle } from '@mtv/shared';

export const UP = '#0a9b76';
export const DOWN = '#e5484d';

export type StudyLine = { key: string; title: string; color: string; kind?: 'line' | 'histogram'; width?: 1 | 2 };
/** Per-point colours (Supertrend direction, MACD histogram sign). */
export type PointColors = Record<string, (string | null)[]>;

/** One setting the owner can change (a length, a level, a choice), like TradingView's indicator inputs. */
export type StudyParam = { key: string; label: string; def: number | string; min?: number; max?: number; step?: number; options?: string[] };
export type StudyValues = Record<string, number | string>;

/** An indicator with its settings applied: what the chart draws. */
export type Study = {
  id: string;
  name: string;
  /** 'main' overlays the price chart; 'pane' gets its own pane below, like RSI on TradingView. */
  place: 'main' | 'pane';
  lines: StudyLine[];
  /** Fixed scale for bounded oscillators, plus dashed reference levels. */
  range?: [number, number];
  levels?: number[];
  compute(c: Candle[]): { values: Record<string, Series>; colors?: PointColors };
};

/** The definition: its settings and how they shape the drawn indicator. */
type StudyDef = {
  id: string;
  /** Name in the indicator list (without settings). */
  label: string;
  place: Study['place'];
  params: StudyParam[];
  build(p: StudyValues): Omit<Study, 'id' | 'place'>;
};

const closes = (c: Candle[]) => c.map((b) => b.close);
const n = (p: StudyValues, k: string) => Number(p[k]);
const len = (key = 'length', def = 14, label = 'Length'): StudyParam => ({ key, label, def, min: 1, max: 500, step: 1 });

/** One moving-average definition (EMA or SMA) with an editable length; the id keeps its default for saved charts. */
const movingAverage = (id: string, kind: 'EMA' | 'SMA', def: number, color: string, width?: 1 | 2): StudyDef => ({
  id, label: `${kind} ${def}`, place: 'main', params: [len('length', def)],
  build: (p) => ({
    name: `${kind} ${n(p, 'length')}`,
    lines: [{ key: 'v', title: `${kind} ${n(p, 'length')}`, color, width }],
    compute: (c) => ({ values: { v: kind === 'EMA' ? ema(closes(c), n(p, 'length')) : sma(closes(c), n(p, 'length')) } }),
  }),
});

// ---- Pivot points: levels from the previous day (week, month), drawn as flat steps that restart each period ----
const PIVOT_METHODS = ['Classic', 'Traditional', 'Fibonacci', 'Camarilla', 'Woodie'];
const PIVOT_PERIODS = ['Auto', 'Day', 'Week', 'Month'];
const PIVOT_LINES: StudyLine[] = [
  { key: 'R3', title: 'R3', color: '#c62828' }, { key: 'R2', title: 'R2', color: '#e53935' }, { key: 'R1', title: 'R1', color: '#ef6c00' },
  { key: 'P', title: 'P', color: '#6d4c41', width: 2 },
  { key: 'S1', title: 'S1', color: '#2e7d32' }, { key: 'S2', title: 'S2', color: '#1b8a5a' }, { key: 'S3', title: 'S3', color: '#00695c' },
];
const ORDER = ['P', 'R1', 'S1', 'R2', 'S2', 'R3', 'S3'] as const; // pivotLevelValues' order
const istDay = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);
/** The period a bar belongs to: its IST day, its week (from Monday) or its month. */
function periodKey(t: number, period: string): string {
  const d = istDay(t);
  if (period === 'Month') return d.slice(0, 7);
  if (period === 'Week') { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); }
  return d;
}
/** Auto: daily pivots on minute charts, weekly on daily charts, monthly on weekly and monthly charts. */
function autoPeriod(c: Candle[]): string {
  if (c.length < 2) return 'Day';
  const step = c[c.length - 1].time - c[c.length - 2].time;
  return step < 86_400 ? 'Day' : step < 5 * 86_400 ? 'Week' : 'Month';
}
function pivotSeries(c: Candle[], method: PivotMethod, period: string): Record<string, Series> {
  const out: Record<string, Series> = Object.fromEntries(ORDER.map((k) => [k, c.map(() => null)]));
  const per = period === 'Auto' ? autoPeriod(c) : period;
  type Ohlc = { h: number; l: number; c: number; o: number };
  let prev: Ohlc | null = null, cur: Ohlc | null = null, key = '', levels: (number | null)[] | null = null;
  for (let i = 0; i < c.length; i++) {
    const b = c[i], k = periodKey(b.time, per);
    if (k !== key) {
      if (cur) prev = cur;
      key = k;
      cur = { h: b.high, l: b.low, c: b.close, o: b.open };
      levels = prev ? pivotLevelValues(method, prev.h, prev.l, prev.c, prev.o, b.open) : null;
      continue; // leave the first bar of each period empty, so one period's line is not joined to the next
    }
    cur!.h = Math.max(cur!.h, b.high); cur!.l = Math.min(cur!.l, b.low); cur!.c = b.close;
    if (levels) ORDER.forEach((name, j) => { out[name][i] = levels![j]; });
  }
  return out;
}

const DEFS: StudyDef[] = [
  movingAverage('ema9', 'EMA', 9, '#2962ff'),
  movingAverage('ema21', 'EMA', 21, '#ff9800'),
  movingAverage('sma50', 'SMA', 50, '#9c27b0'),
  movingAverage('sma200', 'SMA', 200, '#455a64', 2),
  { id: 'vwap', label: 'VWAP', place: 'main', params: [], build: () => ({ name: 'VWAP', lines: [{ key: 'v', title: 'VWAP', color: '#e91e63', width: 2 }], compute: (c) => ({ values: { v: vwap(c) } }) }) },
  {
    id: 'pivots', label: 'Pivot points', place: 'main',
    params: [{ key: 'method', label: 'Type', def: 'Classic', options: PIVOT_METHODS }, { key: 'period', label: 'Period', def: 'Auto', options: PIVOT_PERIODS }],
    build: (p) => ({
      name: `Pivots ${p.method}${p.period === 'Auto' ? '' : ` ${p.period}`}`,
      lines: PIVOT_LINES,
      compute: (c) => ({ values: pivotSeries(c, String(p.method).toUpperCase() as PivotMethod, String(p.period)) }),
    }),
  },
  {
    id: 'bb', label: 'Bollinger Bands', place: 'main', params: [len('length', 20), { key: 'mult', label: 'Std dev', def: 2, min: 0.1, max: 10, step: 0.1 }],
    build: (p) => ({
      name: `Bollinger Bands ${n(p, 'length')} ${n(p, 'mult')}`,
      lines: [{ key: 'upper', title: 'Upper', color: '#2196f3' }, { key: 'middle', title: 'Basis', color: '#ff6d00' }, { key: 'lower', title: 'Lower', color: '#2196f3' }],
      compute: (c) => ({ values: bollinger(closes(c), n(p, 'length'), n(p, 'mult')) }),
    }),
  },
  {
    id: 'st', label: 'Supertrend', place: 'main', params: [len('length', 10, 'ATR length'), { key: 'factor', label: 'Factor', def: 3, min: 0.1, max: 20, step: 0.1 }],
    build: (p) => ({
      name: `Supertrend ${n(p, 'length')} ${n(p, 'factor')}`,
      lines: [{ key: 'v', title: 'Supertrend', color: UP, width: 2 }],
      compute: (c) => {
        const s = supertrend(c, n(p, 'length'), n(p, 'factor'));
        // A null at each flip breaks the line so the up and down legs are not joined, as on TradingView.
        const v = s.value.map((x, i) => (i > 0 && s.direction[i] !== s.direction[i - 1] ? null : x));
        return { values: { v }, colors: { v: s.direction.map((d) => (d === 1 ? UP : d === -1 ? DOWN : null)) } };
      },
    }),
  },
  {
    id: 'rsi', label: 'RSI', place: 'pane',
    params: [len('length', 14), len('ma', 14, 'MA length'), { key: 'upper', label: 'Overbought', def: 70, min: 50, max: 100, step: 1 }, { key: 'lower', label: 'Oversold', def: 30, min: 0, max: 50, step: 1 }],
    build: (p) => ({
      name: `RSI ${n(p, 'length')}`,
      range: [0, 100],
      levels: [n(p, 'lower'), 50, n(p, 'upper')],
      // TradingView's default RSI also plots a moving average of the RSI (yellow).
      lines: [{ key: 'v', title: `RSI ${n(p, 'length')}`, color: '#7e57c2' }, { key: 'ma', title: 'RSI-based MA', color: '#f9a825' }],
      compute: (c) => { const v = rsi(closes(c), n(p, 'length')); return { values: { v, ma: smaOfSeries(v, n(p, 'ma')) } }; },
    }),
  },
  {
    id: 'macd', label: 'MACD', place: 'pane', params: [len('fast', 12, 'Fast'), len('slow', 26, 'Slow'), len('signal', 9, 'Signal')],
    build: (p) => ({
      name: `MACD ${n(p, 'fast')} ${n(p, 'slow')} ${n(p, 'signal')}`,
      levels: [0],
      lines: [{ key: 'histogram', title: 'Histogram', color: '#26a69a', kind: 'histogram' }, { key: 'macd', title: 'MACD', color: '#2962ff' }, { key: 'signal', title: 'Signal', color: '#ff6d00' }],
      compute: (c) => {
        const m = macd(closes(c), n(p, 'fast'), n(p, 'slow'), n(p, 'signal'));
        const colors = m.histogram.map((h, i) => {
          if (h == null) return null;
          const prev = m.histogram[i - 1] ?? 0;
          return h >= 0 ? (h >= prev ? '#26a69a' : '#b2dfdb') : h <= prev ? '#ff5252' : '#ffcdd2';
        });
        return { values: m, colors: { histogram: colors } };
      },
    }),
  },
  {
    id: 'atr', label: 'ATR', place: 'pane', params: [len('length', 14)],
    build: (p) => ({ name: `ATR ${n(p, 'length')}`, lines: [{ key: 'v', title: `ATR ${n(p, 'length')}`, color: '#b71c1c' }], compute: (c) => ({ values: { v: atr(c, n(p, 'length')) } }) }),
  },
];

/** The quick indicators, for the picker: id, name and settings. */
export const STUDIES = DEFS.map((d) => ({ id: d.id, name: d.label, params: d.params }));
export const studyParams = (id: string) => DEFS.find((d) => d.id === id)?.params ?? [];
/** Saved settings merged over the defaults (a setting missing or out of range falls back to its default). */
export function studyValues(id: string, saved?: StudyValues): StudyValues {
  const out: StudyValues = {};
  for (const p of studyParams(id)) {
    const v = saved?.[p.key];
    if (p.options) out[p.key] = typeof v === 'string' && p.options.includes(v) ? v : p.def;
    else out[p.key] = typeof v === 'number' && Number.isFinite(v) && (p.min == null || v >= p.min) && (p.max == null || v <= p.max) ? v : p.def;
  }
  return out;
}
/** The indicator with its settings applied, or undefined for an unknown id. */
export function studyById(id: string, saved?: StudyValues): Study | undefined {
  const d = DEFS.find((x) => x.id === id);
  return d ? { id: d.id, place: d.place, ...d.build(studyValues(id, saved)) } : undefined;
}
