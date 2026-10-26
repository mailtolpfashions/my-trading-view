import { atr, bollinger, ema, macd, rsi, sma, smaOfSeries, supertrend, vwap, type Series } from '@mtv/indicators';
import type { Candle } from '@mtv/shared';

export const UP = '#089981';
export const DOWN = '#f23645';

export type StudyLine = { key: string; title: string; color: string; kind?: 'line' | 'histogram'; width?: 1 | 2 };
/** Per-point colours (Supertrend direction, MACD histogram sign). */
export type PointColors = Record<string, (string | null)[]>;

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

const closes = (c: Candle[]) => c.map((b) => b.close);

export const STUDIES: Study[] = [
  { id: 'ema9', name: 'EMA 9', place: 'main', lines: [{ key: 'v', title: 'EMA 9', color: '#2962ff' }], compute: (c) => ({ values: { v: ema(closes(c), 9) } }) },
  { id: 'ema21', name: 'EMA 21', place: 'main', lines: [{ key: 'v', title: 'EMA 21', color: '#ff9800' }], compute: (c) => ({ values: { v: ema(closes(c), 21) } }) },
  { id: 'sma50', name: 'SMA 50', place: 'main', lines: [{ key: 'v', title: 'SMA 50', color: '#9c27b0' }], compute: (c) => ({ values: { v: sma(closes(c), 50) } }) },
  { id: 'sma200', name: 'SMA 200', place: 'main', lines: [{ key: 'v', title: 'SMA 200', color: '#455a64', width: 2 }], compute: (c) => ({ values: { v: sma(closes(c), 200) } }) },
  { id: 'vwap', name: 'VWAP', place: 'main', lines: [{ key: 'v', title: 'VWAP', color: '#e91e63', width: 2 }], compute: (c) => ({ values: { v: vwap(c) } }) },
  {
    id: 'bb',
    name: 'Bollinger Bands 20 2',
    place: 'main',
    lines: [
      { key: 'upper', title: 'Upper', color: '#2196f3' },
      { key: 'middle', title: 'Basis', color: '#ff6d00' },
      { key: 'lower', title: 'Lower', color: '#2196f3' },
    ],
    compute: (c) => ({ values: bollinger(closes(c), 20, 2) }),
  },
  {
    id: 'st',
    name: 'Supertrend 10 3',
    place: 'main',
    lines: [{ key: 'v', title: 'Supertrend', color: UP, width: 2 }],
    compute: (c) => {
      const s = supertrend(c, 10, 3);
      // A null at each flip breaks the line so the up and down legs are not joined, as on TradingView.
      const v = s.value.map((x, i) => (i > 0 && s.direction[i] !== s.direction[i - 1] ? null : x));
      return { values: { v }, colors: { v: s.direction.map((d) => (d === 1 ? UP : d === -1 ? DOWN : null)) } };
    },
  },
  {
    id: 'rsi',
    name: 'RSI 14',
    place: 'pane',
    range: [0, 100],
    levels: [30, 50, 70],
    // TradingView's default RSI also plots a 14-period SMA of the RSI (yellow).
    lines: [{ key: 'v', title: 'RSI 14', color: '#7e57c2' }, { key: 'ma', title: 'RSI-based MA', color: '#f9a825' }],
    compute: (c) => {
      const v = rsi(closes(c), 14);
      return { values: { v, ma: smaOfSeries(v, 14) } };
    },
  },
  {
    id: 'macd',
    name: 'MACD 12 26 9',
    place: 'pane',
    levels: [0],
    lines: [
      { key: 'histogram', title: 'Histogram', color: '#26a69a', kind: 'histogram' },
      { key: 'macd', title: 'MACD', color: '#2962ff' },
      { key: 'signal', title: 'Signal', color: '#ff6d00' },
    ],
    compute: (c) => {
      const m = macd(closes(c));
      const colors = m.histogram.map((h, i) => {
        if (h == null) return null;
        const prev = m.histogram[i - 1] ?? 0;
        return h >= 0 ? (h >= prev ? '#26a69a' : '#b2dfdb') : h <= prev ? '#ff5252' : '#ffcdd2';
      });
      return { values: m, colors: { histogram: colors } };
    },
  },
  { id: 'atr', name: 'ATR 14', place: 'pane', lines: [{ key: 'v', title: 'ATR 14', color: '#b71c1c' }], compute: (c) => ({ values: { v: atr(c, 14) } }) },
];

export const studyById = (id: string) => STUDIES.find((s) => s.id === id);
